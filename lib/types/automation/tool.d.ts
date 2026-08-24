/**
 * automation — Agent 工具（参考 openhanako automation-tool）。
 *
 * 给 Agent 提供 list / create / update 三个动作：
 *  - list：返回全部任务 JSON；
 *  - create/update：默认生成一条「待确认建议」（UI 确认卡），用户应用后才
 *    写入 CronStore——AI 不能绕过用户直接落盘；autoApprove 开启时直接提交。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CronStore } from './store.js';
import type { CronScheduler } from './scheduler.js';
import type { AutomationSuggestionStore } from './suggestions.js';
export interface AutomationToolDeps {
    ctx: Context;
    store: CronStore;
    suggestions: AutomationSuggestionStore;
    /** 调度器读取面（用于 run / status；llm 不可用时为 null）。 */
    scheduler?: () => CronScheduler | null;
    /** true = create/update 直接提交，不生成待确认建议。 */
    isAutoApprove?: () => boolean;
}
/** 注册 automation 工具；返回 disposer（由调用方合并管理）。 */
export declare function registerAutomationTool({ ctx, store, suggestions, scheduler, isAutoApprove }: AutomationToolDeps): () => void;
