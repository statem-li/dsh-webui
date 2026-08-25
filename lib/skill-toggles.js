/**
 * 技能开关(skill-toggles):挂 /api/skill-toggles 路由,提供两级开关——
 *
 *  1. **全局层**:读写技能 SKILL.md 的 frontmatter 开关字段
 *     (`user-invocable: false` + `disable-model-invocation: true`),
 *     对所有 Agent 预设生效。DSH 内核 skill-filesystem 解析这两个字段,
 *     改完文件后内核 watcher 自动重扫,无需重启。
 *
 *  2. **Agent 预设层**:同一个技能可以「对 standard 开、对 code 关」。
 *     账本存 `<agentsHome>/skills/.preset-skills.json`
 *     (`{ version: 1, presets: { <presetId>: { <skillName>: false } } }`;
 *     缺省 = 继承全局层,只有显式 false 才在该预设下关闭)。
 *
 * 预设层的生效机制(零 DSH 源码改动、运行时零 I/O):
 *   `ctx.skills` 是**分层**注册表——global 层 + scope 链(preset 常驻层 →
 *   agent 层),读取时按层合并,**最近层的同名条目直接覆盖更远层**。而每个
 *   agent 自身就是它那一层的 scope key,`agent.ctx.skills.registerProvider()`
 *   正好注册进该 agent 的层(注册表按调用方 ctx 的 scope 归层)。
 *   于是本模块在 `agent/created` 时给每个 agent 装一个「闸门 provider」:
 *   它只为「该 agent 所属预设里被关掉的技能名」返回同名候选,且候选的
 *   invocation 两个开关都是 false。合并后这些名字在该 agent 眼里就是
 *   不可调用的 —— 模型目录(catalog)不列、`skill` 工具拒绝加载、
 *   `/name` 手势也不认。其它 agent / 其它预设完全不受影响。
 *
 *   闸门 provider 的 list() 只读内存里的账本(无文件 I/O),注册表本身还有
 *   按 (cwd, scope 链, revision) 的缓存,所以每回合额外开销可忽略。
 *   写账本后调用各闸门的 invalidate() 使缓存失效,下一步即生效。
 *
 * 本模块只读写技能文件与自己的账本,不动 DSH 源码;数据面与技能管理面板
 * (/api/skill-manager)同一批技能目录(managedRoot + dshRoot)。
 *
 * Routes (all under /api/skill-toggles):
 *   GET  /status                          → { skills: {name: enabled}, bundles: {id: enabled} }
 *   PUT  /skills/:name        { enabled } → 全局开/关单个技能
 *   PUT  /bundles/:id         { enabled } → 全局开/关一个技能包(内全部技能)
 *   GET  /presets                         → { presets: [...roster], overrides, skills, bundles }
 *   PUT  /presets/:preset/skills/:name    { enabled } → 该预设下开/关单个技能
 *   PUT  /presets/:preset/bundles/:id     { enabled } → 该预设下开/关一个技能包
 *   POST /presets/:preset/reset           → 清空该预设的全部覆盖(回落全局)
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
/** Stable Cordis plugin name fragment (merged into webui host apply). */
export const name = 'skill-toggles';
/** Services required before this plugin activates. */
export const inject = ['webServer'];
const SKILL_FILE = 'SKILL.md';
const BUNDLES_FILE = '.bundles.json';
/** 预设级开关账本(与 .bundles.json 同目录)。 */
const PRESET_FILE = '.preset-skills.json';
const ROUTE_PREFIX = '/api/skill-toggles';
const MAX_BODY_BYTES = 256 * 1024;
/** 闸门 provider 在每个 agent 层里的名字(同层唯一即可)。 */
const MASK_PROVIDER = 'webui-preset-mask';
/** 账本里 preset 条目上限(preset 名单本身十几条量级)。 */
const MAX_PRESET_ENTRIES = 50;
/** The writable user-agents skill root (honors $DSH_AGENTS_HOME). */
function managedRoot() {
    const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents');
    return join(agentsHome, 'skills');
}
/** The user-dsh skill root (honors $DSH_HOME). */
function dshRoot() {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(dshHome, 'skills');
}
/** Read the bundle ledger; missing/corrupt files start empty. */
async function readBundles(root) {
    try {
        const parsed = JSON.parse(await readFile(join(root, BUNDLES_FILE), 'utf8'));
        if (typeof parsed === 'object' && parsed !== null
            && parsed.version === 1
            && Array.isArray(parsed.bundles)) {
            return parsed;
        }
    }
    catch {
        // Missing or unreadable ledger: treat as empty.
    }
    return { version: 1, bundles: [] };
}
/** preset id 形状(与 dsh-agent-presets 的目录名规则一致)。 */
function isPresetId(value) {
    return /^[a-z0-9][a-z0-9-]*$/.test(value);
}
/** 技能名形状(与内核 SKILL_NAME 一致)。 */
function isSkillName(value) {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
/** 账本路径(与 .bundles.json 同目录:managedRoot)。 */
function presetLedgerPath() {
    return join(managedRoot(), PRESET_FILE);
}
/** 归一化任意输入为合法账本(脏字段直接丢弃)。 */
function normalizeLedger(input) {
    const presets = {};
    const raw = (input !== null && typeof input === 'object'
        ? input.presets
        : undefined);
    if (raw !== null && typeof raw === 'object') {
        for (const [presetId, table] of Object.entries(raw)) {
            if (!isPresetId(presetId))
                continue;
            if (table === null || typeof table !== 'object')
                continue;
            if (Object.keys(presets).length >= MAX_PRESET_ENTRIES)
                break;
            const entries = {};
            for (const [skillName, state] of Object.entries(table)) {
                if (!isSkillName(skillName) || typeof state !== 'boolean')
                    continue;
                entries[skillName] = state;
            }
            presets[presetId] = entries;
        }
    }
    return { version: 1, presets };
}
/**
 * 进程内账本单例:HTTP 写入后立即刷新,闸门 provider 的 list() 只读它,
 * 因此每回合的额外开销是一次 Map 命中,零文件 I/O。
 */
let ledgerCache;
/** 账本变更后需要失效的技能注册表缓存(每个 agent 一个闸门的 invalidate)。 */
const maskInvalidators = new Set();
/** 读账本(首次读盘,之后走内存;文件缺失/损坏视为空账本)。 */
async function readLedger() {
    if (ledgerCache !== undefined)
        return ledgerCache;
    let parsed;
    try {
        parsed = JSON.parse(await readFile(presetLedgerPath(), 'utf8'));
    }
    catch {
        parsed = undefined;
    }
    ledgerCache = normalizeLedger(parsed);
    return ledgerCache;
}
/** 原子写账本 + 刷新内存副本 + 让所有闸门缓存失效。 */
async function writeLedger(next) {
    const target = presetLedgerPath();
    const temp = `${target}.tmp`;
    await mkdir(managedRoot(), { recursive: true });
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temp, target);
    ledgerCache = next;
    for (const invalidate of maskInvalidators) {
        try {
            invalidate();
        }
        catch { /* 单个 agent 的失效失败不影响其它 */ }
    }
}
/** 该预设下被显式关闭的技能名集合(空集 = 完全继承全局层)。 */
function disabledNames(ledger, presetId) {
    const table = ledger.presets[presetId];
    if (table === undefined)
        return new Set();
    const disabled = new Set();
    for (const [skillName, state] of Object.entries(table)) {
        if (state === false)
            disabled.add(skillName);
    }
    return disabled;
}
/** 写入一批「预设 → 技能 → 开关」;enabled=true 时删除覆盖(回落全局)。 */
async function setPresetSkills(presetId, names, enabled) {
    const current = await readLedger();
    const table = { ...(current.presets[presetId] ?? {}) };
    let changed = 0;
    for (const skillName of names) {
        if (!isSkillName(skillName))
            continue;
        if (enabled) {
            if (table[skillName] !== undefined) {
                delete table[skillName];
                changed += 1;
            }
        }
        else if (table[skillName] !== false) {
            table[skillName] = false;
            changed += 1;
        }
    }
    if (changed === 0)
        return 0;
    const presets = { ...current.presets };
    if (Object.keys(table).length === 0)
        delete presets[presetId];
    else
        presets[presetId] = table;
    await writeLedger({ version: 1, presets });
    return changed;
}
/** Locate a skill directory under a root; undefined when absent. */
async function skillDirUnder(root, skillName) {
    try {
        const info = await import('node:fs/promises').then(fs => fs.stat(join(root, skillName)));
        if (info.isDirectory())
            return join(root, skillName);
    }
    catch {
        // fallthrough
    }
    return undefined;
}
/** Locate a skill directory across both roots (managed first, then dsh). */
async function locateSkillDir(skillName) {
    return await skillDirUnder(managedRoot(), skillName)
        ?? await skillDirUnder(dshRoot(), skillName);
}
/** Read a skill's SKILL.md raw text; undefined when missing. */
async function readSkillFile(skillName) {
    const dir = await locateSkillDir(skillName);
    if (dir === undefined)
        return undefined;
    try {
        return { dir, raw: await readFile(join(dir, SKILL_FILE), 'utf8') };
    }
    catch {
        return undefined;
    }
}
/**
 * 解析 frontmatter 块,返回 { block: 原始块文本(含 --- 围栏,无则 undefined),
 * body: 去掉 frontmatter 后的正文, fields: {key: value} }。
 * 仅解析顶层 `key: value` 行;块外内容原样保留。
 */
