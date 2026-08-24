/**
 * automation — 任务执行器（host 半身）。
 *
 * openhanako 的自动化统一作为后台 Agent Run 执行：触发时把 job 包装成一条
 * 「系统定时任务」prompt 交给 Agent 跑。DSH 插件形态下的等价实现：用
 * `ctx.llm.stream` 以任务绑定的模型（缺省回退 agent 当前默认模型）真实执行
 * 该 prompt，返回输出摘要供运行历史展示。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { automationDataRoot } from './store.js';
/** 单次执行的模型输出上限。 */
const RUN_MAX_TOKENS = 8192;
/** 输出摘要截断长度。 */
const SUMMARY_MAX = 200;
/**
 * 解析任务的执行模型：job.model 显式指定优先，否则回退 agent 默认模型。
 * 两者皆缺时抛错（调度器按失败记录）。
 */
export function resolveRunModel(ctx, job) {
    const explicit = typeof job.model === 'object' && job.model !== null && job.model.id !== ''
        ? job.model
        : null;
    if (explicit !== null) {
        return { provider: explicit.provider ?? '', model: explicit.id };
    }
    const defaultModel = ctx.get('agentDefaultModel');
    if (defaultModel !== undefined) {
        try {
            const selection = defaultModel.currentSelection();
            if (typeof selection.provider === 'string' && selection.provider !== ''
                && typeof selection.model === 'string' && selection.model !== '') {
                return { provider: selection.provider, model: selection.model };
            }
        }
        catch {
            // fall through
        }
    }
    throw new Error('未指定模型且无法解析默认模型，请先在任务里绑定模型或在会话中选择默认模型');
}
/** openhanako 同款包装：声明这是系统自动触发的定时任务，防止任务递归创建任务。 */
export function buildCronPrompt(job) {
    return [
        `[定时任务 ${job.id}: ${job.label}]`,
        '',
        '**注意：这是系统自动触发的定时任务，不是用户发来的。**',
        '**不要在执行过程中创建新的定时任务。**',
        '',
        job.prompt,
    ].join('\n');
}
/**
 * 执行一个到期任务：包装 prompt → 调用模型 → 返回 { summary, file }。
 * 抛错即失败（调度器负责退避与落历史）。
 * 成功时把完整产出写入 runs/<jobId>/<yyyy-MM-dd_HHmmss>.md，file 为文件名
 * （供 UI 全文回看）。
 */
export async function executeJob(ctx, llm, job, signal) {
    const { provider, model } = resolveRunModel(ctx, job);
    const prompt = buildCronPrompt(job);
    let output = '';
    const messages = [createUserMessage({
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'plugin', plugin: 'dsh-webui' },
        })];
    for await (const chunk of llm.stream({
        provider,
        model,
        messages,
        system: 'You are executing a scheduled automation task for the user. Complete the task described in the message and output ONLY the final result — no preamble, no meta commentary.',
        maxTokens: RUN_MAX_TOKENS,
        signal,
    })) {
        if (chunk.type === 'text-delta') {
            output += chunk.text ?? '';
            continue;
        }
        if (chunk.type !== 'finish')
            continue;
        const reason = chunk.reason;
        if (reason === undefined)
            continue;
        if (reason.kind === 'error') {
            throw new Error(reason.failure?.message ?? '模型调用失败');
        }
        if (reason.kind === 'aborted') {
            throw new Error('任务已中止');
        }
        if (reason.kind !== 'stop' && reason.kind !== 'max-tokens') {
            throw new Error(`模型未正常结束：${reason.kind}`);
        }
    }
    if (output.trim() === '') {
        throw new Error(`模型未返回内容（${provider}/${model}）`);
    }
    const file = writeRunOutput(job.id, output, provider, model);
    const modelLabel = provider !== '' ? `${provider}/${model}` : model;
    return { summary: summarize(output), model: modelLabel, ...(file !== null ? { file } : {}) };
}
/**
 * 输出摘要：压掉多余空行、截断到 SUMMARY_MAX，超长补省略号——原实现直接
 * slice 会把 Markdown 结构截半，卡片副行显示成乱码般的片段。
 */
function summarize(output) {
    const flat = output.trim().replace(/\s*\n\s*\n\s*/g, ' / ').replace(/\s*\n\s*/g, ' ');
    return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX)}…` : flat;
}
/** 完整产出的文件头（记录触发上下文，方便日后回看）。 */
function renderOutputDocument(output, provider, model) {
    return [
        `> 自动化产出 · ${new Date().toLocaleString('zh-CN', { hour12: false })} · ${provider}/${model}`,
        '',
        '---',
        '',
        output,
        '',
    ].join('\n');
}
/**
 * 把完整产出写入 runs/<jobId>/<stamp>.md；失败不使任务失败（摘要仍在）。
 * 返回文件名（含扩展名），写入失败返回 null。
 */
function writeRunOutput(jobId, output, provider, model) {
    try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const fileName = `${stamp}.md`;
        const dir = join(automationDataRoot(), 'runs', safeDirId(jobId));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, fileName), renderOutputDocument(output, provider, model), 'utf-8');
        return fileName;
    }
    catch {
        return null;
    }
}
/** 目录段安全校验：只允许字母数字下划线连字符。 */
function safeDirId(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value))
        throw new Error(`invalid run dir id: ${value}`);
    return value;
}
//# sourceMappingURL=executor.js.map