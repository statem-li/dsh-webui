/**
 * webui — 对话「退回」能力（host 半身）。v2：git 式内容寻址存储。
 *
 * 目标：给用户消息增加「退回」按钮，点击后把这条消息的上下文消除（fork 到
 * 该消息之前的已完成 turn 边界），并把这条消息之后 agent 修改的文件回退到
 * 消息发送前的状态。两条腿必须一致：只有文件回退成功后才 fork 切上下文。
 *
 * host 半身只负责「文件快照 / 回退」这一条腿，配合 client 半身（rewind.tsx）
 * 完成闭环：
 *   1. 监听 `session/event`，在每条 human user/message（source.kind === 'user'）
 *      落盘时，对 session 的 cwd（工作区根）做一次同步文件快照。
 *   2. 文件内容按 SHA-1 存入全局 blob 库（gzip 原文），快照本身只落一份
 *      「路径 → 指纹」纯索引 JSON。同一份内容无论跨快照还是跨会话都只存
 *      一次——相邻快照间 95% 以上的文件不变，体积从「每条消息 × 全工作区
 *      base64」降两个数量级。
 *   3. 提供 loopback HTTP 路由 `/api/webui-rewind/*`：
 *        - GET  /check?sessionId=&seq=   → 快照是否可用
 *        - GET  /diff?sessionId=&seq=    → 当前工作区相对快照的差异（是否修改文件）
 *        - GET  /history?sessionId=&path= → 单文件修改历史时间线（走 meta 索引）
 *        - GET  /at?sessionId=&path=&seq= → 读取某快照时点的文件内容
 *        - GET  /compare…                → 双栏对齐对比
 *        - POST /restore {sessionId, seq} → 恢复到该快照
 *
 * 存储布局（`${DSH_HOME}/storages/webui-rewind/`）：
 *   blobs/<h[0..1]>/<sha1hex40>       gzip(文件原文)，内容寻址、全局唯一
 *   <sessionId>/<seq>.json            v2 快照：纯索引（不含内容）
 *   <sessionId>/<seq>.meta.json       更轻的历史索引（不含内容，供 /history）
 *
 * 快照策略：同步遍历 + 同步读文本文件并计算 SHA-1（排除 node_modules/.git/
 * 构建产物等大目录，单文件超 2MB 或二进制只记录存在性，总字节数超上限放弃），
 * 保证「user/message 落盘时刻」的文件状态被准确捕获——这是回退语义的正确锚点。
 * 进程内维护 path → {mtime,size,hash} 缓存：未变化的文件免重复读取。
 *
 * 生命周期：单会话滚动保留最近 50 条；全局预算 2GB（快照索引 + blob 库合计，
 * 超限从最老快照淘汰）；快照最长保留 30 天；blob GC 只删除无任何存活快照引用
 * 且超过 1 小时未被写入的对象（1 小时窗口规避「blob 已写、索引未落盘」竞态）。
 */
import { createHash } from 'node:crypto'
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync,
  type Dirent,
} from 'node:fs'
import {
  mkdir, open, readFile, readdir, rename, rm, rmdir, stat, writeFile,
  type FileHandle,
} from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { gzipSync, gunzipSync } from 'node:zlib'
import { alignTextDiff } from './rewind-diff.js'

// ── 常量 ────────────────────────────────────────────────────────────────────

const ROUTE_PREFIX = '/api/webui-rewind'

/** 单文件快照内容上限（超过则只记录存在性，不入库）。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024
/** 单次快照累计文本上限（超过则剩余文件只记录存在性）。 */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
/** 单次快照文件数上限（超过则放弃快照，避免阻塞 agent）。 */
const MAX_FILES = 50000

/** 每个会话保留的最近快照数（滚动清理：写入新快照后删掉更早的）。 */
const MAX_SNAPSHOTS_PER_SESSION = 50
/** 快照最长保留时长（全局维护时淘汰更早的）。 */
const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** 全局存储预算（快照索引 + blob 库合计）；超限从最老快照淘汰至此比例。 */
const GLOBAL_BUDGET_BYTES = 2 * 1024 * 1024 * 1024
const GLOBAL_BUDGET_HIGH = 1.0
const GLOBAL_BUDGET_LOW = 0.6
/** 全局维护的最小间隔（节流，避免每条消息都全量扫描）。 */
const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000
/** blob 写入后多久才允许被 GC 视为孤儿（规避「已写 blob、索引未落盘」竞态）。 */
const BLOB_ORPHAN_GRACE_MS = 60 * 60 * 1000

/** 快照遍历时精确排除的目录名（node_modules / VCS / 构建产物 / 缓存）。 */
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.dsh', '.svn', '.hg',
  'out', '.next', '.nuxt', '.output', '.turbo',
  'target', '.venv', 'venv', '__pycache__', '.cache', '.parcel-cache',
  'coverage', '.idea', '.vscode', 'blobs',
])

/** 快照遍历时按前缀排除的目录名（构建产物 / 临时目录：dist、dist2、.tmp* 等）。 */
const EXCLUDED_DIR_PREFIXES = ['dist', 'build', '.tmp']

/**
 * 快照/回退一律忽略的文件名：插件自身的运行时产物（如对话完成卡片日志，
 * 每轮对话都会追加），不是用户工作区内容——列进退回清单只会让人困惑，
 * 回退它们也没有意义。
 */
const EXCLUDED_FILES = new Set(['conversation-card.log'])

function isExcludedFile(name: string): boolean {
  return EXCLUDED_FILES.has(name)
}

/**
 * 全局记录 fs 服务（writeText/editText）写过的文件绝对路径。用于快照扩展：
 * agent 修改的工作区外文件（如桌面）也要纳入快照、随退回一起回退。
 * 写入由 `fs/write-intent` / `fs/edit-intent` 监听器维护。
 */
const fsWrittenPaths = new Set<string>()

/**
 * 按会话记录 fs 服务写过的文件（sessionId → 绝对路径集合）。退回只处理
 * 「本会话写过的文件」，避免把其他会话 / 人工 / 后台任务改过的文件误判成
 * 本会话的修改（例如在别的会话里改了插件源码，退回「你是谁」不应回退它们）。
 *
 * 该记录必须跨服务重启存活：对话中途手动停止或服务中断后重启，进程内存
 * 清空，若只靠内存记录，diff 会误判「无修改」不弹确认框、restore 会什么都不
 * 恢复。因此每条写入同步追加到 `<快照目录>/.written.jsonl`（JSONL，一行一个
 * 路径），首次访问某会话时从磁盘合并加载。
 */
const sessionWrittenPaths = new Map<string, Set<string>>()
/** 按会话记录 fs 服务写过的文件最后时刻（sessionId → 绝对路径 → 毫秒时间戳）。 */
const sessionWrittenTimes = new Map<string, Map<string, number>>()
/** 已从磁盘加载过写入日志的会话（避免重复读文件）。 */
const writtenLogLoaded = new Set<string>()

/** 空写入集合：无会话写入记录时退回「什么都不处理」，避免退化为全量误伤。 */
const EMPTY_WRITTEN_PATHS: ReadonlySet<string> = new Set()

/**
 * 进程内指纹缓存：绝对路径 → 最近一次读取时的 mtime/size/hash。
 * 未变化的文件在下一次快照时免读免算（纳秒 mtime 与 size 均未变即视为未变，
 * 纳秒精度规避同毫秒内连续写入的误判）；GC 实际删除 blob 后整体清空。
 */
interface HashCacheEntry { mtimeNs: bigint; size: number; hash: string }
const hashCache = new Map<string, HashCacheEntry>()

/**
 * 把请求的文件路径映射为快照 files 的 key：优先按快照 cwd 解析为相对路径；
 * 工作区外文件（agent 写过的桌面文件等）在快照里以正斜杠绝对路径作 key。
 * 返回 null 表示无法表示（非法路径）。
 */
