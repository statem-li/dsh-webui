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
/** 截图输出目录。 */
export declare function screenshotHome(): string;
/** 用独立无头浏览器把 HTML 渲染为截图（2x DPR + PNG 无损，文字清晰）。短内容保持 16:10，长内容自动扩展为长图截全。 */
export declare function captureHtml(html: string): Promise<string>;
export declare function withShotLock<T>(task: () => Promise<T>): Promise<T>;
/** 挂载单条消息截图路由（POST /api/webui-screenshot + GET 图片回读）。 */
export declare function applyScreenshot(ctx: Context): void;
export {};
