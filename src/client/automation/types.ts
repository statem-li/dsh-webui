/**
 * automation — 类型定义（v2）。
 *
 * 「自动化」卡片为 TAB 式：定时 / 执行任务 / 执行日志。
 *  - ScheduleConfig：「定时」页配置（执行日期 + 每日开关）；
 *  - AutomationTask：「执行任务」页的任务（可绑定模型与推理强度，归入分类）；
 *  - AutomationLogEntry：「执行日志」页的记录（每天有没有执行都有据可查）。
 */

/** 「定时」页配置（localStorage 持久化）。 */
export interface ScheduleConfig {
  /** 执行日期（本地时区 yyyy-MM-dd）；空字符串表示未设定。 */
  date: string
  /** 是否每天定时执行。 */
  daily: boolean
}

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

/** 自动化任务：被执行的对象（「执行任务」页新建/管理）。 */
export interface AutomationTask {
  readonly id: string
  /** 任务名称。 */
  name: string
  /** 归入的分类 id。 */
  categoryId: string
  /** 绑定的模型 id（provider 内）。 */
  model?: string
  /** 模型所属 provider 路由 id。 */
  provider?: string
  /** 推理强度（adapter effort id）；缺省 = 模型默认。 */
  effort?: string
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

/** 执行状态。 */
export type AutomationLogStatus = 'success' | 'failed'

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
  /** 记录时间戳（排序/展示时刻）。 */
  createdAt: number
}
