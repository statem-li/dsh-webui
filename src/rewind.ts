/**
 * webui — 对话「退回」能力（host 半身）。
 *
 * 目标：给用户消息增加「退回」按钮，点击后把这条消息的上下文消除（fork 到
 * 该消息之前的已完成 turn 边界），并把这条消息之后 agent 修改的文件回退到
 * 消息发送前的状态。两条腿必须一致：只有文件回退成功后才 fork 切上下文。
 *
 * host 半身只负责「文件快照 / 回退」这一条腿，配合 client 半身（rewind.tsx）
 * 完成闭环：
 *   1. 监听 `session/event`，在每条 human user/message（source.kind === 'user'）
 *      落盘时，对 session 的 cwd（工作区根）做一次同步文件快照。
 *   2. 快照存到 `${DSH_HOME}/storages/webui-rewind/<sessionId>/<seq>.json`。
 *   3. 提供 loopback HTTP 路由 `/api/webui-rewind/*`：
 *        - GET  /check?sessionId=&seq=   → 快照是否可用
 *        - POST /restore {sessionId, seq} → 恢复到该快照
 *
 * 快照策略：同步遍历 + 同步读文本文件（排除 node_modules/.git/构建产物等
 * 大目录，单文件超 1MB 跳过内容，总文件数超上限放弃），保证「user/message
 * 落盘时刻」的文件状态被准确捕获——这是回退语义的正确锚点。
 */
import { readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import {
  mkdir, readFile, readdir, rename, rm, rmdir, writeFile,
} from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

// ── 常量 ────────────────────────────────────────────────────────────────────

const ROUTE_PREFIX = '/api/webui-rewind'

/** 单文件快照内容上限（超过则只记录存在性，不记录内容）。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024
/** 单次快照累计内容上限（超过则剩余文件只记录存在性）。 */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
/** 单次快照文件数上限（超过则放弃快照，避免阻塞 agent）。 */
const MAX_FILES = 50000

/** 每个会话保留的最近快照数（滚动清理：写入新快照后删掉更早的）。 */
const MAX_SNAPSHOTS_PER_SESSION = 20

/** 快照遍历时精确排除的目录名（node_modules / VCS / 构建产物 / 缓存）。 */
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.dsh', '.svn', '.hg',
  'out', '.next', '.nuxt', '.output', '.turbo',
  'target', '.venv', 'venv', '__pycache__', '.cache', '.parcel-cache',
  'coverage', '.idea', '.vscode', 'lib',
])

/** 快照遍历时按前缀排除的目录名（构建产物 / 临时目录：dist、dist2、_tmp*、.tmp*、_kr-*）。 */
const EXCLUDED_DIR_PREFIXES = ['dist', 'build', '_tmp', '.tmp', '_kr-']

/**
 * 全局记录 fs 服务（writeText/editText）写过的文件绝对路径。用于快照扩展：
 * agent 修改的工作区外文件（如桌面）也要纳入快照、随退回一起回退。
 * 写入由 `fs/write-intent` / `fs/edit-intent` 监听器维护。
 */
const fsWrittenPaths = new Set<string>()

/** 快照目录根。 */
function rewindHome(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'storages', 'webui-rewind')
}

// ── 最小服务契约（避免 dsh-session 类型依赖链；与 file-explorer 同款做法）──

interface SessionLike {
  id: string
  header?: { cwd?: string }
}

interface SessionEventLike {
  type: string
  seq: number
  data?: { source?: { kind?: string } }
}

interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServerService {
  register(route: WebServerRoute): () => void
}

