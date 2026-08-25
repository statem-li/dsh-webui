/**
 * 工作区文档卡片 —— 样式（运行时注入 style 标签，卸载时由 loader 清理）。
 * 卡片外观对齐峰谷时刻卡片（同圆角 / 边框 / 内距 / hover 高亮 / 实底豁免
 * 玻璃）；footer 换行规则与峰谷模块各自独立注入，单开任一模块都成立。
 */

const STYLE_ID = 'dsh-wsdoc-styles'

const SHEET = `
/* footer 动作区换行（与峰谷模块同规则、不同 style id，互为幂等兜底）。 */
div:has(> [data-slot="sidebar.footer.action"]) { flex-wrap: wrap; row-gap: 6px; }

/* 展开态卡片：可点击 + hover 高亮边框（与峰谷卡一致）。 */
.dsh-wsdoc-card { cursor: pointer; transition: border-color .2s ease, background .2s ease; }
.dsh-wsdoc-card:hover { border-color: var(--dsw-alias-brand-primary, #4c8dff); }

/* 创建占位卡：虚线边框示意「尚不存在」，hover 转实线。 */
.dsh-wsdoc-create { border-style: dashed; opacity: .92; }
.dsh-wsdoc-create:hover { border-style: solid; opacity: 1; }

/* 实底豁免玻璃：玻璃质感开启时卡片保持不透明（同峰谷 data-solid 方案）。 */
.dsh-wsdoc-card[data-solid] { background: var(--dsw-alias-bg-layer-1, #1c1f26); }
html[data-dsh-glass] .dsh-wsdoc-card[data-solid] { background: var(--dsw-static-neutral-bluish-00, #fff); }
html[data-dsh-glass] body[data-ds-dark-theme] .dsh-wsdoc-card[data-solid] { background: var(--dsw-static-neutral-bluish-850, #2c2c2e); }
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
