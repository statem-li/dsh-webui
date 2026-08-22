/**
 * automation — 调度模型（设计借鉴 openhanako 的 schedule-draft）。
 *
 * UI 草稿（5 种友好模式）⇄ 存储形态（every 毫秒间隔 / cron 表达式 / at ISO 时刻）
 * 双向转换；附人类可读预览与到期判定，供任务编辑器与调度器共用。
 *
 *  - interval：每 N 分钟/小时/天（存储为毫秒数）；
 *  - daily/weekly/monthly：存储为五段 cron（分 时 日 月 周）；
 *  - once：存储为 ISO 时刻，触发一次。
 */

/** 调度模式（UI 草稿）。 */
export type ScheduleMode = 'interval' | 'daily' | 'weekly' | 'monthly' | 'once'
/** 间隔单位。 */
export type IntervalUnit = 'minutes' | 'hours' | 'days'
/** 存储形态类型。 */
export type StoredScheduleType = 'every' | 'cron' | 'at'

/** 编辑器草稿（表单字段全集，按 mode 取用）。 */
export interface ScheduleDraft {
  mode: ScheduleMode
  intervalValue: string
  intervalUnit: IntervalUnit
  /** HH:mm */
  time: string
  /** '0'..'6'，0 = 周日 */
  weekday: string
  /** '1'..'31' */
  monthDay: string
  /** datetime-local 值 */
  dateTime: string
}

/** 存储形态（挂到 AutomationTask.schedule）。 */
export interface StoredSchedule {
  type: StoredScheduleType
  schedule: string | number
}

const UNIT_MS: Record<IntervalUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

function toTime(hour: string, minute: string): string {
  const h = Math.max(0, Math.min(23, parseInt(hour, 10) || 0))
  const m = Math.max(0, Math.min(59, parseInt(minute, 10) || 0))
  return `${two(h)}:${two(m)}`
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/** 缺省草稿：每天 09:00。 */
export function defaultScheduleDraft(): ScheduleDraft {
  return {
    mode: 'daily',
    intervalValue: '60',
    intervalUnit: 'minutes',
    time: '09:00',
    weekday: '1',
    monthDay: '1',
    dateTime: '',
  }
}

/** 缺省存储形态：每天 09:00。 */
export const DEFAULT_SCHEDULE: StoredSchedule = { type: 'cron', schedule: '0 9 * * *' }

/** 草稿 → 存储。 */
export function storedFromDraft(draft: ScheduleDraft): StoredSchedule {
  if (draft.mode === 'interval') {
    const value = Math.max(1, parseInt(draft.intervalValue, 10) || 1)
    return { type: 'every', schedule: value * UNIT_MS[draft.intervalUnit] }
  }
  if (draft.mode === 'once') {
    const date = new Date(draft.dateTime)
    return { type: 'at', schedule: Number.isNaN(date.getTime()) ? draft.dateTime : date.toISOString() }
  }
  const { hour, minute } = timeParts(draft.time)
  if (draft.mode === 'weekly') {
    const weekday = clampInt(draft.weekday, 0, 6, 1)
    return { type: 'cron', schedule: `${minute} ${hour} * * ${weekday}` }
  }
  if (draft.mode === 'monthly') {
    const day = clampInt(draft.monthDay, 1, 31, 1)
    return { type: 'cron', schedule: `${minute} ${hour} ${day} * *` }
  }
  return { type: 'cron', schedule: `${minute} ${hour} * * *` }
}

/** 存储 → 草稿（编辑回填；无法识别的形态回退每天 09:00）。 */
export function draftFromStored(stored: StoredSchedule | undefined | null): ScheduleDraft {
  const base = defaultScheduleDraft()
  if (stored === undefined || stored === null || typeof stored !== 'object') return base
  if (stored.type === 'every') {
    const ms = typeof stored.schedule === 'number' ? stored.schedule : parseInt(String(stored.schedule), 10)
    if (!Number.isFinite(ms) || ms <= 0) return base
    if (ms % UNIT_MS.days === 0) return { ...base, mode: 'interval', intervalValue: String(ms / UNIT_MS.days), intervalUnit: 'days' }
    if (ms % UNIT_MS.hours === 0) return { ...base, mode: 'interval', intervalValue: String(ms / UNIT_MS.hours), intervalUnit: 'hours' }
    return { ...base, mode: 'interval', intervalValue: String(Math.max(1, Math.round(ms / UNIT_MS.minutes))), intervalUnit: 'minutes' }
  }
  if (stored.type === 'at') {
    const date = new Date(String(stored.schedule || ''))
    if (Number.isNaN(date.getTime())) return base
    const local = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
    return { ...base, mode: 'once', dateTime: local }
  }
  // cron 反解析（只认本模块产出的形态）。
  const parts = String(stored.schedule || '').trim().split(/\s+/)
  if (parts.length !== 5) return base
  const [minute, hour, dayOfMonth, , weekday] = parts
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && weekday === '*') {
    return { ...base, mode: 'interval', intervalValue: minute.slice(2), intervalUnit: 'minutes' }
  }
  if (minute === '0' && hour.startsWith('*/') && dayOfMonth === '*' && weekday === '*') {
    return { ...base, mode: 'interval', intervalValue: hour.slice(2), intervalUnit: 'hours' }
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const time = toTime(hour, minute)
    if (dayOfMonth === '*' && weekday === '*') return { ...base, mode: 'daily', time }
    if (dayOfMonth === '*' && /^[0-7]$/.test(weekday)) return { ...base, mode: 'weekly', time, weekday: weekday === '7' ? '0' : weekday }
    if (/^\d+$/.test(dayOfMonth) && weekday === '*') return { ...base, mode: 'monthly', time, monthDay: dayOfMonth }
  }
  return base
}