/** 最小 sessions 服务面（lineage 查找用）。 */
interface SessionStoreLike {
  get(id: string): { header?: { parentSession?: string } } | undefined
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

// ── 快照数据结构 ────────────────────────────────────────────────────────────

export interface SnapshotFile {
  /** 原字节长度（用于展示/校验）。 */
  size: number
  /** base64 内容；null 表示「过大跳过内容」，仅记录存在性。 */
  content: string | null
}

export interface RewindSnapshot {
  version: 1
  sessionId: string
  seq: number
  cwd: string
  createdAt: number
  fileCount: number
  files: Record<string, SnapshotFile>
}

/** 快照落盘路径。 */
function snapshotPath(sessionId: string, seq: number): string {
  return join(rewindHome(), encodeURIComponent(sessionId), `${seq}.json`)
}

/** 某个会话的快照目录。 */
function snapshotDir(sessionId: string): string {
  return join(rewindHome(), encodeURIComponent(sessionId))
}

/**
 * 相对路径清洗：把绝对路径转为相对 cwd 的 `/` 分隔相对路径；越界（..、
 * 绝对、不在 cwd 内）返回 null。
 */
export function safeRelative(cwd: string, absPath: string): string | null {
  const rel = relative(cwd, absPath)
  if (rel === '' || isAbsolute(rel) || rel.startsWith('..')) return null
  const normalized = normalize(rel)
  if (normalized === '' || isAbsolute(normalized) || normalized.startsWith('..') || normalized.includes(`..${sep}`)) {
    return null
  }
  return normalized.split(sep).join('/')
}

/** 某目录名是否应被排除（精确 + 前缀）。 */
function isExcludedDir(name: string): boolean {
  if (EXCLUDED_DIRS.has(name)) return true
  return EXCLUDED_DIR_PREFIXES.some(prefix => name.startsWith(prefix))
}

/**
 * 判断内容是否二进制：采样前 8KB 是否含 NUL 字节。
 * 文本文件几乎不含 NUL；二进制（图片/音频/压缩包等）命中即跳过内容，
 * 只记录存在性——回退时保留现状，不再 base64 膨胀快照。
 */
function isBinaryContent(buf: Buffer): boolean {
  const sample = buf.length > 8192 ? buf.subarray(0, 8192) : buf
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true
  }
  return false
}

// ── 同步快照（在 session/event 回调内同步完成，保证锚点准确）───────────────

/**
 * 同步递归遍历并读取文件内容。返回 null 表示放弃快照（过大）。
 * 用 node:fs 同步 API：这个函数跑在 user/message 事件回调里，必须赶在
 * agent 下一次 tool 调用修改文件之前拿到准确快照。
 */
export function captureSnapshotSync(cwd: string, extraPaths?: Iterable<string>): { files: Record<string, SnapshotFile> } | null {
  const files: Record<string, SnapshotFile> = {}
  let fileCount = 0
  let totalBytes = 0
  let stopped = false

  const addFile = (abs: string, key: string): void => {
    let size = 0
    try {
      size = statSync(abs).size
    } catch {
      return
    }
    if (size > MAX_FILE_BYTES || totalBytes >= MAX_TOTAL_BYTES) {
      files[key] = { size, content: null }
      return
    }
    try {
      const buf = readFileSync(abs)
      if (isBinaryContent(buf)) {
        // 二进制：只记录存在性，回退时保留现状（不回退、不删除）。
        files[key] = { size: buf.length, content: null }
      } else {
        files[key] = { size: buf.length, content: buf.toString('base64') }
        totalBytes += buf.length
      }
    } catch {
      files[key] = { size, content: null }
    }
  }

  const walk = (dir: string): void => {
    if (stopped) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // 读不了就跳过该目录，不中断整体快照
    }
    for (const entry of entries) {
      if (stopped) return
      if (entry.isSymbolicLink()) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!isExcludedDir(entry.name)) walk(abs)
        continue
      }
      if (!entry.isFile()) continue
      const rel = safeRelative(cwd, abs)
      if (rel === null) continue
      fileCount += 1
      if (fileCount > MAX_FILES) {
        stopped = true
        return
      }
      addFile(abs, rel)
    }
  }

  walk(cwd)
  if (stopped) return null

  // 额外文件（工作区外，如 agent 写过的桌面文件）：用绝对路径作 key 纳入快照。
  if (extraPaths !== undefined) {
    for (const raw of extraPaths) {
      const abs = normalize(raw)
      if (!isAbsolute(abs)) continue
      if (safeRelative(cwd, abs) !== null) continue // 工作区内已由 walk 覆盖
      const key = abs.split(sep).join('/')
      if (files[key] !== undefined) continue
      fileCount += 1
      if (fileCount > MAX_FILES) {
        stopped = true
        break
      }
      addFile(abs, key)
    }
  }
  if (stopped) return null
  return { files }
}

