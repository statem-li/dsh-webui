/**
 * team — client 半身装配入口。
 *
 * 三个挂载点：
 *  1. 侧边栏导航行「团队」入口 + 右侧滑出面板（team 槽位，PlanWeave 之后）。
 *  2. 对话框「团队」开关（conversation.input.right，order 4，提示词优化左侧）。
 *  3. 对话流悬浮执行 HUD（fixed 浮层，贴对话区顶部）。
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only：激活 ui-conversation 的 SlotMap 合并声明（input.right 槽位契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TeamNavApp } from './Panel.tsx'
import { TeamToggle, type TeamToggleInjected } from './ChatToggle.tsx'
import { RunHud } from './RunHud.tsx'
import { ensureNavMount } from '../sidebar-nav.js'
import { ensureTeamStyles } from './styles.ts'

/** 挂载 team client 模块。 */
export function applyTeamClient(ctx: ClientContext): void {
  ensureTeamStyles()

  // 1) 侧边栏导航行 + 面板。
  ctx.effect(() => {
    ensureNavMount()
    const holder = document.createElement('div')
    const root = createRoot(holder)
    root.render(createElement(TeamNavApp))
    return () => { root.unmount() }
  }, 'webui: team nav entry')

  // 2) 对话框团队开关（与 prompt-optimize 同款挂载：order 4 在其左侧）。
  ctx.inject(['slots', 'sessions'], (scope) => {
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right',
      id: 'webui-team-toggle',
      order: 4,
      inject: (sessionId: SessionId): TeamToggleInjected => ({
        available: sessions.subagentAddress(sessionId) === undefined,
        sessionId,
      }),
    }, TeamToggle))
  })

  // 3) 对话流执行 HUD（独立 fixed 浮层，随插件生命周期挂载/卸载）。
  ctx.effect(() => {
    const holder = document.createElement('div')
    holder.dataset.plugin = '@dsh-external/dsh-webui'
    document.body.appendChild(holder)
    const root = createRoot(holder)
    root.render(createElement(RunHud, { ctx }))
    return () => {
      root.unmount()
      holder.remove()
    }
  }, 'webui: team run hud')
}
