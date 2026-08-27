/**
 * team — 团队 Agent 编排器的数据结构（host / client 共用语义，见 docs/TEAM-ORCHESTRA.md v0.3）。
 *
 * 三层实体：
 *  - Team：一个团队 = 团队默认模型 + 角色集 + 链条 + 直连（一团队一文件持久化）。
 *  - Role：团队内的角色，模型默认「继承团队」（model === null），可单独覆盖。
 *  - Run / RunStep：一次链条执行的运行时快照（落 run.json，供面板与对话流 HUD 轮询）。
 *
 * 模型解析四级优先级（resolveModel）：本次运行 > 角色覆盖 > 团队默认 > 全局默认。
 */
/** 存储契约版本：读到更高版本的团队文件时降级为只读。 */
export const TEAM_SCHEMA_VERSION = 1;
/** 能力装配默认值（完全继承会话，不做任何限制）。 */
export const DEFAULT_CAPABILITIES = {
    toolMode: 'inherit',
    tools: [],
    skillMode: 'inherit',
    skills: [],
    skillBundles: [],
};
/** 备用模型链最大长度。 */
export const MAX_FALLBACK_MODELS = 3;
/** globals 默认值。 */
export const DEFAULT_GLOBALS = {
    defaultModel: { provider: '', model: '' },
    activeTeamId: '',
    timeoutSec: 300,
    maxRetries: 1,
    upstreamWindow: 'last',
    maxConcurrentRuns: 1,
    maxParallel: 2,
    autoPlan: false,
    outputChunkChars: 8000,
    stopOnError: true,
    autoFallback: true,
};
/**
 * 归一化并行计划：过滤非法角色、去掉空波次、限制规模。
 * 同一波次内重复角色去重（同一角色在一个波次里跑两次没有意义）。
 */
