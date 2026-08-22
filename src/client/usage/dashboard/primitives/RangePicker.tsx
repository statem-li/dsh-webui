/**
 * RangePicker — 用量查询范围选择器（趋势/明细 tab 共用，由 Workbench 持有状态）。
 *
 * 预设：今日 / 昨日 / 近7天 / 近30天 / 本月 / 上月 / 今年 / 全部 / 自定义；
 * 自定义展开起止两个 date input。胶囊按钮组风格对齐 DSH 官方控件。
 */

import { resolveRange, type DateRange, type RangePreset } from '../range'

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
  background: active ? 'var(--dsw-alias-button-ghost-active-fill)' : 'transparent',
  color: active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)',
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
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {PRESETS.map(p => (
        <button key={p.key} type="button" style={btn(preset === p.key)} onClick={() => onChangePreset(p.key)}>
          {p.label}
        </button>
      ))}
      {preset === 'custom' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            type="date"
            value={range.start}
            max={range.end}
            aria-label="开始日期"
            style={inputStyle}
            onChange={e => { if (e.target.value !== '') onChangeCustom({ start: e.target.value, end: range.end < e.target.value ? e.target.value : range.end }) }}
          />
          <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>~</span>
          <input
            type="date"
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
