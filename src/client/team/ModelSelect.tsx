/**
 * team — 模型下拉（provider 分组 + 可选「继承团队默认」首项）。
 *
 * 规格对齐官方 ModelsSection 的 .selectInput（32px 高、8px 圆角、自绘 chevron，
 * 见 styles.ts 的 .team-select）。
 */

import type { ModelBinding, ProviderView } from './types.ts'
import { bindingFromValue, bindingValue, providerOptions } from './util.ts'

export interface ModelSelectProps {
  /** 当前值；null = 继承（inheritLabel 提供时显示为首项）。 */
  value: ModelBinding | null
  providers: readonly ProviderView[]
  onChange: (next: ModelBinding | null) => void
  /** 提供时首项为「继承…」，选中它写回 null。 */
  inheritLabel?: string
  /** 未配置任何供应商时的占位提示。 */
  emptyLabel?: string
  disabled?: boolean
  grow?: boolean
  ariaLabel?: string
}

/** 渲染模型下拉。 */
export function ModelSelect({
  value, providers, onChange, inheritLabel, emptyLabel = '（未配置供应商）', disabled, grow, ariaLabel,
}: ModelSelectProps): JSX.Element {
  const groups = providerOptions(providers)
  const current = bindingValue(value)
  // 当前值不在枚举里（供应商被删/改名）时补一个「失效」项，避免静默变成第一项。
  const known = groups.some(group => group.options.some(option => option.value === current))
  return (
    <select
      className={grow === true ? 'team-select team-select-grow' : 'team-select'}
      value={current}
      disabled={disabled === true}
      aria-label={ariaLabel ?? '选择模型'}
      onChange={(event) => { onChange(bindingFromValue(event.target.value)) }}
    >
      {inheritLabel !== undefined ? <option value="">{inheritLabel}</option> : null}
      {inheritLabel === undefined && current === '' ? <option value="">（未设置）</option> : null}
      {!known && current !== '' ? <option value={current}>{`${current}（当前配置中不存在）`}</option> : null}
      {groups.length === 0 ? <option value="" disabled>{emptyLabel}</option> : null}
      {groups.map(group => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
