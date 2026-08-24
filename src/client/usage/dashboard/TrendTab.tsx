/**
 * TrendTab — 趋势 tab（用量总览仪表盘）。
 *
 * 布局：铺满右侧面板的 bento 网格（参考现代 dashboard 语言，但配色/控件规格
 * 仍严格对齐 DSH 官方 token）：
 *  - hero 面：标题 + 日期 + 一排 mono 大数（Tokens/输入/输出/调用次数）+ 右侧
 *    缓存命中率半环仪表；
 *  - 主区：用量趋势（粒度自适应柱图，纵向 flex:1 吃掉剩余高度）+ 右列供应商
 *    占比立柱 / 告警列表；
 *  - 底排：小指标块（日均/工作时长/模型数/异常日/告警）带跳转箭头；
 *  - 末排：模型消耗排行。
 *
 * 视觉令牌：面 = bg-module-platform + border-l1 + r16（dash.tsx 的 surface）；
 * 强调一律 state-business-primary，禁止反色的 brand-primary。
 * 同时向 SignalTab 导出旧的设置页行卡片令牌（rowCard/editorFace/Stat/CardHead）。
 *
 * 查询范围由 Workbench 全局持有（RangePicker 在 tabNav 行），本 tab 只消费区间：
 * 粒度自适应（≤2 天按小时、≤31 天按日、≤120 天按周、更长按月）；
 * 单日/无趋势时主图位改排模型榜。
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
import { RankBars } from './charts/RankBars'
import { Gauge } from './charts/Gauge'
import { ShareColumns } from './charts/ShareColumns'
import { HeroStat, PanelHead, Tile, icons, panel, surface } from './dash'
import { ErrorCard } from './primitives/ErrorCard'
import { EmptyState } from './primitives/EmptyState'
import { useIsMobile } from '../../responsive'

export interface TrendTabProps {
  range: DateRange
  rangeLabel: string
  onJumpAccounts: () => void
  /** 跳转信号 tab（异常日柱点击联动）。 */
  onJumpSignal?: () => void
  refreshTick?: number
}

/* ── DSH 设置页设计令牌（对齐 ModelsSection.module.css；SignalTab 复用） ──── */

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

/** 面板级窄断点：主区两列改单列（fill 下卡片宽≈视口宽，用视口断点即可）。 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1150px)').matches)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1150px)')
    const onChange = (e: MediaQueryListEvent): void => { setNarrow(e.matches) }
    setNarrow(mql.matches)
    mql.addEventListener('change', onChange)
    return () => { mql.removeEventListener('change', onChange) }
  }, [])
  return narrow
}

/** 环比徽章（hero 大数右侧小字）。 */
function deltaBadge(delta: number | null): { text: string; color: string } | null {
  if (delta === null) return null
  if (delta > 0) return { text: `↑${delta >= 10 ? Math.round(delta) : delta.toFixed(1)}%`, color: 'var(--dsw-alias-state-success-primary)' }
  if (delta < 0) return { text: `↓${Math.abs(delta) >= 10 ? Math.round(Math.abs(delta)) : Math.abs(delta).toFixed(1)}%`, color: 'var(--dsw-alias-state-error-primary)' }
  return { text: '持平', color: 'var(--dsw-alias-label-tertiary)' }
}

