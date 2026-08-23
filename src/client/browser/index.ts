/**
 * @dsh-external/dsh-browser — client 半身：
 *  1. 会话内浏览器常驻按钮（conversation.input.left，记忆开关旁）+ 右侧滑出预览抽屉
 *     （hover 权限卡片含「禁止 AI 使用浏览器」+「提速模式」两个开关）。
 *  2. 侧边栏会话列表浏览器标识（DOM 注入）。
 *  3. 浏览器活动轮询 store。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并（input.left 类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BrowserSeat } from './BrowserActivityDock'
import { browserActivityStore } from './activity'
import { applySessionListIndicator } from './session-list-indicator'
import { injectBrowserStyles } from './styles'

export function applyBrowserClient(ctx: ClientContext): void {
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

  // ---- 会话内浏览器常驻按钮（输入框工具行左端，记忆开关右侧）------------
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'dsh-browser-seat',
    order: 101,
  }, BrowserSeat))
}
