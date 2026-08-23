/**
 * automation — 调度模型（参考 openhanako schedule-draft）。
 *
 * UI 用 6 种直观模式编辑计划，存储统一归约为 at / every / cron 三型：
 *  - interval → every（毫秒）
 *  - daily / weekly / monthly → cron（「分 时 日 月 周」）
 *  - once → at（ISO 时间）
 *  - advanced → 原样 5 字段 cron
 * 双向转换让已存任务回到最贴近的 UI 模式。
 */

import { t } from './locales.ts'

export type ScheduleMode = 'interval' | 'daily' | 'weekly' | 'monthly' | 'once' | 'advanced'
export type IntervalUnit = 'minutes' | 'hours' | 'days'

/** UI 编辑草稿。 */
export interface ScheduleDraft {
  mode: ScheduleMode
  intervalValue: string
  intervalUnit: IntervalUnit
  time: string
  weekday: string
  monthDay: string
  dateTime: string
  cron: string
}

/** 存储形态。 */
export interface StoredSchedule {
  type: 'at' | 'every' | 'cron'
  schedule: string | number
}

const UNIT_MS: Record<IntervalUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
}

const WEEKDAY_COUNT = 7

function two(value: number): string {
  return String(value).padStart(2, '0')
}

function toTime(hour: string, minute: string): string {
  const h = Math.max(0, Math.min(23, Number.parseInt(hour, 10) || 0))
  const m = Math.max(0, Math.min(59, Number.parseInt(minute, 10) || 0))
  return `${two(h)}:${two(m)}`
}

function localDateTimeFromSchedule(schedule: unknown): string {
  const date = new Date(String(schedule || ''))
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
}

function chooseInterval(ms: number): Pick<ScheduleDraft, 'intervalValue' | 'intervalUnit'> {
  if (Number.isFinite(ms) && ms > 0) {
    if (ms % UNIT_MS.days === 0) return { intervalValue: String(ms / UNIT_MS.days), intervalUnit: 'days' }
    if (ms % UNIT_MS.hours === 0) return { intervalValue: String(ms / UNIT_MS.hours), intervalUnit: 'hours' }
    return { intervalValue: String(Math.max(1, Math.round(ms / UNIT_MS.minutes))), intervalUnit: 'minutes' }
  }
  return { intervalValue: '60', intervalUnit: 'minutes' }
}

/** 新建任务的默认草稿：每天 09:00。 */
export function defaultScheduleDraft(): ScheduleDraft {
  return {
    mode: 'daily',
    intervalValue: '60',
    intervalUnit: 'minutes',
    time: '09:00',
    weekday: '1',
    monthDay: '1',
    dateTime: '',
    cron: '0 9 * * *',
  }
}

/** 存储形态 → 最贴近的 UI 草稿。 */
export function scheduleDraftFromStored(type: unknown, schedule: unknown): ScheduleDraft {
  const base = defaultScheduleDraft()
  if (type === 'every') {
    const ms = typeof schedule === 'number' ? schedule : Number.parseInt(String(schedule), 10)
    return { ...base, mode: 'interval', ...chooseInterval(ms) }
  }
  if (type === 'at') {
    return { ...base, mode: 'once', dateTime: localDateTimeFromSchedule(schedule) }
  }

  const cron = String(schedule || '').trim()
  const parts = cron.split(/\s+/)
  if (parts.length !== 5) return { ...base, mode: 'advanced', cron }

  const [minute, hour, dayOfMonth, month, weekday] = parts
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && weekday === '*') {
    return { ...base, mode: 'interval', intervalValue: minute.slice(2), intervalUnit: 'minutes', cron }
  }
  if (minute === '0' && hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && weekday === '*') {
    return { ...base, mode: 'interval', intervalValue: hour.slice(2), intervalUnit: 'hours', cron }
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && month === '*') {
    const time = toTime(hour, minute)
    if (dayOfMonth === '*' && weekday === '*') return { ...base, mode: 'daily', time, cron }
    if (dayOfMonth === '*' && /^[0-7]$/.test(weekday)) {
      return { ...base, mode: 'weekly', time, weekday: weekday === '7' ? '0' : weekday, cron }
    }
    if (/^\d+$/.test(dayOfMonth) && weekday === '*') return { ...base, mode: 'monthly', time, monthDay: dayOfMonth, cron }
  }
  return { ...base, mode: 'advanced', cron }
}

