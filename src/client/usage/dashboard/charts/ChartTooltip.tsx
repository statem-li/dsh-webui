import type { ReactNode } from 'react'

export interface ChartTooltipProps {
  x: number
  y: number
  children: ReactNode
  /** top：显示在指针上方；bottom：显示在指针下方（近视口顶部时用）。 */
  placement?: 'top' | 'bottom'
}

/**
 * 图表浮层。背景用 --dsw-alias-bg-layer-3（深浅主题均存在），
 * 不要用 --dsw-alias-raised（该变量不存在，会 fallback 成深色硬编码，浅色主题下突兀）。
 */
export function ChartTooltip({ x, y, children, placement = 'top' }: ChartTooltipProps): JSX.Element {
  return (
    <div style={{
      position: 'fixed', left: x, top: y, zIndex: 6100,
      transform: placement === 'top' ? 'translate(-50%, calc(-100% - 10px))' : 'translate(-50%, 14px)',
      background: 'var(--dsw-alias-bg-layer-3)',
      border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10,
      padding: '8px 12px', fontSize: 12, lineHeight: 1.5,
      boxShadow: '0 8px 24px rgba(0,0,0,.3)', pointerEvents: 'none', whiteSpace: 'nowrap',
    }}>
      {children}
    </div>
  )
}
