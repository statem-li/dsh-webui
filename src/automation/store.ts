/**
 * automation — 定时任务存储（参考 openhanako CronStore：jobs.json + runs/<jobId>.jsonl）。
 *
 * 只负责持久化与游标推进，不做调度判断（调度在 scheduler.ts）：
 *  - 全部写入走「从磁盘重读 → 同步修改 → 原子写回」的 _mutate 流程，
 *    storeRevision 随每次落盘自增，跨实例写入天然互不覆盖；
 *  - 主文件损坏时自动从 .tmp 恢复并把损坏文件备份为 *.bak；
 *  - markRun：成功清零错误并按计划推进 nextRunAt，失败按退避表推迟，
 *    at 类型执行一次后自动停用；
 *  - 运行历史按任务一个 jsonl 文件追加，超过 500 行修剪到最后 300 行。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import {
  AUTOMATION_SCHEMA_VERSION,
  CodedError,
  MIN_EVERY_INTERVAL_MS,
  deriveJobLabel,
  normalizeJob,
  normalizeModelRef,
  type AddJobInput,
  type CronJob,
  type CronStoreDocument,
  type JobType,
  type RunRecord,
  type UpdateJobPatch,
} from './types.js'

/** 数据根：${DSH_HOME:-~/.dsh}/automation/dsh-webui/。 */
export function automationDataRoot(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'automation', 'dsh-webui')
}

/** 失败退避表（毫秒）：0 / 1m / 5m / 15m / 60m。 */
const BACKOFF_MS = [0, 60_000, 300_000, 900_000, 3_600_000]

/** 运行历史修剪阈值：超过 500 行只保留最后 300 行。 */
const RUNS_TRIM_OVER = 500
const RUNS_TRIM_KEEP = 300

/** updateJob 允许修改的字段白名单。 */
const UPDATE_ALLOWED = new Set(['label', 'model', 'schedule', 'prompt', 'enabled', 'type'])
const VALID_TYPES = new Set<JobType>(['at', 'every', 'cron'])

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseDocument(bytes: Buffer): CronStoreDocument {
  let data: unknown
  try {
    data = JSON.parse(bytes.toString('utf-8'))
  } catch {
    throw new CodedError('自动化任务存储文件损坏', 'cron_store_corrupt', 500)
  }
  if (!isPlainObject(data) || !Array.isArray((data as unknown as CronStoreDocument).jobs)) {
    throw new CodedError('自动化任务存储文件损坏', 'cron_store_corrupt', 500)
  }
  return data as unknown as CronStoreDocument
}

export class CronStore {
  readonly jobsPath: string
  readonly runsDir: string
  /** 完整产出目录根（runs/<jobId>/<stamp>.md，由 executor 写入）。 */
  readonly outputsDir: string

  private jobs: CronJob[] = []
  private nextNum = 1
  private storeRevision = 0
  /** 重入防护：同一时刻只允许一个 mutator。 */
  private mutating = false

  constructor(jobsPath?: string, runsDir?: string) {
    const root = automationDataRoot()
    this.jobsPath = jobsPath ?? join(root, 'cron-jobs.json')
    this.runsDir = runsDir ?? join(root, 'cron-runs')
    this.outputsDir = join(root, 'runs')
    this.load()
  }

  // ════════════════════════════
  //  持久化
  // ════════════════════════════

  /** 从磁盘读文档；主文件缺失/损坏时尝试用 .tmp 快照恢复。 */
  private readState(): { doc: CronStoreDocument, dirty: boolean } | null {
    let bytes: Buffer | null = null
    try {
      bytes = readFileSync(this.jobsPath)
    } catch {
      bytes = null
    }
    if (bytes !== null) {
      try {
        return { doc: parseDocument(bytes), dirty: false }
      } catch (error) {
        if (!(error instanceof CodedError)) throw error
        return { doc: this.recoverFromTmp(bytes), dirty: true }
      }
    }
    // 主文件不存在：有 .tmp 则恢复之，否则视为全新存储。
    const tmpPath = this.jobsPath + '.tmp'
    if (!existsSync(tmpPath)) return null
    return { doc: this.recoverFromTmp(null), dirty: true }
  }

