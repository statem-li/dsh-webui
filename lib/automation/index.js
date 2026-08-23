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
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { CronStore } from './store.js';
import { AutomationSuggestionStore } from './suggestions.js';
import { createCronScheduler } from './scheduler.js';
import { executeJob as runJob } from './executor.js';
import { registerAutomationTool } from './tool.js';
import { ROUTE_PREFIX, createAutomationEventBuffer, registerAutomationRoutes, } from './routes.js';
export const AUTOMATION_SETTINGS_NAMESPACE = settingsNamespace('webui-automation');
function readAutoApprove(ctx) {
    try {
        const config = ctx.settings?.get?.(AUTOMATION_SETTINGS_NAMESPACE);
        return config?.autoApprove === true;
    }
    catch {
        return false;
    }
}
/** 挂载自动化模块：store + 调度器 + 工具 + 路由（webui 组合调用）。 */
export function applyAutomationHost(ctx) {
    const webServer = ctx.get('webServer');
    if (webServer === undefined)
        return;
    const store = new CronStore();
    const suggestions = new AutomationSuggestionStore();
    const events = createAutomationEventBuffer();
    // ── HTTP 路由 ──
    const disposeRoutes = registerAutomationRoutes({ ctx, webServer, store, suggestions, events });
    // ── Agent 工具 ──
    let disposeTool = null;
    try {
        disposeTool = registerAutomationTool({
            ctx,
            store,
            suggestions,
            isAutoApprove: () => readAutoApprove(ctx),
        });
    }
    catch {
        // tools 服务不可达时仅降级 UI/HTTP 能力，不影响调度执行。
    }
    // ── 调度器 ──
    const llm = ctx.get('llm');
    const executing = new Map();
    let scheduler = null;
    if (llm !== undefined) {
        scheduler = createCronScheduler({
            store,
            executeJob: (job) => {
                const ac = new AbortController();
                executing.set(job.id, ac);
                return runJob(ctx, llm, job, ac.signal).finally(() => {
                    executing.delete(job.id);
                });
            },
            abortJob: (job) => {
                executing.get(job.id)?.abort();
            },
            onJobDone: (job, result) => {
                events.push(job, result);
                const status = typeof result.status === 'string' ? result.status : 'skipped';
                if (status === 'error') {
                    ctx.logger?.warn?.(`[webui-automation] 任务失败 ${job.label} (${job.id}): ${String(result.error ?? '')}`);
                }
                else if (status === 'success') {
                    ctx.logger?.info?.(`[webui-automation] 任务完成 ${job.label} (${job.id})`);
                }
            },
        });
        scheduler.start();
    }
    else {
        ctx.logger?.warn?.('[webui-automation] llm 服务不可用，调度器未启动（CRUD 与建议仍可用）');
    }
    ctx.effect(() => () => {
        void scheduler?.stop();
        scheduler = null;
        disposeTool?.();
        disposeTool = null;
        disposeRoutes();
    }, 'webui: automation host');
}
export { ROUTE_PREFIX };
//# sourceMappingURL=index.js.map