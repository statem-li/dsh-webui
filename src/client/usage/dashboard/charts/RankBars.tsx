/**
 * RankBars — 横向条形排行（模型/供应商消耗榜共用）。
 * 名称列省略号 + 比例条 + 单位缩写值；色板与供应商环图一致。
 */

import { formatUnits } from '../format'
import { providerPalette } from '../theme'

export interface RankRow {
  label: string
  value: number
}

export function RankBars({ rows, maxRows = 10, nameWidth = 200 }: {
  rows: RankRow[]
  /** 最多展示条数（超出折叠为「其他 N 个」）。 */
  maxRows?: number
  nameWidth?: number
}): JSX.Element {
  const palette = providerPalette()
  const visible = rows.slice(0, maxRows)
  const max = visible[0]?.value ?? 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {visible.map((row, i) => (
        <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: palette[i % palette.length], flex: 'none' }} />
          <span style={{ width: nameWidth, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-primary)', fontSize: 12 }} title={row.label}>{row.label}</span>
          <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--dsw-alias-border-l2)', overflow: 'hidden', minWidth: 0 }}>
            <div style={{ height: '100%', width: `${Math.max(2, (row.value / (max || 1)) * 100)}%`, background: palette[i % palette.length], borderRadius: 4 }} />
          </div>
          <span style={{ flex: 'none', width: 64, textAlign: 'right', color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{formatUnits(row.value)}</span>
        </div>
      ))}
      {rows.length > maxRows && (
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', paddingTop: 4 }}>
          其他 {rows.length - maxRows} 个 · 合计 {formatUnits(rows.slice(maxRows).reduce((a, r) => a + r.value, 0))}
        </div>
      )}
    </div>
  )
}
