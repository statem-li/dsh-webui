/**
 * DeepSeek 峰谷时刻 —— 时间逻辑（纯函数，无副作用）。
 *
 * 按 DeepSeek V4 峰谷定价：高峰时段为工作日 09:00–12:00 与 14:00–18:00
 * （北京时间），其余时间（夜间、午休、周末）为低谷时段。时区固定为
 * Asia/Shanghai（UTC+8，无夏令时）。
 */

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

export type Period = 'peak' | 'off'

export interface BeijingClock {
  /** 星期几：0=周日 … 6=周六（北京时区） */
  day: number
  hour: number
  minute: number
}

/** 取当前时刻的北京时间墙钟（用 UTC getter 读取偏移后的日期，避开本机时区）。 */
export function beijingClock(nowMs: number): BeijingClock {
  const d = new Date(nowMs + SHANGHAI_OFFSET_MS)
  return { day: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

const isWeekday = (day: number): boolean => day >= 1 && day <= 5

/** 当前是否处于高峰时段（工作日 09:00–12:00 / 14:00–18:00，左闭右开）。 */
export function isPeak(day: number, hour: number, minute: number): boolean {
  if (!isWeekday(day)) return false
  const t = hour * 60 + minute
  return (t >= 9 * 60 && t < 12 * 60) || (t >= 14 * 60 && t < 18 * 60)
}

/** 以周一 00:00 为 0 的一周分钟数（Mon=0 … Sun=6）。 */
function minuteOfWeek(day: number, hour: number, minute: number): number {
  const monBased = (day + 6) % 7
  return monBased * 1440 + hour * 60 + minute
}

interface Transition {
  minute: number
  to: Period
}

/** 一周内的全部峰谷切换点（工作日 × 09:00/12:00/14:00/18:00）。 */
const WEEK_TRANSITIONS: readonly Transition[] = (() => {
  const out: Transition[] = []
  for (let d = 0; d <= 4; d++) {
    const base = d * 1440
    out.push({ minute: base + 9 * 60, to: 'peak' })
    out.push({ minute: base + 12 * 60, to: 'off' })
    out.push({ minute: base + 14 * 60, to: 'peak' })
    out.push({ minute: base + 18 * 60, to: 'off' })
  }
  return out
})()

const WEEK_MINUTES = 7 * 1440

/** 下一段峰/谷切换：目标状态 + 距当前的分钟数。 */
export function nextTransition(clock: BeijingClock): { to: Period; deltaMinutes: number } {
  const now = minuteOfWeek(clock.day, clock.hour, clock.minute)
  for (const t of WEEK_TRANSITIONS) {
    if (t.minute > now) return { to: t.to, deltaMinutes: t.minute - now }
  }
  // 已过周五 18:00 → 下一站为下周一 09:00 进入高峰
  const monday9 = 9 * 60
  return { to: 'peak', deltaMinutes: WEEK_MINUTES - now + monday9 }
}

/** 分钟数 → 可读时长（不足 1 小时显示分钟，整点省略分钟）。 */
export function formatDelta(minutes: number): string {
  if (minutes <= 0) return '0 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}
