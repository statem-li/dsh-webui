import { useEffect, useState } from 'react'
import { usageApi } from './api'
import { sumTokens, type UsageDay } from './aggregate'
import { formatCompact } from './format'
import { providerPalette } from './theme'
import { AreaChart } from './charts/AreaChart'
import { Heatmap } from './charts/Heatmap'
import { ErrorCard } from './primitives/ErrorCard'

type ViewMode = 'day' | 'month' | 'year'

export interface UsageTabProps { refreshTick?: number }

export function UsageTab({ refreshTick }: UsageTabProps): JSX.Element {
  const [usage, setUsage] = useState<UsageDay[] | null>(null)
  const [mode, setMode] = useState<ViewMode>('day')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

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
  if (usage === null) return <div style={{ color: 'var(--dsw-alias-label-tertiary)' }}>加载中…</div>

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const trend = usage.slice(-30).map(d => ({ label: d.date, input: d.inputTokens, output: d.outputTokens, cache: d.cacheReadTokens + d.cacheWriteTokens }))
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const monthDays = usage.filter(d => d.date.startsWith(monthPrefix))
  // 月视图热力：本月天数（按当前月实际天数补齐空档）
  const daysInMonth = new Date(year, month, 0).getDate()
  const monthCells = Array.from({ length: daysInMonth }, (_, i) => {
    const dateStr = `${monthPrefix}-${String(i + 1).padStart(2, '0')}`
    const hit = monthDays.find(d => d.date === dateStr)
    return {
      key: dateStr, label: dateStr, value: hit?.tokens ?? 0,
      input: hit?.inputTokens ?? 0,
      output: hit?.outputTokens ?? 0,
      cache: hit ? (hit.cacheReadTokens ?? 0) + (hit.cacheWriteTokens ?? 0) : 0,
      hitRate: hit?.cacheHitRate,
    }
  })
  const yearCells = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`
    const days = usage.filter(d => d.date.startsWith(key))
    const sum = sumTokens(days)
    return {
      key, label: `${i + 1} 月`, value: sum.total,
      input: sum.input,
      output: sum.output,
      cache: sum.cache,
      hitRate: days.length > 0 ? Math.round(days.reduce((acc, d) => acc + (d.cacheHitRate ?? 0), 0) / days.length) : undefined,
    }
  })
  const models = new Map<string, number>()
  for (const d of usage) for (const m of d.models ?? []) models.set(m.model, (models.get(m.model) ?? 0) + m.tokens)
  const modelRank = [...models.entries()].map(([model, tokens]) => ({ model, tokens })).sort((a, b) => b.tokens - a.tokens)
  const maxModel = modelRank[0]?.tokens ?? 1
  const palette = providerPalette()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {(['day', 'month', 'year'] as ViewMode[]).map(m => (
          <button key={m} type="button" onClick={() => setMode(m)}
            style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', cursor: 'pointer',
              background: mode === m ? 'var(--dsw-alias-raised)' : 'transparent', color: 'var(--dsw-alias-label-primary)' }}>
            {m === 'day' ? '日' : m === 'month' ? '月' : '年'}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>共 {usage.length} 天 · 截至 {todayStr}</span>
      </div>
      <div style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--dsw-alias-label-primary)' }}>{mode === 'day' ? '近 30 天' : mode === 'month' ? '近 12 月' : '年度'}用量趋势</div>
        <AreaChart data={trend} />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 45%', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--dsw-alias-label-primary)' }}>{year} 年 {month} 月热力</div>
          <div style={{ overflowX: 'auto' }}><Heatmap cells={monthCells} onSelect={c => setSelectedDay(c.label)} /></div>
        </div>
        <div style={{ flex: '1 1 45%', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--dsw-alias-label-primary)' }}>{year} 年度热力</div>
          <div style={{ overflowX: 'auto' }}><Heatmap cells={yearCells} rows={1} /></div>
        </div>
      </div>
      <div style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--dsw-alias-label-primary)' }}>模型消耗排行</div>
        {modelRank.slice(0, 10).map((row, i) => {
          return (
            <div key={row.model} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: palette[i % palette.length], flex: 'none' }} />
              <span style={{ width: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-primary)', fontSize: 12 }} title={row.model}>{row.model}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--dsw-alias-border-l2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(row.tokens / maxModel) * 100}%`, background: palette[i % palette.length], borderRadius: 4 }} />
              </div>
              <span style={{ color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{formatCompact(row.tokens)}</span>
            </div>
          )
        })}
        {modelRank.length > 10 && <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>其他 {modelRank.length - 10} 个模型</div>}
      </div>
      {selectedDay !== null && (
        <div style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{selectedDay} 明细</div>
            <button type="button" onClick={() => setSelectedDay(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer' }}>✕</button>
          </div>
          <DayDetailTable day={usage.find(d => d.date === selectedDay)} />
        </div>
      )}
    </div>
  )
}

function DayDetailTable({ day }: { day?: UsageDay }): JSX.Element | null {
  if (day === undefined) return null
  const rows = [...(day.models ?? [])].sort((a, b) => b.tokens - a.tokens)
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr>{['模型', '输入', '输出', '缓存', '合计', '命中率'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--dsw-alias-label-secondary)', borderBottom: '1px solid var(--dsw-alias-border-l1)' }}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.model} style={{ color: 'var(--dsw-alias-label-primary)' }}>
            <td style={{ padding: '6px 8px' }}>{r.model}</td>
            <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{formatCompact(r.inputTokens)}</td>
            <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{formatCompact(r.outputTokens)}</td>
            <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{formatCompact(r.cacheReadTokens)}</td>
            <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{formatCompact(r.tokens)}</td>
            <td style={{ padding: '6px 8px' }}>{r.cacheHitRate}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
