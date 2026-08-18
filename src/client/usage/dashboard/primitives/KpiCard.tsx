export function KpiCard({ title, value, unit, sub, tone }: {
  title: string; value: string; unit?: string; sub?: string; tone?: 'default' | 'danger'
}): JSX.Element {
  return (
    <div style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: tone === 'danger' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)', fontFamily: 'ui-monospace, monospace', marginTop: 4 }}>
        {value}{unit ? <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4 }}>{unit}</span> : null}
      </div>
      {sub ? <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 }}>{sub}</div> : null}
    </div>
  )
}