function resolveSnapshotKey(cwd: string, rawPath: string): string | null {
  const base = resolve(cwd)
  const abs = resolve(base, rawPath)
  const rel = safeRelative(base, abs)
  if (rel !== null) return rel
  const normalized = normalize(abs).split(sep).join('/')
  return isAbsolute(normalized) ? normalized : null
}

/** 单个文件对比读取的体积上限（与快照单文件上限一致）。 */
const MAX_COMPARE_BYTES = 2 * 1024 * 1024

/** 从 fs 事件的 actor（ToolExecution）提取 agent.session 的 id。 */
function extractSessionId(actor: unknown): string | undefined {
  const session = (actor as { agent?: { session?: { id?: unknown } } } | undefined)?.agent?.session
  return typeof session?.id === 'string' ? session.id : undefined
}

/** 快照目录根。 */
export function rewindHome(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'storages', 'webui-rewind')
}

/** blob 库根。 */
export function blobHome(): string {
  return join(rewindHome(), 'blobs')
}

/** blob 落盘路径：<blobHome>/<hash 前 2 位>/<完整 sha1>。 */
function blobPath(hash: string): string {
  return join(blobHome(), hash.slice(0, 2), hash)
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

/**
 * 捕获阶段的单文件结果：
 *  - hash 存在 → 文本文件，内容将以 blob 形式入库（buffers 提供新读到的原文）；
 *  - flag 'large' / 'binary' → 只记录存在性（过大 / 二进制），回退与差异均跳过；
 *  - 两者皆无 → 读取失败，同样只记录存在性。
 */
export interface CapturedFile {
  size: number
  /** 完整 sha1 hex（40 位），指向 blob 库。 */
  hash?: string
  flag?: 'binary' | 'large'
}

export interface CaptureResult {
  files: Record<string, CapturedFile>
  /** 本次真正读到内容的文件（hash → 原文）；缓存命中的文件不在其中。 */
  buffers: Map<string, Buffer>
  /** 本次快照额外覆盖的工作区外目录（桌面等），随快照持久化供 diff/restore 复用。 */
  extDirs?: string[]
  /**
   * 捕获开始时刻（消息落盘的语义锚点）。快照的 createdAt 必须用这个时刻，
   * 而不是 persist 落盘时刻——否则在「回复完成后立即点退回」场景下，快照
   * createdAt 可能晚于 agent 写文件的 fs/write-intent 时刻，导致本会话刚写的
   * 文件被 writtenPathsAfter 的时间过滤排除，diff 误判「无变化」而跳过回退。
   */
  capturedAt: number
}

/** v2 快照的单文件索引项。s=size；h=blob sha1；b=二进制；l=过大。 */
export interface SnapshotFileRef {
  s: number
  h?: string
  b?: true
  l?: true
}

/** v2 快照：纯索引，不含任何文件内容。 */
export interface RewindSnapshotV2 {
  version: 2
  sessionId: string
  seq: number
  cwd: string
  createdAt: number
  fileCount: number
  files: Record<string, SnapshotFileRef>
  /** 快照额外覆盖的工作区外目录（桌面等）；条目以正斜杠绝对路径为 key。 */
  extDirs?: string[]
}

/**
 * v1 快照（遗留格式）：files 内嵌 base64 内容。仅由兼容读取路径消费，
 * 新快照一律 v2。
 */
export interface SnapshotFileV1 {
  size: number
  content: string | null
  hash?: string
}

export interface RewindSnapshotV1 {
  version: 1
  sessionId: string
  seq: number
  cwd: string
  createdAt: number
  fileCount: number
  files: Record<string, SnapshotFileV1>
}

/** 内存中的统一快照视图：v1/v2 解析后的公共形态。 */
export interface ViewEntry {
  size: number
  /** v2：blob 引用（40 位 sha1）。 */
  hash: string | null
  /** v1 遗留：base64 内容。 */
  content: string | null
}

export interface SnapshotView {
  version: 1 | 2
  sessionId: string
  seq: number
  cwd: string
  createdAt: number
  fileCount: number
  entries: Record<string, ViewEntry>
  /** 快照额外覆盖的工作区外目录（桌面等）；v1 老快照无此字段。 */
  extDirs?: string[]
}

/**
 * 快照的轻量索引（`<seq>.meta.json`）：只有每文件的存在性/大小/指纹，
 * 不含内容。文件浏览器「修改历史」用它快速扫描各时点某文件是否变化，
 * 避免逐个读入大 JSON。v1/v2 快照共用该格式（hash 取 sha1 前 12 位，
 * 仅用于相邻时点相等性比较）。老快照没有 meta 文件——历史视图跳过即可。
 */
export interface RewindSnapshotMeta {
  version: 1
  sessionId: string
  seq: number
  cwd: string
  createdAt: number
  files: Record<string, { size: number; hash?: string }>
}

/** 从 v2 快照派生轻量历史索引。 */
function toMeta(snapshot: RewindSnapshotV2): RewindSnapshotMeta {
  const files: RewindSnapshotMeta['files'] = {}
  for (const [key, entry] of Object.entries(snapshot.files)) {
    files[key] = entry.h !== undefined ? { size: entry.s, hash: entry.h.slice(0, 12) } : { size: entry.s }
  }
  return {
    version: 1,
    sessionId: snapshot.sessionId,
    seq: snapshot.seq,
    cwd: snapshot.cwd,
    createdAt: snapshot.createdAt,
    files,
  }
}

/** 快照落盘路径。 */
function snapshotPath(sessionId: string, seq: number): string {
  return join(rewindHome(), encodeURIComponent(sessionId), `${seq}.json`)
}

/** 快照索引落盘路径。 */
function snapshotMetaPath(sessionId: string, seq: number): string {
  return join(rewindHome(), encodeURIComponent(sessionId), `${seq}.meta.json`)
}

/** 某个会话的快照目录。 */
function snapshotDir(sessionId: string): string {
  return join(rewindHome(), encodeURIComponent(sessionId))
}

/**
 * 某会话的写入记录日志（JSONL）。行格式：
 *  - 新记录：`{"t":<写入毫秒时间戳>,"p":"<绝对路径>"}`（v3，供按快照时点过滤）；
 *  - 旧记录：纯绝对路径行（升级前格式，兼容解析，恒视为已写）。
 */
function writtenLogPath(sessionId: string): string {
  return join(snapshotDir(sessionId), '.written.jsonl')
}

/** 全局写入记录日志（工作区外文件纳入快照用，跨重启存活）。 */
function globalWrittenLogPath(): string {
  return join(rewindHome(), '.written-global.jsonl')
}

/** 同步确保目录存在（写入日志追加前调用；带标志避免重复系统调用）。 */
const ensuredDirs = new Set<string>()
function ensureDirSync(dir: string): void {
  if (ensuredDirs.has(dir)) return
  try { mkdirSync(dir, { recursive: true }) } catch { /* 失败留给 append 的 try/catch */ }
  ensuredDirs.add(dir)
}

/** 追加一行到 JSONL 日志；失败静默（记录丢失只影响退回范围，不影响快照）。 */
function appendWrittenLine(file: string, line: string): void {
  try {
    ensureDirSync(dirname(file))
    appendFileSync(file, `${line}\n`, 'utf8')
  } catch { /* 忽略 */ }
}

/**
 * 取某会话「本会话写过的文件」集合：内存命中直接返回；未加载过的会话先从
 * 磁盘 `.written.jsonl` 合并（服务重启后内存为空，磁盘记录让 diff/restore
 * 在中断场景下依然正确弹窗、正确回退）。返回的 Set 是活引用，后续写入会
 * 继续累积。
 *
 * `.written.jsonl` 行格式：新记录 `{"t":<毫秒>,"p":"<绝对路径>"}`（写入时刻，
 * 供 writtenPathsAfter 按快照时点过滤）；旧版纯路径行兼容解析，视为
 * 时刻 Infinity（恒参与回退，维持升级前行为）。
 */
export function writtenPathsFor(sessionId: string): ReadonlySet<string> {
  if (!writtenLogLoaded.has(sessionId)) {
    writtenLogLoaded.add(sessionId)
    let set = sessionWrittenPaths.get(sessionId)
    if (set === undefined) {
      set = new Set()
      sessionWrittenPaths.set(sessionId, set)
    }
    let times = sessionWrittenTimes.get(sessionId)
    if (times === undefined) {
      times = new Map()
      sessionWrittenTimes.set(sessionId, times)
    }
    try {
      const raw = readFileSync(writtenLogPath(sessionId), 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
        if (trimmed === '') continue
        let path = trimmed
        let t = Number.POSITIVE_INFINITY
        if (trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed) as { t?: unknown; p?: unknown }
            if (typeof parsed.t === 'number' && Number.isFinite(parsed.t) && typeof parsed.p === 'string') {
              path = parsed.p
              t = parsed.t
            }
          } catch { /* 非法 JSON 视作纯路径行 */ }
        }
        if (path === '') continue
        set.add(path)
        // 追加日志按写入顺序排列，逐行覆盖后保留该路径最后一次写入时刻。
        times.set(path, t)
      }
    } catch { /* 无记录文件：本会话确实没写过 */ }
  }
  return sessionWrittenPaths.get(sessionId) ?? EMPTY_WRITTEN_PATHS
}

