/**
 * automation — 本地持久化（localStorage，v4）。
 *
 * 两张表：任务目录（分类 + 任务平表，任务自带执行计划 + 执行步骤）/ 执行日志。
 * v4 起任务带 steps（执行步骤序列）与 retry（失败重试）；日志带 steps（每步结果）、
 * files（文件清单）、error（失败原因）。旧记录无这些字段时按缺省读取，不迁移破坏。
 * v3 起调度归属到每个任务（schedule 字段）；旧 v2 的全局「定时」配置废弃不再迁移。
 */

import type {
  AutomationCatalog,
  AutomationCategory,
  AutomationFileResult,
  AutomationLogEntry,
  AutomationLogStatus,
  AutomationStep,
  AutomationStepResult,
  AutomationTask,
  StepOnError,
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

/** 构造一个默认步骤。 */
function step(
  id: string,
  name: string,
  prompt: string,
  onError: StepOnError,
  saveToFile: boolean,
  fileName: string,
): AutomationStep {
  return { id, name, prompt, onError, saveToFile, fileName }
}

/** 缺省步骤序列（任务无 steps 时兜底：单步 generate）。 */
export function defaultSteps(): AutomationStep[] {
  return [step('step-1', '生成结果', '请完成用户配置的任务，并直接输出最终结果。', 'stop', false, 'output-{date}.md')]
}

function defaultCatalog(): AutomationCatalog {
  return {
    categories: defaultCategories(),
    tasks: [
      {
        id: 'task-summarize', name: '总结昨日会话要点', categoryId: 'cat-session',
        schedule: { type: 'cron', schedule: '0 9 * * *' }, retry: 1,
        steps: [
          step('sum-1', '生成会话总结', '请总结昨日对话会话的要点，输出 5 条以内的要点列表，语言与用户一致。', 'stop', false, 'session-summary-{date}.md'),
        ],
      },
      {
        id: 'task-usage-daily', name: '生成用量日报', categoryId: 'cat-skill',
        schedule: { type: 'cron', schedule: '0 18 * * *' }, retry: 2,
        steps: [
          step('usage-1', '生成日报正文', '请生成一份今日用量日报，包含用量概览、趋势变化与优化建议，输出 Markdown。', 'stop', true, 'usage-report-{date}.md'),
        ],
      },
      {
        id: 'task-weekly', name: '撰写本周周报草稿', categoryId: 'cat-prompt',
        schedule: { type: 'cron', schedule: '0 9 * * 1' }, retry: 1,
        steps: [
          step('week-1', '生成周报正文', '请撰写本周工作周报草稿，包含本周完成事项、遇到问题与下周计划。', 'stop', false, 'weekly-report-{date}.md'),
          step('week-2', '整理为 Markdown 并存档', '请将上述周报内容整理为一份结构清晰的 Markdown 文档，直接输出最终文档内容。', 'skip', true, 'weekly-report-{date}.md'),
        ],
      },
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

/** 宽松校验单步：丢弃形状不完整的步骤。 */
function sanitizeStep(raw: unknown): AutomationStep | null {
  if (raw === null || typeof raw !== 'object') return null
  const s = raw as Partial<AutomationStep>
  if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.prompt !== 'string') return null
  return {
    id: s.id,
    name: s.name,
    prompt: s.prompt,
    onError: s.onError === 'skip' ? 'skip' : 'stop',
    saveToFile: s.saveToFile === true,
    fileName: typeof s.fileName === 'string' && s.fileName !== '' ? s.fileName : 'output-{date}.md',
  }
}

/** 宽松校验：丢弃形状不完整的分类/任务；schedule/enabled/steps/retry 归一化。 */
function sanitizeCatalog(catalog: AutomationCatalog): AutomationCatalog {
  const SCHEDULE_TYPES: readonly StoredScheduleType[] = ['every', 'cron', 'at']
  return {
    categories: catalog.categories.filter(cat => cat !== null && typeof cat === 'object'
      && typeof cat.id === 'string' && typeof cat.label === 'string'),
    tasks: catalog.tasks.filter(task => task !== null && typeof task === 'object'
      && typeof task.id === 'string' && typeof task.name === 'string'
      && typeof task.categoryId === 'string')
      .map(task => {
        const steps = Array.isArray(task.steps)
          ? task.steps.map(sanitizeStep).filter((s): s is AutomationStep => s !== null)
          : undefined
        const retryRaw = typeof task.retry === 'number' ? task.retry : Number(task.retry)
        return {
          ...task,
          schedule: task.schedule !== undefined && task.schedule !== null
            && typeof task.schedule === 'object'
            && SCHEDULE_TYPES.includes((task.schedule as StoredSchedule).type as StoredScheduleType)
            ? (task.schedule as StoredSchedule)
            : { ...DEFAULT_SCHEDULE },
          enabled: task.enabled !== false,
          steps: steps !== undefined && steps.length > 0 ? steps : undefined,
          retry: Number.isFinite(retryRaw) ? Math.min(3, Math.max(0, Math.round(retryRaw))) : 0,
        }
      }),
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

/** recordRun 的可选附加载荷。 */
export interface RecordRunExtra {
  /** 整体失败原因。 */
  error?: string
  /** 每步结果。 */
  steps?: AutomationStepResult[]
  /** 生成/修改的文件清单。 */
  files?: AutomationFileResult[]
}

/** 记录一条执行结果（供 scheduler 与手动触发共用）。 */
export function recordRun(
  task: AutomationTask,
  status: AutomationLogStatus,
  detail?: string,
  extra?: RecordRunExtra,
): AutomationLogEntry {
  const entry: AutomationLogEntry = {
    id: newId('log'),
    taskId: task.id,
    taskName: task.name,
    date: todayString(),
    status,
    detail,
    error: extra?.error,
    steps: extra?.steps,
    files: extra?.files,
    createdAt: Date.now(),
  }
  appendLog(entry)
  return entry
}
