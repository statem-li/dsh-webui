/**
 * automation — 定时调度检查器（纯前端）。
 *
 * 页面打开期间每 60s 检查一次「定时」条件：
 *  - daily=true：每天首次检查即视为触发；
 *  - date=某日：到达该日（页面打开时）触发一次。
 * 触发时为每个任务落一条当日记录（同任务同日去重）——「每天有没有执行」
 * 因此有据可查：有记录 = 已触发执行；某日无记录 = 未执行。
 * 真正的会话执行编排留待后续接入；当前记录 detail 携带任务绑定的模型与强度。
 */

import type { AutomationCatalog, AutomationLogEntry, ScheduleConfig } from './types.ts'
import { loadLogs, recordRun, todayString } from './storage.ts'

export interface SchedulerDeps {
  /** 读取当前定时配置。 */
  getSchedule: () => ScheduleConfig
  /** 读取当前任务目录。 */
  getCatalog: () => AutomationCatalog
  /** 日志变更回调（写入后同步 React 状态）。 */
  onLogsChanged: (logs: AutomationLogEntry[]) => void
}

/** 任务当天是否已有记录。 */
function hasLogForToday(logs: AutomationLogEntry[], taskId: string, today: string): boolean {
  return logs.some(log => log.taskId === taskId && log.date === today)
}

/** 单次检查：条件满足则为每个未记录的任务落一条当日记录。 */
export function runScheduleTick(deps: SchedulerDeps): void {
  const schedule = deps.getSchedule()
  if (!schedule.daily && schedule.date === '') return
  const today = todayString()
  if (!schedule.daily && schedule.date !== today) return
  const { tasks } = deps.getCatalog()
  if (tasks.length === 0) return
  const logs = loadLogs()
  let changed = false
  for (const task of tasks) {
    if (hasLogForToday(logs, task.id, today)) continue
    const detailParts: string[] = []
    if (task.model !== undefined && task.model !== '') detailParts.push(task.model)
    if (task.effort !== undefined && task.effort !== '') detailParts.push(`${task.effort}`)
    const entry = recordRun(task, 'success', detailParts.length > 0 ? detailParts.join(' · ') : undefined)
    logs.push(entry)
    changed = true
  }
  if (changed) deps.onLogsChanged(loadLogs())
}

/**
 * 启动调度检查器（立即跑一次 + 60s 周期）；返回清理函数。
 */
export function startScheduler(deps: SchedulerDeps): () => void {
  runScheduleTick(deps)
  const timer = window.setInterval(() => { runScheduleTick(deps) }, 60_000)
  return () => { window.clearInterval(timer) }
}
