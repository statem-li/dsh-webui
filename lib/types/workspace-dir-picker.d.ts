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
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/** ── 最小服务契约（与 file-explorer 同风格：保持小类型面）────────────── */
interface WebServerRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void;
}
interface WebServerService {
    register(route: WebServerRoute): () => void;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        webServer: WebServerService;
    }
}
/**
 * 本机可选的顶层目录（盘符）：Windows 枚举存在盘符，POSIX 只有根。
 * 返回绝对路径（Windows 为 `X:\` 形式），供弹窗切换盘符。
 */
export declare function listDrives(): Array<{
    name: string;
    path: string;
}>;
/** 挂载 /api/webui-dir-picker 路由（webui 组合调用）。 */
export declare function applyWorkspaceDirPicker(ctx: Context): void;
export {};