function timeParts(time: string): { hour: string; minute: string } {
  const [hour = '9', minute = '0'] = time.split(':')
  return {
    hour: String(clampInt(hour, 0, 23, 9)),
    minute: String(clampInt(minute, 0, 59, 0)),
  }
}

/** 星期名（0 = 日）。zh/en 各一套，逗号分隔由调用方 split。 */
export const WEEKDAY_NAMES: Record<'zh' | 'en', readonly string[]> = {
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

/** 当前语言（跟随 <html lang>，与 locales.makeT 同款策略）。 */
function currentLang(): 'zh' | 'en' {
  try {
    if (document.documentElement.lang.toLowerCase().split('-')[0] === 'en') return 'en'
  } catch { /* 非 DOM 环境 */ }
  return 'zh'
}

/** 人类可读预览：「每天 09:00」「每周一 09:30」「每 30 分钟」「2026-08-22 09:00 执行一次」。 */
export function schedulePreview(stored: StoredSchedule | undefined | null): string {
  const draft = draftFromStored(stored ?? DEFAULT_SCHEDULE)
  const names = WEEKDAY_NAMES[currentLang()]
  switch (draft.mode) {
    case 'interval': {
      const unit = draft.intervalUnit === 'minutes' ? (currentLang() === 'zh' ? '分钟' : 'min')
        : draft.intervalUnit === 'hours' ? (currentLang() === 'zh' ? '小时' : 'hours')
          : (currentLang() === 'zh' ? '天' : 'days')
      return currentLang() === 'zh' ? `每 ${draft.intervalValue} ${unit}` : `Every ${draft.intervalValue} ${unit}`
    }
    case 'daily':
      return currentLang() === 'zh' ? `每天 ${draft.time}` : `Daily at ${draft.time}`
    case 'weekly':
      return currentLang() === 'zh' ? `每周${names[clampInt(draft.weekday, 0, 6, 1)]} ${draft.time}` : `Weekly on ${names[clampInt(draft.weekday, 0, 6, 1)]} at ${draft.time}`
    case 'monthly':
      return currentLang() === 'zh' ? `每月 ${clampInt(draft.monthDay, 1, 31, 1)} 日 ${draft.time}` : `Monthly on day ${clampInt(draft.monthDay, 1, 31, 1)} at ${draft.time}`
    case 'once':
      return currentLang() === 'zh' ? `${draft.dateTime || '未设定时间'} 执行一次` : `Once at ${draft.dateTime || '(unset)'}`
  }
}

/**
 * 到期判定（调度器 tick 用）。
 * @param stored 任务执行计划
 * @param lastRunAt 该任务最近一次触发时刻（无记录 = null）
 * @param now 当前时刻
 */
export function isDue(stored: StoredSchedule, lastRunAt: number | null, now: number): boolean {
  if (stored.type === 'every') {
    const ms = typeof stored.schedule === 'number' ? stored.schedule : parseInt(String(stored.schedule), 10)
    if (!Number.isFinite(ms) || ms <= 0) return false
    return lastRunAt === null || now - lastRunAt >= ms
  }
  if (stored.type === 'at') {
    const target = Date.parse(String(stored.schedule || ''))
    if (Number.isNaN(target)) return false
    return now >= target && (lastRunAt === null || lastRunAt < target)
  }
  // cron：解析「分 时 日 月 周」为目标时刻，now 已过且上次触发早于该目标 → 到期。
  const parts = String(stored.schedule || '').trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [minute, hour, dayOfMonth, , weekday] = parts
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return false
  const nowDate = new Date(now)
  let target: Date
  if (dayOfMonth !== '*' && /^\d+$/.test(dayOfMonth)) {
    // monthly：本月该日（本月不存在该日期则不触发，与 cron 语义一致）。
    target = new Date(nowDate.getFullYear(), nowDate.getMonth(), parseInt(dayOfMonth, 10), parseInt(hour, 10), parseInt(minute, 10))
    if (target.getMonth() !== nowDate.getMonth()) return false
  } else if (weekday !== '*' && /^[0-7]$/.test(weekday)) {
    // weekly：往前找最近的指定星期（含今天）。
    const dow = parseInt(weekday, 10) % 7
    const todayDow = nowDate.getDay()
    let back = (todayDow - dow + 7) % 7
    target = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - back, parseInt(hour, 10), parseInt(minute, 10))
  } else if (dayOfMonth === '*' && weekday === '*') {
    // daily：今天。
    target = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), parseInt(hour, 10), parseInt(minute, 10))
  } else {
    return false
  }
  const targetMs = target.getTime()
  return now >= targetMs && (lastRunAt === null || lastRunAt < targetMs)
}
