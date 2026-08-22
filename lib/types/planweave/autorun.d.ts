import type { PlanweaveEngine } from './engine.js';
import { type RunEnv } from './host.js';
export type AutoRunStatus = 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
/** 对外快照（JSON 友好）。 */
export interface AutoRunSnapshot {
    id: string;
    projectName: string;
    status: AutoRunStatus;
    startedAt: string;
    endedAt: string | null;
    steps: number;
    maxSteps: number;
    events: string[];
}
/** 启动一个后台 Auto Run 并立即返回快照（循环在后台推进）。 */
export declare function startAutoRunBg(input: {
    projectName: string;
    maxSteps: number;
    engine: PlanweaveEngine;
    env: RunEnv;
}): AutoRunSnapshot;
/** 暂停。 */
export declare function pauseAutoRunBg(id: string): AutoRunSnapshot | undefined;
/** 恢复（从 paused 继续；loop 重新拉起）。 */
export declare function resumeAutoRunBg(id: string): AutoRunSnapshot | undefined;
/** 停止（终态；进行中的一步完成后退出）。 */
export declare function stopAutoRunBg(id: string): AutoRunSnapshot | undefined;
/** 查询快照。 */
export declare function getAutoRunBgState(id: string): AutoRunSnapshot | undefined;
/** 最近一次启动（按项目名过滤；找不到返回 undefined）。 */
export declare function latestAutoRunBg(projectName: string): AutoRunSnapshot | undefined;
