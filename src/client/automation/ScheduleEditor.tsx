/**
 * automation — ScheduleEditor：六模式调度编辑器（openhanako 同款）。
 *
 * 模式：interval（每隔）/ daily / weekly / monthly / once / advanced(裸 cron)。
 * 草稿与存储形态的双向转换在 schedule-draft.ts，本组件只管交互。
 */

import type { ScheduleDraft, ScheduleMode, IntervalUnit } from './schedule-draft.ts'
import { dayNames } from './schedule-draft.ts'
import { t } from './locales.ts'
import { TimePicker } from './TimePicker.tsx'

const SCHEDULE_MODES: ScheduleMode[] = ['interval', 'daily', 'weekly', 'monthly', 'once', 'advanced']
const INTERVAL_UNITS: IntervalUnit[] = ['minutes', 'hours', 'days']

export function ScheduleEditor({ draft, onChange }: {
  draft: ScheduleDraft
  onChange: (draft: ScheduleDraft) => void
}): JSX.Element {
  const update = (patch: Partial<ScheduleDraft>): void => onChange({ ...draft, ...patch })
  const days = dayNames()

  return (
    <div className="auto-schedule">
      <label className="auto-field">
        <span>{t('fieldSchedule')}</span>
        <select
          className="auto-select"
          value={draft.mode}
          onChange={event => update({ mode: event.target.value as ScheduleMode })}
        >
          {SCHEDULE_MODES.map(mode => (
            <option key={mode} value={mode}>{t(`mode.${mode}`)}</option>
          ))}
        </select>
      </label>

      {draft.mode === 'interval' ? (
        <div className="auto-inline">
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
        </div>
      ) : null}

      {draft.mode === 'daily' ? (
        <div className="auto-field">
          <span>{t('time')}</span>
          <TimePicker value={draft.time} onChange={time => update({ time })} />
        </div>
      ) : null}

      {draft.mode === 'weekly' ? (
        <div className="auto-inline">
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
            <span>{t('time')}</span>
            <TimePicker value={draft.time} onChange={time => update({ time })} />
          </div>
        </div>
      ) : null}

      {draft.mode === 'monthly' ? (
        <div className="auto-inline">
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
            <span>{t('time')}</span>
            <TimePicker value={draft.time} onChange={time => update({ time })} />
          </div>
        </div>
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
  )
}
