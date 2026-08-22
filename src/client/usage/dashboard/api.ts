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

export const usageApi = {
  usage: () => fetchJson<UsagePayload>('/api/usage-stats/usage'),
  providers: () => fetchJson<{ ok: boolean; providers: ProviderInfo[] }>('/api/usage-stats/providers'),
  account: (provider: string, refresh = false) =>
    fetchJson<{ ok: boolean; message?: string; account: AccountSnapshot }>(`/api/usage-stats/account?provider=${encodeURIComponent(provider)}${refresh ? '&refresh=1' : ''}`),
  subscriptions: () => fetchJson<{ ok: boolean; subscriptions: AccountSnapshot[] }>('/api/usage-stats/subscriptions'),
}
