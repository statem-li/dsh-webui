/**
 * team — 编制校验 + 模型解析 + providers 枚举投影（host 半身）。
 *
 * 模型解析四级优先级（docs/TEAM-ORCHESTRA.md §3.7）：
 *   1. 本次运行覆盖 run.modelOverrides[roleId]
 *   2. 角色覆盖     role.model
 *   3. 团队默认     team.model
 *   4. 全局兜底     globals.defaultModel → agent 当前默认模型
 *
 * 解析在「每步开始时」做一次并写入 RunStep.modelUsed/modelSource——运行中改团队
 * 模型不影响已在跑的步骤。
 */
import { type Chain, type ModelBinding, type ModelSource, type PlanWaveItem, type ResolvedModel, type Role, type Run, type Team, type TeamGlobals } from './types.js';
/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any;
/** 一个供应商下可选的模型。 */
export interface ProviderModelView {
    id: string;
    name: string;
}
/** providers 枚举项（下拉分组）。 */
export interface ProviderView {
    id: string;
    displayName: string;
    models: ProviderModelView[];
}
/**
 * 读 DSH 内置 `llm-pi-ai` 命名空间的 providers 配置（与 webui_sync_reasoning 同一数据源），投影为下拉分组数据。
 */
export declare function listProviders(ctx: AnyContext): ProviderView[];
/** 校验一个绑定是否存在于 providers 枚举中（provider 为空时跳过校验）。 */
export declare function bindingExists(providers: readonly ProviderView[], binding: ModelBinding): boolean;
/** 读 agent 当前默认模型（automation/executor 同款用法）；不可用返回 null。 */
export declare function agentDefaultModel(ctx: AnyContext): ModelBinding | null;
/** 解析入参（run 可为 null：预览解析时用）。 */
export interface ResolveInput {
    ctx: AnyContext;
    team: Team;
    role: Role;
    globals: TeamGlobals;
    modelOverrides?: Record<string, ModelBinding>;
}
/**
 * 按四级优先级解析角色本次执行使用的模型。
 * 全部层级都缺失时抛 TeamError（提示用户去设团队默认模型）。
 */
export declare function resolveModel({ ctx, team, role, globals, modelOverrides }: ResolveInput): ResolvedModel;
/** 解析并校验模型存在性；不存在时给出可操作的错误提示。 */
export declare function resolveModelChecked(input: ResolveInput, providers: readonly ProviderView[]): ResolvedModel;
/** 候选模型（主模型 + 备用链），engine 按序尝试。 */
export interface ModelCandidate {
    binding: ModelBinding;
    source: ModelSource;
    /** true = 备用模型（主模型失败后的降级目标）。 */
    fallback: boolean;
}
/**
 * 解析本步可用的模型候选序列：`[主模型, ...备用模型]`。
 *
 * 备用链来源：角色 `fallbackModels` 优先，缺省继承团队 `fallbackModels`。
 * 已在候选里的（与主模型或前一个备用同值）与「当前供应商配置里不存在」的项会被剔除
 * —— 换到一个同样不存在的模型没有意义，只会把同一个错误重复一遍。
 * 主模型解析失败（四级全空）时直接抛错，与 resolveModelChecked 语义一致。
 */
export declare function resolveCandidates(input: ResolveInput, providers: readonly ProviderView[], options?: {
    autoFallback?: boolean;
}): ModelCandidate[];
/** 展开后的一个执行步骤。 */
export interface PlannedStep {
    index: number;
    /**
     * 波次序号（0 起）：同一 wave 的步骤由引擎并发执行，wave 之间串行。
     * 全串行计划里 wave === index。
     */
    wave: number;
    role: Role;
    synthesize: boolean;
    taskNote?: string;
}
/** 找主脑角色（core 分组第一个，或 id 为 brain / 旧 id hanako 的角色）。 */
export declare function findCoreRole(team: Team): Role | null;
/**
 * 把链条展开为执行计划：role 步 + 显式/隐式 synthesize 步。
 * 找不到角色的步骤直接跳过；主脑缺失时不追加整合步。
 *
 * 并行语义：`step.parallel === true` 的 role 步与**前一步同波次**（首步除外）；
 * 其余步骤各自开新波次。synthesize 步永远独占最后一个波次（必须看到全部上游）。
 * 波次内步数由 maxParallel 限制（超出的自动溢出到下一个波次，避免一次点爆供应商）。
 */
export declare function planChain(team: Team, chain: Chain, maxParallel?: number): PlannedStep[];
/**
 * 把任意角色 id 序列展开为执行计划（临时点兵，全串行 + 可选尾部整合）。
 */
export declare function planRoles(team: Team, roleIds: readonly string[], synthesize: boolean): PlannedStep[];
/**
 * 把显式并行计划（波次数组）展开为执行计划。
 * 每个波次内的角色并发执行；超过 maxParallel 的部分溢出为额外波次。
 * synthesize=true 时尾部追加一个独占波次的主脑整合步。
 */
export declare function planWaves(team: Team, waves: readonly PlanWaveItem[][], synthesize: boolean, maxParallel?: number): PlannedStep[];
/** 计划里的波次数量。 */
export declare function waveCountOf(planned: readonly PlannedStep[]): number;
/**
 * 从既有运行快照重建「接续计划」：只挑未完成的步骤（error / skipped / pending /
 * 卡在 running 的），保留它们原来的 index 与 wave —— 这样已完成步骤的产物不动，
 * 上游注入（按 wave 取更早波次）照旧成立，UI 上的卡片位置也不会跳。
 *
 * 角色被删掉的步骤无法重跑，返回值的 `missing` 里带回角色名供上层提示。
 */
export declare function planResume(team: Team, run: Run): {
    planned: PlannedStep[];
    missing: string[];
};
/** 计划的可读路径文案（并行波次用 `A‖B` 表示）。 */
export declare function describePlan(planned: readonly PlannedStep[]): string;
/** 校验团队可用性：至少一个角色；链引用的角色存在（normalizeTeam 已过滤，这里只查空链）。 */
export declare function assertTeamRunnable(team: Team, chain: Chain | null): void;
/** 从运行快照统计 TODO 进度（HUD 与清单共用）。 */ export declare function runProgress(run: Run): {
    total: number;
    done: number;
    running: number;
    pending: number;
    failed: number;
};
/**
 * 本次运行是否可「一键接续」：已结束（非 running/queued）且还有未完成步骤。
 * 全部步骤都 done 的运行没有接续意义（要重跑请新建运行）。
 */
export declare function isResumable(run: Run): boolean;
export {};
