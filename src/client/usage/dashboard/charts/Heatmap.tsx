import { useState } from 'react'
import { createPortal } from 'react-dom'
import { formatHitRate, formatUnits } from '../format'

export interface HeatCell {
  key: string
  label: string
  value: number
  /** 方块内短标签（如"22"表示几号、"8月"表示几月），cellText 为 label/both 时显示。 */
  short?: string
  /** tooltip 明细：输入 / 输出 / 缓存（读+写）/ 缓存命中率（%） */
  input?: number
  output?: number
  cache?: number
  hitRate?: number
}

const GAP = 6
/** tooltip 距离格子顶部的间隔（px）。 */
const TIP_GAP = 8

interface HoverState { cell: HeatCell; left: number; top: number }

export function Heatmap({ cells, onSelect, rows = 5, cellText = 'value' }: {
  cells: HeatCell[]
  onSelect?: (cell: HeatCell) => void
  rows?: number
  /** 方块内文字：'value' = token 数值（默认）；'label' = 标签（零值也显示）；'both' = 标签 + token 两行。 */
  cellText?: 'value' | 'label' | 'both'
}): JSX.Element {
  const [hover, setHover] = useState<HoverState | null>(null)
  const levels = (v: number): number => {
    if (v <= 0) return 0
    if (v < 100) return 1
    if (v < 1000) return 2
    if (v < 10000) return 3
    if (v < 100000) return 4
    if (v < 1000000) return 5
    if (v < 10000000) return 6
    if (v < 100000000) return 7
    if (v < 1000000000) return 8
    return 9
  }
  const colors = [
    'var(--dsw-alias-border-l2)',
    '#12314f', '#19466f', '#215d94', '#2a75b8', '#398dda',
    '#4f8cff', '#6fa0ff', '#8d7bff', '#ad66ff',
  ]
  // 列数由「每行格子数（rows 行）向上取整」决定，列宽 1fr 自适应摊满容器宽度；
  // 不设 maxWidth 上限——上限会让 grid 窄于卡片内容区，右侧留大片空白。
  const cols = Math.max(1, Math.ceil(cells.length / rows))
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP, width: '100%' }}>
        {cells.map(c => {
          const idx = Math.min(9, levels(c.value))
          return (
            <div key={c.key}
              onMouseEnter={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setHover({ cell: c, left: r.left, top: r.top })
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(c)}
              style={{ aspectRatio: '1', minWidth: 0, borderRadius: 6, background: colors[idx], cursor: onSelect ? 'pointer' : 'default', opacity: c.value > 0 ? 1 : 0.35, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, minWidth: 0 }}>
                {(cellText === 'label' || cellText === 'both') && (
                  <span style={{ fontSize: 9, lineHeight: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,.4)', whiteSpace: 'nowrap' }}>{c.short ?? c.label}</span>
                )}
                {((cellText === 'value' || cellText === 'both') && c.value > 0) && (
                  <span style={{ fontSize: 10, lineHeight: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.94)', textShadow: '0 1px 2px rgba(0,0,0,.35)', whiteSpace: 'nowrap' }}>{formatUnits(c.value)}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {hover !== null && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', bottom: typeof window !== 'undefined' ? window.innerHeight - hover.top + TIP_GAP : 0, left: hover.left, background: 'var(--dsw-alias-bg-layer-3)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap', zIndex: 6100, boxShadow: '0 8px 24px rgba(0,0,0,.35)', pointerEvents: 'none' }}>
          <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--dsw-alias-label-primary)' }}>{hover.cell.label}</div>
          <div style={{ color: 'var(--dsw-alias-label-secondary)' }}>合计 {hover.cell.value > 0 ? formatUnits(hover.cell.value) : '无用量'}</div>
          {hover.cell.input !== undefined && (hover.cell.input ?? 0) + (hover.cell.output ?? 0) + (hover.cell.cache ?? 0) > 0 && (
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--dsw-alias-label-secondary)' }}>
              <span>输入 {formatUnits(hover.cell.input ?? 0)} · 输出 {formatUnits(hover.cell.output ?? 0)}</span>
              <span>缓存 {formatUnits(hover.cell.cache ?? 0)}{hover.cell.hitRate !== undefined ? ` · 命中 ${formatHitRate(hover.cell.hitRate)}` : ''}</span>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
