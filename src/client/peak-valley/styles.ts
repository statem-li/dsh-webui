/**
 * DeepSeek 峰谷时刻 —— 样式（运行时注入 <style>，卸载时由 loader 清理）。
 * 唯一全局规则：让 sidebar footer 动作区换行，使峰谷卡片独占首行
 * （位于用量/技能/记忆上方）。
 */

const STYLE_ID = 'dsh-peak-valley-styles'

const SHEET = `
/* DeepSeek 峰谷时刻：footer 动作区换行，卡片（flex-basis:100%）独占首行。 */
div:has(> [data-slot="sidebar.footer.action"]) { flex-wrap: wrap; row-gap: 6px; }

/* 展开态卡片：可点击 + hover 高亮边框。 */
.dsh-peak-card { cursor: pointer; transition: border-color .2s ease, background .2s ease; }
.dsh-peak-card:hover { border-color: var(--dsw-alias-brand-primary, #4c8dff); }

/* 账单弹窗内容淡入。 */
@keyframes dsh-billing-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
.dsh-billing-fade { animation: dsh-billing-fade-in .3s ease; }

/* 骨架屏脉冲。 */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .5; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-billing-fade { animation: none; }
}
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
