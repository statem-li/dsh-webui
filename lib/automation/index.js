/**
 * automation — host 半身装配入口（参考 openhanako 的 Hub Scheduler + desk cron 路由）。
 *
 * 组成：
 *  - CronStore：任务持久化（${DSH_HOME}/automation/dsh-webui/）
 *  - CronScheduler：服务进程内 60s tick 调度（GUI 关闭也照常触发）
 *  - 执行器：到期任务经 ctx.llm 以绑定模型真实执行
 *  - automation 工具：Agent 可 list / 建议 create / 建议 update / 立即运行
 *  - HTTP 路由：UI 的 CRUD、建议确认、运行历史、完成事件流
 *
 * 「立即运行」由调度器同步派发（不再靠拨 nextRunAt 等下一个 tick），
 * 因此路由层需要拿到 scheduler——装配顺序为 store → scheduler → routes。
 */
import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { CronStore } from './store.js';
import { AutomationSuggestionStore } from './suggestions.js';
import { createCronScheduler } from './scheduler.js';
import { executeJob as runJob } from './executor.js';
import { registerAutomationTool } from './tool.js';
import { ROUTE_PREFIX, createAutomationEventBuffer, registerAutomationRoutes, } from './routes.js';
export const AUTOMATION_SETTINGS_NAMESPACE = settingsNamespace('webui-automation');
/**
 * 注册 settings 命名空间。原实现只 get 从未 register——命名空间不存在，
 * autoApprove 永远读到 undefined，「AI 免确认」开关形同不存在。
 */
function registerSettings(ctx) {
    try {
        return ctx.settings.register(AUTOMATION_SETTINGS_NAMESPACE, z.object({
            autoApprove: z.boolean().default(false),
        }));
    }
    catch {
        // 已注册（插件被加载两次）：退化为只读。
        return null;
    }
}
function readAutoApprove(ctx, scope) {
    if (scope !== null) {
        try {
            return scope.get().autoApprove === true;
        }
        catch { /* fallthrough */ }
    }
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
    const settings = registerSettings(ctx);
    // ── 调度器（先于路由：run_now 需要它同步派发执行）──
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
    // ── HTTP 路由 ──
    const disposeRoutes = registerAutomationRoutes({
        ctx,
        webServer,
        store,
        suggestions,
        events,
        scheduler: () => scheduler,
        settings: {
            read: () => ({ autoApprove: readAutoApprove(ctx, settings) }),
            write: async (patch) => {
                if (settings === null)
                    throw new Error('自动化设置不可写（命名空间未注册）');
                await settings.update(patch);
            },
        },
    });
    // ── Agent 工具 ──
    let disposeTool = null;
    try {
        disposeTool = registerAutomationTool({
            ctx,
            store,
            suggestions,
            scheduler: () => scheduler,
            isAutoApprove: () => readAutoApprove(ctx, settings),
        });
    }
    catch {
        // tools 服务不可达时仅降级 UI/HTTP 能力，不影响调度执行。
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