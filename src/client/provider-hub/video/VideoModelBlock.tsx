/**
 * VideoModelBlock — 生视频模型区块。
 *
 * 交互：两级下拉——先选供应商，再选该供应商下的模型；选中即保存。
 * 版式走 {@link ../blocks/shared.tsx} 的统一外壳：标题行带当前生效胶囊、
 * 说明默认折叠，两个下拉并排在同一填充面里各带小标签。
 *
 * 复用 dsh-vision-helper 的 HTTP 接口：/api/video-gen/snapshot + /config。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BlockShell, FILL_PANEL, SelectField, StateHint } from '../blocks/shared.tsx'

interface ModelInfo { id: string; name: string; outputs?: string[] }
interface ProviderInfo { id: string; name: string; models: ModelInfo[] }

const DESCRIPTION = 'generate_video 使用的模型（提示词 → 视频生成，异步任务自动轮询）。标注「生视频」的模型声明了视频生成能力，可在供应商的模型设置中开启「生视频」。'

/** 该模型是否声明了生视频能力（outputs 含 video）。 */
function isCapable(m: ModelInfo): boolean {
  return Array.isArray(m.outputs) && m.outputs.includes('video')
}

export function VideoModelBlock(): ReactNode {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [active, setActive] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/video-gen/snapshot', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: any) => {
        if (!alive) return
        if (d && d.ok !== false) {
          setProviders(d.providers || [])
          setActive(d.videoActive || '')
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
    fetch('/api/video-gen/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ videoActive: key }),
    })
      .then((r) => r.json())
      .then((d: any) => { if (d && d.ok) setActive(key) })
      .finally(() => setSaving(false))
  }

  return (
    <BlockShell title="生视频模型" activeText={active} description={DESCRIPTION}>
      {error !== null ? <StateHint text={error} tone="error" /> : null}
      {providers.length === 0 && error === null
        ? <StateHint text="加载中…" />
        : (
          <div style={FILL_PANEL}>
            <SelectField label="供应商" value={currentProvider} onChange={setSelectedProvider}>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
            </SelectField>
            <SelectField
              label="模型"
              value={modelValue}
              width={240}
              disabled={saving || currentModels.length === 0}
              onChange={(v) => { if (v !== '') pick(`${currentProvider}/${v}`) }}
            >
              <option value="">{currentModels.length === 0 ? '无可用模型' : '选择模型'}</option>
              {currentModels.map(m => (
                <option key={m.id} value={m.id}>{m.name || m.id}{isCapable(m) ? '（生视频）' : ''}</option>
              ))}
            </SelectField>
          </div>
        )}
    </BlockShell>
  )
}
