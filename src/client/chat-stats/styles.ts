/** StatsLine shadow 的注入样式（复制原生 StatsLine.module.css，类名加 webui- 前缀）。 */

const CSS = `
.webui-stats-root {
  display: block;
  text-align: center;
  max-width: var(--dsh-chat-content-width);
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
  padding: 4px calc(var(--dsh-composer-side-clearance) + 16px) 0px;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.webui-stats-sep {
  color: var(--dsw-alias-separator-primary);
  margin: 0 10px;
}
`

/** 注入样式一次。 */
export function injectStatsStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-webui-stats-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-webui-stats-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}
