/**
 * UsageTab — 明细 tab（DSH 设置页设计语言）：
 *  - 「热力」rowCard ×2 并排：本月 / 本年（点击格子下钻当日模型明细）；
 *  - 「模型消耗排行」rowCard（查询范围内，每行带缓存命中率）；
 *  - 「每日明细」rowCard：DSH 表格风——caption 表头 + 行分隔细线 + mono 数值；
 *    卡头搜索框支持按供应商 / 模型名过滤（命中时按「天 × 模型」行展开）。
 * 查询范围由 Workbench 全局持有，本 tab 只消费区间。
 */
import { useEffect, useState } from 'react'
import { usageApi } from './api'
import { modelRank, splitModelKey, sumTokens, type UsageDay } from './aggregate'
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

const STYLE_ID = 'dsh-usage-search-styles'

/* ── 搜索交互样式：行入场淡入 + 输入框聚焦光效。
   注释刻意用文字描述「星号紧跟正斜杠」，不写出该两字符序列，防止整串被提前闭合。 ── */
const SHEET = `
@keyframes dsh-usage-row-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.dsh-usage-row-in { animation: dsh-usage-row-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }
.dsh-usage-search:focus {
  border-color: var(--dsw-alias-state-business-primary) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .dsh-usage-row-in { animation: none; }
}
`

/** 幂等注入搜索样式；返回移除函数。 */
function ensureSearchStyle(): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

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

/** 每日明细展开行（搜索空 = 按天汇总；搜索非空 = 按天 × 匹配模型）。 */
interface DetailRow {
  key: string
  date: string
  model?: string
  input: number
  output: number
  cache: number
  total: number
  hitRate: number | null
}

/** 由范围数据构建明细行；query 非空时按供应商 / 模型名过滤并按模型展开。 */
function buildDetailRows(days: UsageDay[], query: string): DetailRow[] {
  const q = query.trim().toLowerCase()
  if (q === '') {
    return days.map(d => {
      const s = sumTokens([d])
      return {
        key: d.date, date: d.date,
        input: s.input, output: s.output, cache: s.cache, total: s.total,
        hitRate: d.cacheHitRate ?? null,
      }
    })
  }
  const rows: DetailRow[] = []
  for (const d of days) {
    for (const m of d.models ?? []) {
      const { provider, model } = splitModelKey(m.model)
      if (!provider.toLowerCase().includes(q) && !model.toLowerCase().includes(q)) continue
      const input = m.inputTokens ?? 0
      const cacheRead = m.cacheReadTokens ?? 0
      const cacheWrite = m.cacheWriteTokens ?? 0
      const prompt = input + cacheRead + cacheWrite
      rows.push({
        key: `${d.date}:${m.model}`, date: d.date, model: m.model,
        input,
        output: m.outputTokens ?? 0,
        cache: cacheRead + cacheWrite,
        total: m.tokens ?? 0,
        hitRate: prompt > 0 ? (cacheRead / prompt) * 100 : null,
      })
    }
  }
  return rows
}

export function UsageTab({ range, rangeLabel, refreshTick }: UsageTabProps): JSX.Element {
  const [usage, setUsage] = useState<UsageDay[] | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [query, setQuery] = useState('')
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

  useEffect(() => ensureSearchStyle(), [])

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

  // 模型排行（范围内，含聚合命中率）
  const modelRankData = modelRank(filtered)

  // 每日明细行（受搜索过滤；行 key 变化时重播淡入动画）
  const detailRows = buildDetailRows(filteredSorted, query)
  const searching = query.trim() !== ''

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
        <CardHead name="模型消耗排行" meta={`${rangeLabel} · Top ${Math.min(10, modelRankData.length)}`} />
        {modelRankData.length === 0
          ? <div style={{ border: '1px dashed var(--dsw-alias-border-l3)', borderRadius: 8, padding: 12, textAlign: 'center', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>该范围暂无用量</div>
          : <RankBars rows={modelRankData} nameWidth={220} />}
      </div>

      <div style={rowCard}>
        {/* 卡头：标题 + meta（右移小字） + 供应商/模型搜索框 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>每日明细</span>
          <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>
            {rangeLabel} · {searching ? `命中 ${detailRows.length} 行` : `${filteredSorted.length} 天`}
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flex: 'none', color: 'var(--dsw-alias-label-tertiary)' }}>
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className="dsh-usage-search"
              type="text"
              value={query}
              placeholder="搜索供应商 / 模型…"
              aria-label="按供应商或模型搜索"
              style={{
                height: 26,
                width: isMobile ? 140 : 190,
                padding: '0 8px',
                fontSize: 12,
                lineHeight: '18px',
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-base)',
                color: 'var(--dsw-alias-label-primary)',
                fontFamily: 'inherit',
                colorScheme: 'dark light',
                outline: 'none',
                transition: 'border-color .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s cubic-bezier(.2,.8,.2,1)',
              }}
              onChange={e => setQuery(e.target.value)}
            />
            {query !== '' && (
              <button
                type="button"
                aria-label="清除搜索"
                onClick={() => setQuery('')}
                style={{
                  flex: 'none', width: 18, height: 18, padding: 0, borderRadius: 999,
                  border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 16%, transparent)',
                  color: 'var(--dsw-alias-label-secondary)', fontSize: 11, lineHeight: 1,
                  transition: 'background .22s cubic-bezier(.2,.8,.2,1), transform .22s cubic-bezier(.2,.8,.2,1)',
                }}
              >
                ✕
              </button>
            )}
          </span>
        </div>
        {filteredSorted.length === 0 ? (
          <div style={{ border: '1px dashed var(--dsw-alias-border-l3)', borderRadius: 8, padding: 12, textAlign: 'center', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>该范围暂无用量</div>
        ) : detailRows.length === 0 ? (
          <div style={{ border: '1px dashed var(--dsw-alias-border-l3)', borderRadius: 8, padding: 12, textAlign: 'center', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>
            没有匹配「{query.trim()}」的供应商或模型
          </div>
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--dsw-alias-bg-layer-2)', zIndex: 1 }}>
                <tr>{(searching ? ['日期', '模型', '输入', '输出', '缓存', '合计', '命中率'] : ['日期', '输入', '输出', '缓存', '合计', '命中率']).map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {detailRows.map(r => (
                  <tr key={r.key} className="dsh-usage-row-in"
                    style={{ cursor: searching ? 'default' : 'pointer', borderBottom: '1px solid var(--dsw-alias-border-l1)' }}
                    onClick={searching ? undefined : () => setSelectedDay(r.date)}>
                    <td style={tdStyle}>{r.date}</td>
                    {r.model !== undefined && (
                      <td style={{ ...tdStyle, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.model}>{r.model}</td>
                    )}
                    <td style={tdMono}>{formatUnits(r.input)}</td>
                    <td style={tdMono}>{formatUnits(r.output)}</td>
                    <td style={tdMono}>{formatUnits(r.cache)}</td>
                    <td style={tdMono}>{formatUnits(r.total)}</td>
                    <td style={tdStyle}>{formatHitRate(r.hitRate)}</td>
                  </tr>
                ))}
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
