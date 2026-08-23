/**
 * automation — host API 封装（/api/webui-automation）。
 */

import type { AutomationEvent, CronJob, RunsResponse, SuggestionView } from './types.ts'

const BASE = '/api/webui-automation'

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  const data = await res.json().catch(() => ({})) as T & { error?: string }
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' && data.error !== '' ? data.error : `HTTP ${res.status}`)
  }
  return data
}

function post<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** 任务列表。 */
export function listJobs(): Promise<{ jobs: CronJob[] }> {
  return requestJson(`${BASE}/cron`)
}

export interface AddJobPayload {
  scheduleType: 'at' | 'every' | 'cron'
  schedule: string | number
  prompt: string
  label?: string
  model?: unknown
  enabled?: boolean
}

/** 新建任务（openhanako 同款「灰卡」流程：enabled:false 先建后编辑）。 */
export function addJob(payload: AddJobPayload): Promise<{ job: CronJob, jobs: CronJob[] }> {
  return post('/cron', { action: 'add', ...payload })
}

/** 删除任务。 */
export function removeJob(id: string): Promise<{ jobs: CronJob[] }> {
  return post('/cron', { action: 'remove', id })
}

/** 启用/停用切换。 */
export function toggleJob(id: string): Promise<{ job: CronJob, jobs: CronJob[] }> {
  return post('/cron', { action: 'toggle', id })
}

export interface UpdateJobPayload {
  id: string
  label?: string
  prompt?: string
  model?: unknown
  enabled?: boolean
  scheduleType?: 'at' | 'every' | 'cron'
  schedule?: string | number
}

/** 更新任务字段。 */
export function updateJob(payload: UpdateJobPayload): Promise<{ job: CronJob, jobs: CronJob[] }> {
  return post('/cron', { action: 'update', ...payload })
}

/** 立即运行（拨动游标到当下）。 */
export function runNow(id: string): Promise<void> {
  return post('/cron', { action: 'run_now', id }) as Promise<void>
}

/** 运行历史。 */
export function getRuns(jobId?: string, limit = 20): Promise<RunsResponse> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (jobId !== undefined && jobId !== '') query.set('jobId', jobId)
  return requestJson(`${BASE}/runs?${query.toString()}`)
}

/** 读取一次运行的完整产出（Markdown 文本）。 */
export function getRunFile(jobId: string, name: string): Promise<{ content: string }> {
  return requestJson(`${BASE}/runs/file?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(name)}`)
}

/** 待确认建议列表。 */
export function listSuggestions(): Promise<{ suggestions: SuggestionView[] }> {
  return requestJson(`${BASE}/suggestions`)
}

/** 应用建议（可携带用户在确认卡上改过的字段）。 */
export function applySuggestion(suggestionId: string, jobData?: Record<string, unknown>): Promise<{ jobs: CronJob[], suggestions: SuggestionView[] }> {
  return post('/cron', { action: 'apply_suggestion', suggestionId, ...(jobData !== undefined ? { jobData } : {}) })
}

/** 拒绝建议。 */
export function dismissSuggestion(suggestionId: string): Promise<{ suggestions: SuggestionView[] }> {
  return post('/suggestions', { action: 'dismiss', suggestionId })
}

/** 拉取完成事件（供全局 toast 轮询）。 */
export function getEvents(since: number): Promise<{ events: AutomationEvent[], cursor: number }> {
  return requestJson(`${BASE}/events?since=${encodeURIComponent(String(since))}`)
}
