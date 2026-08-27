/**
 * RangePicker — 用量查询范围选择器（趋势/明细 tab 共用，由 Workbench 持有状态）。
 *
 * 预设：今日 / 昨日 / 近7天 / 近30天 / 本月 / 上月 / 今年 / 全部 / 自定义；
 * 自定义展开起止两个 date input。胶囊按钮组风格对齐 DSH 官方控件。
 */

import { useEffect } from 'react'
import { resolveRange, type DateRange, type RangePreset } from '../range'

const STYLE_ID = 'dsh-usage-range-picker-styles'

/* ── 移动端：预设按钮与日期输入触碰目标 ≥44px，避免小胶囊难以点按。
    按钮是内联 style（padding 3px 10px，高约 24px），用 !important 压过；
    本块注释内容未写出「星号紧跟正斜杠」两字符序列。 ── */
const SHEET = `
@media (max-width: 767.98px) {
  .webui-range-btn { min-height: 44px; }
  .webui-range-input { height: 44px; }
}
`

/** 幂等注入移动端触碰样式；返回移除函数。 */
function ensureStyle(): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: '7d', label: '近7天' },
  { key: '30d', label: '近30天' },
  { key: 'month', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'year', label: '今年' },
  { key: 'all', label: '全部' },
  { key: 'custom', label: '自定义' },
]

const btn = (active: boolean): React.CSSProperties => ({
  padding: '3px 10px',
  fontSize: 12,
  lineHeight: '18px',
  borderRadius: 999,
  border: `1px solid ${active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l1)'}`,
  cursor: 'pointer',
  background: active ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)' : 'transparent',
  color: active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)',
  boxShadow: active ? '0 0 10px color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent)' : 'none',
  transition: 'background .22s cubic-bezier(.2,.8,.2,1), color .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s cubic-bezier(.2,.8,.2,1), border-color .22s cubic-bezier(.2,.8,.2,1)',
})

const inputStyle: React.CSSProperties = {
  height: 26,
  padding: '0 8px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'inherit',
  colorScheme: 'dark light',
}

export interface RangePickerProps {
  preset: RangePreset
  custom: DateRange | null
  onChangePreset: (preset: RangePreset) => void
  onChangeCustom: (range: DateRange) => void
}

export function RangePicker({ preset, custom, onChangePreset, onChangeCustom }: RangePickerProps): JSX.Element {
  const range = resolveRange(preset, custom).range
  useEffect(() => ensureStyle(), [])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {PRESETS.map(p => (
        <button key={p.key} type="button" className="webui-range-btn" style={btn(preset === p.key)} onClick={() => onChangePreset(p.key)}>
          {p.label}
        </button>
      ))}
      {preset === 'custom' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            type="date"
            className="webui-range-input"
            value={range.start}
            max={range.end}
            aria-label="开始日期"
            style={inputStyle}
            onChange={e => { if (e.target.value !== '') onChangeCustom({ start: e.target.value, end: range.end < e.target.value ? e.target.value : range.end }) }}
          />
          <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>~</span>
          <input
            type="date"
            className="webui-range-input"
            value={range.end}
            min={range.start}
            aria-label="结束日期"
            style={inputStyle}
            onChange={e => { if (e.target.value !== '') onChangeCustom({ start: range.start > e.target.value ? e.target.value : range.start, end: e.target.value }) }}
          />
        </span>
      )}
    </div>
  )
}
