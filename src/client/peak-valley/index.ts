/**
 * DeepSeek 峰谷时刻 —— client 注册：sidebar.footer.action（order 0，
 * 位于用量/技能/记忆之前）。卡片独占首行显示在 footer 动作区上方。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PeakValleyCard } from './PeakValleyCard'
import { ensureStyles } from './styles'

export function applyPeakValley(ctx: ClientContext): void {
  ensureStyles()
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'deepseek-peak-valley',
      order: 0,
    }, PeakValleyCard))
}
