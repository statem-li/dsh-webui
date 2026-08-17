/**
 * dsh-session-message-nav — client 半身：注册会话头部右上角动作按钮。
 *
 * 槽位：conversation.session.header.utilities（右上角工具区，list，session 作用域）。
 * 注册后每个会话右上角出现「消息」按钮：点击弹出该会话全部已发送消息；
 * 右侧同时渲染消息横条面板（见 SessionMessageNav.tsx）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（槽位注册的类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionMessageNav } from './SessionMessageNav'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'session-message-nav',
      order: 10,
    }, SessionMessageNav))
}
