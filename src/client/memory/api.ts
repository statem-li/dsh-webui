/**
 * dsh-memory client API：镜像 host 的 /api/dsh-memory/* 路由。
 * 纯 fetch（无 typert、无 DSH 源码改动），与 skill-manager 同款模式。
 */

const API_BASE = '/api/dsh-memory'

/** 记忆条目视图（host toView 镜像）。 */
export interface MemoryEntryView {
  id: string
  content: string
  scope: 'global' | 'project'
  projectHash: string | null
  tags: string[]
  pinned: boolean
  importance: number
  layer: 'short' | 'long'
  source: 'extract' | 'manual'
  createdAt: string
  updatedAt: string
}

/** 项目视图。 */
export interface ProjectView {
  hash: string
  path: string
  alias: string | null
  locked: boolean
  autoMemory: boolean
  entryCount: number
  pinnedCount: number
}

/** 变更记录。 */
export interface ChangeView {
  id: string
  action: 'add' | 'update' | 'promote' | 'delete'
  entryId: string
  scope: 'global' | 'project'
  projectHash: string | null
  summary: string
  before?: string
  after?: string
  at: string
}

/** 面板列表响应。 */
export interface MemoryListResponse {
  entries: MemoryEntryView[]
  projects: ProjectView[]
}

/** 概览响应。 */
export interface MemorySummaryResponse {
  today: string
  entryCount: number
  projectCount: number
  todayChanges: number
}

/** 变更响应。 */
export interface MemoryChangesResponse {
  date: string
  changes: ChangeView[]
}

/** 标签聚合。 */
export interface MemoryTagsResponse {
  tags: Array<{ tag: string; count: number }>
}

/** 整理结果（host ConsolidateResult 镜像）。 */
export interface ConsolidateResultView {
  scope: string
  merged: number
  rewritten: number
  dropped: number
  promoted: number
  changed: number
}

/** 修订版本（host RevisionMeta 镜像）。 */
export interface RevisionView {
  id: string
  at: string
  entryCount: number
  scope: string
  trigger: 'daily' | 'manual'
}

interface ApiError {
  error?: string
}

/** GET helper with JSON parsing and error surfacing. */
async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' } })
  const body = await response.json() as T & ApiError
  if (!response.ok) throw new Error(body.error ?? `request failed (${String(response.status)})`)
  return body
}

/** POST helper with JSON body. */
async function sendJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json() as T & ApiError
  if (!response.ok) throw new Error(body.error ?? `request failed (${String(response.status)})`)
  return body
}

/** 面板 API 面（slots inject 提供）。 */
export interface MemoryApi {
  list: (params?: { scope?: string; project?: string; q?: string; tag?: string }) => Promise<MemoryListResponse>
  projects: () => Promise<{ projects: ProjectView[] }>
  tags: () => Promise<MemoryTagsResponse>
  changes: (date?: string) => Promise<MemoryChangesResponse>
  summary: () => Promise<MemorySummaryResponse>
  pin: (entryId: string, pinned: boolean) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  update: (entryId: string, patch: { content?: string; tags?: string[] }) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  move: (entryId: string, target: { scope?: string; projectHash?: string; path?: string }) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  deleteEntry: (entryId: string) => Promise<{ ok: boolean }>
  deleteProject: (projectHash: string) => Promise<{ ok: boolean; deleted: number }>
  meta: (projectHash: string, patch: { alias?: string; locked?: boolean; path?: string; autoMemory?: boolean }) => Promise<{ ok: boolean; meta: ProjectView }>
  remember: (input: {
    content: string
    scope?: 'global' | 'project'
    projectHash?: string
    path?: string
    tags?: string[]
    pinned?: boolean
    importance?: number
  }) => Promise<{ ok: boolean; created: boolean; entry: MemoryEntryView }>
  getInjectState: (sessionId: string) => Promise<{ enabled: boolean }>
  setInjectState: (sessionId: string, enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>
  consolidate: (scope?: 'all' | 'global' | 'project', projectHash?: string) => Promise<{ ok: boolean; results: ConsolidateResultView[] }>
  revisions: () => Promise<{ revisions: RevisionView[] }>
  rollback: (revisionId: string) => Promise<{ ok: boolean }>
}

/** 构造面板 API 面。 */
export function createMemoryApi(): MemoryApi {
  return {
    list: (params = {}) => {
      const query = new URLSearchParams()
      if (params.scope !== undefined && params.scope !== '') query.set('scope', params.scope)
      if (params.project !== undefined && params.project !== '') query.set('project', params.project)
      if (params.q !== undefined && params.q !== '') query.set('q', params.q)
      if (params.tag !== undefined && params.tag !== '') query.set('tag', params.tag)
      const suffix = query.toString() === '' ? '' : `?${query.toString()}`
      return getJson<MemoryListResponse>(`/list${suffix}`)
    },
    projects: () => getJson<{ projects: ProjectView[] }>('/projects'),
    tags: () => getJson<MemoryTagsResponse>('/tags'),
    changes: (date) => getJson<MemoryChangesResponse>(`/changes${date !== undefined ? `?date=${encodeURIComponent(date)}` : ''}`),
    summary: () => getJson<MemorySummaryResponse>('/summary'),
    pin: (entryId, pinned) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/pin', { entryId, pinned }),
    update: (entryId, patch) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/update', { entryId, ...patch }),
    move: (entryId, target) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/move', { entryId, ...target }),
    deleteEntry: (entryId) => sendJson<{ ok: boolean }>('/delete', { entryId }),
    deleteProject: (projectHash) => sendJson<{ ok: boolean; deleted: number }>('/delete-project', { projectHash }),
    meta: (projectHash, patch) => sendJson<{ ok: boolean; meta: ProjectView }>('/meta', { projectHash, ...patch }),
    remember: (input) => sendJson<{ ok: boolean; created: boolean; entry: MemoryEntryView }>('/remember', input),
    getInjectState: (sessionId) => getJson<{ enabled: boolean }>(`/inject-state?sessionId=${encodeURIComponent(sessionId)}`),
    setInjectState: (sessionId, enabled) => sendJson<{ ok: boolean; enabled: boolean }>('/inject-state', { sessionId, enabled }),
    consolidate: (scope = 'all', projectHash) => sendJson<{ ok: boolean; results: ConsolidateResultView[] }>('/consolidate', { scope, projectHash }),
    revisions: () => getJson<{ revisions: RevisionView[] }>('/revisions'),
    rollback: (revisionId) => sendJson<{ ok: boolean }>('/rollback', { revisionId }),
  }
}
