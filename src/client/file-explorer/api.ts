/**
 * dsh-file-explorer client API layer: typed fetch helpers over the host's
 * /api/file-explorer routes (loopback HTTP, plain fetch).
 */

export interface WorkspaceView {
  id: string
  title: string
  path: string
}

export interface DirEntry {
  name: string
  type: 'file' | 'directory'
  size?: number
}

export interface FileContent {
  content: string
  version: string
  path: string
}

export interface WriteResult {
  version: string
  operation: 'create' | 'update'
}

const API_BASE = '/api/file-explorer'

/** A host API failure carrying its stable fs code (if any). */
export class ApiError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

interface ApiBody {
  error?: string
  code?: string
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' } })
  const body = await response.json() as T & ApiBody
  if (!response.ok) throw new ApiError(body.error ?? `request failed (${String(response.status)})`, body.code)
  return body
}

async function sendJson<T>(method: string, path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json() as T & ApiBody
  if (!response.ok) throw new ApiError(body.error ?? `request failed (${String(response.status)})`, body.code)
  return body
}

export function listWorkspaces(): Promise<WorkspaceView[]> {
  return getJson<WorkspaceView[]>('/workspaces')
}

export function listDirectory(path: string): Promise<DirEntry[]> {
  return getJson<DirEntry[]>(`/list?path=${encodeURIComponent(path)}`)
}

export function readFile(path: string): Promise<FileContent> {
  return getJson<FileContent>(`/read?path=${encodeURIComponent(path)}`)
}

/** URL for serving a file's raw bytes inline (images) or as a download. */
export function rawFileUrl(path: string, download = false): string {
  return `${API_BASE}/raw?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`
}

export interface BinaryPreview {
  base64: string
  size: number
  truncated: boolean
}

/** Leading bytes of any file (base64) for the hex preview fallback. */
export function readBinaryPreview(path: string): Promise<BinaryPreview> {
  return getJson<BinaryPreview>(`/bin?path=${encodeURIComponent(path)}`)
}

export function writeFile(path: string, content: string, version?: string): Promise<WriteResult> {
  return sendJson<WriteResult>('PUT', '/write', { path, content, version })
}

// ── 会话产物清单（数据来自 webui-deliverables 的 fs 写入记账）────────────

/** 一条产物记录：绝对路径 + 最近一次写入时刻（epoch ms）。 */
export interface DeliverableItem {
  path: string
  time: number
}

