/**
 * DeepSeek 峰谷账单 —— host 端 API 封装（余额 + 月度明细）。
 * fetchJson 与 usage/dashboard/api.ts 保持一致：no-store + accept json。
 */

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { accept: 'application/json', ...init?.headers },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** 余额拆分（granted 赠送 / toppedUp 充值）。 */
export interface AccountBreakdown {
  granted?: number
  toppedUp?: number
}

/** 余额快照（remaining 可能缺失；breakdown 可能缺失）。 */
export interface AccountBalance {
  remaining?: number
  currency?: string
  breakdown?: AccountBreakdown
}

/** 余额接口 account 对象（status 非 ok 时 balance 可能为 null）。 */
export interface AccountSnapshot {
  id: string
  displayName: string
  status: string
  fetchedAt: number | null
  mode: string | null
  balance: AccountBalance | null
}

/** 单模型月度明细。 */
export interface BillingModel {
  model: string
  cost: number
  requests: number
  inputCacheHitTokens: number
  inputCacheMissTokens: number
  outputTokens: number
}

/** 单月账单。 */
export interface BillingMonth {
  year: number
  month: number
  currency?: string
  totalCost: number
  models: BillingModel[]
}

/** 明细接口响应（configured 为 false 时 months 为空、message 有中文提示）。 */
export interface BillingResponse {
  ok: boolean
  configured: boolean
  message: string | null
  fetchedAt: number | null
  months: BillingMonth[]
}

/** 拉取 DeepSeek 官方账户余额；无可用账户/异常时返回 null。 */
export async function fetchDeepseekAccount(): Promise<AccountSnapshot | null> {
  try {
    const data = await fetchJson<{ ok: boolean; account: AccountSnapshot | null }>(
      '/api/usage-stats/account?provider=deepseek-official',
    )
    if (data.ok !== true || data.account == null) return null
    return data.account
  } catch {
    return null
  }
}

/** 拉取 DeepSeek 月度账单（默认近 3 个月）。 */
export async function fetchDeepseekBilling(months = 3): Promise<BillingResponse> {
  return fetchJson<BillingResponse>(`/api/usage-stats/deepseek-billing?months=${months}`)
}
