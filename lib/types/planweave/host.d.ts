/**
 * webui — PlanWeave 模块（host 半身）。
 *
 * 把 PlanWeave 的「计划 → 任务图 → 认领/执行/评审/反馈」循环接到 DSH：
 *  - settings 命名空间 `planweave`：默认项目名 + 执行模型 + 每轮步数。
 *  - 模型工具：planweave_init / planweave_status / planweave_run（agent 可在对话中直接调用）。
 *  - HTTP API：GET /api/planweave/status（loopback，供 client 半身面板轮询）。
 *
 * 核心引擎复用 @planweave-ai/runtime；执行器用 ctx.llm（Phase 0 的 DshExecutorAdapter）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { PlanweaveEngine } from './engine.js';
import { type DshLlm, type ExecutorModel, type ExecLike } from './executor.js';
export interface RunEnv {
    ctx: Context;
    exec: ExecLike | null;
    /** 仅 llm 直跑路径需要；subagent 路径为 null（无需配置执行模型）。 */
    llm: DshLlm | null;
    model: ExecutorModel | null;
    provider: string | null;
}
/** 执行单个已认领项（block/feedback），完成提交并返回一行事件描述。 */
export declare function executeClaimStep(engine: PlanweaveEngine, env: RunEnv, label: string, claim: Extract<Awaited<ReturnType<typeof engine.claim>>, {
    kind: 'block' | 'feedback';
}>): Promise<string>;
export declare function applyPlanweaveHost(ctx: Context): void;
