/**
 * dsh-memory 文件存储层：entries.json / state.json / changes/<date>.jsonl /
 * 各层 md 产物。所有写入走「tmp + rename」原子写，防止半写损坏。
 * 数据根：${DSH_HOME:-~/.dsh}/memories/dsh-memory/（与 memory-evolve 遗留数据同根目录、不同前缀，互不读写）。
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  ChangeRecord,
  MemoryEntry,
  ProjectMeta,
  RevisionMeta,
  StoreState,
} from '../types.js'

/** 数据根目录。 */
export function memoryHome(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'memories', 'dsh-memory')
}

/** workspace 路径 → 项目目录 hash（sha1 前 12 位）。 */
export function projectHashOf(cwd: string): string {
  return createHash('sha1').update(cwd).digest('hex').slice(0, 12)
}

/** 记忆条目稳定 id：mem_<sha1(content|scope|projectHash)>，同内容合并。 */
export function entryIdOf(content: string, scope: 'global' | 'project', projectHash: string | null): string {
  const key = `${scope}\u0000${projectHash ?? ''}\u0000${content.trim()}`
  return `mem_${createHash('sha1').update(key).digest('hex').slice(0, 16)}`
}

/** 本地日期 YYYY-MM-DD。 */
export function localDate(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** ISO 时间（本地时区偏移保留）。 */
export function nowIso(): string {
  return new Date().toISOString()
}

/** 原子写文本：tmp + rename（同一目录内）。 */
export async function atomicWriteText(file: string, content: string): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, content, 'utf8')
  await rename(temp, file)
}

/** 原子写 JSON。 */
export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** 读取 JSON，缺失/损坏返回 fallback。 */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** 追加一行 JSONL（追加本身用 appendFile；损坏容忍，读侧幂等）。 */
export async function appendJsonl(file: string, value: unknown): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  const { appendFile } = await import('node:fs/promises')
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8')
}

/** 读取 JSONL（容忍坏行），返回 { entries, seq }。 */
export async function readJsonl<T>(file: string): Promise<T[]> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return []
  }
  const out: T[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      out.push(JSON.parse(trimmed) as T)
    } catch {
      // 单条解析失败跳过，不中断批次。
    }
  }
  return out
}

/** 修订版本保留上限（滚动清理，超过只保留最近 N 个）。 */
const REVISION_KEEP = 20

/**
 * MemoryStore：所有记忆数据的读写入口。
 * 线程模型：调用方（ticker / turn/end 捕获）通过同一实例串行化写入，
 * 内部只保证单文件操作的原子性。
 */
export class MemoryStore {
  readonly root: string

  constructor(root = memoryHome()) {
    this.root = root
  }

  // ── 路径 ────────────────────────────────────────────────────────────

  entriesFile(): string {
    return join(this.root, 'store', 'entries.json')
  }

  stateFile(): string {
    return join(this.root, 'store', 'state.json')
  }

  changesFile(date: string): string {
    return join(this.root, 'changes', `${date}.jsonl`)
  }

  globalDir(): string {
    return join(this.root, 'global')
  }

  projectDir(hash: string): string {
    return join(this.root, 'projects', hash)
  }

  dailyFile(date: string): string {
    return join(this.root, 'daily', `${date}.md`)
  }

  // ── 条目 ────────────────────────────────────────────────────────────

  /** 全量条目索引（缺失/损坏从空开始）。 */
  async readEntries(): Promise<MemoryEntry[]> {
    const file = await readJson<{ version: 1; entries: MemoryEntry[] }>(
      this.entriesFile(),
      { version: 1, entries: [] },
    )
    return Array.isArray(file.entries) ? file.entries : []
  }

  async writeEntries(entries: MemoryEntry[]): Promise<void> {
    await atomicWriteJson(this.entriesFile(), { version: 1, entries })
  }

