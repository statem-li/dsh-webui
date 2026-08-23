/**
 * dsh-memory 文件存储层：entries.json / state.json / changes/<date>.jsonl /
 * 各层 md 产物。所有写入走「tmp + rename」原子写，防止半写损坏。
 * 数据根：${DSH_HOME:-~/.dsh}/memories/dsh-memory/（与 memory-evolve 遗留数据同根目录、不同前缀，互不读写）。
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** 数据根目录。 */
export function memoryHome() {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(dshHome, 'memories', 'dsh-memory');
}
/** workspace 路径 → 项目目录 hash（sha1 前 12 位）。 */
export function projectHashOf(cwd) {
    return createHash('sha1').update(cwd).digest('hex').slice(0, 12);
}
/** 记忆条目稳定 id：mem_<sha1(content|scope|projectHash)>，同内容合并。 */
export function entryIdOf(content, scope, projectHash) {
    const key = `${scope}\u0000${projectHash ?? ''}\u0000${content.trim()}`;
    return `mem_${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
}
/** 本地日期 YYYY-MM-DD。 */
export function localDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
/** ISO 时间（本地时区偏移保留）。 */
export function nowIso() {
    return new Date().toISOString();
}
/** 原子写文本：tmp + rename（同一目录内）。 */
export async function atomicWriteText(file, content) {
    await mkdir(join(file, '..'), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, content, 'utf8');
    await rename(temp, file);
}
/** 原子写 JSON。 */
export async function atomicWriteJson(file, value) {
    await atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`);
}
/** 读取 JSON，缺失/损坏返回 fallback。 */
export async function readJson(file, fallback) {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    }
    catch {
        return fallback;
    }
}
/** 追加一行 JSONL（追加本身用 appendFile；损坏容忍，读侧幂等）。 */
export async function appendJsonl(file, value) {
    await mkdir(join(file, '..'), { recursive: true });
    const { appendFile } = await import('node:fs/promises');
    await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}
/** 读取 JSONL（容忍坏行），返回 { entries, seq }。 */
export async function readJsonl(file) {
    let raw;
    try {
        raw = await readFile(file, 'utf8');
    }
    catch {
        return [];
    }
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === '')
            continue;
        try {
            out.push(JSON.parse(trimmed));
        }
        catch {
            // 单条解析失败跳过，不中断批次。
        }
    }
    return out;
}
/** 修订版本保留上限（滚动清理，超过只保留最近 N 个）。 */
const REVISION_KEEP = 20;
/**
 * MemoryStore：所有记忆数据的读写入口。
 * 线程模型：调用方（ticker / turn/end 捕获）通过同一实例串行化写入，
 * 内部只保证单文件操作的原子性。
 */