/** 把快照原子写盘（tmp + rename）；异步，失败只告警不影响 agent。 */
async function persistSnapshot(snapshot: RewindSnapshot): Promise<void> {
  const file = snapshotPath(snapshot.sessionId, snapshot.seq)
  const tmp = `${file}.tmp`
  await mkdir(dirname(file), { recursive: true })
  await writeFile(tmp, `${JSON.stringify(snapshot)}\n`, 'utf8')
  await rename(tmp, file)
  // 滚动清理：只保留该会话最近 MAX_SNAPSHOTS_PER_SESSION 条快照。
  await pruneOldSnapshots(snapshot.sessionId)
}

/** 列出某会话目录下所有快照的 seq（升序）。 */
async function listSnapshotSeqs(sessionId: string): Promise<number[]> {
  const dir = snapshotDir(sessionId)
  let entries
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const seqs: number[] = []
  for (const name of entries) {
    if (!/^\d+\.json$/.test(name)) continue
    const seq = Number(name.slice(0, -5))
    if (Number.isSafeInteger(seq) && seq >= 0) seqs.push(seq)
  }
  seqs.sort((a, b) => a - b)
  return seqs
}

/** 滚动清理：删除该会话第 MAX_SNAPSHOTS_PER_SESSION+1 条及更早的快照。 */
async function pruneOldSnapshots(sessionId: string): Promise<void> {
  const seqs = await listSnapshotSeqs(sessionId)
  const excess = seqs.length - MAX_SNAPSHOTS_PER_SESSION
  if (excess <= 0) return
  for (const seq of seqs.slice(0, excess)) {
    try { await rm(snapshotPath(sessionId, seq), { force: true }) } catch { /* 忽略 */ }
  }
}

/** 退回后清理：删除该会话 seq >= fromSeq 的快照（这些消息已被消除）。 */
async function pruneFromSeq(sessionId: string, fromSeq: number): Promise<void> {
  const seqs = await listSnapshotSeqs(sessionId)
  for (const seq of seqs) {
    if (seq < fromSeq) continue
    try { await rm(snapshotPath(sessionId, seq), { force: true }) } catch { /* 忽略 */ }
  }
}

// ── 恢复 ────────────────────────────────────────────────────────────────────

