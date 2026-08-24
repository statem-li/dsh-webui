/**
 * VisionModelBlock — 辅助视觉模型区块。
 *
 * 可视化编辑「降级方案」：有序行卡片列表（第一条为首选，向下依次回退），
 * 支持上移/下移/删除/添加。版式走 {@link ../blocks/shared.tsx} 的统一外壳：
 * 标题行带当前生效胶囊 + 说明默认折叠，列表用行卡片而非裸文本行。
 *
 * 复用 dsh-vision-helper 的 HTTP 接口：/api/vision-helper/providers + /config。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  BlockShell, CAPSULE_BTN, CAPSULE_BTN_DISABLED, FILL_PANEL, IconButton,
  MONO, ROW_CARD, SelectField, StateHint,
} from '../blocks/shared.tsx'

interface ModelInfo { id: string; name: string; input: string[] | null }
interface ProviderInfo { id: string; name: string; models: ModelInfo[] }
interface VisionItem { provider: string; model: string }

const DESCRIPTION = 'vision_describe 使用的模型（图片 → 文本描述）。从上到下依次尝试，'
  + '第一个成功的即返回，可自定义降级方案。标注「视觉」的模型声明了图片输入；'
  + '对话模型是否支持识图，可在上方供应商的模型设置中开启「识图」。'

function isVisionModel(m: ModelInfo): boolean {
  return Array.isArray(m.input) && m.input.includes('image')
}

function keyOf(item: VisionItem): string { return `${item.provider}/${item.model}` }

export function VisionModelBlock(): ReactNode {
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

  const remove = (index: number): void => { save(list.filter((_, i) => i !== index)) }

  const add = (): void => {
    if (!addProvider || !addModel) return
    if (list.some(x => x.provider === addProvider && x.model === addModel)) {
      setError('该模型已在降级列表中')
      return
    }
    save([...list, { provider: addProvider, model: addModel }])
    setAddModel('')
  }

  const modelName = (item: VisionItem): string => {
    const p = providers.find(x => x.id === item.provider)
    const m = p?.models.find(x => x.id === item.model)
    return (m && m.name) || item.model
  }

  const canAdd = !saving && addProvider !== '' && addModel !== ''

  return (
    <BlockShell title="辅助视觉模型" activeText={active} description={DESCRIPTION}>
      {error !== null ? <StateHint text={error} tone="error" /> : null}
      {providers.length === 0 && error === null
        ? <StateHint text="加载中…" />
        : (
          <>
            {list.length === 0
              ? <StateHint text="尚未配置降级方案，从下方添加第一个模型。" />
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {list.map((item, index) => (
                    <div key={keyOf(item) + '-' + index} style={ROW_CARD}>
                      <span style={{
                        flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 600,
                        background: index === 0
                          ? 'var(--dsw-alias-state-business-primary, #4176e6)'
                          : 'var(--dsw-alias-bg-module-platform, #f2f3f5)',
                        color: index === 0 ? '#fff' : 'var(--dsw-alias-label-tertiary)',
                      }}>{index + 1}</span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                        <span style={{
                          fontSize: 13, lineHeight: '20px', fontWeight: 500,
                          color: 'var(--dsw-alias-label-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{modelName(item)}</span>
                        <span style={{
                          ...MONO, color: 'var(--dsw-alias-label-tertiary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{keyOf(item)}</span>
                      </span>
                      {index === 0
                        ? (
                          <span style={{
                            flexShrink: 0, padding: '1px 6px', borderRadius: 4,
                            fontSize: 11, lineHeight: '16px',
                            border: '1px solid var(--dsw-alias-border-l3, #c9cdd4)',
                            color: 'var(--dsw-alias-label-secondary)',
                          }}>首选</span>
                        )
                        : null}
                      <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
                        <IconButton label="上移" glyph="↑" disabled={saving || index === 0} onClick={() => { move(index, -1) }} />
                        <IconButton label="下移" glyph="↓" disabled={saving || index === list.length - 1} onClick={() => { move(index, 1) }} />
                        {/* 最后一条不可移除：host 拒绝空降级列表（400），点下去只会
                            冒出「vision 列表为空或格式无效」这种无法行动的报错。 */}
                        <IconButton
                          label={list.length === 1 ? '至少保留一个模型' : '移除'}
                          glyph="✕"
                          danger
                          disabled={saving || list.length === 1}
                          onClick={() => { remove(index) }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              )}

            <div style={FILL_PANEL}>
              <SelectField
                label="供应商"
                value={addProvider}
                onChange={(v) => { setAddProvider(v); setAddModel('') }}
              >
                <option value="">选择供应商</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
              </SelectField>
              <SelectField
                label="模型"
                value={addModel}
                width={220}
                disabled={addProvider === '' || addModels.length === 0}
                onChange={setAddModel}
              >
                <option value="">{addModels.length === 0 ? '无可用模型' : '选择模型'}</option>
                {addModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name || m.id}{isVisionModel(m) ? '（视觉）' : ''}</option>
                ))}
              </SelectField>
              <button
                type="button"
                className="dsh-webui-capsule-btn"
                style={canAdd ? CAPSULE_BTN : CAPSULE_BTN_DISABLED}
                disabled={!canAdd}
                onClick={add}
              >
                + 添加
              </button>
            </div>
          </>
        )}
    </BlockShell>
  )
}
