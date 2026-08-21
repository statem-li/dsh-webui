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
const POLL_MS = 800

let pollTimer: number | null = null

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
      const poll = async (): Promise<void> => {
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
        } catch { /* 轮询失败保持上次状态 */ }
      }
      pollTimer = window.setInterval(() => { void poll() }, POLL_MS)
      void poll()
    },
    stopPolling: () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
    },
  }

  globalObj[STORE_KEY] = store
  return store
}
