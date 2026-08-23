import type { UsagePayload } from './aggregate'

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', ...init, headers: { accept: 'application/json', ...init?.headers } })
  return res.json() as Promise<T>
}

export interface ProviderInfo {
  id: string
  displayName: string
  accountMode: 'balance' | 'subscription' | null
  adapter: string | null
  configured: boolean
  status: 'ok' | 'unauthorized' | 'not-configured' | 'pending' | 'critical' | 'warning'
  fetchedAt: number | null
  alert: { level: 'normal' | 'warning' | 'critical' | 'unknown'; metric: string; value: number | null } | null
}
export interface AccountSnapshot {
  id: string
  displayName: string
  mode: string | null
  adapter: string | null
  status: string
  fetchedAt: number
  plan?: string
  windows?: Array<{ kind: string; usedPercent: number; remainingPercent: number; resetsAt?: string }>
  alert?: { level: string; metric: string; value: number | null }
}

/** 信号端点：Agent 效率与归因 + 用量信号（尾随自然日窗口）。 */
export interface SignalPayload {
  ok: boolean
  windowDays: number
  generatedAt: number
  efficiency: {
    requests: number
    tokens: number
    tokensPerRequest: number | null
    cacheHitRate: number | null
    compactedTokens: number
    compactedShare: number | null
    topRoutes: Array<{ model: string; tokens: number; share: number | null }>
    topRouteShare: number | null
  }
  signal: {
    dailyAvg7: number
    projected30: number
    activeMedian: number | null
    activeDays: number
    yesterdayDate: string
    yesterdayTokens: number
    yesterdayMultiple: number | null
    anomalyThreshold: number
    anomalyDays: Array<{ date: string; tokens: number; multiple: number }>
  }
  budget: number | null
}

/** 某一天的会话用量行（异常日下钻用）。 */
export interface DaySessionRow {
  id: string
  title: string | null
  tokens: number
  requests: number
  firstAt: number | null
  lastAt: number | null
}

export const usageApi = {
  usage: () => fetchJson<UsagePayload>('/api/usage-stats/usage'),
  signal: (days = 30) => fetchJson<SignalPayload>(`/api/usage-stats/signal?days=${days}`),
  daySessions: (date: string) =>
    fetchJson<{ ok: boolean; date: string; sessions: DaySessionRow[] }>(`/api/usage-stats/day-sessions?date=${encodeURIComponent(date)}`),
  budget: () => fetchJson<{ ok: boolean; budget: number | null }>('/api/usage-stats/budget'),
  saveBudget: (budget: number) =>
    fetchJson<{ ok: boolean; budget: number }>('/api/usage-stats/budget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ budget }),
    }),
  providers: () => fetchJson<{ ok: boolean; providers: ProviderInfo[] }>('/api/usage-stats/providers'),
  account: (provider: string, refresh = false) =>
    fetchJson<{ ok: boolean; message?: string; account: AccountSnapshot }>(`/api/usage-stats/account?provider=${encodeURIComponent(provider)}${refresh ? '&refresh=1' : ''}`),
  subscriptions: () => fetchJson<{ ok: boolean; subscriptions: AccountSnapshot[] }>('/api/usage-stats/subscriptions'),
}