  /** 用 .tmp 快照恢复：保留损坏主文件的备份后原地还原。 */
  private recoverFromTmp(corruptBytes: Buffer | null): CronStoreDocument {
    const tmpPath = this.jobsPath + '.tmp'
    let tmpBytes: Buffer
    try {
      tmpBytes = readFileSync(tmpPath)
    } catch {
      throw new CodedError('自动化任务存储不可用', 'cron_store_unavailable', 500)
    }
    const doc = parseDocument(tmpBytes)
    try {
      if (corruptBytes !== null && existsSync(this.jobsPath)) {
        writeFileSync(`${this.jobsPath}.corrupt-${Date.now().toString(36)}.bak`, corruptBytes, { flag: 'wx' })
      }
      renameSync(tmpPath, this.jobsPath)
    } catch (error) {
      throw new CodedError(`自动化任务存储恢复失败：${error instanceof Error ? error.message : String(error)}`, 'cron_store_recovery_failed', 500)
    }
    return doc
  }

  private load(): void {
    const state = this.readState()
    if (state === null) {
      this.jobs = []
      this.nextNum = 1
      this.storeRevision = 0
      return
    }
    const nowIso = new Date().toISOString()
    let dirty = state.dirty
    const jobs = cloneJson(state.doc.jobs)
    for (const job of jobs) {
      // 加载期清洗：model 规范化 + 缺省字段补齐 + 启用任务的失效游标修复。
      const normalizedModel = JSON.stringify(normalizeModelRef(job.model))
      if (JSON.stringify(job.model ?? '') !== normalizedModel) {
        job.model = normalizeModelRef(job.model)
        dirty = true
      }
      if (job.consecutiveErrors === undefined) {
        job.consecutiveErrors = 0
        dirty = true
      }
      if (job.enabled === true && !isValidRunAt(job.nextRunAt)) {
        // 修复失效游标；算不出下次触发（非法 cron / 已过期的 at）的任务直接
        // 停用——否则每次 load 都重算出 null、每次都判 dirty，把 listJobs
        // 变成「每读一次就写一次盘」的热循环（UI 30s 轮询 + 调度 60s tick）。
        const next = this.calcNextRun(job.type, job.schedule, nowIso)
        if (next === null) {
          job.enabled = false
          job.nextRunAt = null
          job.configRevision = (Number.isSafeInteger(job.configRevision) ? job.configRevision : 1) + 1
        } else {
          job.nextRunAt = next
        }
        dirty = true
      }
    }
    const normalized = jobs.map(normalizeJob)
    const nextNum = validNextNum(state.doc.nextNum, normalized)
    if (dirty || JSON.stringify(jobs) !== JSON.stringify(normalized)) {
      const revision = (state.doc.storeRevision ?? 0) + 1
      this.writeState({ storeRevision: revision, jobs: normalized, nextNum })
      this.adopt({ storeRevision: revision, jobs: normalized, nextNum })
      return
    }
    this.adopt({ storeRevision: state.doc.storeRevision ?? 0, jobs: normalized, nextNum })
  }

  private adopt(state: { storeRevision: number, jobs: CronJob[], nextNum: number }): void {
    this.storeRevision = state.storeRevision
    this.jobs = state.jobs
    this.nextNum = state.nextNum
  }

  /** 原子写：先写 .tmp 再 rename 覆盖。 */
  private writeState(doc: CronStoreDocument): void {
    mkdirSync(dirname(this.jobsPath), { recursive: true })
    const payload = JSON.stringify({ storeRevision: doc.storeRevision, jobs: doc.jobs, nextNum: doc.nextNum }, null, 2) + '\n'
    writeFileSync(this.jobsPath + '.tmp', payload, 'utf-8')
    renameSync(this.jobsPath + '.tmp', this.jobsPath)
  }

