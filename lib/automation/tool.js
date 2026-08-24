/**
 * automation — Agent 工具（参考 openhanako automation-tool）。
 *
 * 给 Agent 提供 list / create / update 三个动作：
 *  - list：返回全部任务 JSON；
 *  - create/update：默认生成一条「待确认建议」（UI 确认卡），用户应用后才
 *    写入 CronStore——AI 不能绕过用户直接落盘；autoApprove 开启时直接提交。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { CodedError, normalizeModelRef } from './types.js';
/** every 类型工具入参单位是分钟。 */
const TOOL_EVERY_UNIT_MS = 60_000;
/** 解析并规范化工具的调度入参。 */
function normalizeSchedule(params, existing) {
    const rawType = params.scheduleType ?? undefined;
    const type = validateType(rawType ?? existing?.type);
    let schedule = params.schedule ?? existing?.schedule;
    if (schedule === undefined || schedule === null || schedule === '') {
        throw new Error('scheduleType 和 schedule 都是必填');
    }
    if (type === 'every') {
        const minutes = Number.parseInt(String(schedule), 10);
        if (Number.isNaN(minutes) || minutes <= 0) {
            throw new Error('every 类型的 schedule 必须是正整数分钟数');
        }
        schedule = minutes * TOOL_EVERY_UNIT_MS;
    }
    return { type, schedule: schedule };
}
function validateType(value) {
    if (value !== 'at' && value !== 'every' && value !== 'cron') {
        throw new Error(`无效的调度类型 "${String(value)}"，必须是 at / every / cron`);
    }
    return value;
}
/** 显示名：显式 label > prompt 前 40 字。 */
function labelFor(params, prompt) {
    if (typeof params.label === 'string' && params.label.trim() !== '')
        return params.label.trim();
    return prompt.slice(0, 40);
}
/** 从工具入参构造建议草稿数据。 */
function buildJobData(params, type, schedule) {
    const prompt = typeof params.prompt === 'string' ? params.prompt : '';
    return {
        type,
        schedule,
        prompt,
        label: labelFor(params, prompt),
        model: normalizeModelRef(params.model),
    };
}
/** 注册 automation 工具；返回 disposer（由调用方合并管理）。 */
export function registerAutomationTool({ ctx, store, suggestions, scheduler, isAutoApprove }) {
    const dispose = ctx.tools.register(defineTool({
        name: 'automation',
        description: [
            '管理定时自动化任务（后台定时执行一段你写好的指令）。动作：',
            'list=列出全部任务（含是否正在执行）；create=新建（默认生成待用户确认的建议，确认后生效）；',
            'update=修改现有任务（同样需用户确认）；enable/disable=启用或停用某任务；',
            'delete=删除某任务；run=立即执行一次（不影响定时游标）；runs=查看某任务的运行历史。',
            '调度类型：at=一次性(ISO时间)、every=固定间隔(分钟)、cron=5字段表达式「分 时 日 月 周」。',
            '任务到期时系统会用绑定模型真实执行 prompt 并记录运行历史。',
        ].join(''),
        parameters: {
            action: {
                type: 'string',
                enum: ['list', 'create', 'update', 'enable', 'disable', 'delete', 'run', 'runs'],
                required: true,
                description: '要执行的动作。create/update 生成待确认建议而不是直接保存；enable/disable/delete/run 立即生效。',
            },
            id: { type: 'string', description: 'update / enable / disable / delete / run / runs 动作的目标任务 id。' },
            scheduleType: { type: 'string', enum: ['at', 'every', 'cron'], description: '触发类型。' },
            schedule: { type: 'string', description: '触发计划：every 用分钟数；cron 用 5 字段表达式；at 用 ISO 时间字符串。' },
            label: { type: 'string', description: '简短显示名。' },
            prompt: { type: 'string', description: '任务触发时要执行的内容（发给模型的指令）。' },
            model: { type: 'string', description: '可选执行模型，格式 provider/model；留空使用默认模型。' },
            limit: { type: 'number', description: 'runs 动作返回的记录条数（默认 5，最大 20）。' },
        },
        async execute(args, _exec) {
            const params = args;
            const requireId = () => {
                const id = typeof params.id === 'string' ? params.id.trim() : '';
                if (id === '')
                    throw new Error(`${String(params.action)} 需要 id 参数（先用 action:"list" 查 id）`);
                return id;
            };
            try {
                if (params.action === 'list') {
                    const jobs = store.listJobs();
                    if (jobs.length === 0)
                        return '当前没有任何定时自动化任务。';
                    const running = new Set(scheduler?.()?.runningIds() ?? []);
                    return JSON.stringify(jobs.map(job => ({ ...presentJob(job), running: running.has(job.id) })), null, 2);
                }
                if (params.action === 'enable' || params.action === 'disable') {
                    const id = requireId();
                    const current = store.getJob(id);
                    if (current === null)
                        throw new Error(`找不到自动化任务：${id}`);
                    const want = params.action === 'enable';
                    if (current.enabled === want) {
                        return `任务「${current.label}」已经是${want ? '启用' : '停用'}状态。`;
                    }
                    const job = store.toggleJob(id);
                    // 停用后的 nextRunAt 是残留值，别报给模型（会被当成「还会触发」）。
                    const next = job?.enabled === true && job.nextRunAt !== null ? `，下次触发 ${job.nextRunAt}` : '';
                    return `已${want ? '启用' : '停用'}任务「${job?.label ?? id}」${next}。`;
                }
                if (params.action === 'delete') {
                    const id = requireId();
                    const current = store.getJob(id);
                    if (current === null)
                        throw new Error(`找不到自动化任务：${id}`);
                    store.removeJob(id);
                    return `已删除任务「${current.label}」(${id})，其运行历史与产出也一并清理。`;
                }
                if (params.action === 'run') {
                    const id = requireId();
                    const engine = scheduler?.() ?? null;
                    if (engine === null)
                        throw new Error('模型服务不可用，当前无法执行任务');
                    const current = store.getJob(id);
                    if (current === null)
                        throw new Error(`找不到自动化任务：${id}`);
                    const result = await engine.runNow(id);
                    const status = String(result.status ?? 'unknown');
                    if (status === 'success') {
                        return `任务「${current.label}」已执行完成。输出摘要：${truncate(String(result.summary ?? ''), 300)}`;
                    }
                    if (status === 'error')
                        throw new Error(`任务执行失败：${String(result.error ?? '未知错误')}`);
                    return `任务「${current.label}」本次未执行（${String(result.reason ?? status)}）。`;
                }
                if (params.action === 'runs') {
                    const id = requireId();
                    const current = store.getJob(id);
                    if (current === null)
                        throw new Error(`找不到自动化任务：${id}`);
                    const limit = Math.max(1, Math.min(20, Number.parseInt(String(params.limit ?? 5), 10) || 5));
                    const runs = store.getRunHistory(id, limit).reverse();
                    if (runs.length === 0)
                        return `任务「${current.label}」还没有运行记录。`;
                    return JSON.stringify(runs.map(presentRun), null, 2);
                }
                if (params.action !== 'create' && params.action !== 'update') {
                    throw new Error(`未知动作：${String(params.action)}`);
                }
                const operation = params.action;
                let existing = null;
                if (operation === 'update') {
                    const id = typeof params.id === 'string' ? params.id.trim() : '';
                    if (id === '')
                        throw new Error('update 需要 id 参数');
                    existing = store.getJob(id);
                    if (existing === null)
                        throw new Error(`找不到自动化任务：${id}`);
                }
                const { type, schedule } = normalizeSchedule(params, existing);
                const jobData = buildJobData(params, type, schedule);
                const commit = () => {
                    if (operation === 'update' && existing !== null) {
                        const fields = { ...jobData };
                        delete fields.id;
                        return store.updateJob(existing.id, fields);
                    }
                    return store.addJob({
                        type: jobData.type,
                        schedule: jobData.schedule,
                        prompt: jobData.prompt ?? '',
                        label: jobData.label,
                        model: jobData.model,
                        enabled: true,
                    });
                };
                // autoApprove：直接提交。
                if (isAutoApprove?.() === true) {
                    const job = commit();
                    return `自动化任务已${operation === 'update' ? '更新' : '创建'}：${job?.label ?? ''} (${job?.id ?? ''})`;
                }
                // 默认：登记待确认建议，等待用户在 UI 上应用。
                const suggestion = suggestions.create({
                    operation,
                    jobId: operation === 'update' ? existing?.id ?? null : null,
                    baseConfigRevision: operation === 'update' ? existing?.configRevision ?? null : null,
                    jobData,
                    apply: ({ receipt }) => {
                        if (operation === 'update' && existing !== null) {
                            const current = store.getJob(existing.id);
                            if (current === null) {
                                throw new CodedError('自动化任务已不存在', 'cron_job_revision_conflict', 410);
                            }
                            if (receipt.baseConfigRevision !== null && current.configRevision !== receipt.baseConfigRevision) {
                                throw new CodedError('任务在建议创建后已被修改，请重新发起', 'cron_job_revision_conflict');
                            }
                            const fields = { ...jobData };
                            return store.updateJob(existing.id, fields);
                        }
                        return store.addJob({
                            type: jobData.type,
                            schedule: jobData.schedule,
                            prompt: jobData.prompt ?? '',
                            label: jobData.label,
                            model: jobData.model,
                            enabled: true,
                        });
                    },
                });
                return [
                    `我准备了一项自动任务建议（建议ID：${suggestion.shortCode}），等你确认后再创建。`,
                    `内容概要：${jobData.label || '(无标题)'}｜${describeSchedule(type, schedule)}｜执行内容：${truncate(jobData.prompt ?? '', 120)}`,
                    '请在自动化面板中查看并确认这条建议；确认前任务不会创建。',
                ].join('\n');
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw Object.assign(new Error(message), { suppressStackTrace: true });
            }
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: args => ({
            card: 'generic',
            kind: 'other',
            title: TOOL_CALL_TITLES[String(args.action)] ?? '定时自动化',
            rawInput: args,
        }),
    }));
    return dispose;
}
/** 工具调用卡片标题（按动作）。 */
const TOOL_CALL_TITLES = {
    list: '查看定时自动化',
    create: '建议新建定时自动化',
    update: '建议修改定时自动化',
    enable: '启用定时自动化',
    disable: '停用定时自动化',
    delete: '删除定时自动化',
    run: '立即执行定时自动化',
    runs: '查看自动化运行记录',
};
/** 给模型看的运行记录视图。 */
function presentRun(run) {
    return {
        status: run.status,
        at: run.timestamp,
        trigger: run.trigger ?? 'schedule',
        ...(run.model !== undefined ? { model: run.model } : {}),
        ...(run.summary !== undefined ? { summary: truncate(run.summary, 200) } : {}),
        ...(run.error !== undefined ? { error: run.error } : {}),
        ...(run.reason !== undefined ? { reason: run.reason } : {}),
    };
}
/** 给模型看的任务视图（裁掉内部字段噪音）。 */
function presentJob(job) {
    return {
        id: job.id,
        label: job.label,
        type: job.type,
        schedule: job.schedule,
        prompt: job.prompt,
        model: typeof job.model === 'object' ? `${job.model.provider ?? ''}/${job.model.id}`.replace(/^\//, '') : '',
        enabled: job.enabled,
        nextRunAt: job.nextRunAt,
        lastRunAt: job.lastRunAt,
        consecutiveErrors: job.consecutiveErrors,
    };
}
/** 面向用户的调度描述。 */
function describeSchedule(type, schedule) {
    if (type === 'at')
        return String(schedule);
    if (type === 'every') {
        const ms = typeof schedule === 'number' ? schedule : Number.parseInt(String(schedule), 10);
        const minutes = Math.round(ms / 60_000);
        return minutes % 60 === 0 && minutes >= 60 ? `每 ${minutes / 60} 小时` : `每 ${minutes} 分钟`;
    }
    return `cron(${String(schedule)})`;
}
function truncate(text, max) {
    return text.length > max ? text.slice(0, max) + '…' : text;
}
//# sourceMappingURL=tool.js.map