  /**
   * entries.json 写串行队列：所有「读-改-写」操作必须经此队列执行，
   * 消除提取/注入命中刷新/API 裁决/每日编译之间的并发覆盖（read-modify-write 竞争）。
   */
  private writeQueue: Promise<void> = Promise.resolve()
  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task)
    this.writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * 原子化「读 entries → 修改 → 写回」。fn 原地修改传入数组（或返回替换数组）。
   * @param fn - 接收当前 entries 快照，修改或返回新数组；返回值透传。
   */
  async mutateEntries<T>(fn: (entries: MemoryEntry[]) => Promise<T> | T): Promise<T> {
    return this.enqueueWrite(async () => {
      const entries = await this.readEntries()
      const result = await fn(entries)
      await this.writeEntries(entries)
      return result
    })
  }

  async getEntry(id: string): Promise<MemoryEntry | undefined> {
    const entries = await this.readEntries()
    return entries.find(entry => entry.id === id)
  }

  /**
   * 新增或更新（同 id 合并）。返回 { created, entry }。
   * 同时按去重逻辑：新增时若同内容（同 scope+projectHash）已存在则合并为 update。
   */
  async upsertEntry(next: {
    content: string
    scope: 'global' | 'project'
    projectHash: string | null
    tags?: string[]
    pinned?: boolean
    importance?: number
    lastHitAt?: string | null
    layer?: 'short' | 'long'
    source?: 'extract' | 'manual'
  }): Promise<{ created: boolean; entry: MemoryEntry }> {
    return this.mutateEntries(entries => {
      const id = entryIdOf(next.content, next.scope, next.projectHash)
      const existing = entries.find(entry => entry.id === id)
      const now = nowIso()
      let entry: MemoryEntry
      if (existing !== undefined) {
        entry = {
          ...existing,
          content: next.content,
          tags: mergeTags(existing.tags, next.tags),
          pinned: next.pinned ?? existing.pinned,
          importance: Math.max(existing.importance, next.importance ?? existing.importance),
          layer: next.layer ?? existing.layer,
          updatedAt: now,
        }
        entries.splice(entries.indexOf(existing), 1, entry)
        return { created: false, entry }
      }
      entry = {
        id,
        content: next.content,
        scope: next.scope,
        projectHash: next.scope === 'project' ? next.projectHash : null,
        tags: next.tags ?? [],
        pinned: next.pinned ?? false,
        createdAt: now,
        updatedAt: now,
        importance: next.importance ?? 10,
        lastHitAt: null,
        layer: next.layer ?? 'short',
        source: next.source ?? 'extract',
      }
      entries.push(entry)
      return { created: true, entry }
    })
  }

  /** 替换单条（用于裁决操作：改标签/移项目/置顶）。返回新条目；不存在返回 undefined。 */
  async patchEntry(id: string, patch: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry | undefined> {
    return this.mutateEntries(entries => {
      const index = entries.findIndex(entry => entry.id === id)
      if (index === -1) return undefined
      const updated: MemoryEntry = {
        ...entries[index],
        ...patch,
        id,
        updatedAt: nowIso(),
      }
      if (updated.scope === 'global') updated.projectHash = null
      entries[index] = updated
      return updated
    })
  }

  /** 删除条目。返回是否删除成功。 */
  async removeEntry(id: string): Promise<boolean> {
    return this.mutateEntries(entries => {
      const index = entries.findIndex(entry => entry.id === id)
      if (index === -1) return false
      entries.splice(index, 1)
      return true
    })
  }

  /** 注入命中刷新（原子）：给命中的条目加分并刷新 lastHitAt，返回刷新条数。 */
  async applyHits(hitIds: Set<string>, bonus: number): Promise<number> {
    return this.mutateEntries(entries => {
      let count = 0
      for (const entry of entries) {
        if (!hitIds.has(entry.id)) continue
        entry.importance = Math.min(20, Math.round((entry.importance + bonus) * 100) / 100)
        entry.lastHitAt = nowIso()
        count += 1
      }
      return count
    })
  }

  /** 原子替换全部条目（ticker 每日编译等批量场景；fn 返回新数组）。 */
  async replaceEntries(fn: (entries: MemoryEntry[]) => Promise<MemoryEntry[]> | MemoryEntry[]): Promise<MemoryEntry[]> {
    return this.enqueueWrite(async () => {
      const entries = await this.readEntries()
      const next = await fn(entries)
      await this.writeEntries(next)
      return next
    })
  }

  // ── 变更流 ──────────────────────────────────────────────────────────

  async appendChange(change: Omit<ChangeRecord, 'id' | 'at'>): Promise<ChangeRecord> {
    const record: ChangeRecord = {
      ...change,
      id: `chg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
      at: nowIso(),
    }
    await appendJsonl(this.changesFile(localDate()), record)
    return record
  }

  async readChanges(date?: string): Promise<ChangeRecord[]> {
    if (date !== undefined) return readJsonl<ChangeRecord>(this.changesFile(date))
    const dir = join(this.root, 'changes')
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      return []
    }
    const dates = files
      .filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
      .sort()
    const all: ChangeRecord[] = []
    for (const file of dates) {
      all.push(...await readJsonl<ChangeRecord>(join(dir, file)))
    }
    return all
  }

  // ── ticker 状态 ─────────────────────────────────────────────────────

  /** 插件错误日志（追加模式，供崩溃排查；DSH 控制台日志不落盘）。 */
  async appendErrorLog(stage: string, message: string): Promise<void> {
    const { appendFile } = await import('node:fs/promises')
    const file = join(this.root, 'log', 'errors.log')
    await mkdir(join(file, '..'), { recursive: true })
    await appendFile(file, `[${nowIso()}] ${stage}: ${message}\n`, 'utf8')
  }

  /** 提取诊断日志（追加模式：开始/结束/耗时/候选数，排查提取卡死）。 */
  async appendExtractLog(message: string): Promise<void> {
    const { appendFile } = await import('node:fs/promises')
    const file = join(this.root, 'log', 'extract.log')
    await mkdir(join(file, '..'), { recursive: true })
    await appendFile(file, `[${nowIso()}] ${message}\n`, 'utf8')
  }

  async readState(): Promise<StoreState> {
    const state = await readJson<StoreState>(this.stateFile(), {
      schemaVersion: 1,
      perSession: {},
      lastDailyDate: null,
    })
    if (state.perSession === undefined || state.perSession === null) state.perSession = {}
    return state
  }

  async writeState(state: StoreState): Promise<void> {
    await atomicWriteJson(this.stateFile(), state)
  }

  // ── 记忆注入开关（按会话，内存缓存 + state.json 持久化） ───────────

  /** 注入被关闭的会话 id（内存缓存；null = 未加载）。 */
  private injectDisabledCache: Set<string> | null = null

  private async ensureInjectCache(): Promise<Set<string>> {
    if (this.injectDisabledCache !== null) return this.injectDisabledCache
    const state = await this.readState()
    this.injectDisabledCache = new Set(Array.isArray(state.injectDisabled) ? state.injectDisabled : [])
    return this.injectDisabledCache
  }

  /** 该会话是否启用记忆注入（默认开启）。 */
  async isInjectEnabled(sessionId: string): Promise<boolean> {
    const cache = await this.ensureInjectCache()
    return !cache.has(sessionId)
  }

  /** 设置该会话的记忆注入开关（持久化到 state.json，走写串行队列）。 */
  async setInjectEnabled(sessionId: string, enabled: boolean): Promise<void> {
    const cache = await this.ensureInjectCache()
    const next = new Set(cache)
    if (enabled) next.delete(sessionId)
    else next.add(sessionId)
    this.injectDisabledCache = next
    await this.enqueueWrite(async () => {
      const state = await this.readState()
      state.injectDisabled = [...next]
      await this.writeState(state)
    })
  }

  // ── 项目 meta ───────────────────────────────────────────────────────

  async readProjectMeta(hash: string): Promise<ProjectMeta | undefined> {
    const meta = await readJson<ProjectMeta | null>(join(this.projectDir(hash), 'meta.json'), null)
    return meta ?? undefined
  }

  async writeProjectMeta(hash: string, meta: ProjectMeta): Promise<void> {
    await atomicWriteJson(join(this.projectDir(hash), 'meta.json'), meta)
  }

  /** 该工作区是否开启自动记忆（默认 true；meta 缺失或字段未写视为开启）。 */
  async isAutoMemoryEnabled(hash: string): Promise<boolean> {
    const meta = await this.readProjectMeta(hash)
    return meta?.autoMemory !== false
  }

  /** 列出全部项目（含 meta 与统计）。 */
  async listProjects(entries: MemoryEntry[]): Promise<Array<ProjectMeta & { hash: string; entryCount: number; pinnedCount: number; autoMemory: boolean }>> {
    const dir = join(this.root, 'projects')
    let hashes: string[]
    try {
      hashes = (await readdir(dir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    } catch {
      hashes = []
    }
    const projects: Array<ProjectMeta & { hash: string; entryCount: number; pinnedCount: number; autoMemory: boolean }> = []
    for (const hash of hashes) {
      const meta = await this.readProjectMeta(hash)
      if (meta === undefined) continue
      const owned = entries.filter(entry => entry.scope === 'project' && entry.projectHash === hash)
      projects.push({
        hash,
        path: meta.path,
        alias: meta.alias,
        locked: meta.locked,
        autoMemory: meta.autoMemory !== false,
        entryCount: owned.length,
        pinnedCount: owned.filter(entry => entry.pinned).length,
      })
    }
    projects.sort((a, b) => a.path.localeCompare(b.path))
    return projects
  }

  /**
   * 读取 DSH 工作区注册表（${DSH_HOME}/storages/workspace.json），容错返回空。
   * 用于让「尚无记忆的新工作区」也出现在面板项目列表（entryCount 0）。
   */
  async listDshWorkspaces(): Promise<Array<{ path: string; title: string }>> {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const file = join(dshHome, 'storages', 'workspace.json')
    const raw = await readJson<{ tables?: { workspaces?: Record<string, { path?: string; title?: string }> } }>(file, {})
    const table = raw?.tables?.workspaces
    if (typeof table !== 'object' || table === null) return []
    const out: Array<{ path: string; title: string }> = []
    for (const record of Object.values(table)) {
      if (typeof record === 'object' && record !== null && typeof record.path === 'string' && record.path !== '') {
        out.push({ path: record.path, title: typeof record.title === 'string' && record.title !== '' ? record.title : record.path })
      }
    }
    return out
  }

  // ── 修订版本（consolidate 回滚锚点） ────────────────────────────────

  revisionsDir(): string {
    return join(this.root, 'revisions')
  }

  /**
   * 写入一个修订快照（整理前调用），返回修订 id。
   * 保存 meta + 全量 entries，回滚时直接整体恢复。
   */
  async writeRevision(input: { entries: MemoryEntry[]; scope: string; trigger: 'daily' | 'manual' }): Promise<string> {
    const id = `rev_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
    const meta: RevisionMeta = {
      id,
      at: nowIso(),
      entryCount: input.entries.length,
      scope: input.scope,
      trigger: input.trigger,
    }
    await atomicWriteJson(join(this.revisionsDir(), `${id}.json`), { version: 1, meta, entries: input.entries })
    await this.pruneRevisions(REVISION_KEEP)
    return id
  }

  /** 列出修订版本（新 → 旧）。 */
  async listRevisions(): Promise<RevisionMeta[]> {
    const dir = this.revisionsDir()
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      return []
    }
    const metas: RevisionMeta[] = []
    for (const file of files) {
      if (!/^rev_[0-9a-z]+_[0-9a-z]+\.json$/.test(file)) continue
      const data = await readJson<{ meta?: RevisionMeta }>(join(dir, file), {})
      if (data.meta !== undefined && typeof data.meta.id === 'string') metas.push(data.meta)
    }
    return metas.sort((a, b) => b.at.localeCompare(a.at))
  }

  /** 读修订快照的全部条目；不存在返回 null。 */
  async readRevisionEntries(id: string): Promise<MemoryEntry[] | null> {
    const data = await readJson<{ entries?: MemoryEntry[] } | null>(join(this.revisionsDir(), `${id}.json`), null)
    if (data === null || !Array.isArray(data.entries)) return null
    return data.entries
  }

  /** 回滚到某修订（整体恢复 entries，走写串行队列）。返回是否成功。 */
  async restoreRevision(id: string): Promise<boolean> {
    const entries = await this.readRevisionEntries(id)
    if (entries === null) return false
    await this.replaceEntries(() => entries)
    return true
  }

  /** 滚动清理：只保留最近 keep 个修订。 */
  async pruneRevisions(keep: number): Promise<void> {
    const metas = await this.listRevisions()
    if (metas.length <= keep) return
    for (const meta of metas.slice(keep)) {
      try {
        await unlink(join(this.revisionsDir(), `${meta.id}.json`))
      } catch {
        // 已不存在则忽略。
      }
    }
  }

  // ── md 产物（compile.ts 调用） ─────────────────────────────────────

  /** 写任意 md 产物（原子）。 */
  async writeArtifact(path: string, content: string): Promise<void> {
    await atomicWriteText(join(this.root, path), content)
  }

  /** 写项目层产物。 */
  async writeProjectArtifacts(hash: string, artifacts: { memory?: string; facts?: string; pinned?: string }): Promise<void> {
    const dir = this.projectDir(hash)
    await mkdir(dir, { recursive: true })
    for (const [name, content] of Object.entries(artifacts)) {
      if (content === undefined) continue
      await atomicWriteText(join(dir, `${name}.md`), content)
    }
  }

  /** 写全局层产物。 */
  async writeGlobalArtifacts(artifacts: { identity?: string; facts?: string; pinned?: string }): Promise<void> {
    const dir = this.globalDir()
    await mkdir(dir, { recursive: true })
    for (const [name, content] of Object.entries(artifacts)) {
      if (content === undefined) continue
      await atomicWriteText(join(dir, `${name}.md`), content)
    }
  }
}

/** 合并标签（保留旧标签 + 新标签，去重，上限 8）。 */
export function mergeTags(existing: string[], next: string[] | undefined, max = 8): string[] {
  const out: string[] = []
  for (const tag of [...existing, ...(next ?? [])]) {
    const t = String(tag).trim()
    if (t === '') continue
    if (!out.includes(t)) out.push(t)
    if (out.length >= max) break
  }
  return out
}

/** 摘要（截断 80 字）。 */
export function summarize(content: string, max = 80): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}
