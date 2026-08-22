/**
 * VisionModelBlock — 辅助视觉模型区块。
 * 可视化编辑「降级方案」：有序列表（第一个为当前使用），支持上移/下移/删除/添加。
 * 复用 dsh-vision-helper 的 HTTP 接口：/api/vision-helper/providers + /config。
 */
import { useEffect, useState } from 'react'

interface ModelInfo { id: string; name: string; input: string[] | null }
interface ProviderInfo { id: string; name: string; models: ModelInfo[] }
interface VisionItem { provider: string; model: string }

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
const SMALL_BTN: React.CSSProperties = {
  padding: '2px 9px', fontSize: 12, lineHeight: '18px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-2, transparent)',
  color: 'var(--dsw-alias-label-primary)',
}
const SMALL_BTN_DISABLED: React.CSSProperties = { ...SMALL_BTN, opacity: 0.45, cursor: 'default' }
const LIST_ROW: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0' }
const TAG: React.CSSProperties = { fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }

function isVisionModel(m: ModelInfo): boolean {
  return Array.isArray(m.input) && m.input.includes('image')
}

function keyOf(item: VisionItem): string { return `${item.provider}/${item.model}` }

export function VisionModelBlock(): React.ReactElement {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [list, setList] = useState<VisionItem[]>([])
  const [active, setActive] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [addProvider, setAddProvider] = useState('')
  const [addModel, setAddModel] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/vision-helper/providers', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: any) => {
        if (!alive) return
        if (d && d.ok !== false) {
          setProviders(d.providers || [])
          setActive(d.active || '')
          setList(Array.isArray(d.visionList) ? d.visionList : [])
        } else {
          setError((d && d.error) || '加载失败')
        }
      })
      .catch(() => { if (alive) setError('接口不可用') })
    return () => { alive = false }
  }, [])

  const addModels = providers.find(p => p.id === addProvider)?.models ?? []

  const save = (next: VisionItem[], activeKey?: string): void => {
    if (saving) return
    setSaving(true)
    setError(null)
    fetch('/api/vision-helper/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vision: next, visionActive: activeKey }),
    })
      .then((r) => r.json())
      .then((d: any) => {
        if (d && d.ok) { setList(next); setActive(d.active || '') }
        else setError((d && d.error) || '保存失败')
      })
      .catch(() => setError('保存请求失败'))
      .finally(() => setSaving(false))
  }

  const move = (index: number, dir: -1 | 1): void => {
    const target = index + dir
    if (target < 0 || target >= list.length) return
    const next = list.slice()
    const tmp = next[index]!
    next[index] = next[target]!
    next[target] = tmp
    save(next)
  }

  const remove = (index: number): void => {
    save(list.filter((_, i) => i !== index))
  }

  const add = (): void => {
    if (!addProvider || !addModel) return
    if (list.some(x => x.provider === addProvider && x.model === addModel)) { setError('该模型已在降级列表中'); return }
    save([...list, { provider: addProvider, model: addModel }])
    setAddModel('')
  }

  const modelName = (item: VisionItem): string => {
    const p = providers.find(x => x.id === item.provider)
    const m = p?.models.find(x => x.id === item.model)
    return (m && m.name) || item.model
  }

  return (
    <div>
      <div style={BLOCK_TITLE}>辅助视觉模型</div>
      <div style={HINT}>vision_describe 使用的模型（图片→文本描述）。从上到下依次尝试，第一个成功的即返回（可自定义降级方案）。标注「视觉」的模型声明了图片输入；对话模型是否支持识图，可在上方供应商的模型设置中开启「识图」。</div>
      {error && <div style={{ color: 'var(--dsw-alias-state-error-primary)', marginBottom: 8 }}>{error}</div>}
      {providers.length === 0 && !error
        ? <div style={{ color: 'var(--dsw-alias-label-tertiary)' }}>加载中…</div>
        : (
          <>
            {list.length === 0
              ? <div style={{ color: 'var(--dsw-alias-label-tertiary)', marginBottom: 8 }}>尚未配置降级方案，请从下方添加模型。</div>
              : list.map((item, index) => (
                <div key={keyOf(item) + '-' + index} style={LIST_ROW}>
                  <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', width: 18, flex: 'none' }}>{index + 1}</span>
                  <span style={TAG}>{item.provider}/{item.model}</span>
                  <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{modelName(item)}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flex: 'none' }}>
                    <button style={saving || index === 0 ? SMALL_BTN_DISABLED : SMALL_BTN} disabled={saving || index === 0} onClick={() => move(index, -1)}>↑</button>
                    <button style={saving || index === list.length - 1 ? SMALL_BTN_DISABLED : SMALL_BTN} disabled={saving || index === list.length - 1} onClick={() => move(index, 1)}>↓</button>
                    <button style={saving ? SMALL_BTN_DISABLED : SMALL_BTN} disabled={saving} onClick={() => remove(index)}>✕</button>
                  </div>
                </div>
              ))}
            <div style={{ ...ROW, marginTop: 10 }}>
              <select style={SELECT} aria-label="添加供应商" value={addProvider}
                onChange={(e) => { setAddProvider(e.target.value); setAddModel('') }}>
                <option value="">选择供应商</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
              </select>
              <select style={SELECT} aria-label="添加模型" value={addModel}
                disabled={!addProvider || addModels.length === 0}
                onChange={(e) => setAddModel(e.target.value)}>
                <option value="">{addModels.length === 0 ? '无模型' : '选择模型'}</option>
                {addModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name || m.id}{isVisionModel(m) ? '（视觉）' : ''}</option>
                ))}
              </select>
              <button style={saving || !addProvider || !addModel ? SMALL_BTN_DISABLED : SMALL_BTN}
                disabled={saving || !addProvider || !addModel} onClick={add}>+ 添加</button>
            </div>
            {active && <div style={ACTIVE_HINT}>当前生效：{active}</div>}
          </>
        )}
    </div>
  )
}
