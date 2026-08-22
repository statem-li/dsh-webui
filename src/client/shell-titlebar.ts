/**
 * dsh-webui — 壳子窗口控制按钮共存样式。
 *
 * DeepSeek Harness 桌面壳为无边框窗口，右上角悬浮「最小化 / 最大化 / 关闭」
 * 三按钮（壳子层 #win-controls，约 138×28，z-index 高于页面全部内容），
 * 且已下移至与「工具调用详情面板」头部同一行（垂直中心对齐）。
 *
 * 页面侧需要给右上角这块区域让位，否则：
 *  - 工具调用「详情」面板头部的「关闭详情」按钮会被三按钮压住无法点击；
 *  - AI 浏览器预览抽屉头部的关闭按钮同理（让位规则写在 browser/styles.ts）。
 *
 * 这里只处理 DSH 官方 UI（详情面板）：用 aria-label 定位（CSS modules 类名
 * 带 hash 不可直接引用），桌面宽度生效；移动端/纯浏览器访问无壳子按钮，
 * 媒体查询内恢复默认。
 */

const STYLE_ID = 'dsh-webui-shell-titlebar-styles'

/** 壳子 win-controls 占位宽度：3 × 46px 按钮 = 138px，再留 12px 呼吸边距。 */
const RESERVED = '150px'

const SHEET = `
@media (min-width: 768px) {
  /* 工具调用「详情」面板头部：右侧预留壳子三按钮区域，
     「关闭详情」按钮左移后与最小化/最大化/关闭落在同一行。 */
  div.header:has(> button[aria-label="关闭详情"]) {
    padding-right: ${RESERVED} !important;
  }
}
`

let injected = false

/** 注入壳子标题栏共存样式（幂等）；返回移除函数。 */
export function injectShellTitlebarStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/shell-titlebar'
    tag.textContent = SHEET
    document.head.appendChild(tag)
    injected = true
  }
  return () => {
    if (!injected) return
    document.getElementById(STYLE_ID)?.remove()
    injected = false
  }
}
