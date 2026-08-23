/**
 * webui — 会话产物清单（host 半身）。
 *
 * 动机：官方「产物」行挂在当次会话流的 turn 数据上，服务重启后 turn 数据
 * 不在客户端，产物 chip 随之消失。这里在 host 端独立记账：凡是 agent 通过
 * fs 服务的写入（writeText / editText 等），都记到发起会话名下并落盘，
 * 重启后依然完整，供消息操作栏的「产物」大卡片随时回看。
 *
 * 数据源：`fs/write-intent` 与 `fs/edit-intent` 事件（与 rewind 同款监听，
 * prepend 保证先于 fs-observation-policy 被调用）。bash 重定向等不经 fs
 * 服务的写入记不到——与官方产物行只认 mutation 工具的口径基本一致。
 *
 * 路由：
 *   GET /api/webui-deliverables?sessionId=
 *     → { ok: true, items: [{ path, time }] }（time 倒序）
 *   GET /api/webui-deliverables/content?sessionId=&path=
 *     → { ok: true, content, version }（文本，2MB 上限；FS_NOT_TEXT 时 code 带出）
 *   GET /api/webui-deliverables/bin?sessionId=&path=
 *     → { base64, size, truncated }（头部 4KB，hex 兜底用）
 *   GET /api/webui-deliverables/raw?sessionId=&path=(&download=1)
 *     → 字节流（图片内嵌 / 下载）
 *
 *   内容三路由的授权不按 file-explorer 的「注册工作区包含」校验——产物可能
 *   落在 workspace 外（桌面等）；改按记账白名单：路径必须已记在该会话名下
 *   （即 agent 本会话真实写过的文件），语义更贴合且天然防目录穿越。
 *
 * 存储：`${DSH_HOME}/storages/webui-deliverables/<sessionId>.jsonl`，
 * 一行一条 `{"t":<毫秒>,"p":"<绝对路径>"}`。启动后首次访问某会话时从磁盘
 * 合并加载（同 rewind 的 .written.jsonl 模式）；每会话路径数超限则重写
 * 日志淘汰最旧。
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

const ROUTE_PREFIX = '/api/webui-deliverables'

/** 每会话最多保留的产物路径数（超限淘汰最旧，日志重写收敛）。 */
const MAX_PATHS_PER_SESSION = 400

/** 文本预览上限（与 file-explorer 的 read 一致）。 */
const MAX_READ_BYTES = 2 * 1024 * 1024
/** raw 字节流上限（与 file-explorer 的 raw 一致）。 */
const MAX_RAW_BYTES = 32 * 1024 * 1024
/** hex 兜底预览的头部长度。 */
const HEX_PREVIEW_BYTES = 4 * 1024

/** 插件自身运行时文件不是用户产物：按目录片段与文件名排除。 */
const EXCLUDED_FRAGMENTS = ['/storages/webui-rewind/', '/storages/webui-deliverables/']
const EXCLUDED_NAMES = new Set(['conversation-card.log'])

// ── 最小服务契约（避免 dsh 类型依赖链；与 rewind/file-explorer 同款做法）──

interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServerService {
  register(route: WebServerRoute): () => void
}

/** fs 服务最小读取面（结构对齐 file-explorer 的用法；as 强转使用）。 */
interface FsServiceLike {
  processPath(target: unknown): string
  resolve(path: string): Promise<unknown>
  stat(target: unknown): Promise<{ type: string; size?: number; version?: string } | undefined>
  readText(target: unknown): Promise<string>
  readBytes(target: unknown, start?: unknown, cap?: number): Promise<Uint8Array>
}

/** An fs error carries a stable machine code（同 file-explorer）。 */
interface FsErrorLike {
  code?: unknown
}

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message)
    this.name = 'HttpError'
  }
}

function fsErrorStatus(error: FsErrorLike): number {
  switch (error.code) {
    case 'FS_NOT_FOUND': return 404
    case 'FS_TOO_LARGE': return 413
    case 'FS_NOT_TEXT': return 415
    case 'FS_PERMISSION_DENIED':
    case 'FS_SANDBOX_DENIED': return 403
    default: return 400
  }
}

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

function mimeTypeForPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'application/octet-stream'
  return MIME_BY_EXT[name.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServerService
  }
  interface Events {
    'fs/write-intent'(target: unknown, actor: unknown, next: () => unknown): unknown
    'fs/edit-intent'(target: unknown, actor: unknown, next: () => unknown): unknown
  }
}

// ── Loopback fence（与 file-explorer / rewind 同契约）──────────────────────

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
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(value))
}

// ── 存储 ────────────────────────────────────────────────────────────────────

function deliverablesHome(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'storages', 'webui-deliverables')
}

/** 会话 id 只保留安全字符，防路径拼接意外。 */
function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, '_')
}

function logPath(sessionId: string): string {
  return join(deliverablesHome(), `${sanitizeSessionId(sessionId)}.jsonl`)
}

