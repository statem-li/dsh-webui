/**
 * ImageModelBlock — 生图模型区块。
 * 交互：两级下拉——先选供应商，再选该供应商下的模型。
 * 复用 dsh-vision-helper 的 HTTP 接口：/api/image-gen/snapshot + /config。
 */
import { useEffect, useState } from 'react'

interface ModelInfo { id: string; name: string; outputs?: string[] }
interface ProviderInfo { id: string; name: string; models: ModelInfo[] }

const BLOCK_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--dsw-alias-label-primary)' }
const HINT: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 10 }
const ROW: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }
/* 官方 .input/.selectInput 规格：32px 高、14px 字、8px 圆角、自定义 chevron。 */
const SELECT: React.CSSProperties = {
  boxSizing: 'border-box',
  height: 32,
  padding: '0 32px 0 10px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\'%3E%3Cpath d=\'M3 4.5L6 7.5L9 4.5\' stroke=\'%2381858C\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  backgroundSize: '12px 12px',
  appearance: 'none',
  color: 'var(--dsw-alias-label-primary)', fontSize: 14, lineHeight: '22px', cursor: 'pointer',
}
const ACTIVE_HINT: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }

function isImageModel(m: ModelInfo): boolean {
  return Array.isArray(m.outputs) && m.outputs.includes('image')
}

export function ImageModelBlock(): React.ReactElement {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [active, setActive] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/image-gen/snapshot', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: any) => {
        if (!alive) return
        if (d && d.ok !== false) {
          setProviders(d.providers || [])
          setActive(d.imageActive || '')
        } else {
          setError((d && d.error) || '加载失败')
        }
      })
      .catch(() => { if (alive) setError('接口不可用') })
    return () => { alive = false }
  }, [])

  const slash = active.indexOf('/')
  const activeProvider = slash > 0 ? active.slice(0, slash) : ''
  const activeModel = slash > 0 ? active.slice(slash + 1) : ''

  const currentProvider = selectedProvider || activeProvider || providers[0]?.id || ''
  const currentModels = providers.find(p => p.id === currentProvider)?.models ?? []
  const modelValue = currentProvider === activeProvider ? activeModel : ''

  const pick = (key: string): void => {
    if (saving) return
    setSaving(true)
    fetch('/api/image-gen/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageActive: key }),
    })
      .then((r) => r.json())
      .then((d: any) => { if (d && d.ok) setActive(key) })
      .finally(() => setSaving(false))
  }

  return (
    <div>
      <div style={BLOCK_TITLE}>生图模型</div>
      <div style={HINT}>generate_image 使用的模型（提示词 → 图片生成）。标注「生图」的模型声明了图片生成能力（可在供应商的模型设置中勾选「支持生图」）。</div>
      {error && <div style={{ color: 'var(--dsw-alias-state-error-primary)', marginBottom: 8 }}>{error}</div>}
      {providers.length === 0 && !error
        ? <div style={{ color: 'var(--dsw-alias-label-tertiary)' }}>加载中…</div>
        : (
          <>
            <div style={ROW}>
              <select
                style={SELECT}
                value={currentProvider}
                aria-label="供应商"
                onChange={(e) => { setSelectedProvider(e.target.value) }}
              >
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name || p.id}</option>
                ))}
              </select>
              <select
                style={SELECT}
                value={modelValue}
                aria-label="模型"
                disabled={saving || currentModels.length === 0}
                onChange={(e) => { if (e.target.value) pick(`${currentProvider}/${e.target.value}`) }}
              >
                <option value="">{currentModels.length === 0 ? '无模型' : '选择模型'}</option>
                {currentModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name || m.id}{isImageModel(m) ? '（生图）' : ''}</option>
                ))}
              </select>
            </div>
            {active && <div style={ACTIVE_HINT}>当前：{active}</div>}
          </>
        )}
    </div>
  )
}
