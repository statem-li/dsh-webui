/**
 * automation — DOM 注入挂载。
 *
 * 「自动化」菜单项必须出现在「新会话」按钮正下方。侧边栏的
 * `sidebar.workspaces` 是 single 插槽（ui-workspace 已占用，再注册会把它
 * shadow 掉），因此走 DOM 注入 + React portal：
 *  - 锚点 = `[data-slot="sidebar.workspaces"]`（slots 渲染器的稳定锚 div，
 *    display:contents）的父元素，即侧边栏的浏览区容器——它紧跟「新会话」按钮；
 *  - host div 插到该容器之前（insertBefore），portal 内容便落在按钮正下方；
 *  - 低频轮询兜底：侧边栏整体重挂（HMR/插件重载）后自动重新插入。
 */

import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { AutomationApp } from './AutomationApp.tsx'

const HOST_ID = 'dsh-automation-menu-host'
/** slots 渲染器给每个插槽渲染的稳定锚点（scoped-slots.tsx 的 ANCHOR 契约）。 */
const ANCHOR_SELECTOR = '[data-slot="sidebar.workspaces"]'

let root: Root | null = null
let host: HTMLDivElement | null = null
let pollTimer = 0

/** 确保 host 已创建并插到侧边栏浏览区之前（幂等）；返回是否已就位。 */
function ensureHostPlaced(ctx: ClientContext): boolean {
  const anchor = document.querySelector(ANCHOR_SELECTOR)
  if (anchor === null) return false
  const parent = anchor.parentElement
  if (parent === null) return false
  if (host === null) {
    // 首次：创建容器 + React 根（容器稍后才入树，React 18 支持）。
    host = document.createElement('div')
    host.id = HOST_ID
    host.dataset.plugin = '@dsh-external/dsh-webui'
    root = createRoot(host)
    root.render(<AutomationApp ctx={ctx} />)
  }
  // 已在正确位置（浏览区容器的直接前子节点）则不动，避免打断侧边栏布局。
  if (host.parentElement === parent && host.nextElementSibling === anchor) return true
  parent.insertBefore(host, anchor)
  return true
}

/**
 * 挂载自动化模块（幂等）。返回清理函数（停轮询、卸载 React 树、移除 host）。
 */
export function mountAutomation(ctx: ClientContext): () => void {
  if (typeof document === 'undefined') return () => {}
  if (root !== null) return () => {}

  ensureHostPlaced(ctx)
  // 低频轮询兜底：侧边栏整体重挂（HMR / 插件热重载）导致 host 失联后自动补位。
  pollTimer = window.setInterval(() => {
    if (host === null || !host.isConnected) ensureHostPlaced(ctx)
  }, 1500)

  return () => {
    window.clearInterval(pollTimer)
    pollTimer = 0
    host?.remove()
    host = null
    root?.unmount()
    root = null
  }
}