async function readSnapshot(sessionId: string, seq: number): Promise<RewindSnapshot | null> {
  const file = snapshotPath(sessionId, seq)
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as RewindSnapshot
    if (parsed.version !== 1 || typeof parsed.cwd !== 'string' || typeof parsed.files !== 'object' || parsed.files === null) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * 沿 session lineage 查找快照：fork 出的 child 里，seed 消息（继承自 parent）
 * 的快照仍存在 parent 目录下，退回 seed 消息时需要回退到 parent 的快照。
 * 先查当前 sessionId，未命中再沿 parentSession 逐级向上查。
 */
async function findSnapshot(ctx: Context, sessionId: string, seq: number): Promise<RewindSnapshot | null> {
  let snapshot = await readSnapshot(sessionId, seq)
  if (snapshot !== null) return snapshot
  const sessions = ctx.get('sessions') as SessionStoreLike | undefined
  if (sessions === undefined) return null
  const visited = new Set<string>([sessionId])
  let current = sessions.get(sessionId)
  while (current !== undefined) {
    const parent = current.header?.parentSession
    if (parent === undefined || visited.has(parent)) break
    visited.add(parent)
    snapshot = await readSnapshot(parent, seq)
    if (snapshot !== null) return snapshot
    current = sessions.get(parent)
  }
  return null
}

/**
 * 把工作区恢复到快照状态：
 *   1. 先覆盖写回快照里记录的文件内容（content 非 null 的）——这是核心目标
 *      「修改的文件回退」。
 *   2. 再删除快照里不存在的当前文件（「新增的文件清理」）——次要，失败不影响
 *      主目标，且整体幂等可重试。
 */
export async function restoreSnapshot(snapshot: RewindSnapshot, extraPaths?: Iterable<string>): Promise<{ restored: number; deleted: number; skippedLarge: number }> {
  const cwd = resolve(snapshot.cwd)
  let restored = 0
  let skippedLarge = 0
  let deleted = 0

  // 1) 覆盖写回记录内容。
  for (const [key, entry] of Object.entries(snapshot.files)) {
    if (entry.content === null) {
      skippedLarge += 1
      continue
    }
    // key 为绝对路径（工作区外文件，如桌面）时按绝对路径恢复；否则相对 cwd。
    if (isAbsolute(key)) {
      const abs = normalize(key)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, Buffer.from(entry.content, 'base64'))
      restored += 1
      continue
    }
    const abs = resolve(cwd, key)
    if (safeRelative(cwd, abs) === null) continue
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, Buffer.from(entry.content, 'base64'))
    restored += 1
  }

  // 2) 删除快照后新增的文件（遍历当前目录，不在快照里的删掉）。
  const snapshotKeys = new Set(Object.keys(snapshot.files))
  const walkAndDelete = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (isExcludedDir(entry.name)) continue
        await walkAndDelete(abs)
        const rel = safeRelative(cwd, abs)
        if (rel !== null && !snapshotKeys.has(rel)) {
          // rmdir 只删空目录：新增目录里若有保留文件则留下，空目录一并清理。
          try { await rmdir(abs) } catch { /* 非空则保留 */ }
        }
        continue
      }
      if (!entry.isFile()) continue
      const rel = safeRelative(cwd, abs)
      if (rel === null) continue
      if (!snapshotKeys.has(rel)) {
        try { await rm(abs, { force: true }) } catch { /* 删不掉不阻塞 */ }
        deleted += 1
      }
    }
  }
  await walkAndDelete(cwd)

  // 3) 删除工作区外「快照后新增」的文件：extraPaths 里、不在快照里、当前仍存在的删掉。
  if (extraPaths !== undefined) {
    for (const raw of extraPaths) {
      const abs = normalize(raw)
      if (!isAbsolute(abs)) continue
      if (safeRelative(cwd, abs) !== null) continue // 工作区内已由 walkAndDelete 处理
      const key = abs.split(sep).join('/')
      if (snapshotKeys.has(key)) continue // 快照里有，已在第 1 步写回
      try {
        await rm(abs, { force: true })
        deleted += 1
      } catch { /* 删不掉不阻塞 */ }
    }
  }

  return { restored, deleted, skippedLarge }
}

