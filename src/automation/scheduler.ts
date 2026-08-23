/**
 * automation — Cron 调度器（参考 openhanako cron-scheduler）。
 *
 * 确定性代码层：每分钟检查一次到期任务，到期时回调执行。
 * 调度逻辑不涉及 LLM，只有执行回调才会发起模型调用——调度器与执行解耦。
 *
 * 行为契约（与 openhanako 一致）：
 *  - tick 间隔 60s；`_checking` 防重入；
 *  - 逐任务派发前重新读取该 job，让批次进行期间的删除/停用/改期立即生效；
 *  - schemaVersion 高于本实现的 job 跳过并落一条 skipped 记录（前向兼容）；
 *  - 同一任务不并发：上一次仍在执行时本轮跳过且不推进游标（下次再试）；
 *  - 单次执行超时（默认 20 分钟）触发 abortJob 并按失败处理；
 *  - 成功/失败都经 markRun 推进 nextRunAt（失败含退避），并 logRun 落历史。
 */

import { AUTOMATION_SCHEMA_VERSION, type CronJob, type RunRecord } from './types.js'
import type { CronStore } from './store.js'

/** 单次任务执行超时。 */
export const DEFAULT_CRON_EXECUTION_TIMEOUT_MS = 20 * 60 * 1000

export interface CronSchedulerOptions {
  store: CronStore
  /** 执行回调（由 executor 提供）：解析即视为成功，抛错即失败。 */
  executeJob: (job: CronJob) => Promise<Record<string, unknown> | void>
  /** 超时时中断正在执行的任务。 */
  abortJob?: (job: CronJob) => void
  /** 执行完成通知（无论成败/skip 都会回调）。 */
  onJobDone?: (job: CronJob, result: Record<string, unknown>) => void
  /** 单次执行超时毫秒。 */
  executionTimeoutMs?: number
}

export interface CronScheduler {
  start: () => void
  stop: () => Promise<void>
  checkJobs: () => Promise<void>
}

function formatTimeoutMs(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000}min`
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

/** 创建 Cron 调度器。 */
export function createCronScheduler({
  store,
  executeJob,
  abortJob,
  onJobDone,
  executionTimeoutMs = DEFAULT_CRON_EXECUTION_TIMEOUT_MS,
}: CronSchedulerOptions): CronScheduler {
  const CHECK_INTERVAL = 60_000
  if (!Number.isFinite(executionTimeoutMs) || executionTimeoutMs <= 0) {
    throw new Error('executionTimeoutMs must be a positive finite number')
  }
  let timer: ReturnType<typeof setInterval> | null = null
  let checking = false
  let checkPromise: Promise<void> | null = null

  async function checkJobs(): Promise<void> {
    if (checking) return
    checking = true
    const p = doCheck().finally(() => { checking = false })
    checkPromise = p
    await p
  }

  async function doCheck(): Promise<void> {
    try {
      const jobs = store.listJobs()
      for (const listedJob of jobs) {
        // 长任务可能耗时数分钟；派发前重读，让编辑/删除立即生效。
        const job = store.getJob(listedJob.id)
        if (job === null || !job.enabled || job.nextRunAt === null) continue

        const nextRunTime = new Date(job.nextRunAt).getTime()
        if (Date.now() < nextRunTime) continue

        // 新版本写入的字段本运行时不认识：跳过执行但记录原因。
        if (Number.isInteger(job.schemaVersion) && job.schemaVersion !== AUTOMATION_SCHEMA_VERSION) {
          const skippedAt = new Date().toISOString()
          store.logRun(job.id, {
            status: 'skipped',
            startedAt: skippedAt,
            finishedAt: skippedAt,
            reason: 'unsupported_automation_schema',
            schemaVersion: job.schemaVersion,
          })
          onJobDone?.(job, { status: 'skipped', reason: 'unsupported_automation_schema' })
          continue
        }

        const startedAt = new Date().toISOString()
        try {
          let timer: ReturnType<typeof setTimeout> | undefined
          let executionResult: Record<string, unknown> | void
          try {
            executionResult = await Promise.race([
              Promise.resolve(executeJob(job)),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  abortJob?.(job)
                  reject(new Error(`execution timeout (${formatTimeoutMs(executionTimeoutMs)})`))
                }, executionTimeoutMs)
              }),
            ])
          } finally {
            clearTimeout(timer)
          }
          const finishedAt = new Date().toISOString()

          const cursorAdvanced = store.markRun(job.id, {
            success: true,
            expectedConfigRevision: job.configRevision,
          })
          const extra = isRecord(executionResult) ? executionResult : {}
          store.logRun(job.id, {
            ...extra,
            status: 'success',
            startedAt,
            finishedAt,
            ...(cursorAdvanced === false ? { staleConfigRevision: true } : {}),
          })
          onJobDone?.(job, {
            ...extra,
            status: 'success',
            ...(cursorAdvanced === false ? { staleConfigRevision: true } : {}),
          })
        } catch (error) {
          const finishedAt = new Date().toISOString()
          const message = error instanceof Error ? error.message : String(error)
          if (isSkippedError(error)) {
            // 跳过：不推进 nextRunAt，下次 check 再试。
            store.logRun(job.id, { status: 'skipped', startedAt, finishedAt, reason: message })
            onJobDone?.(job, { status: 'skipped', reason: message })
          } else {
            const cursorAdvanced = store.markRun(job.id, {
              success: false,
              expectedConfigRevision: job.configRevision,
            })
            store.logRun(job.id, {
              status: 'error',
              startedAt,
              finishedAt,
              error: message,
              ...(cursorAdvanced === false ? { staleConfigRevision: true } : {}),
            })
            onJobDone?.(job, {
              status: 'error',
              error: message,
              ...(cursorAdvanced === false ? { staleConfigRevision: true } : {}),
            })
          }
        }
      }
    } catch {
      // 单轮检查的整体异常吞掉即可，下轮 tick 继续。
    }
  }

  function start(): void {
    if (timer !== null) return
    timer = setInterval(() => { void checkJobs() }, CHECK_INTERVAL)
  }

  async function stop(): Promise<void> {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    if (checkPromise !== null) {
      await checkPromise.catch(() => {})
      checkPromise = null
    }
  }

  return { start, stop, checkJobs }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSkippedError(error: unknown): boolean {
  return isRecord(error) && (error as { skipped?: unknown }).skipped === true
}
