/**
 * webui — 网关伪装接入（gateway-rewrite）。
 *
 * 部分 LLM 网关按 User-Agent 白名单放行（如 agentrouter.org 只接受
 * claude-cli / codex_cli_rs 等 agent 客户端的完整格式 UA），DSH 的归因 UA
 * 会被 401「unauthorized client detected」拒绝，且归因头在设计上不可通过
 * provider 配置覆盖；另有网关本机直连不通、必须经本地 HTTP 代理出网。
 * 本模块在 fetch 层按域名规则改写 User-Agent 并可选注入代理 dispatcher，
 * 让这类网关按原生 baseURL 直接接入，无需本地反代进程。
 *
 * 机制：包装 globalThis.fetch（幂等）。llm-pi-ai 底层 OpenAI SDK 不传自定义
 * fetch 且每次构建 client 时经 Shims.getDefaultFetch() 动态读取全局 fetch，
 * 因此包装对其后发起的全部请求生效；未命中规则的请求原样透传，每请求只多
 * 一次 URL 解析 + 规则遍历（规则数为个位数）。SSE 流式只是响应对象的透传，
 * 不受影响。
 * settings 命名空间 `gateway-rewrite` 持久化；HTTP API：
 *   GET  /api/webui-gateway-rewrite/state
 *   POST /api/webui-gateway-rewrite/set （保存即运行时生效，无需重启）
 */
import z from '@deepseek-ai/schemastery';
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
export const inject = ['settings', 'webServer'];
const HOOK_INSTALLED = Symbol.for('webui.gatewayRewrite.installed');
// 当前生效的规则状态；fetch 包装函数每次调用时读它。
let rewriteState = null;
// ProxyAgent 实例按 url 缓存复用，避免每请求建连接池。
const agentCache = new Map();
function loadUndici() {
    const candidates = [];
    try {
        candidates.push(new URL('../../node_modules/undici/package.json', import.meta.url).href);
    }
    catch { /* ignore */ }
    candidates.push('D:/AI/deepseek-harness/node_modules/undici/package.json');
    const storeBase = 'D:/AI/deepseek-harness/node_modules/.pnpm';
    try {
        const { readdirSync } = nodeRequire('node:fs');
        const { join } = nodeRequire('node:path');
        const dirs = readdirSync(storeBase).filter((d) => d.startsWith('undici@') && !d.includes('undici-types'));
        dirs.sort((a, b) => {
            const va = a.match(/undici@(.+)/)?.[1] ?? '';
            const vb = b.match(/undici@(.+)/)?.[1] ?? '';
            return vb.localeCompare(a, undefined, { numeric: true });
        });
        for (const d of dirs)
            candidates.push(join(storeBase, d, 'node_modules', 'undici', 'package.json'));
    }
    catch { /* store 扫描失败则跳过 */ }
    for (const target of candidates) {
        try {
            const req = createRequire(target);
            const ud = req('undici');
            if (ud && typeof ud.ProxyAgent === 'function')
                return ud;
        }
        catch { /* 下一个候选 */ }
    }
    return null;
}
/** 取（或建）某代理地址的 ProxyAgent；不可用时返回 undefined 并保持直连。 */
function agentFor(proxyUrl) {
    const cached = agentCache.get(proxyUrl);
    if (cached !== undefined)
        return cached;
    const undici = loadUndici();
    if (!undici)
        return undefined;
    try {
        const agent = new undici.ProxyAgent(proxyUrl);
        agentCache.set(proxyUrl, agent);
        return agent;
    }
    catch {
        return undefined;
    }
}
function normalizeHost(input) {
    if (typeof input !== 'string')
        return '';
    let value = input.trim().toLowerCase();
    if (value === '')
        return '';
    if (value.includes('://')) {
        try {
            value = new URL(value).hostname;
        }
        catch { /* 非法 URL，按字面处理 */ }
    }
    value = value.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
    return value;
}
/** 规范化规则数组：丢空 host / 空 UA 的项，去重，字段裁剪为字符串。 */
function normalizeRules(input) {
    const out = [];
    const seen = new Set();
    for (const raw of input) {
        if (!raw || typeof raw !== 'object')
            continue;
        const record = raw;
        const host = normalizeHost(record.host);
        const userAgent = typeof record.userAgent === 'string' ? record.userAgent.trim() : '';
        const proxyUrl = typeof record.proxyUrl === 'string' ? record.proxyUrl.trim() : '';
        if (host === '' || userAgent === '')
            continue;
        if (proxyUrl !== '' && !/^https?:\/\/.+/.test(proxyUrl))
            continue;
        if (seen.has(host))
            continue;
        seen.add(host);
        out.push({ host, userAgent, proxyUrl });
    }
    return out;
}
/** 命中判定：精确 host 或 `*.domain` 模式（含子域）。 */
function matchRule(host, rules) {
    for (const rule of rules) {
        if (rule.host === host)
            return rule;
        if (rule.host.startsWith('*.') && host.endsWith(rule.host.slice(1)))
            return rule;
    }
    return null;
}
/**
 * 安装 fetch 包装（幂等）：对命中规则的请求覆盖 user-agent 头并可选注入
 * dispatcher。放在所有其他 fetch 包装（如 dsh-proxy）的最外层——本模块在
 * index.ts 里晚于 network-proxy 装配，且总是显式给命中请求设置 dispatcher，
 * 不依赖包装顺序。
 */
