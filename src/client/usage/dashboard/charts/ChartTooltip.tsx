import type { ReactNode } from 'react'

export function ChartTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }): JSX.Element {
  return (
    <div style={{
      position: 'fixed', left: x, top: y, zIndex: 6100, transform: 'translate(-50%, -120%)',
      background: 'var(--dsw-alias-raised)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8,
      padding: '6px 10px', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,.25)', pointerEvents: 'none', whiteSpace: 'nowrap',
    }}>
      {children}
    </div>
  )
}
