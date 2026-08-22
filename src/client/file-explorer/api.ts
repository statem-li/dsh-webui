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
