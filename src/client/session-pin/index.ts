/**
 * session-pin — 会话置顶 / 归档按钮 / 右键菜单（client 半身入口）。
 *
 * 装配四件事：
 *  1. 样式注入（归档按钮 / 置顶标记 / 右键菜单 / 重命名弹窗）。
 *  2. 置顶列表跨标签页同步（storage 事件）。
 *  3. 常驻覆盖层（右键菜单 + 重命名弹窗，portal 到 body）。
 *  4. 核心 DOM 维护器（置顶排序 + 归档按钮注入 + 右键菜单触发）。
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { injectSessionPinStyles } from './styles'
import { SessionPinOverlay } from './context-menu'
import { startSessionPin } from './maintainer'
import { installPinnedStorageSync } from './store'

/** 覆盖层挂载节点 id。 */
const OVERLAY_ID = 'dsh-webui-session-pin-overlay'

/**
 * 启动会话置顶功能（webui 组合调用）。
 * @param ctx - 浏览器插件上下文（读取 sessions / workspaces 服务）。
 */
export function applySessionPin(ctx: ClientContext): void {
  if (typeof document === 'undefined') return

  // 样式：随插件生命周期注入/移除。
  ctx.effect(() => injectSessionPinStyles(), 'webui: session pin styles')

  // 置顶列表跨标签页同步。
  ctx.effect(() => installPinnedStorageSync(), 'webui: session pin storage sync')

  // 常驻覆盖层：右键菜单 + 重命名弹窗。
  ctx.effect(() => {
    let host = document.getElementById(OVERLAY_ID)
    if (host === null) {
      host = document.createElement('div')
      host.id = OVERLAY_ID
      host.dataset.plugin = '@dsh-external/dsh-webui'
      document.body.appendChild(host)
    }
    const root = createRoot(host)
    root.render(createElement(SessionPinOverlay))
    return () => { root.unmount() }
  }, 'webui: session pin overlay')

  // 核心维护器：置顶排序 + 归档按钮 + 右键菜单触发。
  ctx.effect(() => startSessionPin(ctx), 'webui: session pin maintainer')
}
