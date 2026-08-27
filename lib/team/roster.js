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
 * 读 DSH 内置 `llm-pi-ai` 命名空间的 providers 配置（与 webui_sync_reasoning 同一数据源），投影为下拉分组数据。
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
/**
 * 解析本步可用的模型候选序列：`[主模型, ...备用模型]`。
 *
 * 备用链来源：角色 `fallbackModels` 优先，缺省继承团队 `fallbackModels`。
 * 已在候选里的（与主模型或前一个备用同值）与「当前供应商配置里不存在」的项会被剔除
 * —— 换到一个同样不存在的模型没有意义，只会把同一个错误重复一遍。
 * 主模型解析失败（四级全空）时直接抛错，与 resolveModelChecked 语义一致。
 */
export function resolveCandidates(input, providers, options = {}) {
    const primary = resolveModelChecked(input, providers);
    const out = [{ ...primary, fallback: false }];
    if (options.autoFallback === false)
        return out;
    const chain = input.role.fallbackModels ?? input.team.fallbackModels ?? [];
    const seen = new Set([`${primary.binding.provider}/${primary.binding.model}`]);
    for (const raw of chain) {
        if (raw.provider === '' || raw.model === '')
            continue;
        const key = `${raw.provider}/${raw.model}`;
        if (seen.has(key))
            continue;
        // providers 为空表示枚举读不到（配置异常），此时不做存在性过滤，交给运行期报错。
        if (providers.length > 0 && !bindingExists(providers, raw))
            continue;
        seen.add(key);
        out.push({ binding: raw, source: input.role.fallbackModels !== undefined ? 'role' : 'team', fallback: true });
    }
    return out;
}
/** 找主脑角色（core 分组第一个，或 id 为 brain / 旧 id hanako 的角色）。 */
export function findCoreRole(team) {
    return team.roles.find(role => role.id === 'brain' || role.id === 'hanako')
        ?? team.roles.find(role => role.group === 'core')
        ?? null;
}
/**
 * 把链条展开为执行计划：role 步 + 显式/隐式 synthesize 步。
 * 找不到角色的步骤直接跳过；主脑缺失时不追加整合步。
 *
 * 并行语义：`step.parallel === true` 的 role 步与**前一步同波次**（首步除外）；
 * 其余步骤各自开新波次。synthesize 步永远独占最后一个波次（必须看到全部上游）。
 * 波次内步数由 maxParallel 限制（超出的自动溢出到下一个波次，避免一次点爆供应商）。
 */
export function planChain(team, chain, maxParallel = 1) {
    const byId = new Map(team.roles.map(role => [role.id, role]));
    const out = [];
    let hasExplicitSynth = false;
    let wave = -1;
    /** 当前波次已放入的步数（用于 maxParallel 溢出切波）。 */
    let waveSize = 0;
    const push = (role, synthesize, sameWave, taskNote) => {
        const canJoin = sameWave && wave >= 0 && waveSize < Math.max(1, maxParallel);
        if (canJoin) {
            waveSize += 1;
        }
        else {
            wave += 1;
            waveSize = 1;
        }
        out.push({
            index: out.length,
            wave,
            role,
            synthesize,
            ...(taskNote !== undefined ? { taskNote } : {}),
        });
    };
    for (const step of chain.steps) {
        if (step.kind === 'synthesize') {
            const role = (step.roleId !== undefined ? byId.get(step.roleId) : undefined) ?? findCoreRole(team);
            if (role === null || role === undefined)
                continue;
            hasExplicitSynth = true;
            push(role, true, false);
            continue;
        }
        const role = byId.get(step.roleId);
        if (role === undefined)
            continue;
        push(role, false, step.parallel === true, step.taskNote);
    }
    if (chain.finalSynthesize && !hasExplicitSynth) {
        const core = findCoreRole(team);
        if (core !== null)
            push(core, true, false);
    }
    return out;
}
/**
 * 把任意角色 id 序列展开为执行计划（临时点兵，全串行 + 可选尾部整合）。
 */