export class MemoryStore {
    root;
    constructor(root = memoryHome()) {
        this.root = root;
    }
    // ── 路径 ────────────────────────────────────────────────────────────
    entriesFile() {
        return join(this.root, 'store', 'entries.json');
    }
    stateFile() {
        return join(this.root, 'store', 'state.json');
    }
    changesFile(date) {
        return join(this.root, 'changes', `${date}.jsonl`);
    }
    globalDir() {
        return join(this.root, 'global');
    }
    projectDir(hash) {
        return join(this.root, 'projects', hash);
    }
    dailyFile(date) {
        return join(this.root, 'daily', `${date}.md`);
    }
    // ── 条目 ────────────────────────────────────────────────────────────
    /** 全量条目索引（缺失/损坏从空开始）。 */
    async readEntries() {
        const file = await readJson(this.entriesFile(), { version: 1, entries: [] });
        return Array.isArray(file.entries) ? file.entries : [];
    }
    async writeEntries(entries) {
        await atomicWriteJson(this.entriesFile(), { version: 1, entries });
    }
    /**
     * entries.json 写串行队列：所有「读-改-写」操作必须经此队列执行，
     * 消除提取/注入命中刷新/API 裁决/每日编译之间的并发覆盖（read-modify-write 竞争）。
     */
    writeQueue = Promise.resolve();
    enqueueWrite(task) {
        const result = this.writeQueue.then(task);
        this.writeQueue = result.then(() => undefined, () => undefined);
        return result;
    }
    /**
     * 原子化「读 entries → 修改 → 写回」。fn 原地修改传入数组（或返回替换数组）。
     * @param fn - 接收当前 entries 快照，修改或返回新数组；返回值透传。
     */
    async mutateEntries(fn) {
        return this.enqueueWrite(async () => {
            const entries = await this.readEntries();
            const result = await fn(entries);
            await this.writeEntries(entries);
            return result;
        });
    }
    async getEntry(id) {
        const entries = await this.readEntries();
        return entries.find(entry => entry.id === id);
    }
    /**
     * 新增或更新（同 id 合并）。返回 { created, entry }。
     * 同时按去重逻辑：新增时若同内容（同 scope+projectHash）已存在则合并为 update。
     */
    async upsertEntry(next) {
        return this.mutateEntries(entries => {
            const id = entryIdOf(next.content, next.scope, next.projectHash);
            const existing = entries.find(entry => entry.id === id);
            const now = nowIso();
            let entry;
            if (existing !== undefined) {
                entry = {
                    ...existing,
                    content: next.content,
                    tags: mergeTags(existing.tags, next.tags),
                    pinned: next.pinned ?? existing.pinned,
                    importance: Math.max(existing.importance, next.importance ?? existing.importance),
                    layer: next.layer ?? existing.layer,
                    updatedAt: now,
                };
                entries.splice(entries.indexOf(existing), 1, entry);
                return { created: false, entry };
            }
            entry = {
                id,
                content: next.content,
                scope: next.scope,
                projectHash: next.scope === 'project' ? next.projectHash : null,
                tags: next.tags ?? [],
                pinned: next.pinned ?? false,
                createdAt: now,
                updatedAt: now,
                importance: next.importance ?? 10,
                lastHitAt: null,
                layer: next.layer ?? 'short',
                source: next.source ?? 'extract',
            };
            entries.push(entry);
            return { created: true, entry };
        });
    }
    /** 替换单条（用于裁决操作：改标签/移项目/置顶）。返回新条目；不存在返回 undefined。 */
    async patchEntry(id, patch) {
        return this.mutateEntries(entries => {
            const index = entries.findIndex(entry => entry.id === id);
            if (index === -1)
                return undefined;
            const updated = {
                ...entries[index],
                ...patch,
                id,
                updatedAt: nowIso(),
            };
            if (updated.scope === 'global')
                updated.projectHash = null;
            entries[index] = updated;
            return updated;
        });
    }
    /** 删除条目。返回是否删除成功。 */
    async removeEntry(id) {
        return this.mutateEntries(entries => {
            const index = entries.findIndex(entry => entry.id === id);
            if (index === -1)
                return false;
            entries.splice(index, 1);
            return true;
        });
    }
    /** 注入命中刷新（原子）：给命中的条目加分并刷新 lastHitAt，返回刷新条数。 */
    async applyHits(hitIds, bonus) {
        return this.mutateEntries(entries => {
            let count = 0;
            for (const entry of entries) {
                if (!hitIds.has(entry.id))
                    continue;
                entry.importance = Math.min(20, Math.round((entry.importance + bonus) * 100) / 100);
                entry.lastHitAt = nowIso();
                count += 1;
            }
            return count;
        });
    }
    /** 原子替换全部条目（ticker 每日编译等批量场景；fn 返回新数组）。 */
    async replaceEntries(fn) {
        return this.enqueueWrite(async () => {
            const entries = await this.readEntries();
            const next = await fn(entries);
            await this.writeEntries(next);
            return next;
        });
    }
    // ── 变更流 ──────────────────────────────────────────────────────────
    async appendChange(change) {
        const record = {
            ...change,
            id: `chg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
            at: nowIso(),
        };
        await appendJsonl(this.changesFile(localDate()), record);
        return record;
    }
    async readChanges(date) {
        if (date !== undefined)
            return readJsonl(this.changesFile(date));
        const dir = join(this.root, 'changes');
        let files;
        try {
            files = await readdir(dir);
        }
        catch {
            return [];
        }
        const dates = files
            .filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
            .sort();
        const all = [];
        for (const file of dates) {
            all.push(...await readJsonl(join(dir, file)));
        }
        return all;
    }
    // ── ticker 状态 ─────────────────────────────────────────────────────
    /**
     * 追加一行日志（按分类落独立文件 + 大小轮转，防无界增长）。
     * kind: extract=提取诊断 / api=API 请求（默认关闭）/ error=插件错误。
     * 轮转：当前文件 ≥ 10MB 时改名成带时间戳归档，只保留最近 5 个归档。
     */
    async appendLog(kind, line) {
        const { appendFile, stat, rename, readdir, unlink } = await import('node:fs/promises');
        const logDir = join(this.root, 'log');
        const file = join(logDir, `${kind}.log`);
        await mkdir(logDir, { recursive: true });
        const maxBytes = 10 * 1024 * 1024;
        const keep = 5;
        try {
            const info = await stat(file);
            if (info.size >= maxBytes) {
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                try {
                    await rename(file, join(logDir, `${kind}.${stamp}.log`));
                }
                catch { /* 忽略 */ }
                try {
                    const names = (await readdir(logDir))
                        .filter(name => name.startsWith(`${kind}.`) && name.endsWith('.log'))
                        .sort();
                    const excess = names.slice(0, Math.max(0, names.length - keep));
                    for (const name of excess) {
                        try {
                            await unlink(join(logDir, name));
                        }
                        catch { /* 忽略 */ }
                    }
                }
                catch { /* 忽略 */ }
            }
        }
        catch { /* 文件不存在，直接追加 */ }
        await appendFile(file, `${line}\n`, 'utf8');
    }
    /** 插件错误日志（本插件 async 任务失败；DSH 控制台日志不落盘）。 */
    async appendErrorLog(stage, message) {
        await this.appendLog('error', `[${nowIso()}] ${stage}: ${message}`);
    }
    /** 提取诊断日志（turn= 开始/结束/耗时/候选数，排查提取卡死）。 */
    async appendExtractLog(message) {
        await this.appendLog('extract', `[${nowIso()}] ${message}`);
    }
    /** API 请求诊断日志（默认关闭；仅 config.logApiRequests 开启时由 api.ts 调用）。 */
    async appendApiLog(message) {
        await this.appendLog('api', `[${nowIso()}] ${message}`);
    }
    async readState() {
        const state = await readJson(this.stateFile(), {
            schemaVersion: 1,
            perSession: {},
            lastDailyDate: null,
        });
        if (state.perSession === undefined || state.perSession === null)
            state.perSession = {};
        return state;
    }
    async writeState(state) {
        await atomicWriteJson(this.stateFile(), state);
    }
    // ── 记忆注入开关（按会话，内存缓存 + state.json 持久化） ───────────
    /** 注入被关闭的会话 id（内存缓存；null = 未加载）。 */
    injectDisabledCache = null;
    async ensureInjectCache() {
        if (this.injectDisabledCache !== null)
            return this.injectDisabledCache;
        const state = await this.readState();
        this.injectDisabledCache = new Set(Array.isArray(state.injectDisabled) ? state.injectDisabled : []);
        return this.injectDisabledCache;
    }
    /** 该会话是否启用记忆注入（默认开启）。 */
    async isInjectEnabled(sessionId) {
        const cache = await this.ensureInjectCache();
        return !cache.has(sessionId);
    }
    /** 设置该会话的记忆注入开关（持久化到 state.json，走写串行队列）。 */
    async setInjectEnabled(sessionId, enabled) {
        const cache = await this.ensureInjectCache();
        const next = new Set(cache);
        if (enabled)
            next.delete(sessionId);
        else
            next.add(sessionId);
        this.injectDisabledCache = next;
        await this.enqueueWrite(async () => {
            const state = await this.readState();
            state.injectDisabled = [...next];
            await this.writeState(state);
        });
    }
    // ── 项目 meta ───────────────────────────────────────────────────────
    async readProjectMeta(hash) {
        const meta = await readJson(join(this.projectDir(hash), 'meta.json'), null);
        return meta ?? undefined;
    }
    async writeProjectMeta(hash, meta) {
        await atomicWriteJson(join(this.projectDir(hash), 'meta.json'), meta);
    }
    /** 该工作区是否开启自动记忆（默认 true；meta 缺失或字段未写视为开启）。 */
    async isAutoMemoryEnabled(hash) {
        const meta = await this.readProjectMeta(hash);
        return meta?.autoMemory !== false;
    }
    /** 列出全部项目（含 meta 与统计）。 */
    async listProjects(entries) {
        const dir = join(this.root, 'projects');
        let hashes;
        try {
            hashes = (await readdir(dir, { withFileTypes: true }))
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name);
        }
        catch {
            hashes = [];
        }
        const projects = [];
        for (const hash of hashes) {
            const meta = await this.readProjectMeta(hash);
            if (meta === undefined)
                continue;
            const owned = entries.filter(entry => entry.scope === 'project' && entry.projectHash === hash);
            projects.push({
                hash,
                path: meta.path,
                alias: meta.alias,
                locked: meta.locked,
                autoMemory: meta.autoMemory !== false,
                entryCount: owned.length,
                pinnedCount: owned.filter(entry => entry.pinned).length,
            });
        }
        projects.sort((a, b) => a.path.localeCompare(b.path));
        return projects;
    }
    /**
     * 读取 DSH 工作区注册表（${DSH_HOME}/storages/workspace.json），容错返回空。
     * 用于让「尚无记忆的新工作区」也出现在面板项目列表（entryCount 0）。
     */
    async listDshWorkspaces() {
        const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
        const file = join(dshHome, 'storages', 'workspace.json');
        const raw = await readJson(file, {});
        const table = raw?.tables?.workspaces;
        if (typeof table !== 'object' || table === null)
            return [];
        const out = [];
        for (const record of Object.values(table)) {
            if (typeof record === 'object' && record !== null && typeof record.path === 'string' && record.path !== '') {
                out.push({ path: record.path, title: typeof record.title === 'string' && record.title !== '' ? record.title : record.path });
            }
        }
        return out;
    }
    // ── 修订版本（consolidate 回滚锚点） ────────────────────────────────
    revisionsDir() {
        return join(this.root, 'revisions');
    }
    /**
     * 写入一个修订快照（整理前调用），返回修订 id。
     * 保存 meta + 全量 entries，回滚时直接整体恢复。
     */
    async writeRevision(input) {
        const id = `rev_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
        const meta = {
            id,
            at: nowIso(),
            entryCount: input.entries.length,
            scope: input.scope,
            trigger: input.trigger,
        };
        await atomicWriteJson(join(this.revisionsDir(), `${id}.json`), { version: 1, meta, entries: input.entries });
        await this.pruneRevisions(REVISION_KEEP);
        return id;
    }
    /** 列出修订版本（新 → 旧）。 */
    async listRevisions() {
        const dir = this.revisionsDir();
        let files;
        try {
            files = await readdir(dir);
        }
        catch {
            return [];
        }
        const metas = [];
        for (const file of files) {
            if (!/^rev_[0-9a-z]+_[0-9a-z]+\.json$/.test(file))
                continue;
            const data = await readJson(join(dir, file), {});
            if (data.meta !== undefined && typeof data.meta.id === 'string')
                metas.push(data.meta);
        }
        return metas.sort((a, b) => b.at.localeCompare(a.at));
    }
    /** 读修订快照的全部条目；不存在返回 null。 */
    async readRevisionEntries(id) {
        const data = await readJson(join(this.revisionsDir(), `${id}.json`), null);
        if (data === null || !Array.isArray(data.entries))
            return null;
        return data.entries;
    }
    /** 回滚到某修订（整体恢复 entries，走写串行队列）。返回是否成功。 */
    async restoreRevision(id) {
        const entries = await this.readRevisionEntries(id);
        if (entries === null)
            return false;
        await this.replaceEntries(() => entries);
        return true;
    }
    /** 滚动清理：只保留最近 keep 个修订。 */
    async pruneRevisions(keep) {
        const metas = await this.listRevisions();
        if (metas.length <= keep)
            return;
        for (const meta of metas.slice(keep)) {
            try {
                await unlink(join(this.revisionsDir(), `${meta.id}.json`));
            }
            catch {
                // 已不存在则忽略。
            }
        }
    }
    // ── md 产物（compile.ts 调用） ─────────────────────────────────────
    /** 写任意 md 产物（原子）。 */
    async writeArtifact(path, content) {
        await atomicWriteText(join(this.root, path), content);
    }
    /** 写项目层产物。 */
    async writeProjectArtifacts(hash, artifacts) {
        const dir = this.projectDir(hash);
        await mkdir(dir, { recursive: true });
        for (const [name, content] of Object.entries(artifacts)) {
            if (content === undefined)
                continue;
            await atomicWriteText(join(dir, `${name}.md`), content);
        }
    }
    /** 写全局层产物。 */
    async writeGlobalArtifacts(artifacts) {
        const dir = this.globalDir();
        await mkdir(dir, { recursive: true });
        for (const [name, content] of Object.entries(artifacts)) {
            if (content === undefined)
                continue;
            await atomicWriteText(join(dir, `${name}.md`), content);
        }
    }
}
/** 合并标签（保留旧标签 + 新标签，去重，上限 8）。 */
export function mergeTags(existing, next, max = 8) {
    const out = [];
    for (const tag of [...existing, ...(next ?? [])]) {
        const t = String(tag).trim();
        if (t === '')
            continue;
        if (!out.includes(t))
            out.push(t);
        if (out.length >= max)
            break;
    }
    return out;
}
/** 摘要（截断 80 字）。 */
export function summarize(content, max = 80) {
    const flat = content.replace(/\s+/g, ' ').trim();
    return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
//# sourceMappingURL=store.js.map