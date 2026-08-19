/** 数值缩写：999 → "999"，1234 → "1.2K"，1.2M，3.4G。 */
export function formatCompact(n: number): string {
  if (!isFinite(n) || n < 0) return String(n)
  if (n < 1000) return String(Math.round(n))
  const units: Array<[number, string]> = [
    [1e9, 'G'], [1e6, 'M'], [1e3, 'K'],
  ]
  for (const [base, suffix] of units) {
    if (n >= base) {
      const v = n / base
      return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}${suffix}`
    }
  }
  return String(n)
}

/**
 * 亿级精准显示：≥ 1 亿时返回「亿」主值 + 千分位精确数字，
 * 供 KPI 卡主值（缩写）配副行（精准）展示，如 "25 亿" / "2,500,000,000"。
 * 小于 1 亿返回 null（保持原缩写，不需要副行）。
 */
export function formatYiExact(n: number): { yi: string; exact: string } | null {
  if (!isFinite(n) || n < 1e8) return null
  const yi = n / 1e8
  const yiText = yi >= 100 ? String(Math.round(yi)) : yi.toFixed(1).replace(/\.0$/, '')
  return { yi: `${yiText} 亿`, exact: n.toLocaleString('en-US') }
}

/** 时间戳 → 相对时间（分钟/小时/天粒度）。 */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = ts - now
  const abs = Math.abs(diff)
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000
  if (abs < minute) return '刚刚'
  const future = diff > 0
  if (abs < hour) return `${Math.round(abs / minute)} 分钟${future ? '后' : '前'}`
  if (abs < day) return `${Math.round(abs / hour)} 小时${future ? '后' : '前'}`
  return `${Math.round(abs / day)} 天${future ? '后' : '前'}`
}