/** 从 fs 事件的 actor（ToolExecution）提取 agent.session 的 id（同 rewind）。 */
function extractSessionId(actor: unknown): string | undefined {
  const session = (actor as { agent?: { session?: { id?: unknown } } } | undefined)?.agent?.session
  return typeof session?.id === 'string' ? session.id : undefined
}

const ensuredDirs = new Set<string>()
function ensureDirSync(dir: string): void {
  if (ensuredDirs.has(dir)) return
  try { mkdirSync(dir, { recursive: true }) } catch { /* 失败留给追加的 try/catch */ }
  ensuredDirs.add(dir)
}

/** sessionId → 绝对路径 → 最近一次写入时刻（内存聚合，懒加载合并磁盘）。 */
const sessionItems = new Map<string, Map<string, number>>()
const loadedSessions = new Set<string>()

function loadSession(sessionId: string): Map<string, number> {
  let map = sessionItems.get(sessionId)
  if (map !== undefined) return map
  map = new Map()
  try {
    const raw = readFileSync(logPath(sessionId), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        const rec = JSON.parse(trimmed) as { t?: unknown; p?: unknown }
        if (typeof rec.p === 'string' && typeof rec.t === 'number' && isAbsolute(rec.p)) {
          map.set(rec.p, Math.max(map.get(rec.p) ?? Number.NEGATIVE_INFINITY, rec.t))
        }
      } catch { /* 跳过坏行 */ }
    }
  } catch { /* 无历史记录：全新开始 */ }
  sessionItems.set(sessionId, map)
  loadedSessions.add(sessionId)
  return map
}

function isExcludedPath(absPath: string): boolean {
  const norm = absPath.split(sep).join('/')
  if (EXCLUDED_FRAGMENTS.some(fragment => norm.includes(fragment))) return true
  const name = norm.slice(norm.lastIndexOf('/') + 1)
  return EXCLUDED_NAMES.has(name)
}

function rewriteLog(sessionId: string, map: Map<string, number>): void {
  const file = logPath(sessionId)
  const lines = [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, t]) => JSON.stringify({ t, p }))
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, `${lines.join('\n')}\n`, 'utf8')
    renameSync(tmp, file)
  } catch {
    try { writeFileSync(file, `${lines.join('\n')}\n`, 'utf8') } catch { /* 忽略 */ }
  }
}

function recordWrite(absPath: unknown, sessionId: string | undefined): void {
  if (sessionId === undefined || sessionId === '') return
  if (typeof absPath !== 'string' || !isAbsolute(absPath)) return
  if (isExcludedPath(absPath)) return
  const map = loadSession(sessionId)
  // 同一进程内同一文件的重复写入不刷时间戳（写盘去噪）；跨进程重启后由
  // Math.max 合并，天然幂等。
  if ((map.get(absPath) ?? Number.NEGATIVE_INFINITY) >= Date.now()) return
  const now = Date.now()
  map.set(absPath, now)
  try {
    ensureDirSync(dirname(logPath(sessionId)))
    appendFileSync(logPath(sessionId), `${JSON.stringify({ t: now, p: absPath })}\n`, 'utf8')
  } catch { /* 记录丢失不影响主流程 */ }
  if (map.size > MAX_PATHS_PER_SESSION) {
    const oldest = [...map.entries()].sort((a, b) => a[1] - b[1])[0]
    if (oldest !== undefined) {
      map.delete(oldest[0])
      rewriteLog(sessionId, map)
    }
  }
}

// ── 查询 ────────────────────────────────────────────────────────────────────

interface DeliverableItemWire {
  path: string
  time: number
}

function listItems(sessionId: string): DeliverableItemWire[] {
  const map = loadSession(sessionId)
  return [...map.entries()]
    .map(([path, time]) => ({ path, time }))
    .sort((a, b) => b.time - a.time)
}

/** ── 内容读取（记账白名单授权）────────────────────────────────────────── */

/** 解析并校验：路径必须已记在该会话名下（agent 本会话真实写过）。 */
async function resolveRecorded(ctx: Context, sessionId: string, rawPath: unknown): Promise<unknown> {
  if (typeof rawPath !== 'string' || rawPath === '') {
    throw new HttpError(400, 'path is required')
  }
  const map = loadSession(sessionId)
  // 清单接口原样返回记账字符串，客户端回传同一形态 → 精确匹配即可。
  if (!map.has(rawPath)) {
    throw new HttpError(403, 'path is not recorded for this session')
  }
  const fs = ctx.get('fs') as FsServiceLike | undefined
  if (fs === undefined) throw new HttpError(500, 'fs service unavailable')
  try {
    return await fs.resolve(rawPath)
  } catch {
    throw new HttpError(404, 'path does not exist')
  }
}

async function readContent(ctx: Context, sessionId: string, rawPath: unknown): Promise<{ content: string; version: string }> {
  const target = await resolveRecorded(ctx, sessionId, rawPath)
  const fs = ctx.get('fs') as FsServiceLike
  const info = await fs.stat(target)
  if (info === undefined) throw new HttpError(404, 'file does not exist')
  if (info.type !== 'file') throw new HttpError(400, 'path is not a file')
  if (info.size !== undefined && info.size > MAX_READ_BYTES) {
    throw new HttpError(413, 'file is too large to preview', 'FS_TOO_LARGE')
  }
  return { content: await fs.readText(target), version: info.version ?? '' }
}

