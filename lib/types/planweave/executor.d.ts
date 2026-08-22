export interface DshLlmChunk {
    type: string;
    text?: string;
    reason?: {
        kind: string;
        failure?: {
            message?: string;
        };
    };
}
export interface DshLlm {
    stream(opts: {
        provider: string;
        model: string;
        messages: unknown[];
        system?: string;
        maxTokens?: number;
        signal?: AbortSignal;
    }): AsyncIterable<DshLlmChunk>;
}
export interface ExecutorModel {
    provider: string;
    model: string;
    maxTokens?: number;
    timeoutMs?: number;
}
/** 执行超时错误。 */
export declare class ExecutorTimeoutError extends Error {
    constructor();
}
/**
 * 用 DSH LLM 流式生成一段文本（只累积 text-delta，忽略 reasoning）。
 * 超时或模型异常终止时抛错。
 */
export declare function llmGenerate(llm: DshLlm, model: ExecutorModel, system: string, prompt: string): Promise<string>;
export interface ReviewOutcome {
    verdict: 'passed' | 'needs_changes';
    content: string;
}
/** 执行实现块：返回已写好的 report.md 路径。 */
export declare function executeImplementation(llm: DshLlm, model: ExecutorModel, prompt: string, ref: string): Promise<{
    reportPath: string;
}>;
/** 执行评审块：返回已写好的 review-result.json 路径 + 解析出的结论。 */
export declare function executeReview(llm: DshLlm, model: ExecutorModel, prompt: string, ref: string, taskId: string): Promise<{
    resultPath: string;
    outcome: ReviewOutcome;
}>;
/** 执行反馈修复：返回已写好的 feedback report.md 路径。 */
export declare function executeFeedback(llm: DshLlm, model: ExecutorModel, feedbackContent: string, ref: string): Promise<{
    reportPath: string;
}>;
/** ContentBlock 最小形状（从 dsh-llm）。 */
export interface ContentBlockLike {
    type: string;
    text?: string;
}
/** SubagentRun 最小形状。 */
export interface SubagentRunLike {
    result: Promise<{
        output: ContentBlockLike[];
        structured?: unknown;
        stopReason: string;
        diagnostic?: string;
    }>;
    dispose(): Promise<void>;
}
/** `ctx.subagents`（SubagentRuntime）最小形状。 */
export interface SubagentRuntimeLike {
    list(): string[];
    start(name: string, request: {
        parent: unknown;
        prompt: ContentBlockLike[];
        label?: string;
        signal?: AbortSignal;
    }): Promise<SubagentRunLike>;
}
/** 工具 execute 的 exec 参数（ToolRunContext）最小形状。 */
export interface ExecLike {
    agent?: unknown;
    signal?: AbortSignal;
}
/** 从 host ctx 取 subagents 服务；未挂载返回 null（fallback 到 llm 路径）。 */
export declare function subagentRuntime(ctx: unknown): SubagentRuntimeLike | null;
/** 首个可用 subagent provider（spawn/fork/acp…）。 */
export declare function defaultSubagentProvider(ctx: unknown): string | null;
/** subagent 执行实现块。 */
export declare function executeImplementationSubagent(ctx: unknown, exec: ExecLike, provider: string, prompt: string, ref: string): Promise<{
    reportPath: string;
}>;
/** subagent 执行评审块。 */
export declare function executeReviewSubagent(ctx: unknown, exec: ExecLike, provider: string, prompt: string, ref: string, taskId: string): Promise<{
    resultPath: string;
    outcome: ReviewOutcome;
}>;
/** subagent 执行反馈修复。 */
export declare function executeFeedbackSubagent(ctx: unknown, exec: ExecLike, provider: string, feedbackContent: string, ref: string): Promise<{
    reportPath: string;
}>;
