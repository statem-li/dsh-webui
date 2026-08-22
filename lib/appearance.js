/**
 * webui — 外观设置（host 半身）：玻璃质感（Glassmorphism）开关。
 *
 * 设置项「玻璃质感」控制插件界面的整体材质：开启后客户端叠加一层玻璃拟态
 * 风格（半透明表面 + backdrop-filter 模糊 + 细腻边框/圆角/柔和投影），与
 * 官方「外观」行的浅色/深色偏好正交——两种色调下均可正常显示。
 *
 * 值写入 settings 命名空间 `webui-appearance`（settings.yaml 持久化，服务
 * 重启后仍生效），并通过 GET/POST `/api/webui-appearance` 暴露给浏览器端
 * （设置页开关 + 启动时读取初始状态）。与 sidebar-float 同一范式。
 *
 * 玻璃质感本身是纯浏览器端行为，由 client 半身 `src/client/glass.ts`
 * 负责，这里只管设置项的持久化与读写 API。
 */
import z from '@deepseek-ai/schemastery';
/** 读取请求体 JSON（最多几 KB 的布尔开关，够用）。 */
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
/** 设置项默认值：关闭（默认保持原生不透明外观）。 */
export const APPEARANCE_DEFAULT_GLASS = false;
/** 玻璃表面不透明度默认值（百分比；40–95，越大越不透）。 */
export const APPEARANCE_DEFAULT_OPACITY = 75;
export const APPEARANCE_MIN_OPACITY = 40;
export const APPEARANCE_MAX_OPACITY = 95;
const clampOpacity = (v) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n))
        return APPEARANCE_DEFAULT_OPACITY;
    return Math.min(APPEARANCE_MAX_OPACITY, Math.max(APPEARANCE_MIN_OPACITY, n));
};
/**
 * 注册「玻璃质感」开关 + 不透明度：settings 持久化 + HTTP API。
 * @param ctx - host 上下文。
 */
export function applyAppearance(ctx) {
    // 命名空间注册在 host 层，settings.yaml 持久化；重复注册会抛错，先探测。
    let scope;
    try {
        scope = ctx.settings.register('webui-appearance', z.object({
            glass: z.boolean().default(APPEARANCE_DEFAULT_GLASS),
            opacity: z.number().step(1).min(APPEARANCE_MIN_OPACITY).max(APPEARANCE_MAX_OPACITY).default(APPEARANCE_DEFAULT_OPACITY),
        }));
    }
    catch (error) {
        // 已注册（例如插件被加载两次）——读取现有值继续工作。
        console.log('[appearance] settings namespace already registered:', error?.message ?? error);
    }
    const readGlass = () => {
        if (scope !== undefined) {
            try {
                return scope.get().glass === true;
            }
            catch { /* fallthrough */ }
        }
        return APPEARANCE_DEFAULT_GLASS;
    };
    const readOpacity = () => {
        if (scope !== undefined) {
            try {
                return clampOpacity(scope.get().opacity);
            }
            catch { /* fallthrough */ }
        }
        return APPEARANCE_DEFAULT_OPACITY;
    };
    // HTTP API：浏览器设置页通过 fetch 读写开关/不透明度；client 半身启动时读初始状态。
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/webui-appearance',
        handler: async (req, res) => {
            try {
                if (req.method === 'POST') {
                    const body = await readBody(req);
                    if (body && scope !== undefined) {
                        if (typeof body.glass === 'boolean') {
                            await scope.update({ glass: body.glass });
                        }
                        if (body.opacity !== undefined && Number.isFinite(Number(body.opacity))) {
                            await scope.update({ opacity: clampOpacity(body.opacity) });
                        }
                    }
                }
                const payload = JSON.stringify({ ok: true, glass: readGlass(), opacity: readOpacity() });
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
//# sourceMappingURL=appearance.js.map