async function readBin(ctx: Context, sessionId: string, rawPath: unknown): Promise<{ base64: string; size: number; truncated: boolean }> {
  const target = await resolveRecorded(ctx, sessionId, rawPath)
  const fs = ctx.get('fs') as FsServiceLike
  const info = await fs.stat(target)
  if (info === undefined) throw new HttpError(404, 'file does not exist')
  if (info.type !== 'file') throw new HttpError(400, 'path is not a file')
  const handle = await open(fs.processPath(target), 'r')
  try {
    const buffer = Buffer.alloc(HEX_PREVIEW_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEX_PREVIEW_BYTES, 0)
    const head = buffer.subarray(0, bytesRead)
    const size = info.size ?? bytesRead
    return { base64: head.toString('base64'), size, truncated: size > bytesRead }
  } finally {
    await handle.close()
  }
}

async function readRaw(ctx: Context, sessionId: string, rawPath: unknown): Promise<{ bytes: Buffer; mime: string; name: string }> {
  const target = await resolveRecorded(ctx, sessionId, rawPath)
  const fs = ctx.get('fs') as FsServiceLike
  const info = await fs.stat(target)
  if (info === undefined) throw new HttpError(404, 'file does not exist')
  if (info.type !== 'file') throw new HttpError(400, 'path is not a file')
  if (info.size !== undefined && info.size > MAX_RAW_BYTES) {
    throw new HttpError(413, 'file is too large to serve')
  }
  const bytes = Buffer.from(await fs.readBytes(target, undefined, MAX_RAW_BYTES))
  const display = fs.processPath(target)
  return { bytes, mime: mimeTypeForPath(display), name: display.split(/[\\/]/).pop() ?? 'file' }
}

async function handle(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!loopbackAllowed(req)) {
      json(res, 403, { ok: false, error: 'loopback only' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method !== 'GET' || !url.pathname.startsWith(ROUTE_PREFIX)) {
      json(res, 404, { ok: false, error: `no route for ${req.method ?? 'GET'} ${url.pathname}` })
      return
    }
    const rest = url.pathname.slice(ROUTE_PREFIX.length)
    if (rest === '' || rest === '/') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (sessionId === '') {
        json(res, 400, { ok: false, error: 'sessionId is required' })
        return
      }
      json(res, 200, { ok: true, items: listItems(sessionId) })
      return
    }
    if (rest === '/content' || rest === '/bin' || rest === '/raw') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const path = url.searchParams.get('path')
      if (sessionId === '') {
        json(res, 400, { ok: false, error: 'sessionId is required' })
        return
      }
      if (rest === '/content') {
        json(res, 200, { ok: true, ...(await readContent(ctx, sessionId, path)) })
        return
      }
      if (rest === '/bin') {
        json(res, 200, await readBin(ctx, sessionId, path))
        return
      }
      const { bytes, mime, name } = await readRaw(ctx, sessionId, path)
      const download = url.searchParams.get('download') === '1'
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
    json(res, 404, { ok: false, error: `no route for GET ${rest}` })
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, { ok: false, error: error.message, code: error.code })
      return
    }
    if (error instanceof Error && typeof (error as FsErrorLike).code === 'string') {
      json(res, fsErrorStatus(error as FsErrorLike), { ok: false, error: error.message, code: (error as FsErrorLike).code })
      return
    }
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

// ── 插件体 ──────────────────────────────────────────────────────────────────

/**
 * 挂载 fs 写入记账（write-intent / edit-intent 监听）与查询路由。
 * 记账同步完成、失败静默——绝不能影响 agent 写文件的主流程。
 */
export function applyDeliverables(ctx: Context): void {
  const recordFsWrite = (target: unknown, actor: unknown): void => {
    try {
      const fs = ctx.get('fs') as { processPath(t: unknown): string } | undefined
      if (fs === undefined) return
      recordWrite(fs.processPath(target), extractSessionId(actor))
    } catch { /* 拿不到路径就放弃这条记录 */ }
  }
  // prepend：确保在 fs-observation-policy（single-slot 决定者）之前被调用，
  // 这样 next() 才能继续传递到它，记录动作不被它的返回 intent 短路。
  ctx.on('fs/write-intent', ((target: unknown, actor: unknown, next: () => unknown) => {
    recordFsWrite(target, actor)
    return next()
  }) as never, { prepend: true })
  ctx.on('fs/edit-intent', ((target: unknown, actor: unknown, next: () => unknown) => {
    recordFsWrite(target, actor)
    return next()
  }) as never, { prepend: true })

  const webServer = ctx.get('webServer') as WebServerService | undefined
  if (webServer === undefined) return
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => { void handle(ctx, req, res).catch(() => { /* 已在 handle 内兜底 */ }) },
  }), 'webui: deliverables routes')
}
