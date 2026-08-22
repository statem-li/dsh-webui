/**
 * automation — 本地持久化（localStorage，v3）。
 *
 * 两张表：任务目录（分类 + 任务平表，任务自带执行计划）/ 执行日志。
 * v3 起调度归属到每个任务（schedule 字段）；旧 v2 的全局「定时」配置
 * （date + daily）废弃不再迁移——v2 任务缺 schedule 时由缺省计划（每天 09:00）兜底。
 */

import type {
  AutomationCatalog,
  AutomationCategory,
  AutomationLogEntry,
  AutomationLogStatus,
  AutomationTask,
} from './types.ts'
import { DEFAULT_SCHEDULE, type StoredSchedule, type StoredScheduleType } from './schedule.ts'

const CATALOG_KEY = 'dsh-webui.automation.tasks.v3'
const LOGS_KEY = 'dsh-webui.automation.logs.v2'
/** v2 遗留键：目录一次性迁移（v3 键缺失时读取）。 */
const V2_CATALOG_KEY = 'dsh-webui.automation.tasks.v2'

function defaultCategories(): AutomationCategory[] {
  return [
    { id: 'cat-session', label: '会话管理' },
    { id: 'cat-skill', label: '技能执行' },
    { id: 'cat-prompt', label: '提示词任务' },
  ]
}

function defaultCatalog(): AutomationCatalog {
  return {
    categories: defaultCategories(),
    tasks: [
      { id: 'task-summarize', name: '总结昨日会话要点', categoryId: 'cat-session', schedule: { type: 'cron', schedule: '0 9 * * *' } },
      { id: 'task-usage-daily', name: '生成用量日报', categoryId: 'cat-skill', schedule: { type: 'cron', schedule: '0 18 * * *' } },
      { id: 'task-weekly', name: '撰写本周周报草稿', categoryId: 'cat-prompt', schedule: { type: 'cron', schedule: '0 9 * * 1' } },
    ],
  }
}

/** 生成本地唯一 id。 */
export function newId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`
    }
  } catch { /* 回退 */ }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 本地时区 yyyy-MM-dd。 */
export function todayString(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ---- 任务目录 ------------------------------------------------------------

export function loadCatalog(): AutomationCatalog {
  try {
    const raw = localStorage.getItem(CATALOG_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<AutomationCatalog>
      if (Array.isArray(parsed.categories) && Array.isArray(parsed.tasks)) {
        return sanitizeCatalog(parsed as AutomationCatalog)
      }
    }
    // v3 缺失 → v2 目录迁移（任务补缺省执行计划与启用态）。
    const v2 = localStorage.getItem(V2_CATALOG_KEY)
    if (v2 !== null) {
      const parsed = JSON.parse(v2) as Partial<AutomationCatalog>
      if (Array.isArray(parsed.categories) && Array.isArray(parsed.tasks)) {
        const migrated = sanitizeCatalog(parsed as AutomationCatalog)
        saveCatalog(migrated)
        return migrated
      }
    }
  } catch { /* 落默认 */ }
  const fresh = defaultCatalog()
  saveCatalog(fresh)
  return fresh
}

/** 宽松校验：丢弃形状不完整的分类/任务；schedule/enabled 归一化。 */
function sanitizeCatalog(catalog: AutomationCatalog): AutomationCatalog {
  const SCHEDULE_TYPES: readonly StoredScheduleType[] = ['every', 'cron', 'at']
  return {
    categories: catalog.categories.filter(cat => cat !== null && typeof cat === 'object'
      && typeof cat.id === 'string' && typeof cat.label === 'string'),
    tasks: catalog.tasks.filter(task => task !== null && typeof task === 'object'
      && typeof task.id === 'string' && typeof task.name === 'string'
      && typeof task.categoryId === 'string')
      .map(task => ({
        ...task,
        schedule: task.schedule !== undefined && task.schedule !== null
          && typeof task.schedule === 'object'
          && SCHEDULE_TYPES.includes((task.schedule as StoredSchedule).type as StoredScheduleType)
          ? (task.schedule as StoredSchedule)
          : { ...DEFAULT_SCHEDULE },
        enabled: task.enabled !== false,
      })),
  }
}

export function saveCatalog(catalog: AutomationCatalog): void {
  try { localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog)) } catch { /* 忽略 */ }
}

// ---- 执行日志 ------------------------------------------------------------

export function loadLogs(): AutomationLogEntry[] {
  try {
    const raw = localStorage.getItem(LOGS_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as AutomationLogEntry[]
      if (Array.isArray(parsed)) {
        return parsed.filter(entry => entry !== null && typeof entry === 'object'
          && typeof entry.id === 'string' && typeof entry.taskId === 'string'
          && typeof entry.date === 'string')
      }
    }
  } catch { /* 空 */ }
  return []
}

export function saveLogs(logs: AutomationLogEntry[]): void {
  try { localStorage.setItem(LOGS_KEY, JSON.stringify(logs)) } catch { /* 忽略 */ }
}

/**
 * 追加一条记录（调用方负责去重判断）；上限 500 条防膨胀，超出裁掉最旧的。
 */
export function appendLog(entry: AutomationLogEntry): AutomationLogEntry[] {
  const logs = [...loadLogs(), entry]
  const trimmed = logs.length > 500 ? logs.slice(logs.length - 500) : logs
  saveLogs(trimmed)
  return trimmed
}

/** 记录一条执行结果（供 scheduler 与手动触发共用）。 */
export function recordRun(task: AutomationTask, status: AutomationLogStatus, detail?: string): AutomationLogEntry {
  const entry: AutomationLogEntry = {
    id: newId('log'),
    taskId: task.id,
    taskName: task.name,
    date: todayString(),
    status,
    detail,
    createdAt: Date.now(),
  }
  appendLog(entry)
  return entry
}
