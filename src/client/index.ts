/**
 * webui — client 半身（合并了 dsh-tool-summary 与 dsh-better-markdown）：
 *
 *  1. 会话头部右上角视图图块 + 消息入口 + 供应商标签（原生 webui 能力）。
 *  2. 工具调用聚合（tool-call shadow + 活动抽屉）。
 *  3. 助手 Markdown 渲染（markstream-react）+ 思考 chip（实时时长 / 实时文字滚动）。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 modelDirectories 服务的 Context 声明（ui-model-selection 提供）。
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（槽位注册的类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: 激活 ui-tool 的 SlotMap 合并（conversation.chat.node 的 tool-call key）。
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { removeCustomComponents, setCustomComponents } from 'markstream-react'
import 'markstream-react/index.css'
import './markdown/styles.css'
import { Webui } from './Webui'
import { ProviderBadge, type ProviderBadgeInjected } from './ProviderBadge'
import {
  BetterAssistantNodeView, DshCodeBlockNode, DshImageNode, DshInlineCodeNode, DshLinkNode,
} from './markdown/renderer'
import { ToolGroupNodeView } from './tool-summary/ToolGroupNodeView'
import { mountActivityDrawer } from './tool-summary/activity-drawer'
import { injectStyles as injectToolSummaryStyles } from './tool-summary/styles'

const CUSTOM_COMPONENT_SCOPE = 'dsh-better-markdown'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // ---- 原生 webui：右上角「对话/轨迹」图块 + 消息入口 --------------------
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'webui',
      order: 10,
    }, Webui))

  // 供应商标签：等 modelDirectories 服务（ui-model-selection 提供）就绪后再注册。
  ctx.inject(['slots', 'modelDirectories'], (scope) => {
    const models = scope.modelDirectories
    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right',
      id: 'webui-provider',
      order: 10,
      inject: (sessionId: SessionId): ProviderBadgeInjected => {
        const directory = models.directoryFor(sessionId)
        return { directory: directory.store }
      },
    }, ProviderBadge))
  })

  // ---- dsh-tool-summary：工具调用聚合 + 活动抽屉 -------------------------
  injectToolSummaryStyles()
  mountActivityDrawer()
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'tool-call',
    priority: -100,
    locale: 'conversation',
  }, ToolGroupNodeView))

  // ---- dsh-better-markdown：markstream 渲染 + 思考 chip -------------------
  ctx.effect(() => {
    setCustomComponents(CUSTOM_COMPONENT_SCOPE, {
      code_block: DshCodeBlockNode,
      image: DshImageNode,
      inline_code: DshInlineCodeNode,
      link: DshLinkNode,
    })
    return () => { removeCustomComponents(CUSTOM_COMPONENT_SCOPE) }
  }, 'webui: markstream component policy')

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    priority: -100,
    locale: 'conversation',
  }, BetterAssistantNodeView))
}
