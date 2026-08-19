import { useEffect, useState } from 'react'
import { usageApi, type ProviderInfo } from './api'
import { averageCacheHitRate, monthTokens, providerShare, sumTokens, type UsageDay } from './aggregate'
import { formatCompact, formatYiExact } from './format'
import { providerPalette } from './theme'
import { AreaChart } from './charts/AreaChart'
import { DonutChart } from './charts/DonutChart'
import { KpiCard } from './primitives/KpiCard'
import { ErrorCard } from './primitives/ErrorCard'
import { EmptyState } from './primitives/EmptyState'

export interface OverviewTabProps { onJumpAccounts: () => void; refreshTick?: number }

type ViewMode = 'day' | 'month' | 'year'

const inputStyle: React.CSSProperties = {
  padding: '4px 8px', fontSize: 12, borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
}

export function OverviewTab({ onJumpAccounts, refreshTick }: OverviewTabProps): JSX.Element {
  const [usage, setUsage] = useState<UsageDay[] | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  // 时间范围查询：日 / 月 / 年（默认今日）
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [selectedDay, setSelectedDay] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()))

  useEffect(() => {
    let alive = true
    setError(null)
    Promise.all([usageApi.usage(), usageApi.providers()])
      .then(([u, p]) => {
        if (!alive) return
        if (u.ok !== true) throw new Error('用量数据加载失败')
        if (p.ok !== true) throw new Error('供应商数据加载失败')
        setUsage(u.days)
        setProviders(p.providers ?? [])
      })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [refreshTick, retryTick])

  if (error) {
    return <ErrorCard message={error} onRetry={() => setRetryTick(t => t + 1)} />
  }
  if (usage === null) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {[0, 1, 2, 3, 4].map(i => <div key={i} style={{ height: 96, borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', animation: 'pulse 1.2s infinite' }} />)}
      </div>
    )
  }

  // 按查询范围过滤
  const filteredDays = viewMode === 'day' ? usage.filter(d => d.date === selectedDay)
    : viewMode === 'month' ? usage.filter(d => d.date.startsWith(selectedMonth))
    : usage.filter(d => d.date.startsWith(selectedYear))
  const rangeLabel = viewMode === 'day' ? '今日' : viewMode === 'month' ? '本月' : '本年'
  const rangeTitle = viewMode === 'day' ? selectedDay : viewMode === 'month' ? selectedMonth : selectedYear

  const sum = sumTokens(filteredDays)
  const hitRate = averageCacheHitRate(filteredDays)
  const share = providerShare(filteredDays).slice(0, 8)
  const palette = providerPalette()
  const donutSlices = share.map((s, i) => ({ label: s.provider, value: s.tokens, color: palette[i % palette.length] }))
  const alerts = providers
    .filter(p => p.alert && (p.alert.level === 'critical' || p.alert.level === 'warning'))
    .sort((a, b) => (a.alert!.level === 'critical' ? -1 : 1) - (b.alert!.level === 'critical' ? -1 : 1))
  const activeProviders = providers.filter(p => p.status === 'ok').length

  const trend = usage.slice(-30).map(d => ({
    label: d.date, input: d.inputTokens, output: d.outputTokens, cache: d.cacheReadTokens + d.cacheWriteTokens,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 时间范围查询：日 / 月 / 年，默认今日 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['day', 'month', 'year'] as ViewMode[]).map(m => (
          <button key={m} type="button" onClick={() => setViewMode(m)}
            style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', cursor: 'pointer',
              background: viewMode === m ? 'var(--dsw-alias-button-ghost-active-fill)' : 'transparent',
              color: viewMode === m ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)' }}>
            {m === 'day' ? '日' : m === 'month' ? '月' : '年'}
          </button>
        ))}
        {viewMode === 'day' && (
          <input type="date" value={selectedDay} onChange={e => setSelectedDay(e.target.value)} style={inputStyle} />
        )}
        {viewMode === 'month' && (
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={inputStyle} />
        )}
        {viewMode === 'year' && (
          <input type="number" value={selectedYear} min="2024" max="2040" onChange={e => setSelectedYear(e.target.value)} style={{ ...inputStyle, width: 90 }} />
        )}
        <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>查询范围：{rangeTitle}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {/* 亿级数字：主值显示「X 亿」，副行显示千分位精确数字 */}
        <KpiCard title={`${rangeLabel} Tokens`} value={formatYiExact(sum.total)?.yi ?? formatCompact(sum.total)} exact={formatYiExact(sum.total)?.exact} sub={`输入 ${formatCompact(sum.input)} · 输出 ${formatCompact(sum.output)}`} />
        <KpiCard title="输入" value={formatYiExact(sum.input)?.yi ?? formatCompact(sum.input)} exact={formatYiExact(sum.input)?.exact} />
        <KpiCard title="输出" value={formatYiExact(sum.output)?.yi ?? formatCompact(sum.output)} exact={formatYiExact(sum.output)?.exact} />
        <KpiCard title="缓存命中" value={formatYiExact(sum.cache)?.yi ?? formatCompact(sum.cache)} exact={formatYiExact(sum.cache)?.exact} sub={`命中率 ${hitRate}%`} />
        <KpiCard title="活跃供应商" value={String(activeProviders)} sub={`共 ${providers.length} 家配置`} />
        <KpiCard title="告警" value={String(alerts.length)} tone={alerts.length > 0 ? 'danger' : 'default'} />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 60%', minWidth: 0, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--dsw-alias-label-primary)' }}>近 30 天用量趋势</div>
          <AreaChart data={trend} />
        </div>
        <div style={{ flex: '1 1 35%', minWidth: 0, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--dsw-alias-label-primary)' }}>{rangeLabel}供应商分布</div>
          {donutSlices.length === 0 ? <EmptyState title={`${rangeTitle} 暂无用量`} hint="去聊两句就会在这里出现数据" /> : <DonutChart slices={donutSlices} centerTitle={rangeLabel} centerValue={formatCompact(sum.total)} />}
        </div>
      </div>
      {alerts.length > 0 ? (
        <div style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--dsw-alias-label-primary)' }}>告警</div>
          {alerts.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: p.alert!.level === 'critical' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-warn-primary)', flex: 'none' }} />
              <span style={{ color: 'var(--dsw-alias-label-primary)' }}>{p.displayName}</span>
              <span style={{ color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }}>{p.alert!.metric === 'remaining-percent' ? `剩余 ${p.alert!.value ?? 0}%` : `${p.alert!.metric}: ${p.alert!.value ?? ''}`}</span>
              <button type="button" onClick={onJumpAccounts} style={{ marginLeft: 'auto', fontSize: 12, border: 'none', background: 'transparent', color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' }}>查看</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