/** 拉取某会话的产物清单（按写入时刻倒序；host 端持久化，重启后依然可用）。 */
export async function fetchSessionDeliverables(sessionId: string): Promise<DeliverableItem[]> {
  const response = await fetch(`/api/webui-deliverables?sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: 'application/json' } })
  // 服务未重启时路由不存在（DSH 默认 404 可能返回非 JSON 体）。
  const missing = response.status === 404
  let body: { ok?: boolean; error?: string; items?: DeliverableItem[] }
  try {
    body = await response.json() as { ok?: boolean; error?: string; items?: DeliverableItem[] }
  } catch {
    throw new ApiError(missing ? 'deliverables routes not mounted' : `request failed (${String(response.status)})`, missing ? 'SERVICE_MISSING' : undefined)
  }
  if (!response.ok || body.ok !== true || !Array.isArray(body.items)) {
    throw new ApiError(body.error ?? `request failed (${String(response.status)})`, missing ? 'SERVICE_MISSING' : undefined)
  }
  return body.items
}

// ── 产物内容读取（走 webui-deliverables 专用路由：按会话记账授权，
//    不受「注册工作区包含」校验限制——产物可能落在 workspace 外）──────

async function deliverableJson<T extends object>(kind: string, sessionId: string, path: string): Promise<T & ApiBody> {
  const url = `/api/webui-deliverables/${kind}?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  let body: (T & ApiBody) | null = null
  try {
    body = await response.json() as T & ApiBody
  } catch { /* 非 JSON 错误体 */ }
  if (!response.ok || body === null || body.error !== undefined) {
    throw new ApiError(body?.error ?? `request failed (${String(response.status)})`, body?.code)
  }
  return body as T & ApiBody
}

/** 读产物文本内容（2MB 上限；二进制文件抛 FS_NOT_TEXT）。 */
export function fetchDeliverableContent(sessionId: string, path: string): Promise<FileContent> {
  return deliverableJson<FileContent>('content', sessionId, path).then(body => ({
    content: body.content, version: body.version ?? '', path,
  }))
}

/** 产物头部字节（base64，hex 兜底预览用）。 */
export function fetchDeliverableBin(sessionId: string, path: string): Promise<BinaryPreview> {
  return deliverableJson<BinaryPreview>('bin', sessionId, path)
}

/** 产物 raw 字节流 URL（图片内嵌 / 下载）。 */
export function deliverableRawUrl(sessionId: string, path: string, download = false): string {
  return `/api/webui-deliverables/raw?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`
}

// ── 文件查看数据源抽象 ──────────────────────────────────────────────────────

/**
 * 文件查看卡的取数来源：默认走 file-explorer（按注册工作区校验）；
 * 产物场景传 deliverableSource（按会话记账授权，覆盖 workspace 外产物）。
 */
export interface FileReadSource {
  content(path: string): Promise<FileContent>
  binaryPreview(path: string): Promise<BinaryPreview>
  rawUrl(path: string, download?: boolean): string
}

/** file-explorer 默认源。 */
export const explorerSource: FileReadSource = {
  content: path => readFile(path),
  binaryPreview: path => readBinaryPreview(path),
  rawUrl: (path, download) => rawFileUrl(path, download),
}

/** 产物记账源（需要会话 id）；id 缺失时返回 undefined 由调用方回退默认源。 */
export function deliverableSource(sessionId?: string): FileReadSource | undefined {
  if (sessionId === undefined || sessionId === '') return undefined
  return {
    content: path => fetchDeliverableContent(sessionId, path),
    binaryPreview: path => fetchDeliverableBin(sessionId, path),
    rawUrl: (path, download) => deliverableRawUrl(sessionId, path, download),
  }
}

// ── 修改历史（数据来自 webui-rewind 的对话快照）───────────────────────────

const REWIND_BASE = '/api/webui-rewind'

/** 一个历史时点：该消息发送前的工作区快照中此文件的内容态。 */
export interface FileHistoryPoint {
  /** 快照锚定的消息 seq。 */
  seq: number
  /** 快照时刻（≈消息发送时刻）epoch ms。 */
  createdAt: number
  /** 该时点文件字节数。 */
  size: number
}

export interface FileHistoryResult {
  ok: boolean
  error?: string
  cwd?: string
  points?: FileHistoryPoint[]
}

/** 拉取某文件的修改历史（内容变化的时间点，升序）。 */
export async function fetchFileHistory(sessionId: string, path: string): Promise<FileHistoryResult> {
  const response = await fetch(`${REWIND_BASE}/history?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`)
  return await response.json() as FileHistoryResult
}

/** 对比行：kind 决定着色与哪侧留空；l/r 为各侧行（行号 1 起）。 */
export interface CompareRow {
  kind: 'ctx' | 'add' | 'del' | 'mod'
  l?: { no: number; text: string }
  r?: { no: number; text: string }
}

export interface FileCompareResult {
  ok: boolean
  error?: string
  status?: 'changed' | 'same' | 'unsupported'
  note?: 'both' | 'left' | 'right'
  rows?: CompareRow[]
  stats?: { added: number; removed: number; unchanged: number }
  truncated?: boolean
  leftMissing?: boolean
  rightMissing?: boolean
  leftSize?: number
  rightSize?: number
  leftTime?: number
}

/**
 * 拉取「历史版本 vs 当前」的双栏对齐 diff。
 * @param seq 基准快照的消息 seq（左栏）
 * @param seqB 可选的第二快照 seq；缺省右栏为当前磁盘内容
 */
export async function fetchFileCompare(sessionId: string, seq: number, path: string, seqB?: number): Promise<FileCompareResult> {
  let url = `${REWIND_BASE}/compare?sessionId=${encodeURIComponent(sessionId)}&seq=${seq}&path=${encodeURIComponent(path)}`
  if (seqB !== undefined) url += `&seqB=${seqB}`
  const response = await fetch(url)
  return await response.json() as FileCompareResult
}
