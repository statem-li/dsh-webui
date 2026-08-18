/**
 * webui — client 半身：注册会话头部右上角视图图块 + 消息入口。
 *
 * 槽位：conversation.session.header.utilities（右上角工具区，list，session 作用域）。
 * 注册后每个会话右上角出现「对话/轨迹」图块按钮（接管原生标签页切换）与
 * 「消息」按钮；右侧同时渲染消息横条面板（见 Webui.tsx）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（槽位注册的类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Webui } from './Webui'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'webui',
      order: 10,
    }, Webui))
}
