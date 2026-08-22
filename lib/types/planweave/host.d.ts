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
export declare function applyPlanweaveHost(ctx: Context): void;
