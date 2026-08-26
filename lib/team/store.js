/**
 * team — 持久化层（host 半身）。
 *
 * 数据根：${DSH_HOME:-~/.dsh}/team/
 *   ├── globals.json          TeamGlobals
 *   ├── teams/<teamId>.json   一团队一文件（用户可直接编辑 / 纳入 git / 导入导出）
 *   ├── chat-mode.json        sessionId → ChatModeState（最多 200 条，LRU 淘汰）
 *   └── runs/R-<ts>-<rand>/   run.json + steps/*.md + final-deliverable.md
 *
 * 写入一律「临时文件 + rename」原子替换；读取失败降级为「只读 + 报错提示」，
 * 单个坏文件不影响其它团队。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CHAT_MODE, TEAM_SCHEMA_VERSION, TeamError, isValidTeamId, normalizeChatMode, normalizeGlobals, normalizeTeam, } from './types.js';
import { DEFAULT_TEAM_ID, DEFAULT_TEAM_NAME, buildDefaultTeam, buildEmptyTeam } from './seed.js';
/** 数据根：${DSH_HOME:-~/.dsh}/team/。 */
export function teamDataRoot() {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(dshHome, 'team');
}
/** chat-mode 保留的会话条数上限。 */
const CHAT_MODE_MAX = 200;
/** 历史运行目录保留上限（超出按时间淘汰最旧的）。 */
const RUNS_KEEP = 200;
function readJson(path) {
    const bytes = readFileSync(path);
    return JSON.parse(bytes.toString('utf-8'));
}
/** 原子写：写 .tmp 再 rename（同目录，跨平台原子）。 */
function writeJsonAtomic(path, value) {
    mkdirSync(join(path, '..'), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
    renameSync(tmp, path);
}
/** 文件名安全段（团队 id / run id / 步骤文件名都过这一关）。 */
function safeSegment(value, what) {
    if (!/^[A-Za-z0-9_.-]+$/.test(value) || value.includes('..')) {
        throw new TeamError(`${what}非法：${value}`, 'segment_invalid', 400);
    }
    return value;
}
/** 团队存储 + 运行存储。 */
export class TeamStore {
    root;
    teamsDir;
    runsDir;
    globalsPath;
    chatModePath;
    constructor(root) {
        this.root = root ?? teamDataRoot();
        this.teamsDir = join(this.root, 'teams');
        this.runsDir = join(this.root, 'runs');
        this.globalsPath = join(this.root, 'globals.json');
        this.chatModePath = join(this.root, 'chat-mode.json');
        mkdirSync(this.teamsDir, { recursive: true });
        mkdirSync(this.runsDir, { recursive: true });
        this.seedIfEmpty();
    }
    // ── 播种 ──────────────────────────────────────────────────────────────────
    /** 首次运行（teams/ 为空）时播种出厂默认团队并设为 activeTeamId。 */
    seedIfEmpty() {
        try {
            const files = readdirSync(this.teamsDir).filter(name => name.endsWith('.json'));
            if (files.length > 0)
                return;
            const team = buildDefaultTeam(DEFAULT_TEAM_ID, DEFAULT_TEAM_NAME);
            this.saveTeam(team);
            const globals = this.readGlobals();
            if (globals.activeTeamId === '') {
                this.writeGlobals({ ...globals, activeTeamId: team.id });
            }
        }
        catch {
            // 播种失败不阻塞插件加载（面板会显示空列表 + 提供「恢复默认编制」）。
        }
    }
    // ── globals ───────────────────────────────────────────────────────────────
    /** 读全局默认（缺失/损坏回默认值）。 */
    readGlobals() {
        try {
            return normalizeGlobals(readJson(this.globalsPath));
        }
        catch {
            return normalizeGlobals(undefined);
        }
    }
    /** 写全局默认。 */
    writeGlobals(next) {
        const value = normalizeGlobals(next);
        writeJsonAtomic(this.globalsPath, value);
        return value;
    }
    /** 合并式更新 globals。 */
    patchGlobals(patch) {
        return this.writeGlobals({ ...this.readGlobals(), ...patch });
    }
    // ── 团队 ──────────────────────────────────────────────────────────────────
    teamPath(id) {
        return join(this.teamsDir, `${safeSegment(id, '团队 id')}.json`);
    }
    /** 团队 id 列表（按文件名）。 */
    listTeamIds() {
        try {
            return readdirSync(this.teamsDir)
                .filter(name => name.endsWith('.json') && !name.endsWith('.tmp'))
                .map(name => name.slice(0, -5))
                .filter(isValidTeamId)
                .sort();
        }
        catch {
            return [];
        }
    }
    /** 读单个团队；不存在或损坏抛 TeamError。 */
    readTeam(id) {
        if (!isValidTeamId(id))
            throw new TeamError(`团队 id 非法：${id}`, 'team_id_invalid', 400);
        const path = this.teamPath(id);
        if (!existsSync(path))
            throw new TeamError(`团队不存在：${id}`, 'team_not_found', 404);
        let raw;
        try {
            raw = readJson(path);
        }
        catch {
            throw new TeamError(`团队文件损坏（JSON 解析失败）：${id}.json`, 'team_corrupt', 500);
        }
        const team = normalizeTeam(raw);
        if (team.schemaVersion > TEAM_SCHEMA_VERSION) {
            throw new TeamError(`团队 ${id} 的存储版本（v${team.schemaVersion}）高于当前插件支持的 v${TEAM_SCHEMA_VERSION}，已按只读处理`, 'team_version_ahead', 409);
        }
        return team;
    }
    /** 读团队，失败返回 null（列表投影用）。 */
    tryReadTeam(id) {
        try {
            return { team: this.readTeam(id) };
        }
        catch (error) {
            return { issue: error instanceof Error ? error.message : String(error) };
        }
    }
    /** 团队清单（坏文件以 readonly + issue 呈现，不隐藏）。 */
    listTeams() {
        const out = [];
        for (const id of this.listTeamIds()) {
            const result = this.tryReadTeam(id);
            if ('team' in result) {
                const team = result.team;
                out.push({
                    id: team.id,
                    name: team.name,
                    ...(team.description !== undefined ? { description: team.description } : {}),
                    model: team.model,
                    roleCount: team.roles.length,
                    chainCount: team.chains.length,
                    updatedAt: team.updatedAt,
                });
                continue;
            }
            out.push({
                id,
                name: id,
                model: { provider: '', model: '' },
                roleCount: 0,
                chainCount: 0,
                updatedAt: '',
                readonly: true,
                issue: result.issue,
            });
        }
        return out;
    }
    /** 保存团队（归一化 + 刷新 updatedAt + 原子写）。 */
    saveTeam(input) {
        const team = normalizeTeam(input);
        if (team.schemaVersion > TEAM_SCHEMA_VERSION) {
            throw new TeamError(`团队 ${team.id} 为只读（存储版本更高），拒绝写入`, 'team_version_ahead', 409);
        }
        const next = { ...team, schemaVersion: TEAM_SCHEMA_VERSION, updatedAt: new Date().toISOString() };
        writeJsonAtomic(this.teamPath(next.id), next);
        return next;
    }
    /** 新建团队：seed=true 用出厂编制，否则空白团队（只含主脑 + 一条空链）。 */
    createTeam(name, options = {}) {
        const id = options.id !== undefined && options.id !== '' ? options.id : this.allocTeamId(name);
        if (existsSync(this.teamPath(id))) {
            throw new TeamError(`团队 id 已存在：${id}`, 'team_exists', 409);
        }
        const team = options.seed === true ? buildDefaultTeam(id, name) : buildEmptyTeam(id, name);
        return this.saveTeam(team);
    }
    /** 复制团队（深拷贝 roles/chains/links，新 id）。 */
    duplicateTeam(sourceId, name) {
        const source = this.readTeam(sourceId);
        const nextName = name !== undefined && name.trim() !== '' ? name.trim() : `${source.name} 副本`;
        const id = this.allocTeamId(nextName);
        const now = new Date().toISOString();
        const copy = {
            ...JSON.parse(JSON.stringify(source)),
            id,
            name: nextName,
            createdAt: now,
            updatedAt: now,
        };
        return this.saveTeam(copy);
    }
    /** 删除团队；删掉 activeTeamId 时自动切到剩余的第一个。 */
    removeTeam(id) {
        const path = this.teamPath(id);
        if (!existsSync(path))
            throw new TeamError(`团队不存在：${id}`, 'team_not_found', 404);
        rmSync(path, { force: true });
        // 清掉所有会话对该团队的引用（会话级当前团队不再指向已删团队）。
        const all = this.readChatModes();
        let changed = false;
        for (const [sid, mode] of Object.entries(all)) {
            if (mode.teamId === id) {
                all[sid] = { ...mode, teamId: '' };
                changed = true;
            }
        }
        if (changed)
            writeJsonAtomic(this.chatModePath, all);
        const globals = this.readGlobals();
        if (globals.activeTeamId !== id)
            return { removed: id, activeTeamId: globals.activeTeamId };
        const rest = this.listTeamIds();
        const nextActive = rest.length > 0 ? rest[0] : '';
        this.writeGlobals({ ...globals, activeTeamId: nextActive });
        return { removed: id, activeTeamId: nextActive };
    }
    /** 恢复某团队为出厂编制（保留 id 与名称，覆盖角色/链/直连）。 */
    resetTeam(id) {
        const existing = this.tryReadTeam(id);
        const name = 'team' in existing ? existing.team.name : DEFAULT_TEAM_NAME;
        const model = 'team' in existing ? existing.team.model : { provider: '', model: '' };
        const fresh = buildDefaultTeam(id, name);
        return this.saveTeam({ ...fresh, model });
    }
    /** 由名称派生一个未被占用的团队 id。 */
    allocTeamId(name) {
        const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const base = ascii !== '' ? `t-${ascii}`.slice(0, 40) : `t-${Date.now().toString(36)}`;
        if (!existsSync(this.teamPath(base)))
            return base;
        for (let i = 2; i < 500; i += 1) {
            const candidate = `${base}-${i}`;
            if (!existsSync(this.teamPath(candidate)))
                return candidate;
        }
        return `t-${Date.now().toString(36)}`;
    }
    /** 解析「有效团队」：显式 id → activeTeamId → 第一个团队。 */
    resolveTeam(id) {
        if (id !== undefined && id !== '')
            return this.readTeam(id);
        const globals = this.readGlobals();
        if (globals.activeTeamId !== '') {
            const result = this.tryReadTeam(globals.activeTeamId);
            if ('team' in result)
                return result.team;
        }
        const ids = this.listTeamIds();
        for (const candidate of ids) {
            const result = this.tryReadTeam(candidate);
            if ('team' in result)
                return result.team;
        }
        throw new TeamError('尚无可用团队，请先在团队面板新建一个团队', 'no_team', 409);
    }
    // ── chat-mode（对话框团队开关）────────────────────────────────────────────
    /** 读全部会话开关表。 */
    readChatModes() {
        try {
            const raw = readJson(this.chatModePath);
            if (raw === null || typeof raw !== 'object')
                return {};
            const out = {};
            for (const [sessionId, value] of Object.entries(raw)) {
                if (sessionId === '')
                    continue;
                out[sessionId] = normalizeChatMode(value);
            }
            return out;
        }
        catch {
            return {};
        }
    }
    /** 读单会话开关（缺省=关闭）。 */
    readChatMode(sessionId) {
        if (sessionId === '')
            return { ...DEFAULT_CHAT_MODE };
        return this.readChatModes()[sessionId] ?? { ...DEFAULT_CHAT_MODE };
    }
    /** 写单会话开关（LRU 淘汰到 CHAT_MODE_MAX 条）。 */
    writeChatMode(sessionId, patch) {
        if (sessionId === '')
            throw new TeamError('缺少 sessionId', 'session_required', 400);
        const all = this.readChatModes();
        const next = normalizeChatMode({
            ...(all[sessionId] ?? DEFAULT_CHAT_MODE),
            ...patch,
            updatedAt: new Date().toISOString(),
        });
        all[sessionId] = next;
        const entries = Object.entries(all);
        if (entries.length > CHAT_MODE_MAX) {
            entries.sort((a, b) => (a[1].updatedAt < b[1].updatedAt ? 1 : -1));
            const kept = Object.fromEntries(entries.slice(0, CHAT_MODE_MAX));
            writeJsonAtomic(this.chatModePath, kept);
            return next;
        }
        writeJsonAtomic(this.chatModePath, all);
        return next;
    }
    // ── 会话级「当前团队」───────────────────────────────────────────────────────
    //
    // 每个会话有自己选中的当前团队（存 chat-mode.json 的 teamId），互不干扰；
    // globals.activeTeamId 降级为「默认值」：会话未选过团队时兜底（新会话继承）。
    /** 会话当前团队 id：会话级 teamId 优先，未选过时回退全局默认。 */
    sessionActiveTeamId(sessionId) {
        if (sessionId !== '') {
            const teamId = this.readChatMode(sessionId).teamId;
            if (teamId !== '' && existsSync(this.teamPath(teamId)))
                return teamId;
        }
        return this.readGlobals().activeTeamId;
    }
    /** 设置会话当前团队（仅写会话级，不动全局默认）。 */
    setSessionActiveTeam(sessionId, teamId) {
        this.writeChatMode(sessionId, { teamId });
    }
    /** 按会话解析有效团队：会话当前团队 → 全局默认 → 第一个可用。 */
    resolveTeamForSession(id, sessionId) {
        if (id !== undefined && id !== '')
            return this.readTeam(id);
        const sessionTeamId = this.sessionActiveTeamId(sessionId);
        if (sessionTeamId !== '') {
            const result = this.tryReadTeam(sessionTeamId);
            if ('team' in result)
                return result.team;
        }
        const ids = this.listTeamIds();
        for (const candidate of ids) {
            const result = this.tryReadTeam(candidate);
            if ('team' in result)
                return result.team;
        }
        throw new TeamError('尚无可用团队，请先在团队面板新建一个团队', 'no_team', 409);
    }
    // ── 运行 ──────────────────────────────────────────────────────────────────
    /** 某次运行的目录。 */
    runDir(runId) {
        return join(this.runsDir, safeSegment(runId, '运行 id'));
    }
    /** 某次运行的 run.json 路径。 */
    runPath(runId) {
        return join(this.runDir(runId), 'run.json');
    }
    /** 分配一个运行 id。 */
    allocRunId() {
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
        const rand = Math.random().toString(36).slice(2, 8);
        return `R-${stamp}-${rand}`;
    }
    /** 原子写 run.json（每步状态变化调用一次）。 */
    saveRun(run) {
        mkdirSync(join(this.runDir(run.id), 'steps'), { recursive: true });
        writeJsonAtomic(this.runPath(run.id), run);
    }
    /** 读 run.json；不存在/损坏返回 null。 */
    readRun(runId) {
        try {
            const raw = readJson(this.runPath(runId));
            if (raw === null || typeof raw !== 'object')
                return null;
            return raw;
        }
        catch {
            return null;
        }
    }
    /** 运行 id 列表（新→旧）。 */
    listRunIds() {
        try {
            return readdirSync(this.runsDir, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && entry.name.startsWith('R-'))
                .map(entry => entry.name)
                .sort()
                .reverse();
        }
        catch {
            return [];
        }
    }
    /** 运行清单（可按团队/会话过滤）。 */
    listRuns(options = {}) {
        const limit = options.limit ?? 50;
        const out = [];
        for (const id of this.listRunIds()) {
            if (out.length >= limit)
                break;
            const run = this.readRun(id);
            if (run === null)
                continue;
            if (options.teamId !== undefined && options.teamId !== '' && run.teamId !== options.teamId)
                continue;
            if (options.sessionId !== undefined && options.sessionId !== '' && run.sessionId !== options.sessionId)
                continue;
            out.push(summarizeRun(run));
        }
        return out;
    }
    /** 某会话的活跃运行（queued / running），新→旧。 */
    activeRuns(sessionId) {
        const out = [];
        // 活跃运行必然是最近创建的，只扫最近 30 个目录即可。
        for (const id of this.listRunIds().slice(0, 30)) {
            const run = this.readRun(id);
            if (run === null)
                continue;
            if (run.status !== 'queued' && run.status !== 'running')
                continue;
            if (sessionId !== '' && run.sessionId !== sessionId)
                continue;
            out.push(run);
        }
        return out;
    }
    /** 写单步完整输出，返回文件名。 */
    writeStepOutput(runId, index, roleId, content) {
        const name = `${String(index).padStart(2, '0')}-${safeSegment(roleId, '角色 id')}.md`;
        const dir = join(this.runDir(runId), 'steps');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, name), content, 'utf-8');
        return name;
    }
    /** 读单步完整输出。 */
    readStepOutput(runId, name) {
        const file = join(this.runDir(runId), 'steps', safeSegment(name, '产物文件名'));
        return readFileSync(file, 'utf-8');
    }
    /** 写最终交付物，返回文件名。 */
    writeFinal(runId, content) {
        const name = 'final-deliverable.md';
        mkdirSync(this.runDir(runId), { recursive: true });
        writeFileSync(join(this.runDir(runId), name), content, 'utf-8');
        return name;
    }
    /** 读最终交付物。 */
    readFinal(runId) {
        return readFileSync(join(this.runDir(runId), 'final-deliverable.md'), 'utf-8');
    }
    /** 删除一次运行（含目录）。 */
    removeRun(runId) {
        rmSync(this.runDir(runId), { recursive: true, force: true });
    }
    /** 修剪历史：保留最近 RUNS_KEEP 个运行目录。 */
    trimRuns() {
        const ids = this.listRunIds();
        for (const id of ids.slice(RUNS_KEEP)) {
            try {
                this.removeRun(id);
            }
            catch { /* ignore */ }
        }
    }
    /**
     * 启动时把上次进程遗留的「未完结」运行标记为 interrupted，
     * 避免 HUD 永远显示一个假的运行中。
     */
    markInterruptedOnBoot() {
        let count = 0;
        for (const id of this.listRunIds().slice(0, 50)) {
            const run = this.readRun(id);
            if (run === null)
                continue;
            if (run.status !== 'running' && run.status !== 'queued')
                continue;
            const next = {
                ...run,
                status: 'interrupted',
                finishedAt: new Date().toISOString(),
                error: '服务重启，运行被中断',
                steps: run.steps.map(step => (step.status === 'running' || step.status === 'pending'
                    ? { ...step, status: 'skipped' }
                    : step)),
            };
            try {
                this.saveRun(next);
                count += 1;
            }
            catch { /* ignore */ }
        }
        return count;
    }
}
/** Run → 清单项投影。 */
export function summarizeRun(run) {
    const doneSteps = run.steps.filter(step => step.status === 'done').length;
    return {
        id: run.id,
        teamId: run.teamId,
        teamName: run.teamName,
        chainName: run.chainName,
        task: run.task,
        status: run.status,
        origin: run.origin,
        ...(run.sessionId !== undefined && run.sessionId !== '' ? { sessionId: run.sessionId } : {}),
        startedAt: run.startedAt,
        ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
        doneSteps,
        totalSteps: run.steps.length,
    };
}
//# sourceMappingURL=store.js.map