export function normalizePlan(input, knownRoleIds, limits = {}) {
    const maxWaves = limits.maxWaves ?? 8;
    const maxPerWave = limits.maxPerWave ?? 6;
    if (!Array.isArray(input))
        return [];
    const out = [];
    for (const rawWave of input) {
        if (out.length >= maxWaves)
            break;
        // 容忍「单角色写成裸字符串」的写法：'cha' 等价于 ['cha']。
        const items = Array.isArray(rawWave) ? rawWave : [rawWave];
        const wave = [];
        const seen = new Set();
        for (const item of items) {
            if (wave.length >= maxPerWave)
                break;
            let roleId = '';
            let taskNote = '';
            if (typeof item === 'string') {
                roleId = item.trim();
            }
            else if (item !== null && typeof item === 'object') {
                const raw = item;
                roleId = typeof raw.roleId === 'string' ? raw.roleId.trim() : '';
                taskNote = typeof raw.taskNote === 'string' ? raw.taskNote.trim().slice(0, 400) : '';
            }
            if (roleId === '' || !knownRoleIds.has(roleId) || seen.has(roleId))
                continue;
            seen.add(roleId);
            wave.push({ roleId, ...(taskNote !== '' ? { taskNote } : {}) });
        }
        if (wave.length > 0)
            out.push(wave);
    }
    return out;
}
/** chat-mode 默认值。 */
export const DEFAULT_CHAT_MODE = {
    enabled: false,
    teamId: '',
    chainId: '',
    force: false,
    updatedAt: '',
};
// ── 错误 ────────────────────────────────────────────────────────────────────
/** 带 code/status 的可识别错误（路由层转 HTTP 状态码）。 */
export class TeamError extends Error {
    code;
    status;
    constructor(message, code, status = 409) {
        super(message);
        this.name = 'TeamError';
        this.code = code;
        this.status = status;
    }
}
// ── 归一化助手 ──────────────────────────────────────────────────────────────
function str(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}
function num(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
/** 归一化模型绑定；provider/model 皆空时返回 null。 */
export function normalizeBinding(input) {
    if (input === null || input === undefined)
        return null;
    if (typeof input === 'string') {
        const value = input.trim();
        if (value === '')
            return null;
        const slash = value.indexOf('/');
        if (slash > 0 && slash < value.length - 1) {
            return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
        }
        return { provider: '', model: value };
    }
    if (typeof input !== 'object')
        return null;
    const raw = input;
    const provider = str(raw.provider).trim();
    const model = str(raw.model ?? raw.id).trim();
    if (provider === '' && model === '')
        return null;
    const effort = str(raw.reasoningEffort).trim();
    const maxTokens = typeof raw.maxTokens === 'number' && raw.maxTokens > 0 ? Math.floor(raw.maxTokens) : undefined;
    return {
        provider,
        model,
        ...(effort !== '' ? { reasoningEffort: effort } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
    };
}
/**
 * 归一化备用模型链：逐项过滤非法绑定、去重（provider/model 同值只留一个）、限长。
 * 空链返回 undefined（不写进文件，保持编制文件干净）。
 */
export function normalizeFallbackModels(input) {
    if (!Array.isArray(input))
        return undefined;
    const out = [];
    const seen = new Set();
    for (const item of input) {
        if (out.length >= MAX_FALLBACK_MODELS)
            break;
        const binding = normalizeBinding(item);
        if (binding === null || binding.provider === '' || binding.model === '')
            continue;
        const key = `${binding.provider}/${binding.model}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(binding);
    }
    return out.length > 0 ? out : undefined;
}
const VALID_GROUPS = new Set(['core', 'judge', 'act', 'guard']);
const VALID_EXECUTORS = new Set(['auto', 'llm', 'subagent']);
/**
 * 归一化图上位置（world 像素，允许负值 —— 画布无边界）。
 * 非有限数一律丢弃（视为无手工位置）；坐标取整并钳在 ±1e6 内防脏数据。
 *
 * 历史：v1 存的是 0..1 归一化值（相对固定尺寸画布），前端 TeamBoard 会识别
 * 「全部落在 0..1 且带小数」的老数据并折算成 px，下次拖拽即写回 px。所以这里
 * **不能**再拒绝 >1 的值。
 */
function normalizePos(input) {
    if (input === null || typeof input !== 'object')
        return undefined;
    const raw = input;
    const x = typeof raw.x === 'number' ? raw.x : NaN;
    const y = typeof raw.y === 'number' ? raw.y : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y))
        return undefined;
    const clamp = (value) => Math.round(Math.min(1e6, Math.max(-1e6, value)) * 10000) / 10000;
    return { x: clamp(x), y: clamp(y) };
}
/** 名称列表归一化：去空白、去重、限长（工具名/技能名/包 id 共用）。 */
function normalizeNameList(input, max = 64) {
    if (!Array.isArray(input))
        return [];
    const out = [];
    const seen = new Set();
    for (const item of input) {
        if (typeof item !== 'string')
            continue;
        const value = item.trim();
        if (value === '' || value.length > 120)
            continue;
        if (seen.has(value))
            continue;
        seen.add(value);
        out.push(value);
        if (out.length >= max)
            break;
    }
    return out;
}
const VALID_TOOL_MODES = new Set(['inherit', 'allow', 'deny']);
const VALID_SKILL_MODES = new Set(['inherit', 'allow', 'none']);
/**
 * 归一化能力装配；完全等价于默认值时返回 undefined（不写进文件，保持编制文件干净）。
 * allow/deny 模式但名单为空视为无意义 → 回退 inherit（避免"白名单空 = 屏蔽全部工具"的坑）。
 */
export function normalizeCapabilities(input) {
    if (input === null || typeof input !== 'object')
        return undefined;
    const raw = input;
    const tools = normalizeNameList(raw.tools);
    const skills = normalizeNameList(raw.skills);
    const skillBundles = normalizeNameList(raw.skillBundles, 32);
    let toolMode = VALID_TOOL_MODES.has(str(raw.toolMode)) ? str(raw.toolMode) : 'inherit';
    let skillMode = VALID_SKILL_MODES.has(str(raw.skillMode)) ? str(raw.skillMode) : 'inherit';
    if (toolMode !== 'inherit' && tools.length === 0)
        toolMode = 'inherit';
    if (skillMode === 'allow' && skills.length === 0 && skillBundles.length === 0)
        skillMode = 'inherit';
    const value = { toolMode, tools, skillMode, skills, skillBundles };
    const isDefault = value.toolMode === 'inherit' && value.skillMode === 'inherit'
        && value.tools.length === 0 && value.skills.length === 0 && value.skillBundles.length === 0;
    return isDefault ? undefined : value;
}
/** 读角色的有效能力装配（缺省补默认）。 */
export function capabilitiesOf(role) {
    return role.capabilities ?? { ...DEFAULT_CAPABILITIES };
}
/** 归一化角色：补默认值、校验枚举，非法 id 抛错。 */
export function normalizeRole(input) {
    if (input === null || typeof input !== 'object') {
        throw new TeamError('角色数据格式非法', 'role_invalid', 400);
    }
    const raw = input;
    const id = str(raw.id).trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
        throw new TeamError(`角色 id 非法：${id === '' ? '(空)' : id}（只允许字母数字下划线连字符，≤40）`, 'role_id_invalid', 400);
    }
    const group = str(raw.group);
    const executor = str(raw.executor);
    const label = str(raw.label).trim();
    const tags = Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : undefined;
    const pos = normalizePos(raw.pos);
    const capabilities = normalizeCapabilities(raw.capabilities);
    const avatar = str(raw.avatar).trim().slice(0, 4);
    const fallbackModels = normalizeFallbackModels(raw.fallbackModels);
    return {
        id,
        name: str(raw.name).trim() || id,
        en: str(raw.en).trim() || id,
        tagline: str(raw.tagline).trim(),
        group: VALID_GROUPS.has(group) ? group : 'act',
        prompt: str(raw.prompt),
        model: normalizeBinding(raw.model),
        ...(fallbackModels !== undefined ? { fallbackModels } : {}),
        executor: VALID_EXECUTORS.has(executor) ? executor : 'auto',
        ...(label !== '' ? { label } : {}),
        ...(tags !== undefined && tags.length > 0 ? { tags } : {}),
        ...(pos !== undefined ? { pos } : {}),
        ...(avatar !== '' ? { avatar } : {}),
        ...(capabilities !== undefined ? { capabilities } : {}),
    };
}
/** 归一化链步骤；未知 kind 视为 role。 */
function normalizeStep(input) {
    if (input === null || typeof input !== 'object')
        return null;
    const raw = input;
    if (str(raw.kind) === 'synthesize') {
        const roleId = str(raw.roleId).trim();
        return { kind: 'synthesize', ...(roleId !== '' ? { roleId } : {}) };
    }
    const roleId = str(raw.roleId).trim();
    if (roleId === '')
        return null;
    const note = str(raw.taskNote).trim();
    return {
        kind: 'role',
        roleId,
        ...(note !== '' ? { taskNote: note } : {}),
        ...(raw.parallel === true ? { parallel: true } : {}),
    };
}
/** 归一化链条。 */
export function normalizeChain(input) {
    if (input === null || typeof input !== 'object') {
        throw new TeamError('链条数据格式非法', 'chain_invalid', 400);
    }
    const raw = input;
    const id = str(raw.id).trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
        throw new TeamError(`链条 id 非法：${id === '' ? '(空)' : id}`, 'chain_id_invalid', 400);
    }
    const steps = Array.isArray(raw.steps)
        ? raw.steps.map(normalizeStep).filter((s) => s !== null)
        : [];
    return {
        id,
        name: str(raw.name).trim() || id,
        steps,
        finalSynthesize: raw.finalSynthesize !== false,
    };
}
/** 归一化直连。 */
function normalizeLink(input) {
    if (input === null || typeof input !== 'object')
        return null;
    const raw = input;
    const from = str(raw.from).trim();
    const to = str(raw.to).trim();
    if (from === '' || to === '')
        return null;
    const label = str(raw.label).trim();
    return {
        from,
        to,
        kind: str(raw.kind) === 'directed' ? 'directed' : 'bidirectional',
        ...(label !== '' ? { label } : {}),
    };
}
/** 归一化团队执行偏好覆盖。 */
function normalizeOverrides(input) {
    if (input === null || typeof input !== 'object')
        return undefined;
    const raw = input;
    const out = {};
    if (typeof raw.timeoutSec === 'number')
        out.timeoutSec = Math.max(10, Math.floor(raw.timeoutSec));
    if (typeof raw.maxRetries === 'number')
        out.maxRetries = Math.max(0, Math.min(5, Math.floor(raw.maxRetries)));
    if (raw.upstreamWindow === 'last' || raw.upstreamWindow === 'all-summary')
        out.upstreamWindow = raw.upstreamWindow;
    if (typeof raw.maxConcurrentRuns === 'number')
        out.maxConcurrentRuns = Math.max(1, Math.min(5, Math.floor(raw.maxConcurrentRuns)));
    if (typeof raw.maxParallel === 'number')
        out.maxParallel = Math.max(1, Math.min(5, Math.floor(raw.maxParallel)));
    if (typeof raw.autoPlan === 'boolean')
        out.autoPlan = raw.autoPlan;
    if (typeof raw.outputChunkChars === 'number')
        out.outputChunkChars = Math.max(500, Math.floor(raw.outputChunkChars));
    if (typeof raw.stopOnError === 'boolean')
        out.stopOnError = raw.stopOnError;
    if (typeof raw.autoFallback === 'boolean')
        out.autoFallback = raw.autoFallback;
    return Object.keys(out).length > 0 ? out : undefined;
}
/** 团队 id 合法性（同时用作文件名，必须严格）。 */
export function isValidTeamId(id) {
    return /^[A-Za-z0-9_-]{1,60}$/.test(id);
}
/**
 * 归一化整个团队文档：补默认、去重角色/链 id、丢弃指向不存在角色的链步骤与直连。
 * 抛 TeamError 表示数据不可用（id 非法等）。
 */
export function normalizeTeam(input) {
    if (input === null || typeof input !== 'object') {
        throw new TeamError('团队数据格式非法', 'team_invalid', 400);
    }
    const raw = input;
    const id = str(raw.id).trim();
    if (!isValidTeamId(id)) {
        throw new TeamError(`团队 id 非法：${id === '' ? '(空)' : id}`, 'team_id_invalid', 400);
    }
    const seenRole = new Set();
    const roles = [];
    if (Array.isArray(raw.roles)) {
        for (const item of raw.roles) {
            const role = normalizeRole(item);
            if (seenRole.has(role.id))
                continue;
            seenRole.add(role.id);
            roles.push(role);
        }
    }
    // ── 存量迁移：出厂主脑旧英文标识 "hanako" → "brain"（2026-08 更名，用户要求
    // 编排数据不暴露内部代号）。幂等：没有 hanako 时零开销；极端情况下团队里已
    // 同时存在 brain 角色则跳过改名避免 id 冲突（findCoreRole 按 group 兜底仍可用）。
    const hasBrain = seenRole.has('brain');
    const renamed = new Map();
    if (!hasBrain && seenRole.has('hanako')) {
        seenRole.delete('hanako');
        seenRole.add('brain');
        renamed.set('hanako', 'brain');
        for (const role of roles) {
            if (role.id !== 'hanako')
                continue;
            role.id = 'brain';
            if (role.en === 'hanako')
                role.en = 'brain';
        }
    }
    const seenChain = new Set();
    const chains = [];
    if (Array.isArray(raw.chains)) {
        for (const item of raw.chains) {
            const chain = normalizeChain(item);
            if (seenChain.has(chain.id))
                continue;
            seenChain.add(chain.id);
            // 先随迁移改写引用，再丢弃指向不存在角色的 role 步骤（synthesize 步的 roleId 可留空）。
            chain.steps = chain.steps
                .map(step => (step.kind === 'role' && renamed.has(step.roleId)
                ? { ...step, roleId: renamed.get(step.roleId) ?? step.roleId }
                : step))
                .filter(step => step.kind === 'synthesize' ? (step.roleId === undefined || seenRole.has(step.roleId)) : seenRole.has(step.roleId));
            chains.push(chain);
        }
    }
    const directLinks = Array.isArray(raw.directLinks)
        ? raw.directLinks.map(normalizeLink)
            .map(link => (link === null
            ? null
            : renamed.has(link.from) || renamed.has(link.to)
                ? { ...link, from: renamed.get(link.from) ?? link.from, to: renamed.get(link.to) ?? link.to }
                : link))
            .filter((l) => l !== null && seenRole.has(l.from) && seenRole.has(l.to))
        : [];
    const now = new Date().toISOString();
    const overrides = normalizeOverrides(raw.overrides);
    const description = str(raw.description).trim();
    const fallbackModels = normalizeFallbackModels(raw.fallbackModels);
    return {
        schemaVersion: Number.isInteger(raw.schemaVersion) && raw.schemaVersion > TEAM_SCHEMA_VERSION
            ? raw.schemaVersion
            : TEAM_SCHEMA_VERSION,
        id,
        name: str(raw.name).trim() || id,
        ...(description !== '' ? { description } : {}),
        model: normalizeBinding(raw.model) ?? { provider: '', model: '' },
        ...(fallbackModels !== undefined ? { fallbackModels } : {}),
        roles,
        chains,
        directLinks,
        ...(overrides !== undefined ? { overrides } : {}),
        createdAt: str(raw.createdAt) || now,
        updatedAt: str(raw.updatedAt) || now,
    };
}
/** 归一化 globals（缺省用 DEFAULT_GLOBALS）。 */
export function normalizeGlobals(input) {
    const raw = (input !== null && typeof input === 'object' ? input : {});
    const window = raw.upstreamWindow === 'all-summary' ? 'all-summary' : 'last';
    return {
        defaultModel: normalizeBinding(raw.defaultModel) ?? { ...DEFAULT_GLOBALS.defaultModel },
        activeTeamId: str(raw.activeTeamId).trim(),
        timeoutSec: Math.max(10, Math.floor(num(raw.timeoutSec, DEFAULT_GLOBALS.timeoutSec))),
        maxRetries: Math.max(0, Math.min(5, Math.floor(num(raw.maxRetries, DEFAULT_GLOBALS.maxRetries)))),
        upstreamWindow: window,
        maxConcurrentRuns: Math.max(1, Math.min(5, Math.floor(num(raw.maxConcurrentRuns, DEFAULT_GLOBALS.maxConcurrentRuns)))),
        maxParallel: Math.max(1, Math.min(5, Math.floor(num(raw.maxParallel, DEFAULT_GLOBALS.maxParallel)))),
        autoPlan: raw.autoPlan === true,
        outputChunkChars: Math.max(500, Math.floor(num(raw.outputChunkChars, DEFAULT_GLOBALS.outputChunkChars))),
        stopOnError: raw.stopOnError !== false,
        autoFallback: raw.autoFallback !== false,
    };
}
/** 归一化单个会话的团队模式状态。 */
export function normalizeChatMode(input) {
    const raw = (input !== null && typeof input === 'object' ? input : {});
    return {
        enabled: raw.enabled === true,
        teamId: str(raw.teamId).trim(),
        chainId: str(raw.chainId).trim(),
        force: raw.force === true,
        updatedAt: str(raw.updatedAt) || new Date().toISOString(),
    };
}
/** 合并团队覆盖到 globals，得到本次运行的有效执行偏好。 */
export function effectiveGlobals(globals, team) {
    if (team?.overrides === undefined)
        return globals;
    return { ...globals, ...team.overrides };
}
//# sourceMappingURL=types.js.map