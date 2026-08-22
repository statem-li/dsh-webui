/**
 * automation — 定时调度检查器（纯前端，v3：按任务独立执行计划触发）。
 *
 * 页面打开期间每 60s 检查一次；每个任务按自己的 schedule（借鉴 openhanako：
 * every 毫秒间隔 / cron 表达式 / at 一次性）与最近一次触发时刻做到期判定：
 *  - every：now - 最近触发 ≥ 间隔（无记录视为立即到期）；
 *  - cron（daily/weekly/monthly）：已过今日/本周/本月的计划时刻，
 *    且最近触发早于该时刻（同周期只触发一次）；
 *  - at：到达指定时刻且尚未触发过。
 * 停用（enabled=false）的任务跳过。触发即落一条执行记录——「有没有执行」有据可查。
 */

import type { AutomationCatalog, AutomationLogEntry, AutomationTask } from './types.ts'
import { DEFAULT_SCHEDULE, isDue } from './schedule.ts'
import { loadLogs, recordRun } from './storage.ts'

export interface SchedulerDeps {
  /** 读取当前任务目录。 */
  getCatalog: () => AutomationCatalog
  /** 日志变更回调（写入后同步 React 状态）。 */
  onLogsChanged: (logs: AutomationLogEntry[]) => void
}

/** 任务最近一次触发时刻（无记录 = null）。 */
function latestRunAt(logs: AutomationLogEntry[], taskId: string): number | null {
  let latest: number | null = null
  for (const log of logs) {
    if (log.taskId !== taskId) continue
    if (latest === null || log.createdAt > latest) latest = log.createdAt
  }
  return latest
}

/** 单次检查：逐任务判定到期并落记录。 */
export function runScheduleTick(deps: SchedulerDeps): void {
  const { tasks } = deps.getCatalog()
  if (tasks.length === 0) return
  const now = Date.now()
  const logs = loadLogs()
  let changed = false
  for (const task of tasks) {
    if (task.enabled === false) continue
    const stored = task.schedule ?? DEFAULT_SCHEDULE
    if (!isDue(stored, latestRunAt(logs, task.id), now)) continue
    changed = changed || triggerTask(task)
  }
  if (changed) deps.onLogsChanged(loadLogs())
}

/** 为单个任务落一条执行记录；返回是否有变化。 */
function triggerTask(task: AutomationTask): boolean {
  const detailParts: string[] = []
  if (task.model !== undefined && task.model !== '') detailParts.push(task.model)
  if (task.effort !== undefined && task.effort !== '') detailParts.push(task.effort)
  recordRun(task, 'success', detailParts.length > 0 ? detailParts.join(' · ') : undefined)
  return true
}

/**
 * 启动调度检查器（立即跑一次 + 60s 周期）；返回清理函数。
 */
export function startScheduler(deps: SchedulerDeps): () => void {
  runScheduleTick(deps)
  const timer = window.setInterval(() => { runScheduleTick(deps) }, 60_000)
  return () => { window.clearInterval(timer) }
}
