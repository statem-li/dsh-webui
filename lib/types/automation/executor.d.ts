/**
 * automation — 任务执行器（host 半身）。
 *
 * openhanako 的自动化统一作为后台 Agent Run 执行：触发时把 job 包装成一条
 * 「系统定时任务」prompt 交给 Agent 跑。DSH 插件形态下的等价实现：用
 * `ctx.llm.stream` 以任务绑定的模型（缺省回退 agent 当前默认模型）真实执行
 * 该 prompt，返回输出摘要供运行历史展示。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CronJob } from './types.js';
/** 最小 LLM 服务契约（与既有模块同款，避免拉入 dsh 类型依赖链）。 */
export interface LlmStreamChunk {
    type: string;
    text?: string;
    reason?: {
        kind: string;
        failure?: {
            message?: string;
        };
    };
}
export interface LlmLike {
    stream(opts: {
        provider: string;
        model: string;
        messages: unknown[];
        system?: string;
        maxTokens?: number;
        signal?: AbortSignal;
    }): AsyncIterable<LlmStreamChunk>;
}
/**
 * 解析任务的执行模型：job.model 显式指定优先，否则回退 agent 默认模型。
 * 两者皆缺时抛错（调度器按失败记录）。
 */
export declare function resolveRunModel(ctx: Context, job: CronJob): {
    provider: string;
    model: string;
};
/** openhanako 同款包装：声明这是系统自动触发的定时任务，防止任务递归创建任务。 */
export declare function buildCronPrompt(job: CronJob): string;
/**
 * 执行一个到期任务：包装 prompt → 调用模型 → 返回 { summary, file }。
 * 抛错即失败（调度器负责退避与落历史）。
 * 成功时把完整产出写入 runs/<jobId>/<yyyy-MM-dd_HHmmss>.md，file 为文件名
 * （供 UI 全文回看）。
 */
export declare function executeJob(ctx: Context, llm: LlmLike, job: CronJob, signal?: AbortSignal): Promise<{
    summary: string;
    file?: string;
    model: string;
}>;
