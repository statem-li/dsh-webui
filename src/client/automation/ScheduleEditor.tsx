/**
 * automation — 执行计划编辑器（设计借鉴 openhanako 的 ScheduleEditor）。
 *
 * 五种模式：间隔执行 / 每天 / 每周 / 每月 / 单次；按模式渲染对应字段
 * （原生 time/datetime-local/date 输入，color-scheme 跟随主题），
 * 底部实时显示人类可读预览（「每天 09:00」「每周一 09:30」…）。
 */

import { schedulePreview, storedFromDraft, WEEKDAY_NAMES,
  type IntervalUnit,
  type ScheduleDraft,
  type ScheduleMode,
} from './schedule.ts'
import type { T } from './locales.ts'

const MODES: ScheduleMode[] = ['interval', 'daily', 'weekly', 'monthly', 'once']
const UNITS: IntervalUnit[] = ['minutes', 'hours', 'days']

function weekdayNames(): readonly string[] {
  try {
    return document.documentElement.lang.toLowerCase().split('-')[0] === 'en' ? WEEKDAY_NAMES.en : WEEKDAY_NAMES.zh
  } catch {
    return WEEKDAY_NAMES.zh
  }
}

export interface ScheduleEditorProps {
  draft: ScheduleDraft
  onChange: (draft: ScheduleDraft) => void
  t: T
}

/** 渲染执行计划编辑器（模式选择 + 动态字段 + 预览）。 */
export function ScheduleEditor({ draft, onChange, t }: ScheduleEditorProps): JSX.Element {
  const update = (patch: Partial<ScheduleDraft>): void => { onChange({ ...draft, ...patch }) }
  const days = weekdayNames()
  const modeLabel = (mode: ScheduleMode): string => t(`schedMode.${mode}` as never)

  return (
    <div className="auto-sched">
      <div className="auto-field">
        <label className="auto-field-label" htmlFor="auto-sched-mode">{t('schedLabel')}</label>
        <select
          id="auto-sched-mode"
          className="auto-select"
          value={draft.mode}
          onChange={event => { update({ mode: event.currentTarget.value as ScheduleMode }) }}
        >
          {MODES.map(mode => (
            <option key={mode} value={mode}>{modeLabel(mode)}</option>
          ))}
        </select>
      </div>

      {draft.mode === 'interval' && (
        <div className="auto-sched-row">
          <div className="auto-field auto-sched-grow">
            <label className="auto-field-label" htmlFor="auto-sched-interval">{t('schedEvery')}</label>
            <input
              id="auto-sched-interval"
              className="auto-input"
              type="number"
              min="1"
              step="1"
              value={draft.intervalValue}
              onChange={event => { update({ intervalValue: event.currentTarget.value }) }}
            />
          </div>
          <div className="auto-field">
            <label className="auto-field-label" htmlFor="auto-sched-unit">{t('schedUnit')}</label>
            <select
              id="auto-sched-unit"
              className="auto-select"
              value={draft.intervalUnit}
              onChange={event => { update({ intervalUnit: event.currentTarget.value as IntervalUnit }) }}
            >
              {UNITS.map(unit => (
                <option key={unit} value={unit}>{t(`schedUnit.${unit}` as never)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {draft.mode === 'daily' && (
        <div className="auto-field">
          <label className="auto-field-label" htmlFor="auto-sched-time">{t('schedTime')}</label>
          <input
            id="auto-sched-time"
            className="auto-input"
            type="time"
            value={draft.time}
            onChange={event => { update({ time: event.currentTarget.value }) }}
          />
        </div>
      )}

      {draft.mode === 'weekly' && (
        <>
          <div className="auto-field">
            <label className="auto-field-label" htmlFor="auto-sched-weekday">{t('schedWeekday')}</label>
            <select
              id="auto-sched-weekday"
              className="auto-select"
              value={draft.weekday}
              onChange={event => { update({ weekday: event.currentTarget.value }) }}
            >
              {days.map((name, index) => (
                <option key={index} value={String(index)}>{name}</option>
              ))}
            </select>
          </div>
          <div className="auto-field">
            <label className="auto-field-label" htmlFor="auto-sched-time-weekly">{t('schedTime')}</label>
            <input
              id="auto-sched-time-weekly"
              className="auto-input"
              type="time"
              value={draft.time}
              onChange={event => { update({ time: event.currentTarget.value }) }}
            />
          </div>
        </>
      )}

      {draft.mode === 'monthly' && (
        <>
          <div className="auto-field">
            <label className="auto-field-label" htmlFor="auto-sched-monthday">{t('schedMonthDay')}</label>
            <input
              id="auto-sched-monthday"
              className="auto-input"
              type="number"
              min="1"
              max="31"
              step="1"
              value={draft.monthDay}
              onChange={event => { update({ monthDay: event.currentTarget.value }) }}
            />
          </div>
          <div className="auto-field">
            <label className="auto-field-label" htmlFor="auto-sched-time-monthly">{t('schedTime')}</label>
            <input
              id="auto-sched-time-monthly"
              className="auto-input"
              type="time"
              value={draft.time}
              onChange={event => { update({ time: event.currentTarget.value }) }}
            />
          </div>
        </>
      )}

      {draft.mode === 'once' && (
        <div className="auto-field">
          <label className="auto-field-label" htmlFor="auto-sched-datetime">{t('schedDateTime')}</label>
          <input
            id="auto-sched-datetime"
            className="auto-input"
            type="datetime-local"
            value={draft.dateTime}
            onChange={event => { update({ dateTime: event.currentTarget.value }) }}
          />
        </div>
      )}

      <div className="auto-sched-preview">{schedulePreview(storedFromDraft(draft))}</div>
    </div>
  )
}