/**
 * 取某会话「最后写入时刻晚于 afterMs」的文件路径列表（diff/restore 过滤用）。
 *
 * 语义：只有「本会话在快照时点（消息落盘时刻）之后写过」的文件才可能被退回
 * 改变——本会话在快照前最后写入、之后被其他会话/人工/后台任务改过的文件，
 * 当前状态并非本会话的修改，不应回退。旧式无时间戳记录恒视为「已写」，
 * 维持升级前的兼容行为。
 */
export function writtenPathsAfter(sessionId: string, afterMs: number): string[] {
  const paths = writtenPathsFor(sessionId)
  const times = sessionWrittenTimes.get(sessionId)
  const out: string[] = []
  for (const p of paths) {
    const t = times?.get(p) ?? Number.POSITIVE_INFINITY
    if (t > afterMs) out.push(p)
  }
  return out
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

/** 某目录名是否应被排除（精确 + 下划线前缀 + 前缀）。 */
function isExcludedDir(name: string): boolean {
  if (EXCLUDED_DIRS.has(name)) return true
  // 下划线前缀目录视为工具/临时/分析/备份产物（_tmp、_kr-、_planweave_analysis、
  // _update-backup-* 等），不是项目文件，快照与回退一律跳过——避免把「分析任务
  // 生成的整仓副本」「更新备份」等大量非对话产物误算成新增文件、退回时误删。
  if (name.startsWith('_')) return true
  return EXCLUDED_DIR_PREFIXES.some(prefix => name.startsWith(prefix))
}

/**
 * 判断内容是否二进制：采样前 8KB 是否含 NUL 字节。
 * 文本文件几乎不含 NUL；二进制（图片/音频/压缩包等）命中即跳过内容，
 * 只记录存在性——回退时保留现状。
 */
function isBinaryContent(buf: Buffer): boolean {
  const sample = buf.length > 8192 ? buf.subarray(0, 8192) : buf
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true
  }
  return false
}

// ── blob 库 ─────────────────────────────────────────────────────────────────

/**
 * 进程内已确认存在于磁盘的 blob 集：避免每次快照对数千个未变化文件的
 * hash 逐个 existsSync（同步 IO 会卡事件循环）。GC 实际删除后整体清空。
 */
const knownBlobs = new Set<string>()

/** 写入一个 blob（gzip 原文，原子落盘）；已存在则跳过。返回是否真的写了。 */
async function writeBlobIfAbsent(hash: string, plain: Buffer): Promise<boolean> {
  if (knownBlobs.has(hash)) return false
  const file = blobPath(hash)
  if (existsSync(file)) {
    knownBlobs.add(hash)
    return false
  }
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, gzipSync(plain))
  await rename(tmp, file)
  knownBlobs.add(hash)
  return true
}

/** 读取一个 blob 的原文；缺失/损坏返回 null（调用方按「不可恢复」容错）。 */
async function readBlob(hash: string): Promise<Buffer | null> {
  try {
    return gunzipSync(await readFile(blobPath(hash)))
  } catch {
    return null
  }
}

/** 从视图条目取原文内容：优先 blob（v2），回退 base64 内容（v1 遗留）。 */
async function entryBuffer(entry: ViewEntry): Promise<Buffer | null> {
  if (entry.hash !== null) {
    const buf = await readBlob(entry.hash)
    if (buf !== null) return buf
  }
  if (entry.content !== null) return Buffer.from(entry.content, 'base64')
  return null
}

/** 条目是否可恢复（有 blob 或有内嵌内容）。 */
function entryAvailable(entry: ViewEntry): boolean {
  return entry.hash !== null || entry.content !== null
}

// ── 快照额外覆盖的外部目录（桌面等）────────────────────────────────────────

/**
 * 快照额外覆盖的「工作区外常用目录」。agent 经 shell（pwsh 等）工具写入的
 * 文件不经过 fs/write-intent，无法靠记录发现；对这些目录做定向扫描才能把
 * 「在桌面创建/修改/删除文件」这类操作纳入快照与回退。Windows 桌面可能被
 * OneDrive 重定向，两种位置都探测；结果进程内缓存。
 */
let cachedExternalDirs: string[] | null = null
export function externalDirs(): string[] {
  if (cachedExternalDirs !== null) return cachedExternalDirs
  const candidates = [join(homedir(), 'Desktop')]
  const oneDrive = process.env.OneDrive ?? process.env.ONEDRIVE
  if (typeof oneDrive === 'string' && oneDrive !== '') candidates.push(join(oneDrive, 'Desktop'))
  const seen = new Set<string>()
  cachedExternalDirs = candidates.filter(d => {
    const k = d.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    try { return statSync(d).isDirectory() } catch { return false }
  })
  return cachedExternalDirs
}

/** 目录是否位于 cwd 内部（含相等）——cwd 的 walk 已覆盖，外部扫描需跳过。 */
function insideCwd(cwd: string, dir: string): boolean {
  const rel = relative(resolve(cwd), resolve(dir))
  return rel === '' || (!isAbsolute(rel) && !rel.startsWith('..'))
}

// ── 同步快照（在 session/event 回调内同步完成，保证锚点准确）───────────────

/**
 * 同步递归遍历工作区：对每个候选文本文件读取原文并计算 SHA-1（缓存命中时
 * 免读），二进制 / 过大 / 读取失败只记录存在性。返回 null 表示放弃快照
 * （文件数超限）。用 node:fs 同步 API：这个函数跑在 user/message 事件回调里，
 * 必须赶在 agent 下一次 tool 调用修改文件之前拿到准确快照。
 */
