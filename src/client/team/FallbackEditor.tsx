/**
 * team — 备用模型链编辑器（团队级 / 角色级共用）。
 *
 * 语义：主模型失败且失败类型属于「换模型有救」（鉴权、额度、模型不存在、限流、
 * 上游 5xx、超时、网络）时，引擎按本链顺序尝试；内容策略拒绝与用户取消不换模型。
 * 角色留空 = 继承团队备用链；团队留空 = 不降级。
 *
 * 交互：一行一个备用模型（下拉 + 删除），最多 3 个；选空即删除该行。
 * 动效：新增行淡入 + 轻微上移（用户偏好带动效），删除即时。
 */

import { ModelSelect } from './ModelSelect.tsx'
import type { ModelBinding, ProviderView } from './types.ts'

/** 备用链上限（与 host MAX_FALLBACK_MODELS 一致）。 */
const MAX_FALLBACK = 3

export interface FallbackEditorProps {
  value: ModelBinding[] | undefined
  providers: readonly ProviderView[]
  /** 空数组回写 undefined（不写进编制文件）。 */
  onChange: (next: ModelBinding[] | undefined) => void
  /** 角色级编辑器传团队链，用于「留空＝继承」的提示文案。 */
  inheritFrom?: ModelBinding[] | undefined
  disabled?: boolean
}

/** 渲染备用模型链编辑器。 */
export function FallbackEditor({ value, providers, onChange, inheritFrom, disabled }: FallbackEditorProps): JSX.Element {
  const list = value ?? []

  const commit = (next: ModelBinding[]): void => {
    onChange(next.length > 0 ? next : undefined)
  }

  const patchAt = (index: number, binding: ModelBinding | null): void => {
    const next = [...list]
    if (binding === null) next.splice(index, 1)
    else next[index] = binding
    commit(next)
  }

  const inheritNote = inheritFrom !== undefined && inheritFrom.length > 0
    ? `留空＝继承团队备用链（${inheritFrom.map(item => item.model).join(' → ')}）`
    : inheritFrom !== undefined
      ? '留空＝继承团队备用链（团队未配置 → 不降级）'
      : '留空＝主模型失败时不降级，直接按失败处理'

  return (
    <div className="team-fbchain">
      <div className="team-fbchain-head">
        <span>备用模型链</span>
        <span className="team-fbchain-hint">{inheritNote}</span>
      </div>
      {list.map((item, index) => (
        <div className="team-fbchain-row" key={`${item.provider}/${item.model}-${index}`}>
          <span className="team-fbchain-no" aria-hidden="true">{index + 1}</span>
          <ModelSelect
            value={item}
            providers={providers}
            grow
            disabled={disabled}
            ariaLabel={`备用模型 ${index + 1}`}
            onChange={next => patchAt(index, next)}
          />
          <button
            type="button"
            className="team-icon-btn"
            aria-label={`删除备用模型 ${index + 1}`}
            title="删除这一项"
            disabled={disabled}
            onClick={() => patchAt(index, null)}
          >×</button>
        </div>
      ))}
      {list.length < MAX_FALLBACK ? (
        <div className="team-fbchain-row team-fbchain-add">
          <span className="team-fbchain-no" aria-hidden="true">+</span>
          <ModelSelect
            value={null}
            providers={providers}
            inheritLabel={list.length === 0 ? '添加备用模型…' : '再加一个备用…'}
            grow
            disabled={disabled}
            ariaLabel="添加备用模型"
            onChange={(next) => { if (next !== null) commit([...list, next]) }}
          />
        </div>
      ) : (
        <div className="team-fbchain-hint">已达上限 {MAX_FALLBACK} 个。</div>
      )}
    </div>
  )
}
