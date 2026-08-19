/**
 * DeepSeek 峰谷时刻卡片（sidebar.footer.action，order 0，独占首行）。
 * 展开态显示状态点 + 标题 + 高峰窗口 + 距下一次切换的倒计时；
 * 收起态（rail）退化为一个着色状态点。颜色走 DSH 主题令牌。
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { beijingClock, formatDelta, isPeak, nextTransition } from './schedule'
import { ensureModalAnimStyles, useModalClose } from '../modal-animation'
import { BillingModal } from './BillingModal'

/** footer 插槽 owner props（sidebar.footer.action 只给 wide）。 */
export interface PeakValleyCardProps {
  wide: boolean
}

/** 峰时=红（高峰/贵），谷时=绿（低谷/便宜）——对应峰谷电价惯例。 */
const PEAK_COLOR = '#ef4444'
const OFF_COLOR = '#22c55e'

const shell: CSSProperties = {
  flex: '0 0 100%',
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.08))',
  background: 'var(--dsw-alias-bg-layer-1, #1c1f26)',
}

const headRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
}

const dot: CSSProperties = {
  flex: 'none',
  width: 8,
  height: 8,
  borderRadius: '50%',
  transition: 'background .4s ease',
}

const title: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-primary, #eee)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const badge: CSSProperties = {
  flex: 'none',
  fontSize: 11,
  lineHeight: '16px',
  padding: '0 6px',
  borderRadius: 8,
  fontWeight: 600,
  transition: 'background .4s ease',
}

const windowLine: CSSProperties = {
  fontSize: 11,
  lineHeight: '15px',
  color: 'var(--dsw-alias-label-secondary, #999)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const countdownLine: CSSProperties = {
  fontSize: 11,
  lineHeight: '15px',
  color: 'var(--dsw-alias-label-secondary, #bbb)',
}

const railDot: CSSProperties = {
  flex: 'none',
  width: 14,
  height: 14,
  borderRadius: '50%',
  cursor: 'pointer',
  transition: 'background .4s ease',
}

/** 渲染峰谷时刻卡片（展开态完整卡片；收起态一个状态点）。点击打开账单弹窗。 */
export function PeakValleyCard({ wide }: PeakValleyCardProps): JSX.Element {
  ensureModalAnimStyles()
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [open, setOpen] = useState(false)
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })

  useEffect(() => {
    const timer = window.setInterval(() => { setNowMs(Date.now()) }, 30_000)
    return () => { window.clearInterval(timer) }
  }, [])

  const clock = beijingClock(nowMs)
  const peak = isPeak(clock.day, clock.hour, clock.minute)
  const next = nextTransition(clock)
  const accent = peak ? PEAK_COLOR : OFF_COLOR
  const countdown = formatDelta(next.deltaMinutes)

  if (!wide) {
    return (
      <>
        <span
          style={{ ...railDot, background: accent }}
          title={`DeepSeek ${peak ? '峰时（高峰计价）' : '谷时（低谷优惠）'} · ${peak ? '距谷时' : '距峰时'} ${countdown} · 点击查看账单`}
          onClick={() => { setOpen(true) }}
        />
        {open && <BillingModal closing={closing} onClose={requestClose} />}
      </>
    )
  }

  return (
    <>
      <div
        style={shell}
        className="dsh-peak-card"
        title={`DeepSeek 峰谷时刻 · 高峰 工作日 09:00–12:00 / 14:00–18:00 · 点击查看账单`}
        onClick={() => { setOpen(true) }}
      >
        <div style={headRow}>
          <span style={{ ...dot, background: accent }} aria-hidden />
          <span style={title}>DeepSeek 峰谷时刻</span>
          <span style={{ ...badge, background: accent, color: '#0e1116' }}>
            {peak ? '峰时' : '谷时'}
          </span>
        </div>
        <div style={windowLine}>高峰 · 工作日 09:00–12:00 / 14:00–18:00</div>
        <div style={countdownLine}>
          {peak ? '距谷时 ' : '距峰时 '}
          {countdown}
        </div>
      </div>
      {open && <BillingModal closing={closing} onClose={requestClose} />}
    </>
  )
}
