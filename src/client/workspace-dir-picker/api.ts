/**
 * 工作区目录选择器 client API 层:typed fetch helpers over the host's
 * /api/webui-dir-picker routes (loopback HTTP, plain fetch)。
 * 与 host 半身 src/workspace-dir-picker.ts 的响应形状一一对应。
 */

/** 目录行:面包屑祖先或子目录。 */
export interface DirEntry {
  name: string
  path: string
  hidden: boolean
}

/** 一个目录层级 + 祖先链(镜像官方 DirectoryListing 语义)。 */
export interface DirListing {
  path: string
  home: string
  crumbs: DirEntry[]
  entries: DirEntry[]
  truncated: boolean
}

const API_BASE = '/api/webui-dir-picker'

/** host API 失败,携带稳定业务码(镜像官方 directory-picker 错误码)。 */
export class DirApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'DirApiError'
  }
}

interface ApiBody {
  error?: string
  code?: string
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' } })
  const body = await response.json() as T & ApiBody
  if (!response.ok) throw new DirApiError(body.error ?? `request failed (${String(response.status)})`, body.code)
  return body
}

async function sendJson<T>(method: string, path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json() as T & ApiBody
  if (!response.ok) throw new DirApiError(body.error ?? `request failed (${String(response.status)})`, body.code)
  return body
}

/** 列出一个目录层级;缺省 path 列出宿主 home 目录。 */
export function listDirectory(path?: string): Promise<DirListing> {
  const query = path === undefined || path === '' ? '' : `?path=${encodeURIComponent(path)}`
  return getJson<DirListing>(`/list${query}`)
}

/** 在既有父目录下新建一个子目录,返回其绝对路径。 */
export function createDirectory(path: string, name: string): Promise<{ path: string }> {
  return sendJson<{ path: string }>('POST', '/create', { path, name })
}

/** 本机可选的顶层目录（盘符/根）:弹窗「盘符」切换入口。 */
export function listDrives(): Promise<Array<{ name: string; path: string }>> {
  return getJson<{ drives: Array<{ name: string; path: string }> }>('/drives')
    .then(body => body.drives)
}
