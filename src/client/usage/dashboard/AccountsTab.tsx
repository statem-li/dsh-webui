import { useEffect, useState } from 'react'
import { usageApi, type ProviderInfo } from './api'
import { ProviderCard } from './primitives/ProviderCard'
import { CredentialModal } from './primitives/CredentialModal'
import { ErrorCard } from './primitives/ErrorCard'

export interface AccountsTabProps { refreshTick?: number }

export function AccountsTab({ refreshTick }: AccountsTabProps): JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [credentialFor, setCredentialFor] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = (): void => {
    setError(null)
    usageApi.providers().then(p => {
      if (p.ok !== true) throw new Error('供应商数据加载失败')
      setProviders(p.providers)
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(() => { load() }, [refreshTick])

  const saveCredential = async (value: string): Promise<void> => {
    const res = await fetch('/api/usage-stats/credentials', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ref: 'SENSENOVA_API_KEY', value }),
    })
    const payload = await res.json()
    if (!res.ok || payload.ok !== true) throw new Error(payload?.message ?? `HTTP ${res.status}`)
    load()
  }

  const refreshAll = (): void => {
    setRefreshing(true); setError(null)
    Promise.all(providers.map(p => usageApi.account(p.id, true).catch(() => null)))
      .finally(() => { setRefreshing(false); load(); setRefreshKey(k => k + 1) })
  }

  if (error) {
    return <ErrorCard message={error} onRetry={load} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={refreshAll} disabled={refreshing}
          style={{ padding: '6px 14px', fontSize: 12, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: refreshing ? 'default' : 'pointer' }}>
          {refreshing ? '刷新中…' : '全部刷新'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
        {providers.map(p => <ProviderCard key={p.id} provider={p} onRequireCredential={setCredentialFor} refreshKey={refreshKey} />)}
      </div>
      {credentialFor !== null && (
        <CredentialModal providerName={providers.find(p => p.id === credentialFor)?.displayName ?? credentialFor}
          onClose={() => setCredentialFor(null)} onSave={saveCredential} />
      )}
    </div>
  )
}