function installHook() {
    const g = globalThis;
    if (g[HOOK_INSTALLED] === true)
        return;
    g[HOOK_INSTALLED] = true;
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = function (input, init) {
        const state = rewriteState;
        if (state === null || !state.enabled || state.rules.length === 0)
            return original(input, init);
        let host;
        let href = null;
        try {
            const raw = typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.href
                    : input && typeof input === 'object' && 'url' in input
                        ? String(input.url)
                        : '';
            const parsed = new URL(raw);
            host = parsed.hostname.toLowerCase();
            href = parsed.href;
        }
        catch {
            return original(input, init);
        }
        const rule = matchRule(host, state.rules);
        if (rule === null)
            return original(input, init);
        const next = init === undefined || init === null ? {} : { ...init };
        // headers 归一成 Headers 实例再覆盖 UA：authorization / content-type 等
        // 其余头原样保留；init 形态（Headers / 数组 / 对象 / undefined）都兼容。
        const source = next.headers ?? (input && typeof input === 'object' && 'headers' in input ? input.headers : undefined);
        const headers = source instanceof Headers ? source : new Headers(source ?? undefined);
        if (rule.userAgent !== '')
            headers.set('user-agent', rule.userAgent);
        next.headers = headers;
        if (rule.proxyUrl !== '') {
            const agent = agentFor(rule.proxyUrl);
            if (agent !== undefined)
                next.dispatcher = agent;
        }
        return original(href ?? input, next);
    };
}
export function applyGatewayRewrite(ctx) {
    // ---- settings 命名空间（settings.yaml 持久化）----
    let scope;
    try {
        scope = ctx.settings.register('gateway-rewrite', z.object({
            enabled: z.boolean().default(false),
            // 规则项的逐字段校验由 normalizeRules 在读取侧完成，schema 只约束形状。
            rules: z.array(z.any()).default([]),
        }));
    }
    catch (error) {
        console.log('[webui-gateway-rewrite] settings namespace already registered:', error?.message ?? error);
    }
    const readConfig = () => {
        if (scope !== undefined) {
            try {
                const v = scope.get();
                // 缺字段视为关闭，避免「命名空间存在但没写 enabled」重启后凭空启用。
                return {
                    enabled: v.enabled === true,
                    rules: normalizeRules(Array.isArray(v.rules) ? v.rules : []),
                };
            }
            catch { /* fallthrough */ }
        }
        return { enabled: false, rules: [] };
    };
    const applyConfig = (cfg) => {
        rewriteState = cfg.enabled && cfg.rules.length > 0 ? cfg : { enabled: false, rules: [] };
        installHook();
    };
    // 启动即应用已存配置。
    try {
        const cfg = readConfig();
        applyConfig(cfg);
        console.log(`[webui-gateway-rewrite] boot: ${cfg.enabled ? `enabled (${cfg.rules.length} rules: ${cfg.rules.map(r => r.host).join(', ')})` : 'disabled'}`);
    }
    catch (err) {
        console.log('[webui-gateway-rewrite] boot apply failed:', err?.message ?? err);
    }
    // ---- HTTP API ----
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
    function writeJson(res, obj) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(obj));
    }
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/webui-gateway-rewrite/state',
        handler: async (_req, res) => {
            try {
                const cfg = readConfig();
                writeJson(res, { ok: true, ...cfg, active: rewriteState !== null && rewriteState.enabled });
            }
            catch (error) {
                writeJson(res, { ok: false, error: String(error?.message ?? error) });
            }
        },
    }), 'webui: gateway-rewrite state');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/webui-gateway-rewrite/set',
        handler: async (req, res) => {
            try {
                if (req.method !== 'POST') {
                    res.writeHead(405, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, message: 'method not allowed' }));
                    return;
                }
                const body = await readBody(req);
                if (!body || typeof body !== 'object') {
                    writeJson(res, { ok: false, message: '参数错误' });
                    return;
                }
                const current = readConfig();
                const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled;
                const rules = Array.isArray(body.rules) ? normalizeRules(body.rules) : current.rules;
                const bad = rules.find(r => r.proxyUrl !== '' && !/^https?:\/\/.+/.test(r.proxyUrl));
                if (bad !== undefined) {
                    writeJson(res, { ok: false, message: `${bad.host} 的代理地址需为 http:// 或 https:// 开头` });
                    return;
                }
                const next = { enabled, rules };
                applyConfig(next);
                console.log(`[webui-gateway-rewrite] ${enabled ? `ENABLED (${rules.length} rules)` : 'DISABLED'}: ${rules.map(r => r.host).join(', ')}`);
                if (scope !== undefined) {
                    try {
                        await scope.update({ enabled, rules });
                    }
                    catch (err) {
                        console.log('[webui-gateway-rewrite] persist failed:', err?.message ?? err);
                    }
                }
                writeJson(res, { ok: true, ...next, active: enabled });
            }
            catch (error) {
                writeJson(res, { ok: false, error: String(error?.message ?? error) });
            }
        },
    }), 'webui: gateway-rewrite set');
}
//# sourceMappingURL=gateway-rewrite.js.map