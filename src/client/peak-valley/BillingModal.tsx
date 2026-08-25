/**
 * DeepSeek 峰谷账单弹窗：余额 + 月度明细，含淡入淡出。
 * - 遮罩/卡片开合动画复用 ../modal-animation（useModalClose 在入口卡片持有）。
 * - 打开后并行加载余额 + 明细（Promise.all），loading 显示骨架屏。
 * - 内容容器加载完成与月份切换均触发 dsh-billing-fade 淡入。
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { modalAnimClass, modalMaskAnimClass } from '../modal-animation'
import { useIsMobile } from '../responsive'
import { fetchDeepseekAccount, fetchDeepseekBilling, saveDeepseekUserToken, type AccountSnapshot, type BillingModel, type BillingResponse } from './api'
import { beijingClock, formatDelta, isPeak, isWeekendFlatOff, nextTransition } from './schedule'

export interface BillingModalProps {
  /** 正在播放收回动画（此时弹窗仍挂载，播放 pop-out / mask-out）。 */
  closing: boolean
  /** 请求关闭（来自 useModalClose.requestClose，先播放收回动画再真正卸载）。 */
  onClose: () => void
}

/** token 数缩写：1e3→K、1e6→M，保留 1 位小数。 */
function formatCompact(n: number): string {
  if (!isFinite(n)) return String(n)
  if (n < 0) n = 0
  if (n < 1000) return String(Math.round(n))
  const units: Array<[number, string]> = [[1e6, 'M'], [1e3, 'K']]
  for (const [base, suffix] of units) {
    if (n >= base) {
      const v = n / base
      return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}${suffix}`
    }
  }
  return String(n)
}

/** 金额：默认 ¥ + toFixed(2)；currency 存在且非 CNY 时显示原 currency 前缀。 */
function formatMoney(amount: number | undefined, currency?: string): string {
  const sym = currency && currency !== 'CNY' ? currency : '¥'
  return `${sym}${(amount ?? 0).toFixed(2)}`
}

/** 缓存命中率 = hit/(hit+miss)*100，分母 0 显示 "-"。 */
function cacheHitRate(m: BillingModel): string {
  const hit = m.inputCacheHitTokens ?? 0
  const miss = m.inputCacheMissTokens ?? 0
  const denom = hit + miss
  if (!denom) return '-'
  return `${((hit / denom) * 100).toFixed(1)}%`
}

const mask: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 6000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(8,10,14,.5)',
  backdropFilter: 'blur(2px)',
}

const card: CSSProperties = {
  width: 'min(560px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 48px)',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 16,
  boxShadow: '0 24px 64px rgba(0,0,0,.5)',
  overflow: 'hidden',
}

/** 实底样式：玻璃质感开启时账单弹窗也保持不透明（data-solid 豁免玻璃规则）。 */
const BILLING_STYLE_ID = 'dsh-billing-card-solid-styles'
const BILLING_SHEET = [
  '.dsh-billing-card{background:var(--dsw-alias-bg-base)}',
  'html[data-dsh-glass] .dsh-billing-card[data-solid]{background:var(--dsw-static-neutral-bluish-00,#fff);backdrop-filter:none;-webkit-backdrop-filter:none}',
  'html[data-dsh-glass] body[data-ds-dark-theme] .dsh-billing-card[data-solid]{background:var(--dsw-static-neutral-bluish-850,#2c2c2e)}',
].join('\n')

function ensureBillingSolidStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(BILLING_STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = BILLING_STYLE_ID
  tag.textContent = BILLING_SHEET
  document.head.appendChild(tag)
}

const header: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '16px 16px 12px',
}

const headerText: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
}

const title: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
}

const subtitle: CSSProperties = {
  marginTop: 2,
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-secondary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const closeBtn: CSSProperties = {
  flex: 'none',
  width: 28,
  height: 28,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  fontSize: 16,
}

const content: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '4px 16px 20px',
}

const sectionTitle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-secondary)',
  margin: '12px 0 8px',
}

const balanceGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 12,
}

const kpiCard: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-2)',
  padding: 14,
}

const kpiLabel: CSSProperties = {
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-secondary)',
}

const kpiValue: CSSProperties = {
  marginTop: 4,
  fontSize: 20,
  fontWeight: 600,
  lineHeight: '26px',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, monospace',
}

const kpiValueHero: CSSProperties = {
  marginTop: 4,
  fontSize: 26,
  fontWeight: 600,
  lineHeight: '32px',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, monospace',
}

const monthTabs: CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
}

const monthTab = (active: boolean): CSSProperties => ({
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 12px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  background: active ? 'var(--dsw-alias-raised)' : 'transparent',
  color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  fontWeight: active ? 600 : 400,
})

const billCard: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-2)',
  padding: 14,
}

const billTotalRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  marginBottom: 4,
}

const billTotalLabel: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-secondary)',
}

const billTotalValue: CSSProperties = {
  fontSize: 24,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, monospace',
}

const billTotalHint: CSSProperties = {
  fontSize: 11,
  color: 'var(--dsw-alias-label-tertiary)',
}

const modelRow: CSSProperties = {
  padding: '10px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l1)',
}

const modelRowHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
}

const modelName: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const modelCost: CSSProperties = {
  flex: 'none',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, monospace',
}

const modelMeta: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 12px',
  marginTop: 4,
  fontSize: 11,
  lineHeight: '15px',
  color: 'var(--dsw-alias-label-tertiary)',
}

const emptyBox: CSSProperties = {
  border: '1px dashed var(--dsw-alias-border-l2)',
  borderRadius: 12,
  padding: 24,
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary)',
}

const tokenBox: CSSProperties = {
  border: '1px dashed var(--dsw-alias-border-l2)',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const tokenHint: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
}

const tokenRow: CSSProperties = {
  display: 'flex',
  gap: 8,
}

const tokenInputStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  padding: '7px 10px',
  fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
}

const tokenBtnStyle: CSSProperties = {
  flex: 'none',
  padding: '7px 16px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  border: 'none',
  background: '#22c55e',
  color: '#0e1116',
  cursor: 'pointer',
}

const tokenErrorStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-state-error-primary)',
}

const skeletonBox = (height: number): CSSProperties => ({
  height,
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-2)',
  animation: 'pulse 1.2s infinite',
})

/** 骨架屏：余额 3 卡 + 明细 1 大块。 */
function Skeleton(): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={balanceGrid}>
        {[0, 1, 2].map(i => <div key={i} style={skeletonBox(84)} />)}
      </div>
      <div style={skeletonBox(160)} />
    </div>
  )
}

export function BillingModal({ closing, onClose }: BillingModalProps): JSX.Element {
  ensureBillingSolidStyles()
  const [account, setAccount] = useState<AccountSnapshot | null | undefined>(undefined)
  const [billing, setBilling] = useState<BillingResponse | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [reloadKey, setReloadKey] = useState(0)
  const [tokenInput, setTokenInput] = useState('')
  const [savingToken, setSavingToken] = useState(false)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const isMobile = useIsMobile()

  // 打开后并行加载余额 + 明细（保存 token 后 reloadKey 变化触发重载）。
  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([fetchDeepseekAccount(), fetchDeepseekBilling(3)])
      .then(([acc, bill]) => {
        if (!alive) return
        setAccount(acc)
        setBilling(bill)
      })
      .catch(() => {
        if (!alive) return
        setAccount(null)
        setBilling(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [reloadKey])

  // 保存用户粘贴的 DeepSeek 平台 userToken（写入安全凭据存储后重载明细）。
  const saveToken = async (): Promise<void> => {
    const value = tokenInput.trim()
    if (value === '') return
    setSavingToken(true)
    setTokenError(null)
    try {
      await saveDeepseekUserToken(value)
      setTokenInput('')
      setReloadKey(k => k + 1)
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingToken(false)
    }
  }

  // Esc 关闭（closing 阶段忽略，requestClose 内部亦有防重入）。
  useEffect(() => {
    if (closing) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closing, onClose])

  // 副标题倒计时：30s 刷新，与卡片一致。
  useEffect(() => {
    const timer = window.setInterval(() => { setNowMs(Date.now()) }, 30_000)
    return () => { window.clearInterval(timer) }
  }, [])

  const clock = beijingClock(nowMs)
  const peak = isPeak(clock)
  const weekendFlat = isWeekendFlatOff(clock)
  const next = nextTransition(clock)
  const peakLabel = peak ? '峰时（高峰计价）' : weekendFlat ? '谷时（周末全天优惠）' : '谷时（低谷优惠）'
  const countdownLabel = `${peak ? '距谷时' : '距峰时'} ${formatDelta(next.deltaMinutes)}`

  // 月份按时间倒序（最新在前），默认选中最新月。
  const sortedMonths = useMemo(() => {
    if (!billing) return []
    return [...billing.months].sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month))
  }, [billing])
  const selectedMonth = sortedMonths.find(m => `${m.year}-${m.month}` === selectedKey) ?? sortedMonths[0] ?? null

  const balance = account?.balance ?? null

  return (
    <div style={isMobile ? { ...mask, padding: 0 } : mask} className={modalMaskAnimClass(closing)} onClick={onClose}>
      <div
        style={isMobile ? { ...card, width: '100vw', maxWidth: '100vw', maxHeight: '100dvh', borderRadius: 0 } : card}
        className={`dsh-billing-card ${modalAnimClass(closing)}`}
        data-solid=""
        onClick={e => e.stopPropagation()}
      >
        {/* 标题区 */}
        <div style={header}>
          <div style={headerText}>
            <div style={title}>DeepSeek 官方账单</div>
            <div style={subtitle}>{peakLabel} · {countdownLabel}</div>
          </div>
          <button type="button" style={closeBtn} aria-label="关闭" onClick={onClose}>✕</button>
        </div>

        {/* 内容区 */}
        <div style={content}>
          {loading ? (
            <Skeleton />
          ) : (
            <div className="dsh-billing-fade" style={{ display: 'flex', flexDirection: 'column' }}>
              {/* 余额区 */}
              <div style={sectionTitle}>余额</div>
              {balance === null ? (
                <div style={emptyBox}>暂无可用的余额信息</div>
              ) : (
                <div style={balanceGrid}>
                  <div style={kpiCard}>
                    <div style={kpiLabel}>总余额</div>
                    <div style={kpiValueHero}>{formatMoney(balance?.remaining, balance?.currency)}</div>
                  </div>
                  <div style={kpiCard}>
                    <div style={kpiLabel}>赠送余额</div>
                    <div style={kpiValue}>{formatMoney(balance?.breakdown?.granted, balance?.currency)}</div>
                  </div>
                  <div style={kpiCard}>
                    <div style={kpiLabel}>充值余额</div>
                    <div style={kpiValue}>{formatMoney(balance?.breakdown?.toppedUp, balance?.currency)}</div>
                  </div>
                </div>
              )}

              {/* 明细区 */}
              <div style={sectionTitle}>月度账单</div>
              {billing && billing.configured === false ? (
                <div style={tokenBox}>
                  <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{billing.message || '未配置 DeepSeek API Token，暂无账单明细'}</div>
                  <div style={tokenHint}>
                    获取方式：登录 platform.deepseek.com → 浏览器 DevTools → Application → Local Storage → 复制 <code>userToken</code> 的 value（JWT，会过期）。
                  </div>
                  <div style={tokenRow}>
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={e => setTokenInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void saveToken() }}
                      placeholder="粘贴 userToken"
                      style={tokenInputStyle}
                    />
                    <button type="button" style={{ ...tokenBtnStyle, opacity: tokenInput.trim() === '' || savingToken ? 0.6 : 1 }} disabled={tokenInput.trim() === '' || savingToken} onClick={() => void saveToken()}>
                      {savingToken ? '保存中…' : '保存'}
                    </button>
                  </div>
                  {tokenError && <div style={tokenErrorStyle}>{tokenError}</div>}
                </div>
              ) : sortedMonths.length === 0 ? (
                <div style={emptyBox}>暂无账单明细</div>
              ) : (
                <div>
                  <div style={monthTabs}>
                    {sortedMonths.map(m => {
                      const key = `${m.year}-${m.month}`
                      const active = selectedMonth != null && selectedMonth.year === m.year && selectedMonth.month === m.month
                      return (
                        <button key={key} type="button" style={monthTab(active)} onClick={() => setSelectedKey(key)}>
                          {m.year}年{m.month}月
                        </button>
                      )
                    })}
                  </div>
                  {/* 月份切换时 key 变化 → 重放淡入 */}
                  {selectedMonth && (
                    <div key={`${selectedMonth.year}-${selectedMonth.month}`} className="dsh-billing-fade" style={{ marginTop: 12 }}>
                      <div style={billCard}>
                        <div style={billTotalRow}>
                          <span style={billTotalLabel}>本月总消费</span>
                          <span style={billTotalValue}>{formatMoney(selectedMonth.totalCost, selectedMonth.currency)}</span>
                        </div>
                        <div style={billTotalHint}>按模型明细（命中率 = 缓存命中 / (命中 + 未命中)）</div>
                        {selectedMonth.models.map((m, i) => (
                          <div key={`${m.model}-${i}`} style={{ ...modelRow, borderBottom: i === selectedMonth.models.length - 1 ? 'none' : undefined }}>
                            <div style={modelRowHead}>
                              <span style={modelName}>{m.model}</span>
                              <span style={modelCost}>{formatMoney(m.cost, selectedMonth.currency)}</span>
                            </div>
                            <div style={modelMeta}>
                              <span>请求 {formatCompact(m.requests)}</span>
                              <span>输入 {formatCompact((m.inputCacheHitTokens ?? 0) + (m.inputCacheMissTokens ?? 0))}</span>
                              <span>输出 {formatCompact(m.outputTokens)}</span>
                              <span>缓存命中 {cacheHitRate(m)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
