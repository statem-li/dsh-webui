/**
 * @dsh-external/dsh-browser — client 半身：
 *  1. 设置页「允许 AI 使用浏览器」+「无头模式」开关。
 *  2. 会话内浏览器常驻按钮（conversation.input.left，记忆开关旁）+ 内嵌画面/时间线面板。
 *  3. 侧边栏会话列表浏览器标识（DOM 注入）。
 *  4. 浏览器活动轮询 store。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-settings 的 SlotMap 合并声明（槽位注册的类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并（input.left 类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BrowserAllowSetting } from './BrowserAllowDock'
import { BrowserSeat } from './BrowserActivityDock'
import { browserActivityStore } from './activity'
import { applySessionListIndicator } from './session-list-indicator'
import { injectBrowserStyles } from './styles'

export function applyBrowserClient(ctx: ClientContext): void {
  // ---- 设置页「允许 AI 使用浏览器」开关 --------------------------------
  ctx.effect(() => ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-browser',
      order: 30,
      label: () => 'dsh-browser',
    }, BrowserAllowSetting),
  ), '@dsh-external/dsh-browser: allow setting')

  // ---- 样式 + 活动轮询 store + 侧边栏标识 -----------------------------
  ctx.effect(() => {
    const removeStyles = injectBrowserStyles()
    const store = browserActivityStore()
    store.startPolling()
    const stopIndicator = applySessionListIndicator(ctx)
    return () => {
      stopIndicator()
      store.stopPolling()
      removeStyles()
    }
  }, '@dsh-external/dsh-browser: activity + indicator')

  // ---- 会话内浏览器常驻按钮（输入框工具行左端，记忆开关旁）------------
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'dsh-browser-seat',
    order: 100,
  }, BrowserSeat))
}
