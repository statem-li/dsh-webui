/**
 * automation — DOM 注入挂载。
 *
 * 「自动化」菜单项必须出现在「新会话」按钮正下方（sidebar.workspaces 是
 * single 插槽，无法再注册条目），因此沿用 DOM 注入契约：
 *  - 锚点 = `[data-slot="sidebar.workspaces"]`（slots 渲染器的稳定锚 div）；
 *  - host div（#dsh-automation-menu-host）插到该容器之前——AutomationApp
 *    在 host 内随 React 树渲染 skills / memory 合并行槽位（与自动化按钮
 *    同行，见 AutomationApp），用量/团队等其余导航行排在 host 之后；
 *    外部脚本不往 host 里 append 节点（会与 React 首次提交竞态）；
 *  - 低频轮询兜底：侧边栏整体重挂（HMR/插件重载）后自动重新插入。
 */

import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { AutomationApp } from './AutomationApp.tsx'

const HOST_ID = 'dsh-automation-menu-host'
/** slots 渲染器给每个插槽渲染的稳定锚点（scoped-slots.tsx 的 ANCHOR 契约）。 */
const ANCHOR_SELECTOR = '[data-slot="sidebar.workspaces"]'

/** 旧版自动化（localStorage 形态）遗留的存储键：彻底废除时顺手清掉。 */
const LEGACY_STORAGE_KEYS = [
  'dsh-webui.automation.tasks.v2',
  'dsh-webui.automation.tasks.v3',
  'dsh-webui.automation.logs.v2',
]

let root: Root | null = null
let host: HTMLDivElement | null = null
let pollTimer = 0
let retryTimer = 0

/** 清理旧版 localStorage 遗留（幂等、静默）。 */
function purgeLegacyStorage(): void {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
  } catch { /* ignore */ }
}

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
 * 首屏快速就位：anchor 由框架 slots 渲染器稍后给出时，以 100ms 步进重试
 * ~1.5s；期间仍未就位再交给低频轮询兜底。避免干等下一个 1.5s tick。
 */
function placeWithRetry(ctx: ClientContext): void {
  window.clearTimeout(retryTimer)
  let tries = 0
  const step = (): void => {
    tries += 1
    if (ensureHostPlaced(ctx)) return
    if (tries < 15) retryTimer = window.setTimeout(step, 100)
  }
  step()
}

/**
 * 挂载自动化模块（幂等）。返回清理函数（停轮询、卸载 React 树、移除 host）。
 */
export function mountAutomation(ctx: ClientContext): () => void {
  if (typeof document === 'undefined') return () => {}
  if (root !== null) return () => {}

  purgeLegacyStorage()
  placeWithRetry(ctx)
  // 低频轮询兜底：侧边栏整体重挂（HMR / 插件热重载）导致 host 失联后自动补位。
  pollTimer = window.setInterval(() => {
    if (host === null || !host.isConnected) ensureHostPlaced(ctx)
  }, 1500)

  return () => {
    window.clearTimeout(retryTimer)
    window.clearInterval(pollTimer)
    pollTimer = 0
    host?.remove()
    host = null
    root?.unmount()
    root = null
  }
}
