import type { ReactNode } from 'react'

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }): JSX.Element {
  return (
    <div style={{ border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 12, padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 6 }}>{hint}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  )
}
