/**
 * webui — 凭据配置弹窗（自绘，z-index 高于工作台 6000，避免被覆盖）。
 */
import { useState } from 'react'

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 7000, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(8,10,14,.5)', backdropFilter: 'blur(2px)',
}
const cardStyle: React.CSSProperties = {
  width: 420, maxWidth: 'calc(100vw - 48px)', borderRadius: 16, overflow: 'hidden',
  background: 'var(--dsw-alias-bg-layer-2)', boxShadow: '0 24px 64px rgba(0,0,0,.5)',
  border: '1px solid var(--dsw-alias-border-l1)',
}
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 16px', borderBottom: '1px solid var(--dsw-alias-border-l1)',
  fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)',
}
const bodyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: 13, borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
}
const btnBase: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)',
  background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
}

export function CredentialModal({ providerName, onClose, onSave }: {
  providerName: string; onClose: () => void; onSave: (value: string) => Promise<void>
}): JSX.Element {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <span>配置 {providerName} 凭据</span>
          <button type="button" aria-label="关闭" onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: 15 }}>✕</button>
        </div>
        <div style={bodyStyle}>
          <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>输入 API Key（仅 SENSENOVA_* 引用可写，存于安全凭据存储）</div>
          <input type="password" value={value} onChange={e => setValue(e.target.value)} placeholder="API Key" style={inputStyle} />
          {error && <div style={{ fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} style={btnBase}>取消</button>
            <button type="button" disabled={value.trim() === '' || saving}
              onClick={async () => {
                setSaving(true); setError(null)
                try { await onSave(value.trim()); onClose() } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
              }}
              style={{ ...btnBase, background: saving ? 'var(--dsw-alias-border-l2)' : 'var(--dsw-alias-brand-primary)', color: '#fff', border: 'none', opacity: value.trim() === '' ? 0.6 : 1 }}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
