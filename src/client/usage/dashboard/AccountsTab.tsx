import { useCallback, useEffect, useState } from 'react'
import { usageApi, type ProviderInfo } from './api'
import { ProviderGroup } from './primitives/ProviderGroup'
import { CredentialModal } from './primitives/CredentialModal'
import { ErrorCard } from './primitives/ErrorCard'

export interface AccountsTabProps { refreshTick?: number }

/**
 * 余额/配额：DSH 官方列表风格（行 + 分隔线，无卡片网格）。
 * 无余额/订阅数据的行由 ProviderGroup 自行隐藏并上报可见性，
 * 全部隐藏时显示空态提示；未配置凭据的行保留「配置凭据」入口。
 */
export function AccountsTab({ refreshTick }: AccountsTabProps): JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [credentialFor, setCredentialFor] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // provider.id → 可见性（true=有数据；false=空行已隐藏；未上报=加载中，暂按可见处理）
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})

  const load = (): void => {
    setError(null)
    usageApi.providers().then(p => {
      if (p.ok !== true) throw new Error('供应商数据加载失败')
      setProviders(p.providers)
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(() => { load() }, [refreshTick])

  const report = useCallback((id: string) => (visible: boolean): void => {
    setVisibility(prev => (prev[id] === visible ? prev : { ...prev, [id]: visible }))
  }, [])

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

  // 加载中（未上报）的行按可见处理；isLast 随可见性收敛。
  const visibleIds = providers.filter(p => visibility[p.id] !== false).map(p => p.id)
  const lastVisibleId = visibleIds[visibleIds.length - 1]
  const allReported = providers.length > 0 && providers.every(p => visibility[p.id] !== undefined)
  const noneVisible = allReported && visibleIds.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={refreshAll} disabled={refreshing || providers.length === 0}
          style={{ padding: '5px 14px', fontSize: 12, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: refreshing ? 'default' : 'pointer' }}>
          {refreshing ? '刷新中…' : '全部刷新'}
        </button>
      </div>

      {providers.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '24px 0', textAlign: 'center' }}>加载供应商…</div>
      ) : noneVisible ? (
        <div style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-1)', padding: '32px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-primary)', marginBottom: 4 }}>暂无可展示的余额/订阅数据</div>
          <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>配置凭据或使用后，这里会出现对应供应商的余额与配额。</div>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-1)', overflow: 'hidden' }}>
          {providers.map(p => (
            <ProviderGroup
              key={p.id}
              provider={p}
              onRequireCredential={setCredentialFor}
              refreshKey={refreshKey}
              isLast={p.id === lastVisibleId}
              onVisibility={report(p.id)}
            />
          ))}
        </div>
      )}

      {credentialFor !== null && (
        <CredentialModal providerName={providers.find(p => p.id === credentialFor)?.displayName ?? credentialFor}
          onClose={() => setCredentialFor(null)} onSave={saveCredential} />
      )}
    </div>
  )
}
