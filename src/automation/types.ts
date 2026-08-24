/**
 * automation — 类型定义（参考 openhanako automation v4 契约，单 Agent 形态）。
 *
 * 一个自动化任务（job）= 触发器（at / every / cron）+ 一段让 Agent 执行的
 * prompt（可选指定模型）。到期时由调度器在服务进程内真实执行一次模型调用，
 * 并把每次运行落一条 jsonl 运行记录。
 *
 * 与 openhanako 的字段差异（功能等价的前提下按 DSH 单 Agent 形态裁剪）：
 * 无 studioId / actorAgentId / executionContext / executor（DSH 只有一种
 * 执行者——本进程 Agent；执行方式固定为 agent run）。
 */

/** 存储契约版本：读取到更高版本的 job 时跳过执行（前向兼容）。 */
export const AUTOMATION_SCHEMA_VERSION = 1

/** 调度类型。 */
export type JobType = 'at' | 'every' | 'cron'

/** 模型引用：空串 = 使用默认模型；对象 = 显式 provider/model 复合键。 */
export type ModelRef = '' | { id: string, provider?: string }

/** 一个定时任务。 */
export interface CronJob {
  readonly id: string
  /** 写入时的存储契约版本。 */
  schemaVersion: number
  /** 配置修订号：任何影响执行的编辑都会自增（乐观锁 / 运行中防错写）。 */
  configRevision: number
  /** 调度类型。 */
  type: JobType
  /**
   * 调度参数：
   *  - at    → ISO 时间字符串（一次性目标时刻）
   *  - every → 间隔毫秒数（≥ 60_000）
   *  - cron  → 标准 5 字段 cron 表达式「分 时 日 月 周」
   */
  schedule: string | number
  /** 到期时交给 Agent 执行的指令。 */
  prompt: string
  /** 显示名（缺省取 prompt 前 30 字符）。 */
  label: string
  /** 执行模型（空 = 默认模型）。 */
  model: ModelRef
  /** 启用开关（false = 调度器跳过）。 */
  enabled: boolean
  /** 连续失败次数（成功清零；驱动退避）。 */
  consecutiveErrors: number
  /** 创建时间 ISO。 */
  createdAt: string
  /** 上次运行时间 ISO。 */
  lastRunAt: string | null
  /** 下次运行时间 ISO（null = 不再触发，如已过期的一次性任务）。 */
  nextRunAt: string | null
}

/** 存储文档（cron-jobs.json）。 */
export interface CronStoreDocument {
  storeRevision: number
  jobs: CronJob[]
  nextNum: number
}

/** 单次运行记录（cron-runs/<jobId>.jsonl 的一行）。 */
export interface RunRecord {
  status: 'success' | 'error' | 'skipped'
  /** 记录落盘时刻 ISO。 */
  timestamp: string
  startedAt?: string
  finishedAt?: string
  /** 成功时的输出摘要。 */
  summary?: string
  /** 失败原因。 */
  error?: string
  /** skipped 原因（仍在执行 / schema 不支持等）。 */
  reason?: string
  /** 本次运行期间任务被编辑，游标未推进。 */
  staleConfigRevision?: boolean
  /** 记录时的存储契约版本（schema skip 场景附带）。 */
  schemaVersion?: number
  /** 成功时完整产出的文件名（runs/<jobId>/ 目录下）。 */
  file?: string
  /** 触发来源：schedule=调度器到期触发；manual=用户/AI 手动「立即运行」。 */
  trigger?: 'schedule' | 'manual'
  /** 本次执行实际使用的模型（provider/model）。 */
  model?: string
}

/** addJob 入参。 */
export interface AddJobInput {
  type: JobType
  schedule: string | number
  prompt: string
  label?: string
  model?: ModelRef
  enabled?: boolean
}

/** updateJob 允许修改的字段子集。 */
export type UpdateJobPatch = Partial<Pick<CronJob,
  'label' | 'model' | 'schedule' | 'prompt' | 'enabled' | 'type'
>>

/** 带 code/status 的可识别错误（路由层转 HTTP 状态码）。 */
export class CodedError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status = 409) {
    super(message)
    this.name = 'CodedError'
    this.code = code
    this.status = status
  }
}

/** 归一化模型引用：'' 或 {id[,provider]}。 */
export function normalizeModelRef(model: unknown): ModelRef {
  if (model === null || model === undefined || model === '') return ''
  if (typeof model === 'string') {
    const value = model.trim()
    if (value === '') return ''
    const slash = value.indexOf('/')
    if (slash > 0 && slash < value.length - 1) {
      return { id: value.slice(slash + 1), provider: value.slice(0, slash) }
    }
    return { id: value }
  }
  if (typeof model === 'object') {
    const raw = model as { id?: unknown, provider?: unknown }
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (id === '') return ''
    const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
    return provider !== '' ? { id, provider } : { id }
  }
  return ''
}

/** job 归一化：补默认值、规范 model、钳制 every 最小间隔。 */
export function normalizeJob(job: CronJob): CronJob {
  return {
    ...job,
    schedule: job.type === 'every'
      ? Math.max(MIN_EVERY_INTERVAL_MS, typeof job.schedule === 'number' ? job.schedule : Number.parseInt(String(job.schedule), 10) || MIN_EVERY_INTERVAL_MS)
      : job.schedule,
    model: normalizeModelRef(job.model),
    schemaVersion: Number.isInteger(job.schemaVersion) && job.schemaVersion > AUTOMATION_SCHEMA_VERSION
      ? job.schemaVersion
      : AUTOMATION_SCHEMA_VERSION,
    configRevision: Number.isSafeInteger(job.configRevision) && job.configRevision > 0 ? job.configRevision : 1,
    consecutiveErrors: Number.isFinite(job.consecutiveErrors) ? job.consecutiveErrors : 0,
  }
}

/** every 类型的最小间隔（毫秒）。 */
export const MIN_EVERY_INTERVAL_MS = 60_000

/** 从 label / prompt 推导显示名。 */
export function deriveJobLabel({ label, prompt }: { label?: string, prompt?: string }): string {
  if (typeof label === 'string' && label.trim() !== '') return label.trim()
  if (typeof prompt === 'string' && prompt.trim() !== '') return prompt.slice(0, 30)
  return ''
}
