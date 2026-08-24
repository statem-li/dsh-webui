/**
 * automation — Cron 调度器（参考 openhanako cron-scheduler）。
 *
 * 确定性代码层：每分钟检查一次到期任务，到期时回调执行。
 * 调度逻辑不涉及 LLM，只有执行回调才会发起模型调用——调度器与执行解耦。
 *
 * 行为契约：
 *  - tick 间隔 60s；`checking` 防重入；
 *  - 逐任务派发前重新读取该 job，让批次进行期间的删除/停用/改期立即生效；
 *  - schemaVersion 高于本实现的 job 跳过并落一条 skipped 记录（前向兼容）；
 *  - **同一任务不并发**（inflight 表按 jobId 去重），**不同任务并发派发**——
 *    一个 20 分钟的长任务不会把同批次其他任务堵到下一轮；
 *  - 单次执行超时（默认 20 分钟）触发 abortJob 并按失败处理；
 *  - 调度触发：成功/失败都经 markRun 推进 nextRunAt（失败含退避）并落历史；
 *  - 手动触发（runNow）：立即执行、不推进调度游标、不计连续失败，
 *    历史记录标 trigger:'manual'；停用中的任务也可手动跑一次。
 */
import { type CronJob } from './types.js';
import type { CronStore } from './store.js';
/** 单次任务执行超时。 */
export declare const DEFAULT_CRON_EXECUTION_TIMEOUT_MS: number;
/** 一次运行的触发来源。 */
export type RunTrigger = 'schedule' | 'manual';
export interface CronSchedulerOptions {
    store: CronStore;
    /** 执行回调（由 executor 提供）：解析即视为成功，抛错即失败。 */
    executeJob: (job: CronJob) => Promise<Record<string, unknown> | void>;
    /** 超时时中断正在执行的任务。 */
    abortJob?: (job: CronJob) => void;
    /** 执行完成通知（无论成败/skip 都会回调）。 */
    onJobDone?: (job: CronJob, result: Record<string, unknown>) => void;
    /** 单次执行超时毫秒。 */
    executionTimeoutMs?: number;
}
export interface CronScheduler {
    start: () => void;
    stop: () => Promise<void>;
    checkJobs: () => Promise<void>;
    /** 立即执行一次（手动触发）；返回运行结果记录。 */
    runNow: (id: string) => Promise<Record<string, unknown>>;
    /** 该任务当前是否正在执行。 */
    isRunning: (id: string) => boolean;
    /** 正在执行的任务 id 列表。 */
    runningIds: () => string[];
    /** 中止正在执行的任务（未在执行返回 false）。 */
    cancel: (id: string) => boolean;
}
/** 任务正在执行时再次触发抛该错（路由层转 409）。 */
export declare class JobBusyError extends Error {
    readonly code = "job_busy";
    constructor(id: string);
}
/** 创建 Cron 调度器。 */
export declare function createCronScheduler({ store, executeJob, abortJob, onJobDone, executionTimeoutMs, }: CronSchedulerOptions): CronScheduler;
