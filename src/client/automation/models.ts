/**
 * automation — 模型目录接入。
 *
 * 复用 DSH 的 per-session 模型目录（ui-model-selection 提供）：当前会话 id
 * 取自 `sessions.currentProvideInfo`，目录经 `modelDirectories.directoryFor`
 * 加载，扁平化为 ModelOption[]（按 provider 分组展示）。服务晚于插件就绪时
 * 由 ctx.inject 等待；无会话时返回空列表（任务可留空 = 默认模型）。
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only：激活 modelDirectories 服务的 Context 合并声明。
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelOption } from './types.ts'

/** 模型目录读取面。 */
export interface ModelSource {
  /** 加载并返回当前可用模型（失败/无会话返回空数组，不抛出）。 */
  load: () => Promise<ModelOption[]>
}

function flattenGroups(groups: readonly ModelProviderGroup[]): ModelOption[] {
  return groups.flatMap(group => group.models.map(model => ({
    provider: group.id,
    providerName: group.name,
    id: model.id,
    name: model.name,
  })))
}

/** 从 client 上下文构建模型目录读取面。 */
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

/** job.model → select 的 value（provider/id）。 */
export function modelSelectValue(model: unknown): string {
  if (model === null || model === undefined || model === '') return ''
  if (typeof model === 'object') {
    const raw = model as { id?: string, provider?: string }
    if (raw.id === undefined || raw.id === '') return ''
    return raw.provider !== undefined && raw.provider !== '' ? `${raw.provider}/${raw.id}` : raw.id
  }
  return String(model)
}

/** select value → 存储的 ModelRef。 */
export function modelValueFromSelect(value: string): '' | { id: string, provider?: string } {
  if (value === '') return ''
  const slash = value.indexOf('/')
  if (slash > 0 && slash < value.length - 1) {
    return { provider: value.slice(0, slash), id: value.slice(slash + 1) }
  }
  return { id: value }
}
