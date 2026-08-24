import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
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
/** 截图保存目录。 */
export declare function screenshotHome(): string;
/**
 * 挂载对话截图路由。
 * @param ctx - 插件上下文（需要 webServer 服务）。
 */
export declare function applyScreenshot(ctx: Context): void;
export {};
