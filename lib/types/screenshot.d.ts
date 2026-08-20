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
/** 挂载单条消息截图路由（POST /api/webui-screenshot + GET 图片回读）。 */
export declare function applyScreenshot(ctx: Context): void;
export {};
