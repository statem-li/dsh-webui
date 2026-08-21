/**
 * automation — 本地持久化（localStorage，v2）。
 *
 * 三张表：「定时」配置 / 任务目录（分类 + 任务平表）/ 执行日志。
 * 首次读取 v2 缺失时从 v1（config/catalog）迁移：日期与每日开关照搬，
 * 旧「执行内容条目」升级为任务（模型/强度留空）；v1 的 contentIds 勾选
 * 语义已废弃，不再迁移。
 */

import type {
  AutomationCatalog,
  AutomationCategory,
  AutomationLogEntry,
  AutomationLogStatus,
  AutomationTask,
  ScheduleConfig,
} from './types.ts'

const SCHEDULE_KEY = 'dsh-webui.automation.schedule.v2'
const CATALOG_KEY = 'dsh-webui.automation.tasks.v2'
const LOGS_KEY = 'dsh-webui.automation.logs.v2'
/** v1 遗留键：仅用于一次性迁移读取。 */
const V1_CONFIG_KEY = 'dsh-webui.automation.config.v1'
const V1_CATALOG_KEY = 'dsh-webui.automation.catalog.v1'

export const DEFAULT_SCHEDULE: ScheduleConfig = { date: '', daily: false }

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
      { id: 'task-summarize', name: '总结昨日会话要点', categoryId: 'cat-session' },
      { id: 'task-usage-daily', name: '生成用量日报', categoryId: 'cat-skill' },
      { id: 'task-weekly', name: '撰写本周周报草稿', categoryId: 'cat-prompt' },
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

// ---- 定时配置 ------------------------------------------------------------

export function loadSchedule(): ScheduleConfig {
  try {
    const raw = localStorage.getItem(SCHEDULE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<ScheduleConfig>
      return {
        date: typeof parsed.date === 'string' ? parsed.date : '',
        daily: parsed.daily === true,
      }
    }
    // v2 缺失 → 尝试 v1 迁移（date/daily）。
    const v1 = localStorage.getItem(V1_CONFIG_KEY)
    if (v1 !== null) {
      const legacy = JSON.parse(v1) as { date?: unknown; daily?: unknown }
      const migrated: ScheduleConfig = {
        date: typeof legacy.date === 'string' ? legacy.date : '',
        daily: legacy.daily === true,
      }
      saveSchedule(migrated)
      return migrated
    }
  } catch { /* 落默认 */ }
  return { ...DEFAULT_SCHEDULE }
}

export function saveSchedule(schedule: ScheduleConfig): void {
  try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule)) } catch { /* 忽略 */ }
}

// ---- 任务目录 ------------------------------------------------------------

export function loadCatalog(): AutomationCatalog {
  try {
    const raw = localStorage.getItem(CATALOG_KEY)
    if (raw === null) {
      const migrated = migrateV1Catalog()
      if (migrated !== null) {
        saveCatalog(migrated)
        return migrated
      }
      const fresh = defaultCatalog()
      saveCatalog(fresh)
      return fresh
    }
    const parsed = JSON.parse(raw) as Partial<AutomationCatalog>
    if (Array.isArray(parsed.categories) && Array.isArray(parsed.tasks)) {
      return sanitizeCatalog(parsed as AutomationCatalog)
    }
  } catch { /* 落默认 */ }
  return defaultCatalog()
}

/** 宽松校验：丢弃形状不完整的分类/任务。 */
function sanitizeCatalog(catalog: AutomationCatalog): AutomationCatalog {
  return {
    categories: catalog.categories.filter(cat => cat !== null && typeof cat === 'object'
      && typeof cat.id === 'string' && typeof cat.label === 'string'),
    tasks: catalog.tasks.filter(task => task !== null && typeof task === 'object'
      && typeof task.id === 'string' && typeof task.name === 'string'
      && typeof task.categoryId === 'string'),
  }
}

/** 从 v1 目录迁移：旧条目 → 任务；旧分类保留，缺分类补默认。 */
function migrateV1Catalog(): AutomationCatalog | null {
  try {
    const raw = localStorage.getItem(V1_CATALOG_KEY)
    if (raw === null) return null
    const legacy = JSON.parse(raw) as Array<{ id?: unknown; label?: unknown; items?: Array<{ id?: unknown; name?: unknown }> }>
    if (!Array.isArray(legacy)) return null
    const categories: AutomationCategory[] = legacy
      .filter(cat => typeof cat?.id === 'string')
      .map((cat, i) => ({ id: String(cat.id), label: typeof cat.label === 'string' ? cat.label : `分类 ${i + 1}` }))
    for (const def of defaultCategories()) {
      if (!categories.some(cat => cat.id === def.id)) categories.push(def)
    }
    const tasks: AutomationTask[] = []
    for (const cat of legacy) {
      if (typeof cat?.id !== 'string' || !Array.isArray(cat.items)) continue
      for (const item of cat.items) {
        if (typeof item?.id !== 'string' || typeof item?.name !== 'string') continue
        tasks.push({ id: item.id, name: item.name, categoryId: cat.id })
      }
    }
    return { categories, tasks }
  } catch {
    return null
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