// ── HTTP 管线 ───────────────────────────────────────────────────────────────

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

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('request body too large'))
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
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} 不能为空`)
  return value.trim()
}

async function handle(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  let url: URL
  let rest: string
  let method: string
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
    rest = url.pathname.slice(ROUTE_PREFIX.length)
    method = req.method ?? 'GET'
  } catch {
    json(res, 400, { ok: false, error: 'invalid request url' })
    return
  }
  try {
    if (method === 'GET' && rest === '/check') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const seq = Number(url.searchParams.get('seq') ?? '')
      if (sessionId === '' || !Number.isSafeInteger(seq) || seq < 0) {
        json(res, 400, { ok: false, error: 'invalid sessionId/seq' })
        return
      }
      const snapshot = await findSnapshot(ctx, sessionId, seq)
      json(res, 200, snapshot === null
        ? { ok: true, available: false }
        : { ok: true, available: true, fileCount: snapshot.fileCount, createdAt: snapshot.createdAt, cwd: snapshot.cwd })
      return
    }
    if (method === 'POST' && rest === '/restore') {
      const body = await readBody(req)
      const sessionId = requireString(body.sessionId, 'sessionId')
      const seqRaw = body.seq
      if (typeof seqRaw !== 'number' || !Number.isSafeInteger(seqRaw) || seqRaw < 0) {
        json(res, 400, { ok: false, error: 'seq 必须是非负整数' })
        return
      }
      const snapshot = await findSnapshot(ctx, sessionId, seqRaw)
      if (snapshot === null) {
        json(res, 404, { ok: false, error: `未找到快照：session=${sessionId} seq=${seqRaw}` })
        return
      }
      try {
        const result = await restoreSnapshot(snapshot, fsWrittenPaths)
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    json(res, 404, { ok: false, error: `no route for ${method} ${rest}` })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

// ── 插件体 ──────────────────────────────────────────────────────────────────

/**
 * 挂载文件快照（session/event 监听）与 /api/webui-rewind 路由。
 * 注意：session/event 是 fire-and-forget feed；快照同步完成以保证锚点准确，
 * 写盘异步执行，失败只告警不阻塞 agent。
 */
export function applyRewind(ctx: Context): void {
  // ── 记录 fs 服务写过的文件（含工作区外），让这些文件也纳入快照/回退 ──
  const recordFsWrite = (target: unknown): void => {
    try {
      const fs = ctx.get('fs') as { processPath(t: unknown): string } | undefined
      if (fs === undefined) return
      const absPath = fs.processPath(target)
      if (typeof absPath === 'string' && isAbsolute(absPath)) fsWrittenPaths.add(absPath)
    } catch { /* 忽略：拿不到路径就不扩展快照 */ }
  }
  // prepend：确保在 fs-observation-policy（single-slot 决定者）之前被调用，
  // 这样 next() 才能继续传递到它，记录动作不被它的返回 intent 短路。
  ctx.on('fs/write-intent', ((target: unknown, _actor: unknown, next: () => unknown) => {
    recordFsWrite(target)
    return next()
  }) as never, { prepend: true })
  ctx.on('fs/edit-intent', ((target: unknown, _actor: unknown, next: () => unknown) => {
    recordFsWrite(target)
    return next()
  }) as never, { prepend: true })

  ctx.on('session/event', ((session: SessionLike, event: SessionEventLike) => {
    if (event.type !== 'user/message') return
    if (event.data?.source?.kind !== 'user') return
    const cwd = session.header?.cwd
    if (cwd === undefined || cwd === '') return
    const seq = event.seq
    if (!Number.isSafeInteger(seq) || seq < 0) return

    // 同步捕获（必须赶在 agent 下次 tool 修改文件之前完成）。
    let captured: { files: Record<string, SnapshotFile> } | null = null
    try {
      captured = captureSnapshotSync(resolve(cwd), fsWrittenPaths)
    } catch (error) {
      ctx.logger?.warn?.(`[webui-rewind] snapshot failed for ${session.id}#${seq}: ${String(error)}`)
      return
    }
    if (captured === null) {
      ctx.logger?.warn?.(`[webui-rewind] snapshot skipped (too large) for ${session.id}#${seq}`)
      return
    }
    const snapshot: RewindSnapshot = {
      version: 1,
      sessionId: session.id,
      seq,
      cwd: resolve(cwd),
      createdAt: Date.now(),
      fileCount: Object.keys(captured.files).length,
      files: captured.files,
    }
    void persistSnapshot(snapshot).catch((error: unknown) => {
      ctx.logger?.warn?.(`[webui-rewind] persist failed for ${session.id}#${seq}: ${String(error)}`)
    })
  }) as never, { global: true })

  const webServer = ctx.get('webServer') as WebServerService | undefined
  if (webServer === undefined) return
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => { void handle(ctx, req, res) },
  }), 'webui: rewind routes')
}
