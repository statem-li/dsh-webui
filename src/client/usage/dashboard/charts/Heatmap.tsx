import { useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCompact } from '../format'

export interface HeatCell {
  key: string
  label: string
  value: number
  /** tooltip 明细：输入 / 输出 / 缓存（读+写）/ 缓存命中率（%） */
  input?: number
  output?: number
  cache?: number
  hitRate?: number
}

/** 单个格子的最大边长（px）；列用 1fr 摊满可用宽度，正方形格子受此上限约束。 */
const CELL_MAX = 64
const GAP = 6
/** tooltip 距离格子顶部的间隔（px）。 */
const TIP_GAP = 8

interface HoverState { cell: HeatCell; left: number; top: number }

export function Heatmap({ cells, onSelect, rows = 5 }: { cells: HeatCell[]; onSelect?: (cell: HeatCell) => void; rows?: number }): JSX.Element {
  const [hover, setHover] = useState<HoverState | null>(null)
  const levels = (v: number): number => {
    if (v <= 0) return 0
    if (v < 1000) return 1
    if (v < 10000) return 2
    if (v < 100000) return 3
    return 4
  }
  const colors = ['var(--dsw-alias-border-l2)', '#2a4a7a', '#3a6db5', '#4f8cff', '#7c6bff']
  // 列数由「每行格子数（rows 行）向上取整」决定，列宽 1fr 自适应摊开；rows=1 时即一行横排。
  const cols = Math.max(1, Math.ceil(cells.length / rows))
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP, width: '100%', maxWidth: cols * CELL_MAX + (cols - 1) * GAP }}>
        {cells.map(c => {
          const idx = Math.min(4, levels(c.value))
          return (
            <div key={c.key}
              onMouseEnter={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setHover({ cell: c, left: r.left, top: r.top })
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(c)}
              style={{ aspectRatio: '1', minWidth: 0, borderRadius: 6, background: colors[idx], cursor: onSelect ? 'pointer' : 'default', opacity: c.value > 0 ? 1 : 0.35 }}
            />
          )
        })}
      </div>
      {hover !== null && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', bottom: typeof window !== 'undefined' ? window.innerHeight - hover.top + TIP_GAP : 0, left: hover.left, background: 'var(--dsw-alias-raised)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap', zIndex: 6100, boxShadow: '0 8px 24px rgba(0,0,0,.35)', pointerEvents: 'none' }}>
          <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--dsw-alias-label-primary)' }}>{hover.cell.label}</div>
          <div style={{ color: 'var(--dsw-alias-label-secondary)' }}>合计 {hover.cell.value > 0 ? formatCompact(hover.cell.value) : '无用量'}</div>
          {hover.cell.input !== undefined && (hover.cell.input ?? 0) + (hover.cell.output ?? 0) + (hover.cell.cache ?? 0) > 0 && (
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--dsw-alias-label-secondary)' }}>
              <span>输入 {formatCompact(hover.cell.input ?? 0)} · 输出 {formatCompact(hover.cell.output ?? 0)}</span>
              <span>缓存 {formatCompact(hover.cell.cache ?? 0)}{hover.cell.hitRate !== undefined ? ` · 命中 ${hover.cell.hitRate}%` : ''}</span>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
