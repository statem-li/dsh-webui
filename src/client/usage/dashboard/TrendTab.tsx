/**
 * TrendTab — 趋势 tab（替代原「总览」）。
 *
 * 视觉完全对齐 DSH 官方设置页语言（ui-settings-models ModelsSection）：
 *  - 概要：`.editor` 填充面（bg-module-platform r12 p14/16）内的统计行，
 *    格间竖线分隔——不是卡片网格；
 *  - 图表区块：`.rowCard` 描边卡（border-l2 r12 p12/14），卡头 rowName
 *    （14px/500）+ 右侧 meta caption（12px tertiary）；
 *  - 状态点 8px 圆形（success/error/warn）；数值一律 ui-monospace。
 *
 * 查询范围由 Workbench 全局持有（RangePicker 在 tabNav 行），本 tab 只消费区间：
 * 粒度自适应（≤31 天按日、≤120 天按周、更长按月）；单日查询时主图位改排模型榜。
 */

import { useEffect, useState } from 'react'
import { usageApi, type ProviderInfo } from './api'
import { averageCacheHitRate, providerShare, sumActivity, sumTokens, type UsageDay, type UsageHour } from './aggregate'
import {
  aggregateHourSeries, aggregateSeries, dailyAverage, deltaPercent, filterDays, pickGrain, prevRange,
  type DateRange,
} from './range'
import { formatExact, formatHitRate, formatUnits, formatWorkDuration, formatYiExact } from './format'
import { providerPalette } from './theme'
import { BarChart } from './charts/BarChart'
import { DonutChart } from './charts/DonutChart'
import { RankBars } from './charts/RankBars'
import { ErrorCard } from './primitives/ErrorCard'
import { EmptyState } from './primitives/EmptyState'

export interface TrendTabProps {
  range: DateRange
  rangeLabel: string
  onJumpAccounts: () => void
  /** 跳转信号 tab（异常日柱点击联动）。 */
  onJumpSignal?: () => void
  refreshTick?: number
}

/* ── DSH 设置页设计令牌（对齐 ModelsSection.module.css） ──────────────── */

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** `.rowCard`：描边行卡片。 */
export const rowCard: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
}

