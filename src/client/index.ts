/**
 * webui — client 半身：注册会话头部右上角视图图块 + 消息入口 + 供应商标签。
 *
 * 槽位：
 *  - conversation.session.header.utilities（右上角，list，session）：「对话/轨迹」
 *    图块按钮（接管原生标签页切换）+「消息」按钮；右侧渲染消息横条面板。
 *  - conversation.input.right（composer 工具行，list，session）：供应商标签，显示
 *    当前模型的供应商名（数据来自 ui-model-selection 的共享 ModelDirectory）。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 modelDirectories 服务的 Context 声明（ui-model-selection 提供）。
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（槽位注册的类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Webui } from './Webui'
import { ProviderBadge, type ProviderBadgeInjected } from './ProviderBadge'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // 右上角「对话/轨迹」图块 + 消息入口。
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'webui',
      order: 10,
    }, Webui))

  // 供应商标签：等 modelDirectories 服务（ui-model-selection 提供）就绪后再注册；
  // 未安装该插件时此段不执行，供应商标签自然不出现。
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
}
