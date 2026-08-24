/**
 * webui — MOOD 自述（host 半身）。
 *
 * 让每个 Agent 预设（agent preset）带上「MOOD 开关 + MOOD 人设」：开启后模型在
 * 思考结束、正式回答之前，先用第一人称输出一段自述（写成 ```mood 代码围栏），
 * 由 client 半身渲染成对话流里的独立卡片（见 src/client/mood/）。
 *
 * 生效机制（零 DSH 源码改动）：
 *  1. 数据存 settings 命名空间 `webui-mood`（settings.yaml 持久化），按 preset id 索引；
 *     某个 preset 没有自己的记录时回落到 defaultPersona——新建的 Agent 自动带 MOOD。
 *  2. 注入一段 systemPrompt section `mood`：DSH 每次组装都会把当次的 AssembleContext
 *     交给 text 提供方，其中 `context.agent` 是本次组装所属的 agent，
 *     `ctx.agentPresets.composedPreset(agent.ctx)` 给出它实际运行的 preset id。
 *     因此同一个注册点能为不同 Agent 渲染不同的人设，不需要按会话集合拼文本。
 *  3. 关闭时 text 返回空串 → renderPrompt 自动丢弃该段，零 token 占用。
 *
 * 性能：每次组装只做一次 Map 命中（按 preset id + 配置版本号缓存渲染结果），
 * 配置写入才 bump 版本号使缓存失效；不读盘、不做正则扫描。
 *
 * HTTP API：GET/POST `/api/webui-mood`。GET 同时带上 preset 名单，设置页因此
 * 不需要额外走 wire 的 agentPreset.list。
 */
import z from '@deepseek-ai/schemastery';
/** settings.yaml 命名空间。 */
export const MOOD_NAMESPACE = 'webui-mood';
/** HTTP 路由。 */
export const MOOD_API = '/api/webui-mood';
/**
 * 出厂人设模板。小节名不是硬编码约定——渲染端按「`名字:` 行 + `- ` 条目」自动
 * 分节，用户改成任何小节名都能正常显示。
 */
export const MOOD_DEFAULT_PERSONA = [
    'Vibe: 一句话说清此刻的状态与手感（顺手 / 别扭 / 意外 / 如释重负……）。',
    'Sparks:',
    '- 过程里真正让你觉得「这下对了」的那一下',
    'Reflections:',
    '- 你注意到但没说出口的隐患、代价或存疑处',
    'Will:',
    '- 你接下来想提醒、想追问、想动手的事',
].join('\n');
/** 人设文本上限（保护上下文预算；超出截断）。 */
const MAX_PERSONA_CHARS = 2000;
/** 覆盖配置条数上限（preset 名单本身也就十几条量级）。 */
const MAX_PRESET_ENTRIES = 50;
const MoodEntrySchema = z.object({
    enabled: z.boolean().default(true),
    persona: z.string().default(''),
});
const MoodSchema = z.object({
    enabled: z.boolean().default(true),
    defaultPersona: z.string().default(MOOD_DEFAULT_PERSONA),
    presets: z.dict(MoodEntrySchema).default({}),
});
/** 输出契约（与人设正交：契约讲「怎么写」，人设讲「写成谁」）。 */
const MOOD_CONTRACT = [
    '【MOOD 自述】思考结束后、正式回答之前，先输出一个 ```mood 代码围栏，',
    '用第一人称写下你这一轮的真实状态；围栏闭合后再照常给出正式回答。',
    '围栏内格式：每个小节单独一行「小节名:」，其下用「- 」列条目；每节最多 3 条，每条一句话。',
    '围栏里不写代码、不写结论清单、不写对用户的答复——那些都属于正式回答。',
    '纯闲聊、一句话确认、单纯的信息查询不必写 MOOD。',
].join('\n');
/** 读取请求体 JSON（几 KB 的人设文本，够用）。 */
function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
            try {
                resolve(JSON.parse(data || '{}'));
            }
            catch {
                resolve(null);
            }
        });
        req.on('error', () => resolve(null));
    });
}
/** 任意输入 → 合法 MoodEntry（缺字段补默认，人设截断）。 */
function normalizeEntry(input, base) {
    const raw = (input !== null && typeof input === 'object' ? input : {});
    const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : (base?.enabled ?? true);
    const persona = typeof raw.persona === 'string' ? raw.persona : (base?.persona ?? '');
    return { enabled, persona: persona.slice(0, MAX_PERSONA_CHARS) };
}
/** preset id 形状（与 dsh-agent-presets 的目录名规则一致）。 */
function isPresetId(value) {
    return /^[a-z0-9][a-z0-9-]*$/.test(value);
}
/** 组装注入文本；persona 为空则不注入（避免只给契约不给人设）。 */
function buildInstruction(persona) {
    const body = persona.trim();
    if (body === '')
        return '';
    return MOOD_CONTRACT + '\n人设（照它的口吻与关注点写）：\n' + body;
}
/**
 * 注册 MOOD：settings 持久化 + 按 Agent 渲染的提示词段 + HTTP API。
 * @param ctx - host 上下文。
 */
