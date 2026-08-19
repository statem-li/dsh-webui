/**
 * DeepSeek 峰谷时刻 —— 样式（运行时注入 <style>，卸载时由 loader 清理）。
 * 唯一全局规则：让 sidebar footer 动作区换行，使峰谷卡片独占首行
 * （位于用量/技能/记忆上方）。
 */

const STYLE_ID = 'dsh-peak-valley-styles'

const SHEET = `
/* DeepSeek 峰谷时刻：footer 动作区换行，卡片（flex-basis:100%）独占首行。 */
div:has(> [data-slot="sidebar.footer.action"]) { flex-wrap: wrap; row-gap: 6px; }
`

/** 注入样式表（幂等）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
