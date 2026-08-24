/**
 * team — 一句话生成团队（host 半身）。
 *
 * 输入一句自然语言需求（如「做一个短视频内容团队，要能选题、写脚本、审稿」），
 * 用 ctx.llm 生成一份完整团队编制 JSON（角色 + 提示词 + 分组 + 协作链 + 直连），
 * 校验归一化后落盘为一个新团队。
 *
 * 设计要点：
 *  - **模型只产结构，不产模型绑定**：角色 model 一律 null（继承团队默认），
 *    团队默认模型由用户在面板选——避免模型编造不存在的 provider/model。
 *  - 输出用严格 JSON schema 约束 + 稳健解析（容忍 markdown 围栏与前后缀噪声）。
 *  - 生成失败/超时/解析失败一律抛可读错误，不写半成品团队。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { TeamError, TEAM_SCHEMA_VERSION } from './types.js';
import { agentDefaultModel } from './roster.js';
/** 生成用的输出预算与超时。 */
const GEN_MAX_TOKENS = 8192;
const GEN_TIMEOUT_MS = 180_000;
/** 角色数量硬上限（防止模型生成 30 个角色把链跑爆）。 */
const MAX_ROLES = 12;
/** 链数量硬上限。 */
const MAX_CHAINS = 6;
const SYSTEM = [
    '你是多智能体团队编制设计师。用户给出一句需求，你要设计一支能落地完成该类任务的 AI 角色团队。',
    '',
    '设计要求：',
    '1. 必须包含一个 id 为 "hanako"、group 为 "core" 的主脑角色（协调中枢、最终整合者）。',
    '2. 除主脑外再设计 3~8 个专职角色，职责边界清晰、不重叠，覆盖该需求的完整工作流。',
    '3. 每个角色的 group 从以下三选一：judge（信息与判断：调研/审查/策划）、act（落地执行：实现/产出/成稿/整理）、guard（守护支持：陪伴/评审/运维/合规）。',
    '4. 角色 id 用简短小写英文（字母数字连字符，≤20 字符），name 用简短中文名（1~3 字最佳，如「察」「驳」「匠」），en 用 id 同名英文，tagline 是 6~14 字的中文定位语（用「·」分隔两个短语）。',
    '5. 每个角色的 prompt 是完整可用的中文系统提示词：身份定位、职责清单（3~5 条具体动作）、协作纪律（不越权、采信上游、结论先行、不确定处标注待确认）、输出格式要求。每个 prompt 至少 150 字。',
    '6. 设计 1~4 条协作链（chains）：每条链是有序的角色接力，steps 里每步 {"roleId": "...", "taskNote": "该步要做什么（一句话）"}；finalSynthesize 一律为 true（尾部由主脑整合）。链的 id 用小写英文，name 用「A→B→主脑整合」形式。',
    '7. 可选设计 0~4 条按需直连（directLinks）：{"from","to","kind":"bidirectional"|"directed","label":"关系"}，表示两个角色之间的非链式协作关系。',
    '8. 不要输出任何模型名称或 provider——模型由用户在界面上统一配置。',
    '',
    '只输出一个 JSON 对象，不要 markdown 围栏，不要任何解释文字，形状严格如下：',
    '{"name":"团队名（4~10 字中文）","description":"一句话说明这支团队做什么","roles":[{"id":"hanako","name":"主脑","en":"hanako","tagline":"协调中枢·总管兜底","group":"core","prompt":"..."},{"id":"...","name":"...","en":"...","tagline":"...","group":"judge|act|guard","prompt":"..."}],"chains":[{"id":"...","name":"...","finalSynthesize":true,"steps":[{"roleId":"...","taskNote":"..."}]}],"directLinks":[{"from":"...","to":"...","kind":"bidirectional","label":"..."}]}',
].join('\n');
/** 从 LLM 输出里稳健提取 JSON 对象。 */
function extractJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] ?? text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) {
        throw new TeamError('生成模型没有返回合法的 JSON 对象，请重试或换一个模型', 'gen_bad_json', 502);
    }
    let parsed;
    try {
        parsed = JSON.parse(candidate.slice(start, end + 1));
    }
    catch (error) {
        throw new TeamError(`生成结果 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`, 'gen_bad_json', 502);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new TeamError('生成结果不是 JSON 对象', 'gen_bad_json', 502);
    }
    return parsed;
}
/** 解析生成模型的执行绑定：显式指定 > 全局默认 > agent 当前默认。 */
function resolveGenModel(ctx, store, explicit) {
    if (explicit !== undefined
        && typeof explicit.provider === 'string' && explicit.provider !== ''
        && typeof explicit.model === 'string' && explicit.model !== '') {
        return { provider: explicit.provider, model: explicit.model };
    }
    const globals = store.readGlobals();
    if (globals.defaultModel.provider !== '' && globals.defaultModel.model !== '') {
        return { provider: globals.defaultModel.provider, model: globals.defaultModel.model };
    }
    const fallback = agentDefaultModel(ctx);
    if (fallback !== null)
        return fallback;
    throw new TeamError('没有可用于生成的模型：请在团队设置里选一个「全局默认模型」，或在生成时指定模型', 'gen_no_model', 409);
}
/** 校验并裁剪生成出的角色表；不合规处就地修正而非整体失败。 */
function sanitizeRoles(input) {
    const list = Array.isArray(input) ? input : [];
    const roles = [];
    const seen = new Set();
    for (const item of list) {
        if (roles.length >= MAX_ROLES)
            break;
        if (item === null || typeof item !== 'object')
            continue;
        const raw = item;
        let id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : '';
        if (id === '')
            continue;
        id = id.slice(0, 20);
        if (seen.has(id))
            continue;
        seen.add(id);
        const group = raw.group === 'core' || raw.group === 'judge' || raw.group === 'act' || raw.group === 'guard'
            ? raw.group
            : 'act';
        const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 12) : id;
        roles.push({
            id,
            name,
            en: typeof raw.en === 'string' && raw.en.trim() !== '' ? raw.en.trim().slice(0, 20) : id,
            tagline: typeof raw.tagline === 'string' ? raw.tagline.trim().slice(0, 40) : '',
            group,
            prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
            model: null,
            executor: 'auto',
        });
    }
    if (roles.length === 0) {
        throw new TeamError('生成结果里没有任何有效角色，请重试或把需求描述得更具体', 'gen_no_roles', 502);
    }
    // 确保有主脑：缺失时补一个。
    if (!roles.some(role => role.group === 'core')) {
        roles.unshift({
            id: 'hanako',
            name: '主脑',
            en: 'hanako',
            tagline: '协调中枢·总管兜底',
            group: 'core',
            prompt: [
                '你是「主脑」，这支团队的协调中枢与最终整合者。',
                '',
                '## 你的职责',
                '- 整合各角色产出，消解相互矛盾之处（指出冲突点并给出取舍理由）。',
                '- 形成面向用户的最终交付物：结论、依据、可执行的下一步。',
                '- 补齐各角色都没覆盖到的空白（兜底），并明确标注哪些是你的补充。',
                '- 若各角色产出不足以交付，直接说明还缺什么、建议再派哪个角色。',
                '',
                '## 输出纪律',
                '- 结论先行，其后是依据与关键细节，最后列出遗留问题与建议的下一步。',
                '- 直接输出交付物本体，不写开场寒暄与流程复述。',
            ].join('\n'),
            model: null,
            executor: 'llm',
        });
    }
    return roles;
}
/** 校验并裁剪生成出的链条；引用不存在角色的步骤丢弃。 */
function sanitizeChains(input, roles) {
    const ids = new Set(roles.map(role => role.id));
    const list = Array.isArray(input) ? input : [];
    const chains = [];
    const seen = new Set();
    for (const item of list) {
        if (chains.length >= MAX_CHAINS)
            break;
        if (item === null || typeof item !== 'object')
            continue;
        const raw = item;
        let id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : '';
        if (id === '')
            id = `chain${chains.length + 1}`;
        id = id.slice(0, 30);
        if (seen.has(id))
            continue;
        seen.add(id);
        const steps = (Array.isArray(raw.steps) ? raw.steps : [])
            .map((step) => {
            if (step === null || typeof step !== 'object')
                return null;
            const s = step;
            if (s.kind === 'synthesize')
                return { kind: 'synthesize' };
            const roleId = typeof s.roleId === 'string' ? s.roleId.trim().toLowerCase() : '';
            if (!ids.has(roleId))
                return null;
            const note = typeof s.taskNote === 'string' ? s.taskNote.trim().slice(0, 200) : '';
            return { kind: 'role', roleId, ...(note !== '' ? { taskNote: note } : {}) };
        })
            .filter((step) => step !== null);
        if (steps.length === 0)
            continue;
        chains.push({
            id,
            name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 40) : id,
            steps,
            finalSynthesize: raw.finalSynthesize !== false,
        });
    }
    // 一条链都没有时，用非 core 角色顺序拼一条主链，保证团队开箱可跑。
    if (chains.length === 0) {
        const workers = roles.filter(role => role.group !== 'core').slice(0, 4);
        if (workers.length > 0) {
            chains.push({
                id: 'main',
                name: `${workers.map(r => r.name).join('→')}→主脑整合`,
                steps: workers.map(role => ({ kind: 'role', roleId: role.id })),
                finalSynthesize: true,
            });
        }
    }
    return chains;
}
/** 校验并裁剪直连。 */
function sanitizeLinks(input, roles) {
    const ids = new Set(roles.map(role => role.id));
    const list = Array.isArray(input) ? input : [];
    const links = [];
    for (const item of list) {
        if (links.length >= 8)
            break;
        if (item === null || typeof item !== 'object')
            continue;
        const raw = item;
        const from = typeof raw.from === 'string' ? raw.from.trim().toLowerCase() : '';
        const to = typeof raw.to === 'string' ? raw.to.trim().toLowerCase() : '';
        if (!ids.has(from) || !ids.has(to) || from === to)
            continue;
        const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 20) : '';
        links.push({
            from,
            to,
            kind: raw.kind === 'directed' ? 'directed' : 'bidirectional',
            ...(label !== '' ? { label } : {}),
        });
    }
    return links;
}
/**
 * 一句话生成团队并落盘，返回新团队。
 * 生成失败不产生任何团队文件。
 */
