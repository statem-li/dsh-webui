/**
 * UsageTab — 明细 tab（DSH 设置页设计语言）：
 *  - 「热力」rowCard ×2 并排：本月 / 本年（点击格子下钻当日模型明细）；
 *  - 「模型消耗排行」rowCard（查询范围内）；
 *  - 「每日明细」rowCard：DSH 表格风——caption 表头 + 行分隔细线 + mono 数值。
 * 查询范围由 Workbench 全局持有，本 tab 只消费区间。
 */
import { useEffect, useState } from 'react'
import { usageApi } from './api'
import { sumTokens, type UsageDay } from './aggregate'
import { filterDays, type DateRange } from './range'
import { formatHitRate, formatUnits } from './format'
import { RankBars } from './charts/RankBars'
import { Heatmap } from './charts/Heatmap'
import { ErrorCard } from './primitives/ErrorCard'
import { useIsMobile } from '../../responsive'

export interface UsageTabProps {
  range: DateRange
  rangeLabel: string
  refreshTick?: number
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** `.rowCard`：描边行卡片。 */
const rowCard: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
}

/** `.rowHead`：卡头。 */
function CardHead({ name, meta }: { name: string; meta?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>{name}</span>
      {meta !== undefined && <span style={{ marginLeft: 'auto', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>{meta}</span>}
    </div>
  )
}

/** DSH 表格单元格通用样式。 */
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  fontSize: 12,
  lineHeight: '18px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-secondary)',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
}
const tdMono: React.CSSProperties = { ...tdStyle, fontFamily: MONO }

export function UsageTab({ range, rangeLabel, refreshTick }: UsageTabProps): JSX.Element {
  const [usage, setUsage] = useState<UsageDay[] | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const isMobile = useIsMobile()

  useEffect(() => {
    let alive = true
    setError(null)
    usageApi.usage().then((p) => {
      if (!alive) return
      if (p.ok !== true) throw new Error('用量数据加载失败')
      setUsage(p.days)
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [refreshTick, retryTick])

  if (error) {
    return <ErrorCard message={error} onRetry={() => setRetryTick(t => t + 1)} />
  }
  if (usage === null) return <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>加载中…</div>

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`

  // 查询范围内数据（排行与每日明细表消费）
  const filtered = filterDays(usage, range)
  const filteredSorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date))

  // 模型排行（范围内）
  const models = new Map<string, number>()
  for (const d of filtered) for (const m of d.models ?? []) models.set(m.model, (models.get(m.model) ?? 0) + m.tokens)
  const modelRank = [...models.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)

  // 月视图热力：本月天数（按当前月实际天数补齐空档）
  const monthDays = usage.filter(d => d.date.startsWith(monthPrefix))
  const daysInMonth = new Date(year, month, 0).getDate()
  const monthCells = Array.from({ length: daysInMonth }, (_, i) => {
    const dateStr = `${monthPrefix}-${String(i + 1).padStart(2, '0')}`
    const hit = monthDays.find(d => d.date === dateStr)
    return {
      key: dateStr, label: dateStr, short: String(i + 1), value: hit?.tokens ?? 0,
      input: hit?.inputTokens ?? 0,
      output: hit?.outputTokens ?? 0,
      cache: hit ? (hit.cacheReadTokens ?? 0) + (hit.cacheWriteTokens ?? 0) : 0,
      hitRate: hit?.cacheHitRate,
    }
  })
  // 年度热力：2 行 × 6 列（1-6 月 / 7-12 月），格子尺寸与月热力协调
  const yearCells = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`
    const days = usage.filter(d => d.date.startsWith(key))
    const sum = sumTokens(days)
    return {
      key, label: `${i + 1} 月`, short: `${i + 1}月`, value: sum.total,
      input: sum.input,
      output: sum.output,
      cache: sum.cache,
      hitRate: days.length > 0 ? days.reduce((acc, d) => acc + (d.cacheHitRate ?? 0), 0) / days.length : undefined,
    }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 热力行：grid 强制两列（flex wrap 会被年热力的宽内容撑到换行） */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8, alignItems: 'start' }}>
        <div style={rowCard}>
          <CardHead name={`${year} 年 ${month} 月热力`} meta="点击格子看当日模型明细" />
          <Heatmap cells={monthCells} onSelect={c => setSelectedDay(c.label)} cellText="both" />
        </div>
        <div style={rowCard}>
          <CardHead name={`${year} 年度热力`} meta="1-6 月 / 7-12 月" />
          <Heatmap cells={yearCells} rows={2} cellText="both" />
        </div>
      </div>

      {/* 点热力格子：当日模型明细 */}
      {selectedDay !== null && (
        <div style={rowCard}>
          <CardHead name={`${selectedDay} 模型明细`} />
          <DayDetailTable day={usage.find(d => d.date === selectedDay)} />
        </div>
      )}

      <div style={rowCard}>
        <CardHead name="模型消耗排行" meta={`${rangeLabel} · Top ${Math.min(10, modelRank.length)}`} />
        {modelRank.length === 0
          ? <div style={{ border: '1px dashed var(--dsw-alias-border-l3)', borderRadius: 8, padding: 12, textAlign: 'center', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>该范围暂无用量</div>
          : <RankBars rows={modelRank} nameWidth={220} />}
      </div>

      <div style={rowCard}>
        <CardHead name="每日明细" meta={`${rangeLabel} · ${filteredSorted.length} 天`} />
        {filteredSorted.length === 0 ? (
          <div style={{ border: '1px dashed var(--dsw-alias-border-l3)', borderRadius: 8, padding: 12, textAlign: 'center', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>该范围暂无用量</div>
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--dsw-alias-bg-layer-2)', zIndex: 1 }}>
                <tr>{['日期', '输入', '输出', '缓存', '合计', '命中率'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filteredSorted.map(d => {
                  const s = sumTokens([d])
                  return (
                    <tr key={d.date} style={{ cursor: 'pointer', borderBottom: '1px solid var(--dsw-alias-border-l1)' }}
                      onClick={() => setSelectedDay(d.date)}>
                      <td style={tdStyle}>{d.date}</td>
                      <td style={tdMono}>{formatUnits(s.input)}</td>
                      <td style={tdMono}>{formatUnits(s.output)}</td>
                      <td style={tdMono}>{formatUnits(s.cache)}</td>
                      <td style={tdMono}>{formatUnits(s.total)}</td>
                      <td style={tdStyle}>{formatHitRate(d.cacheHitRate)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function DayDetailTable({ day }: { day?: UsageDay }): JSX.Element | null {
  if (day === undefined) return null
  const rows = [...(day.models ?? [])].sort((a, b) => b.tokens - a.tokens)
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{['模型', '输入', '输出', '缓存', '合计', '命中率'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.model} style={{ borderBottom: '1px solid var(--dsw-alias-border-l1)' }}>
            <td style={tdStyle}>{r.model}</td>
            <td style={tdMono}>{formatUnits(r.inputTokens)}</td>
            <td style={tdMono}>{formatUnits(r.outputTokens)}</td>
            <td style={tdMono}>{formatUnits(r.cacheReadTokens)}</td>
            <td style={tdMono}>{formatUnits(r.tokens)}</td>
            <td style={tdStyle}>{formatHitRate(r.cacheHitRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
