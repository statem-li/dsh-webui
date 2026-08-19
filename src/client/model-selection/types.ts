/**
 * dsh-webui 模型选择增强 — 共享类型。
 *
 * 与 ui-model-selection 的 `ModelSelectInjected` 同构：接管模型座位后，
 * 我们仍通过 `ctx.modelDirectories` 服务读取同一个 per-session
 * {@link ModelDirectory}，因此两个入口（模型 + 推理等级）共享同一份
 * Host 选择事实，切换即时互见。
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'

/** 模型座位 / 推理等级入口共用的注入业务面。 */
export interface ModelSeatInjected {
  /** 本会话是否支持 Agent 级模型选择（addressed subagent 会话为 false）。 */
  available: boolean
  /** 会话共享的模型目录 store（与 /model 弹窗同源）。 */
  directory: SnapshotStore<ModelDirectoryState>
  /** 刷新目录（fire-and-forget，错误落在 store 上）。 */
  load: () => void
  /**
   * 提交完整 provider/model/reasoning 选择。
   * @param selection - 模型选择 + 可选推理等级。
   * @returns Host 是否接受。
   */
  select: (selection: ModelSelection) => Promise<boolean>
}
