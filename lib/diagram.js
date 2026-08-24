/**
 * webui — 图表渲染支撑（host 半身）。
 *
 * 对话流里的 ```mermaid 围栏由 client 端 diagram.tsx 渲染，mermaid 引擎本体
 * **不进 client bundle**（3.4MB 未压缩），而是作为插件静态资源按需下发：
 *
 *  - GET /dyn-assets/vendor/mermaid.min.js
 *    直接回 assets/vendor/mermaid.min.js.gz（预压缩 ~0.95MB），带
 *    content-encoding: gzip 与 immutable 强缓存。浏览器只在**首次遇到 mermaid
 *    围栏**时拉一次，之后走 HTTP 缓存；没有图表的会话零下载、零解析、零内存。
 *  - GET/POST /api/webui-diagram → { ok, available, version, promptHint }。
 *
 * 另注册一段极短的 systemPrompt（diagram-hint，约 100 token，可关）告知模型
 * 「复杂结构可用 mermaid 围栏作图」——不注入模型不知道本端能渲染，会继续用
 * 纯文字描述流程。开关：settings 命名空间 webui-diagram。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
const VENDOR_DIR = join(PKG_DIR, 'assets', 'vendor');
const MERMAID_GZ = join(VENDOR_DIR, 'mermaid.min.js.gz');
const VERSION_FILE = join(VENDOR_DIR, 'mermaid.version.txt');
/** 注入的作图提示（尽量短：只讲「什么时候画」与「怎么画」）。 */
const DIAGRAM_HINT = [
    '【结构可视化】本端会把 mermaid 代码围栏渲染成图。',
    '当答案涉及流程、时序、架构分层、状态机、依赖关系或数据结构时，先给一张 mermaid 图（flowchart / sequenceDiagram / stateDiagram-v2 / erDiagram / classDiagram / gantt 任选），再用文字补充要点；简单结论不必配图。',
    '作图约束：节点文案 ≤10 字、节点数 ≤12；节点文字含括号或标点时用双引号包裹，避免语法错误。',
].join('\n');
/** 读取随包分发的 mermaid 版本号（缺省 unknown）。 */
function readVersion() {
    try {
        if (existsSync(VERSION_FILE))
            return readFileSync(VERSION_FILE, 'utf8').trim() || 'unknown';
    }
    catch { /* 忽略 */ }
    return 'unknown';
}
/** 注册图表资源路由 + 作图提示词开关。 */
export function applyDiagram(ctx) {
    const version = readVersion();
    let bytes = null;
    // 首次请求时读盘并常驻（~1MB；命中 HTTP 强缓存后基本不再走这里）。
    const load = () => {
        if (bytes !== null)
            return bytes;
        try {
            if (!existsSync(MERMAID_GZ) || statSync(MERMAID_GZ).size === 0)
                return null;
            bytes = readFileSync(MERMAID_GZ);
            return bytes;
        }
        catch (error) {
            console.error('[webui-diagram] read mermaid asset failed:', String(error?.message ?? error));
            return null;
        }
    };
    let scope;
    try {
        scope = ctx.settings.register('webui-diagram', z.object({ promptHint: z.boolean().default(true) }));
    }
    catch (error) {
        console.log('[webui-diagram] settings namespace already registered:', error?.message ?? error);
    }
    const hintEnabled = () => {
        if (scope !== undefined) {
            try {
                return scope.get().promptHint !== false;
            }
            catch { /* fallthrough */ }
        }
        return true;
    };
    // 关闭时返回空串，renderPrompt 自动丢弃（零 token 占用）。
    ctx.effect(() => ctx.systemPrompt.section({
        name: 'diagram-hint',
        order: -38,
        text: () => (hintEnabled() ? DIAGRAM_HINT : ''),
    }), 'webui: diagram prompt hint');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/dyn-assets/vendor/mermaid.min.js',
        handler: async (_req, res) => {
            const gz = load();
            if (gz === null) {
                res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
                res.end('mermaid asset missing');
                return;
            }
            res.writeHead(200, {
                'content-type': 'application/javascript; charset=utf-8',
                'content-encoding': 'gzip',
                'content-length': String(gz.length),
                // 随包分发、版本固定：强缓存一年，图表页第二次起零网络。
                'cache-control': 'public, max-age=31536000, immutable',
                'x-mermaid-version': version,
            });
            res.end(gz);
        },
    }), 'webui: diagram mermaid asset route');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/webui-diagram',
        handler: async (req, res) => {
            const respond = (status, payload) => {
                res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify(payload));
            };
            try {
                if (req.method === 'POST') {
                    const chunks = [];
                    for await (const chunk of req)
                        chunks.push(chunk);
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                    if (typeof body?.promptHint === 'boolean' && scope !== undefined) {
                        await scope.update({ promptHint: body.promptHint });
                    }
                }
                respond(200, { ok: true, available: load() !== null, version, promptHint: hintEnabled() });
            }
            catch (error) {
                respond(500, { ok: false, error: String(error?.message ?? error) });
            }
        },
    }), 'webui: diagram status route');
    console.log(`[webui-diagram] mounted: /dyn-assets/vendor/mermaid.min.js (mermaid ${version}, lazy), /api/webui-diagram`);
}
//# sourceMappingURL=diagram.js.map