  /** 读-改-写事务：mutator 必须同步；changed=false 时不落盘不升版本。 */
  private mutate<T>(mutator: (draft: { jobs: CronJob[], nextNum: number }) => { changed: boolean, value: T }): T {
    if (this.mutating) throw new CodedError('cron store 不允许重入写入', 'cron_store_reentrant_write')
    this.mutating = true
    try {
      const base = this.readState()
      const draft = {
        jobs: base === null ? [] : cloneJson(base.doc.jobs),
        nextNum: base === null ? 1 : validNextNum(base.doc.nextNum, base.doc.jobs),
      }
      const outcome = mutator(draft)
      if (outcome.changed === false) {
        this.load() // 回到磁盘真值（别的实例可能已写过盘）。
        return outcome.value
      }
      const jobs = draft.jobs.map(normalizeJob)
      const revision = (base?.doc.storeRevision ?? this.storeRevision) + 1
      this.writeState({ storeRevision: revision, jobs, nextNum: draft.nextNum })
      this.adopt({ storeRevision: revision, jobs, nextNum: draft.nextNum })
      return outcome.value
    } finally {
      this.mutating = false
    }
  }

  // ════════════════════════════
  //  Job CRUD
  // ════════════════════════════

  /** 新建任务。at 必须指向未来；every 最小 1 分钟；缺省 label 取 prompt 前 30 字。 */
  addJob(input: AddJobInput): CronJob {
    assertValidType(input.type)
    const schedule = input.type === 'every' ? normalizeEveryMs(input.schedule) : input.schedule
    if (input.type === 'at') assertFutureAt(schedule)
    if (input.enabled !== false && this.calcNextRun(input.type, schedule, new Date().toISOString()) === null) {
      throw new Error(`这个计划算不出下一次触发时间：${String(schedule)}`)
    }
    return this.mutate((draft) => {
      const nowIso = new Date().toISOString()
      const job = normalizeJob({
        id: allocateId(draft),
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        configRevision: 1,
        type: input.type,
        schedule,
        prompt: typeof input.prompt === 'string' ? input.prompt : '',
        label: deriveJobLabel(input),
        model: normalizeModelRef(input.model ?? ''),
        enabled: input.enabled !== false,
        consecutiveErrors: 0,
        createdAt: nowIso,
        lastRunAt: null,
        nextRunAt: this.calcNextRun(input.type, schedule, nowIso),
      })
      assertCanEnable(job)
      draft.jobs.push(job)
      return { changed: true, value: job }
    })
  }

  /** 删除任务，并顺带清掉它的运行历史与完整产出目录（避免孤儿文件常驻）。 */
  removeJob(id: string): boolean {
    const removed = this.mutate((draft) => {
      const index = draft.jobs.findIndex(job => job.id === id)
      if (index === -1) return { changed: false, value: false }
      draft.jobs.splice(index, 1)
      return { changed: true, value: true }
    })
    if (removed) this.purgeRunArtifacts(id)
    return removed
  }

  getJob(id: string): CronJob | null {
    this.load()
    return this.jobs.find(job => job.id === id) ?? null
  }

  listJobs(): CronJob[] {
    this.load()
    return cloneJson(this.jobs)
  }

  /**
   * 更新任务字段（白名单）。改 type 必须同时给 schedule；任何影响执行的变更
   * 都会重算 nextRunAt 并自增 configRevision。
   */
  updateJob(id: string, patch: UpdateJobPatch): CronJob | null {
    return this.mutate((draft) => {
      const index = draft.jobs.findIndex(job => job.id === id)
      if (index === -1) return { changed: false, value: null }
      const current = normalizeJob(draft.jobs[index])
      const job: CronJob = cloneJson(current)
      for (const key of Object.keys(patch)) {
        if (!UPDATE_ALLOWED.has(key)) continue
        const value = patch[key as keyof UpdateJobPatch]
        if (value === undefined) continue
        if (key === 'model') job.model = normalizeModelRef(value)
        else if (key === 'type') job.type = String(value) as JobType
        else if (key === 'label') job.label = String(value)
        else if (key === 'prompt') job.prompt = String(value)
        else if (key === 'enabled') job.enabled = value === true
        else if (key === 'schedule') job.schedule = value as string | number
      }
      assertValidType(job.type)
      if ('type' in patch && patch.type !== current.type && !('schedule' in patch)) {
        throw new Error('修改调度类型时必须同时提供 schedule')
      }
      if ('schedule' in patch || 'type' in patch) {
        if (job.type === 'every') job.schedule = normalizeEveryMs(job.schedule)
        if (job.type === 'at') assertFutureAt(job.schedule)
        const next = this.calcNextRun(job.type, job.schedule, new Date().toISOString())
        // 启用中的任务必须能算出下次触发，否则拒绝保存（非法 cron 直接报错，
        // 而不是静默变成「开着但永不触发」）。
        if (next === null && job.enabled) {
          throw new Error(`这个计划算不出下一次触发时间：${String(job.schedule)}`)
        }
        job.nextRunAt = next
      }
      if (job.label.trim() === '') job.label = deriveJobLabel({ prompt: job.prompt }) || job.id
      assertCanEnable(job)
      const configChanged = JSON.stringify(projection(current)) !== JSON.stringify(projection(job))
      job.configRevision = configChanged ? current.configRevision + 1 : current.configRevision
      draft.jobs[index] = job
      return { changed: true, value: job }
    })
  }

