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
import { type Chain, type ModelBinding, type ResolvedModel, type Role, type Run, type Team, type TeamGlobals } from './types.js';
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
 * 读 DSH 内置 `llm-pi-ai` 命名空间的 providers 配置（与 webui_sync_reasoning /
 * planweave /providers 同一数据源），投影为下拉分组数据。
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
/** 展开后的一个执行步骤。 */
export interface PlannedStep {
    index: number;
    role: Role;
    synthesize: boolean;
    taskNote?: string;
}
/** 找主脑角色（core 分组第一个，或 id 为 hanako 的角色）。 */
export declare function findCoreRole(team: Team): Role | null;
/**
 * 把链条展开为线性执行计划：role 步 + 显式/隐式 synthesize 步。
 * 找不到角色的步骤直接跳过；主脑缺失时不追加整合步。
 */
export declare function planChain(team: Team, chain: Chain): PlannedStep[];
/** 把任意角色 id 序列展开为执行计划（临时点兵）。 */
export declare function planRoles(team: Team, roleIds: readonly string[], synthesize: boolean): PlannedStep[];
/** 校验团队可用性：至少一个角色；链引用的角色存在（normalizeTeam 已过滤，这里只查空链）。 */
export declare function assertTeamRunnable(team: Team, chain: Chain | null): void;
/** 从运行快照统计 TODO 进度（HUD 与清单共用）。 */
export declare function runProgress(run: Run): {
    total: number;
    done: number;
    running: number;
    pending: number;
    failed: number;
};
export {};
