/**
 * team — 运行引擎（host 半身）。
 *
 * 一次 Run = 把链条/计划展开成**波次**（wave）序列，逐波推进并把快照写回 run.json：
 *   queued → running ─(全部步骤 done)→ done
 *                    ─(某步 error 且 stopOnError)→ error
 *                    ─(取消)→ cancelled（当前步 abort，后续 pending → skipped）
 *
 * 并行语义：同一波次里的步骤**并发执行**（受 maxParallel 限制），波次之间严格串行。
 * 一个步骤的上游上下文只包含**更早波次**的产出——同波伙伴彼此看不到对方结果，
 * 所以提示词里会显式告知「谁在与你同时干活」，避免重复劳动与互相假设。
 *
 * 两条执行通道（并行时按角色 executor 各自选择）：
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
     *
     * 计划来源优先级：input.plan（显式并行波次）> chainId（链，含链内并行组）
     * > roles（临时点兵）。autoPlan=true 时先落一个「编排中」的空壳 run，
     * 由后台先问主脑要计划再填充步骤。
     */
    start(input: StartRunInput, context?: RunContext): Run;
    /** 并发闸门：超出 maxConcurrentRuns 时排队。 */
    private enqueue;
    /** 执行整个 Run（按波次推进，波次内并发；每步落盘快照）。 */
    private execute;
    /**
     * 一键接续：在**同一个 run 上**重跑所有未完成的步骤（error / skipped / pending /
     * 被中断卡住的 running），已完成步骤的产物与顺序完全保留。
     *
     * 为什么不新建 run：接续的价值就是「只补失败的那一段」——新建 run 会丢掉已完成
     * 步骤的产物，还会让 HUD 里出现两条看起来一样的运行记录。同一个 run 上重跑还能
     * 让上游注入（按 wave 取更早波次的 done 产出）天然成立。
     *
     * 幂等与并发：run 仍在跑（内存里有 active 句柄，或磁盘状态 running/queued）时拒绝；
     * 全部步骤已完成时拒绝（无可接续内容）。
     */
    resume(runId: string, context?: RunContext): Run;
    /** 执行单步；返回 'done' | 'error' | 'skipped'。 */
    private runStep;
    /** 通道选择（docs §4.3）。 */
    private pickChannel;
    /**
     * 取 subagents 运行时；不可用时返回 null（角色降级为 llm 直跑）。
     *
     * 必须走 `ctx.get('subagents')`：cordis 对**未在 inject 声明**的服务做裸属性访问
     * （`ctx.subagents`）会直接抛 `cannot get property "subagents" without inject`，
     * 而该异常发生在 pickChannel 里、runStep 的 try 之外 —— 整个运行会在第一步就崩，
     * 表现为「秒失败、所有步骤 skipped、连模型都没解析」。`ctx.get()` 对缺失服务返回
     * undefined，可安全降级。
     */
    private subagents;
    /**
     * 主脑自主派发：问一次模型要「波次计划」。
     *
     * 走 llm 直跑通道（要的是结构化 JSON，不需要工具），模型按主脑角色解析
     * （core 角色覆盖 → 团队默认 → 全局默认）。解析失败/角色名不合法的项被丢弃，
     * 全部无效时返回空波次由调用方兜底。
     */
    private askForPlan;
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
    /**
     * 跟踪子 agent 会话日志，把思考/正文增量与任务清单转发给上层。
     *
     * 实现：sessionPersistence.readFrom(id, watermark) 是官方的「从水位线读后缀」
     * 原语（SQLite 后端只物理读后缀），每秒轮询一次：
     *  - assistant/chunk 的 reasoning-delta / text-delta → 拼成 Markdown 快照
     *    （思考为引用块、正文原样）经 handlers.onDelta 写进 run.json；
     *  - tool/call 的 todo_write → 解析其 todos 参数经 handlers.onTodos 写入步骤
     *    的结构化字段 —— HUD 卡与详情卡即可像对话流一样看到子 agent 的过程。
     * 子会话 id 拿不到 / 后端不支持 / 日志未就绪时静默降级零过程流。
     */
    private tailSubagentSession;
    /**
     * 原子更新某步字段（读—改—写 run.json）。
     *
     * 并行波次里多个步骤会交替调用本方法：readRun/saveRun 都是同步 fs 调用，
     * Node 单线程下这段读—改—写不会被其它 JS 打断，所以并发步骤各自只改自己
     * 那一项、互不覆盖（写盘本身也是 tmp+rename 原子替换）。
     */
    private patchStep;
}
export {};
