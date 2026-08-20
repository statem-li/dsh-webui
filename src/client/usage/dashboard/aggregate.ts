export interface UsageDay {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokens: number
  cacheHitRate: number
  models?: Array<{ model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; tokens: number; cacheHitRate: number }>
}
export interface UsagePayload { ok: boolean; days: UsageDay[]; updatedAt?: number }

export function sumTokens(days: UsageDay[]): { input: number; output: number; cache: number; total: number } {
  let input = 0, output = 0, cache = 0
  for (const d of days) {
    input += d.inputTokens ?? 0
    output += d.outputTokens ?? 0
    cache += (d.cacheReadTokens ?? 0) + (d.cacheWriteTokens ?? 0)
  }
  return { input, output, cache, total: input + output + cache }
}

export function monthTokens(days: UsageDay[], year: number, month: number): UsageDay[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  return days.filter(d => d.date.startsWith(prefix))
}

export function providerShare(days: UsageDay[]): Array<{ provider: string; tokens: number }> {
  const map = new Map<string, number>()
  for (const d of days) {
    for (const m of d.models ?? []) {
      const provider = m.model.includes('/') ? m.model.split('/')[0] : m.model
      map.set(provider, (map.get(provider) ?? 0) + (m.tokens ?? 0))
    }
  }
  return [...map.entries()].map(([provider, tokens]) => ({ provider, tokens })).sort((a, b) => b.tokens - a.tokens)
}

export function averageCacheHitRate(days: UsageDay[]): number {
  if (days.length === 0) return 0
  const sum = days.reduce((acc, d) => acc + (d.cacheHitRate ?? 0), 0)
  // 保留小数精度（两位由 formatHitRate 统一格式化），不再取整。
  return sum / days.length
}