export async function generateTeam(ctx, store, input) {
    const brief = input.brief.trim();
    if (brief === '')
        throw new TeamError('请先描述你想要的团队', 'brief_required', 400);
    if (brief.length > 2000)
        throw new TeamError('需求描述过长（上限 2000 字）', 'brief_too_long', 400);
    const llm = ctx.get?.('llm');
    if (llm === undefined)
        throw new TeamError('llm 服务不可用，无法生成团队', 'llm_unavailable', 503);
    const genModel = resolveGenModel(ctx, store, { provider: input.provider, model: input.model });
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), GEN_TIMEOUT_MS);
    let output = '';
    try {
        const messages = [createUserMessage({
                content: [{ type: 'text', text: `需求：${brief}\n\n请按系统提示的 JSON 形状输出这支团队的完整编制。` }],
                source: { kind: 'plugin', plugin: 'dsh-webui' },
            })];
        for await (const chunk of llm.stream({
            provider: genModel.provider,
            model: genModel.model,
            messages,
            system: SYSTEM,
            maxTokens: GEN_MAX_TOKENS,
            signal: controller.signal,
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
                throw new TeamError(reason.failure?.message ?? '生成模型调用失败', 'gen_failed', 502);
            }
            if (reason.kind === 'aborted') {
                throw new TeamError('生成被中止', 'gen_aborted', 409);
            }
            if (reason.kind !== 'stop' && reason.kind !== 'max-tokens') {
                throw new TeamError(`生成模型未正常结束：${reason.kind}`, 'gen_failed', 502);
            }
        }
    }
    catch (error) {
        if (controller.signal.aborted && !(error instanceof TeamError)) {
            throw new TeamError(`生成超时（${GEN_TIMEOUT_MS / 1000}s），请重试或换一个更快的模型`, 'gen_timeout', 504);
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onAbort);
    }
    if (output.trim() === '') {
        throw new TeamError(`生成模型没有返回内容（${genModel.provider}/${genModel.model}），换一个有文本输出的模型再试`, 'gen_empty', 502);
    }
    const parsed = extractJson(output);
    const roles = sanitizeRoles(parsed.roles);
    const chains = sanitizeChains(parsed.chains, roles);
    const directLinks = sanitizeLinks(parsed.directLinks, roles);
    const name = typeof parsed.name === 'string' && parsed.name.trim() !== ''
        ? parsed.name.trim().slice(0, 30)
        : brief.slice(0, 12);
    const description = typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 200) : '';
    const created = store.createTeam(name, { seed: false });
    const now = new Date().toISOString();
    return store.saveTeam({
        schemaVersion: TEAM_SCHEMA_VERSION,
        id: created.id,
        name,
        ...(description !== '' ? { description } : {}),
        model: input.teamModel !== undefined && input.teamModel.provider !== ''
            ? input.teamModel
            : created.model,
        roles,
        chains,
        directLinks,
        createdAt: now,
        updatedAt: now,
    });
}
/** 供工具/路由复用的简介：生成模型能力说明。 */
export const GENERATE_HINT = '用一句话描述你要的团队（做什么、需要哪些环节），模型会生成完整角色编制与协作链；模型绑定不由生成决定，生成后在面板选团队默认模型即可。';
//# sourceMappingURL=generate.js.map