export function applyMood(ctx) {
    // 命名空间注册在 host 层，settings.yaml 持久化；重复注册会抛错，先探测。
    let scope;
    try {
        scope = ctx.settings.register(MOOD_NAMESPACE, MoodSchema);
    }
    catch (error) {
        console.log('[webui-mood] settings namespace already registered:', error?.message ?? error);
    }
    const readConfig = () => {
        if (scope !== undefined) {
            try {
                const value = scope.get();
                const presets = {};
                const raw = value?.presets;
                if (raw !== null && typeof raw === 'object') {
                    for (const [id, entry] of Object.entries(raw)) {
                        if (!isPresetId(id))
                            continue;
                        presets[id] = normalizeEntry(entry);
                    }
                }
                return {
                    enabled: value?.enabled !== false,
                    defaultPersona: typeof value?.defaultPersona === 'string' && value.defaultPersona !== ''
                        ? value.defaultPersona.slice(0, MAX_PERSONA_CHARS)
                        : MOOD_DEFAULT_PERSONA,
                    presets,
                };
            }
            catch { /* fallthrough */ }
        }
        return { enabled: true, defaultPersona: MOOD_DEFAULT_PERSONA, presets: {} };
    };
    // ── 渲染缓存：key = 人设文本本身 → 拼好的注入文本 ────────────────────────
    // 按内容缓存（而非按 preset id + 版本号）：外部直接编辑 settings.yaml 时
    // 内容变了 key 就变，天然不会读到旧文本，也不需要失效通知。
    const cache = new Map();
    /** 从本次组装上下文取出该 agent 实际运行的 preset id。 */
    const presetIdOf = (context) => {
        const agentCtx = context?.agent?.ctx;
        if (agentCtx === undefined)
            return '';
        // agentPresets 是可选服务：没有 roster 的部署（headless / 裸组装）拿不到它，
        // 此时所有 agent 一律走 defaultPersona，而不是让本段炸掉整次组装。
        const presets = ctx.get?.('agentPresets');
        if (presets?.composedPreset === undefined)
            return '';
        try {
            return presets.composedPreset(agentCtx) ?? '';
        }
        catch {
            return '';
        }
    };
    const render = (context) => {
        const config = readConfig();
        if (!config.enabled)
            return '';
        // 未单独配置的 Agent（含全新建的）默认开启并沿用默认人设。
        const entry = config.presets[presetIdOf(context)];
        if (entry !== undefined && !entry.enabled)
            return '';
        const persona = entry?.persona !== undefined && entry.persona.trim() !== ''
            ? entry.persona
            : config.defaultPersona;
        const hit = cache.get(persona);
        if (hit !== undefined)
            return hit;
        const text = buildInstruction(persona);
        if (cache.size > 32)
            cache.clear();
        cache.set(persona, text);
        return text;
    };
    ctx.effect(() => ctx.systemPrompt.section({
        name: 'mood',
        // persona（order 0）之前、team-mode（-30）之后：MOOD 讲「怎么开口」，
        // 应当排在部署 persona 之前被读到。
        order: -20,
        text: (context) => render(context),
    }), 'webui: mood prompt section');
    // ── HTTP API ──────────────────────────────────────────────────────────────
    /** 当前 preset 名单（设置页据此列行；服务缺失时返回空数组）。 */
    const readRoster = async () => {
        const presets = ctx.get?.('agentPresets');
        if (presets?.list === undefined)
            return [];
        try {
            const rows = await presets.list();
            const defaultId = presets.defaultId;
            return (Array.isArray(rows) ? rows : [])
                .map((row) => ({
                id: String(row?.id ?? ''),
                trust: row?.trust === 'system' ? 'system' : 'user',
                isDefault: row?.id === defaultId,
                ...typeof row?.name === 'string' ? { name: row.name } : {},
                ...typeof row?.description === 'string' ? { description: row.description } : {},
                ...typeof row?.broken === 'string' ? { broken: row.broken } : {},
            }))
                .filter((row) => row.id !== '');
        }
        catch (error) {
            console.log('[webui-mood] agentPresets.list failed:', error?.message ?? error);
            return [];
        }
    };
    /** 合并写入：只覆盖 body 里出现的字段，其余保持原值。 */
    const applyPatch = async (body) => {
        if (scope === undefined || body === null || typeof body !== 'object')
            return;
        const current = readConfig();
        const next = {
            enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
            defaultPersona: typeof body.defaultPersona === 'string' && body.defaultPersona.trim() !== ''
                ? body.defaultPersona.slice(0, MAX_PERSONA_CHARS)
                : current.defaultPersona,
            presets: { ...current.presets },
        };
        if (body.presets !== null && typeof body.presets === 'object') {
            for (const [id, patch] of Object.entries(body.presets)) {
                if (!isPresetId(id))
                    continue;
                // 显式 null = 删除该 Agent 的覆盖，回落到默认人设。
                if (patch === null) {
                    delete next.presets[id];
                    continue;
                }
                if (next.presets[id] === undefined && Object.keys(next.presets).length >= MAX_PRESET_ENTRIES)
                    continue;
                next.presets[id] = normalizeEntry(patch, next.presets[id]);
            }
        }
        await scope.update(MoodSchema(next));
    };
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: MOOD_API,
        handler: async (req, res) => {
            const respond = (status, payload) => {
                res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify(payload));
            };
            try {
                if (req.method === 'POST')
                    await applyPatch(await readBody(req));
                const config = readConfig();
                respond(200, {
                    ok: true,
                    enabled: config.enabled,
                    defaultPersona: config.defaultPersona,
                    presets: config.presets,
                    roster: await readRoster(),
                    template: MOOD_DEFAULT_PERSONA,
                });
            }
            catch (error) {
                respond(500, { ok: false, error: String(error?.message ?? error) });
            }
        },
    }), 'webui: mood api route');
}
//# sourceMappingURL=mood.js.map