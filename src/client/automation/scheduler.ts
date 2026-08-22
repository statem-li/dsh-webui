/**
 * automation — 定时调度检查器（v4：按任务独立执行计划触发，真实执行）。
 *
 * 页面打开期间每 60s 检查一次；每个任务按自己的 schedule（借鉴 openhanako：
 * every 毫秒间隔 / cron 表达式 / at 一次性）与最近一次触发时刻做到期判定：
 *  - every：now - 最近触发 ≥ 间隔（无记录视为立即到期）；
 *  - cron（daily/weekly/monthly）：已过今日/本周/本月的计划时刻，
 *    且最近触发早于该时刻（同周期只触发一次）；
 *  - at：到达指定时刻且尚未触发过。
 * 停用（enabled=false）的任务跳过。到期任务交给 executeTask 真实执行（
 * 由容器注入，异步落执行日志）；isRunning 防重，避免同一任务并发执行。
 */

import type { AutomationCatalog, AutomationLogEntry, AutomationTask } from './types.ts'
import { DEFAULT_SCHEDULE, isDue } from './schedule.ts'
import { loadLogs } from './storage.ts'

export interface SchedulerDeps {
  /** 读取当前任务目录。 */
  getCatalog: () => AutomationCatalog
  /** 执行一个到期任务（异步，内部负责落执行日志）。 */
  executeTask: (task: AutomationTask) => void
  /** 任务是否正在执行（防重）。 */
  isRunning: (taskId: string) => boolean
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

/** 单次检查：逐任务判定到期并交给 executeTask 真实执行。 */
export function runScheduleTick(deps: SchedulerDeps): void {
  const { tasks } = deps.getCatalog()
  if (tasks.length === 0) return
  const now = Date.now()
  const logs = loadLogs()
  for (const task of tasks) {
    if (task.enabled === false) continue
    if (deps.isRunning(task.id)) continue
    const stored = task.schedule ?? DEFAULT_SCHEDULE
    if (!isDue(stored, latestRunAt(logs, task.id), now)) continue
    deps.executeTask(task)
  }
}

/**
 * 启动调度检查器（立即跑一次 + 60s 周期）；返回清理函数。
 */
export function startScheduler(deps: SchedulerDeps): () => void {
  runScheduleTick(deps)
  const timer = window.setInterval(() => { runScheduleTick(deps) }, 60_000)
  return () => { window.clearInterval(timer) }
}
