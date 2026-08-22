import type { InitWorkspaceResult } from '@planweave-ai/runtime';
/** PlanWeave 数据根：`${DSH_HOME:-~/.dsh}/planweave`。 */
export declare function planweaveDataRoot(): string;
/**
 * 把 runtime 的 `PLANWEAVE_HOME` 指向 DSH 数据根，并返回该路径。
 * 必须在任何 runtime 调用（init/claim/submit/…）之前执行一次，否则 runtime 会
 * 落到默认的 `~/.planweave`。
 */
export declare function ensurePlanweaveHome(): string;
/**
 * 幂等打开（或首次创建）一个托管项目。
 * runtime 的 `initManagedWorkspace` 以 name 派生稳定的 projectId（name + hash），
 * 已存在时不会覆盖现有 manifest/state/results，返回 `created: false`。
 */
export declare function openOrCreateProject(name: string): Promise<InitWorkspaceResult>;
