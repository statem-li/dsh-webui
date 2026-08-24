/**
 * webui — DSH 网络代理（自 dsh-proxy 合并）。
 *
 * 基于 undici ProxyAgent 做进程内代理（运行时生效，无需重启）：
 * - all 模式：全部请求走代理（兼做兜底）
 * - selected 模式：仅选中的厂商/域名走代理，其余直连
 * settings 命名空间 `network-proxy` 持久化；HTTP API：
 *   GET  /api/dsh-proxy/state | providers
 *   POST /api/dsh-proxy/set   （立即应用或解除）
 * 机制：包装 globalThis.fetch 按目标 host 注入 dispatcher；all 模式额外把
 * Symbol.for('undici.globalDispatcher.1') 换成 ProxyAgent 兜底非 fetch 通道。
 * 注意：该 symbol 是 Node 内建的 configurable:false 数据属性，delete 不生效
 * （静默返回 false），解除代理必须「赋值回启动时捕获的原始 dispatcher」。
 */
import z from '@deepseek-ai/schemastery';
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
export const inject = ['settings', 'webServer'];
const DISPATCHER_SYMBOL = Symbol.for('undici.globalDispatcher.1');
const ORIGINAL_FETCH = Symbol.for('dsh-proxy.originalFetch');
const DEFAULT_PROXY = 'http://127.0.0.1:10808';
/** 连通性自检目标与超时：走代理请求一个轻量海外端点。 */
const PROBE_URL = 'https://www.gstatic.com/generate_204';
const PROBE_TIMEOUT_MS = 8000;
/**
 * 规范化用户输入的域名：允许直接粘 URL（取 hostname）、去空白、转小写、
 * 去端口/路径/尾点、去重，并丢掉空项；保留 *. 前缀（matchHost 支持子域）。
 */
function normalizeHosts(input) {
    const out = [];
    for (const raw of input) {
        if (typeof raw !== 'string')
            continue;
        let value = raw.trim().toLowerCase();
        if (value === '')
            continue;
        if (value.includes('://')) {
            try {
                value = new URL(value).hostname;
            }
            catch { /* 不是合法 URL，按字面处理 */ }
        }
        value = value.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
        if (value === '' || out.includes(value))
            continue;
        out.push(value);
    }
    return out;
}
// 当前代理状态；globalThis.fetch 包装函数在每次调用时读它来决定是否走代理。
let proxyState = null;
/**
 * 启动时的原始全局 dispatcher（Node 内建 undici Agent）。
 * all 模式会把 symbol 换成 ProxyAgent，解除时必须赋值回这个基线——
 * 该属性 configurable:false，delete 静默失败，写 undefined 会让 fetch 断言崩溃。
 */
