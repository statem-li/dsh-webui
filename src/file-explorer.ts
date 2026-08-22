/**
 * 工作区文件浏览器（自 dsh-file-explorer 合并）：挂 /api/file-explorer 路由，
 * 提供工作区文件列表/读取/写入。所有文件 IO 走 `ctx.fs`，工作区根来自
 * `ctx.workspaceRegistry`。安全：loopback-only + 工作区根 containment。
 *
 * Routes (all under /api/file-explorer):
 *   GET /workspaces           → [{ id, title, path }]
 *   GET /list?path=<dir>      → [{ name, type, size }]  (directories first)
 *   GET /read?path=<file>     → { content, version, path }
 *   GET /raw?path=<file>      → raw bytes (inline image serving / download)
 *   GET /bin?path=<file>      → { base64, size, truncated } hex-preview head
 *   PUT /write  { path, content, version? } → { version, operation }
 */

import { URL } from 'node:url'
import { open as openFileHandle } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** ── Minimal service contracts (kept small to avoid the dsh type dependency
 *  chain; the real services implement these shapes). ─────────────────────── */

interface FsTarget {
  targetKey: string
  displayPath: string
}

interface FsInfo {
  version: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

interface FsDirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  target: FsTarget
  size?: number
}

type FsWriteIntent =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: string }

interface FsWriteOutcome {
  operation: 'create' | 'update'
  version: string
  before: string | null
  after: string
}

interface SandboxPolicyLike {
  mode: string
  workspaceRoot: string
}

interface SandboxPolicyServiceLike {
  resolve(request?: { mode?: string }): SandboxPolicyLike
}

interface FileSystemService {
  resolve(path: string): Promise<FsTarget>
  processPath(target: FsTarget): string
  stat(target: FsTarget): Promise<FsInfo | undefined>
  listDir(target: FsTarget): Promise<FsDirEntry[]>
  readText(target: FsTarget): Promise<string>
  readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: unknown,
    sandboxPolicy?: SandboxPolicyLike,
  ): Promise<FsWriteOutcome>
  contains(parent: FsTarget, child: FsTarget): boolean
}

interface WorkspaceView {
  id: string
  title: string
  path: string
}

interface WorkspaceRegistryService {
  list(): WorkspaceView[]
}

interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServerService {
  register(route: WebServerRoute): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fs: FileSystemService
    workspaceRegistry: WorkspaceRegistryService
    webServer: WebServerService
  }
}

/** ── Constants ─────────────────────────────────────────────────────────── */

const ROUTE_PREFIX = '/api/file-explorer'
/** Text preview ceiling; larger files are refused rather than read whole. */
const MAX_READ_BYTES = 2 * 1024 * 1024
/** Write body ceiling (JSON-escaped content can inflate ~2x). */
const MAX_BODY_BYTES = 16 * 1024 * 1024
/** Raw-byte ceiling for inline image serving / download. */
const MAX_RAW_BYTES = 32 * 1024 * 1024
/** Hex-preview head size for binary files (any type opens with a peek). */
const HEX_PREVIEW_BYTES = 4 * 1024

/** Extension → MIME for raw serving; unknown → application/octet-stream. */
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.cur': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

/** Guess a serving MIME type from the file extension. */
function mimeTypeForPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'application/octet-stream'
  return MIME_BY_EXT[name.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

/** ── Errors ────────────────────────────────────────────────────────────── */

/** A deliberate HTTP failure with a chosen status. */
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

/** An fs error carries a stable machine code (FsError['code']). */
interface FsErrorLike {
  code?: unknown
}

/** Map an fs error's stable code to an HTTP status; unknown → 400. */
function fsErrorStatus(error: FsErrorLike): number {
  switch (error.code) {
    case 'FS_NOT_FOUND': return 404
    case 'FS_STALE_VERSION': return 409
    case 'FS_TOO_LARGE': return 413
    case 'FS_NOT_TEXT': return 415
    case 'FS_PERMISSION_DENIED':
    case 'FS_SANDBOX_DENIED': return 403
    default: return 400
  }
}

/** ── Loopback fence (same contract as dsh-skill-manager) ───────────────── */

function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function hostNameOf(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close <= 1) return null
    const suffix = host.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return host.slice(1, close)
  }
  const firstColon = host.indexOf(':')
  const lastColon = host.lastIndexOf(':')
  if (firstColon !== lastColon) return null
  return firstColon === -1 ? host : host.slice(0, firstColon)
}

