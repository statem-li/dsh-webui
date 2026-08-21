/**
 * DeepSeek 峰谷时刻 —— 时间逻辑（纯函数，无副作用）。
 *
 * 按 DeepSeek 官方定价页：高峰时段为北京时间每日 09:00–12:00 与 14:00–18:00，
 * 其余时间（夜间、午休，含周末与节假日）均为空闲时段，价格减半。官方文档
 * 未区分工作日/周末，峰谷窗口按天循环。时区固定为 Asia/Shanghai
 * （UTC+8，无夏令时）。参见 https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
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

/** 当前是否处于高峰时段（每日 09:00–12:00 / 14:00–18:00，左闭右开；周末同样生效）。 */
export function isPeak(hour: number, minute: number): boolean {
  const t = hour * 60 + minute
  return (t >= 9 * 60 && t < 12 * 60) || (t >= 14 * 60 && t < 18 * 60)
}

/** 一天内的全部峰谷切换点（09:00/12:00/14:00/18:00，每天循环）。 */
const DAY_TRANSITIONS: readonly { minute: number; to: Period }[] = [
  { minute: 9 * 60, to: 'peak' },
  { minute: 12 * 60, to: 'off' },
  { minute: 14 * 60, to: 'peak' },
  { minute: 18 * 60, to: 'off' },
]

const DAY_MINUTES = 1440

/** 下一段峰/谷切换：目标状态 + 距当前的分钟数。 */
export function nextTransition(clock: BeijingClock): { to: Period; deltaMinutes: number } {
  const now = clock.hour * 60 + clock.minute
  for (const t of DAY_TRANSITIONS) {
    if (t.minute > now) return { to: t.to, deltaMinutes: t.minute - now }
  }
  // 已过今日 18:00 → 下一站明早 09:00 进入高峰（周末亦然）
  return { to: 'peak', deltaMinutes: DAY_MINUTES - now + 9 * 60 }
}

/** 分钟数 → 可读时长（不足 1 小时显示分钟，整点省略分钟）。 */
export function formatDelta(minutes: number): string {
  if (minutes <= 0) return '0 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}