let baselineDispatcher;
let baselineCaptured = false;
function captureBaseline() {
    if (baselineCaptured)
        return;
    baselineCaptured = true;
    baselineDispatcher = globalThis[DISPATCHER_SYMBOL];
}
/** 把全局 dispatcher 恢复成基线；基线缺失（symbol 尚未初始化）时用新 Agent 兜底。 */
function restoreGlobalDispatcher() {
    const g = globalThis;
    if (baselineDispatcher !== undefined && baselineDispatcher !== null) {
        g[DISPATCHER_SYMBOL] = baselineDispatcher;
        return;
    }
    if (g[DISPATCHER_SYMBOL] === undefined || g[DISPATCHER_SYMBOL] === null)
        return;
    const undici = loadUndici();
    if (undici && typeof undici.Agent === 'function')
        g[DISPATCHER_SYMBOL] = new undici.Agent();
}
// 从宿主可解析的位置加载 undici（优先级：profile node_modules -> DSH checkout -> DSH pnpm store）。
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
            return vb.localeCompare(va, undefined, { numeric: true });
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
        catch (err) {
            console.log(`[dsh-proxy] undici load from ${String(target)} failed: ${err?.message ?? err}`);
        }
    }
    return null;
}
// 包装前的原始 fetch（只包一次，之后 globalThis.fetch 恒为代理选择层）。
function installFetchHook() {
    const g = globalThis;
    if (g[ORIGINAL_FETCH] && typeof g[ORIGINAL_FETCH] === 'function')
        return;
    const original = globalThis.fetch.bind(globalThis);
    Object.defineProperty(globalThis, ORIGINAL_FETCH, { value: original, configurable: true });
    globalThis.fetch = function (input, init) {
        const state = proxyState;
        if (state === null || !state.agent)
            return original(input, init);
        let viaProxy = state.mode === 'all';
        if (!viaProxy && state.hosts && state.hosts.size > 0) {
            const host = hostnameOf(input);
            viaProxy = host !== null && matchHost(host, state.hosts);
        }
        if (!viaProxy)
            return original(input, init);
        const next = init === undefined || init === null ? {} : { ...init };
        next.dispatcher = state.agent;
        return original(input, next);
    };
}
/** 从 fetch 入参提取 hostname（小写）；解析失败返回 null（不代理）。 */
function hostnameOf(input) {
    try {
        const raw = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.href
                : input && typeof input === 'object' && 'url' in input
                    ? String(input.url)
                    : '';
        return new URL(raw).hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
/** 命中判定：精确 host 或 `*.domain` 模式（含子域）。 */
function matchHost(host, hosts) {
    if (hosts.has(host))
        return true;
    for (const pattern of hosts) {
        if (typeof pattern !== 'string')
            continue;
        if (pattern.startsWith('*.')) {
            const suffix = pattern.slice(1); // '.example.com'
            if (host.endsWith(suffix))
                return true;
        }
    }
    return false;
}
export function applyProxy(ctx) {
    // ---- settings 命名空间（settings.yaml 持久化）----
    let scope;
    try {
        scope = ctx.settings.register('network-proxy', z.object({
            enabled: z.boolean().default(false),
            url: z.string().default(DEFAULT_PROXY),
            mode: z.union([z.const('all'), z.const('selected')]).default('all'),
            providers: z.array(z.string()).default([]),
            // selected 模式下额外走代理的域名（厂商目录里没有的服务，如
            // generativelanguage.googleapis.com；支持 *.example.com 通配）。
            extraHosts: z.array(z.string()).default([]),
        }));
    }
    catch (error) {
        console.log('[dsh-proxy] settings namespace already registered:', error?.message ?? error);
    }
    const readConfig = () => {
        if (scope !== undefined) {
            try {
                const v = scope.get();
                return {
                    // 缺字段视为关闭：v.enabled !== false 会把「命名空间存在但没写 enabled」
                    // 当成开启，重启后凭空启用代理。
                    enabled: v.enabled === true,
                    url: (v.url && v.url.trim()) || DEFAULT_PROXY,
                    mode: v.mode === 'selected' ? 'selected' : 'all',
                    providers: Array.isArray(v.providers) ? v.providers.filter((p) => typeof p === 'string') : [],
                    extraHosts: Array.isArray(v.extraHosts) ? normalizeHosts(v.extraHosts) : [],
                };
            }
            catch { /* fallthrough */ }
        }
        return { enabled: false, url: DEFAULT_PROXY, mode: 'all', providers: [], extraHosts: [] };
    };
    // ---- 读 llm-pi-ai 的厂商配置，导出 route key -> baseURL host ----
    const readProviders = () => {
        const out = [];
        try {
            const ns = ctx.settings.get('llm-pi-ai');
            const providers = ns && typeof ns === 'object' && ns.providers && typeof ns.providers === 'object'
                ? ns.providers
                : {};
            for (const [key, p] of Object.entries(providers)) {
                if (!p || typeof p !== 'object')
                    continue;
                const record = p;
                const baseURL = typeof record.baseURL === 'string' ? record.baseURL : '';
                let host = null;
                try {
                    host = new URL(baseURL).hostname;
                }
                catch { /* 非完整 URL，无 host */ }
                out.push({
                    key,
                    name: (typeof record.displayName === 'string' && record.displayName.trim()) || key,
                    baseURL,
                    host,
                    api: typeof record.api === 'string' ? record.api : '',
                });
            }
        }
        catch (error) {
            console.log('[dsh-proxy] readProviders failed:', error?.message ?? error);
        }
        return out;
    };
    /** 选中的厂商 route key（+ 手填域名）-> 去重后的 hostname 集合。 */
    const selectedHosts = (cfg) => {
        const hosts = new Set();
        if (Array.isArray(cfg.providers)) {
            const byKey = new Map(readProviders().map((p) => [p.key, p]));
            for (const key of cfg.providers) {
                const p = byKey.get(key);
                if (p && p.host)
                    hosts.add(p.host);
            }
        }
        if (Array.isArray(cfg.extraHosts)) {
            for (const host of normalizeHosts(cfg.extraHosts))
                hosts.add(host);
        }
        return hosts;
    };
    /**
     * 已勾选但当前厂商目录里不存在的 key（供应商被删/改名后留下的死选项）。
     * 这些 key 解析不出 host，静默不代理，界面需要提示用户清理。
     */
    const staleProviders = (cfg) => {
        if (!Array.isArray(cfg.providers))
            return [];
        const known = new Set(readProviders().map(p => p.key));
        return cfg.providers.filter(key => !known.has(key));
    };
    // ---- 状态：当前代理是否已生效 ----
    const isActive = () => {
        try {
            return proxyState !== null && !!(proxyState.agent && proxyState.agent.constructor
                && proxyState.agent.constructor.name === 'ProxyAgent');
        }
        catch {
            return false;
        }
    };
    // ---- 应用代理 / 解除代理 ----
    function applyProxy(cfg) {
        const undici = loadUndici();
        if (!undici)
            return { ok: false, message: '无法加载 undici' };
        let agent;
        try {
            agent = new undici.ProxyAgent(cfg.url);
        }
        catch (error) {
            return { ok: false, message: '代理地址无法建立连接池：' + String(error?.message ?? error) };
        }
        proxyState = { agent, mode: cfg.mode, hosts: selectedHosts(cfg) };
        captureBaseline();
        const g = globalThis;
        if (cfg.mode === 'all') {
            g[DISPATCHER_SYMBOL] = agent;
        }
        else {
            // selected 模式必须让未命中的请求走直连：全局 dispatcher 恢复成基线
            // （delete 对 configurable:false 的内建属性无效，之前会把上一次的
            //  ProxyAgent 永久留在全局，导致关代理/切窄范围后全站仍走代理）。
            restoreGlobalDispatcher();
        }
        return { ok: true };
    }
    function clearProxy() {
        captureBaseline();
        restoreGlobalDispatcher();
        proxyState = null;
    }
    // 安装 fetch 代理层（幂等），此后每次请求按 state 决定注入 dispatcher。
    installFetchHook();
    // 启动时按已存配置应用（若启用）。
    try {
        const cfg = readConfig();
        if (cfg.enabled) {
            const r = applyProxy(cfg);
            console.log(`[dsh-proxy] boot: proxy ${r.ok ? 'enabled' : 'FAILED'} url=${cfg.url} mode=${cfg.mode} hosts=${[...selectedHosts(cfg)].join(',')}`);
        }
        else {
            console.log('[dsh-proxy] boot: proxy disabled');
        }
    }
    catch (err) {
        console.log('[dsh-proxy] boot apply failed:', err?.message ?? err);
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
        path: '/api/dsh-proxy/state',
        handler: async (_req, res) => {
            try {
                const cfg = readConfig();
                writeJson(res, {
                    ok: true,
                    ...cfg,
                    hosts: [...selectedHosts(cfg)],
                    stale: staleProviders(cfg),
                    active: isActive(),
                });
            }
            catch (error) {
                writeJson(res, { ok: false, error: String(error?.message ?? error) });
            }
        },
    }), 'webui: dsh-proxy state');
    // 连通性自检：真正经代理发一次请求。isActive() 只说明 ProxyAgent 已挂载，
    // 代理进程没开时它仍是 true——界面「已生效」是假的，这个接口给出真实结果。
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-proxy/test',
        handler: async (_req, res) => {
            const started = Date.now();
            try {
                const cfg = readConfig();
                const undici = loadUndici();
                if (!undici) {
                    writeJson(res, { ok: false, message: '无法加载 undici' });
                    return;
                }
                let agent;
                try {
                    agent = new undici.ProxyAgent(cfg.url);
                }
                catch (error) {
                    writeJson(res, { ok: false, message: '代理地址无效：' + String(error?.message ?? error) });
                    return;
                }
                const original = globalThis[ORIGINAL_FETCH] ?? globalThis.fetch;
                const controller = new AbortController();
                const timer = setTimeout(() => { controller.abort(); }, PROBE_TIMEOUT_MS);
                try {
                    const response = await original(PROBE_URL, {
                        method: 'GET',
                        dispatcher: agent,
                        signal: controller.signal,
                        cache: 'no-store',
                    });
                    writeJson(res, {
                        ok: true,
                        reachable: true,
                        status: response.status,
                        elapsedMs: Date.now() - started,
                        target: PROBE_URL,
                        url: cfg.url,
                    });
                }
                catch (error) {
                    const cause = error?.cause?.message ? '（' + String(error.cause.message) + '）' : '';
                    writeJson(res, {
                        ok: true,
                        reachable: false,
                        elapsedMs: Date.now() - started,
                        target: PROBE_URL,
                        url: cfg.url,
                        message: String(error?.message ?? error) + cause,
                    });
                }
                finally {
                    clearTimeout(timer);
                    try {
                        await agent.close();
                    }
                    catch { /* ignore */ }
                }
            }
            catch (error) {
                writeJson(res, { ok: false, error: String(error?.message ?? error) });
            }
        },
    }), 'webui: dsh-proxy test');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-proxy/providers',
        handler: async (_req, res) => {
            try {
                writeJson(res, { ok: true, providers: readProviders() });
            }
            catch (error) {
                writeJson(res, { ok: false, error: String(error?.message ?? error) });
            }
        },
    }), 'webui: dsh-proxy providers');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/dsh-proxy/set',
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
                const url = typeof body.url === 'string' ? body.url.trim() : current.url;
                const mode = body.mode === 'selected' ? 'selected' : body.mode === 'all' ? 'all' : current.mode;
                const providers = Array.isArray(body.providers)
                    ? body.providers.filter((p) => typeof p === 'string')
                    : current.providers;
                const extraHosts = Array.isArray(body.extraHosts)
                    ? normalizeHosts(body.extraHosts)
                    : current.extraHosts;
                if (enabled && !/^https?:\/\/.+/.test(url)) {
                    writeJson(res, { ok: false, message: '代理地址需为 http:// 或 https:// 开头' });
                    return;
                }
                const next = { enabled, url, mode, providers, extraHosts };
                if (enabled) {
                    const r = applyProxy(next);
                    if (!r.ok) {
                        writeJson(res, { ok: false, message: r.message });
                        return;
                    }
                    console.log(`[dsh-proxy] proxy ENABLED url=${url} mode=${mode} providers=[${providers.join(',')}] hosts=[${[...selectedHosts(next)].join(',')}]`);
                }
                else {
                    clearProxy();
                    console.log('[dsh-proxy] proxy DISABLED');
                }
                if (scope !== undefined) {
                    try {
                        await scope.update(next);
                    }
                    catch (err) {
                        console.log('[dsh-proxy] persist failed:', err?.message ?? err);
                    }
                }
                writeJson(res, {
                    ok: true,
                    ...next,
                    hosts: [...selectedHosts(next)],
                    stale: staleProviders(next),
                    active: isActive(),
                });
            }
            catch (error) {
                writeJson(res, { ok: false, error: String(error?.message ?? error) });
            }
        },
    }), 'webui: dsh-proxy set');
}
//# sourceMappingURL=proxy.js.map