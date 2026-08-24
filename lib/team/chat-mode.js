/**
 * team — 对话框团队开关（host 半身，docs §6.5）。
 *
 * 生效机制（零 DSH 源码改动）：
 *  1. 会话级开关持久化在 ${DSH_HOME}/team/chat-mode.json（sessionId → 状态）。
 *  2. 注册 systemPrompt section `team-mode`：**有任一会话开启**时注入团队编制说明与
 *     调用约定（DSH 的 systemPrompt.section 是全局渲染面，拿不到「当前会话 id」，
 *     因此注入内容按「已开启的会话集合」渲染：单会话开启时直接给该团队详情；
 *     多会话开启时给出各会话对应的团队，并要求模型按当前会话取用）。
 *  3. 模型据此在需要多角色协作时调用 team_run 工具；工具触发天然带 agent 上下文，
 *     角色可走 subagent 通道（有完整工具能力）。
 *  4. 关闭时 text 返回空串 → renderPrompt 自动丢弃，零 token 占用。
 */
/** 团队编制摘要（注入提示词用）。 */
function describeTeam(team, mode) {
    const lines = [];
    lines.push(`### 团队「${team.name}」（id: ${team.id}）`);
    if (team.description !== undefined && team.description !== '')
        lines.push(team.description);
    lines.push('可用角色：');
    for (const role of team.roles) {
        lines.push(`- \`${role.id}\` ${role.name}（${role.en}）：${role.tagline}`);
    }
    if (team.chains.length > 0) {
        lines.push('可用协作链：');
        for (const chain of team.chains) {
            const path = chain.steps
                .map(step => (step.kind === 'synthesize' ? '主脑整合' : (team.roles.find(r => r.id === step.roleId)?.name ?? step.roleId)))
                .join(' → ');
            const tail = chain.finalSynthesize && !chain.steps.some(s => s.kind === 'synthesize') ? ' → 主脑整合' : '';
            lines.push(`- \`${chain.id}\` ${chain.name}：${path}${tail}`);
        }
    }
    if (mode.chainId !== '') {
        lines.push(`本会话已指定链：\`${mode.chainId}\`（调用 team_run 时优先用它）。`);
    }
    else {
        lines.push('本会话未指定链：由你根据任务性质选择最合适的链，或用 roles 参数临时点兵。');
    }
    return lines;
}
/** 组装注入文本。 */
function buildInstruction(entries) {
    const usable = entries.filter(entry => entry.team !== null);
    if (usable.length === 0)
        return '';
    const anyForce = usable.some(entry => entry.mode.force);
    const head = [
        '【团队模式已开启】本会话（或当前若干会话）已开启多智能体团队协作模式。',
    ];
    if (anyForce) {
        head.push('**强制模式**：本会话的每一个实质任务都必须先调用 `team_run` 交给团队执行，'
            + '不要自己直接完成；只有纯粹的闲聊、确认、追问才可直接回答。');
    }
    else {
        head.push('当任务需要多角色协作（调研+审查、方案+落地、诊断+修复+验收、取证+成稿等），'
            + '或任务较复杂需要分工推进时，调用 `team_run` 工具交给团队接力执行；'
            + '简单问答、单步小改动仍直接自己回答，不要绕远路。');
    }
    head.push('调用约定：`team_run { teamId, task, chainId?, roles? }`——task 写清完整目标与验收标准；'
        + '选定链用 chainId，需要自定义分工时用 roles 传角色 id 序列。运行产物会落盘，'
        + '运行进度在对话流上方的团队 HUD 与团队面板中实时可见。', '运行结束后用 `team_status` 取回结果摘要，再基于最终交付物回答用户。', '');
    if (usable.length === 1) {
        const entry = usable[0];
        head.push(...describeTeam(entry.team, entry.mode));
        head.push(`调用 team_run 时传 teamId: \`${entry.team.id}\`。`);
        return head.join('\n');
    }
    head.push('当前开启团队模式的会话与对应团队：');
    for (const entry of usable) {
        head.push(`- 会话 \`${entry.sessionId}\` → 团队 \`${entry.team.id}\`（${entry.team.name}）`);
    }
    head.push('', '（按当前所在会话选用对应团队；各团队编制如下。）', '');
    for (const entry of usable) {
        head.push(...describeTeam(entry.team, entry.mode), '');
    }
    return head.join('\n');
}
/**
 * 注册团队模式的系统提示词注入。返回 dispose。
 *
 * 读取开销：每次渲染读一次 chat-mode.json + 已开启会话的团队文件；
 * 用 300ms 缓存避免同一轮多次渲染重复读盘。
 */
export function applyTeamChatMode(ctx, store) {
    let cache = null;
    const CACHE_MS = 300;
    const render = () => {
        const now = Date.now();
        if (cache !== null && now - cache.at < CACHE_MS)
            return cache.text;
        let text = '';
        try {
            const modes = store.readChatModes();
            const entries = [];
            for (const [sessionId, mode] of Object.entries(modes)) {
                if (!mode.enabled)
                    continue;
                const result = mode.teamId !== ''
                    ? store.tryReadTeam(mode.teamId)
                    : (() => {
                        try {
                            return { team: store.resolveTeam() };
                        }
                        catch {
                            return { issue: 'no team' };
                        }
                    })();
                entries.push({ sessionId, mode, team: 'team' in result ? result.team : null });
            }
            text = buildInstruction(entries);
        }
        catch {
            text = '';
        }
        cache = { at: now, text };
        return text;
    };
    const dispose = ctx.effect(() => ctx.systemPrompt.section({
        name: 'team-mode',
        order: -30,
        text: () => render(),
    }), 'webui: team chat mode prompt');
    return typeof dispose === 'function' ? dispose : () => { };
}
//# sourceMappingURL=chat-mode.js.map