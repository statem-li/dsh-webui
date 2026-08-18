export function ProgressBar({ percent, height = 6, dangerBelow = 20, warnBelow = 40 }: {
  percent: number; height?: number; dangerBelow?: number; warnBelow?: number
}): JSX.Element {
  const color = percent <= dangerBelow
    ? 'var(--dsw-alias-state-error-primary)'
    : percent <= warnBelow
      ? 'var(--dsw-alias-state-warn-primary)'
      : 'var(--dsw-alias-state-success-primary)'
  return (
    <div style={{ width: '100%', height, borderRadius: height / 2, background: 'var(--dsw-alias-border-l2)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, percent))}%`, background: color, borderRadius: height / 2, transition: 'width .3s ease' }} />
    </div>
  )
}
