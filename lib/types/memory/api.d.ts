/**
 * dsh-memory HTTP API（loopback-only）：/api/dsh-memory/*。
 * 面板数据 + 裁决操作（保留/删除/改标签/移项目/置顶/手动归属）。
 * 与 skill-manager 同款 webServer 路由模式；前缀 /api/dsh-memory 不与其它插件冲突。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from './types.js';
import { mergeTags, type MemoryStore } from './engine/store.js';
/** Minimal service-shaped view of the webserver route register. */
declare module '@deepseek-ai/cordis' {
    interface Context {
        webServer: {
            register(route: {
                kind: 'exact' | 'prefix';
                path: string;
                handler: (req: IncomingMessage, res: ServerResponse) => void;
            }): () => void;
        };
    }
}
/** 挂载全部路由。 */
export declare function mountMemoryRoutes(ctx: Context, store: MemoryStore, config: MemoryConfig): () => void;
/** 供其它模块使用的工具函数（变更时间）。 */
export declare function apiNow(): string;
/** mergeTags 复用导出（tools.ts 已用本地实现，此处仅为 API 一致性保留）。 */
export { mergeTags };