/** `.rowHead`：卡头（名称 + 右侧 meta）。 */
export function CardHead({ name, meta }: { name: string; meta?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>{name}</span>
      {meta !== undefined && <span style={{ marginLeft: 'auto', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>{meta}</span>}
    </div>
  )
}

/** `.editor` 填充面（概要统计的底座）。 */
export const editorFace: React.CSSProperties = {
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-module-platform)',
  padding: '14px 16px',
}

/** 概要统计格：label caption 上、mono 主值中、精确值/sub 下；格间竖线分隔。 */
export function Stat({ label, value, exact, sub, delta, first }: {
  label: string
  value: string
  exact?: string
  sub?: string
  delta?: number | null
  first?: boolean
}): JSX.Element {
  const deltaView = delta === undefined || delta === null
    ? null
    : delta > 0
      ? { text: `↑${delta >= 10 ? Math.round(delta) : delta.toFixed(1)}%`, color: 'var(--dsw-alias-state-success-primary)' }
      : delta < 0
        ? { text: `↓${Math.abs(delta) >= 10 ? Math.round(Math.abs(delta)) : Math.abs(delta).toFixed(1)}%`, color: 'var(--dsw-alias-state-error-primary)' }
        : { text: '持平', color: 'var(--dsw-alias-label-tertiary)' }
  return (
    <div style={{
      minWidth: 0,
      paddingLeft: first ? 0 : 16,
      borderLeft: first ? undefined : '1px solid var(--dsw-alias-border-l2)',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600, fontFamily: MONO, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' }}>{value}</span>
        {deltaView !== null && <span style={{ fontSize: 11, fontFamily: MONO, color: deltaView.color }}>{deltaView.text}</span>}
      </span>
      {(exact !== undefined || sub !== undefined) && (
        <span style={{ fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', fontFamily: exact !== undefined ? MONO : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {exact ?? sub}
        </span>
      )}
    </div>
  )
}

/** 范围内模型聚合排行。 */
export function modelRank(days: UsageDay[]): Array<{ label: string; value: number }> {
  const map = new Map<string, number>()
  for (const d of days) for (const m of d.models ?? []) map.set(m.model, (map.get(m.model) ?? 0) + (m.tokens ?? 0))
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}

const GRAIN_NAME = { hour: '按小时', day: '按日', week: '按周', month: '按月' } as const

export function TrendTab({ range, rangeLabel, onJumpAccounts, onJumpSignal, refreshTick }: TrendTabProps): JSX.Element {
  const [usage, setUsage] = useState<UsageDay[] | null>(null)
  const [hours, setHours] = useState<UsageHour[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    Promise.all([usageApi.usage(), usageApi.providers()])
      .then(([u, p]) => {
        if (!alive) return
        if (u.ok !== true) throw new Error('用量数据加载失败')
        if (p.ok !== true) throw new Error('供应商数据加载失败')
        setUsage(u.days)
        setHours(u.hours ?? [])
        setProviders(p.providers ?? [])
      })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [refreshTick, retryTick])

  if (error) {
    return <ErrorCard message={error} onRetry={() => setRetryTick(t => t + 1)} />
  }
  if (usage === null) {
    return <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>加载中…</div>
  }

  const filtered = filterDays(usage, range)
  const previous = filterDays(usage, prevRange(range))
  const sum = sumTokens(filtered)
  const prevSum = sumTokens(previous)
  const hitRate = averageCacheHitRate(filtered)
  const avg = dailyAverage(filtered)
  const activity = sumActivity(filtered)

  // 粒度自适应趋势：≤2 天按小时、≤31 天按日、≤120 天按周、更长按月。
  const grain = pickGrain(range)
  const series = grain === 'hour' ? aggregateHourSeries(hours, range) : aggregateSeries(filtered, grain)
  const showTrend = series.length >= 2
  const rank = modelRank(filtered)

  // 异常日（仅日粒度）：范围内 tokens > 活跃日中位数 ×3 的天，柱顶红点 + 点击跳信号 tab。
  const anomalyMap = (() => {
    if (grain !== 'day' || filtered.length === 0) return null
    const actives = filtered.map(d => d.tokens ?? 0).filter(v => v > 0).sort((a, b) => a - b)
    if (actives.length === 0) return null
    const mid = Math.floor(actives.length / 2)
    const median = actives.length % 2 === 1 ? actives[mid] : (actives[mid - 1] + actives[mid]) / 2
    if (!(median > 0)) return null
    const map = new Map<string, { multiple: number; tokens: number }>()
    for (const d of filtered) {
      const tokens = d.tokens ?? 0
      if (tokens > median * 3) map.set(d.date, { multiple: tokens / median, tokens })
    }
    return map.size > 0 ? map : null
  })()

  const share = providerShare(filtered).slice(0, 8)
  const palette = providerPalette()
  const donutSlices = share.map((s, i) => ({ label: s.provider, value: s.tokens, color: palette[i % palette.length] }))

  const alerts = providers
    .filter(p => p.alert && (p.alert.level === 'critical' || p.alert.level === 'warning'))
    .sort((a, b) => (a.alert!.level === 'critical' ? -1 : 1) - (b.alert!.level === 'critical' ? -1 : 1))

  const emptyHint = (title: string): JSX.Element => <EmptyState title={title} hint="去聊两句就会在这里出现数据" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 概要：`.editor` 填充面 + 统计行（竖线分隔，非卡片网格） */}
      <div style={editorFace}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          <Stat first label={`${rangeLabel} Tokens`} value={formatYiExact(sum.total)?.yi ?? formatUnits(sum.total)} exact={formatYiExact(sum.total)?.exact ?? formatExact(sum.total)} delta={deltaPercent(sum.total, prevSum.total)} />
          <Stat label="输入" value={formatYiExact(sum.input)?.yi ?? formatUnits(sum.input)} exact={formatExact(sum.input)} delta={deltaPercent(sum.input, prevSum.input)} />
          <Stat label="输出" value={formatYiExact(sum.output)?.yi ?? formatUnits(sum.output)} exact={formatExact(sum.output)} delta={deltaPercent(sum.output, prevSum.output)} />
          <Stat label="缓存命中率" value={formatHitRate(hitRate)} sub={`缓存量 ${formatUnits(sum.cache)}`} />
          <Stat label="日均 Tokens" value={formatUnits(avg)} sub={`${filtered.length} 天有数据`} />
          <Stat label="调用次数" value={formatUnits(activity.requests)} sub={filtered.length > 0 ? `日均 ${(activity.requests / filtered.length).toFixed(1)} 次` : undefined} />
          <Stat label="工作时长" value={formatWorkDuration(activity.workMs)} sub={filtered.length > 0 ? `日均 ${formatWorkDuration(activity.workMs / filtered.length)}` : undefined} />
        </div>
      </div>

      {/* 主区块：趋势（粒度自适应）/ 单日时改模型榜 */}
      <div style={rowCard}>
        <CardHead
          name={showTrend ? '用量趋势' : '模型消耗排行'}
          meta={showTrend ? `${rangeLabel} · ${GRAIN_NAME[grain]}${anomalyMap !== null ? ` · ${anomalyMap.size} 个异常日` : ''}` : rangeLabel}
        />
        {showTrend
          ? <BarChart data={series} anomalies={anomalyMap ?? undefined} onSelectAnomaly={anomalyMap !== null && onJumpSignal !== undefined ? () => onJumpSignal() : undefined} />
          : rank.length > 0
            ? <RankBars rows={rank} nameWidth={180} />
            : emptyHint(`${rangeLabel}暂无用量`)}
      </div>

      {/* 分布 + 告警并排（窄内容自动换行） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8, alignItems: 'start' }}>
        <div style={rowCard}>
          <CardHead name="供应商分布" meta={`${rangeLabel} · 共 ${formatUnits(sum.total)}`} />
          {donutSlices.length === 0
            ? emptyHint(`${rangeLabel}暂无用量`)
            : <DonutChart slices={donutSlices} centerTitle={rangeLabel} centerValue={formatUnits(sum.total)} />}
        </div>
        <div style={rowCard}>
          <CardHead name="供应商告警" meta={alerts.length > 0 ? `${alerts.length} 条` : '无'} />
          {alerts.length === 0 ? (
            <div style={{ padding: '12px 4px', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>全部供应商状态正常。</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {alerts.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--dsw-alias-border-l1)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: p.alert!.level === 'critical' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-warn-primary)' }} />
                  <span style={{ fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }}>{p.displayName}</span>
                  <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
                    {p.alert!.metric === 'remaining-percent' ? `剩余 ${p.alert!.value ?? 0}%` : `${p.alert!.metric}: ${p.alert!.value ?? ''}`}
                  </span>
                  <button type="button" onClick={onJumpAccounts} style={{ marginLeft: 'auto', height: 28, padding: '0 10px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 14, background: 'transparent', cursor: 'pointer', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-primary)' }}>查看</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 排行整卡 */}
      <div style={rowCard}>
        <CardHead name="模型消耗排行" meta={`${rangeLabel} · Top ${Math.min(10, rank.length)}`} />
        {rank.length === 0 ? emptyHint(`${rangeLabel}暂无用量`) : <RankBars rows={rank} nameWidth={220} />}
      </div>
    </div>
  )
}
