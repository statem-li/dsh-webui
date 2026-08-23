/**
 * automation — host 半身装配入口（参考 openhanako 的 Hub Scheduler + desk cron 路由）。
 *
 * 组成：
 *  - CronStore：任务持久化（${DSH_HOME}/automation/dsh-webui/）
 *  - CronScheduler：服务进程内 60s tick 调度（GUI 关闭也照常触发）
 *  - 执行器：到期任务经 ctx.llm 以绑定模型真实执行
 *  - automation 工具：Agent 可 list / 建议 create / 建议 update
 *  - HTTP 路由：UI 的 CRUD、建议确认、运行历史、完成事件流
 */
import type { Context } from '@deepseek-ai/cordis';
import { ROUTE_PREFIX } from './routes.js';
export declare const AUTOMATION_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** 挂载自动化模块：store + 调度器 + 工具 + 路由（webui 组合调用）。 */
export declare function applyAutomationHost(ctx: Context): void;
export { ROUTE_PREFIX };
