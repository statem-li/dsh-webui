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
export function registerAutomationTool({ ctx, store, suggestions, isAutoApprove }) {
    const dispose = ctx.tools.register(defineTool({
        name: 'automation',
        description: [
            '创建与更新定时自动化任务（后台定时执行一段你写好的指令）。动作：',
            'list=列出全部任务；create=新建（默认生成待用户确认的建议，确认后生效）；',
            'update=修改现有任务（同样需用户确认）。调度类型：at=一次性(ISO时间)、',
            'every=固定间隔(分钟)、cron=5字段表达式「分 时 日 月 周」。任务到期时系统',
            '会用绑定模型真实执行 prompt 并记录运行历史。',
        ].join(''),
        parameters: {
            action: { type: 'string', enum: ['list', 'create', 'update'], required: true, description: '要执行的动作。create/update 生成待确认建议而不是直接保存。' },
            id: { type: 'string', description: 'update 动作的目标任务 id。' },
            scheduleType: { type: 'string', enum: ['at', 'every', 'cron'], description: '触发类型。' },
            schedule: { type: 'string', description: '触发计划：every 用分钟数；cron 用 5 字段表达式；at 用 ISO 时间字符串。' },
            label: { type: 'string', description: '简短显示名。' },
            prompt: { type: 'string', description: '任务触发时要执行的内容（发给模型的指令）。' },
            model: { type: 'string', description: '可选执行模型，格式 provider/model；留空使用默认模型。' },
        },
        async execute(args, _exec) {
            const params = args;
            try {
                if (params.action === 'list') {
                    const jobs = store.listJobs();
                    return jobs.length === 0
                        ? '当前没有任何定时自动化任务。'
                        : JSON.stringify(jobs.map(presentJob), null, 2);
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
            title: `${args.action === 'list' ? '查看定时自动化' : args.action === 'create' ? '建议新建定时自动化' : '建议修改定时自动化'}`,
            rawInput: args,
        }),
    }));
    return dispose;
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