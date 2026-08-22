/** 环比徽章颜色/箭头。 */
function deltaView(delta: number): { text: string; color: string } {
  if (delta > 0) return { text: `↑ ${delta >= 10 ? Math.round(delta) : delta.toFixed(1)}%`, color: 'var(--dsw-alias-state-success-primary)' }
  if (delta < 0) return { text: `↓ ${Math.abs(delta) >= 10 ? Math.round(Math.abs(delta)) : Math.abs(delta).toFixed(1)}%`, color: 'var(--dsw-alias-state-error-primary)' }
  return { text: '持平', color: 'var(--dsw-alias-label-tertiary)' }
}

export function KpiCard({ title, value, unit, sub, tone, exact, delta, deltaLabel }: {
  title: string
  value: string
  unit?: string
  sub?: string
  tone?: 'default' | 'danger'
  /** 精确数字副行（千分位），如 "2,500,000,000"。 */
  exact?: string
  /** 环比百分比（较上一周期）；null = 无法计算（上期无数据）。 */
  delta?: number | null
  /** 环比说明（默认「较上周期」）。 */
  deltaLabel?: string
}): JSX.Element {
  const dv = delta !== undefined && delta !== null ? deltaView(delta) : null
  return (
    <div style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{title}</span>
        {dv !== null && (
          <span style={{ fontSize: 11, color: dv.color, fontFamily: 'ui-monospace, monospace' }} title={deltaLabel ?? '较上一周期'}>{dv.text}</span>
        )}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, color: tone === 'danger' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)', fontFamily: 'ui-monospace, monospace', marginTop: 4 }}>
        {value}{unit ? <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4 }}>{unit}</span> : null}
      </div>
      {exact ? (
        <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
          {exact}
        </div>
      ) : null}
      {sub ? <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }}>{sub}</div> : null}
    </div>
  )
}
