/**
 * automation — AI 建议存储（参考 openhanako AutomationSuggestionStore）。
 *
 * Agent 通过 automation 工具 create/update 时默认不直接落盘，而是生成一条
 * 「待确认建议」：UI 弹出确认卡片（用户可编辑字段），应用后经 receipt 校验
 * 写入 CronStore；15 分钟未处理自动过期。autoApprove 模式下工具直接提交。
 */

import { CodedError, type CronJob } from './types.js'

/** 建议默认存活时长。 */
const DEFAULT_SUGGESTION_TTL_MS = 15 * 60 * 1000

/** 应用建议时允许改写的字段（与 openhanako applyConfirmedAutomationDraft 对齐）。 */
const CONFIRMABLE_FIELDS = new Set(['type', 'schedule', 'prompt', 'label', 'model'])

/** 建议草稿数据（创建/更新共用）。 */
export type SuggestionJobData = Partial<CronJob> & { type: CronJob['type'], schedule: string | number }

/** 待确认建议（对外视图，不含 apply 闭包）。 */
export interface SuggestionView {
  suggestionId: string
  /** 4 位数字短码，供人工引用。 */
  shortCode: string
  operation: 'create' | 'update'
  jobId: string | null
  baseConfigRevision: number | null
  jobData: SuggestionJobData
  createdAt: number
  expiresAt: number
}

interface SuggestionEntry extends SuggestionView {
  apply: (payload: { jobData: SuggestionJobData, receipt: SuggestionReceipt }) => CronJob | null
  applying: boolean
}

/** 建议 receipt：apply 时签发、写入前校验，防过期重放。 */
export interface SuggestionReceipt {
  readonly suggestionId: string
  readonly confirmedAt: string
  readonly expiresAt: number
  readonly operation: 'create' | 'update'
  readonly jobId: string | null
  readonly baseConfigRevision: number | null
}

export class AutomationSuggestionStore {
  private entries = new Map<string, SuggestionEntry>()
  private sequence = 0
  private readonly ttlMs: number

  constructor(ttlMs = DEFAULT_SUGGESTION_TTL_MS) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('automation suggestion ttlMs must be positive')
    this.ttlMs = ttlMs
  }

  /**
   * 登记一条建议。apply 闭包在用户确认时执行（把可能被用户编辑过的 jobData
   * 合并进建议并写入 CronStore）。
   */
  create(entry: {
    operation: 'create' | 'update'
    jobId?: string | null
    baseConfigRevision?: number | null
    jobData: SuggestionJobData
    apply: (payload: { jobData: SuggestionJobData, receipt: SuggestionReceipt }) => CronJob | null
  }): SuggestionView {
    this.pruneExpired()
    const suggestionId = `automation_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`
    const createdAt = Date.now()
    const stored: SuggestionEntry = {
      suggestionId,
      shortCode: String(Math.floor(1000 + Math.random() * 9000)),
      operation: entry.operation === 'update' ? 'update' : 'create',
      jobId: typeof entry.jobId === 'string' && entry.jobId.trim() !== '' ? entry.jobId : null,
      baseConfigRevision: Number.isSafeInteger(entry.baseConfigRevision) && Number(entry.baseConfigRevision) > 0
        ? Number(entry.baseConfigRevision)
        : null,
      jobData: JSON.parse(JSON.stringify(entry.jobData)),
      apply: entry.apply,
      applying: false,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    }
    if (stored.operation === 'update' && (stored.jobId === null || stored.baseConfigRevision === null)) {
      throw new Error('update automation suggestion requires jobId and baseConfigRevision')
    }
    this.entries.set(suggestionId, stored)
    return publicEntry(stored)
  }

  get(ref: string): SuggestionView | null {
    this.pruneExpired()
    const found = [...this.entries.values()].find(entry =>
      entry.suggestionId === ref || entry.shortCode === ref)
    return found !== undefined ? publicEntry(found) : null
  }

  list(): SuggestionView[] {
    this.pruneExpired()
    return [...this.entries.values()].sort((a, b) => a.createdAt - b.createdAt).map(publicEntry)
  }

  /**
   * 应用建议：合并用户编辑 → 签发 receipt → 执行 apply（写 CronStore）。
   * 不存在 / 过期 / 正在应用分别返回对应失败原因。
   */
  async apply({ ref, value }: { ref?: string | null, value?: unknown } = {}): Promise<
    { ok: true, suggestion: SuggestionView, result: CronJob | null }
    | { ok: false, reason: 'not-found' | 'expired' | 'already-applying' }
  > {
    this.pruneExpired()
    const candidates = [...this.entries.values()].sort((a, b) => b.createdAt - a.createdAt)
    const entry = ref != null && ref !== ''
      ? candidates.find(candidate => candidate.suggestionId === ref || candidate.shortCode === ref)
      : candidates[0]
    if (entry === undefined) return { ok: false, reason: 'not-found' }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(entry.suggestionId)
      return { ok: false, reason: 'expired' }
    }
    if (entry.applying) return { ok: false, reason: 'already-applying' }
    entry.applying = true
    try {
      const merged = mergeConfirmedDraft(entry.jobData, value)
      const receipt: SuggestionReceipt = Object.freeze({
        suggestionId: entry.suggestionId,
        confirmedAt: new Date().toISOString(),
        expiresAt: entry.expiresAt,
        operation: entry.operation,
        jobId: entry.jobId,
        baseConfigRevision: entry.baseConfigRevision,
      })
      assertReceiptUsable(receipt)
      const result = await Promise.resolve(entry.apply({ jobData: merged, receipt }))
      this.entries.delete(entry.suggestionId)
      return { ok: true, suggestion: publicEntry(entry), result }
    } finally {
      entry.applying = false
    }
  }

  /** 用户显式拒绝一条建议：立即移除（不存在返回 false）。 */
  dismiss(ref: string): boolean {
    this.pruneExpired()
    const entry = [...this.entries.values()].find(candidate =>
      candidate.suggestionId === ref || candidate.shortCode === ref)
    if (entry === undefined) return false
    this.entries.delete(entry.suggestionId)
    return true
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now && entry.applying !== true) this.entries.delete(id)
    }
  }
}

/** 把用户在确认卡上做过的修改合并进建议草稿（仅白名单字段）。 */
function mergeConfirmedDraft(base: SuggestionJobData, value: unknown): SuggestionJobData {
  if (!isPlainObject(value)) return base
  const draft = isPlainObject(value.jobData) ? value.jobData : value
  const next: SuggestionJobData = JSON.parse(JSON.stringify(base))
  for (const key of Object.keys(draft)) {
    if (!CONFIRMABLE_FIELDS.has(key)) continue
    if (draft[key] === undefined) continue
    ;(next as Record<string, unknown>)[key] = draft[key]
  }
  return next
}

function assertReceiptUsable(receipt: SuggestionReceipt): void {
  if (receipt.expiresAt <= Date.now()) {
    throw new CodedError('自动化建议已过期', 'automation_suggestion_receipt_expired', 410)
  }
}

function publicEntry(entry: SuggestionEntry): SuggestionView {
  return {
    suggestionId: entry.suggestionId,
    shortCode: entry.shortCode,
    operation: entry.operation,
    jobId: entry.jobId,
    baseConfigRevision: entry.baseConfigRevision,
    jobData: JSON.parse(JSON.stringify(entry.jobData)),
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
