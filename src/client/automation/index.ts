/**
 * automation — 模块入口：把「自动化」接入 webui client。
 *
 * 菜单项不走 slots（sidebar.workspaces 为 single 插槽），改由 mount.tsx
 * 的 DOM 注入 + portal 实现；这里只负责插件生命周期内的挂载/清理。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { mountAutomation } from './mount.tsx'

/** 在 client 上下文中挂载自动化模块；随插件卸载自动清理。 */
export function applyAutomation(ctx: ClientContext): void {
  ctx.effect(() => mountAutomation(ctx), 'webui: automation')
}
