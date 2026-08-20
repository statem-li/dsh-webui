/**
 * dsh-memory HTTP API（loopback-only）：/api/dsh-memory/*。
 * 面板数据 + 裁决操作（保留/删除/改标签/移项目/置顶/手动归属）。
 * 与 skill-manager 同款 webServer 路由模式；前缀 /api/dsh-memory 不与其它插件冲突。
 */
import { URL } from 'node:url';
import { compileAll } from './engine/compile.js';
import { localDate, mergeTags, nowIso, projectHashOf, entryIdOf, summarize } from './engine/store.js';
const ROUTE_PREFIX = '/api/dsh-memory';
function toView(entry) {
    return {
        id: entry.id,
        content: entry.content,
        scope: entry.scope,
        projectHash: entry.projectHash,
        tags: entry.tags,
        pinned: entry.pinned,
        importance: entry.importance,
        layer: entry.layer,
        source: entry.source,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
    };
}
/** 挂载全部路由。 */
export function mountMemoryRoutes(ctx, store, config) {
    return ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => {
            void handle(ctx, store, config, req, res);
        },
    });
}
async function handle(ctx, store, config, req, res) {
    if (!loopbackAllowed(req)) {
        json(res, 403, { error: 'loopback-only' });
        return;
    }
    let url;
    let rest;
    let method;
    try {
        url = new URL(req.url ?? '/', 'http://localhost');
        rest = url.pathname.slice(ROUTE_PREFIX.length);
        method = req.method ?? 'GET';
    }
    catch {
        json(res, 400, { error: 'invalid request url' });
        return;
    }
    // API 诊断日志：请求到达与完成时间（排查面板「读取中」= 请求未达 vs host 未响应）。
    const apiStarted = Date.now();
    void store.appendExtractLog(`api ${method} ${rest} start`).catch(() => undefined);
    try {
        // ── 查询 ──────────────────────────────────────────────────────────
        if (method === 'GET' && rest === '/list') {
            json(res, 200, await listView(store, url.searchParams));
            return;
        }
        if (method === 'GET' && rest === '/projects') {
            const entries = await store.readEntries();
            json(res, 200, { projects: await mergeWorkspaces(store, await store.listProjects(entries)) });
            return;
        }
        if (method === 'GET' && rest === '/tags') {
            const entries = await store.readEntries();
            const counts = new Map();
            for (const entry of entries) {
                for (const tag of entry.tags)
                    counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
            json(res, 200, { tags: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })) });
            return;
        }
        if (method === 'GET' && rest === '/changes') {
            const date = url.searchParams.get('date') ?? localDate();
            json(res, 200, { date, changes: await store.readChanges(date) });
            return;
        }
        if (method === 'GET' && rest === '/summary') {
            const entries = await store.readEntries();
            const today = localDate();
            json(res, 200, {
                today,
                entryCount: entries.length,
                projectCount: (await store.listProjects(entries)).length,
                todayChanges: (await store.readChanges(today)).length,
            });
            return;
        }
        // ── 记忆注入开关（按会话） ────────────────────────────────────────
        if (method === 'GET' && rest === '/inject-state') {
            const sessionId = url.searchParams.get('sessionId') ?? '';
            json(res, 200, { enabled: await store.isInjectEnabled(sessionId) });
            return;
        }
        if (method === 'POST' && rest === '/inject-state') {
            const body = await readBody(req);
            const sessionId = requireString(body.sessionId, 'sessionId');
            const enabled = body.enabled !== false;
            await store.setInjectEnabled(sessionId, enabled);
            json(res, 200, { ok: true, enabled });
            return;
        }
        // ── 裁决操作 ──────────────────────────────────────────────────────
        if (method === 'POST' && rest === '/pin') {
            const body = await readBody(req);
            const entryId = requireString(body.entryId, 'entryId');
            const pinned = body.pinned !== false;
            const entry = await store.patchEntry(entryId, { pinned });
            if (entry === undefined)
                throw new Error(`记忆不存在：${entryId}`);
            json(res, 200, { ok: true, entry: toView(entry) });
            return;
        }
        if (method === 'POST' && rest === '/update') {
            const body = await readBody(req);
            const entryId = requireString(body.entryId, 'entryId');
            const patch = {};
            if (typeof body.content === 'string' && body.content.trim() !== '') {
                patch.content = body.content.trim();
            }
            if (Array.isArray(body.tags)) {
                patch.tags = body.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8);
            }
            const before = await store.getEntry(entryId);
            const entry = await store.patchEntry(entryId, patch);
            if (entry === undefined)
                throw new Error(`记忆不存在：${entryId}`);
            await store.appendChange({
                action: 'update',
                entryId: entry.id,
                scope: entry.scope,
                projectHash: entry.projectHash,
                summary: summarize(entry.content),
                before: before?.content,
                after: entry.content,
            });
            json(res, 200, { ok: true, entry: toView(entry) });
            return;
        }
        if (method === 'POST' && rest === '/move') {
            const body = await readBody(req);
            const entryId = requireString(body.entryId, 'entryId');
            const existing = await store.getEntry(entryId);
            if (existing === undefined)
                throw new Error(`记忆不存在：${entryId}`);
            let scope = existing.scope;
            let projectHash = existing.projectHash;
            if (body.scope === 'global') {
                scope = 'global';
                projectHash = null;
            }
            else if (body.scope === 'project') {
                scope = 'project';
                projectHash = typeof body.projectHash === 'string' && body.projectHash !== ''
                    ? body.projectHash
                    : existing.projectHash;
                if (projectHash === null)
                    throw new Error('移入项目需要 projectHash');
                // 目标项目无 meta 时自动创建占位（手动归属）。
                const meta = await store.readProjectMeta(projectHash);
                if (meta === undefined) {
                    await store.writeProjectMeta(projectHash, {
                        path: typeof body.path === 'string' && body.path !== '' ? body.path : '手动归属',
                        alias: null,
                        locked: true,
                    });
                }
            }
            const entry = await store.patchEntry(entryId, { scope, projectHash });
            if (entry === undefined)
                throw new Error(`记忆不存在：${entryId}`);
            await store.appendChange({
                action: 'update',
                entryId: entry.id,
                scope: entry.scope,
                projectHash: entry.projectHash,
                summary: `移项目：${summarize(entry.content)}`,
                before: existing.content,
                after: entry.content,
            });
            await compileAll(store, config);
            json(res, 200, { ok: true, entry: toView(entry) });
            return;
        }
        if (method === 'POST' && rest === '/delete') {
            const body = await readBody(req);
            const entryId = requireString(body.entryId, 'entryId');
            const existing = await store.getEntry(entryId);
            // 幂等删除：条目已不存在时也返回 ok（面板旧数据/幽灵条目删除不再报错）。
            if (existing === undefined) {
                json(res, 200, { ok: true, alreadyGone: true });
                return;
            }
            const ok = await store.removeEntry(entryId);
            if (!ok) {
                json(res, 200, { ok: true, alreadyGone: true });
                return;
            }
            await store.appendChange({
                action: 'delete',
                entryId,
                scope: existing.scope,
                projectHash: existing.projectHash,
                summary: `删除：${summarize(existing.content)}`,
            });
            await compileAll(store, config);
            json(res, 200, { ok: true });
            return;
        }
        if (method === 'POST' && rest === '/meta') {
            const body = await readBody(req);
            const hash = requireString(body.projectHash, 'projectHash');
            const meta = await store.readProjectMeta(hash);
            const next = {
                path: meta?.path ?? (typeof body.path === 'string' && body.path !== '' ? body.path : '手动归属'),
                alias: typeof body.alias === 'string' && body.alias !== '' ? body.alias.slice(0, 64) : (meta?.alias ?? null),
                locked: typeof body.locked === 'boolean' ? body.locked : (meta?.locked ?? true),
                autoMemory: typeof body.autoMemory === 'boolean' ? body.autoMemory : (meta?.autoMemory ?? true),
            };
            await store.writeProjectMeta(hash, next);
            json(res, 200, { ok: true, meta: { ...next, hash } });
            return;
        }
        if (method === 'POST' && rest === '/delete-project') {
            // 按项目清空全部记忆（仅项目层；全局层不动）。
            // 置顶记忆是用户明确标记的重要条目，批量清空时跳过，避免误删。
            const body = await readBody(req);
            const projectHash = requireString(body.projectHash, 'projectHash');
            const removed = await store.mutateEntries(entries => {
                const targets = entries.filter(entry => entry.scope === 'project' && entry.projectHash === projectHash && !entry.pinned);
                for (const target of targets) {
                    entries.splice(entries.indexOf(target), 1);
                }
                return targets;
            });
            for (const entry of removed) {
                await store.appendChange({
                    action: 'delete',
                    entryId: entry.id,
                    scope: entry.scope,
                    projectHash: entry.projectHash,
                    summary: `清空项目：${summarize(entry.content)}`,
                });
            }
            await compileAll(store, config);
            json(res, 200, { ok: true, deleted: removed.length });
            return;
        }
        if (method === 'POST' && rest === '/remember') {
            // 手动添加记忆（面板「添加」）：内容/范围/标签/置顶/重要性。
            const body = await readBody(req);
            const content = typeof body.content === 'string' ? body.content.trim() : '';
            if (content === '')
                throw new Error('content 不能为空');
            const scope = body.scope === 'global' ? 'global' : 'project';
            const projectHash = scope === 'project'
                ? (typeof body.projectHash === 'string' && body.projectHash !== '' ? body.projectHash : null)
                : null;
            if (scope === 'project' && projectHash === null) {
                throw new Error('项目层记忆需要 projectHash（当前无工作区，请用全局或指定项目）');
            }
            const tags = Array.isArray(body.tags)
                ? body.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
                : [];
            const importance = typeof body.importance === 'number' && Number.isFinite(body.importance)
                ? Math.max(1, Math.min(10, Math.round(body.importance))) : 8;
            const pinned = body.pinned === true;
            // 项目层首次落盘时确保 meta 存在。
            if (scope === 'project' && projectHash !== null) {
                const meta = await store.readProjectMeta(projectHash);
                if (meta === undefined) {
                    await store.writeProjectMeta(projectHash, {
                        path: typeof body.path === 'string' && body.path !== '' ? body.path : '手动归属',
                        alias: null,
                        locked: false,
                    });
                }
            }
            const beforeEntry = await store.getEntry(entryIdOf(content, scope, scope === 'project' ? projectHash : null));
            const { created, entry } = await store.upsertEntry({
                content,
                scope,
                projectHash: scope === 'project' ? projectHash : null,
                tags,
                importance,
                pinned,
                source: 'manual',
            });
            await store.appendChange({
                action: created ? 'add' : 'update',
                entryId: entry.id,
                scope: entry.scope,
                projectHash: entry.projectHash,
                summary: summarize(entry.content),
                before: beforeEntry?.content,
                after: entry.content,
            });
            await compileAll(store, config);
            json(res, 200, { ok: true, created, entry: toView(entry) });
            return;
        }
        json(res, 404, { error: `no route for ${method} ${rest}` });
    }
    catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    finally {
        void store.appendExtractLog(`api ${method} ${rest} done ${Date.now() - apiStarted}ms`).catch(() => undefined);
    }
}
/** 面板列表视图（scope/项目/搜索/标签过滤）。 */
async function listView(store, params) {
    const entries = await store.readEntries();
    const scope = params.get('scope');
    const project = params.get('project');
    const q = params.get('q')?.trim().toLowerCase() ?? '';
    const tag = params.get('tag');
    const views = entries
        .filter(entry => {
        if (scope === 'global' && entry.scope !== 'global')
            return false;
        if (scope === 'project' && entry.scope !== 'project')
            return false;
        if (project !== null && project !== '' && entry.projectHash !== project)
            return false;
        if (q !== '') {
            const haystack = `${entry.content} ${entry.tags.join(' ')}`.toLowerCase();
            if (!q.split(/\s+/).every(term => haystack.includes(term)))
                return false;
        }
        if (tag !== null && tag !== '' && !entry.tags.includes(tag))
            return false;
        return true;
    })
        .sort((a, b) => {
        if (a.pinned !== b.pinned)
            return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
    })
        .map(toView);
    return { entries: views, projects: await mergeWorkspaces(store, await store.listProjects(entries)) };
}
/**
 * 合并 DSH 工作区注册表：尚无记忆的新工作区也出现在项目列表（entryCount 0），
 * 让「刚建的工作区」在记忆面板立即可见（无需等第一条记忆写入）。
 */
