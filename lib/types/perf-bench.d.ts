/**
 * perf-bench — 供应商模型推理性能基准测试（host 半身）。
 *
 * 五项核心指标（全部基于 OpenAI 兼容 /chat/completions）：
 *  1. TTFT    首 token 延迟：请求发出 → 首个流式 chunk（含推理链）的耗时 ms
 *  2. TPS     解码吞吐：completion_tokens ÷（末 chunk − 首 chunk）tok/s
 *  3. E2E     端到端延迟：请求发出 → 最后一个 chunk 的总耗时 ms
 *  4. RPS     并发吞吐：并发 4 × 共 8 个短请求的非流式 wall-clock，req/s
 *  5. Prefill 预填充速度：prompt_tokens ÷ 长 prompt 的 TTFT tok/s
 *             （max_tokens=8，解码占比可忽略，TTFT≈纯预填充时间）
 *
 * 口径：每项多次运行，统计 avg/P50/P95/min/max；temperature=0 保证可复现；
 * 总预算 170s（<3 分钟），超时自动跳过剩余阶段（已完成的阶段照常出报告）。
 * usage 缺失的网关按 chunk 计数估算（1 chunk ≈ 1 token），报告标注「估」。
 *
 * HTTP：
 *  - POST /api/perf-bench  { provider, model } → 启动（全局单例，进行中拒绝）
 *  - GET  /api/perf-bench  → 当前状态快照（供弹窗轮询渲染）
 */
import type { Context } from 'cordis';
type PluginContext = Context & Record<string, any>;
/** 一项指标的统计摘要。 */
export interface BenchSummary {
    avg: number;
    p50: number;
    p95: number;
    min: number;
    max: number;
}
/** 一个测试阶段的实时状态。 */
export interface BenchStage {
    key: string;
    name: string;
    unit: string;
    status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
    /** 测量口径说明（结果表中展示）。 */
    note: string;
    /** 原始样本（ms 或 tok/s 或 req/s）。 */
    samples: number[];
    /** true = token 数按 chunk 计数估算（网关未回 usage）。 */
    estimated: boolean;
}
/** 一次基准测试的全局状态（单例）。 */
export interface BenchState {
    running: boolean;
    provider: string;
    model: string;
    startedAt: number;
    finishedAt: number | null;
    error: string;
    stages: BenchStage[];
}
/** 给 client 的只读快照（附带统计值，省得前端重复算）。 */
export interface BenchSnapshot extends BenchState {
    elapsedMs: number;
    summaries: Record<string, BenchSummary>;
}
export declare function benchSnapshot(): BenchSnapshot | null;
/** 启动一次基准测试（单例；已在跑则拒绝）。 */
export declare function startBench(ctx: PluginContext, provider: string, model: string): {
    ok: boolean;
    error?: string;
};
/** 注册 HTTP 接口。 */
export declare function applyPerfBench(ctx: PluginContext): void;
export {};
