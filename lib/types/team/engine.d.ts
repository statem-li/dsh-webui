/**
 * team — 运行引擎（host 半身）。
 *
 * 一次 Run = 把链条展开成线性步骤，逐步执行并把快照写回 run.json：
 *   queued → running ─(全部步骤 done)→ done
 *                    ─(某步 error 且 stopOnError)→ error
 *                    ─(取消)→ cancelled（当前步 abort，后续 pending → skipped）
 *
 * 两条执行通道：
 *  - llm 直跑：ctx.llm.stream，可精确指定 provider/model；无工具。
 *  - subagent：ctx.subagents.start（需要 agent 上下文），有完整工具能力；模型继承父会话。
 *
 * 流式增量：每 ~500ms 把当前步累积输出（截断）写进 run.json 的 steps[i].output，
 * 对话流 HUD 直接轮询快照即可看到实时进度，无需额外 SSE 通道。
 */
import { type Run, type StartRunInput } from './types.js';
import { TeamStore } from './store.js';
/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any;
interface LlmChunk {
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
    }): AsyncIterable<LlmChunk>;
}
/** 工具 execute 的运行上下文（决定能否走 subagent 通道）。 */
export interface ExecLike {
    agent?: unknown;
    signal?: AbortSignal;
}
/** 引擎依赖。 */
export interface EngineDeps {
    ctx: AnyContext;
    store: TeamStore;
}
/** 启动运行的可选执行上下文（工具触发时带 agent → 可用 subagent）。 */
export interface RunContext {
    exec?: ExecLike | null;
}
/** 团队运行引擎。 */
export declare class TeamEngine {
    private readonly ctx;
    private readonly store;
    private readonly active;
    private queue;
    private runningCount;
    /** 本次运行的能力目录快照（每个 Run 开始时取一次，避免每步重扫技能目录）。 */
    private catalog;
    constructor(deps: EngineDeps);
    /** 当前进行中的运行 id。 */
    activeRunIds(): string[];
    /** 请求取消一次运行；返回是否命中。 */
    cancel(runId: string): boolean;
    /**
     * 启动一次运行：同步创建 run.json（status=queued）并返回快照，
     * 执行在后台推进（调用方无需等待）。
     */
    start(input: StartRunInput, context?: RunContext): Run;
    /** 并发闸门：超出 maxConcurrentRuns 时排队。 */
    private enqueue;
    /** 执行整个 Run（每步落盘快照）。 */
    private execute;
    /** 执行单步；返回 'done' | 'error' | 'skipped'。 */
    private runStep;
    /** 通道选择（docs §4.3）。 */
    private pickChannel;
    private subagents;
    /** 调用一次通道（统一超时 + 取消语义）。 */
    private invoke;
    /** llm 直跑：累积 text-delta，节流写快照。 */
    private invokeLlm;
    /**
     * subagent 通道：完整 agent（有工具），模型继承父会话。
     * `toolFilter` 非空时经 `subagents.start({ toolFilter })` 真实限制子 agent 的工具可见性
     * （被限制的工具从子 agent 提示词消失且拒绝执行）；provider 不支持该能力时降级为不限制。
     */
    private invokeSubagent;
    /** 原子更新某步字段（读—改—写 run.json）。 */
    private patchStep;
}
export {};
