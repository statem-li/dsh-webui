/**
 * automation — HTTP 路由（host 半身，loopback-only）。
 *
 * 语义对齐 openhanako 的 /desk/cron（GET 列表 + POST action 分发）：
 *   GET  /api/webui-automation/cron                 → { jobs }
 *   POST /api/webui-automation/cron                 → { action, ...params }
 *         add / remove / toggle / update / apply_suggestion
 *   GET  /api/webui-automation/runs?jobId=&limit=   → { runs }（运行历史）
 *   GET  /api/webui-automation/suggestions          → { suggestions }（待确认建议）
 *   POST /api/webui-automation/suggestions          → { action: dismiss|apply }
 *   GET  /api/webui-automation/events?since=<seq>   → { events }（完成事件，供 toast）
 *   GET  /api/webui-automation/settings             → { autoApprove }
 *   POST /api/webui-automation/settings             → { autoApprove }（写入 settings.yaml）
 *
 * POST /cron 支持的 action：
 *   add / remove / toggle / update / duplicate / run_now / cancel / clear_runs /
 *   apply_suggestion
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { type CronJob } from './types.js';
import { type CronStore } from './store.js';
import type { CronScheduler } from './scheduler.js';
import type { AutomationSuggestionStore } from './suggestions.js';
export declare const ROUTE_PREFIX = "/api/webui-automation";
interface WebServerRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void;
}
interface WebServerLike {
    register(route: WebServerRoute): () => void;
}
/** onJobDone 广播给前端的事件。 */
export interface AutomationEvent {
    seq: number;
    at: number;
    jobId: string;
    jobLabel: string;
    status: 'success' | 'error' | 'skipped';
    summary?: string;
    error?: string;
}
/** 完成事件环：scheduler 推入，前端轮询拉取。 */
export interface AutomationEventBuffer {
    push: (job: CronJob, result: Record<string, unknown>) => void;
    since: (seq: number) => {
        events: AutomationEvent[];
        cursor: number;
    };
}
/** 创建完成事件环形缓冲（上限 50 条）。 */
export declare function createAutomationEventBuffer(): AutomationEventBuffer;
export interface RouteDeps {
    ctx: Context;
    webServer: WebServerLike;
    store: CronStore;
    suggestions: AutomationSuggestionStore;
    events: AutomationEventBuffer;
    /** 调度器读取面（llm 不可用时为 null：立即运行/中止降级为 503）。 */
    scheduler: () => CronScheduler | null;
    /** 设置读写面（settings.yaml 持久化的 autoApprove）。 */
    settings: {
        read: () => {
            autoApprove: boolean;
        };
        write: (patch: {
            autoApprove?: boolean;
        }) => Promise<void>;
    };
}
/** 注册全部自动化路由；返回 disposer。 */
export declare function registerAutomationRoutes({ webServer, store, suggestions, events, scheduler, settings }: RouteDeps): () => void;
export {};
