/**
 * dsh-webui 模型选择增强 — 注册入口。
 *
 * 通过 `ctx.modelDirectories`（ui-model-selection 提供）共享 per-session
 * ModelDirectory，注册两个入口（左→右：模型名、推理等级）：
 *  1. `conversation.input.right`（ProviderBadge 之后）→ 纯模型选择器。
 *  2. `conversation.input.model`（priority 为负，覆盖自带 ModelSelect）→ 推理等级滑动式弹出。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（input.model / input.right）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelSeatInjected } from './types'
import { ModelSeat } from './ModelSeat'
import { EffortSeat } from './EffortSeat'

/**
 * 挂载模型座位接管 + 推理等级入口。
 * @param ctx - client root context。
 */
export function applyModelSeats(ctx: ClientContext): void {
  ctx.inject(['slots', 'modelDirectories', 'sessions'], (scope) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions

    const face = (sessionId: SessionId): ModelSeatInjected => {
      const directory = models.directoryFor(sessionId)
      const available = sessions.subagentAddress(sessionId) === undefined
      return {
        available,
        directory: directory.store,
        load: () => {
          if (available) directory.load().catch(() => { /* 错误落在 store 上 */ })
        },
        select: (selection: ModelSelection) => available
          ? directory.select(selection).then(() => true, () => false)
          : Promise.resolve(false),
      }
    }

    // 模型选择入口：工具行右侧，ProviderBadge（order 10）之后。
    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right',
      id: 'webui-model',
      order: 20,
      inject: (sessionId: SessionId): ModelSeatInjected => face(sessionId),
    }, ModelSeat))

    // 推理等级：接管模型座位（负数 priority 覆盖 ui-model-selection 的 ModelSelect），
    // 位于模型名右侧、靠近发送按钮。
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      priority: -100,
      inject: (sessionId: SessionId): ModelSeatInjected => face(sessionId),
    }, EffortSeat))
  })
}
