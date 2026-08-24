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
  /** true = 已禁用（保留但不参与注入/编译）。 */
  disabled: boolean
  importance: number
  layer: 'short' | 'long'
  source: 'extract' | 'manual'
  createdAt: string
  updatedAt: string
  /** 条目级版本号（每次内容变更 +1）。 */
  version: number
  /** 置信度 0-1（手动记忆=1）。 */
  confidence: number
  /** 用户是否已显式确认。 */
  verified: boolean
  /** 记忆类型。 */
  kind: MemoryKind
  /** 上次注入命中时间（null=从未命中）。 */
  lastHitAt: string | null
}

/** 记忆类型（host MemoryKind 镜像）。 */
export type MemoryKind = 'identity' | 'preference' | 'fact' | 'decision' | 'gotcha' | 'session-summary'

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
  /**
   * 以下计数由较新的 host 提供。client 与 host 分别部署——插件更新后 client
   * 刷新页面即生效，host 要重启 DSH 才换新；这段窗口里字段缺失，面板据 undefined
   * 隐藏对应指标（补 0 会显示「全局 0」之类的假数据）。
   */
  pinnedCount?: number
  disabledCount?: number
  longtermCount?: number
  globalCount?: number
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

/** 运行时配置视图（host publicConfig 镜像，字段均可缺省）。 */
export interface MemoryConfigView {
  extractEveryTurns?: number
  compileEveryTurns?: number
  compileThreshold?: number
  decayLambda?: number
  hitBonus?: number
  injectTokenBudget?: number
  injectRefreshSteps?: number
  extractMaxChars?: number
  minImportance?: number
  consolidateMaxEntries?: number
  consolidateTimeoutMs?: number
  injectTopK?: number
  entryLimit?: number
  dailyCompileEnabled?: boolean
  consolidateEnabled?: boolean
  logApiRequests?: boolean
}

interface ApiError {
  error?: string
}

/** 记忆类型合法值（规范化用）。 */
const KIND_VALUES: readonly MemoryKind[] = ['identity', 'preference', 'fact', 'decision', 'gotcha', 'session-summary']

/**
 * 规范化条目视图：补齐 schema v2 字段的缺省值。
 *
 * host 与 client 是各自独立部署的两半——用户更新插件后 client 立刻生效（刷新页面），
 * 但 host 要重启 DSH 才换新。这段窗口里旧 host 不返回 version/confidence/kind/lastHitAt，
 * 若直接渲染会出现「版本 vundefined」「置信度 NaN%」和空白徽章。
 */
function normalizeEntry(entry: MemoryEntryView): MemoryEntryView {
  return {
    ...entry,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    disabled: entry.disabled === true,
    pinned: entry.pinned === true,
    importance: Number.isFinite(entry.importance) ? entry.importance : 0,
    version: Number.isFinite(entry.version) ? entry.version : 1,
    confidence: Number.isFinite(entry.confidence) ? entry.confidence : (entry.source === 'manual' ? 1 : 0.6),
    verified: entry.verified === true,
    kind: KIND_VALUES.includes(entry.kind) ? entry.kind : 'fact',
    lastHitAt: typeof entry.lastHitAt === 'string' ? entry.lastHitAt : null,
  }
}