export function captureSnapshotSync(cwd: string, extraPaths?: Iterable<string>): CaptureResult | null {
  // 记录捕获开始时刻：这是「消息落盘」的语义锚点，必须早于 agent 后续的任何
  // 文件写入（fs/write-intent 事件在捕获返回后才可能发生）。
  const capturedAt = Date.now()
  const files: Record<string, CapturedFile> = {}
  const buffers = new Map<string, Buffer>()
  let fileCount = 0
  let totalBytes = 0
  let stopped = false

  // 记录一个「只存存在性」的文件。
  const recordUnavailable = (key: string, size: number, flag: 'binary' | 'large'): void => {
    files[key] = { size, flag }
  }

  const addFile = (abs: string, key: string): void => {
    let st
    try {
      st = statSync(abs, { bigint: true })
    } catch {
      return
    }
    const size = Number(st.size)
    if (size > MAX_FILE_BYTES || totalBytes >= MAX_TOTAL_BYTES) {
      recordUnavailable(key, size, 'large')
      return
    }
    // 指纹缓存命中：mtime(纳秒) 与 size 均未变 → 直接复用上次 hash，免读免算。
    const cached = hashCache.get(abs)
    if (cached !== undefined && cached.size === size && cached.mtimeNs === st.mtimeNs) {
      files[key] = { size, hash: cached.hash }
      totalBytes += size
      return
    }
    try {
      const buf = readFileSync(abs)
      if (isBinaryContent(buf)) {
        recordUnavailable(key, buf.length, 'binary')
        return
      }
      const hash = createHash('sha1').update(buf).digest('hex')
      files[key] = { size: buf.length, hash }
      buffers.set(hash, buf)
      hashCache.set(abs, { mtimeNs: st.mtimeNs, size, hash })
      totalBytes += buf.length
    } catch {
      files[key] = { size }
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
      if (isExcludedFile(entry.name)) continue
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

  // 外部目录（桌面等）：与 cwd 同规则递归，但 key 用正斜杠绝对路径。
  const walkExternal = (dir: string): void => {
    if (stopped) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (stopped) return
      if (entry.isSymbolicLink()) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!isExcludedDir(entry.name)) walkExternal(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (isExcludedFile(entry.name)) continue
      fileCount += 1
      if (fileCount > MAX_FILES) {
        stopped = true
        return
      }
      addFile(abs, abs.split(sep).join('/'))
    }
  }

  walk(cwd)
  if (stopped) return null

  // 外部目录（桌面等）定向扫描：shell 写入不经过 fs-intent，只有扫到才能
  // 被快照覆盖、被 diff/restore 检出。位于 cwd 内部的目录跳过（已覆盖）。
  const extDirs: string[] = []
  for (const dir of externalDirs()) {
    if (insideCwd(cwd, dir)) continue
    extDirs.push(resolve(dir))
    walkExternal(resolve(dir))
    if (stopped) return null
  }

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
  return { files, buffers, extDirs, capturedAt }
}

/** 由捕获结果构造 v2 快照（纯函数，便于测试复用）。 */
export function buildSnapshotV2(
  sessionId: string,
  seq: number,
  cwd: string,
  captured: CaptureResult,
): RewindSnapshotV2 {
  const files: Record<string, SnapshotFileRef> = {}
  for (const [key, f] of Object.entries(captured.files)) {
    if (f.hash !== undefined) {
      files[key] = { s: f.size, h: f.hash }
    } else if (f.flag === 'binary') {
      files[key] = { s: f.size, b: true }
    } else if (f.flag === 'large') {
      files[key] = { s: f.size, l: true }
    } else {
      files[key] = { s: f.size }
    }
  }
  return {
    version: 2,
    sessionId,
    seq,
    cwd,
    createdAt: captured.capturedAt ?? Date.now(),
    fileCount: Object.keys(files).length,
    files,
    ...(captured.extDirs !== undefined && captured.extDirs.length > 0 ? { extDirs: captured.extDirs } : {}),
  }
}

/** v2 快照 → 统一内存视图。 */
function viewOfV2(snapshot: RewindSnapshotV2): SnapshotView {
  const entries: Record<string, ViewEntry> = {}
  for (const [key, f] of Object.entries(snapshot.files)) {
    entries[key] = { size: f.s, hash: f.h ?? null, content: null }
  }
  return {
    version: 2,
    sessionId: snapshot.sessionId,
    seq: snapshot.seq,
    cwd: snapshot.cwd,
    createdAt: snapshot.createdAt,
    fileCount: snapshot.fileCount,
    entries,
    extDirs: snapshot.extDirs,
  }
}

/** v1 快照 → 统一内存视图（遗留兼容）。 */
function viewOfV1(snapshot: RewindSnapshotV1): SnapshotView {
  const entries: Record<string, ViewEntry> = {}
  for (const [key, f] of Object.entries(snapshot.files)) {
    entries[key] = { size: f.size, hash: null, content: f.content ?? null }
  }
  return {
    version: 1,
    sessionId: snapshot.sessionId,
    seq: snapshot.seq,
    cwd: snapshot.cwd,
    createdAt: snapshot.createdAt,
    fileCount: snapshot.fileCount,
    entries,
  }
}

/**
 * 落盘一个快照：先补齐缺失 blob（原子写），再原子写索引 JSON 与 meta，
 * 随后做会话内滚动清理，并调度全局维护（预算 / 年龄 / GC）。
 */
export async function persistSnapshot(args: {
  sessionId: string
  seq: number
  cwd: string
  captured: CaptureResult
}): Promise<void> {
  const { sessionId, seq, cwd, captured } = args

  // 1) 补写缺失 blob。正常流程 buffers 覆盖了全部变化文件；缓存命中的文件
  //    若 blob 已被外部删除（如手工清理），这里同步重读补写，保证引用完整。
  for (const [hash, buf] of captured.buffers) {
    await writeBlobIfAbsent(hash, buf)
  }
  for (const [key, f] of Object.entries(captured.files)) {
    if (f.hash === undefined || captured.buffers.has(f.hash)) continue
    if (knownBlobs.has(f.hash) || existsSync(blobPath(f.hash))) continue
    const abs = isAbsolute(key) ? normalize(key) : resolve(cwd, key)
    try {
      const buf = readFileSync(abs)
      if (createHash('sha1').update(buf).digest('hex') === f.hash) {
        await writeBlobIfAbsent(f.hash, buf)
      }
    } catch { /* 补不回来就留给 restore 的容错路径 */ }
  }

  // 2) 原子写快照索引 + meta。
  const snapshot = buildSnapshotV2(sessionId, seq, cwd, captured)
  const file = snapshotPath(sessionId, seq)
  const metaFile = snapshotMetaPath(sessionId, seq)
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(snapshot)}\n`, 'utf8')
  await rename(tmp, file)
  try {
    const metaTmp = `${metaFile}.tmp`
    await writeFile(metaTmp, `${JSON.stringify(toMeta(snapshot))}\n`, 'utf8')
    await rename(metaTmp, metaFile)
  } catch { /* meta 失败只影响历史视图，不影响退回 */ }

  // 3) 会话内滚动清理 + 全局维护调度。
  await pruneOldSnapshots(sessionId)
  scheduleMaintenance()
}

/** 删除一个快照及其 meta 索引。 */
async function removeSnapshotFiles(sessionId: string, seq: number): Promise<void> {
  try { await rm(snapshotPath(sessionId, seq), { force: true }) } catch { /* 忽略 */ }
  try { await rm(snapshotMetaPath(sessionId, seq), { force: true }) } catch { /* 忽略 */ }
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
    await removeSnapshotFiles(sessionId, seq)
  }
}

/** 退回后清理：删除该会话 seq >= fromSeq 的快照（这些消息已被消除）。 */
async function pruneFromSeq(sessionId: string, fromSeq: number): Promise<void> {
  const seqs = await listSnapshotSeqs(sessionId)
  for (const seq of seqs) {
    if (seq < fromSeq) continue
    await removeSnapshotFiles(sessionId, seq)
  }
}

// ── 全局维护：年龄淘汰 / 总量预算 / blob GC ────────────────────────────────

let lastMaintenanceAt = 0
let maintenanceRunning = false

/** 从 JSON 文件头部提取数字字段（createdAt/version 都落在前 512 字节内）。 */
async function peekJsonNumber(file: string, field: string): Promise<number | null> {
  let fh: FileHandle
  try {
    fh = await open(file, 'r')
  } catch {
    return null
  }
  try {
    const buf = Buffer.alloc(512)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    const match = buf.subarray(0, bytesRead).toString('utf8').match(new RegExp(`"${field}":(\\d+)`))
    return match !== null ? Number(match[1]) : null
  } catch {
    return null
  } finally {
    await fh.close().catch(() => {})
  }
}

/** 列出所有会话目录名（encodeURIComponent 过的 session id）。 */
async function listSessionDirs(): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(rewindHome(), { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter(e => e.isDirectory() && e.name !== 'blobs').map(e => e.name)
}

interface SnapshotRecord {
  sessionId: string
  seq: number
  bytes: number
  createdAt: number
}

/** 统计全部快照（大小 + 创建时刻），顺带淘汰超过保留时长的。 */
async function collectAndAgeOut(now: Date): Promise<{ records: SnapshotRecord[]; removedAny: boolean }> {
  const records: SnapshotRecord[] = []
  let removedAny = false
  for (const dirName of await listSessionDirs()) {
    let names: string[]
    try {
      names = await readdir(join(rewindHome(), dirName))
    } catch {
      continue
    }
    for (const name of names) {
      if (!/^\d+\.json$/.test(name)) continue
      const seq = Number(name.slice(0, -5))
      if (!Number.isSafeInteger(seq) || seq < 0) continue
      const jsonPath = join(rewindHome(), dirName, name)
      const metaPath = `${jsonPath.slice(0, -5)}.meta.json`
      let bytes = 0
      let mtimeMs = now.getTime()
      try {
        const st = await stat(jsonPath)
        bytes += st.size
        mtimeMs = st.mtimeMs
        const mt = await stat(metaPath).catch(() => null)
        if (mt !== null) bytes += mt.size
      } catch {
        continue
      }
      const createdAt = await peekJsonNumber(metaPath, 'createdAt')
        ?? await peekJsonNumber(jsonPath, 'createdAt')
        ?? mtimeMs
      if (now.getTime() - createdAt > SNAPSHOT_MAX_AGE_MS) {
        await removeSnapshotFiles(decodeURIComponent(dirName), seq)
        removedAny = true
        continue
      }
      records.push({ sessionId: decodeURIComponent(dirName), seq, bytes, createdAt })
    }
  }
  return { records, removedAny }
}

/** 统计 blob 库（总量 + 明细，供 GC 复用）。 */
async function collectBlobs(): Promise<{ paths: Array<{ path: string; hash: string; mtimeMs: number }>; totalBytes: number }> {
  const out: Array<{ path: string; hash: string; mtimeMs: number }> = []
  let totalBytes = 0
  let shardNames: string[]
  try {
    shardNames = await readdir(blobHome())
  } catch {
    return { paths: out, totalBytes }
  }
  for (const shard of shardNames) {
    const shardDir = join(blobHome(), shard)
    let names: string[]
    try {
      names = await readdir(shardDir)
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(shardDir, name)
      try {
        const st = await stat(path)
        if (!st.isFile()) continue
        out.push({ path, hash: name, mtimeMs: st.mtimeMs })
        totalBytes += st.size
      } catch { /* 忽略 */ }
    }
  }
  return { paths: out, totalBytes }
}

/**
 * blob GC：收集所有 v2 快照索引引用的 hash，删除无引用且超过宽限期的 blob。
 * v1 遗留快照不含 blob 引用，不参与（其内容自包含）。删除后清空指纹缓存，
 * 防止缓存引用已被回收的 blob。
 */
export async function gcBlobs(): Promise<void> {
  const live = new Set<string>()
  for (const dirName of await listSessionDirs()) {
    const dir = join(rewindHome(), dirName)
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!/^\d+\.json$/.test(name)) continue
      const jsonPath = join(dir, name)
      const version = await peekJsonNumber(jsonPath, 'version')
      if (version !== 2) continue // v1 自包含，无 blob 引用
      try {
        const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as RewindSnapshotV2
        for (const f of Object.values(parsed.files)) {
          if (f.h !== undefined) live.add(f.h)
        }
      } catch { /* 读不了就当不存在 */ }
    }
  }
  // 双保险：进程内缓存里的 hash 都是近期刚捕获、马上会被新快照引用的内容，
  // 即使对应索引尚未落盘也不可回收。
  for (const cached of hashCache.values()) live.add(cached.hash)

  const cutoff = Date.now() - BLOB_ORPHAN_GRACE_MS
  const { paths } = await collectBlobs()
  let removed = 0
  for (const blob of paths) {
    if (live.has(blob.hash)) continue
    if (blob.mtimeMs > cutoff) continue // 宽限期内的不视为孤儿
    try {
      await rm(blob.path, { force: true })
      removed += 1
    } catch { /* 忽略 */ }
  }
  if (removed > 0) {
    hashCache.clear()
    knownBlobs.clear()
  }
}

/**
 * 全局维护（节流触发）：淘汰超龄快照 → 若总量超预算则从最老快照淘汰至低位 →
 * 发生过删除就跑一次 blob GC。
 */
export async function runMaintenance(): Promise<void> {
  const now = new Date()
  const ageOut = await collectAndAgeOut(now)
  const blobStats = await collectBlobs()
  let total = blobStats.totalBytes
  for (const rec of ageOut.records) total += rec.bytes

  let deletedAny = ageOut.removedAny
  if (total > GLOBAL_BUDGET_BYTES * GLOBAL_BUDGET_HIGH) {
    const target = GLOBAL_BUDGET_BYTES * GLOBAL_BUDGET_LOW
    const ordered = [...ageOut.records].sort((a, b) => a.createdAt - b.createdAt)
    for (const rec of ordered) {
      if (total <= target) break
      await removeSnapshotFiles(rec.sessionId, rec.seq)
      total -= rec.bytes
      deletedAny = true
    }
  }
  if (deletedAny) await gcBlobs()
}

/** 维护调度：按最小间隔节流；进行中直接跳过（下一条消息再试）。 */
function scheduleMaintenance(): void {
  const now = Date.now()
  if (maintenanceRunning || now - lastMaintenanceAt < MAINTENANCE_INTERVAL_MS) return
  maintenanceRunning = true
  lastMaintenanceAt = now
  void runMaintenance()
    .catch(() => { /* 维护失败不影响主流程，下轮再试 */ })
    .finally(() => { maintenanceRunning = false })
}

// ── 快照读取（统一视图）────────────────────────────────────────────────────

/** 解析并校验一个快照 JSON 为统一视图；v1/v2 兼容。 */
function parseSnapshot(raw: string): SnapshotView | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const obj = parsed as { version?: unknown; cwd?: unknown; files?: unknown }
  if (typeof obj.cwd !== 'string' || typeof obj.files !== 'object' || obj.files === null) return null
  if (obj.version === 2) {
    return viewOfV2(parsed as RewindSnapshotV2)
  }
  if (obj.version === 1) {
    // v1：files 值应为 {size, content, hash?}。
    const v1 = parsed as RewindSnapshotV1
    for (const f of Object.values(v1.files)) {
      if (typeof f.size !== 'number') return null
    }
    return viewOfV1(v1)
  }
  return null
}

async function readSnapshot(sessionId: string, seq: number): Promise<SnapshotView | null> {
  const file = snapshotPath(sessionId, seq)
  try {
    return parseSnapshot(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}
export { readSnapshot }

/**
 * 沿 session lineage 收集会话 id 链（child → … → root）。fork 出的 child 里，
 * seed 消息（继承自 parent）的快照仍存在 parent 目录下，历史/退回都要跨目录查。
 */
function collectLineage(ctx: Context, sessionId: string): string[] {
  const chain = [sessionId]
  const visited = new Set<string>([sessionId])
  const sessions = ctx.get('sessions') as SessionStoreLike | undefined
  if (sessions !== undefined) {
    let current = sessions.get(sessionId)
    while (current !== undefined) {
      const parent = current.header?.parentSession
      if (parent === undefined || visited.has(parent)) break
      visited.add(parent)
      chain.push(parent)
      current = sessions.get(parent)
    }
  }
  return chain
}

/**
 * 沿 session lineage 合并「本会话写过的文件」记录，再做快照时点过滤。
 *
 * fork 出的 child 会话没有自己的 `.written.jsonl`（写入记录按 sessionId 隔离），
 * 但它继承父会话的历史消息与文件状态。退回 child 里的 seed 消息时，若只查
 * child 自己的写入记录，diff/restore 会恒为空——出现「对话消失了、文件没回退、
 * 也没弹确认框」的 bug。因此要沿 lineage 把整条链（含祖先会话）的写入记录
 * 合并后再过滤。
 *
 * 合并规则：按绝对路径取整条链上「最后写入时刻」的最大值，再与快照时点比较。
 * 时刻 Infinity 的旧式无时间戳记录沿用原语义（恒参与回退）。
 */
export function writtenPathsAfterLineage(ctx: Context, sessionId: string, afterMs: number): string[] {
  const times = new Map<string, number>()
  for (const id of collectLineage(ctx, sessionId)) {
    writtenPathsFor(id) // 幂等：触发磁盘 .written.jsonl 加载
    const sessionTimes = sessionWrittenTimes.get(id)
    if (sessionTimes === undefined) continue
    for (const [path, ts] of sessionTimes) {
      const prev = times.get(path)
      if (prev === undefined || ts > prev) times.set(path, ts)
    }
  }
  const out: string[] = []
  for (const [path, ts] of times) {
    if (ts > afterMs) out.push(path)
  }
  return out
}

/**
 * 沿 session lineage 查找快照：fork 出的 child 里，seed 消息（继承自 parent）
 * 的快照仍存在 parent 目录下，退回 seed 消息时需要回退到 parent 的快照。
 * 先查当前 sessionId，未命中再沿 parentSession 逐级向上查。
 */
async function findSnapshot(ctx: Context, sessionId: string, seq: number): Promise<SnapshotView | null> {
  let snapshot = await readSnapshot(sessionId, seq)
  if (snapshot !== null) return snapshot
  for (const id of collectLineage(ctx, sessionId).slice(1)) {
    snapshot = await readSnapshot(id, seq)
    if (snapshot !== null) return snapshot
  }
  return null
}

// ── 恢复 ────────────────────────────────────────────────────────────────────

/**
 * 把工作区恢复到快照状态：
 *   1. 先覆盖写回快照里记录的文件内容（可恢复的）——这是核心目标「修改的
 *      文件回退」。
 *   2. 再删除快照里不存在的当前文件（「新增的文件清理」）——次要，失败不影响
 *      主目标，且整体幂等可重试。
 * 传入 writtenPaths（本会话写过的文件）时，只恢复/删除这些文件——避免把
 * 其他会话 / 人工 / 后台任务的文件一并回退；缺省则全量恢复（兼容旧行为）。
 */
export async function restoreSnapshot(
  view: SnapshotView,
  extraPaths?: Iterable<string>,
  writtenPaths?: Iterable<string>,
): Promise<{ restored: number; deleted: number; skippedLarge: number }> {
  const cwd = resolve(view.cwd)
  let restored = 0
  let skippedLarge = 0
  let deleted = 0

  /** 把一个条目的内容写回目标路径；不可恢复返回 false。 */
  const writeBack = async (abs: string, entry: ViewEntry): Promise<boolean> => {
    const buf = await entryBuffer(entry)
    if (buf === null) return false
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, buf)
    restored += 1
    return true
  }

  // ── 按「本会话写过的文件」过滤：只恢复/删除这些文件 ──
  if (writtenPaths !== undefined) {
    for (const raw of writtenPaths) {
      const abs = normalize(raw)
      if (!isAbsolute(abs)) continue
      const rel = safeRelative(cwd, abs)
      const key = rel !== null ? rel : abs.split(sep).join('/')
      const entry = view.entries[key]
      if (entry !== undefined) {
        if (!(await writeBack(abs, entry))) skippedLarge += 1
      } else {
        // 快照里没有 → 本会话新增的文件，删除。
        try {
          await rm(abs, { force: true })
          deleted += 1
        } catch { /* 删不掉不阻塞 */ }
      }
    }
    return { restored, deleted, skippedLarge }
  }

  // 1) 覆盖写回记录内容。
  for (const [key, entry] of Object.entries(view.entries)) {
    // 插件运行时产物（conversation-card.log 等）不参与回退：写回旧日志没有意义。
    if (isExcludedFile(key.split('/').pop() ?? '')) continue
    // key 为绝对路径（工作区外文件，如桌面）时按绝对路径恢复；否则相对 cwd。
    if (isAbsolute(key)) {
      const abs = normalize(key)
      if (!(await writeBack(abs, entry))) skippedLarge += 1
      continue
    }
    const abs = resolve(cwd, key)
    if (safeRelative(cwd, abs) === null) continue
    if (!(await writeBack(abs, entry))) skippedLarge += 1
  }

  // 2) 删除快照后新增的文件（遍历当前目录，不在快照里的删掉）。
  const snapshotKeys = new Set(Object.keys(view.entries))
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
      if (isExcludedFile(entry.name)) continue
      const rel = safeRelative(cwd, abs)
      if (rel === null) continue
      if (!snapshotKeys.has(rel)) {
        try { await rm(abs, { force: true }) } catch { /* 删不掉不阻塞 */ }
        deleted += 1
      }
    }
  }
  await walkAndDelete(cwd)

  // 2.5) 外部目录（桌面等）：与 diff 对应，删除「快照后新增」的外部文件、
  //      清空新增的空目录。目录来源优先用快照记录的 extDirs。
  const extRoots = view.extDirs ?? externalDirs()
  const walkAndDeleteExternal = async (dir: string): Promise<void> => {
    if (insideCwd(cwd, dir)) return // cwd 内已由 walkAndDelete 处理
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
        await walkAndDeleteExternal(abs)
        try { await rmdir(abs) } catch { /* 非空则保留 */ }
        continue
      }
      if (!entry.isFile()) continue
      if (isExcludedFile(entry.name)) continue
      const key = abs.split(sep).join('/')
      if (snapshotKeys.has(key)) continue // 快照里有，已在第 1 步写回
      try { await rm(abs, { force: true }) } catch { /* 删不掉不阻塞 */ }
      deleted += 1
    }
  }
  for (const dir of extRoots) await walkAndDeleteExternal(resolve(dir))

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

/** 当前内容是否与快照记录不同；v2 走 sha1 指纹比对，v1 走内容比对。 */
async function entryDiffers(current: Buffer, entry: ViewEntry): Promise<boolean> {
  if (entry.content !== null) return !current.equals(Buffer.from(entry.content, 'base64'))
  if (entry.hash !== null) return createHash('sha1').update(current).digest('hex') !== entry.hash
  return false
}

/**
 * 计算当前工作区相对快照的差异（用于退回前的「是否修改文件」判断）：
 *   - modified：快照里记录过内容、当前内容已不同的文件（会被写回）；
 *   - deleted ：快照里记录过内容、当前已不存在的文件（会被写回）；
 *   - added   ：快照里没有、当前存在的新增文件（会被删除）。
 * 只统计 restore 真正会改变的文件：不可恢复的条目（过大/二进制/读失败，
 * restore 保留现状）不参与，避免「实际不会被回退」的文件触发无谓的确认弹窗。
 * 传入 writtenPaths（本会话写过的文件）时，只对比这些文件——避免把其他会话 /
 * 人工 / 后台任务改过的文件误判成本会话的修改；缺省则全量对比（兼容旧行为）。
 */
export async function diffSnapshot(
  view: SnapshotView,
  extraPaths?: Iterable<string>,
  writtenPaths?: Iterable<string>,
): Promise<{ modified: string[]; added: string[]; deleted: string[] }> {
  const cwd = resolve(view.cwd)
  const modified: string[] = []
  const added: string[] = []
  const deleted: string[] = []

  // ── 按「本会话写过的文件」过滤：只处理这些文件 ──
  if (writtenPaths !== undefined) {
    for (const raw of writtenPaths) {
      const abs = normalize(raw)
      if (!isAbsolute(abs)) continue
      const rel = safeRelative(cwd, abs)
      const key = rel !== null ? rel : abs.split(sep).join('/')
      const entry = view.entries[key]
      if (entry !== undefined) {
        if (!entryAvailable(entry)) continue // 不可恢复：restore 保留现状，不参与
        let current: Buffer | null = null
        try {
          current = await readFile(abs)
        } catch {
          deleted.push(key)
          continue
        }
        if (await entryDiffers(current, entry)) modified.push(key)
      } else {
        // 快照里没有：当前仍存在 → 会被删除（新增）。
        try {
          await stat(abs)
          added.push(key)
        } catch { /* 不存在则不算 */ }
      }
    }
    return { modified, added, deleted }
  }

  const snapshotKeys = new Set(Object.keys(view.entries))

  // 1) 对比快照里记录过内容的文件：当前缺失 → deleted；内容不同 → modified。
  for (const [key, entry] of Object.entries(view.entries)) {
    if (!entryAvailable(entry)) continue
    const abs = isAbsolute(key) ? normalize(key) : resolve(cwd, key)
    let current: Buffer | null = null
    try {
      current = await readFile(abs)
    } catch {
      deleted.push(key)
      continue
    }
    if (await entryDiffers(current, entry)) modified.push(key)
  }

  // 2) 遍历当前工作区，找出快照里没有的新增文件。
  const walk = async (dir: string): Promise<void> => {
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
        if (!isExcludedDir(entry.name)) await walk(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (isExcludedFile(entry.name)) continue
      const rel = safeRelative(cwd, abs)
      if (rel === null) continue
      if (!snapshotKeys.has(rel)) added.push(rel)
    }
  }
  await walk(cwd)

  // 2.5) 外部目录（桌面等）：不在快照里的现存文件 → 会被删除的新增。
  //      目录来源优先用快照记录的 extDirs（与 capture 时一致）。
  const addedSeen = new Set<string>()
  const walkAddedExternal = async (dir: string): Promise<void> => {
    if (insideCwd(cwd, dir)) return // cwd 内已由 walk 处理
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
        await walkAddedExternal(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (isExcludedFile(entry.name)) continue
      const key = abs.split(sep).join('/')
      if (snapshotKeys.has(key) || addedSeen.has(key)) continue
      try {
        await stat(abs)
        addedSeen.add(key)
        added.push(key)
      } catch { /* 不存在则不算 */ }
    }
  }
  const extRoots = view.extDirs ?? externalDirs()
  for (const dir of extRoots) await walkAddedExternal(resolve(dir))

  // 3) 工作区外文件（extraPaths）：不在快照里且当前仍存在 → 会被删除（新增）。
  if (extraPaths !== undefined) {
    for (const raw of extraPaths) {
      const abs = normalize(raw)
      if (!isAbsolute(abs)) continue
      if (safeRelative(cwd, abs) !== null) continue
      const key = abs.split(sep).join('/')
      if (snapshotKeys.has(key) || addedSeen.has(key)) continue
      try {
        await stat(abs)
        addedSeen.add(key)
        added.push(key)
      } catch { /* 不存在则不算 */ }
    }
  }

  return { modified, added, deleted }
}

/** 取条目在某时点的文本（/at 与 /compare 共用）；不可恢复返回 null。 */
async function entryTextOf(entry: ViewEntry | undefined): Promise<string | null> {
  if (entry === undefined) return null
  const buf = await entryBuffer(entry)
  return buf !== null ? buf.toString('utf8') : null
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
    if (method === 'GET' && rest === '/version') {
      // 版本探针：返回本模块文件的编译时间。用于确认「服务是否加载了最新
      // 编译的 host 代码」——比较它与 lib/rewind.js 的磁盘 mtime 即可。
      let builtAt: string | null = null
      try {
        builtAt = statSync(fileURLToPath(import.meta.url)).mtime.toISOString()
      } catch { /* 取不到就不报 */ }
      json(res, 200, { ok: true, host: 'webui-rewind/v2-extdirs', builtAt })
      return
    }
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
    if (method === 'GET' && rest === '/diff') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const seq = Number(url.searchParams.get('seq') ?? '')
      if (sessionId === '' || !Number.isSafeInteger(seq) || seq < 0) {
        json(res, 400, { ok: false, error: 'invalid sessionId/seq' })
        return
      }
      const snapshot = await findSnapshot(ctx, sessionId, seq)
      if (snapshot === null) {
        json(res, 404, { ok: false, error: `未找到快照：session=${sessionId} seq=${seq}` })
        return
      }
      try {
        // 只对比「本会话在快照时点之后写过的文件」（第 3 参数 writtenPaths）：
        // 绝不回退其他会话 / 人工 / 后台任务改过的文件——这是退回语义的核心。
        // 注意参数顺序：第 2 参数是 extraPaths（工作区外删除候选），不能把
        // writtenPaths 放这里（会退化成全量对比，误伤其他会话的修改/新增）。
        const written = writtenPathsAfterLineage(ctx, sessionId, snapshot.createdAt)
        const diff = await diffSnapshot(snapshot, undefined, written)
        const changed = diff.modified.length > 0 || diff.added.length > 0 || diff.deleted.length > 0
        const MAX_LIST = 50
        json(res, 200, {
          ok: true,
          changed,
          summary: {
            modified: diff.modified.length,
            added: diff.added.length,
            deleted: diff.deleted.length,
          },
          modified: diff.modified.slice(0, MAX_LIST),
          added: diff.added.slice(0, MAX_LIST),
          deleted: diff.deleted.slice(0, MAX_LIST),
        })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (method === 'GET' && rest === '/history') {
      // 文件修改历史时间线：沿 lineage 扫描各快照 meta 里该文件的指纹，
      // 相邻内容相同的时点合并，返回内容发生变化的时间点（升序）。
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const rawPath = url.searchParams.get('path') ?? ''
      if (sessionId === '' || rawPath === '') {
        json(res, 400, { ok: false, error: 'invalid sessionId/path' })
        return
      }
      try {
        interface HistoryPoint { seq: number; createdAt: number; size: number; hash: string }
        const found: HistoryPoint[] = []
        let cwd: string | null = null
        for (const id of collectLineage(ctx, sessionId)) {
          for (const seq of await listSnapshotSeqs(id)) {
            let meta: RewindSnapshotMeta | null = null
            try {
              meta = JSON.parse(await readFile(snapshotMetaPath(id, seq), 'utf8')) as RewindSnapshotMeta
              if (meta.version !== 1 || typeof meta.cwd !== 'string' || meta.files === null || typeof meta.files !== 'object') meta = null
            } catch {
              meta = null
            }
            if (meta === null) continue // 老快照无索引：历史视图跳过
            const key = resolveSnapshotKey(meta.cwd, rawPath)
            if (key === null) continue
            const entry = meta.files[key]
            if (entry === undefined || entry.hash === undefined) continue
            cwd ??= meta.cwd
            found.push({ seq, createdAt: meta.createdAt, size: entry.size, hash: entry.hash })
          }
        }
        found.sort((a, b) => a.seq - b.seq)
        // 同一 seq 可能在 lineage 多个目录出现（fork seed）：child 先访问，按 seq 去重。
        const bySeq = new Map<number, HistoryPoint>()
        for (const point of found) bySeq.set(point.seq, point)
        // 相邻同内容合并：保留较晚时点（「直到该时刻仍是此内容」）。
        const merged: Array<{ seq: number; createdAt: number; size: number }> = []
        let prevHash: string | null = null
        for (const point of bySeq.values()) {
          if (point.hash === prevHash) {
            const last = merged[merged.length - 1]
            if (last !== undefined) { last.seq = point.seq; last.createdAt = point.createdAt; last.size = point.size }
            continue
          }
          prevHash = point.hash
          merged.push({ seq: point.seq, createdAt: point.createdAt, size: point.size })
        }
        json(res, 200, { ok: true, cwd, points: merged })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (method === 'GET' && rest === '/at') {
      // 读取某快照时点的文件文本内容。
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const rawPath = url.searchParams.get('path') ?? ''
      const seq = Number(url.searchParams.get('seq') ?? '')
      if (sessionId === '' || rawPath === '' || !Number.isSafeInteger(seq) || seq < 0) {
        json(res, 400, { ok: false, error: 'invalid sessionId/seq/path' })
        return
      }
      const snapshot = await findSnapshot(ctx, sessionId, seq)
      if (snapshot === null) {
        json(res, 404, { ok: false, error: `未找到快照：session=${sessionId} seq=${seq}` })
        return
      }
      const key = resolveSnapshotKey(snapshot.cwd, rawPath)
      const entry = key !== null ? snapshot.entries[key] : undefined
      const text = await entryTextOf(entry)
      if (text === null) {
        json(res, 200, { ok: true, unavailable: true })
        return
      }
      json(res, 200, {
        ok: true,
        unavailable: false,
        text,
        size: entry?.size ?? text.length,
        createdAt: snapshot.createdAt,
      })
      return
    }
    if (method === 'GET' && rest === '/compare') {
      // 双栏对齐对比：左=seqA 时点内容，右=当前磁盘（或 seqB 快照）。
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const rawPath = url.searchParams.get('path') ?? ''
      const seq = Number(url.searchParams.get('seq') ?? '')
      const seqBRaw = url.searchParams.get('seqB')
      if (sessionId === '' || rawPath === '' || !Number.isSafeInteger(seq) || seq < 0) {
        json(res, 400, { ok: false, error: 'invalid sessionId/seq/path' })
        return
      }
      const snapshotA = await findSnapshot(ctx, sessionId, seq)
      if (snapshotA === null) {
        json(res, 404, { ok: false, error: `未找到快照：session=${sessionId} seq=${seq}` })
        return
      }

      interface SideContent { text: string | null; unavailable: boolean; size: number }
      const keyA = resolveSnapshotKey(snapshotA.cwd, rawPath)
      const leftText = await entryTextOf(keyA !== null ? snapshotA.entries[keyA] : undefined)
      const leftSize = keyA !== null ? snapshotA.entries[keyA]?.size ?? 0 : 0
      const leftUnavailable = keyA === null || !entryAvailable(snapshotA.entries[keyA])
      const left: SideContent = { text: leftText, unavailable: leftUnavailable, size: leftSize }

      let right: SideContent
      if (seqBRaw !== null) {
        const seqB = Number(seqBRaw)
        if (!Number.isSafeInteger(seqB) || seqB < 0) {
          json(res, 400, { ok: false, error: 'invalid seqB' })
          return
        }
        const snapshotB = await findSnapshot(ctx, sessionId, seqB)
        if (snapshotB === null) {
          json(res, 404, { ok: false, error: `未找到快照：session=${sessionId} seq=${seqB}` })
          return
        }
        const keyB = resolveSnapshotKey(snapshotB.cwd, rawPath)
        const rightText = await entryTextOf(keyB !== null ? snapshotB.entries[keyB] : undefined)
        const rightSize = keyB !== null ? snapshotB.entries[keyB]?.size ?? 0 : 0
        const rightUnavailable = keyB === null || !entryAvailable(snapshotB.entries[keyB])
        right = { text: rightText, unavailable: rightUnavailable, size: rightSize }
      } else {
        // 缺省对比当前磁盘；越界绝对路径也允许（桌面文件场景），仅读不写。
        try {
          const buf = await readFile(resolve(snapshotA.cwd, rawPath))
          if (buf.length > MAX_COMPARE_BYTES || isBinaryContent(buf)) {
            right = { text: null, unavailable: true, size: buf.length }
          } else {
            right = { text: buf.toString('utf8'), unavailable: false, size: buf.length }
          }
        } catch {
          right = { text: null, unavailable: false, size: 0 }
        }
      }

      if (left.unavailable || right.unavailable) {
        json(res, 200, {
          ok: true,
          status: 'unsupported',
          note: left.unavailable && right.unavailable ? 'both' : left.unavailable ? 'left' : 'right',
        })
        return
      }
      const aligned = alignTextDiff(left.text ?? '', right.text ?? '')
      json(res, 200, {
        ok: true,
        status: aligned.added === 0 && aligned.removed === 0 ? 'same' : 'changed',
        rows: aligned.rows,
        stats: { added: aligned.added, removed: aligned.removed, unchanged: aligned.unchanged },
        truncated: aligned.truncated,
        leftMissing: left.text === null,
        rightMissing: right.text === null,
        leftSize: left.size,
        rightSize: right.size,
        leftTime: snapshotA.createdAt,
      })
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
        // 只恢复/删除「本会话在快照时点之后写过的文件」（第 3 参数 writtenPaths）：
        // 与 /diff 对应——弹窗里列出的每个变化都会被真正回退，其他会话 / 人工 /
        // 后台任务的文件一律不碰（修复前误把该集合传给 extraPaths 第 2 参数，
        // 退化成全量恢复，导致回退其他会话的文件）。
        const written = writtenPathsAfterLineage(ctx, sessionId, snapshot.createdAt)
        const result = await restoreSnapshot(snapshot, undefined, written)
        // 退回成功后，这条消息及之后的上下文已被消除，它们的快照必须一并
        // 清理——否则残留的「未来时点」快照会在后续退回（尤其沿 lineage 查找）
        // 时被错误命中，恢复出混乱的文件状态。
        await pruneFromSeq(sessionId, seqRaw).catch(() => { /* 清理失败不阻塞退回 */ })
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
  // ── 启动时从磁盘恢复全局写入记录（跨重启存活）──
  try {
    const raw = readFileSync(globalWrittenLogPath(), 'utf8')
    for (const line of raw.split('\n')) {
      const path = line.endsWith('\r') ? line.slice(0, -1) : line
      if (path !== '') fsWrittenPaths.add(path)
    }
  } catch { /* 无记录：全新开始 */ }

  // ── 记录 fs 服务写过的文件（含工作区外），让这些文件也纳入快照/回退 ──
  const recordFsWrite = (target: unknown, actor: unknown): void => {
    try {
      const fs = ctx.get('fs') as { processPath(t: unknown): string } | undefined
      if (fs === undefined) return
      const absPath = fs.processPath(target)
      if (typeof absPath !== 'string' || !isAbsolute(absPath)) return
      if (!fsWrittenPaths.has(absPath)) {
        fsWrittenPaths.add(absPath)
        // 全局日志：跨重启存活，重启后的快照仍能把工作区外文件纳入 extraPaths。
        appendWrittenLine(globalWrittenLogPath(), absPath)
      }
      const sessionId = extractSessionId(actor)
      if (sessionId === undefined) return
      let set = sessionWrittenPaths.get(sessionId)
      if (set === undefined) {
        set = new Set()
        sessionWrittenPaths.set(sessionId, set)
      }
      if (!set.has(absPath)) {
        set.add(absPath)
        // 会话日志：跨重启存活——中断/重启后退回仍能正确弹窗列出修改、正确恢复。
        writtenLogLoaded.add(sessionId)
        appendWrittenLine(writtenLogPath(sessionId), absPath)
      }
      // 带时刻的记录（v3）：diff/restore 按「快照时点之后本会话才写过」过滤，
      // 避免把快照前本会话写过的文件（之后被其他会话/人工改过）误回退。
      let times = sessionWrittenTimes.get(sessionId)
      if (times === undefined) {
        times = new Map()
        sessionWrittenTimes.set(sessionId, times)
      }
      const now = Date.now()
      if ((times.get(absPath) ?? Number.NEGATIVE_INFINITY) < now) {
        times.set(absPath, now)
        appendWrittenLine(writtenLogPath(sessionId), JSON.stringify({ t: now, p: absPath }))
      }
    } catch { /* 忽略：拿不到路径就不扩展快照 */ }
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

  ctx.on('session/event', ((session: SessionLike, event: SessionEventLike) => {
    if (event.type !== 'user/message') return
    if (event.data?.source?.kind !== 'user') return
    const cwd = session.header?.cwd
    if (cwd === undefined || cwd === '') return
    const seq = event.seq
    if (!Number.isSafeInteger(seq) || seq < 0) return

    // 同步捕获（必须赶在 agent 下次 tool 修改文件之前完成）。
    let captured: CaptureResult | null = null
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
    void persistSnapshot({ sessionId: session.id, seq, cwd: resolve(cwd), captured })
      .catch((error: unknown) => {
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
