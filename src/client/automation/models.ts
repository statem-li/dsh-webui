/**
 * automation — 模型目录接入。
 *
 * 复用 DSH 的 per-session 模型目录（ui-model-selection 提供）：
 * 当前会话 id 取自 `sessions.currentProvideInfo`，目录经
 * `modelDirectories.directoryFor(sessionId)` 加载，扁平化为
 * ModelOption[]（provider 分组 + 每模型的推理强度元数据）。
 * 服务晚于插件就绪时由 ctx.inject 等待；无会话时返回空列表。
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only：激活 modelDirectories 服务的 Context 合并声明。
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelOption } from './types.ts'

/** 模型目录读取面（AutomationApp 持有，抽屉表单消费）。 */
export interface ModelSource {
  /** 加载并返回当前可用模型（失败/无会话返回空数组，不抛出）。 */
  load: () => Promise<ModelOption[]>
}

/** provider 分组目录 → 扁平模型选项。 */
function flattenGroups(groups: readonly ModelProviderGroup[]): ModelOption[] {
  return groups.flatMap(group => group.models.map(model => ({
    provider: group.id,
    providerName: group.name,
    id: model.id,
    name: model.name,
    efforts: model.reasoning?.efforts ?? [],
    defaultEffort: model.reasoning?.defaultEffort,
  })))
}

/**
 * 从 client 上下文构建模型目录读取面。
 * ctx.inject 等待 modelDirectories/sessions 服务就绪后再接线。
 */
export function createModelSource(ctx: ClientContext): ModelSource {
  let loadImpl: (() => Promise<ModelOption[]>) | null = null
  try {
    ctx.inject(['modelDirectories', 'sessions'], (scope) => {
      const models = scope.modelDirectories
      const sessions = scope.sessions
      loadImpl = async (): Promise<ModelOption[]> => {
        const info = sessions.currentProvideInfo.getSnapshot()
        const sessionId = (info as { sessionId?: SessionId } | undefined)?.sessionId
        if (sessionId === undefined) return []
        const directory = models.directoryFor(sessionId)
        try {
          await directory.load()
        } catch { /* 失败保留 last-good 目录 */ }
        const state = directory.store.getSnapshot()
        return flattenGroups(state.groups)
      }
    })
  } catch {
    loadImpl = null
  }
  return {
    load: async (): Promise<ModelOption[]> => {
      if (loadImpl === null) return []
      try {
        return await loadImpl()
      } catch {
        return []
      }
    },
  }
}