function loopbackAllowed(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = hostNameOf(req.headers.host)
  if (host === null) return false
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/** ── HTTP plumbing ─────────────────────────────────────────────────────── */

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolvePromise({})
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new HttpError(400, 'invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** ── Workspace containment ─────────────────────────────────────────────── */

/** Resolve a raw path and verify it lives inside some registered workspace. */
async function resolveWithinWorkspace(ctx: Context, rawPath: unknown): Promise<FsTarget> {
  if (typeof rawPath !== 'string' || rawPath === '') {
    throw new HttpError(400, 'path is required')
  }
  let target: FsTarget
  try {
    target = await ctx.fs.resolve(rawPath)
  } catch {
    throw new HttpError(404, 'path does not exist')
  }
  for (const workspace of ctx.workspaceRegistry.list()) {
    let root: FsTarget
    try {
      root = await ctx.fs.resolve(workspace.path)
    } catch {
      // Workspace directory is temporarily missing; skip it.
      continue
    }
    if (ctx.fs.contains(root, target)) return target
  }
  throw new HttpError(403, 'path is outside every workspace')
}

/** ── Route handlers ────────────────────────────────────────────────────── */

async function listWorkspaces(ctx: Context): Promise<WorkspaceView[]> {
  return ctx.workspaceRegistry.list().map(workspace => ({
    id: workspace.id,
    title: workspace.title,
    path: workspace.path,
  }))
}

async function listDirectory(ctx: Context, rawPath: unknown): Promise<Array<{ name: string; type: string; size?: number }>> {
  const target = await resolveWithinWorkspace(ctx, rawPath)
  const info = await ctx.fs.stat(target)
  if (info === undefined) throw new HttpError(404, 'directory does not exist')
  if (info.type !== 'directory') throw new HttpError(400, 'path is not a directory')
  const entries = await ctx.fs.listDir(target)
  const rows = entries
    .filter(entry => entry.type === 'file' || entry.type === 'directory')
    .map(entry => ({ name: entry.name, type: entry.type, size: entry.size }))
  // Directories first, then files; each group sorted by name.
  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return rows
}

async function readFile(ctx: Context, rawPath: unknown): Promise<{ content: string; version: string; path: string }> {
  const target = await resolveWithinWorkspace(ctx, rawPath)
  const info = await ctx.fs.stat(target)
  if (info === undefined) throw new HttpError(404, 'file does not exist')
  if (info.type !== 'file') throw new HttpError(400, 'path is not a file')
  if (info.size !== undefined && info.size > MAX_READ_BYTES) {
    throw new HttpError(413, 'file is too large to preview')
  }
  const content = await ctx.fs.readText(target)
  return { content, version: info.version, path: target.displayPath }
}

/** Serve the whole file as raw bytes (inline images, downloads). */
async function readRaw(
  ctx: Context,
  rawPath: unknown,
): Promise<{ bytes: Buffer; mime: string }> {
  const target = await resolveWithinWorkspace(ctx, rawPath)
  const info = await ctx.fs.stat(target)
  if (info === undefined) throw new HttpError(404, 'file does not exist')
  if (info.type !== 'file') throw new HttpError(400, 'path is not a file')
  if (info.size !== undefined && info.size > MAX_RAW_BYTES) {
    throw new HttpError(413, 'file is too large to serve')
  }
  const bytes = await ctx.fs.readBytes(target, undefined, MAX_RAW_BYTES)
  return { bytes: Buffer.from(bytes), mime: mimeTypeForPath(target.displayPath) }
}

/** Read the leading bytes of any file as base64 for a hex preview.
 *  `fs.readBytes` rejects files larger than its cap outright, so read the
 *  head straight from disk via the resolved target path instead. */
async function readBinaryPreview(
  ctx: Context,
  rawPath: unknown,
): Promise<{ base64: string; size: number; truncated: boolean }> {
  const target = await resolveWithinWorkspace(ctx, rawPath)
  const info = await ctx.fs.stat(target)
  if (info === undefined) throw new HttpError(404, 'file does not exist')
  if (info.type !== 'file') throw new HttpError(400, 'path is not a file')
  const handle = await openFileHandle(ctx.fs.processPath(target), 'r')
  try {
    const buffer = Buffer.alloc(HEX_PREVIEW_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEX_PREVIEW_BYTES, 0)
    const head = buffer.subarray(0, bytesRead)
    const size = info.size ?? bytesRead
    return {
      base64: head.toString('base64'),
      size,
      truncated: size > bytesRead,
    }
  } finally {
    await handle.close()
  }
}

async function writeFile(
  ctx: Context,
  body: { path?: unknown; content?: unknown; version?: unknown },
): Promise<{ version: string; operation: string }> {
  if (typeof body.path !== 'string' || body.path === '') {
    throw new HttpError(400, 'path is required')
  }
  if (typeof body.content !== 'string') {
    throw new HttpError(400, 'content is required')
  }
  const target = await resolveWithinWorkspace(ctx, body.path)
  const expected: FsWriteIntent | undefined = typeof body.version === 'string' && body.version !== ''
    ? { kind: 'replaceIfVersion', version: body.version }
    : undefined
  // 用户在 UI 手动保存：以完全访问策略写，绕过沙箱对当前会话 workspace 的限制
  //（文件浏览器可编辑任意已注册工作区，而非仅当前会话 cwd）。
  const policyService = ctx.get('sandboxPolicy') as SandboxPolicyServiceLike | undefined
  const sandboxPolicy = policyService !== undefined
    ? policyService.resolve({ mode: 'danger-full-access' })
    : undefined
  const outcome = await ctx.fs.writeText(target, body.content, expected, undefined, sandboxPolicy)
  return { version: outcome.version, operation: outcome.operation }
}

/** ── Dispatch ──────────────────────────────────────────────────────────── */

async function handle(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { error: 'loopback-only' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const rest = url.pathname.slice(ROUTE_PREFIX.length)
  const method = req.method ?? 'GET'
  try {
    if (method === 'GET' && (rest === '' || rest === '/workspaces')) {
      json(res, 200, await listWorkspaces(ctx))
      return
    }
    if (method === 'GET' && rest === '/list') {
      json(res, 200, await listDirectory(ctx, url.searchParams.get('path')))
      return
    }
    if (method === 'GET' && rest === '/read') {
      json(res, 200, await readFile(ctx, url.searchParams.get('path')))
      return
    }
    if (method === 'GET' && rest === '/raw') {
      const { bytes, mime } = await readRaw(ctx, url.searchParams.get('path'))
      const download = url.searchParams.get('download') === '1'
      const name = String(url.searchParams.get('path') ?? '').split(/[\\/]/).pop() ?? 'file'
      res.writeHead(200, {
        'content-type': mime,
        'content-length': String(bytes.length),
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
        ...(download ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } : {}),
      })
      res.end(bytes)
      return
    }
    if (method === 'GET' && rest === '/bin') {
      json(res, 200, await readBinaryPreview(ctx, url.searchParams.get('path')))
      return
    }
    if (method === 'PUT' && rest === '/write') {
      const body = (await readBody(req)) as { path?: unknown; content?: unknown; version?: unknown }
      json(res, 200, await writeFile(ctx, body))
      return
    }
    json(res, 404, { error: `no route for ${method} ${rest}` })
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, { error: error.message })
      return
    }
    if (error instanceof Error && typeof (error as FsErrorLike).code === 'string') {
      json(res, fsErrorStatus(error as FsErrorLike), {
        error: error.message,
        code: (error as FsErrorLike).code,
      })
      return
    }
    json(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

/** 挂载 /api/file-explorer 路由（webui 组合调用）。 */
export function applyFileExplorer(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      void handle(ctx, req, res)
    },
  }), 'webui: file-explorer routes')
}