function splitFrontmatter(raw) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
    if (match === null) {
        return { hasFence: false, fields: [], body: raw };
    }
    const block = match[1];
    const fields = [];
    for (const line of block.split(/\r?\n/)) {
        const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (pair !== null)
            fields.push({ key: pair[1], value: pair[2].trim() });
    }
    return { hasFence: true, fields, body: raw.slice(match[0].length) };
}
/**
 * 更新 SKILL.md:设置/移除开关字段,保留其它 frontmatter 字段与正文原样。
 * 禁用 = user-invocable: false + disable-model-invocation: true;
 * 启用 = 两者移除(缺省即允许)。
 */
function applyToggle(raw, enabled) {
    const parsed = splitFrontmatter(raw);
    const toggleKeys = new Set(['user-invocable', 'disable-model-invocation']);
    const kept = parsed.fields.filter(field => !toggleKeys.has(field.key));
    const lines = kept.map(field => `${field.key}: ${field.value}`);
    if (!enabled) {
        lines.push('user-invocable: false');
        lines.push('disable-model-invocation: true');
    }
    const block = lines.join('\n');
    if (parsed.hasFence) {
        return `---\n${block}\n---\n${parsed.body}`;
    }
    // 无 frontmatter 时创建;正文若以空行开头则保留一个空行分隔。
    const body = parsed.body.startsWith('\n') ? parsed.body.slice(1) : parsed.body;
    return `---\n${block}\n---\n${body}`;
}
/** 读技能当前开关状态(true = 启用)。 */
function parseEnabled(fields) {
    const userInvocable = fields.find(field => field.key === 'user-invocable')?.value;
    const disableModel = fields.find(field => field.key === 'disable-model-invocation')?.value;
    const userDisabled = userInvocable?.toLowerCase() === 'false';
    const modelDisabled = disableModel?.toLowerCase() === 'true';
    return !(userDisabled || modelDisabled);
}
/** 设置单个技能开关。 */
async function setSkillEnabled(skillName, enabled) {
    const found = await readSkillFile(skillName);
    if (found === undefined)
        return false;
    const updated = applyToggle(found.raw, enabled);
    if (updated === found.raw)
        return true;
    const target = join(found.dir, SKILL_FILE);
    const temp = `${target}.toggle.tmp`;
    await mkdir(found.dir, { recursive: true });
    await writeFile(temp, updated, 'utf8');
    await rename(temp, target);
    return true;
}
/** 设置一个技能包内全部技能开关;返回处理数。 */
async function setBundleEnabled(bundleId, enabled) {
    const root = managedRoot();
    const ledger = await readBundles(root);
    const record = ledger.bundles.find(bundle => bundle.id === bundleId);
    if (record === undefined)
        return -1;
    let handled = 0;
    for (const skillName of record.skills) {
        if (await setSkillEnabled(skillName, enabled))
            handled += 1;
    }
    return handled;
}
/** 全量状态:每个技能与每个技能包的启用状态。 */
async function status() {
    const skills = {};
    const seen = new Set();
    for (const root of [managedRoot(), dshRoot()]) {
        let entries = [];
        try {
            entries = (await readdir(root, { withFileTypes: true }))
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name);
        }
        catch {
            continue;
        }
        for (const dir of entries) {
            if (seen.has(dir))
                continue;
            seen.add(dir);
            try {
                const raw = await readFile(join(root, dir, SKILL_FILE), 'utf8');
                const fields = splitFrontmatter(raw).fields;
                const nameField = fields.find(field => field.key === 'name')?.value;
                const name = nameField !== undefined && nameField !== '' ? nameField : dir;
                skills[name] = parseEnabled(fields);
            }
            catch {
                // 非技能目录或不可读:跳过。
            }
        }
    }
    const bundles = {};
    const ledger = await readBundles(managedRoot());
    for (const record of ledger.bundles) {
        const states = record.skills.map(skillName => skills[skillName]);
        bundles[record.id] = states.length === 0 || states.every(state => state !== false);
    }
    return { skills, bundles };
}
/** ── 预设闸门:把「该预设下被关掉的技能」在 agent 层遮成不可调用 ─────────── */
/**
 * 给一个 agent 装闸门 provider。
 *
 * `skills.registerProvider()` 按调用方 ctx 的 scope 归层,而 `agent.ctx` 正好
 * 携带该 agent 的 scope,所以这个 provider 只属于这一个 agent;读取时 agent 层
 * 是最近层,同名条目直接盖住 global 层的真实技能 —— 不必碰 SKILL.md,
 * 也不影响其它预设/其它 agent。
 *
 * list() 只查内存账本(无 I/O);get() 一律返回 undefined,于是 `skill` 工具
 * 即使被硬点名也加载不到内容。
 * @param ctx - host 上下文(仅用于日志)。
 * @param agent - 目标 agent(需带 ctx 与 scope)。
 * @returns 该 agent 的闸门 fiber,agent 销毁时由调用方 dispose。
 */
