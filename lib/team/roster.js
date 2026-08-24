/**
 * team — 编制校验 + 模型解析 + providers 枚举投影（host 半身）。
 *
 * 模型解析四级优先级（docs/TEAM-ORCHESTRA.md §3.7）：
 *   1. 本次运行覆盖 run.modelOverrides[roleId]
 *   2. 角色覆盖     role.model
 *   3. 团队默认     team.model
 *   4. 全局兜底     globals.defaultModel → agent 当前默认模型
 *
 * 解析在「每步开始时」做一次并写入 RunStep.modelUsed/modelSource——运行中改团队
 * 模型不影响已在跑的步骤。
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { TeamError, } from './types.js';
/**
 * 读 DSH 内置 `llm-pi-ai` 命名空间的 providers 配置（与 webui_sync_reasoning /
 * planweave /providers 同一数据源），投影为下拉分组数据。
 */
export function listProviders(ctx) {
    let raw;
    try {
        raw = ctx.settings?.get?.(settingsNamespace('llm-pi-ai'));
    }
    catch {
        raw = undefined;
    }
    const providersMap = raw?.providers ?? {};
    return Object.entries(providersMap).map(([id, entry]) => ({
        id,
        displayName: typeof entry?.displayName === 'string' && entry.displayName !== '' ? entry.displayName : id,
        models: (Array.isArray(entry?.models) ? entry.models : [])
            .map((model) => {
            const modelId = typeof model?.id === 'string' && model.id !== ''
                ? model.id
                : (typeof model?.name === 'string' ? model.name : '');
            const name = typeof model?.name === 'string' && model.name !== '' ? model.name : modelId;
            return { id: modelId, name };
        })
            .filter(model => model.id !== ''),
    }));
}
/** 校验一个绑定是否存在于 providers 枚举中（provider 为空时跳过校验）。 */
export function bindingExists(providers, binding) {
    if (binding.provider === '' || binding.model === '')
        return false;
    const group = providers.find(p => p.id === binding.provider);
    if (group === undefined)
        return false;
    return group.models.some(m => m.id === binding.model);
}
/** 读 agent 当前默认模型（automation/executor 同款用法）；不可用返回 null。 */
export function agentDefaultModel(ctx) {
    const service = ctx.get?.('agentDefaultModel');
    if (service === undefined)
        return null;
    try {
        const selection = service.currentSelection();
        const provider = typeof selection.provider === 'string' ? selection.provider : '';
        const model = typeof selection.model === 'string' ? selection.model : '';
        if (provider === '' || model === '')
            return null;
        return { provider, model };
    }
    catch {
        return null;
    }
}
/**
 * 按四级优先级解析角色本次执行使用的模型。
 * 全部层级都缺失时抛 TeamError（提示用户去设团队默认模型）。
 */
export function resolveModel({ ctx, team, role, globals, modelOverrides }) {
    const byRun = modelOverrides?.[role.id];
    if (byRun !== undefined && byRun.provider !== '' && byRun.model !== '') {
        return { binding: byRun, source: 'run' };
    }
    if (role.model !== null && role.model.provider !== '' && role.model.model !== '') {
        return { binding: role.model, source: 'role' };
    }
    if (team.model.provider !== '' && team.model.model !== '') {
        return { binding: team.model, source: 'team' };
    }
    if (globals.defaultModel.provider !== '' && globals.defaultModel.model !== '') {
        return { binding: globals.defaultModel, source: 'global' };
    }
    const fallback = agentDefaultModel(ctx);
    if (fallback !== null)
        return { binding: fallback, source: 'global' };
    throw new TeamError(`角色「${role.name}」没有可用模型：请在团队面板设置「团队默认模型」，或为该角色单独指定模型`, 'model_unresolved', 409);
}
/** 解析并校验模型存在性；不存在时给出可操作的错误提示。 */
export function resolveModelChecked(input, providers) {
    const resolved = resolveModel(input);
    if (providers.length > 0 && !bindingExists(providers, resolved.binding)) {
        const where = resolved.source === 'role' ? `角色「${input.role.name}」的模型`
            : resolved.source === 'run' ? '本次运行指定的模型'
                : resolved.source === 'team' ? '团队默认模型' : '全局默认模型';
        throw new TeamError(`${where} ${resolved.binding.provider}/${resolved.binding.model} 不在已配置的供应商中，请到团队设置里重选`, 'model_missing', 409);
    }
    return resolved;
}
/** 找主脑角色（core 分组第一个，或 id 为 hanako 的角色）。 */
export function findCoreRole(team) {
    return team.roles.find(role => role.id === 'hanako')
        ?? team.roles.find(role => role.group === 'core')
        ?? null;
}
/**
 * 把链条展开为线性执行计划：role 步 + 显式/隐式 synthesize 步。
 * 找不到角色的步骤直接跳过；主脑缺失时不追加整合步。
 */
export function planChain(team, chain) {
    const byId = new Map(team.roles.map(role => [role.id, role]));
    const out = [];
    let hasExplicitSynth = false;
    const push = (role, synthesize, taskNote) => {
        out.push({ index: out.length, role, synthesize, ...(taskNote !== undefined ? { taskNote } : {}) });
    };
    for (const step of chain.steps) {
        if (step.kind === 'synthesize') {
            const role = (step.roleId !== undefined ? byId.get(step.roleId) : undefined) ?? findCoreRole(team);
            if (role === null || role === undefined)
                continue;
            hasExplicitSynth = true;
            push(role, true);
            continue;
        }
        const role = byId.get(step.roleId);
        if (role === undefined)
            continue;
        push(role, false, step.taskNote);
    }
    if (chain.finalSynthesize && !hasExplicitSynth) {
        const core = findCoreRole(team);
        if (core !== null)
            push(core, true);
    }
    return out;
}
/** 把任意角色 id 序列展开为执行计划（临时点兵）。 */
export function planRoles(team, roleIds, synthesize) {
    const byId = new Map(team.roles.map(role => [role.id, role]));
    const out = [];
    for (const id of roleIds) {
        const role = byId.get(id);
        if (role === undefined)
            continue;
        out.push({ index: out.length, role, synthesize: false });
    }
    if (synthesize) {
        const core = findCoreRole(team);
        if (core !== null)
            out.push({ index: out.length, role: core, synthesize: true });
    }
    return out;
}
/** 校验团队可用性：至少一个角色；链引用的角色存在（normalizeTeam 已过滤，这里只查空链）。 */
export function assertTeamRunnable(team, chain) {
    if (team.roles.length === 0) {
        throw new TeamError(`团队「${team.name}」还没有角色，请先添加角色`, 'team_empty', 409);
    }
    if (chain !== null && chain.steps.length === 0 && !chain.finalSynthesize) {
        throw new TeamError(`链条「${chain.name}」没有步骤`, 'chain_empty', 409);
    }
}
/** 从运行快照统计 TODO 进度（HUD 与清单共用）。 */
export function runProgress(run) {
    let done = 0;
    let running = 0;
    let pending = 0;
    let failed = 0;
    for (const step of run.steps) {
        if (step.status === 'done')
            done += 1;
        else if (step.status === 'running')
            running += 1;
        else if (step.status === 'pending')
            pending += 1;
        else
            failed += 1;
    }
    return { total: run.steps.length, done, running, pending, failed };
}
//# sourceMappingURL=roster.js.map