/**
 * webui — 提示词优化入口（client 半身）。
 *
 * 通过 `conversation.input.right` 槽位在供应商标签（ProviderBadge，order 10）
 * 左侧注册「自动优化提示词」图标（order 5）。数据走 host 半身已挂载的
 * /api/webui-prompt-optimize，模型选择读取与模型座位同源的 per-session
 * ModelDirectory。开关「设定目标」开启时，优化完成后直接把草稿写回为
 * `/goal <优化文本>` 命令，交由 DSH 既有 /goal 命令在用户发送后创建目标，
 * 零 DSH 源码改动。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（input.right 槽位契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PromptOptimizeButton } from './PromptOptimizeButton'
import type { PromptOptimizeInjected } from './PromptOptimizeButton'

/**
 * 挂载提示词优化图标入口。
 * @param ctx - client root context。
 */
export function applyPromptOptimize(ctx: ClientContext): void {
  ctx.inject(['slots', 'modelDirectories', 'sessions'], (scope) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions

    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right',
      id: 'webui-prompt-optimize',
      // 供应商标签 order 10、模型座位 order 20；本图标 order 5 位于供应商左侧。
      order: 5,
      inject: (sessionId: SessionId): PromptOptimizeInjected => {
        const directory = models.directoryFor(sessionId)
        return {
          available: sessions.subagentAddress(sessionId) === undefined,
          directory: directory.store,
          // 会话 id：POST 优化请求时回传，供 host 端「显式停止」定位本次优化。
          sessionId,
        }
      },
    }, PromptOptimizeButton))
  })
}
