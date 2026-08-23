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
    interface Events {
        'fs/write-intent'(target: unknown, actor: unknown, next: () => unknown): unknown;
        'fs/edit-intent'(target: unknown, actor: unknown, next: () => unknown): unknown;
    }
}
/**
 * 挂载 fs 写入记账（write-intent / edit-intent 监听）与查询路由。
 * 记账同步完成、失败静默——绝不能影响 agent 写文件的主流程。
 */
export declare function applyDeliverables(ctx: Context): void;
export {};
