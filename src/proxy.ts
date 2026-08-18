/**
 * webui — DSH 网络代理（自 dsh-proxy 合并）。
 *
 * 基于 undici ProxyAgent 做进程内代理（运行时生效，无需重启）：
 * - all 模式：全部请求走代理（兼做兜底）
 * - selected 模式：仅选中的厂商/域名走代理，其余直连
 * settings 命名空间 `network-proxy` 持久化；HTTP API：
 *   GET  /api/dsh-proxy/state | providers
 *   POST /api/dsh-proxy/set   （立即应用或解除）
 * 机制：包装 globalThis.fetch 按目标 host 注入 dispatcher；selected 清掉全局
 * dispatcher，all 才挂 Symbol.for('undici.globalDispatcher.1') 兜底。
 */
import z from '@deepseek-ai/schemastery'
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

export const inject = ['settings', 'webServer']

const DISPATCHER_SYMBOL = Symbol.for('undici.globalDispatcher.1')
const ORIGINAL_FETCH = Symbol.for('dsh-proxy.originalFetch')
const DEFAULT_PROXY = 'http://127.0.0.1:10808'

interface ProxyState {
  agent: any
  mode: 'all' | 'selected'
  hosts: Set<string>
}

// 当前代理状态；globalThis.fetch 包装函数在每次调用时读它来决定是否走代理。
let proxyState: ProxyState | null = null

// 从宿主可解析的位置加载 undici（优先级：profile node_modules -> DSH checkout -> DSH pnpm store）。
function loadUndici(): any {
  const candidates: string[] = []
  try { candidates.push(new URL('../../node_modules/undici/package.json', import.meta.url).href) } catch { /* ignore */ }
  candidates.push('D:/AI/deepseek-harness/node_modules/undici/package.json')
  const storeBase = 'D:/AI/deepseek-harness/node_modules/.pnpm'
  try {
    const { readdirSync } = nodeRequire('node:fs')
    const { join } = nodeRequire('node:path')
    const dirs = readdirSync(storeBase).filter((d: string) => d.startsWith('undici@') && !d.includes('undici-types'))
    dirs.sort((a: string, b: string) => {
      const va = a.match(/undici@(.+)/)?.[1] ?? ''
      const vb = b.match(/undici@(.+)/)?.[1] ?? ''
      return vb.localeCompare(va, undefined, { numeric: true })
    })
    for (const d of dirs) candidates.push(join(storeBase, d, 'node_modules', 'undici', 'package.json'))
  } catch { /* store 扫描失败则跳过 */ }
  for (const target of candidates) {
    try {
      const req = createRequire(target)
      const ud = req('undici')
      if (ud && typeof ud.ProxyAgent === 'function') return ud
    } catch (err: any) {
      console.log(`[dsh-proxy] undici load from ${String(target)} failed: ${err?.message ?? err}`)
    }
  }
  return null
}

// 包装前的原始 fetch（只包一次，之后 globalThis.fetch 恒为代理选择层）。
function installFetchHook(): void {
  const g = globalThis as any
  if (g[ORIGINAL_FETCH] && typeof g[ORIGINAL_FETCH] === 'function') return
  const original = globalThis.fetch.bind(globalThis)
  Object.defineProperty(globalThis, ORIGINAL_FETCH, { value: original, configurable: true })
  globalThis.fetch = function (input: any, init?: any) {
    const state = proxyState
    if (state === null || !state.agent) return original(input, init)
    let viaProxy = state.mode === 'all'
    if (!viaProxy && state.hosts && state.hosts.size > 0) {
      const host = hostnameOf(input)
      viaProxy = host !== null && matchHost(host, state.hosts)
    }
    if (!viaProxy) return original(input, init)
    const next = init === undefined || init === null ? {} : { ...init }
    next.dispatcher = state.agent
    return original(input, next)
  }
}

