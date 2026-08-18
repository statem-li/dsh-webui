/**
 * dsh-memory 调度器：三个触发点（design §5.3）。
 * 1. 每 N 轮（默认 10）增量编译 timeline；
 * 2. 会话结束（turn/end 后 debounce 静默期）final 编译；
 * 3. 每日一次：全量衰减 → 短期折叠进长期 → 低分滚出 → daily 日志落盘 → 产物重编译。
 * 并发安全：所有写入经同一个串行队列（内存锁）执行。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from '../types.js';
import { type MemoryStore } from './store.js';
/** 从 store 读的 Agent 最小面（id 即可，供调度去重）。 */
export interface TickerAgent {
    readonly id: string;
}
/**
 * 创建 ticker。返回 { onTurnEnd, enqueue, dispose }。
 * onTurnEnd 由 session/event 的 turn/end 分支调用；enqueue 供提取等写操作
 * 共用同一条串行队列（内存锁：避免 ticker 与捕获并发读写同一 store）。
 */
export declare function createTicker(ctx: Context, store: MemoryStore, config: MemoryConfig): {
    onTurnEnd: (sessionId: string, agent: TickerAgent) => Promise<void>;
    enqueue: <T>(task: () => Promise<T>) => Promise<T>;
    dispose: () => void;
};
/** 会话级 ticker 状态读取（供 inject 用，避免重复读文件）。 */
export declare function sessionTurnCount(store: MemoryStore, sessionId: string): Promise<number>;
/** 当前时间 ISO（供 change 记录）。 */
export declare function tickerNow(): string;