function installMask(ctx, agent) {
    const presetOf = () => {
        const presets = ctx.get?.('agentPresets');
        if (presets?.composedPreset === undefined)
            return '';
        try {
            return presets.composedPreset(agent.ctx) ?? '';
        }
        catch {
            return '';
        }
    };
    return agent.ctx.inject(['skills'], (scope) => {
        scope.skills.registerProvider((control) => {
            maskInvalidators.add(control.invalidate);
            control.signal.addEventListener('abort', () => {
                maskInvalidators.delete(control.invalidate);
            }, { once: true });
            return {
                name: MASK_PROVIDER,
                list: async () => {
                    const presetId = presetOf();
                    if (presetId === '')
                        return [];
                    const disabled = disabledNames(await readLedger(), presetId);
                    if (disabled.size === 0)
                        return [];
                    return [...disabled].map(skillName => ({
                        name: skillName,
                        description: `disabled for agent preset "${presetId}"`,
                        invocation: { modelInvocable: false, userInvocable: false },
                        source: 'custom',
                        provider: MASK_PROVIDER,
                        rank: 0,
                        locator: null,
                    }));
                },
                // 被遮住的名字没有可加载的正文:调用方拿到 undefined 即等于「不存在」。
                get: async () => undefined,
            };
        });
    });
}
/** 当前 preset 名单(设置页据此列圆球;服务缺失时返回空数组)。 */
async function readRoster(ctx) {
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
            ...typeof row?.order === 'number' ? { order: row.order } : {},
        }))
            .filter((row) => row.id !== '');
    }
    catch (error) {
        console.log('[skill-toggles] agentPresets.list failed:', error?.message ?? error);
        return [];
    }
}
/** ── HTTP plumbing (same contract as skill-manager) ─────────────────────── */
function isLoopbackAddress(address) {
    if (typeof address !== 'string')
        return false;
    const a = address.toLowerCase();
    if (a === '::1')
        return true;
    const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a;
    const octets = ipv4.split('.');
    return octets.length === 4 && octets[0] === '127'
        && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function hostNameOf(value) {
    if (typeof value !== 'string')
        return null;
    const host = value.trim().toLowerCase();
    if (host.startsWith('[')) {
        const close = host.indexOf(']');
        if (close <= 1)
            return null;
        const suffix = host.slice(close + 1);
        if (suffix !== '' && !/^:\d+$/.test(suffix))
            return null;
        return host.slice(1, close);
    }
    const firstColon = host.indexOf(':');
    const lastColon = host.lastIndexOf(':');
    if (firstColon !== lastColon)
        return null;
    return firstColon === -1 ? host : host.slice(0, firstColon);
}
function loopbackAllowed(req) {
    if (!isLoopbackAddress(req.socket.remoteAddress))
        return false;
    const host = hostNameOf(req.headers.host);
    if (host === null)
        return false;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function json(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
    });
    res.end(body);
}
function readBody(req) {
    return new Promise((resolvePromise, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) {
                resolvePromise({});
                return;
            }
            try {
                resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch {
                reject(new Error('invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}
/** Route dispatch for one /api/skill-toggles request. */
async function handle(ctx, req, res) {
    if (!loopbackAllowed(req)) {
        json(res, 403, { error: 'loopback-only' });
        return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const rest = url.pathname.slice(ROUTE_PREFIX.length);
    const method = req.method ?? 'GET';
    try {
        if (method === 'GET' && (rest === '' || rest === '/status')) {
            json(res, 200, await status());
            return;
        }
        const matchSkill = /^\/skills\/([^/]+)$/.exec(rest);
        if (method === 'PUT' && matchSkill !== null) {
            const body = (await readBody(req));
            const enabled = body.enabled;
            if (typeof enabled !== 'boolean')
                throw new Error('enabled must be a boolean');
            const name = decodeURIComponent(matchSkill[1]);
            const ok = await setSkillEnabled(name, enabled);
            if (!ok)
                throw new Error(`skill ${JSON.stringify(name)} not found`);
            json(res, 200, { ok: true, name, enabled });
            return;
        }
        const matchBundle = /^\/bundles\/([^/]+)$/.exec(rest);
        if (method === 'PUT' && matchBundle !== null) {
            const body = (await readBody(req));
            const enabled = body.enabled;
            if (typeof enabled !== 'boolean')
                throw new Error('enabled must be a boolean');
            const id = decodeURIComponent(matchBundle[1]);
            const handled = await setBundleEnabled(id, enabled);
            if (handled < 0)
                throw new Error(`bundle ${JSON.stringify(id)} not found`);
            json(res, 200, { ok: true, id, enabled, handled });
            return;
        }
        // ── 预设层 ────────────────────────────────────────────────────────────
        if (method === 'GET' && rest === '/presets') {
            const [roster, global, ledger] = await Promise.all([
                readRoster(ctx), status(), readLedger(),
            ]);
            json(res, 200, {
                presets: roster,
                overrides: ledger.presets,
                skills: global.skills,
                bundles: global.bundles,
            });
            return;
        }
        const matchPresetSkill = /^\/presets\/([^/]+)\/skills\/([^/]+)$/.exec(rest);
        if (method === 'PUT' && matchPresetSkill !== null) {
            const body = (await readBody(req));
            const enabled = body.enabled;
            if (typeof enabled !== 'boolean')
                throw new Error('enabled must be a boolean');
            const presetId = decodeURIComponent(matchPresetSkill[1]);
            if (!isPresetId(presetId))
                throw new Error(`invalid preset id ${JSON.stringify(presetId)}`);
            const skillName = decodeURIComponent(matchPresetSkill[2]);
            if (!isSkillName(skillName))
                throw new Error(`invalid skill name ${JSON.stringify(skillName)}`);
            const changed = await setPresetSkills(presetId, [skillName], enabled);
            json(res, 200, { ok: true, preset: presetId, name: skillName, enabled, changed });
            return;
        }
        const matchPresetBundle = /^\/presets\/([^/]+)\/bundles\/([^/]+)$/.exec(rest);
        if (method === 'PUT' && matchPresetBundle !== null) {
            const body = (await readBody(req));
            const enabled = body.enabled;
            if (typeof enabled !== 'boolean')
                throw new Error('enabled must be a boolean');
            const presetId = decodeURIComponent(matchPresetBundle[1]);
            if (!isPresetId(presetId))
                throw new Error(`invalid preset id ${JSON.stringify(presetId)}`);
            const bundleId = decodeURIComponent(matchPresetBundle[2]);
            const ledger = await readBundles(managedRoot());
            const record = ledger.bundles.find(bundle => bundle.id === bundleId);
            if (record === undefined)
                throw new Error(`bundle ${JSON.stringify(bundleId)} not found`);
            const changed = await setPresetSkills(presetId, record.skills, enabled);
            json(res, 200, { ok: true, preset: presetId, id: bundleId, enabled, changed });
            return;
        }
        const matchPresetReset = /^\/presets\/([^/]+)\/reset$/.exec(rest);
        if (method === 'POST' && matchPresetReset !== null) {
            const presetId = decodeURIComponent(matchPresetReset[1]);
            if (!isPresetId(presetId))
                throw new Error(`invalid preset id ${JSON.stringify(presetId)}`);
            const current = await readLedger();
            if (current.presets[presetId] !== undefined) {
                const presets = { ...current.presets };
                delete presets[presetId];
                await writeLedger({ version: 1, presets });
            }
            json(res, 200, { ok: true, preset: presetId });
            return;
        }
        json(res, 404, { error: `no route for ${method} ${rest}` });
    }
    catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
}
/** Mount the routes and install the per-agent preset masks. */
export async function apply(ctx) {
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => {
            void handle(ctx, req, res);
        },
    }), 'webui: skill-toggles routes');
    // 闸门:每个 agent 一个,注册进它自己的 scope 层。agents 服务缺失(裸组装)
    // 时降级为「只有全局层开关」,不影响路由。
    ctx.effect(() => {
        const fibers = new Map();
        const install = (agent) => {
            if (agent === undefined || fibers.has(agent))
                return;
            try {
                fibers.set(agent, installMask(ctx, agent));
            }
            catch (error) {
                console.log('[skill-toggles] preset mask install failed:', error?.message ?? error);
            }
        };
        const remove = (agent) => {
            const fiber = fibers.get(agent);
            if (fiber === undefined)
                return;
            fibers.delete(agent);
            void Promise.resolve(fiber.dispose?.()).catch(() => { });
        };
        const agents = ctx.get?.('agents');
        if (agents?.list !== undefined)
            for (const agent of agents.list())
                install(agent);
        const offCreated = ctx.on('agent/created', ({ agent }) => { install(agent); });
        const offDisposed = ctx.on('agent/disposed', ({ agent }) => { remove(agent); });
        return () => {
            offCreated();
            offDisposed();
            for (const agent of [...fibers.keys()])
                remove(agent);
            maskInvalidators.clear();
        };
    }, 'webui: skill-toggles preset masks');
}
//# sourceMappingURL=skill-toggles.js.map