/** 从 fetch 入参提取 hostname（小写）；解析失败返回 null（不代理）。 */
function hostnameOf(input: any): string | null {
  try {
    const raw = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input && typeof input === 'object' && 'url' in input
          ? String(input.url)
          : ''
    return new URL(raw).hostname.toLowerCase()
  } catch { return null }
}

/** 命中判定：精确 host 或 `*.domain` 模式（含子域）。 */
function matchHost(host: string, hosts: Set<string>): boolean {
  if (hosts.has(host)) return true
  for (const pattern of hosts) {
    if (typeof pattern !== 'string') continue
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1) // '.example.com'
      if (host.endsWith(suffix)) return true
    }
  }
  return false
}

export function applyProxy(ctx: any): void {
  // ---- settings 命名空间（settings.yaml 持久化）----
  let scope: any
  try {
    scope = ctx.settings.register('network-proxy', z.object({
      enabled: z.boolean().default(false),
      url: z.string().default(DEFAULT_PROXY),
      mode: z.union([z.const('all'), z.const('selected')]).default('all'),
      providers: z.array(z.string()).default([]),
    }))
  } catch (error: any) {
    console.log('[dsh-proxy] settings namespace already registered:', error?.message ?? error)
  }

  const readConfig = (): { enabled: boolean; url: string; mode: 'all' | 'selected'; providers: string[] } => {
    if (scope !== undefined) {
      try {
        const v = scope.get()
        return {
          enabled: v.enabled !== false,
          url: (v.url && v.url.trim()) || DEFAULT_PROXY,
          mode: v.mode === 'selected' ? 'selected' : 'all',
          providers: Array.isArray(v.providers) ? v.providers.filter((p: unknown) => typeof p === 'string') : [],
        }
      } catch { /* fallthrough */ }
    }
    return { enabled: false, url: DEFAULT_PROXY, mode: 'all', providers: [] }
  }

  // ---- 读 llm-pi-ai 的厂商配置，导出 route key -> baseURL host ----
  const readProviders = (): Array<{ key: string; name: string; baseURL: string; host: string | null; api: string }> => {
    const out: Array<{ key: string; name: string; baseURL: string; host: string | null; api: string }> = []
    try {
      const ns = ctx.settings.get('llm-pi-ai')
      const providers = ns && typeof ns === 'object' && ns.providers && typeof ns.providers === 'object'
        ? ns.providers
        : {}
      for (const [key, p] of Object.entries(providers)) {
        if (!p || typeof p !== 'object') continue
        const record = p as Record<string, unknown>
        const baseURL = typeof record.baseURL === 'string' ? record.baseURL : ''
        let host: string | null = null
        try { host = new URL(baseURL).hostname } catch { /* 非完整 URL，无 host */ }
        out.push({
          key,
          name: (typeof record.displayName === 'string' && (record.displayName as string).trim()) || key,
          baseURL,
          host,
          api: typeof record.api === 'string' ? record.api : '',
        })
      }
    } catch (error: any) {
      console.log('[dsh-proxy] readProviders failed:', error?.message ?? error)
    }
    return out
  }

  /** 选中的厂商 route key -> 去重后的 hostname 集合。 */
  const selectedHosts = (cfg: { providers?: string[] }): Set<string> => {
    const hosts = new Set<string>()
    if (Array.isArray(cfg.providers)) {
      const byKey = new Map(readProviders().map((p) => [p.key, p]))
      for (const key of cfg.providers) {
        const p = byKey.get(key)
        if (p && p.host) hosts.add(p.host)
      }
    }
    return hosts
  }

  // ---- 状态：当前代理是否已生效 ----
  const isActive = (): boolean => {
    try {
      return proxyState !== null && !!(proxyState.agent && proxyState.agent.constructor
        && proxyState.agent.constructor.name === 'ProxyAgent')
    } catch { return false }
  }

  // ---- 应用代理 / 解除代理 ----
  function applyProxy(cfg: { enabled: boolean; url: string; mode: 'all' | 'selected'; providers: string[] }): { ok: boolean; message?: string } {
    const undici = loadUndici()
    if (!undici) return { ok: false, message: '无法加载 undici' }
    const agent = new undici.ProxyAgent(cfg.url)
    proxyState = { agent, mode: cfg.mode, hosts: selectedHosts(cfg) }
    const g = globalThis as any
    if (cfg.mode === 'all') {
      g[DISPATCHER_SYMBOL] = agent
    } else {
      try { delete g[DISPATCHER_SYMBOL] } catch { /* ignore */ }
    }
    return { ok: true }
  }

  function clearProxy(): void {
    const g = globalThis as any
    try { delete g[DISPATCHER_SYMBOL] } catch { /* ignore */ }
    proxyState = null
  }

  // 安装 fetch 代理层（幂等），此后每次请求按 state 决定注入 dispatcher。
  installFetchHook()

  // 启动时按已存配置应用（若启用）。
  try {
    const cfg = readConfig()
    if (cfg.enabled) {
      const r = applyProxy(cfg)
      console.log(`[dsh-proxy] boot: proxy ${r.ok ? 'enabled' : 'FAILED'} url=${cfg.url} mode=${cfg.mode} hosts=${[...selectedHosts(cfg)].join(',')}`)
    } else {
      console.log('[dsh-proxy] boot: proxy disabled')
    }
  } catch (err: any) {
    console.log('[dsh-proxy] boot apply failed:', err?.message ?? err)
  }

  // ---- HTTP API ----
  function readBody(req: any): Promise<any> {
    return new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk: any) => { data += chunk })
      req.on('end', () => {
        try { resolve(JSON.parse(data || '{}')) } catch { resolve(null) }
      })
      req.on('error', () => resolve(null))
    })
  }

  function writeJson(res: any, obj: unknown): void {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(obj))
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-proxy/state',
    handler: async (_req: any, res: any) => {
      try {
        const cfg = readConfig()
        writeJson(res, { ok: true, ...cfg, hosts: [...selectedHosts(cfg)], active: isActive() })
      } catch (error: any) {
        writeJson(res, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'webui: dsh-proxy state')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-proxy/providers',
    handler: async (_req: any, res: any) => {
      try {
        writeJson(res, { ok: true, providers: readProviders() })
      } catch (error: any) {
        writeJson(res, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'webui: dsh-proxy providers')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-proxy/set',
    handler: async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
          return
        }
        const body = await readBody(req)
        if (!body || typeof body !== 'object') {
          writeJson(res, { ok: false, message: '参数错误' })
          return
        }
        const current = readConfig()
        const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled
        const url = typeof body.url === 'string' ? body.url.trim() : current.url
        const mode = body.mode === 'selected' ? 'selected' : body.mode === 'all' ? 'all' : current.mode
        const providers = Array.isArray(body.providers)
          ? body.providers.filter((p: unknown) => typeof p === 'string')
          : current.providers
        if (enabled && !/^https?:\/\/.+/.test(url)) {
          writeJson(res, { ok: false, message: '代理地址需为 http:// 或 https:// 开头' })
          return
        }
        if (enabled) {
          const r = applyProxy({ enabled, url, mode, providers })
          if (!r.ok) {
            writeJson(res, { ok: false, message: r.message })
            return
          }
          console.log(`[dsh-proxy] proxy ENABLED url=${url} mode=${mode} providers=[${providers.join(',')}] hosts=[${[...selectedHosts({ providers })].join(',')}]`)
        } else {
          clearProxy()
          console.log('[dsh-proxy] proxy DISABLED')
        }
        if (scope !== undefined) {
          try { await scope.update({ enabled, url, mode, providers }) } catch (err: any) {
            console.log('[dsh-proxy] persist failed:', err?.message ?? err)
          }
        }
        writeJson(res, { ok: true, enabled, url, mode, providers, hosts: [...selectedHosts({ providers })], active: isActive() })
      } catch (error: any) {
        writeJson(res, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'webui: dsh-proxy set')
}
