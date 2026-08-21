/**
 * webui — 侧边栏模式设置（host 半身）。
 *
 * 设置项「固定侧边栏」控制侧边栏的展示模式：
 *  - 开启（默认）：原生固定侧边栏（常驻占位、挤压主内容，无热区/悬浮交互）；
 *  - 关闭：悬浮侧边栏（左侧热区悬停展开/折叠的 overlay 效果）。
 *
 * 值写入 settings 命名空间 `sidebar-float`（settings.yaml 持久化，服务重启后
 * 仍生效），并通过 GET/POST `/api/sidebar-float` 暴露给浏览器端（设置页开关 +
 * 启动时读取初始模式）。
 *
 * 悬浮交互本身是纯浏览器端行为，由 client 半身 `src/client/sidebar-float.ts`
 * 负责，这里只管设置项。
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
/** 设置项默认值：开启（固定侧边栏 = 原生行为，保持原有体验）。 */
export const SIDEBAR_FLOAT_DEFAULT_FIXED = true;
/**
 * 注册「固定侧边栏」开关：settings 持久化 + HTTP API。
 * @param ctx - host 上下文。
 */
export function applySidebarFloat(ctx) {
    // 命名空间注册在 host 层，settings.yaml 持久化；重复注册会抛错，先探测。
    let scope;
    try {
        scope = ctx.settings.register('sidebar-float', z.object({
            fixed: z.boolean().default(SIDEBAR_FLOAT_DEFAULT_FIXED),
        }));
    }
    catch (error) {
        // 已注册（例如插件被加载两次）——读取现有值继续工作。
        console.log('[sidebar-float] settings namespace already registered:', error?.message ?? error);
    }
    const readFixed = () => {
        if (scope !== undefined) {
            try {
                return scope.get().fixed !== false;
            }
            catch { /* fallthrough */ }
        }
        return SIDEBAR_FLOAT_DEFAULT_FIXED;
    };
    // HTTP API：浏览器设置页通过 fetch 读写开关；client 半身启动时读初始模式。
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/sidebar-float',
        handler: async (req, res) => {
            try {
                if (req.method === 'POST') {
                    const body = await readBody(req);
                    if (body && typeof body.fixed === 'boolean' && scope !== undefined) {
                        await scope.update({ fixed: body.fixed });
                    }
                }
                const payload = JSON.stringify({ ok: true, fixed: readFixed() });
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
//# sourceMappingURL=sidebar-float.js.map