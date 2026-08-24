/**
 * webui — 对话截图（host 半身，重做版）。
 *
 * 数据流：消息操作栏相机按钮 → 面板选范围/主题/宽度 → POST /render（渲染，
 * 结果只进内存缓存，不落盘）→ 面板里看预览 → POST /save 才写文件到
 * ~/.dsh/storages/webui-screenshot，POST /reveal 在文件管理器里定位。
 *
 * 与旧实现的差异：
 *  - 渲染走常驻无头浏览器（renderer.ts），不再每张图冷启动一个 Edge/Chrome；
 *  - 支持多条消息（单条回复 / 一轮问答 / 整段会话）与三档宽度；
 *  - 预览不落盘：不保存就不会在 storages 里堆垃圾。
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { buildCardHtml, deriveTitle } from './card.js';
import { shotAspectRatio, shotPreset } from './presets.js';
import { configureRenderer, renderPng, shutdownRenderer } from './renderer.js';
import { canvasPad, canvasPadY } from './theme.js';
const ROUTE = '/api/webui-screenshot';
/** 单次请求最多渲染的消息条数（整段会话截图的上限）。 */
const MAX_MESSAGES = 60;
/** 请求体上限（8MB：整段会话的文本可能不小）。 */
const MAX_BODY = 8 * 1024 * 1024;
/** 预览缓存条数（LRU 淘汰最旧）。 */
const CACHE_LIMIT = 8;
/** 截图保存目录。 */
export function screenshotHome() {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(dshHome, 'storages', 'webui-screenshot');
}
/** 渲染引擎工作目录（profile + 临时页面，与成品图分开）。 */
function engineHome() {
    return join(screenshotHome(), '.engine');
}
const cache = new Map();
/** 写入缓存并淘汰最旧条目。 */
function cachePut(id, entry) {
    cache.set(id, entry);
    while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (oldest.done === true)
            break;
        cache.delete(oldest.value);
    }
}
/** 读 PNG 头部的像素宽高（IHDR 固定在第 16~24 字节）。 */
function pngSize(png) {
    if (png.length < 24)
        return { width: 0, height: 0 };
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
// ── HTTP 工具 ───────────────────────────────────────────────────────────────
function json(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(JSON.stringify(value));
}
function readBody(req) {
    return new Promise((resolvePromise, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error('请求体过大'));
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
                reject(new Error('请求体不是合法 JSON'));
            }
        });
        req.on('error', reject);
    });
}
/** 规整请求里的消息数组（丢弃空文本与非法角色，超量截断）。 */
function parseMessages(input) {
    if (!Array.isArray(input))
        return [];
    const out = [];
    for (const item of input) {
        if (item === null || typeof item !== 'object')
            continue;
        const record = item;
        const role = record.role === 'user' || record.role === 'assistant' ? record.role : null;
        const text = typeof record.text === 'string' ? record.text : '';
        if (role === null || text.trim() === '')
            continue;
        out.push({ role, text });
        if (out.length >= MAX_MESSAGES)
            break;
    }
    return out;
}
/** 规整主题（未知值回退浅色）。 */
function parseTheme(input) {
    return input === 'dark' || input === 'glass' || input === 'glass-dark' ? input : 'light';
}
/** 文件名安全化（用标题做文件名，去掉路径与非法字符）。 */
function safeFileName(title) {
    const cleaned = title
        .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 48);
    return cleaned === '' ? 'screenshot' : cleaned;
}
// ── 路由处理 ────────────────────────────────────────────────────────────────
/** POST /render：渲染并放入预览缓存（不落盘）。 */
async function handleRender(req, res) {
    let body;
    try {
        body = await readBody(req);
    }
    catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
    }
    const messages = parseMessages(body.messages);
    if (messages.length === 0) {
        json(res, 400, { ok: false, error: '没有可截图的消息内容' });
        return;
    }
    const theme = parseTheme(body.theme);
    // 「设备 × 画质」决定 CSS 宽度、输出缩放与最小高度；视口宽度还要加上
    // 卡片两侧的画布留白（与主题 CSS 的 outer padding 保持一致）。
    const preset = shotPreset(body.device, body.quality);
    const viewportWidth = preset.cssWidth + canvasPad(preset.cssWidth) * 2;
    // 固定画幅（16:9 等）：目标视口高 = 视口宽 / 比例；卡片 min-height 同步
    // 反推（扣除画布上下留白），短内容时由背景精确补满比例。内容更高时渲染
    // 器会自动加高成长图——保内容完整优先于死守比例，aspectLocked 会告知前端。
    const ratio = shotAspectRatio(body.aspect);
    const padY = ratio !== null ? canvasPadY(preset.cssWidth) : null;
    const targetHeight = ratio !== null ? Math.round(viewportWidth / ratio) : preset.minHeight;
    const cardMinHeight = padY !== null
        ? Math.max(120, targetHeight - padY.top - padY.bottom)
        : preset.minHeight;
    const title = typeof body.title === 'string' && body.title.trim() !== ''
        ? body.title.trim()
        : deriveTitle(messages[0].text, messages[0].role);
    const label = typeof body.label === 'string' ? body.label : '';
    try {
        const html = await buildCardHtml({ messages, theme, width: preset.cssWidth, minHeight: cardMinHeight, title, label });
        const base64 = await renderPng({ html, width: viewportWidth, height: targetHeight, scale: preset.scale });
        const png = Buffer.from(base64, 'base64');
        const size = pngSize(png);
        const id = `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        cachePut(id, { png, ...size, title, at: Date.now() });
        json(res, 200, {
            ok: true,
            id,
            imageUrl: `${ROUTE}/image?id=${encodeURIComponent(id)}`,
            bytes: png.length,
            aspectLocked: size.height === targetHeight * preset.scale,
            ...size,
        });
    }
    catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
}
/** POST /save：把缓存里的预览写到 storages 目录。 */
async function handleSave(req, res) {
    let body;
    try {
        body = await readBody(req);
    }
    catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
    }
    const id = typeof body.id === 'string' ? body.id : '';
    const entry = cache.get(id);
    if (entry === undefined) {
        json(res, 404, { ok: false, error: '预览已过期，请重新渲染' });
        return;
    }
    try {
        const dir = screenshotHome();
        await mkdir(dir, { recursive: true });
        const stamp = new Date(entry.at).toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const file = join(dir, `${stamp}_${safeFileName(entry.title)}.png`);
        await writeFile(file, entry.png);
        json(res, 200, { ok: true, path: file, dir });
    }
    catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
}
/** POST /reveal：在系统文件管理器里定位截图目录（win/mac/linux）。 */
async function handleReveal(res) {
    const dir = screenshotHome();
    try {
        await mkdir(dir, { recursive: true });
        const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        spawn(command, [dir], { detached: true, stdio: 'ignore' }).unref();
        json(res, 200, { ok: true, dir });
    }
    catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
}
/** GET /image：回读预览（?id=）或已保存文件（?file=）。 */
async function handleImage(req, res) {
    try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const id = url.searchParams.get('id') ?? '';
        if (id !== '') {
            const entry = cache.get(id);
            if (entry === undefined) {
                json(res, 404, { ok: false, error: '预览已过期' });
                return;
            }
            res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
            res.end(entry.png);
            return;
        }
        const file = url.searchParams.get('file') ?? '';
        const base = basename(file);
        if (base !== file || base === '') {
            json(res, 400, { ok: false, error: '文件名非法' });
            return;
        }
        const filePath = join(screenshotHome(), base);
        if (!existsSync(filePath)) {
            json(res, 404, { ok: false, error: '截图不存在' });
            return;
        }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(await readFile(filePath));
    }
    catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
}
// ── 插件体 ──────────────────────────────────────────────────────────────────
/**
 * 挂载对话截图路由。
 * @param ctx - 插件上下文（需要 webServer 服务）。
 */
export function applyScreenshot(ctx) {
    const webServer = ctx.get('webServer');
    if (webServer === undefined)
        return;
    configureRenderer(engineHome);
    ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: (req, res) => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const tail = url.pathname.slice(ROUTE.length);
            if (req.method === 'POST' && (tail === '/render' || tail === '' || tail === '/')) {
                void handleRender(req, res);
                return;
            }
            if (req.method === 'POST' && tail === '/save') {
                void handleSave(req, res);
                return;
            }
            if (req.method === 'POST' && tail === '/reveal') {
                void handleReveal(res);
                return;
            }
            if (req.method === 'GET' && tail === '/image') {
                void handleImage(req, res);
                return;
            }
            json(res, 404, { ok: false, error: '未知的截图接口' });
        },
    }), 'webui: screenshot routes');
    // 插件卸载/重载时关掉常驻渲染实例，别留孤儿进程。
    ctx.effect(() => () => { void shutdownRenderer(); }, 'webui: screenshot renderer shutdown');
}
//# sourceMappingURL=index.js.map