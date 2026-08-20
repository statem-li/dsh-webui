/**
 * 工作区目录选择器 host 半身：挂 /api/webui-dir-picker 路由，提供应用内目录
 * 浏览（list / create）。与官方 browse 后端同语义（fully-qualified 校验、
 * 名称排序、hidden 标记、truncated 界限），但完全自包含于 webui 插件：
 * 不依赖官方 directory-picker 能力面（当前 profile 为 native 能力时
 * host.listDirectory 不可用），弹窗数据一律走本路由。
 *
 * Routes (all under /api/webui-dir-picker, loopback-only):
 *   GET  /list?path=<abs>   → { path, home, crumbs, entries, truncated }
 *   POST /create {path,name} → { path }
 *   GET  /drives            → { drives: [{ name, path }] }（本机盘符/根）
 */
import { existsSync } from 'node:fs';
import { mkdir, opendir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, resolve, win32 } from 'node:path';
/** ── 常量 ─────────────────────────────────────────────────────────────── */
const ROUTE_PREFIX = '/api/webui-dir-picker';
/** 完整结果界限：一个层级最多返回这么多子目录行（hidden 行也计数）。 */
const MAX_ENTRIES = 1000;
/** 写请求体上限（JSON 转义后的名称很小，留足余量）。 */
const MAX_BODY_BYTES = 1 * 1024 * 1024;
class DirPickerError extends Error {
    code;
    path;
    constructor(code, path, message) {
        super(message);
        this.code = code;
        this.path = path;
        this.name = 'DirPickerError';
    }
}
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'HttpError';
    }
}
/** ── Loopback fence（与 file-explorer 同契约）────────────────────────── */
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
/** ── HTTP plumbing ────────────────────────────────────────────────────── */
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
            if (size > MAX_BODY_BYTES) {
                reject(new HttpError(413, 'request body too large'));
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
            catch {
                reject(new HttpError(400, 'invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}
/** ── 路径与目录浏览（镜像官方 browse 后端语义）──────────────────────── */
/** 绝对路径必须完全限定（win32: 盘符/UNC；POSIX: 以 / 开头），绝不静默 rebase。 */
function fullyQualified(path, platform = process.platform) {
    return platform === 'win32'
        ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
        : posix.isAbsolute(path);
}
/** 祖先链（根到目标 inclusive）——面包屑行，每行都是跳转目标。 */
function ancestryCrumbs(target) {
    const crumbs = [];
    let current = target;
    for (;;) {
        const parent = dirname(current);
        crumbs.unshift({ name: parent === current ? current : basename(current), path: current, hidden: false });
        if (parent === current)
            return crumbs;
        current = parent;
    }
}
/** 把候选插入名称升序窗口，超界弹出最大名（内存 O(keep)）。 */
function boundedInsert(window, candidate, keep) {
    if (window.length === keep && candidate.name.localeCompare(window[window.length - 1].name) >= 0)
        return true;
    let lo = 0;
    let hi = window.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (candidate.name.localeCompare(window[mid].name) < 0)
            hi = mid;
        else
            lo = mid + 1;
    }
    window.splice(lo, 0, candidate);
    if (window.length <= keep)
        return false;
    window.pop();
    return true;
}
/** 跟随符号链接探测可进入性；坏链/循环链静默跳过。 */
async function directoryRow(parent, name, isDirectory, isSymbolicLink) {
    const path = join(parent, name);
    let enterable = isDirectory;
    if (!enterable && isSymbolicLink) {
        try {
            enterable = (await stat(path)).isDirectory();
        }
        catch {
            return null;
        }
    }
    if (!enterable)
        return null;
    return { name, path, hidden: name.startsWith('.') };
}
/** 列出一个目录层级（缺省 path = home）；entries 仅含可进入的子目录。 */
async function listLevel(path) {
    const home = homedir();
    if (path !== undefined && !fullyQualified(path)) {
        throw new DirPickerError('directory-unreadable', path, `cannot list "${path}": not a fully qualified path`);
    }
    const target = resolve(path ?? home);
    const keep = MAX_ENTRIES + 1;
    const window = [];
    let evicted = false;
    try {
        const level = await opendir(target);
        try {
            for (;;) {
                const dirent = await level.read();
                if (dirent === null)
                    break;
                if (!dirent.isDirectory() && !dirent.isSymbolicLink())
                    continue;
                const candidate = { name: dirent.name, isDirectory: dirent.isDirectory(), isSymbolicLink: dirent.isSymbolicLink() };
                if (boundedInsert(window, candidate, keep))
                    evicted = true;
            }
        }
        finally {
            await level.close();
        }
    }
    catch (error) {
        throw new DirPickerError('directory-unreadable', target, `cannot list ${target}: ${messageOf(error)}`);
    }
    const entries = [];
    let truncated = evicted;
    for (const candidate of window) {
        const row = await directoryRow(target, candidate.name, candidate.isDirectory, candidate.isSymbolicLink);
        if (row === null)
            continue;
        if (entries.length === MAX_ENTRIES) {
            truncated = true;
            break;
        }
        entries.push(row);
    }
    return { path: target, home, crumbs: ancestryCrumbs(target), entries, truncated };
}
/** 在既有父目录下新建一个子目录（单段名，非递归）。 */
async function createChild(path, name) {
    if (!fullyQualified(path)) {
        throw new DirPickerError('directory-create-failed', path, `cannot create under "${path}": not a fully qualified parent path`);
    }
    const parent = resolve(path);
    if (name.trim() === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
        throw new DirPickerError('directory-create-failed', join(parent, name), `"${name}" is not a single path segment`);
    }
    const target = join(parent, name);
    try {
        await mkdir(target);
        return target;
    }
    catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
            throw new DirPickerError('directory-exists', target, `${target} already exists`);
        }
        throw new DirPickerError('directory-create-failed', target, `cannot create ${target}: ${messageOf(error)}`);
    }
}
/** 未知抛出的消息文本。 */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * 本机可选的顶层目录（盘符）：Windows 枚举存在盘符，POSIX 只有根。
 * 返回绝对路径（Windows 为 `X:\` 形式），供弹窗切换盘符。
 */
export function listDrives() {
    if (process.platform !== 'win32') {
        return [{ name: '/', path: '/' }];
    }
    const drives = [];
    for (let code = 65; code <= 90; code++) {
        const letter = String.fromCharCode(code);
        const root = `${letter}:\\`;
        try {
            if (existsSync(root))
                drives.push({ name: root, path: root });
        }
        catch {
            // 单个盘符探测失败（权限/网络盘），跳过。
        }
    }
    return drives;
}
/** ── Dispatch ─────────────────────────────────────────────────────────── */
async function handle(ctx, req, res) {
    if (!loopbackAllowed(req)) {
        json(res, 403, { error: 'loopback-only' });
        return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const rest = url.pathname.slice(ROUTE_PREFIX.length);
    const method = req.method ?? 'GET';
    try {
        if (method === 'GET' && (rest === '' || rest === '/list')) {
            const raw = url.searchParams.get('path');
            json(res, 200, await listLevel(typeof raw === 'string' && raw !== '' ? raw : undefined));
            return;
        }
        if (method === 'POST' && rest === '/create') {
            const body = (await readBody(req));
            if (typeof body.path !== 'string' || typeof body.name !== 'string') {
                throw new HttpError(400, 'path and name are required');
            }
            json(res, 200, { path: await createChild(body.path, body.name) });
            return;
        }
        if (method === 'GET' && rest === '/drives') {
            json(res, 200, { drives: listDrives() });
            return;
        }
        json(res, 404, { error: `no route for ${method} ${rest}` });
    }
    catch (error) {
        if (error instanceof DirPickerError) {
            json(res, 400, { error: error.message, code: error.code });
            return;
        }
        if (error instanceof HttpError) {
            json(res, error.status, { error: error.message });
            return;
        }
        json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
}
/** 挂载 /api/webui-dir-picker 路由（webui 组合调用）。 */
export function applyWorkspaceDirPicker(ctx) {
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => {
            void handle(ctx, req, res);
        },
    }), 'webui: workspace dir-picker routes');
}
//# sourceMappingURL=workspace-dir-picker.js.map