import { formatUnits } from '../format'

export interface DonutSlice { label: string; value: number; color: string }
export function DonutChart({ slices, centerTitle, centerValue }: { slices: DonutSlice[]; centerTitle: string; centerValue: string }): JSX.Element {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1
  const R = 70, C = 2 * Math.PI * R
  let offset = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', minWidth: 0 }}>
      <svg viewBox="0 0 180 180" width={160} height={160} style={{ flex: 'none', maxWidth: '100%' }}>
        <circle cx={90} cy={90} r={R} fill="none" stroke="var(--dsw-alias-border-l2)" strokeWidth={22} />
        {slices.map(s => {
          const frac = s.value / total
          const dash = frac * C
          const el = (
            <circle key={s.label} cx={90} cy={90} r={R} fill="none" stroke={s.color} strokeWidth={22}
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-offset} transform="rotate(-90 90 90)" />
          )
          offset += dash
          return el
        })}
        <text x={90} y={84} textAnchor="middle" fontSize={11} fill="var(--dsw-alias-label-tertiary)">{centerTitle}</text>
        <text x={90} y={106} textAnchor="middle" fontSize={18} fontWeight={600} fill="var(--dsw-alias-label-primary)">{centerValue}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
        {slices.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flex: 'none' }} />
            <span style={{ color: 'var(--dsw-alias-label-primary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{Math.round((s.value / total) * 100)}%</span>
            <span style={{ color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace, monospace' }}>{formatUnits(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
