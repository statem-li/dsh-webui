import { useState } from 'react'
import { formatCompact } from '../format'

export interface HeatCell { key: string; label: string; value: number }
export function Heatmap({ cells, onSelect }: { cells: HeatCell[]; onSelect?: (cell: HeatCell) => void }): JSX.Element {
  const [hover, setHover] = useState<HeatCell | null>(null)
  const levels = (v: number): number => {
    if (v <= 0) return 0
    if (v < 1000) return 1
    if (v < 10000) return 2
    if (v < 100000) return 3
    return 4
  }
  const colors = ['var(--dsw-alias-border-l2)', '#2a4a7a', '#3a6db5', '#4f8cff', '#7c6bff']
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.ceil(cells.length / 5) || 1}, 18px)`, gap: 4 }}>
        {cells.map(c => {
          const idx = Math.min(4, levels(c.value))
          return (
            <div key={c.key}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(c)}
              style={{ width: 18, height: 18, borderRadius: 4, background: colors[idx], cursor: onSelect ? 'pointer' : 'default', opacity: c.value > 0 ? 1 : 0.35 }}
            />
          )
        })}
      </div>
      {hover !== null && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, background: 'var(--dsw-alias-raised)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '6px 10px', fontSize: 12, whiteSpace: 'nowrap', zIndex: 6100 }}>
          {hover.label} · {hover.value > 0 ? formatCompact(hover.value) : '无用量'}
        </div>
      )}
    </div>
  )
}
