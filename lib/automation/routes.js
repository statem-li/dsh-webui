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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';
import { CodedError, normalizeModelRef } from './types.js';
import { automationDataRoot } from './store.js';
export const ROUTE_PREFIX = '/api/webui-automation';
/** 完成事件环形缓冲上限。 */
const EVENT_BUFFER_MAX = 50;
/** 创建完成事件环形缓冲（上限 50 条）。 */
export function createAutomationEventBuffer() {
    let seq = 0;
    const buffer = [];
    return {
        push(job, result) {
            const status = result.status === 'success' || result.status === 'error' || result.status === 'skipped'
                ? result.status
                : 'skipped';
            seq += 1;
            buffer.push({
                seq,
                at: Date.now(),
                jobId: job.id,
                jobLabel: job.label,
                status,
                ...(typeof result.summary === 'string' ? { summary: result.summary } : {}),
                ...(typeof result.error === 'string' ? { error: result.error } : {}),
            });
            if (buffer.length > EVENT_BUFFER_MAX)
                buffer.splice(0, buffer.length - EVENT_BUFFER_MAX);
        },
        since(sinceSeq) {
            const events = buffer.filter(event => event.seq > sinceSeq);
            return { events, cursor: seq };
        },
    };
}
function isLoopbackAddress(address) {
    if (typeof address !== 'string')
        return false;
    const a = address.toLowerCase();
    if (a === '::1')
        return true;
    const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a;
    const octets = ipv4.split('.');
    return octets.length === 4 && octets[0] === '127'
        && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function hostNameOf(value) {
    if (typeof value !== 'string')
        return null;
    const host = value.trim().toLowerCase();
    if (host.startsWith('[')) {
        const close = host.indexOf(']');
        if (close <= 1)
            return null;
        return host.slice(1, close);
    }
    const firstColon = host.indexOf(':');
    const lastColon = host.lastIndexOf(':');
    if (firstColon !== lastColon)
        return null;
    return firstColon === -1 ? host : host.slice(0, firstColon);
}
function loopbackAllowed(req) {
    if (!isLoopbackAddress(req.socket.remoteAddress))
        return false;
    const host = hostNameOf(req.headers.host);
    if (host === null)
        return false;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function json(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
    });
    res.end(body);
}
function readBody(req) {
    return new Promise((resolvePromise, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 1024 * 1024) {
                reject(new Error('request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) {
                resolvePromise({});
                return;
            }
            try {
                resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch {
                reject(new Error('invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}
/** 把 store/suggestion 错误映射为 HTTP 状态码。 */
function errorStatus(error) {
    if (error instanceof CodedError)
        return error.status;
    return 400;
}
// ── 入参归一化 ──────────────────────────────────────────────────────────
function validateType(value) {
    if (value !== 'at' && value !== 'every' && value !== 'cron') {
        throw new Error(`无效的调度类型 "${String(value)}"，必须是 at / every / cron`);
    }
    return value;
}
/** HTTP 层的 every 单位与存储一致（毫秒），但兼容 UI 传来的分钟数（everyMinutes 别名）。 */
function normalizeScheduleForWrite(type, schedule) {
    if (type === 'every') {
        const ms = typeof schedule === 'number' ? schedule : Number.parseInt(String(schedule), 10);
        if (!Number.isFinite(ms) || ms <= 0)
            throw new Error(`无效的 every schedule："${String(schedule)}"`);
        // 兼容：小于 60 的值视为分钟（UI 旧协议），否则视为毫秒。
        return ms < 60_000 ? ms * 60_000 : ms;
    }
    if (type === 'at')
        return String(schedule);
    return String(schedule).trim();
}
/** 注册全部自动化路由；返回 disposer。 */
export function registerAutomationRoutes({ webServer, store, suggestions, events, scheduler, settings }) {
    /** 任务列表 + 运行中 id（所有变更动作统一回这份最新快照）。 */
    function jobsPayload() {
        return { jobs: store.listJobs(), running: scheduler()?.runningIds() ?? [] };
    }
    async function handle(req, res) {
        if (!loopbackAllowed(req)) {
            json(res, 403, { ok: false, error: 'loopback-only' });
            return;
        }
        const url = new URL(req.url ?? '/', 'http://localhost');
        const rest = url.pathname.slice(ROUTE_PREFIX.length);
        const method = req.method ?? 'GET';
        try {
            // ── 任务列表（附带「正在执行」的任务 id，UI 显示运行中态）──
            if (method === 'GET' && rest === '/cron') {
                json(res, 200, { ok: true, jobs: store.listJobs(), running: scheduler()?.runningIds() ?? [] });
                return;
            }
            // ── 任务操作 ──
            if (method === 'POST' && rest === '/cron') {
                const body = await readBody(req);
                const params = body;
                switch (body.action) {
                    case 'add': {
                        const type = validateType(params.scheduleType ?? params.type);
                        const requiresPrompt = params.enabled !== false;
                        if ((params.schedule === undefined || params.schedule === null || params.schedule === '')
                            || (requiresPrompt && typeof params.prompt !== 'string')) {
                            json(res, 400, { ok: false, error: 'scheduleType、schedule、prompt 为必填' });
                            return;
                        }
                        const schedule = normalizeScheduleForWrite(type, params.schedule);
                        const job = store.addJob({
                            type,
                            schedule,
                            prompt: typeof params.prompt === 'string' ? params.prompt : '',
                            label: typeof params.label === 'string' ? params.label : undefined,
                            model: normalizeModelRef(params.model),
                            enabled: params.enabled !== false,
                        });
                        json(res, 200, { ok: true, job, ...jobsPayload() });
                        return;
                    }
                    case 'remove': {
                        const id = typeof params.id === 'string' ? params.id : '';
                        const removed = id !== '' && store.removeJob(id);
                        if (!removed) {
                            json(res, 404, { ok: false, error: `找不到任务 ${id}` });
                            return;
                        }
                        json(res, 200, { ok: true, ...jobsPayload() });
                        return;
                    }
                    case 'toggle': {
                        const id = typeof params.id === 'string' ? params.id : '';
                        const job = id === '' ? null : store.toggleJob(id);
                        if (job === null) {
                            json(res, 404, { ok: false, error: `找不到任务 ${id}` });
                            return;
                        }
                        json(res, 200, { ok: true, job, ...jobsPayload() });
                        return;
                    }
                    case 'update': {
                        const id = typeof params.id === 'string' ? params.id : '';
                        const existing = id === '' ? null : store.getJob(id);
                        if (existing === null) {
                            json(res, 404, { ok: false, error: `找不到任务 ${id}` });
                            return;
                        }
                        const patch = {};
                        if ('label' in params)
                            patch.label = String(params.label ?? '');
                        if ('prompt' in params)
                            patch.prompt = String(params.prompt ?? '');
                        if ('model' in params)
                            patch.model = normalizeModelRef(params.model);
                        if ('enabled' in params)
                            patch.enabled = params.enabled === true;
                        if ('scheduleType' in params || 'type' in params || 'schedule' in params) {
                            const nextType = validateType(('scheduleType' in params ? params.scheduleType : undefined) ?? params.type ?? existing.type);
                            if (nextType !== existing.type && !('schedule' in params)) {
                                throw new Error('修改调度类型时必须同时提供 schedule');
                            }
                            patch.type = nextType;
                            if ('schedule' in params) {
                                patch.schedule = normalizeScheduleForWrite(nextType, params.schedule);
                            }
                        }
                        const job = store.updateJob(id, patch);
                        if (job === null) {
                            json(res, 404, { ok: false, error: `找不到任务 ${id}` });
                            return;
                        }
                        json(res, 200, { ok: true, job, ...jobsPayload() });
                        return;
                    }
                    case 'duplicate': {
                        // 复制一份为停用草稿，便于「改几个字再启用」。
                        const id = typeof params.id === 'string' ? params.id : '';
                        const source = id === '' ? null : store.getJob(id);
                        if (source === null) {
                            json(res, 404, { ok: false, error: `找不到任务 ${id}` });
                            return;
                        }
                        const job = store.addJob({
                            type: source.type,
                            schedule: source.schedule,
                            prompt: source.prompt,
                            label: `${source.label} (副本)`,
                            model: source.model,
                            enabled: false,
                        });
                        json(res, 200, { ok: true, job, ...jobsPayload() });
                        return;
                    }
                    case 'run_now': {
                        // 立即执行：调度器同步派发（不再拨 nextRunAt 等下一 tick——那会
                        // 让用户干等最多 60s，还会把定时游标搅乱）。
                        const id = typeof params.id === 'string' ? params.id : '';
                        const engine = scheduler();
                        if (engine === null) {
                            json(res, 503, { ok: false, error: '模型服务不可用，无法执行任务' });
                            return;
                        }
                        if (id === '' || store.getJob(id) === null) {
                            json(res, 404, { ok: false, error: `找不到任务 ${id}` });
                            return;
                        }
                        // 不等执行完（可能跑几分钟）：立刻回执，UI 靠 /cron 的 running
                        // 与 /events 观察结果。
                        const started = engine.runNow(id);
                        started.catch(() => { });
                        // 同步阶段的错误（busy / 空 prompt）在下一个 microtask 前已抛出，
                        // 这里用 Promise.race 抢一拍拿到它，避免「点了没反应」。
                        const immediate = await Promise.race([
                            started.then(() => null, (error) => error),
                            new Promise(resolve => { setTimeout(() => resolve(null), 0); }),
                        ]);
                        if (immediate !== null) {
                            const message = immediate instanceof Error ? immediate.message : String(immediate);
                            const status = immediate.code === 'job_busy' ? 409 : 400;
                            json(res, status, { ok: false, error: message });
                            return;
                        }
                        json(res, 200, { ok: true, ...jobsPayload() });
                        return;
                    }
                    case 'cancel': {
                        // 中止正在执行的任务（长任务点错了不必干等 20 分钟超时）。
                        const id = typeof params.id === 'string' ? params.id : '';
                        const engine = scheduler();
                        if (engine === null || id === '' || !engine.cancel(id)) {
                            json(res, 409, { ok: false, error: '该任务当前没有正在执行的运行' });
                            return;
                        }
                        json(res, 200, { ok: true, ...jobsPayload() });
                        return;
                    }
                    case 'clear_runs': {
                        // 清空某任务的运行历史与完整产出（保留任务本体）。
                        const id = typeof params.id === 'string' ? params.id : '';
                        if (id === '' || store.getJob(id) === null) {
                            json(res, 404, { ok: false, error: `找不到任务 ${id}` });
                            return;
                        }
                        store.clearRunHistory(id);
                        json(res, 200, { ok: true, runs: [] });
                        return;
                    }
                    case 'apply_suggestion': {
                        const ref = typeof params.suggestionId === 'string' && params.suggestionId.trim() !== ''
                            ? params.suggestionId.trim()
                            : typeof params.ref === 'string' ? params.ref : null;
                        const applied = await suggestions.apply({
                            ref,
                            value: isPlainObject(params.jobData) ? params.jobData : undefined,
                        });
                        if (!applied.ok) {
                            const message = applied.reason === 'already-applying' ? '建议正在应用中'
                                : applied.reason === 'expired' ? '建议已过期，请让助手重新发起'
                                    : '建议不存在或已失效';
                            json(res, applied.reason === 'already-applying' ? 409 : 410, { ok: false, error: message, reason: applied.reason });
                            return;
                        }
                        json(res, 200, { ok: true, job: applied.result, jobs: store.listJobs(), suggestions: suggestions.list() });
                        return;
                    }
                    default:
                        json(res, 400, { ok: false, error: `未知动作：${String(body.action)}` });
                }
                return;
            }
            // ── 运行历史（一律「新 → 旧」返回；含状态筛选）──
            if (method === 'GET' && rest === '/runs') {
                const limit = clampLimit(url.searchParams.get('limit'), 20);
                const statusFilter = url.searchParams.get('status');
                const keep = (run) => statusFilter === null || statusFilter === '' || statusFilter === 'all' || run.status === statusFilter;
                const jobId = url.searchParams.get('jobId');
                if (jobId !== null && jobId !== '') {
                    // store 按追加序（旧→新）返回，这里倒置——原实现让「最近 5 条」
                    // 实际显示的是最老的 5 条。
                    const runs = store.getRunHistory(jobId, limit).filter(keep).reverse();
                    json(res, 200, { ok: true, runs });
                    return;
                }
                // 无 jobId：返回全部任务的最近记录合并视图（新→旧），带任务名。
                const jobs = store.listJobs();
                const labelOf = new Map(jobs.map(job => [job.id, job.label]));
                const all = [];
                for (const job of jobs) {
                    for (const run of store.getRunHistory(job.id, limit)) {
                        if (keep(run))
                            all.push({ ...run, jobId: job.id, jobLabel: labelOf.get(job.id) ?? job.id });
                    }
                }
                all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
                json(res, 200, { ok: true, runs: all.slice(0, limit) });
                return;
            }
            // ── 运行产出全文 ──
            if (method === 'GET' && rest === '/runs/file') {
                const jobId = url.searchParams.get('jobId') ?? '';
                const name = url.searchParams.get('name') ?? '';
                if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
                    json(res, 400, { ok: false, error: 'invalid jobId' });
                    return;
                }
                // 文件名只允许「数字字母下划线连字符点」，且必须以 .md 结尾，防穿越。
                if (!/^[A-Za-z0-9_-]+\.md$/.test(name)) {
                    json(res, 400, { ok: false, error: 'invalid file name' });
                    return;
                }
                try {
                    const content = readFileSync(join(automationDataRoot(), 'runs', jobId, name), 'utf-8');
                    json(res, 200, { ok: true, content });
                }
                catch {
                    json(res, 404, { ok: false, error: '产出文件不存在或已被清理' });
                }
                return;
            }
            // ── 待确认建议 ──
            if (method === 'GET' && rest === '/suggestions') {
                json(res, 200, { ok: true, suggestions: suggestions.list() });
                return;
            }
            if (method === 'POST' && rest === '/suggestions') {
                const body = await readBody(req);
                const ref = typeof body.suggestionId === 'string' ? body.suggestionId : '';
                const dismissed = ref !== '' && body.action === 'dismiss' && suggestions.dismiss(ref);
                if (!dismissed) {
                    json(res, 404, { ok: false, error: '建议不存在或已失效' });
                    return;
                }
                json(res, 200, { ok: true, suggestions: suggestions.list() });
                return;
            }
            // ── 设置（AI 免确认开关）──
            if (rest === '/settings') {
                if (method === 'POST') {
                    const body = await readBody(req);
                    if (typeof body.autoApprove === 'boolean') {
                        await settings.write({ autoApprove: body.autoApprove });
                    }
                }
                else if (method !== 'GET') {
                    json(res, 405, { ok: false, error: 'method not allowed' });
                    return;
                }
                json(res, 200, { ok: true, ...settings.read() });
                return;
            }
            // ── 完成事件流（供全局 toast 轮询）──
            if (method === 'GET' && rest === '/events') {
                const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10) || 0;
                const { events: pending, cursor } = events.since(since);
                json(res, 200, { ok: true, events: pending, cursor });
                return;
            }
            json(res, 404, { ok: false, error: `no route for ${method} ${rest}` });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            json(res, errorStatus(error), { ok: false, error: message });
        }
    }
    const dispose = webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => { void handle(req, res); },
    });
    return dispose;
}
function clampLimit(raw, fallback) {
    const value = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(value) || value <= 0)
        return fallback;
    return Math.min(100, value);
}
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
//# sourceMappingURL=routes.js.map