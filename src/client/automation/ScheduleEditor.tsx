/**
 * automation — ScheduleEditor：六模式调度编辑器。
 *
 * 模式：interval（每隔）/ daily / weekly / monthly / once / advanced(裸 cron)。
 * 草稿与存储形态的双向转换在 schedule-draft.ts，本组件只管交互 +
 * 「预计下次触发」实时预览 + 非法计划的即时提示（提交前就拦住，不必等
 * 服务端报错）。
 */

import { useMemo } from 'react'
import type { ScheduleDraft, ScheduleMode, IntervalUnit } from './schedule-draft.ts'
import { dayNames, schedulePreviewFromDraft, validateDraft } from './schedule-draft.ts'
import { t } from './locales.ts'
import { TimePicker } from './TimePicker.tsx'

const SCHEDULE_MODES: ScheduleMode[] = ['interval', 'daily', 'weekly', 'monthly', 'once', 'advanced']
const INTERVAL_UNITS: IntervalUnit[] = ['minutes', 'hours', 'days']

/** 本地时间 → datetime-local 的 value（默认 1 小时后，避免一开就是非法值）。 */
function defaultDateTime(): string {
  const date = new Date(Date.now() + 3_600_000)
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
}

export function ScheduleEditor({ draft, onChange }: {
  draft: ScheduleDraft
  onChange: (draft: ScheduleDraft) => void
}): JSX.Element {
  const update = (patch: Partial<ScheduleDraft>): void => onChange({ ...draft, ...patch })
  const days = dayNames()
  const error = useMemo(() => validateDraft(draft), [draft])
  const preview = useMemo(() => (error === null ? schedulePreviewFromDraft(draft) : ''), [draft, error])

  return (
    <div className="auto-schedule">
      <div className="auto-inline">
        <label className="auto-field">
          <span>{t('fieldSchedule')}</span>
          <select
            className="auto-select"
            value={draft.mode}
            onChange={event => {
              const mode = event.target.value as ScheduleMode
              // 切到「指定一次」时给个合法默认值（空字符串会立刻报错，很难看）。
              update(mode === 'once' && draft.dateTime === ''
                ? { mode, dateTime: defaultDateTime() }
                : { mode })
            }}
          >
            {SCHEDULE_MODES.map(mode => (
              <option key={mode} value={mode}>{t(`mode.${mode}`)}</option>
            ))}
          </select>
        </label>

        {draft.mode === 'interval' ? (
          <>
            <label className="auto-field">
              <span>{t('every')}</span>
              <input
                className="auto-input"
                type="number"
                min="1"
                step="1"
                value={draft.intervalValue}
                onChange={event => update({ intervalValue: event.target.value })}
              />
            </label>
            <label className="auto-field">
              <span>{t('unit')}</span>
              <select
                className="auto-select"
                value={draft.intervalUnit}
                onChange={event => update({ intervalUnit: event.target.value as IntervalUnit })}
              >
                {INTERVAL_UNITS.map(unit => (
                  <option key={unit} value={unit}>{t(`unit.${unit}`)}</option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {draft.mode === 'daily' ? (
          <div className="auto-field">
            <span className="auto-field-label">{t('time')}</span>
            <TimePicker value={draft.time} onChange={time => update({ time })} />
          </div>
        ) : null}

        {draft.mode === 'weekly' ? (
          <>
            <label className="auto-field">
              <span>{t('weekday')}</span>
              <select
                className="auto-select"
                value={draft.weekday}
                onChange={event => update({ weekday: event.target.value })}
              >
                {days.map((name, index) => (
                  <option key={index} value={String(index)}>{`${t('weekPrefix')}${name}`}</option>
                ))}
              </select>
            </label>
            <div className="auto-field">
              <span className="auto-field-label">{t('time')}</span>
              <TimePicker value={draft.time} onChange={time => update({ time })} />
            </div>
          </>
        ) : null}

        {draft.mode === 'monthly' ? (
          <>
            <label className="auto-field">
              <span>{t('monthDay')}</span>
              <input
                className="auto-input"
                type="number"
                min="1"
                max="31"
                step="1"
                value={draft.monthDay}
                onChange={event => update({ monthDay: event.target.value })}
              />
            </label>
            <div className="auto-field">
              <span className="auto-field-label">{t('time')}</span>
              <TimePicker value={draft.time} onChange={time => update({ time })} />
            </div>
          </>
        ) : null}

        {draft.mode === 'once' ? (
          <label className="auto-field">
            <span>{t('dateTime')}</span>
            <input
              className="auto-input"
              type="datetime-local"
              value={draft.dateTime}
              onChange={event => update({ dateTime: event.target.value })}
            />
          </label>
        ) : null}

        {draft.mode === 'advanced' ? (
          <label className="auto-field">
            <span>{t('cronExpression')}</span>
            <input
              className="auto-input"
              value={draft.cron}
              spellCheck={false}
              placeholder="0 9 * * *"
              onChange={event => update({ cron: event.target.value })}
            />
          </label>
        ) : null}
      </div>

      {error !== null ? (
        <span className="auto-hint" data-tone="error">{error}</span>
      ) : (
        <span className="auto-hint">{t('schedulePreview', { text: preview })}</span>
      )}
      {draft.mode === 'advanced' && error === null ? (
        <span className="auto-hint">{t('cronHint')}</span>
      ) : null}
    </div>
  )
}