async function mergeWorkspaces(store, projects) {
    const known = new Set(projects.map(project => project.hash));
    for (const workspace of await store.listDshWorkspaces()) {
        const hash = projectHashOf(workspace.path);
        if (!known.has(hash)) {
            projects.push({
                hash,
                path: workspace.path,
                alias: workspace.title,
                locked: false,
                autoMemory: true,
                entryCount: 0,
                pinnedCount: 0,
            });
            known.add(hash);
        }
    }
    projects.sort((a, b) => a.path.localeCompare(b.path));
    return projects;
}
// ── HTTP plumbing（skill-manager 同款） ────────────────────────────────
function isLoopbackAddress(address) {
    if (typeof address !== 'string')
        return false;
    const a = address.toLowerCase();
    if (a === '::1')
        return true;
    const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a;
    const octets = ipv4.split('.');
    return octets.length === 4 && octets[0] === '127'
        && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function hostNameOf(value) {
    if (typeof value !== 'string')
        return null;
    const host = value.trim().toLowerCase();
    if (host.startsWith('[')) {
        const close = host.indexOf(']');
        if (close <= 1)
            return null;
        const suffix = host.slice(close + 1);
        if (suffix !== '' && !/^:\d+$/.test(suffix))
            return null;
        return host.slice(1, close);
    }
    const firstColon = host.indexOf(':');
    const lastColon = host.lastIndexOf(':');
    if (firstColon !== lastColon)
        return null;
    return firstColon === -1 ? host : host.slice(0, firstColon);
}
function loopbackAllowed(req) {
    if (!isLoopbackAddress(req.socket.remoteAddress))
        return false;
    const host = hostNameOf(req.headers.host);
    if (host === null)
        return false;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function json(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
    });
    res.end(body);
}
function readBody(req) {
    return new Promise((resolvePromise, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 4 * 1024 * 1024) {
                reject(new Error('request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) {
                resolvePromise({});
                return;
            }
            try {
                resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch (error) {
                reject(error instanceof Error ? error : new Error('invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}
function requireString(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${name} 不能为空`);
    }
    return value.trim();
}
/** 供其它模块使用的工具函数（变更时间）。 */
export function apiNow() {
    return nowIso();
}
/** mergeTags 复用导出（tools.ts 已用本地实现，此处仅为 API 一致性保留）。 */
export { mergeTags };
//# sourceMappingURL=api.js.map