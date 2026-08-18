import { useEffect, useState } from 'react'
import { usageApi, type AccountSnapshot, type ProviderInfo } from '../api'
import { relativeTime } from '../format'
import { alertColor } from '../theme'
import { ProgressBar } from '../charts/ProgressBar'

export function ProviderCard({ provider, onRequireCredential, refreshKey }: { provider: ProviderInfo; onRequireCredential: (id: string) => void; refreshKey: number }): JSX.Element {
  const [account, setAccount] = useState<AccountSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (refresh = false): void => {
    setLoading(true); setError(null)
    usageApi.account(provider.id, refresh).then(p => {
      if (p.ok) setAccount(p.account); else setError(p.message ?? '获取失败')
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [provider.id, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const level = account?.alert?.level ?? provider.alert?.level ?? 'unknown'
  const statusColor = provider.status === 'ok' ? 'var(--dsw-alias-state-success-primary)'
    : provider.status === 'critical' ? 'var(--dsw-alias-state-error-primary)'
    : provider.status === 'warning' ? 'var(--dsw-alias-state-warn-primary)'
    : 'var(--dsw-alias-label-tertiary)' // unauthorized / not-configured / pending

  return (
    <div style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: statusColor, flex: 'none' }} />
        <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{provider.displayName}</span>
        {provider.accountMode !== null && <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 4, padding: '1px 6px', flex: 'none' }}>{provider.accountMode === 'subscription' ? '订阅' : '余额'}</span>}
      </div>
      {(provider.status === 'unauthorized' || provider.status === 'not-configured') ? (
        <button type="button" onClick={() => onRequireCredential(provider.id)}
          style={{ padding: '6px 12px', fontSize: 12, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' }}>
          配置凭据
        </button>
      ) : loading ? (
        <div style={{ height: 6, borderRadius: 3, background: 'var(--dsw-alias-border-l2)', overflow: 'hidden' }}><div style={{ width: '40%', height: '100%', background: 'var(--dsw-alias-border-l1)', animation: 'pulse 1.2s infinite' }} /></div>
      ) : error ? (
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }}>{error} <button type="button" onClick={() => load(true)} style={{ border: 'none', background: 'transparent', color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' }}>重试</button></div>
      ) : account === null ? (
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>等待首次获取</div>
      ) : (
        <>
          {account.windows !== undefined && account.windows.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {account.windows.map(w => (
                <div key={w.kind}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3, color: 'var(--dsw-alias-label-secondary)', gap: 8 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{w.kind}</span>
                    <span style={{ flex: 'none' }}>已用 {w.usedPercent}%{w.resetsAt ? ` · ${relativeTime(new Date(w.resetsAt).getTime())}重置` : ''}</span>
                  </div>
                  <ProgressBar percent={w.remainingPercent} height={5} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>plan: {account.plan ?? '—'}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>
            <span>更新于 {account.fetchedAt ? relativeTime(account.fetchedAt) : '—'}</span>
            <button type="button" onClick={() => load(true)} style={{ border: 'none', background: 'transparent', color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer', fontSize: 11 }}>刷新</button>
          </div>
          {(level === 'critical' || level === 'warning') && (
            <div style={{ padding: '6px 10px', borderRadius: 6, background: level === 'critical' ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)' : 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)', color: alertColor(level), fontSize: 12 }}>
              {level === 'critical' ? `⚠ 剩余 ${account.alert?.value ?? provider.alert?.value ?? 0}%，即将耗尽` : `⚠ 剩余 ${account.alert?.value ?? provider.alert?.value ?? 0}%`}
            </div>
          )}
        </>
      )}
    </div>
  )
}