  /** 启用/停用切换；重新启用时从当前时刻重算下次触发。 */
  toggleJob(id: string): CronJob | null {
    return this.mutate((draft) => {
      const index = draft.jobs.findIndex(job => job.id === id)
      if (index === -1) return { changed: false, value: null }
      const job: CronJob = cloneJson(draft.jobs[index])
      job.enabled = !job.enabled
      job.configRevision += 1
      if (!job.enabled) job.nextRunAt = null
      if (job.enabled) {
        assertCanEnable(job)
        const next = this.calcNextRun(job.type, job.schedule, new Date().toISOString())
        // 算不出下次触发（已过期的一次性任务 / 非法 cron）就别假装启用：
        // 否则开关显示「开」却永远不会触发，用户只会以为坏了。
        if (next === null) {
          throw new Error(job.type === 'at'
            ? '这条一次性任务的时间已过去，请先把时间改到未来再启用'
            : '当前计划算不出下一次触发时间，请检查 Cron 表达式')
        }
        job.nextRunAt = next
      }
      draft.jobs[index] = job
      return { changed: true, value: job }
    })
  }

  /**
   * 标记一次运行结束：更新 lastRunAt 并推进 nextRunAt。
   * 成功 → 清零连续错误、按计划推进；失败 → 连续错误 +1、按退避表取较晚者；
   * at 类型执行一次后自动停用（一次性任务完成即退役）。
   * expectedConfigRevision 不匹配时拒绝写入（运行期间被编辑过）。
   */
  markRun(id: string, opts: { success?: boolean, expectedConfigRevision?: number | null } = {}): boolean {
    return this.mutate((draft) => {
      const index = draft.jobs.findIndex(job => job.id === id)
      if (index === -1) return { changed: false, value: false }
      const job: CronJob = cloneJson(draft.jobs[index])
      if (opts.expectedConfigRevision != null && job.configRevision !== opts.expectedConfigRevision) {
        return { changed: false, value: false }
      }
      const nowIso = new Date().toISOString()
      job.lastRunAt = nowIso
      const success = opts.success !== false
      if (success) {
        job.consecutiveErrors = 0
        job.nextRunAt = this.calcNextRun(job.type, job.schedule, nowIso)
      } else {
        job.consecutiveErrors += 1
        const normalNext = this.calcNextRun(job.type, job.schedule, nowIso)
        const backoffNext = new Date(Date.now() + BACKOFF_MS[Math.min(job.consecutiveErrors, BACKOFF_MS.length - 1)]).toISOString()
        job.nextRunAt = normalNext !== null && normalNext > backoffNext ? normalNext : backoffNext
      }
      if (job.type === 'at' && job.enabled !== false) {
        job.enabled = false
        job.configRevision += 1
      }
      draft.jobs[index] = normalizeJob(job)
      return { changed: true, value: true }
    })
  }

  // ════════════════════════════
  //  运行历史
  // ════════════════════════════

