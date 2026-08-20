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

/**
 * 中文单位缩写：≥1 亿显示「X 亿」，≥1 万显示「X 万」，否则原数。
 * 用量工作台图表/列表的 token 数值统一用它，避免 K/M/G 英文后缀。
 */
export function formatUnits(n: number): string {
  if (!isFinite(n) || n < 0) return String(n)
  if (n >= 1e8) {
    const v = n / 1e8
    return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2).replace(/\.?0+$/, '')}亿`
  }
  if (n >= 1e4) {
    const v = n / 1e4
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}万`
  }
  return String(Math.round(n))
}

/** 千分位完整数字（英文逗号分隔），供 KPI 卡副行展示精确值。 */
export function formatExact(n: number): string {
  return n.toLocaleString('en-US')
}

/** 缓存命中率：固定两位小数（72.2 → 72.20%）；空值显示 —。 */
export function formatHitRate(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return `${n.toFixed(2)}%`
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
