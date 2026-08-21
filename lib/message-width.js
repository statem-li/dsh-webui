/**
 * webui — 「我发送的对话宽度」（本人消息气泡宽度）设置。
 *
 * - settings 命名空间 `message-width` 持久化（value + unit，默认 525px）
 * - HTTP API：GET /api/webui-message-width → { value, unit }
 *   POST { value, unit } → 校验并更新（持久化到 settings.yaml，重启仍有效）
 *
 * 该设置只影响当前用户本人发送的消息气泡（chat-flow-kind 为 user / steering），
 * 不影响对方（assistant）、系统提示等其他消息类型。
 */
import z from '@deepseek-ai/schemastery';
/** 默认值：525px —— 与 ui-conversation 原 `min(525px, 82%)` 的桌面端视觉上限一致。 */
export const MESSAGE_WIDTH_DEFAULT = { value: 525, unit: 'px' };
/** 单位各自的有效范围：百分比 10–100，像素 120–1600。 */
const RANGES = {
    '%': { min: 10, max: 100 },
    px: { min: 120, max: 1600 },
};
function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
            try {
                resolve(JSON.parse(data || '{}'));
            }
            catch {
                resolve(null);
            }
        });
        req.on('error', () => resolve(null));
    });
}
/** 校验并规范化一次写入；非法值返回 null。 */
function normalize(value, unit) {
    const u = unit === '%' ? '%' : 'px';
    const v = Number(value);
    if (!Number.isFinite(v))
        return null;
    const range = RANGES[u];
    if (v < range.min || v > range.max)
        return null;
    return { value: Math.round(v), unit: u };
}
/** 注册「我发送的对话宽度」设置：settings 持久化 + HTTP API。 */
export function applyMessageWidth(ctx) {
    // 命名空间注册在 host 层，settings.yaml 持久化；重复注册会抛错，先探测。
    let scope;
    try {
        scope = ctx.settings.register('message-width', z.object({
            value: z.number().min(1).max(1600).default(MESSAGE_WIDTH_DEFAULT.value),
            unit: z.union([z.const('px'), z.const('%')]).default(MESSAGE_WIDTH_DEFAULT.unit),
        }));
    }
    catch (error) {
        // 已注册（例如插件被加载两次）——读取现有值继续工作。
        console.log('[message-width] settings namespace already registered:', error?.message ?? error);
    }
    const read = () => {
        if (scope !== undefined) {
            try {
                const s = scope.get();
                if (s && typeof s.value === 'number' && (s.unit === 'px' || s.unit === '%')) {
                    return { value: s.value, unit: s.unit };
                }
            }
            catch { /* fallthrough */ }
        }
        return { ...MESSAGE_WIDTH_DEFAULT };
    };
    // HTTP API：浏览器设置页通过 fetch 读写。
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/webui-message-width',
        handler: async (req, res) => {
            try {
                if (req.method === 'POST' && scope !== undefined) {
                    const body = await readBody(req);
                    const next = body ? normalize(body.value, body.unit) : null;
                    if (next !== null)
                        await scope.update({ value: next.value, unit: next.unit });
                }
                const payload = JSON.stringify({ ok: true, ...read() });
                res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(payload);
            }
            catch (error) {
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
            }
        },
    }));
}
//# sourceMappingURL=message-width.js.map