export interface UsageDay {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokens: number
  cacheHitRate: number
  /** 当天模型调用次数（assistant/message 计数）。 */
  requests?: number
  /** 当天累计工作时长（step 耗时，毫秒）。 */
  workMs?: number
  models?: Array<{ model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; tokens: number; cacheHitRate: number }>
}

/** 小时级用量（用于短范围按小时趋势）。 */
export interface UsageHour {
  hour: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  tokens: number
  cacheHitRate: number
  requests?: number
  workMs?: number
}

export interface UsagePayload { ok: boolean; days: UsageDay[]; hours?: UsageHour[]; updatedAt?: number }

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

/** 模型排行行：label = provider/model，value = tokens，hitRate 为该模型在范围内
 * 重算的聚合缓存命中率（prompt 侧口径：cacheRead / (input + cacheRead + cacheWrite)），
 * 与日级/总级口径一致，避免简单平均被小样本天带偏；无 prompt 数据时为 null。 */
export interface ModelRankRow {
  label: string
  value: number
  hitRate: number | null
}

/** 范围内按模型聚合的消耗排行（含命中率），按 tokens 降序。 */
export function modelRank(days: UsageDay[]): ModelRankRow[] {
  const map = new Map<string, { tokens: number; input: number; cacheRead: number; cacheWrite: number }>()
  for (const d of days) {
    for (const m of d.models ?? []) {
      const row = map.get(m.model) ?? { tokens: 0, input: 0, cacheRead: 0, cacheWrite: 0 }
      row.tokens += m.tokens ?? 0
      row.input += m.inputTokens ?? 0
      row.cacheRead += m.cacheReadTokens ?? 0
      row.cacheWrite += m.cacheWriteTokens ?? 0
      map.set(m.model, row)
    }
  }
  return [...map.entries()]
    .map(([label, row]) => {
      const prompt = row.input + row.cacheRead + row.cacheWrite
      return {
        label,
        value: row.tokens,
        hitRate: prompt > 0 ? (row.cacheRead / prompt) * 100 : null,
      }
    })
    .sort((a, b) => b.value - a.value)
}

/** 提供商与模型名拆分：`provider/model` → { provider, model }；无斜杠时整体归 provider。 */
export function splitModelKey(model: string): { provider: string; model: string } {
  const slash = model.indexOf('/')
  if (slash <= 0) return { provider: model, model }
  return { provider: model.slice(0, slash), model: model.slice(slash + 1) }
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

/** 范围内累计调用次数与工作时长（毫秒）。 */
export function sumActivity(days: UsageDay[]): { requests: number; workMs: number } {
  let requests = 0
  let workMs = 0
  for (const d of days) {
    requests += d.requests ?? 0
    workMs += d.workMs ?? 0
  }
  return { requests, workMs }
}