function timeParts(time: string): { hour: string, minute: string } {
  const [hour = '9', minute = '0'] = time.split(':')
  return {
    hour: String(Math.max(0, Math.min(23, Number.parseInt(hour, 10) || 0))),
    minute: String(Math.max(0, Math.min(59, Number.parseInt(minute, 10) || 0))),
  }
}

/** UI 草稿 → 存储形态。 */
export function storedScheduleFromDraft(draft: ScheduleDraft): StoredSchedule {
  if (draft.mode === 'interval') {
    const value = Math.max(1, Number.parseInt(draft.intervalValue, 10) || 1)
    return { type: 'every', schedule: value * UNIT_MS[draft.intervalUnit] }
  }
  if (draft.mode === 'once') {
    const date = new Date(draft.dateTime)
    return { type: 'at', schedule: Number.isNaN(date.getTime()) ? draft.dateTime : date.toISOString() }
  }
  if (draft.mode === 'advanced') {
    return { type: 'cron', schedule: draft.cron.trim() }
  }

  const { hour, minute } = timeParts(draft.time)
  if (draft.mode === 'weekly') {
    const weekday = Math.max(0, Math.min(WEEKDAY_COUNT - 1, Number.parseInt(draft.weekday, 10) || 0))
    return { type: 'cron', schedule: `${minute} ${hour} * * ${weekday}` }
  }
  if (draft.mode === 'monthly') {
    const day = Math.max(1, Math.min(31, Number.parseInt(draft.monthDay, 10) || 1))
    return { type: 'cron', schedule: `${minute} ${hour} ${day} * *` }
  }
  return { type: 'cron', schedule: `${minute} ${hour} * * *` }
}

/** 卡片副行预览文案（人话）。 */
export function schedulePreviewFromDraft(draft: ScheduleDraft): string {
  if (draft.mode === 'once') {
    const date = new Date(draft.dateTime)
    const text = Number.isNaN(date.getTime())
      ? draft.dateTime
      : date.toLocaleString(undefined, { hour12: false })
    return t('schedule.onceAt', { date: text })
  }
  if (draft.mode === 'advanced') {
    return t('schedule.advancedCron', { cron: draft.cron || '' })
  }
  const stored = storedScheduleFromDraft(draft)
  return stored.type === 'every' ? everyPreview(stored.schedule as number) : cronToHuman(String(stored.schedule))
}

function everyPreview(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes % 1440 === 0) return t('everyDays', { n: minutes / 1440 })
  if (minutes % 60 === 0) return t('everyHours', { n: minutes / 60 })
  return t('everyMinutes', { n: Math.max(1, minutes) })
}

/** cron 表达式 → 人话（对齐 openhanako cronToHuman 的覆盖面）。 */
export function cronToHuman(schedule: string): string {
  const parts = schedule.split(/\s+/)
  if (parts.length !== 5) return schedule
  const [min, hour, dayOfMonth, month, dow] = parts

  if (min.startsWith('*/') && hour === '*' && dow === '*' && dayOfMonth === '*' && month === '*') {
    return t('everyMinutes', { n: min.slice(2) })
  }
  if (min === '0' && hour.startsWith('*/') && dow === '*' && dayOfMonth === '*' && month === '*') {
    return t('everyHours', { n: hour.slice(2) })
  }
  if (min === '0' && hour === '*' && dow === '*' && dayOfMonth === '*' && month === '*') return t('hourly')
  if (hour === '*' && dow === '*' && dayOfMonth === '*' && month === '*' && /^\d+$/.test(min)) {
    return t('hourlyAt', { min: min.padStart(2, '0') })
  }
  if (dow === '*' && dayOfMonth === '*' && month === '*' && hour !== '*' && /^\d+$/.test(min)) {
    return t('dailyAt', { hour, min: min.padStart(2, '0') })
  }
  if (dow === '*' && month === '*' && /^\d+$/.test(dayOfMonth) && hour !== '*' && /^\d+$/.test(min)) {
    return t('monthlyAt', { day: dayOfMonth, hour, min: min.padStart(2, '0') })
  }
  if (dow !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && /^\d+$/.test(min)) {
    const names = dayNames()
    const weekPrefix = t('weekPrefix')
    const days = dow.split(',').map(d => `${weekPrefix}${names[Number(d)] ?? d}`).join('/')
    return t('weeklyAt', { days, hour, min: min.padStart(2, '0') })
  }
  return schedule
}

/** 周日→周六的本地化单字名。 */
export function dayNames(): string[] {
  const raw = t('dayNames')
  const list = raw.split(',').map(item => item.trim()).filter(Boolean)
  return list.length === 7 ? list : ['日', '一', '二', '三', '四', '五', '六']
}
