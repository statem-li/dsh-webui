/**
 * team — prompt 装配（host 半身）。
 *
 * 一步的输入 = 角色系统提示词（system）+ 用户消息（任务 + 本步说明 + 上游产出）。
 * 上游注入按 globals.upstreamWindow 与 outputChunkChars 裁剪：
 *  - 'last'        最近一步全量（截断到预算）+ 更早步骤各取摘要头
 *  - 'all-summary' 全部步骤各取摘要头（均分预算）
 */
/** 摘要头长度（'all-summary' 与更早步骤用）。 */
const SUMMARY_HEAD = 1200;
/** 按预算截断文本，超出时标注截断。 */
function clip(text, budget) {
    if (text.length <= budget)
        return text;
    return `${text.slice(0, budget)}\n\n…（已截断，完整内容见产物文件）`;
}
/** 角色的 system 提示词：角色 prompt + 团队上下文 + 输出纪律。 */
export function buildSystem(team, role, synthesize) {
    const roster = team.roles
        .map(r => `- ${r.name}（${r.en}）：${r.tagline}`)
        .join('\n');
    if (synthesize) {
        return [
            role.prompt.trim() !== ''
                ? role.prompt
                : `你是「${role.name}」，团队的协调中枢与最终整合者。`,
            '',
            `## 团队「${team.name}」成员`,
            roster,
            '',
            '## 本步任务：最终整合',
            '你现在处于协作链的最后一步。上游各角色的产出会在用户消息里按顺序给出。',
            '- 整合全部产出，消解彼此矛盾之处（指出冲突并给出取舍理由）。',
            '- 产出面向用户的最终交付物：结论先行，其后是依据与关键细节，最后是遗留问题与建议的下一步。',
            '- 明确标注哪些内容是你补充的（各角色都没覆盖的空白）。',
            '- 直接输出交付物本体，不要复述流程、不要写「好的我来整合」这类开场话。',
        ].join('\n');
    }
    return [
        role.prompt.trim() !== '' ? role.prompt : `你是「${role.name}」，${role.tagline}。`,
        '',
        `## 团队「${team.name}」成员`,
        roster,
        '',
        '## 输出纪律',
        '- 只做你职责范围内的事，其余交回主脑。',
        '- 结论先行，其后是依据与细节，最后列出遗留问题与建议的下一步。',
        '- 不确定处显式标注「待确认」，不要用猜测填充事实。',
        '- 直接输出成果本体，不要写开场寒暄与流程复述。',
    ].join('\n');
}
/** 上游产出注入片段。 */
function buildUpstream(previous, globals) {
    const done = previous.filter(step => step.status === 'done' && step.output.trim() !== '');
    if (done.length === 0)
        return '';
    const budget = globals.outputChunkChars;
    if (globals.upstreamWindow === 'all-summary') {
        const per = Math.max(300, Math.floor(budget / done.length));
        return done.map(step => `### 上游 · ${step.roleName}（第 ${step.index + 1} 步）\n${clip(step.output, per)}`).join('\n\n');
    }
    // 'last'：最近一步全量（占大头），更早步骤各取摘要头。
    const last = done[done.length - 1];
    const earlier = done.slice(0, -1);
    const earlierBudget = earlier.length > 0 ? Math.min(SUMMARY_HEAD, Math.floor(budget / 3 / earlier.length)) : 0;
    const parts = [];
    for (const step of earlier) {
        parts.push(`### 上游摘要 · ${step.roleName}（第 ${step.index + 1} 步）\n${clip(step.output, earlierBudget)}`);
    }
    const lastBudget = earlier.length > 0 ? Math.floor(budget * 2 / 3) : budget;
    parts.push(`### 上游产出 · ${last.roleName}（第 ${last.index + 1} 步，最近一步）\n${clip(last.output, lastBudget)}`);
    return parts.join('\n\n');
}
/** 整合步的上游注入：全部步骤按预算均分。 */
function buildAllOutputs(previous, globals) {
    const done = previous.filter(step => step.output.trim() !== '');
    if (done.length === 0)
        return '（上游没有产出。）';
    const per = Math.max(400, Math.floor(globals.outputChunkChars / done.length));
    return done.map((step) => {
        const state = step.status === 'done' ? '' : `（本步状态：${step.status}）`;
        return `### ${step.roleName} · ${step.tagline}${state}\n${clip(step.output, per)}`;
    }).join('\n\n');
}
/** 装配一步的用户消息。 */
export function buildUserPrompt(team, planned, task, previous, globals, chainName) {
    const stepLabel = `第 ${planned.index + 1} 步 / 共 ${previous.length >= 0 ? '' : ''}`;
    const head = [
        `# 团队协作任务（${team.name} · ${chainName}）`,
        '',
        '## 总任务',
        task.trim() !== '' ? task : '（未提供任务描述）',
        '',
        `## 你的本步职责（${planned.synthesize ? '最终整合' : planned.role.name}）`,
        planned.taskNote !== undefined && planned.taskNote !== ''
            ? planned.taskNote
            : (planned.synthesize ? '整合上游全部产出，形成最终交付物。' : `按你的角色定位（${planned.role.tagline}）推进这个任务。`),
    ];
    void stepLabel;
    const upstream = planned.synthesize
        ? buildAllOutputs(previous, globals)
        : buildUpstream(previous, globals);
    if (upstream !== '') {
        head.push('', '## 上游产出', upstream);
    }
    head.push('', '---', '现在开始你的工作，直接输出成果。');
    return head.join('\n');
}
/** 产物文件内容（步骤 md）。 */
export function renderStepDocument(team, planned, content, meta) {
    return [
        `# ${planned.role.name}（${planned.role.en}）· 第 ${planned.index + 1} 步`,
        '',
        `> 团队：${team.name}｜定位：${planned.role.tagline}`,
        `> 模型：${meta.provider}/${meta.model}（来源：${meta.source}）｜通道：${meta.channel}`,
        `> 开始：${new Date(meta.startedAt).toLocaleString('zh-CN', { hour12: false })}`,
        '',
        '---',
        '',
        content,
        '',
    ].join('\n');
}
/** 最终交付物文件内容。 */
export function renderFinalDocument(team, chainName, task, content) {
    return [
        `# 最终交付物 · ${team.name}`,
        '',
        `> 链条：${chainName}`,
        `> 任务：${task}`,
        `> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        '',
        '---',
        '',
        content,
        '',
    ].join('\n');
}
//# sourceMappingURL=prompts.js.map