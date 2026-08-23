/**
 * SignalTab — 信号 tab：Agent 效率与归因 / 用量信号 / 30 日 Token 预算。
 *
 * 视觉对齐 DSH 设置页语言（与 TrendTab 同一套设计令牌）：
 *  - 效率归因：`.editor` 填充面内的统计行（竖线分隔），底部 Top 路由分布小字；
 *  - 用量信号：`.rowCard` 描边卡内统计行 + 异常日红色警示条（可下钻当日会话）；
 *  - 预算卡：数值输入 + 保存（存本机 storages/usage-budget.json，0 关闭），
 *    已设预算时显示预计 30 日用量的进度条。
 *
 * 数据：GET /api/usage-stats/signal?days=30（尾随自然日窗口聚合）；
 * 下钻 GET /api/usage-stats/day-sessions?date=YYYY-MM-DD；预算 POST 同名端点。
 */

import { useEffect, useState } from 'react'
import { usageApi, type DaySessionRow, type SignalPayload } from './api'
import { CardHead, Stat, editorFace, MONO, rowCard } from './TrendTab'
import { formatExact, formatHitRate, formatUnits } from './format'
import { ErrorCard } from './primitives/ErrorCard'

/** 时间戳 → 当日本地 HH:mm。 */
function clockOf(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 百分比（0–1 → "38%"）；空值 —。 */
function percentOf(share: number | null): string {
  if (share === null || !isFinite(share)) return '—'
  return `${Math.round(share * 100)}%`
}

/** 倍数显示：4.8x；空值 —。 */
function multipleOf(value: number | null): string {
  if (value === null || !isFinite(value)) return '—'
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}x`
}

export function SignalTab(): JSX.Element {
  const [signal, setSignal] = useState<SignalPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  // ── 异常日下钻状态 ──
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [dayRows, setDayRows] = useState<DaySessionRow[] | null>(null)
  const [dayLoading, setDayLoading] = useState(false)
  const [dayError, setDayError] = useState<string | null>(null)

  // ── 预算编辑状态 ──
  const [budgetDraft, setBudgetDraft] = useState('')
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [budgetNote, setBudgetNote] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    setError(null)
    usageApi.signal(30)
      .then((payload) => {
        if (!alive) return
        if (payload.ok !== true) throw new Error('信号数据加载失败')
        setSignal(payload)
      })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [retryTick])

  // 预算外部值变化时同步草稿（保存成功后回显一致）
  useEffect(() => {
    if (signal === null) return
    setBudgetDraft(signal.budget !== null && signal.budget > 0 ? String(signal.budget) : '')
  }, [signal])

  /** 展开/收起某异常日的会话列表。 */
  const toggleDay = (date: string): void => {
    if (openDate === date) {
      setOpenDate(null)
      setDayRows(null)
      setDayError(null)
      return
    }
    setOpenDate(date)
    setDayRows(null)
    setDayError(null)
    setDayLoading(true)
    usageApi.daySessions(date)
      .then((payload) => {
        if (payload.ok !== true) throw new Error('会话数据加载失败')
        setDayRows(payload.sessions)
      })
      .catch((e: unknown) => setDayError(e instanceof Error ? e.message : String(e)))
      .finally(() => setDayLoading(false))
  }

  /** 保存预算；0 视为清除。 */
  const saveBudget = (): void => {
    const raw = budgetDraft.trim().replace(/,/g, '')
    const value = raw === '' ? 0 : Number(raw)
    if (!Number.isFinite(value) || value < 0) {
      setBudgetNote({ ok: false, text: '请输入非负数字' })
      return
    }
    setBudgetSaving(true)
    setBudgetNote(null)
    usageApi.saveBudget(value)
      .then((payload) => {
        if (payload.ok !== true) throw new Error('保存失败')
        setBudgetNote({ ok: true, text: value > 0 ? `已保存预算 ${formatUnits(value)} Token` : '已关闭预算' })
        setSignal(prev => (prev === null ? prev : { ...prev, budget: value }))
      })
      .catch((e: unknown) => setBudgetNote({ ok: false, text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBudgetSaving(false))
  }

  if (error !== null) {
    return <ErrorCard message={error} onRetry={() => setRetryTick(t => t + 1)} />
  }
  if (signal === null) {
    return <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>加载中…</div>
  }

  const { efficiency, signal: sig, budget } = signal
  const anomalies = sig.anomalyDays
  const topRoutesText = efficiency.topRoutes.slice(0, 3)
    .map(r => `${r.model} ${percentOf(r.share)}`)
    .join(' · ')
  const budgetActive = budget !== null && budget > 0
  const budgetUsed = budgetActive && sig.projected30 > 0 ? Math.min(1, sig.projected30 / budget) : 0
  const budgetOver = budgetActive && sig.projected30 > budget

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* ── Agent 效率与归因：`.editor` 填充面统计行 ── */}
      <div style={editorFace}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          <Stat first label="模型尝试次数" value={formatUnits(efficiency.requests)} exact={formatExact(efficiency.requests)} />
          <Stat label="次均 Tokens" value={efficiency.tokensPerRequest === null ? '—' : formatUnits(efficiency.tokensPerRequest)}
            sub={`合计 ${formatUnits(efficiency.tokens)}`} />
          <Stat label="缓存命中率" value={formatHitRate(efficiency.cacheHitRate)} />
          <Stat label="压缩占比" value={percentOf(efficiency.compactedShare)}
            sub={efficiency.compactedTokens > 0 ? `压缩 ${formatUnits(efficiency.compactedTokens)}` : '无压缩记录'} />
          <Stat label="Top 模型占比" value={percentOf(efficiency.topRouteShare)}
            sub={topRoutesText !== '' ? undefined : '暂无数据'} />
        </div>
        {topRoutesText !== '' && (
          <div style={{ marginTop: 10, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Top 模型：{topRoutesText}
          </div>
        )}
      </div>

      {/* ── 用量信号：预测与监控 + 异常日警示 ── */}
      <div style={rowCard}>
        <CardHead name="用量信号" meta={`近 ${sig.activeDays} 个活跃日参与基线`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          <Stat first label="7 日日均" value={formatUnits(sig.dailyAvg7)} exact={formatExact(Math.round(sig.dailyAvg7))} />
          <Stat label="预计 30 日" value={formatUnits(sig.projected30)} exact={formatExact(Math.round(sig.projected30))} />
          <Stat label="昨日用量" value={formatUnits(sig.yesterdayTokens)} sub={sig.yesterdayDate} />
          <Stat label="昨日 vs 中位数" value={multipleOf(sig.yesterdayMultiple)} />
          <Stat label="活跃日中位数" value={sig.activeMedian === null ? '—' : formatUnits(sig.activeMedian)} />
        </div>

        {anomalies.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {anomalies.map(day => (
              <div key={day.date} role="alert" style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '8px 12px', borderRadius: 8,
                border: '1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent)',
                background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, transparent)',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: 'var(--dsw-alias-state-error-primary)' }} />
                <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-primary)' }}>
                  <span style={{ fontFamily: MONO, fontWeight: 600, color: 'var(--dsw-alias-state-error-primary)' }}>{day.date}</span>
                  {' '}使用 <span style={{ fontFamily: MONO, fontWeight: 600, color: 'var(--dsw-alias-state-error-primary)' }}>{formatUnits(day.tokens)}</span>
                  {' '}Token，是活跃日中位数的{' '}
                  <span style={{ fontFamily: MONO, fontWeight: 600, color: 'var(--dsw-alias-state-error-primary)' }}>{multipleOf(day.multiple)}</span>
                  {' '}倍
                </span>
                <button type="button" onClick={() => toggleDay(day.date)} style={{
                  marginLeft: 'auto', height: 28, padding: '0 10px',
                  border: `1px solid ${openDate === day.date ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'}`,
                  borderRadius: 14, background: openDate === day.date ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)' : 'transparent',
                  cursor: 'pointer', fontSize: 12, lineHeight: '18px',
                  color: openDate === day.date ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-primary)',
                }}>
                  {openDate === day.date ? '收起会话' : '查看异常日会话'}
                </button>
              </div>
            ))}
          </div>
        )}

        {openDate !== null && (
          <div style={{ borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
              {openDate} 的会话用量（按 Token 降序{dayLoading ? ' · 加载中…' : ''}）
            </div>
            {dayError !== null && (
              <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' }}>{dayError}</div>
            )}
            {dayRows !== null && dayRows.length === 0 && (
              <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }}>该日没有可用量记录。</div>
            )}
            {dayRows !== null && dayRows.map(row => (
              <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--dsw-alias-border-l1)', minWidth: 0 }}>
                <span style={{ fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.title ?? '未命名会话'}
                </span>
                {row.firstAt !== null && row.lastAt !== null && (
                  <span style={{ flex: 'none', fontSize: 11, fontFamily: MONO, color: 'var(--dsw-alias-label-tertiary)' }}>
                    {clockOf(row.firstAt)}–{clockOf(row.lastAt)}
                  </span>
                )}
                <button type="button" title={`复制会话 ID：${row.id}`} onClick={() => { void navigator.clipboard?.writeText(row.id).catch(() => {}) }} style={{
                  flex: 'none', height: 22, padding: '0 8px', borderRadius: 11,
                  border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
                  cursor: 'pointer', fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)',
                }}>复制 ID</button>
                <span style={{ marginLeft: 'auto', flex: 'none', fontSize: 12, fontFamily: MONO, color: 'var(--dsw-alias-label-primary)' }}>
                  {formatUnits(row.tokens)}
                </span>
                <span style={{ flex: 'none', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>
                  {formatUnits(row.requests)} 次
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 30 日 Token 预算：本机保存，0 关闭 ── */}
      <div style={rowCard}>
        <CardHead name="30 日 Token 预算" meta="保存在本机 DSH 设置中" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="number"
            min={0}
            step={1_000_000}
            placeholder="例如 2600000000"
            value={budgetDraft}
            onChange={(e) => { setBudgetDraft(e.target.value); setBudgetNote(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') saveBudget() }}
            style={{
              width: 220, height: 32, padding: '0 10px', fontSize: 14, lineHeight: '22px',
              borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
              boxSizing: 'border-box', outline: 'none', fontFamily: MONO,
            }}
          />
          <button type="button" disabled={budgetSaving} onClick={saveBudget} style={{
            height: 32, padding: '0 16px', borderRadius: 16,
            border: '1px solid transparent', cursor: budgetSaving ? 'default' : 'pointer',
            background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)',
            fontSize: 13, lineHeight: '20px', opacity: budgetSaving ? 0.6 : 1,
          }}>{budgetSaving ? '保存中…' : '保存'}</button>
          {budgetNote !== null && (
            <span style={{ fontSize: 12, lineHeight: '18px', color: budgetNote.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>
              {budgetNote.text}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' }}>
          预算按自然月滚动对照「预计 30 日 Tokens」估算；填 0 可关闭。当前：{budgetActive ? `${formatUnits(budget!)} Token` : '尚未设置预算'}
        </div>
        {budgetActive && sig.projected30 > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--dsw-alias-bg-module-platform)', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.round(budgetUsed * 100)}%`, height: '100%', borderRadius: 3,
                background: budgetOver ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-business-primary)',
                transition: 'width .3s ease',
              }} />
            </div>
            <div style={{ fontSize: 12, lineHeight: '18px', color: budgetOver ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)' }}>
              {budgetOver
                ? `按近 7 日节奏，预计 30 日用量（${formatUnits(sig.projected30)}）将超出预算 ${Math.round((sig.projected30 / budget! - 1) * 100)}%`
                : `预计 30 日用量约为预算的 ${Math.round(budgetUsed * 100)}%`}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
