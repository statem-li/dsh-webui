/**
 * team — prompt 装配（host 半身）。
 *
 * 一步的输入 = 角色系统提示词（system）+ 用户消息（任务 + 本步说明 + 上游产出）。
 * 上游注入按 globals.upstreamWindow 与 outputChunkChars 裁剪：
 *  - 'last'        最近一步全量（截断到预算）+ 更早步骤各取摘要头
 *  - 'all-summary' 全部步骤各取摘要头（均分预算）
 */
import type { PlannedStep } from './roster.js';
import type { Role, RunStep, Team, TeamGlobals } from './types.js';
/** 角色的 system 提示词：角色 prompt + 团队上下文 + 输出纪律。 */
export declare function buildSystem(team: Team, role: Role, synthesize: boolean): string;
/** 装配一步的用户消息。 */
export declare function buildUserPrompt(team: Team, planned: PlannedStep, task: string, previous: readonly RunStep[], globals: TeamGlobals, chainName: string): string;
/** 产物文件内容（步骤 md）。 */
export declare function renderStepDocument(team: Team, planned: PlannedStep, content: string, meta: {
    provider: string;
    model: string;
    source: string;
    channel: string;
    startedAt: string;
}): string;
/** 最终交付物文件内容。 */
export declare function renderFinalDocument(team: Team, chainName: string, task: string, content: string): string;
