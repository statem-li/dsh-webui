/**
 * ShareColumns — 占比柱组（供应商 Top N）：圆角立柱 + 柱顶百分比气泡 + 柱下名称。
 * 高度按占比归一（最低 18% 保证可见），配色走跨图一致的供应商色板。
 */
import { formatUnits } from '../format'
import { providerPalette } from '../theme'
import { MONO } from '../dash'

export interface ShareColumn { label: string; value: number }

export function ShareColumns({ rows, total, height = 170, max = 3 }: {
  rows: ShareColumn[]
  /** 分母（范围内总量）；<=0 时按行合计。 */
  total: number
  height?: number
  max?: number
}): JSX.Element {
  const palette = providerPalette()
  const visible = rows.slice(0, max)
  const sum = total > 0 ? total : visible.reduce((a, r) => a + r.value, 0)
  const top = visible[0]?.value ?? 1
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height, minWidth: 0 }}>
      {visible.map((row, i) => {
        const share = sum > 0 ? row.value / sum : 0
        const h = Math.max(0.18, top > 0 ? row.value / top : 0)
        return (
          <div key={row.label} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6 }}>
            <div title={`${row.label} · ${formatUnits(row.value)}`} style={{
              height: `${Math.round(h * (height - 34))}px`,
              borderRadius: 12,
              background: `color-mix(in srgb, ${palette[i % palette.length]} ${i === 0 ? 100 : 55 - i * 12}%, transparent)`,
              display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 8,
              transition: 'height .45s cubic-bezier(.2,.8,.2,1)',
            }}>
              <span style={{
                padding: '1px 7px', borderRadius: 10, fontSize: 11, lineHeight: '16px', fontFamily: MONO,
                background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)',
              }}>{Math.round(share * 100)}%</span>
            </div>
            <span style={{ fontSize: 11, lineHeight: '16px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.label}>{row.label}</span>
          </div>
        )
      })}
      {visible.length === 0 && (
        <div style={{ flex: 1, textAlign: 'center', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>暂无数据</div>
      )}
    </div>
  )
}