  /** 追加一条运行记录（jsonl）；超阈值时修剪旧行。 */
  logRun(jobId: string, run: Omit<RunRecord, 'timestamp'>): void {
    const filePath = join(this.runsDir, `${safeFileId(jobId)}.jsonl`)
    mkdirSync(this.runsDir, { recursive: true })
    try {
      const line = JSON.stringify({ ...run, timestamp: new Date().toISOString() })
      const existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : ''
      const lines = existing.trim() === '' ? [] : existing.trim().split('\n')
      lines.push(line)
      const trimmed = lines.length > RUNS_TRIM_OVER ? lines.slice(-RUNS_TRIM_KEEP) : lines
      const payload = trimmed.join('\n') + '\n'
      writeFileSync(filePath + '.tmp', payload, 'utf-8')
      renameSync(filePath + '.tmp', filePath)
    } catch {
      // 记录失败不影响主流程。
    }
  }

  /** 清空某任务的运行历史与完整产出（保留任务本体）。 */
  clearRunHistory(id: string): void {
    this.purgeRunArtifacts(id)
  }

  /** 删除某任务的 jsonl 历史与 runs/<id>/ 产出目录（幂等、失败静默）。 */
  private purgeRunArtifacts(id: string): void {
    try {
      rmSync(join(this.runsDir, `${safeFileId(id)}.jsonl`), { force: true })
    } catch { /* ignore */ }
    try {
      rmSync(join(this.outputsDir, safeFileId(id)), { recursive: true, force: true })
    } catch { /* ignore */ }
  }

  /** 读取某任务的运行记录（最新在后，最多 limit 条）。 */
  getRunHistory(jobId: string, limit = 20): RunRecord[] {
    const filePath = join(this.runsDir, `${safeFileId(jobId)}.jsonl`)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const lines = raw.trim().split('\n').filter(Boolean)
      return lines.slice(-limit).map(line => {
        try { return JSON.parse(line) as RunRecord } catch { return null }
      }).filter((entry): entry is RunRecord => entry !== null)
    } catch {
      return []
    }
  }

  // ════════════════════════════
  //  调度计算
  // ════════════════════════════

  /** 计算下次执行时间；返回 ISO 字符串或 null（不再触发）。 */
  calcNextRun(type: JobType, schedule: string | number, fromIso: string): string | null {
    const from = new Date(fromIso)
    switch (type) {
      case 'at': {
        const target = new Date(String(schedule))
        if (Number.isNaN(target.getTime())) return null
        return target > from ? target.toISOString() : null
      }
      case 'every': {
        const ms = typeof schedule === 'number' ? schedule : Number.parseInt(String(schedule), 10)
        if (!Number.isFinite(ms) || ms <= 0) return null
        return new Date(from.getTime() + ms).toISOString()
      }
      case 'cron':
        return this.parseSimpleCron(String(schedule), from)
      default:
        return null
    }
  }

  /**
   * 完整 5 字段 cron 解析：分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6,7=周日)。
   * 支持「星号」「星号斜杠步进」「范围 N-M」「范围步进」与逗号列表；
   * 「日」「周」同时受限时按 OR 语义（标准 cron 行为）。
   * 从下一分钟起逐分钟搜索，上限 366 天。
   */
  private parseSimpleCron(expr: string, from: Date): string | null {
    const parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) return null
    const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]
    const fields: Array<Set<number> | null> = []
    for (let i = 0; i < 5; i++) {
      const set = parseCronField(parts[i], ranges[i][0], ranges[i][1], i === 4)
      if (set === null) return null
      fields.push(set)
    }
    const [minutes, hours, days, months, weekdays] = fields as Array<Set<number>>
    const dayOfMonthRestricted = parts[2] !== '*'
    const dayOfWeekRestricted = parts[4] !== '*'

    const start = new Date(from)
    start.setSeconds(0, 0)
    start.setMinutes(start.getMinutes() + 1)

    const limit = 366 * 24 * 60
    for (let i = 0; i < limit; i++) {
      const t = new Date(start.getTime() + i * 60_000)
      if (!months.has(t.getMonth() + 1)) continue
      const matchesDayOfMonth = days.has(t.getDate())
      const matchesDayOfWeek = weekdays.has(t.getDay())
      const matchesDay = dayOfMonthRestricted && dayOfWeekRestricted
        ? (matchesDayOfMonth || matchesDayOfWeek)
        : (matchesDayOfMonth && matchesDayOfWeek)
      if (!matchesDay) continue
      if (!hours.has(t.getHours())) continue
      if (!minutes.has(t.getMinutes())) continue
      return t.toISOString()
    }
    return null
  }
}

