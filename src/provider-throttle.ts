/**
 * webui — 供应商限流（provider-throttle）。
 *
 * 部分 LLM 供应商对「请求并发数」与「短窗口请求频率（RPM）」双双限流，且
 * 429 响应体为空、无 retry-after 头（如 B.AI：6 路并发即 429，3s 间隔单发
 * 100% 成功）。DSH 端到端 retry 只能靠指数退避硬扛，退避窗口不够长时就
 * 会「重试耗尽 → 透出 429」。
 *
 * 本模块在 fetch 层按域名规则对命中请求施加两道闸：
 *   1. RPM 令牌桶（泄漏桶语义）：长期平均速率 = maxRpm 个/分钟，
 *      且不鼓励突发（burst 容量 = 每秒令牌数），把请求节奏抹平到
 *      供应商可承受的窗口内；
 *   2. 并发信号量：同时进行的请求数 ≤ maxConcurrency，其余排队
 *      （B.AI 实测并发 >2 就触发限流，建议 2）。
 *
 * 排队期间等待被 AbortSignal（SDK 超时/用户取消）打断时原样 reject；
 * 等待超过 maxWaitMs（默认 60s，写死）仍未获得放行则直接返回 429
 * 响应——抛回给 DSH 的重试层，由其指数退避接管（重试后大概率已过
 * 限流窗口）。返回的 429 body 含 "429" 与 "rate limit" 字样，保证
 * pi-ai 错误分类落入 RATE_LIMIT → 可重试。
 *
 * 机制：包装 globalThis.fetch（幂等），与 gateway-rewrite 同一模式——
 * llm-pi-ai 底层 OpenAI SDK 每次构建 client 时经 Shims.getDefaultFetch()
 * 动态读取全局 fetch，因此包装对其后发起的全部请求生效；未命中规则的
 * 请求原样透传。默认关闭（enabled=false），关闭时零开销直接透传。
 * settings 命名空间 `provider-throttle` 持久化；HTTP API：
 *   GET  /api/webui-provider-throttle/state    （含每 host 实时计数）
 *   POST /api/webui-provider-throttle/set      （保存即运行时生效，无需重启）
 */
import z from '@deepseek-ai/schemastery'

export const inject = ['settings', 'webServer']

/** 单条限流规则：命中 host 的请求先过 RPM 令牌桶，再过并发信号量。 */
export interface ThrottleRule {
  /** 目标域名，精确或 `*.example.com` 通配（含子域）。 */
  host: string
  /** 每分钟最多请求数（1..6000，默认 20）。 */
  maxRpm: number
  /** 同时进行的请求数上限（1..16，默认 2）。 */
  maxConcurrency: number
}

interface ThrottleConfig {
  enabled: boolean
  rules: ThrottleRule[]
}

interface RuleStats {
  /** 正在执行中的请求数。 */
  active: number
  /** 正在排队（等令牌/等并发槽）的请求数。 */
  waiting: number
  /** 已放行的请求数。 */
  passed: number
  /** 因此限流返回 429 的请求数。 */
  throttled: number
}

type PluginContext = any

const HOOK_INSTALLED = Symbol.for('webui.providerThrottle.installed')

/** 排队等待放行的总上限：超过直接 429，交回 DSH 重试层退避。 */
const MAX_WAIT_MS = 60_000

const DEFAULT_RPM = 20
const DEFAULT_CONCURRENCY = 2

/** 当前生效的配置；fetch 包装每次调用时读它。 */
let throttleState: ThrottleConfig | null = null

// ── 令牌桶（每 host 独立）─────────────────────────────────────────────────

interface TokenBucket {
  /** 当前令牌数（可含小数）。 */
  tokens: number
  /** 上次补充时间戳（ms）。 */
  last: number
  /** 恢复速率：每毫秒令牌数。 */
  ratePerMs: number
  /** 容量（burst 上限）。 */
  capacity: number
}

