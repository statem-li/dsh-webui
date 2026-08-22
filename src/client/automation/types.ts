/**
 * automation — 类型定义（v4）。
 *
 * 「自动化」卡片为 TAB 式：执行任务 / 执行日志。
 *  - AutomationTask：「执行任务」页的任务——每个任务自带执行计划（schedule）
 *    与执行步骤（steps：一个有序的动作序列，每步带失败分支 onError），
 *    可绑定模型与推理强度、配置失败重试，归入分类，可启用/停用；
 *  - AutomationLogEntry：「执行日志」页的记录——每次执行后落一条记录，含
 *    每步结果（成功/失败/跳过 + 输出摘要 + 失败原因）与生成的文件清单。
 */

import type { StoredSchedule } from './schedule.ts'

/** 推理强度选项（来自模型目录的 adapter 元数据）。 */
export interface EffortOption {
  readonly id: string
  readonly name: string
}

/** 模型可选项（模型目录扁平化，按 provider 分组展示）。 */
export interface ModelOption {
  /** provider 路由 id。 */
  readonly provider: string
  /** provider 显示名。 */
  readonly providerName: string
  /** provider 内的模型 id。 */
  readonly id: string
  /** 模型显示名。 */
  readonly name: string
  /** 该模型可选的推理强度（adapter 声明顺序）。 */
  readonly efforts: readonly EffortOption[]
  /** adapter 配置的默认强度；缺省用 provider 默认。 */
  readonly defaultEffort?: string
}

/** 步骤失败分支：stop = 停止整个任务；skip = 跳过本步继续后续步骤。 */
export type StepOnError = 'stop' | 'skip'

/** 一个执行步骤 = 一个动作（generate）+ 失败分支 + 可选文件输出。 */
export interface AutomationStep {
  readonly id: string
  /** 步骤名（展示用，如「生成日报正文」）。 */
  name: string
  /** 发送给 LLM 的执行指令（prompt）。 */
  prompt: string
  /** 本步失败时的条件分支。 */
  onError: StepOnError
  /** 是否把本步输出写入文件。 */
  saveToFile: boolean
  /** 输出文件名模板；支持 {date}（yyyy-MM-dd）与 {time}（HHmm）占位。 */
  fileName: string
}

/** 自动化任务：被执行的对象（「执行任务」页新建/管理）。 */
export interface AutomationTask {
  readonly id: string
  /** 任务名称。 */
  name: string
  /** 归入的分类 id。 */
  categoryId: string
  /** 执行计划（缺省 = 每天 09:00）。 */
  schedule?: StoredSchedule
  /** 启用开关（缺省启用；false = 停用，调度器跳过）。 */
  enabled?: boolean
  /** 绑定的模型 id（provider 内）。 */
  model?: string
  /** 模型所属 provider 路由 id。 */
  provider?: string
  /** 推理强度（adapter effort id）；缺省 = 模型默认。 */
  effort?: string
  /** 执行步骤（v4；缺省 = 单步默认动作）。 */
  steps?: AutomationStep[]
  /** 失败自动重试次数（0–3，默认 0）。 */
  retry?: number
}

/** 任务分类（有序）。 */
export interface AutomationCategory {
  readonly id: string
  label: string
}

/** 任务目录：分类 + 任务两个平表（日志/下拉都引用 categoryId/taskId）。 */
export interface AutomationCatalog {
  categories: AutomationCategory[]
  tasks: AutomationTask[]
}

/** 整体执行状态。 */
export type AutomationLogStatus = 'success' | 'failed'

/** 单个步骤的执行状态。 */
export type StepStatus = 'success' | 'failed' | 'skipped'

/** 单个步骤的执行结果。 */
export interface AutomationStepResult {
  readonly stepId: string
  /** 步骤名（冗余：步骤被删后仍可读）。 */
  name: string
  status: StepStatus
  /** 输出摘要（截断到前 200 字符）。 */
  summary?: string
  /** 生成的记录数（输出字符数）。 */
  recordCount?: number
  /** 失败原因。 */
  error?: string
}

/** 生成/修改的文件清单项。 */
export interface AutomationFileResult {
  /** 文件名。 */
  name: string
  /** 完整路径。 */
  path: string
  /** 文件大小（字节）。 */
  size: number
  /** 创建还是修改。 */
  action: 'created' | 'modified'
}

/** 一条执行记录（同任务同日只保留一条定时触发的记录）。 */
export interface AutomationLogEntry {
  readonly id: string
  readonly taskId: string
  /** 任务名冗余存储：任务被删除后记录仍可读。 */
  taskName: string
  /** 触发日期 yyyy-MM-dd。 */
  date: string
  status: AutomationLogStatus
  /** 备注（如使用的模型与强度）。 */
  detail?: string
  /** 失败原因（整体级，如「未绑定模型」）。 */
  error?: string
  /** 每步执行结果（v4）。 */
  steps?: AutomationStepResult[]
  /** 生成/修改的文件清单（v4）。 */
  files?: AutomationFileResult[]
  /** 记录时间戳（排序/展示时刻）。 */
  createdAt: number
}

/** host 执行引擎返回的单步结果（HTTP 载荷；与 AutomationStepResult 同构）。 */
export interface RunStepResult {
  stepId: string
  name: string
  status: StepStatus
  summary?: string
  recordCount?: number
  error?: string
}

/** host 执行引擎返回的文件项。 */
export interface RunFileResult {
  name: string
  path: string
  size: number
  action: 'created' | 'modified'
}

/** host /run 接口的响应载荷。 */
export interface AutomationRunResult {
  ok: boolean
  status: AutomationLogStatus
  steps: RunStepResult[]
  files: RunFileResult[]
  error?: string
}