/** 今天的中文日期串（hero 副标题）。 */
function todayText(now = new Date()): string {
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
  return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${week}`
}

export function TrendTab({ range, rangeLabel, onJumpAccounts, onJumpSignal, refreshTick }: TrendTabProps): JSX.Element {
  const [usage, setUsage] = useState<UsageDay[] | null>(null)
  const [hours, setHours] = useState<UsageHour[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const isMobile = useIsMobile()
  const narrow = useNarrow()
  const compact = isMobile || narrow

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

  const share = providerShare(filtered)
  const palette = providerPalette()

  const alerts = providers
    .filter(p => p.alert && (p.alert.level === 'critical' || p.alert.level === 'warning'))
    .sort((a, b) => (a.alert!.level === 'critical' ? -1 : 1) - (b.alert!.level === 'critical' ? -1 : 1))

  const emptyHint = (title: string): JSX.Element => <EmptyState title={title} hint="去聊两句就会在这里出现数据" />
  const yi = formatYiExact(sum.total)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%', minWidth: 0, flexShrink: 0 }}>
      {/* ── hero：标题 + 大数排 + 缓存命中率半环 ── */}
      <div style={{
        ...surface,
        flex: 'none',
        padding: compact ? 16 : '20px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap',
        // 品牌蓝极淡渐晕：色值由 token 派生，浅/深主题都安全。
        backgroundImage: 'radial-gradient(120% 160% at 100% 0%, color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent) 0%, transparent 62%)',
      }}>
        <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 24, lineHeight: '32px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>
              {rangeLabel}用量总览
            </span>
            <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>{todayText()}</span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: compact ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
            gap: 12,
          }}>
            <HeroStat icon={icons.tokens} value={yi?.yi ?? formatUnits(sum.total)} label="总 Tokens" delta={deltaBadge(deltaPercent(sum.total, prevSum.total))} />
            <HeroStat icon={icons.input} value={formatUnits(sum.input)} label="输入" delta={deltaBadge(deltaPercent(sum.input, prevSum.input))} />
            <HeroStat icon={icons.output} value={formatUnits(sum.output)} label="输出" delta={deltaBadge(deltaPercent(sum.output, prevSum.output))} />
            <HeroStat icon={icons.requests} value={formatUnits(activity.requests)} label="调用次数" />
          </div>
          <span style={{ fontSize: 11, lineHeight: '16px', fontFamily: MONO, color: 'var(--dsw-alias-label-tertiary)' }}>
            精确合计 {yi?.exact ?? formatExact(sum.total)}
          </span>
        </div>
        <Gauge percent={filtered.length > 0 ? hitRate : null} label="缓存命中率" size={compact ? 170 : 200} />
      </div>

      {/* ── 主区：趋势主图（吃掉剩余高度）+ 右列占比/告警 ── */}
      <div style={{
        flex: '1 1 auto',
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: compact ? '1fr' : 'minmax(0, 2.2fr) minmax(260px, 1fr)',
        gap: 10,
        alignItems: 'stretch',
      }}>
        <div style={{ ...panel(16, 12), minHeight: 260 }}>
          <PanelHead
            title={showTrend ? '用量趋势' : '模型消耗排行'}
            meta={showTrend ? `${rangeLabel} · ${GRAIN_NAME[grain]}${anomalyMap !== null ? ` · ${anomalyMap.size} 个异常日` : ''}` : rangeLabel}
          />
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {showTrend
              ? <BarChart data={series} anomalies={anomalyMap ?? undefined} onSelectAnomaly={anomalyMap !== null && onJumpSignal !== undefined ? () => onJumpSignal() : undefined} />
              : rank.length > 0
                ? <RankBars rows={rank} nameWidth={180} />
                : emptyHint(`${rangeLabel}暂无用量`)}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={{ ...panel(16, 12), flex: 'none' }}>
            <PanelHead title="供应商占比" meta={`Top ${Math.min(3, share.length)}`} />
            <ShareColumns rows={share.map(s => ({ label: s.provider, value: s.tokens }))} total={sum.total} height={compact ? 150 : 176} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {share.slice(0, 4).map((s, i) => (
                <div key={s.provider} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: '18px', minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, flex: 'none', background: palette[i % palette.length] }} />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-primary)' }} title={s.provider}>{s.provider}</span>
                  <span style={{ marginLeft: 'auto', flex: 'none', fontFamily: MONO, color: 'var(--dsw-alias-label-secondary)' }}>{formatUnits(s.tokens)}</span>
                </div>
              ))}
              {share.length === 0 && (
                <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>{rangeLabel}暂无用量</span>
              )}
            </div>
          </div>

          <div style={{ ...panel(16, 10), flex: '1 1 auto', minHeight: 0 }}>
            <PanelHead title="供应商告警" meta={alerts.length > 0 ? `${alerts.length} 条` : '全部正常'} />
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {alerts.length === 0 ? (
                <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>全部供应商状态正常。</div>
              ) : alerts.map((p, i) => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                  borderTop: i === 0 ? undefined : '1px solid var(--dsw-alias-border-l1)',
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: p.alert!.level === 'critical' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-warn-primary)' }} />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' }}>{p.displayName}</span>
                  <span style={{ marginLeft: 'auto', flex: 'none', fontSize: 12, lineHeight: '18px', fontFamily: MONO, color: 'var(--dsw-alias-label-secondary)' }}>
                    {p.alert!.metric === 'remaining-percent' ? `剩余 ${p.alert!.value ?? 0}%` : `${p.alert!.value ?? ''}`}
                  </span>
                </div>
              ))}
            </div>
            <button type="button" onClick={onJumpAccounts} style={{
              flex: 'none', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4,
              padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)',
            }}>
              查看余额/配额
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── 底排小指标块 ── */}
      <div style={{
        flex: 'none',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 10,
      }}>
        <Tile label="日均 Tokens" value={formatUnits(avg)} sub={`${filtered.length} 天有数据`} />
        <Tile label="工作时长" value={formatWorkDuration(activity.workMs)} sub={filtered.length > 0 ? `日均 ${formatWorkDuration(activity.workMs / filtered.length)}` : undefined} />
        <Tile label="缓存量" value={formatUnits(sum.cache)} sub={`命中率 ${formatHitRate(hitRate)}`} tone="muted" />
        <Tile label="活跃模型" value={String(rank.length)} sub={rank[0] !== undefined ? `Top ${rank[0].label}` : undefined} tone="success" />
        <Tile
          label="异常日"
          value={String(anomalyMap?.size ?? 0)}
          sub={anomalyMap !== null ? '高于活跃日中位数 3 倍' : '无异常'}
          tone={anomalyMap !== null ? 'error' : 'muted'}
          action={onJumpSignal !== undefined ? '查看信号' : undefined}
          onAction={onJumpSignal}
        />
      </div>

      {/* ── 模型消耗排行 ── */}
      <div style={{ ...panel(16, 12), flex: 'none' }}>
        <PanelHead title="模型消耗排行" meta={`${rangeLabel} · Top ${Math.min(10, rank.length)}`} />
        {rank.length === 0 ? emptyHint(`${rangeLabel}暂无用量`) : <RankBars rows={rank} nameWidth={compact ? 140 : 220} />}
      </div>
    </div>
  )
}