function makeBucket(maxRpm: number): TokenBucket {
  const ratePerMs = maxRpm / 60_000
  // burst 容量 = 每秒令牌数（至少 1）：RPM=20 → 每 3s 一个令牌，
  // 大 RPM（如 600）时容量升到 10/s 以跟上速率。
  const capacity = Math.max(1, Math.ceil(ratePerMs * 1000))
  return { tokens: capacity, last: Date.now(), ratePerMs, capacity }
}

/**
 * 尝试取 1 个令牌：够则扣减并返回 0；不够返回还需等待的毫秒数（不扣）。
 * 按经过时间补发令牌（懒惰补充），上限 capacity。
 */
function takeToken(bucket: TokenBucket, now: number): number {
  const elapsed = Math.max(0, now - bucket.last)
  bucket.last = now
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.ratePerMs)
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return 0
  }
  return (1 - bucket.tokens) / bucket.ratePerMs
}

// ── 信号量（每 host 独立，FIFO 公平）──────────────────────────────────────

interface Waiter {
  resolve: (ok: boolean) => void
  reject: (err: unknown) => void
  timer: ReturnType<typeof setTimeout> | null
}

class Semaphore {
  private free: number
  private queue: Array<Waiter | null> = []

  constructor(limit: number) {
    this.free = limit
  }

  /**
   * 尝试立即获取；拿不到则排队（FIFO）。
   * 超时 resolve(false)；AbortSignal 中止时 reject（取消语义透传）。
   */
  acquire(timeoutMs: number, signal: AbortSignal | null | undefined): Promise<boolean> {
    if (this.free > 0) {
      this.free -= 1
      return Promise.resolve(true)
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, timer: null }
      this.queue.push(waiter)
      const cleanup = (): void => {
        if (waiter.timer !== null) clearTimeout(waiter.timer)
        if (signal !== null && signal !== undefined) signal.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        const idx = this.queue.indexOf(waiter)
        if (idx >= 0) this.queue[idx] = null // 占位保留，release 时顺手清掉
        cleanup()
        reject(abortError())
      }
      waiter.timer = setTimeout(() => {
        const idx = this.queue.indexOf(waiter)
        if (idx >= 0) this.queue[idx] = null
        cleanup()
        resolve(false)
      }, timeoutMs)
      if (signal !== null && signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** 释放一个槽位：唤醒队首等待者，无人在等则归还槽位。 */
  release(): void {
    let next: Waiter | null | undefined
    while (this.queue.length > 0 && (next = this.queue.shift()) === null) { /* 跳过被移除的占位 */ }
    if (next !== null && next !== undefined) {
      if (next.timer !== null) clearTimeout(next.timer)
      next.resolve(true)
    } else {
      this.free += 1
    }
  }
}

// ── 每 host 运行态（限流器 + 计数）───────────────────────────────────────

interface HostEntry {
  rule: ThrottleRule
  bucket: TokenBucket
  sem: Semaphore
  stats: RuleStats
}

const entries = new Map<string, HostEntry>()

function entryFor(rule: ThrottleRule, key: string): HostEntry {
  let entry = entries.get(key)
  if (entry === undefined || entry.rule.maxRpm !== rule.maxRpm || entry.rule.maxConcurrency !== rule.maxConcurrency) {
    entry = {
      rule,
      bucket: makeBucket(rule.maxRpm),
      sem: new Semaphore(rule.maxConcurrency),
      stats: { active: 0, waiting: 0, passed: 0, throttled: 0 },
    }
    entries.set(key, entry)
  }
  return entry
}

// ── 工具：可中断的 sleep / 取消错误 / 统一 429 响应 ───────────────────────

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
}

function sleep(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function rateLimitedResponse(): Response {
  // body 带 "429" 与 "rate limit" 关键字，确保 pi-ai 错误分类 → RATE_LIMIT。
  return new Response(
    JSON.stringify({ error: { message: 'rate limit exceeded: provider throttle (429)', type: 'rate_limit_error', code: 'provider_throttled' } }),
    {
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'content-type': 'application/json', 'retry-after': '10' },
    },
  )
}

// ── 规则解析 / 匹配 ───────────────────────────────────────────────────────

function normalizeHost(input: unknown): string {
  if (typeof input !== 'string') return ''
  let value = input.trim().toLowerCase()
  if (value === '') return ''
  if (value.includes('://')) {
    try { value = new URL(value).hostname } catch { /* 非法 URL，按字面处理 */ }
  }
  value = value.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '')
  return value
}

