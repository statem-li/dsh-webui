/**
 * dsh-memory 注入引擎：agent/pre-step 把「全局 identity + 当前项目 memory +
 * pinned + facts」组装为一条带来源的 user message 注入（source: { kind: 'plugin' }）。
 * 绝不写 system prompt（DSH persona complete:true 会静默丢弃）；
 * 只注入当前工作区项目 + 全局层；token 超预算按重要性截断，最低保留置顶。
 * 命中刷新：被注入的条目距上次命中 ≥1 天时刷新 lastHitAt 并加分。
 */
import type { MemoryConfig } from '../types.js';
import type { MemoryStore } from './store.js';
/** pre-step 载荷的最小 agent 面。 */
export interface PreStepAgent {
    readonly id: string;
    readonly session: {
        readonly id: string;
        readonly header?: {
            cwd?: string;
        };
    };
}
export interface MemoryInjector {
    /** 注入监听器（注册时用 prepend: true）。 */
    preStepListener: (payload: {
        agent: PreStepAgent;
        messages: unknown[];
        signal: AbortSignal;
    }, next: () => Promise<{
        kind: 'enter';
        messages: unknown[];
    } | {
        kind: 'reject';
    }>) => Promise<unknown>;
    /** 清理会话级状态。 */
    disposeSession: (sessionId: string) => void;
}
/** 创建注入器。 */
export declare function createMemoryInjector(store: MemoryStore, config: MemoryConfig, logger: {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
} | undefined): MemoryInjector;
