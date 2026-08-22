/**
 * 用量查询范围：预设（今日/昨日/近7天/近30天/本月/上月/今年/全部/自定义区间）
 * + 区间过滤 + 粒度自适应聚合（≤31 天按日、≤120 天按周、更长按月）+ 环比。
 *
 * 日期一律 YYYY-MM-DD 字符串（与 UsageDay.date 同构），字典序即时间序。
 */

import type { UsageDay, UsageHour } from './aggregate'
import type { SeriesPoint } from './charts/AreaChart'

/** 范围预设。 */
export type RangePreset =
  | 'today' | 'yesterday' | '7d' | '30d'
  | 'month' | 'lastMonth' | 'year' | 'all' | 'custom'

/** 闭区间日期范围。 */
export interface DateRange {
  start: string
  end: string
}

/** 本地日期 → YYYY-MM-DD。 */
export function toDayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** YYYY-MM-DD → 本地 Date 当日零点。 */
export function fromDayStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** 加减天数。 */
function addDays(d: Date, n: number): Date {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

/** 范围天数（含端点）。 */
export function rangeDays(r: DateRange): number {
  return Math.round((fromDayStr(r.end).getTime() - fromDayStr(r.start).getTime()) / 86_400_000) + 1
}

/** 解析预设为具体区间与展示名。 */
export function resolveRange(preset: RangePreset, custom: DateRange | null, now = new Date()): { range: DateRange; label: string } {
  const today = toDayStr(now)
  switch (preset) {
    case 'today':
      return { range: { start: today, end: today }, label: '今日' }
    case 'yesterday': {
      const y = toDayStr(addDays(now, -1))
      return { range: { start: y, end: y }, label: '昨日' }
    }
    case '7d':
      return { range: { start: toDayStr(addDays(now, -6)), end: today }, label: '近 7 天' }
    case '30d':
      return { range: { start: toDayStr(addDays(now, -29)), end: today }, label: '近 30 天' }
    case 'month': {
      const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      return { range: { start, end: today }, label: '本月' }
    }
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { range: { start: toDayStr(first), end: toDayStr(last) }, label: '上月' }
    }
    case 'year':
      return { range: { start: `${now.getFullYear()}-01-01`, end: today }, label: '今年' }
    case 'all':
      return { range: { start: '2000-01-01', end: today }, label: '全部' }
    case 'custom':
      return { range: custom ?? { start: today, end: today }, label: custom !== null ? `${custom.start} ~ ${custom.end}` : '自定义' }
  }
}

/** 等长上一周期（用于环比）：按天数向前平移。 */
export function prevRange(r: DateRange): DateRange {
  const n = rangeDays(r)
  return {
    start: toDayStr(addDays(fromDayStr(r.start), -n)),
    end: toDayStr(addDays(fromDayStr(r.end), -n)),
  }
}

/** 按区间过滤（字符串字典序比较，含端点）。 */
export function filterDays(days: UsageDay[], r: DateRange): UsageDay[] {
  return days.filter(d => d.date >= r.start && d.date <= r.end)
}

/** 展示粒度：≤2 天按小时、≤31 天按日、≤120 天按周、更长按月。 */
export type Grain = 'hour' | 'day' | 'week' | 'month'
export function pickGrain(r: DateRange): Grain {
  const n = rangeDays(r)
  if (n <= 2) return 'hour'
  if (n <= 31) return 'day'
  if (n <= 120) return 'week'
  return 'month'
}

/** ISO 周一为一周起点（YYYY-MM-DD → 所在周周一）。 */
function weekStart(s: string): string {
  const d = fromDayStr(s)
  const dow = (d.getDay() + 6) % 7
  return toDayStr(addDays(d, -dow))
}

/** 按粒度聚合为趋势序列（label：日=YYYY-MM-DD、周=周一日期、月=YYYY-MM）。 */
export function aggregateSeries(days: UsageDay[], grain: Grain): SeriesPoint[] {
  const buckets = new Map<string, UsageDay[]>()
  for (const d of days) {
    const key = grain === 'day' ? d.date : grain === 'week' ? weekStart(d.date) : d.date.slice(0, 7)
    const arr = buckets.get(key)
    if (arr) arr.push(d)
    else buckets.set(key, [d])
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, group]) => {
      let input = 0, output = 0, cache = 0
      for (const d of group) {
        input += d.inputTokens ?? 0
        output += d.outputTokens ?? 0
        cache += (d.cacheReadTokens ?? 0) + (d.cacheWriteTokens ?? 0)
      }
      return { label, input, output, cache }
    })
}

/** 小时标签：YYYY-MM-DD-HH → 单日 "HH:00" / 跨日 "MM-DD HH:00"。 */
function hourLabel(hour: string, multiDay: boolean): string {
  const hh = hour.slice(11, 13)
  const mmdd = hour.slice(5, 10)
  return multiDay ? `${mmdd} ${hh}:00` : `${hh}:00`
}

/** 按小时聚合（短范围趋势）：过滤区间内的小时数据。 */
export function aggregateHourSeries(hours: UsageHour[], r: DateRange): SeriesPoint[] {
  const multiDay = r.start !== r.end
  const buckets = new Map<string, UsageHour[]>()
  for (const h of hours) {
    const day = h.hour.slice(0, 10)
    if (day < r.start || day > r.end) continue
    const arr = buckets.get(h.hour)
    if (arr) arr.push(h)
    else buckets.set(h.hour, [h])
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([hour, group]) => {
      let input = 0, output = 0, cache = 0
      for (const h of group) {
        input += h.inputTokens ?? 0
        output += h.outputTokens ?? 0
        cache += (h.cacheReadTokens ?? 0) + (h.cacheWriteTokens ?? 0)
      }
      return { label: hourLabel(hour, multiDay), input, output, cache }
    })
}

/** 环比百分比：上一周期为 0 时返回 null（无法计算）。 */
export function deltaPercent(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0
  return ((current - previous) / previous) * 100
}

/** 范围内日均 tokens。 */
export function dailyAverage(days: UsageDay[]): number {
  if (days.length === 0) return 0
  const total = days.reduce((acc, d) => acc + (d.tokens ?? 0), 0)
  return total / days.length
}
