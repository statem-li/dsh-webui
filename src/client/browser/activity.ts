/**
 * dsh-browser — client 侧浏览器活动 store（全局单例）。
 *
 * 轮询 host 的 `/api/dsh-browser/active-sessions`，维护「当前哪些会话正在做
 * 浏览器操作」的活跃集合，供会话内活动条与侧边栏会话列表标识共同订阅。
 *
 * 与 dsh-tool-summary 的 activityStore 同一思路：挂在 window 上的单例总线，
 * 创建者负责 startPolling 的启停（由 applyBrowserClient 的 fiber 托管）。
 */

export interface ActiveBrowserSession {
  readonly sessionId: string
  readonly active: boolean
  readonly url: string
  readonly title: string
  readonly tool: string
  readonly label: string
  readonly detail: string
  readonly startedAt: number | null
}

export interface BrowserActivityStore {
  /** 当前活跃的会话集合（sessionId → 摘要），不可变替换。 */
  readonly active: ReadonlyMap<string, ActiveBrowserSession>
  subscribe(fn: () => void): () => void
  startPolling(): void
  stopPolling(): void
}

const STORE_KEY = '__dshBrowserActivityStore__'
/** 有活跃会话时的轮询间隔。 */
const POLL_ACTIVE_MS = 800
/** 无活跃会话时的轮询间隔（降频省主线程与请求；有活动立即回到高频）。 */
const POLL_IDLE_MS = 3000

let pollTimer: number | null = null

let visibilityCleanup: (() => void) | null = null

function sameValue(a: ActiveBrowserSession | undefined, b: ActiveBrowserSession): boolean {
  if (a === undefined) return false
  return a.label === b.label
    && a.detail === b.detail
    && a.tool === b.tool
    && a.url === b.url
    && a.title === b.title
}

/** 创建或读取全局 store。 */
export function browserActivityStore(): BrowserActivityStore {
  const globalObj = globalThis as Record<string, unknown>
  const existing = globalObj[STORE_KEY] as BrowserActivityStore | undefined
  if (existing !== undefined) return existing

  let active = new Map<string, ActiveBrowserSession>()
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const fn of [...listeners]) {
      try { fn() } catch { /* 监听器错误忽略 */ }
    }
  }

  const store: BrowserActivityStore = {
    get active() { return active },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    startPolling: () => {
      if (pollTimer !== null) return
      let intervalMs = POLL_IDLE_MS
      const restart = (ms: number): void => {
        intervalMs = ms
        if (pollTimer !== null) window.clearInterval(pollTimer)
        pollTimer = window.setInterval(() => { void poll() }, ms)
      }
      const poll = async (): Promise<void> => {
        // 页面不可见时不轮询（后台标签页里没人看活动标识）。
        if (typeof document !== 'undefined' && document.hidden) return
        try {
          const res = await fetch('/api/dsh-browser/active-sessions', { cache: 'no-store' })
          const data: any = await res.json()
          const next = new Map<string, ActiveBrowserSession>()
          if (data && data.ok === true && Array.isArray(data.sessions)) {
            for (const s of data.sessions) {
              if (s && typeof s.sessionId === 'string') next.set(s.sessionId, s)
            }
          }
          const changed = next.size !== active.size
            || [...next.keys()].some(key => !active.has(key))
            || [...active.keys()].some(key => !next.has(key))
            || [...next.entries()].some(([key, value]) => !sameValue(active.get(key), value))
          active = next
          if (changed) notify()
          // 有活跃会话 → 高频跟进；全空闲 → 降频（多数时间是这个状态）。
          const want = next.size > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS
          if (want !== intervalMs) restart(want)
        } catch { /* 轮询失败保持上次状态 */ }
      }
      // 标签页重新可见时立刻补一次，避免显示滞后。
      const onVisible = (): void => { if (!document.hidden) void poll() }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
      visibilityCleanup = () => {
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
      }
      restart(POLL_IDLE_MS)
      void poll()
    },
    stopPolling: () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
      if (visibilityCleanup !== null) {
        visibilityCleanup()
        visibilityCleanup = null
      }
    },
  }

  globalObj[STORE_KEY] = store
  return store
}
