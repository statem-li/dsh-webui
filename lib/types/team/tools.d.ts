/**
 * team — Agent 工具（host 半身）。
 *
 * 三个工具：
 *  - team_list：列出可用团队与其角色/链（模型自选合适团队与链）。
 *  - team_run ：启动一次团队接力执行；**同步等待完成**并返回最终交付物摘要
 *               （工具触发天然带 agent 上下文 → 角色可走 subagent 通道，有工具能力）。
 *  - team_status：查看某次/最近一次运行的状态与每步模型来源。
 */
import type { TeamEngine } from './engine.js';
import type { TeamStore } from './store.js';
/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any;
export interface TeamToolDeps {
    ctx: AnyContext;
    store: TeamStore;
    engine: TeamEngine;
}
/** 注册三个团队工具；返回合并 disposer。 */
export declare function registerTeamTools({ ctx, store, engine }: TeamToolDeps): () => void;
export {};
