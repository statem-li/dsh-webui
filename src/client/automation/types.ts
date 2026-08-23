/**
 * automation — client 类型定义（与 host /api/webui-automation 载荷同构；
 * host 与 client 分 bundle，不得跨半身 import，故在此重复声明）。
 */

/** 调度类型。 */
export type JobType = 'at' | 'every' | 'cron'

/** 模型引用：'' = 默认模型；{id, provider} = 显式指定。 */
export type ModelRef = '' | { id: string, provider?: string }

/** 一个定时自动化任务（服务端存储形态）。 */
export interface CronJob {
  readonly id: string
  schemaVersion: number
  configRevision: number
  type: JobType
  schedule: string | number
  prompt: string
  label: string
  model: ModelRef
  enabled: boolean
  consecutiveErrors: number
  createdAt: string
  lastRunAt: string | null
  nextRunAt: string | null
}

/** 单次运行记录。 */
export interface RunRecord {
  status: 'success' | 'error' | 'skipped'
  timestamp: string
  startedAt?: string
  finishedAt?: string
  summary?: string
  error?: string
  reason?: string
  staleConfigRevision?: boolean
  /** 成功时完整产出的文件名（经 /runs/file 读取全文）。 */
  file?: string
}

/** 待确认的 AI 建议。 */
export interface SuggestionView {
  suggestionId: string
  shortCode: string
  operation: 'create' | 'update'
  jobId: string | null
  baseConfigRevision: number | null
  jobData: Partial<CronJob> & { type: JobType, schedule: string | number }
  createdAt: number
  expiresAt: number
}

/** 模型可选项（模型目录扁平化，按 provider 分组展示）。 */
export interface ModelOption {
  readonly provider: string
  readonly providerName: string
  readonly id: string
  readonly name: string
}

/** 任务运行历史查询响应。 */
export interface RunsResponse {
  ok: boolean
  runs: Array<RunRecord & { jobId?: string, jobLabel?: string }>
}

/** 完成事件（host /events 载荷；与 host routes.ts 的 AutomationEvent 同构）。 */
export interface AutomationEvent {
  seq: number
  at: number
  jobId: string
  jobLabel: string
  status: 'success' | 'error' | 'skipped'
  summary?: string
  error?: string
}