/** 规范化概览：基础计数缺省按 0；新增计数缺省保持 undefined（面板隐藏）。 */
function normalizeSummary(summary: MemorySummaryResponse): MemorySummaryResponse {
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const opt = (value: unknown): number | undefined =>
    (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  return {
    today: typeof summary.today === 'string' ? summary.today : '',
    entryCount: num(summary.entryCount),
    projectCount: num(summary.projectCount),
    todayChanges: num(summary.todayChanges),
    pinnedCount: opt(summary.pinnedCount),
    disabledCount: opt(summary.disabledCount),
    longtermCount: opt(summary.longtermCount),
    globalCount: opt(summary.globalCount),
  }
}

/** 规范化响应里的单个 entry 字段（pin/enable/update/move/remember 共用）。 */
function withEntry<T extends { entry: MemoryEntryView }>(response: T): T {
  return { ...response, entry: normalizeEntry(response.entry) }
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
  enable: (entryId: string, enabled: boolean) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  update: (entryId: string, patch: {
    content?: string
    tags?: string[]
    importance?: number
    pinned?: boolean
    kind?: MemoryKind
    layer?: 'short' | 'long'
  }) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  move: (entryId: string, target: { scope?: string; projectHash?: string; path?: string }) => Promise<{ ok: boolean; entry: MemoryEntryView }>
  deleteEntry: (entryId: string) => Promise<{ ok: boolean }>
  /** 批量删除（一次事务 + 一次编译，替代 N 次 deleteEntry）。 */
  deleteBatch: (entryIds: string[]) => Promise<{ ok: boolean; deleted: number; missing: number }>
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
  getConfig: () => Promise<{ config: MemoryConfigView }>
  setConfig: (patch: Partial<MemoryConfigView>) => Promise<{ ok: boolean; config: MemoryConfigView }>
  /** 恢复引擎默认配置（清空 config.json 覆盖层）。 */
  resetConfig: () => Promise<{ ok: boolean; config: MemoryConfigView }>
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
      return getJson<MemoryListResponse>(`/list${suffix}`).then(response => ({
        ...response,
        entries: (response.entries ?? []).map(normalizeEntry),
        projects: response.projects ?? [],
      }))
    },
    projects: () => getJson<{ projects: ProjectView[] }>('/projects'),
    tags: () => getJson<MemoryTagsResponse>('/tags'),
    changes: (date) => getJson<MemoryChangesResponse>(`/changes${date !== undefined ? `?date=${encodeURIComponent(date)}` : ''}`),
    summary: () => getJson<MemorySummaryResponse>('/summary').then(normalizeSummary),
    pin: (entryId, pinned) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/pin', { entryId, pinned }).then(withEntry),
    enable: (entryId, enabled) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/enable', { entryId, enabled }).then(withEntry),
    update: (entryId, patch) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/update', { entryId, ...patch }).then(withEntry),
    move: (entryId, target) => sendJson<{ ok: boolean; entry: MemoryEntryView }>('/move', { entryId, ...target }).then(withEntry),
    deleteEntry: (entryId) => sendJson<{ ok: boolean }>('/delete', { entryId }),
    deleteBatch: (entryIds) => sendJson<{ ok: boolean; deleted: number; missing: number }>('/delete-batch', { entryIds }),
    deleteProject: (projectHash) => sendJson<{ ok: boolean; deleted: number }>('/delete-project', { projectHash }),
    meta: (projectHash, patch) => sendJson<{ ok: boolean; meta: ProjectView }>('/meta', { projectHash, ...patch }),
    remember: (input) => sendJson<{ ok: boolean; created: boolean; entry: MemoryEntryView }>('/remember', input).then(withEntry),
    getInjectState: (sessionId) => getJson<{ enabled: boolean }>(`/inject-state?sessionId=${encodeURIComponent(sessionId)}`),
    setInjectState: (sessionId, enabled) => sendJson<{ ok: boolean; enabled: boolean }>('/inject-state', { sessionId, enabled }),
    consolidate: (scope = 'all', projectHash) => sendJson<{ ok: boolean; results: ConsolidateResultView[] }>('/consolidate', { scope, projectHash }),
    revisions: () => getJson<{ revisions: RevisionView[] }>('/revisions'),
    rollback: (revisionId) => sendJson<{ ok: boolean }>('/rollback', { revisionId }),
    getConfig: () => getJson<{ config: MemoryConfigView }>('/config'),
    setConfig: (patch) => sendJson<{ ok: boolean; config: MemoryConfigView }>('/config', patch),
    resetConfig: () => sendJson<{ ok: boolean; config: MemoryConfigView }>('/config', { reset: true }),
  }
}