function clampInt(input: unknown, min: number, max: number, fallback: number): number {
  const n = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** 规范化规则数组：丢空 host 的项，去重，数字字段钳位到合法区间。 */
function normalizeRules(input: readonly unknown[]): ThrottleRule[] {
  const out: ThrottleRule[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const host = normalizeHost(record.host)
    if (host === '') continue
    if (seen.has(host)) continue
    seen.add(host)
    out.push({
      host,
      maxRpm: clampInt(record.maxRpm, 1, 6000, DEFAULT_RPM),
      maxConcurrency: clampInt(record.maxConcurrency, 1, 16, DEFAULT_CONCURRENCY),
    })
  }
  return out
}

/** 命中判定：精确 host 或 `*.domain` 模式（含子域）。 */
function matchRule(host: string, rules: readonly ThrottleRule[]): ThrottleRule | null {
  for (const rule of rules) {
    if (rule.host === host) return rule
    if (rule.host.startsWith('*.') && host.endsWith(rule.host.slice(1))) return rule
  }
  return null
}

// ── fetch 包装（幂等）─────────────────────────────────────────────────────

/**
 * 一次限流通行：先令牌桶（买票），后信号量（排队），最后执行任务。
 * 任一步超时/中止都返回 429 或 reject，让 DSH 重试层接管。
 */
async function runThrottled(entry: HostEntry, task: () => Promise<Response>, signal: AbortSignal | null | undefined): Promise<Response> {
  const stats = entry.stats
  stats.waiting += 1
  let moved = false // 是否已从 waiting 转入 active（成功获得并发槽）
  try {
    const deadline = Date.now() + MAX_WAIT_MS
    // 1) 令牌桶：拿到令牌（或等待后拿到）。取消透传，超时返回 429。
    for (;;) {
      if (signal?.aborted === true) throw abortError()
      const need = takeToken(entry.bucket, Date.now())
      if (need <= 0) break
      const remain = deadline - Date.now()
      if (remain <= 0) {
        stats.throttled += 1
        return rateLimitedResponse()
      }
      await sleep(Math.min(need, remain), signal)
    }
    // 2) 并发信号量：拿不到就排队（FIFO）。取消透传，超时返回 429。
    let got: boolean
    try {
      got = await entry.sem.acquire(deadline - Date.now(), signal)
    } catch (err) {
      // 取消：令牌退回去（保持桶语义连贯），取消透传给 SDK。
      entry.bucket.tokens = Math.min(entry.bucket.capacity, entry.bucket.tokens + 1)
      throw err
    }
    if (!got) {
      entry.bucket.tokens = Math.min(entry.bucket.capacity, entry.bucket.tokens + 1)
      stats.throttled += 1
      return rateLimitedResponse()
    }
    // 3) 执行。
    stats.waiting -= 1
    moved = true
    stats.active += 1
    try {
      const res = await task()
      stats.passed += 1
      return res
    } catch (err) {
      // 请求本身失败（网络/5xx）也计入放行——它确实发出了。
      stats.passed += 1
      throw err
    } finally {
      stats.active -= 1
      entry.sem.release()
    }
  } finally {
    if (!moved) stats.waiting -= 1
  }
}

function installHook(): void {
  const g = globalThis as any
  if (g[HOOK_INSTALLED] === true) return
  g[HOOK_INSTALLED] = true
  const original = globalThis.fetch.bind(globalThis)
  globalThis.fetch = function (input: any, init?: any) {
    const state = throttleState
    if (state === null || !state.enabled || state.rules.length === 0) return original(input, init)
    let host: string
    let href: string | null = null
    try {
      const raw = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input && typeof input === 'object' && 'url' in input
            ? String(input.url)
            : ''
      const parsed = new URL(raw)
      host = parsed.hostname.toLowerCase()
      href = parsed.href
    } catch {
      return original(input, init)
    }
    const rule = matchRule(host, state.rules)
    if (rule === null) return original(input, init)
    const entry = entryFor(rule, rule.host)
    const signal = init !== null && init !== undefined && typeof init === 'object' ? (init as any).signal : undefined
    const next = init === undefined || init === null ? {} : { ...init }
    // 命中规则的请求一律过闸（包括 /models 等低频端点——它们本来也少，
    // 对桶顶多略作消耗，无碍）；任务内部保持原始 URL 形态发起真实请求，
    // 与 gateway-rewrite 的透传方式一致。
    return runThrottled(entry, () => original(href ?? input, next), signal)
  }
}

// ── 应用入口 ──────────────────────────────────────────────────────────────

export function applyProviderThrottle(ctx: PluginContext): void {
  let scope: any
  try {
    scope = ctx.settings.register('provider-throttle', z.object({
      enabled: z.boolean().default(false),
      rules: z.array(z.any()).default([]),
    }))
  } catch (error: any) {
    console.log('[webui-provider-throttle] settings namespace already registered:', error?.message ?? error)
  }

  const readConfig = (): ThrottleConfig => {
    if (scope !== undefined) {
      try {
        const v = scope.get()
        return {
          enabled: v.enabled === true,
          rules: normalizeRules(Array.isArray(v.rules) ? v.rules : []),
        }
      } catch { /* fallthrough */ }
    }
    return { enabled: false, rules: [] }
  }

  const applyConfig = (cfg: ThrottleConfig): void => {
    throttleState = cfg.enabled && cfg.rules.length > 0 ? cfg : null
    installHook()
  }

  try {
    const cfg = readConfig()
    applyConfig(cfg)
    console.log(`[webui-provider-throttle] boot: ${cfg.enabled ? `enabled (${cfg.rules.length} rules: ${cfg.rules.map(r => r.host).join(', ')})` : 'disabled'}`)
  } catch (err: any) {
    console.log('[webui-provider-throttle] boot apply failed:', err?.message ?? err)
  }

  const statsView = (): Record<string, RuleStats> => {
    const out: Record<string, RuleStats> = {}
    const cfg = readConfig()
    const hosts = new Set(cfg.rules.map(r => r.host))
    for (const [host, entry] of entries) {
      if (hosts.has(host)) out[host] = { ...entry.stats }
    }
    return out
  }

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
    path: '/api/webui-provider-throttle/state',
    handler: async (_req: any, res: any) => {
      try {
        const cfg = readConfig()
        writeJson(res, { ok: true, ...cfg, active: throttleState !== null, stats: statsView() })
      } catch (error: any) {
        writeJson(res, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'webui: provider-throttle state')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/webui-provider-throttle/set',
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
        const rules = Array.isArray(body.rules) ? normalizeRules(body.rules) : current.rules
        const next: ThrottleConfig = { enabled, rules }
        applyConfig(next)
        console.log(`[webui-provider-throttle] ${enabled ? `ENABLED (${rules.length} rules)` : 'DISABLED'}: ${rules.map(r => `${r.host} @ ${r.maxRpm}rpm / ${r.maxConcurrency}conc`).join(', ')}`)
        if (scope !== undefined) {
          try { await scope.update({ enabled, rules }) } catch (err: any) {
            console.log('[webui-provider-throttle] persist failed:', err?.message ?? err)
          }
        }
        writeJson(res, { ok: true, ...next, active: enabled, stats: statsView() })
      } catch (error: any) {
        writeJson(res, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'webui: provider-throttle set')
}
