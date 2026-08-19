import { useEffect, useState, type CSSProperties } from 'react'
import { usageApi, type AccountSnapshot, type ProviderInfo } from '../api'
import { relativeTime } from '../format'
import { alertColor } from '../theme'
import { ProgressBar } from '../charts/ProgressBar'

/**
 * 供应商余额/订阅行（DSH 官方列表风格：无卡片网格，行 + 分隔线）。
 *
 * 无任何余额/订阅数据（无 windows、无 plan、无告警、无错误）时整行隐藏，
 * 通过 onVisibility 上报可见性；未配置凭据的行保留「配置凭据」入口。
 */

const rowStyle = (isLast: boolean): CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 16px',
  borderBottom: isLast ? 'none' : '1px solid var(--dsw-alias-border-l1)',
})

const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
}

const nameStyle: CSSProperties = {
  fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontSize: 13,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

const modeTagStyle: CSSProperties = {
  fontSize: 11, color: 'var(--dsw-alias-label-secondary)',
  background: 'var(--dsw-alias-interactive-bg-hover)',
  borderRadius: 4, padding: '1px 6px', flex: 'none',
}

const metaStyle: CSSProperties = {
  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flex: 'none',
}

const refreshButtonStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 5,
  padding: '2px 10px', background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer', fontSize: 11,
}

const bodyStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  paddingLeft: 18, // 对齐状态灯之后的名称
  minWidth: 0,
}

const windowHeaderStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3,
  color: 'var(--dsw-alias-label-secondary)', gap: 8,
}

const planStyle: CSSProperties = {
  fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
}

const credentialButtonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '5px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-button-ghost-active-fill)',
  color: 'var(--dsw-alias-label-primary)',
}

const alertStyle = (level: 'critical' | 'warning'): CSSProperties => ({
  fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 5, flex: 'none',
  background: level === 'critical'
    ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)'
    : 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)',
  color: alertColor(level),
})

export interface ProviderGroupProps {
  provider: ProviderInfo
  onRequireCredential: (id: string) => void
  refreshKey: number
  /** 是否为当前最后一个可见行（决定是否画底部分隔线）。 */
  isLast: boolean
  /** 可见性上报：空行隐藏时回调 false。 */
  onVisibility?: (visible: boolean) => void
}

export function ProviderGroup({ provider, onRequireCredential, refreshKey, isLast, onVisibility }: ProviderGroupProps): JSX.Element | null {
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

  const needsCredential = provider.status === 'unauthorized' || provider.status === 'not-configured'
  const plan = account?.plan
  const hasPlan = typeof plan === 'string' && plan.trim() !== '' && plan.trim() !== '—' && plan.trim() !== '-'
  const hasWindows = (account?.windows?.length ?? 0) > 0
  const hasAlert = level === 'critical' || level === 'warning'

  // 已拿到响应且确实没有可展示内容 → 整行隐藏（loading/错误/未配置不隐藏）。
  const isEmpty = account !== null && !needsCredential && !error && !hasWindows && !hasPlan && !hasAlert

  useEffect(() => {
    onVisibility?.(!isEmpty)
  }, [isEmpty, onVisibility])

  if (isEmpty) return null

  return (
    <div style={rowStyle(isLast)}>
      <div style={headerStyle}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: statusColor, flex: 'none' }} />
        <span style={nameStyle}>{provider.displayName}</span>
        {provider.accountMode !== null && <span style={modeTagStyle}>{provider.accountMode === 'subscription' ? '订阅' : '余额'}</span>}
        {hasAlert && <span style={alertStyle(level as 'critical' | 'warning')}>⚠ {level === 'critical' ? `剩余 ${account?.alert?.value ?? provider.alert?.value ?? 0}%` : `剩余 ${account?.alert?.value ?? provider.alert?.value ?? 0}%`}</span>}
        <span style={metaStyle}>
          {!needsCredential && <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>更新于 {account?.fetchedAt ? relativeTime(account.fetchedAt) : '—'}</span>}
          {!needsCredential && <button type="button" onClick={() => load(true)} style={refreshButtonStyle}>刷新</button>}
        </span>
      </div>

      <div style={bodyStyle}>
        {needsCredential ? (
          <button type="button" onClick={() => onRequireCredential(provider.id)} style={credentialButtonStyle}>配置凭据</button>
        ) : loading ? (
          <div style={{ height: 5, borderRadius: 3, background: 'var(--dsw-alias-border-l2)', overflow: 'hidden', maxWidth: 480 }}>
            <div style={{ width: '40%', height: '100%', background: 'var(--dsw-alias-border-l1)', animation: 'pulse 1.2s infinite' }} />
          </div>
        ) : error ? (
          <div style={{ fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{error}</span>
            <button type="button" onClick={() => load(true)} style={{ border: 'none', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', fontSize: 12, flex: 'none' }}>重试</button>
          </div>
        ) : account === null ? (
          <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>等待首次获取…</div>
        ) : hasWindows ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560 }}>
            {account.windows!.map(w => (
              <div key={w.kind}>
                <div style={windowHeaderStyle}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{w.kind}</span>
                  <span style={{ flex: 'none' }}>已用 {w.usedPercent}%{w.resetsAt ? ` · ${relativeTime(new Date(w.resetsAt).getTime())}重置` : ''}</span>
                </div>
                <ProgressBar percent={w.remainingPercent} height={4} />
              </div>
            ))}
          </div>
        ) : (
          <div style={planStyle}>plan: <span style={{ color: 'var(--dsw-alias-label-primary)' }}>{plan}</span></div>
        )}
      </div>
    </div>
  )
}
