/**
 * Gauge — 半环仪表（缓存命中率等 0–100 指标）。
 *
 * 视觉：底环 border-l2、值弧品牌蓝（state-business-primary，绝不用反色的
 * brand-primary）、端点圆钮 + 环心 mono 大数。0/100 端点刻度小字。
 */
import { MONO } from '../dash'

export interface GaugeProps {
  /** 0–100；超出自动夹紧。null/NaN 显示 —。 */
  percent: number | null
  /** 环心下方说明。 */
  label: string
  /** 直径（px），默认 190。 */
  size?: number
}

/** 半环长度：π·R（R=88，见 viewBox）。 */
const R = 88
const ARC = Math.PI * R

export function Gauge({ percent, label, size = 190 }: GaugeProps): JSX.Element {
  const valid = percent !== null && isFinite(percent)
  const p = valid ? Math.max(0, Math.min(100, percent)) : 0
  // 端点角度：180°（左）→ 0°（右）。
  const rad = Math.PI * (1 - p / 100)
  const knobX = 110 + R * Math.cos(rad)
  const knobY = 118 - R * Math.sin(rad)
  return (
    <div style={{ flex: 'none', width: size, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg viewBox="0 0 220 136" width={size} height={Math.round((size * 136) / 220)} role="img" aria-label={`${label} ${valid ? `${p.toFixed(0)}%` : '暂无数据'}`}>
        <path d="M 22 118 A 88 88 0 0 1 198 118" fill="none" stroke="var(--dsw-alias-border-l2)" strokeWidth={10} strokeLinecap="round" />
        {valid && (
          <path d="M 22 118 A 88 88 0 0 1 198 118" fill="none" stroke="var(--dsw-alias-state-business-primary)" strokeWidth={10}
            strokeLinecap="round" strokeDasharray={`${ARC} ${ARC}`} strokeDashoffset={ARC * (1 - p / 100)}
            style={{ transition: 'stroke-dashoffset .45s cubic-bezier(.2,.8,.2,1)' }} />
        )}
        {valid && (
          <circle cx={knobX} cy={knobY} r={6} fill="var(--dsw-alias-bg-module-platform)" stroke="var(--dsw-alias-state-business-primary)" strokeWidth={3}
            style={{ transition: 'cx .45s cubic-bezier(.2,.8,.2,1), cy .45s cubic-bezier(.2,.8,.2,1)' }} />
        )}
        <text x={110} y={100} textAnchor="middle" fontSize={30} fontWeight={600} fontFamily={MONO} fill="var(--dsw-alias-label-primary)">
          {valid ? `${p.toFixed(p >= 10 ? 1 : 2)}%` : '—'}
        </text>
        <text x={110} y={122} textAnchor="middle" fontSize={12} fill="var(--dsw-alias-label-secondary)">{label}</text>
        <text x={20} y={134} textAnchor="middle" fontSize={10} fill="var(--dsw-alias-label-tertiary)">0</text>
        <text x={200} y={134} textAnchor="middle" fontSize={10} fill="var(--dsw-alias-label-tertiary)">100</text>
      </svg>
    </div>
  )
}
