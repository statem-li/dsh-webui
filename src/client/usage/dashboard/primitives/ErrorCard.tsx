export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div style={{ border: '1px solid var(--dsw-alias-state-error-primary)', borderRadius: 12, padding: 20, color: 'var(--dsw-alias-state-error-primary)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span>⚠ {message}</span>
      {onRetry && <button type="button" onClick={onRetry} style={{ marginLeft: 'auto', border: '1px solid currentColor', borderRadius: 6, padding: '4px 12px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 }}>重试</button>}
    </div>
  )
}