export function planRoles(team, roleIds, synthesize) {
    const byId = new Map(team.roles.map(role => [role.id, role]));
    const out = [];
    for (const id of roleIds) {
        const role = byId.get(id);
        if (role === undefined)
            continue;
        out.push({ index: out.length, wave: out.length, role, synthesize: false });
    }
    if (synthesize) {
        const core = findCoreRole(team);
        if (core !== null)
            out.push({ index: out.length, wave: out.length, role: core, synthesize: true });
    }
    return out;
}
/**
 * 把显式并行计划（波次数组）展开为执行计划。
 * 每个波次内的角色并发执行；超过 maxParallel 的部分溢出为额外波次。
 * synthesize=true 时尾部追加一个独占波次的主脑整合步。
 */
export function planWaves(team, waves, synthesize, maxParallel = 1) {
    const byId = new Map(team.roles.map(role => [role.id, role]));
    const out = [];
    const limit = Math.max(1, maxParallel);
    let wave = -1;
    for (const group of waves) {
        let placed = 0;
        for (const item of group) {
            const role = byId.get(item.roleId);
            if (role === undefined)
                continue;
            if (placed % limit === 0)
                wave += 1;
            placed += 1;
            out.push({
                index: out.length,
                wave,
                role,
                synthesize: false,
                ...(item.taskNote !== undefined ? { taskNote: item.taskNote } : {}),
            });
        }
    }
    if (out.length === 0)
        return out;
    if (synthesize) {
        const core = findCoreRole(team);
        if (core !== null)
            out.push({ index: out.length, wave: wave + 1, role: core, synthesize: true });
    }
    return out;
}
/** 计划里的波次数量。 */
export function waveCountOf(planned) {
    return new Set(planned.map(step => step.wave)).size;
}
/**
 * 从既有运行快照重建「接续计划」：只挑未完成的步骤（error / skipped / pending /
 * 卡在 running 的），保留它们原来的 index 与 wave —— 这样已完成步骤的产物不动，
 * 上游注入（按 wave 取更早波次）照旧成立，UI 上的卡片位置也不会跳。
 *
 * 角色被删掉的步骤无法重跑，返回值的 `missing` 里带回角色名供上层提示。
 */
export function planResume(team, run) {
    const byId = new Map(team.roles.map(role => [role.id, role]));
    const planned = [];
    const missing = [];
    for (const step of run.steps) {
        if (step.status === 'done')
            continue;
        const role = byId.get(step.roleId);
        if (role === undefined) {
            missing.push(step.roleName !== '' ? step.roleName : step.roleId);
            continue;
        }
        planned.push({
            index: step.index,
            wave: typeof step.wave === 'number' ? step.wave : step.index,
            role,
            synthesize: step.synthesize,
        });
    }
    planned.sort((a, b) => (a.wave - b.wave) || (a.index - b.index));
    return { planned, missing };
}
/** 计划的可读路径文案（并行波次用 `A‖B` 表示）。 */
export function describePlan(planned) {
    const groups = new Map();
    for (const step of planned) {
        const names = groups.get(step.wave) ?? [];
        names.push(step.synthesize ? `${step.role.name}（整合）` : step.role.name);
        groups.set(step.wave, names);
    }
    return [...groups.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, names]) => (names.length > 1 ? names.join('‖') : names[0]))
        .join('→');
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
/** 从运行快照统计 TODO 进度（HUD 与清单共用）。 */ export function runProgress(run) {
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
/**
 * 本次运行是否可「一键接续」：已结束（非 running/queued）且还有未完成步骤。
 * 全部步骤都 done 的运行没有接续意义（要重跑请新建运行）。
 */
export function isResumable(run) {
    if (run.status === 'running' || run.status === 'queued')
        return false;
    return run.steps.some(step => step.status !== 'done');
}
//# sourceMappingURL=roster.js.map