// ── 辅助 ────────────────────────────────────────────────────────────────

/** 参与 configRevision 判定的配置投影（lastRunAt 等运行态不算配置变更）。 */
function projection(job: CronJob): Record<string, unknown> {
  return {
    type: job.type,
    schedule: job.schedule,
    label: job.label,
    prompt: job.prompt,
    model: job.model,
    enabled: job.enabled,
  }
}

function validNextNum(nextNum: unknown, jobs: CronJob[]): number {
  return Number.isSafeInteger(nextNum) && Number(nextNum) > 0
    ? Number(nextNum)
    : jobs.length + 1
}

function isValidRunAt(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(new Date(value).getTime())
}

function assertValidType(type: unknown): asserts type is JobType {
  if (!VALID_TYPES.has(type as JobType)) {
    throw new Error(`无效的任务类型 "${String(type)}"，必须是 at / every / cron`)
  }
}

function normalizeEveryMs(schedule: unknown): number {
  const ms = typeof schedule === 'number' ? schedule : Number.parseInt(String(schedule), 10)
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`无效的 every schedule："${String(schedule)}"，必须是正整数毫秒`)
  }
  return Math.max(MIN_EVERY_INTERVAL_MS, ms)
}

function assertFutureAt(schedule: unknown): void {
  const target = new Date(String(schedule))
  if (Number.isNaN(target.getTime())) {
    throw new Error(`无效的 at schedule："${String(schedule)}"，无法解析为日期`)
  }
  if (target <= new Date()) {
    throw new Error(`at schedule 已过期："${String(schedule)}"，必须是未来时间`)
  }
}

function assertCanEnable(job: CronJob): void {
  if (!job.enabled) return
  if (typeof job.prompt === 'string' && job.prompt.trim() !== '') return
  throw new Error('启用自动化前必须填写执行内容（prompt）')
}

function safeFileId(value: string): string {
  if (typeof value !== 'string' || value === '' || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`invalid run file id: ${String(value)}`)
  }
  return value
}

function allocateId(draft: { jobs: CronJob[], nextNum: number }): string {
  let id: string
  do {
    id = `job_${draft.nextNum++}`
  } while (draft.jobs.some(job => job.id === id))
  return id
}

/** 解析单个 cron 字段为值集合；非法返回 null。 */
function parseCronField(field: string, min: number, max: number, isWeekday = false): Set<number> | null {
  const values = new Set<number>()
  for (const segment of field.split(',')) {
    if (segment.startsWith('*/')) {
      const step = Number.parseInt(segment.slice(2), 10)
      if (Number.isNaN(step) || step <= 0) return null
      for (let v = min; v <= max; v += step) values.add(v)
      continue
    }
    if (segment === '*') {
      for (let v = min; v <= max; v++) values.add(v)
      continue
    }
    const rangeMatch = segment.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
    if (rangeMatch !== null) {
      const lo = Number.parseInt(rangeMatch[1], 10)
      const hi = Number.parseInt(rangeMatch[2], 10)
      const step = rangeMatch[3] !== undefined ? Number.parseInt(rangeMatch[3], 10) : 1
      if (Number.isNaN(lo) || Number.isNaN(hi) || Number.isNaN(step) || step <= 0) return null
      if (lo > hi) return null
      const effectiveMax = isWeekday ? 7 : max
      if (lo < min || hi > effectiveMax) return null
      for (let v = lo; v <= hi; v += step) values.add(isWeekday && v === 7 ? 0 : v)
      continue
    }
    const num = Number.parseInt(segment, 10)
    if (Number.isNaN(num)) return null
    const effectiveMax = isWeekday ? 7 : max
    if (num < min || num > effectiveMax) return null
    values.add(isWeekday && num === 7 ? 0 : num)
  }
  return values.size > 0 ? values : null
}
