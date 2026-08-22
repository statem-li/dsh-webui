/**
 * DeepSeek 峰谷时刻 —— 时间逻辑（纯函数，无副作用）。
 *
 * 计费规则（2026-08-23 00:00 北京时间起生效的官方计费调整）：
 * - 工作日（周一至周五）：高峰时段为北京时间每日 09:00–12:00 与 14:00–18:00，
 *   其余时间为空闲时段，价格为高峰的一半；
 * - 周末（周六、周日）：全天不再区分峰谷，统一按空闲（低谷）价格收取。
 * 生效前（2026-08-17 ～ 2026-08-22）按旧规则执行：每日分峰谷、周末同样计峰。
 * 时区固定为 Asia/Shanghai（UTC+8，无夏令时）。
 * 参见 https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 */

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 「周末全天空闲价」新规生效时刻：北京时间 2026-08-23 00:00（= UTC 2026-08-22 16:00）。 */
const WEEKEND_FLAT_OFF_UTC_MS = Date.UTC(2026, 7, 22, 16, 0, 0)

export type Period = 'peak' | 'off'

export interface BeijingClock {
  /** 星期几：0=周日 … 6=周六（北京时区） */
  day: number
  hour: number
  minute: number
  /** 原始 Unix 毫秒（与 WEEKEND_FLAT_OFF_UTC_MS 同基准，用于判断新规是否已生效）。 */
  epochMs: number
}

/** 取当前时刻的北京时间墙钟（用 UTC getter 读取偏移后的日期，避开本机时区）。 */
export function beijingClock(nowMs: number): BeijingClock {
  const d = new Date(nowMs + SHANGHAI_OFFSET_MS)
  return { day: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), epochMs: nowMs }
}

/** 周六/周日。 */
function isWeekendDay(day: number): boolean {
  return day === 0 || day === 6
}

/** 新规已生效且处于周末 → 全天空闲价（谷时）。 */
export function isWeekendFlatOff(clock: BeijingClock): boolean {
  return clock.epochMs >= WEEKEND_FLAT_OFF_UTC_MS && isWeekendDay(clock.day)
}

/** 工作日高峰窗口判定（09:00–12:00 / 14:00–18:00，左闭右开）。 */
function inWeekdayPeakWindows(minuteOfDay: number): boolean {
  return (minuteOfDay >= 9 * 60 && minuteOfDay < 12 * 60) || (minuteOfDay >= 14 * 60 && minuteOfDay < 18 * 60)
}

/**
 * 当前是否处于高峰时段。
 * 新规生效后周末全天空闲价；工作日维持每日 09:00–12:00 / 14:00–18:00 计峰。
 * 生效前按旧规则（每日计峰，周末亦然）。
 */
export function isPeak(clock: BeijingClock): boolean {
  if (isWeekendFlatOff(clock)) return false
  return inWeekdayPeakWindows(clock.hour * 60 + clock.minute)
}

/** 一天内的全部峰谷切换点（09:00/12:00/14:00/18:00，每天循环）。 */
const DAY_TRANSITIONS: readonly { minute: number; to: Period }[] = [
  { minute: 9 * 60, to: 'peak' },
  { minute: 12 * 60, to: 'off' },
  { minute: 14 * 60, to: 'peak' },
  { minute: 18 * 60, to: 'off' },
]

const DAY_MINUTES = 1440

/**
 * 下一段峰/谷切换：目标状态 + 距当前的分钟数。
 * 新规下周末全天空闲价 → 下一次切换是周一 09:00 进入高峰。
 */
export function nextTransition(clock: BeijingClock): { to: Period; deltaMinutes: number } {
  const now = clock.hour * 60 + clock.minute

  if (isWeekendFlatOff(clock)) {
    // 周末全天空闲价：距下一个周一 09:00 进入高峰。
    // 到周一 00:00 需跨过的整天数：周六隔周日 1 天、周日当天 0 天。
    const daysToMonday = (7 - clock.day) % 7
    return { to: 'peak', deltaMinutes: DAY_MINUTES - now + daysToMonday * DAY_MINUTES + 9 * 60 }
  }

  for (const t of DAY_TRANSITIONS) {
    if (t.minute > now) return { to: t.to, deltaMinutes: t.minute - now }
  }
  // 已过今日 18:00：默认下一站明早 09:00 进入高峰。
  // 但若"明早 09:00"已越过新规生效时刻，则该次进峰不会发生：
  // - 生效前的周六晚（次日为周日）：周日全天空闲价 → 跳到周一 09:00；
  // - 生效前的周五晚不受影响（次日周六 09:00 早于生效时刻，旧规则仍计峰）；
  // - 生效后的周五晚同理跳周一（新规下明天是周六）。
  const nextMorningEpochMs = clock.epochMs + (DAY_MINUTES - now + 9 * 60) * 60_000
  if ((clock.day === 5 || clock.day === 6) && nextMorningEpochMs >= WEEKEND_FLAT_OFF_UTC_MS) {
    const daysToMonday = clock.day === 5 ? 2 : 1
    return { to: 'peak', deltaMinutes: DAY_MINUTES - now + daysToMonday * DAY_MINUTES + 9 * 60 }
  }
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
