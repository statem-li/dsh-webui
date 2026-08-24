/**
 * webui — 工作区临时垃圾清理器（host 半身，模块 key：tmpCleaner）。
 *
 * 三层能力：
 *  1. `_tmp` 约定目录清理：AI 生成的临时脚本统一写入各工作区根下的 _tmp/，
 *     本模块定期把该目录内容整体清掉（_tmp 目录本身保留）。配套 systemPrompt
 *     注入一条约定（injectPrompt，默认开启），让模型主动把一次性脚本/中间
 *     产物放进 _tmp/——「生成有归宿、清理有边界」的闭环。
 *  2. 规则化垃圾扫描：内置常见临时文件规则（*.tmp / *.bak / *.swp / *.log /
 *     .DS_Store / Thumbs.db / desktop.ini / ~$*）+ 用户自定义追加规则，
 *     在各已注册工作区内递归扫描；硬编码保护目录（.git、node_modules 等）
 *     永不下钻、永不删除其中内容。
 *  3. 触发与入口：服务进程内轻量调度（每日 HH:mm 或每 N 小时，settings
 *     持久化、设置页可自定触发时间）+ 可选服务启动后补一轮 + HTTP API
 *     （GET 配置与历史 / POST 改配置、dry-run 预览、真实执行）+ agent 工具
 *     `webui_tmp_clean`（preview=只列清单不删，run=真删）。
 *
 * 安全设计：
 *  - 只作用于 workspaceRegistry 已注册的工作区根之内；
 *  - 文件最小年龄阈值（minAgeHours，默认 24h）：mtime 未到龄的一律不动，
 *    避免「AI 刚写的脚本下一秒就被清掉」；
 *  - 单轮删除条目数上限（MAX_ITEMS_PER_RUN），防失控；
 *  - 策略为直接删除（用户 2026-09 确认），每轮落 jsonl 日志
 *    （${DSH_HOME:-~/.dsh}/tmp-cleaner/dsh-webui/log.jsonl）可回看删了什么。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, statSync, rmSync, writeFileSync, type Stats } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any

// ── 常量 ────────────────────────────────────────────────────────────────────

/** AI 临时产物的约定目录名（工作区根直接子级）。 */
export const TMP_DIR_NAME = '_tmp'

/** 单轮清理的条目数上限（文件 + 目录合计），超出即截断本轮。 */
const MAX_ITEMS_PER_RUN = 2000

/** 日志保留条数上限：超过后修剪到该值的一半。 */
const LOG_TRIM_OVER = 400
const LOG_TRIM_KEEP = 200

/** UI / 工具返回的最近日志条数。 */
const RECENT_LOG_LIMIT = 20

/** 内置垃圾文件规则（匹配 basename，大小写不敏感；* 与 ? 通配）。 */
const BUILTIN_FILE_PATTERNS = [
  '*.tmp', '*.bak', '*.swp', '*.log',
  '.DS_Store', 'Thumbs.db', 'desktop.ini', '~$*',
]

/** 保护目录：扫描时永不下钻、永不删除其中的任何内容。 */
const PROTECTED_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', '.venv', 'venv', '__pycache__',
  '.dsh', '.idea', '.vscode', 'dist', 'build', 'out', 'coverage', 'target',
])

/** 数据根：${DSH_HOME:-~/.dsh}/tmp-cleaner/dsh-webui/。 */
function dataRoot(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'tmp-cleaner', 'dsh-webui')
}

// ── 配置 ────────────────────────────────────────────────────────────────────

export interface CleanerConfig {
  /** 自动调度总开关（手动 API / agent 工具不受它限制）。 */
  enabled: boolean
  /** 调度类型：daily=每天固定时刻；interval=固定间隔小时。 */
  scheduleKind: 'daily' | 'interval'
  /** daily 模式的触发时刻，HH:mm（默认 03:30）。 */
  dailyTime: string
  /** interval 模式的间隔小时数（默认 12）。 */
  intervalHours: number
  /** 文件最小年龄（小时）：mtime 距今不足该时长的一律不动。 */
  minAgeHours: number
  /** 服务启动后是否补跑一轮（延迟 15s 避开启动高峰）。 */
  cleanOnStart: boolean
  /** 是否注入「临时脚本写 _tmp/」系统提示词约定。 */
  injectPrompt: boolean
  /** 追加的自定义文件规则（* ? 通配，匹配 basename）。 */
  extraPatterns: string[]
  /** 是否顺带清理扫描中发现的完全空目录（默认关）。 */
  cleanEmptyDirs: boolean
}

const CONFIG_DEFAULTS: CleanerConfig = {
  enabled: true,
  scheduleKind: 'daily',
  dailyTime: '03:30',
  intervalHours: 12,
  minAgeHours: 24,
  cleanOnStart: false,
  injectPrompt: true,
  extraPatterns: [],
  cleanEmptyDirs: false,
}

/** 把任意来源的配置投影收紧为合法 CleanerConfig（绝不抛错）。 */
function normalizeConfig(raw: unknown): CleanerConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bool = (v: unknown, dflt: boolean): boolean => typeof v === 'boolean' ? v : dflt
  const time = typeof src.dailyTime === 'string' && /^\d{1,2}:\d{2}$/.test(src.dailyTime.trim())
    ? src.dailyTime.trim()
    : CONFIG_DEFAULTS.dailyTime
  const hours = Number(src.intervalHours)
  return {
    enabled: bool(src.enabled, CONFIG_DEFAULTS.enabled),
    scheduleKind: src.scheduleKind === 'interval' ? 'interval' : 'daily',
    dailyTime: time,
    intervalHours: Number.isFinite(hours) ? Math.min(24 * 30, Math.max(1, Math.round(hours))) : CONFIG_DEFAULTS.intervalHours,
    minAgeHours: Number.isFinite(Number(src.minAgeHours))
      ? Math.min(24 * 365, Math.max(0, Math.round(Number(src.minAgeHours))))
      : CONFIG_DEFAULTS.minAgeHours,
    cleanOnStart: bool(src.cleanOnStart, CONFIG_DEFAULTS.cleanOnStart),
    injectPrompt: bool(src.injectPrompt, CONFIG_DEFAULTS.injectPrompt),
    extraPatterns: Array.isArray(src.extraPatterns)
      ? src.extraPatterns.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map(p => p.trim()).slice(0, 64)
      : [],
    cleanEmptyDirs: bool(src.cleanEmptyDirs, CONFIG_DEFAULTS.cleanEmptyDirs),
  }
}

// ── 系统提示词注入 ──────────────────────────────────────────────────────────

/** 注入的系统提示词片段：把一次性产物赶进 _tmp/，与清理器闭环。 */
const TMP_CONVENTION_INSTRUCTION =
  '【工作区临时文件约定】凡是为完成当前任务而临时创建的一次性脚本、探针、数据抓取结果等中间产物，一律写入当前工作区根下的 _tmp/ 目录（不存在就先创建它），不要散落在工作区其他位置；这些文件无需你手动删除，系统会定期自动清理。正式的项目代码与文档不要放进 _tmp/。'

// ── 清理引擎 ────────────────────────────────────────────────────────────────

interface CleanItem {
  path: string
  bytes: number
  /** 命中原因：'_tmp 目录' / 规则文本 / '空目录'。 */
  reason: string
}

export interface CleanResult {
  startedAt: string
  dryRun: boolean
  workspaces: string[]
  items: CleanItem[]
  freedBytes: number
  errors: string[]
  truncated: boolean
}

/** 把通配规则（仅 * 与 ?）编译成 basename 匹配的正则（大小写不敏感）。 */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^\\\\/]*')
    .replace(/\?/g, '[^\\\\/]')
  return new RegExp(`^${escaped}$`, 'i')
}

function activeFileRegexes(config: CleanerConfig): RegExp[] {
  return [...BUILTIN_FILE_PATTERNS, ...config.extraPatterns].map(globToRegExp)
}

/** 汇总一个文件/目录的大小（目录递归累加）。失败返回 0。 */
function sizeOf(target: string): number {
  try {
    const st = statSync(target)
    if (!st.isDirectory()) return st.size
    let total = 0
    for (const entry of readdirSync(target)) {
      total += sizeOf(join(target, entry))
    }
    return total
  } catch {
    return 0
  }
}

/**
 * 目标及其整棵子树的最新 mtime（目录自身 mtime 不随深层内容更新而刷新，
 * 「刚改过文件的子树」必须按子树最新 mtime 判龄，否则会误删新产物）。
 */
function newestMtimeMs(target: string): number {
  try {
    const st = statSync(target)
    let newest = st.mtimeMs
    if (st.isDirectory()) {
      for (const entry of readdirSync(target)) {
        const inner = newestMtimeMs(join(target, entry))
        if (inner > newest) newest = inner
      }
    }
    return newest
  } catch {
    return Number.POSITIVE_INFINITY // 读不到按「崭新」处理，宁可不删。
  }
}

interface ScanState {
  cutoffMs: number
  regexes: RegExp[]
  config: CleanerConfig
  now: number
}

/**
 * 收集单个工作区的待清理条目：
 *  - `<root>/_tmp/` 下所有到龄内容整体入列（_tmp 目录本身保留）；
 *  - 全树（跳过保护目录与 _tmp 自身——后者已单独处理）按规则匹配文件。
 */
function collectForWorkspace(root: string, state: ScanState): { items: CleanItem[]; emptyDirs: string[]; truncated: boolean } {
  const items: CleanItem[] = []
  const emptyDirs: string[] = []
  let count = 0
  let truncated = false

  const budgetLeft = (): boolean => {
    if (count >= MAX_ITEMS_PER_RUN) {
      truncated = true
      return false
    }
    return true
  }

  const isOldEnough = (target: string): boolean => {
    try {
      const st = statSync(target)
      // 目录按子树最新 mtime 判龄（父目录 mtime 不反映深层更新）。
      return st.isDirectory() ? newestMtimeMs(target) <= state.cutoffMs : st.mtimeMs <= state.cutoffMs
    } catch {
      return false // 读不到元数据的按「不够老」处理，宁可不删。
    }
  }

  // 1) _tmp 约定目录：内容整体清理，目录本身保留。
  const tmpDir = join(root, TMP_DIR_NAME)
  if (!truncated) {
    try {
      if (existsSync(tmpDir)) {
        for (const entry of readdirSync(tmpDir)) {
          if (!budgetLeft()) break
          const full = join(tmpDir, entry)
          if (!isOldEnough(full)) continue
          items.push({ path: full, bytes: sizeOf(full), reason: `${TMP_DIR_NAME}/ 临时产物` })
          count += 1
        }
      }
    } catch { /* _tmp 不可读时跳过该块 */ }
  }

  // 2) 规则扫描：递归全树，跳过保护目录；_tmp 子树由上面单独负责。
  const walk = (dir: string): void => {
    if (truncated) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (truncated || !budgetLeft()) return
      const full = join(dir, name)
      let st: Stats
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (PROTECTED_DIRS.has(name.toLowerCase())) continue
        if (dir === root && name === TMP_DIR_NAME) continue // 已单独处理
        walk(full)
        if (state.config.cleanEmptyDirs) {
          try {
            if (readdirSync(full).length === 0 && !full.startsWith(join(root, TMP_DIR_NAME))) {
              emptyDirs.push(full)
            }
          } catch { /* 忽略 */ }
        }
      } else if (st.isFile() || st.isSymbolicLink()) {
        if (state.regexes.some(re => re.test(name)) && isOldEnough(full)) {
          items.push({ path: full, bytes: st.size, reason: `规则命中 (${name})` })
          count += 1
        }
      }
    }
  }
  walk(resolve(root))
  return { items, emptyDirs, truncated }
}

/**
 * 执行一轮收集（dryRun 只收集不删）；delete=true 时真实删除并写日志。
 * roots 缺省用全部已注册工作区。
 */
async function runClean(ctx: PluginContext, options: { dryRun?: boolean; roots?: string[] } = {}): Promise<CleanResult> {
  const config = readConfig(ctx)
  const registry = ctx.workspaceRegistry as { list(): Array<{ id: string; title: string; path: string }> } | undefined
  const allRoots = (registry?.list() ?? []).map(w => w.path).filter(p => typeof p === 'string' && p.length > 0)
  const roots = (options.roots !== undefined && options.roots.length > 0
    ? allRoots.filter(r => options.roots!.includes(r))
    : allRoots)

  const startedAt = new Date().toISOString()
  const result: CleanResult = {
    startedAt,
    dryRun: options.dryRun === true,
    workspaces: roots,
    items: [],
    freedBytes: 0,
    errors: [],
    truncated: false,
  }

  const state: ScanState = {
    cutoffMs: Date.now() - config.minAgeHours * 3_600_000,
    regexes: activeFileRegexes(config),
    config,
    now: Date.now(),
  }

  for (const root of roots) {
    const absRoot = resolve(root)
    try {
      const collected = collectForWorkspace(absRoot, state)
      result.items.push(...collected.items)
      result.truncated = result.truncated || collected.truncated
      if (options.dryRun !== true && config.cleanEmptyDirs) {
        // 空目录自底向上删：先删深层才可能出现新的空目录，简单起见单层即可
        // （下一轮会继续收尾），这里按路径深度倒序尽力而为。
        for (const dir of [...collected.emptyDirs].sort((a, b) => b.length - a.length)) {
          try {
            rmSync(dir, { recursive: false })
            result.freedBytes += 0
          } catch (error: any) {
            result.errors.push(`${dir}: ${String(error?.message ?? error)}`)
          }
        }
      } else if (config.cleanEmptyDirs) {
        result.items.push(...collected.emptyDirs.map(dir => ({ path: dir, bytes: 0, reason: '空目录' })))
      }
    } catch (error: any) {
      result.errors.push(`${root}: ${String(error?.message ?? error)}`)
    }
  }

  if (options.dryRun !== true) {
    for (const item of result.items) {
      try {
        rmSync(item.path, { recursive: true, force: true })
        result.freedBytes += item.bytes
      } catch (error: any) {
        result.errors.push(`${item.path}: ${String(error?.message ?? error)}`)
      }
    }
  }

  if (options.dryRun !== true) await appendLog(result)
  return result
}

// ── 日志 ────────────────────────────────────────────────────────────────────

function logPath(): string {
  return join(dataRoot(), 'log.jsonl')
}

/** 追加一轮运行记录；超长时修剪（重写整个文件，低频操作可接受）。 */
async function appendLog(result: CleanResult): Promise<void> {
  try {
    const file = logPath()
    mkdirSync(dirname(file), { recursive: true })
    const line = JSON.stringify({
      ts: result.startedAt,
      dryRun: result.dryRun,
      workspaces: result.workspaces.length,
      deleted: result.items.length,
      freedBytes: result.freedBytes,
      errors: result.errors.length,
      truncated: result.truncated,
      sample: result.items.slice(0, 10).map(i => i.path),
    }) + '\n'
    appendFileSync(file, line, 'utf-8')
    trimLogIfNeeded(file)
  } catch { /* 日志失败不影响清理本身 */ }
}

function trimLogIfNeeded(file: string): void {
  try {
    const raw = readFileSync(file, 'utf-8')
    const lines = raw.split('\n').filter(l => l.length > 0)
    if (lines.length <= LOG_TRIM_OVER) return
    writeFileSync(file, lines.slice(-LOG_TRIM_KEEP).join('\n') + '\n', 'utf-8')
  } catch { /* 忽略修剪失败 */ }
}

/** 读取最近 N 条日志（新→旧）。 */
function recentLogs(limit = RECENT_LOG_LIMIT): Array<Record<string, unknown>> {
  try {
    const raw = readFileSync(logPath(), 'utf-8')
    const lines = raw.split('\n').filter(l => l.length > 0)
    return lines.slice(-limit).reverse().map((line) => {
      try { return JSON.parse(line) as Record<string, unknown> } catch { return { raw: line } }
    })
  } catch {
    return []
  }
}

/** 最近一次真实清理的时间戳（从日志尾部推导；无日志返回 null）。 */
function lastRealRunAt(): number | null {
  try {
    const raw = readFileSync(logPath(), 'utf-8')
    const lines = raw.split('\n').filter(l => l.length > 0)
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const rec = JSON.parse(lines[i]) as { ts?: string; dryRun?: boolean }
        if (rec.ts !== undefined && rec.dryRun !== true) return Date.parse(rec.ts)
      } catch { /* 跳过坏行 */ }
    }
  } catch { /* 无日志 */ }
  return null
}

// ── 配置读写 + 调度器 ───────────────────────────────────────────────────────

let settingsScope: any

function readConfig(_ctx?: PluginContext): CleanerConfig {
  if (settingsScope !== undefined) {
    try { return normalizeConfig(settingsScope.get()) } catch { /* fallthrough */ }
  }
  return { ...CONFIG_DEFAULTS }
}

/** 解析 HH:mm 为今天该时刻的本地时间戳。非法格式返回 null。 */
function todayAt(timeText: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim())
  if (m === null) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  const d = new Date()
  d.setHours(h, min, 0, 0)
  return d.getTime()
}

const dayKey = (ts: number): string => new Date(ts).toISOString().slice(0, 10)

/**
 * 装配 tmpCleaner host 能力。
 * @param ctx - host 上下文。
 */
export function applyTmpCleaner(ctx: PluginContext): void {
  // 命名空间注册在 host 层，settings.yaml 持久化；重复注册会抛错，先探测。
  try {
    settingsScope = ctx.settings.register('webui-tmp-cleaner', z.object({
      enabled: z.boolean().default(CONFIG_DEFAULTS.enabled),
      scheduleKind: z.string().default(CONFIG_DEFAULTS.scheduleKind),
      dailyTime: z.string().default(CONFIG_DEFAULTS.dailyTime),
      intervalHours: z.number().step(1).min(1).max(720).default(CONFIG_DEFAULTS.intervalHours),
      minAgeHours: z.number().step(1).min(0).max(8760).default(CONFIG_DEFAULTS.minAgeHours),
      cleanOnStart: z.boolean().default(CONFIG_DEFAULTS.cleanOnStart),
      injectPrompt: z.boolean().default(CONFIG_DEFAULTS.injectPrompt),
      extraPatterns: z.array(z.string()),
      cleanEmptyDirs: z.boolean().default(CONFIG_DEFAULTS.cleanEmptyDirs),
    }))
  } catch (error: any) {
    console.log('[tmp-cleaner] settings namespace already registered:', error?.message ?? error)
    settingsScope = undefined
  }

  // 系统提示词注入：关闭时返回空串，renderPrompt 自动丢弃（零占用）。
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'tmp-cleaner',
    order: -35,
    text: () => (readConfig().injectPrompt ? TMP_CONVENTION_INSTRUCTION : ''),
  }), '@dsh-webui/tmp-cleaner: prompt section')

  // ── 调度器：60s tick，daily / interval 双模式 ──
  const bootAt = Date.now()
  let disposed = false
  let running = false

  const tick = async (): Promise<void> => {
    if (disposed || running) return
    const config = readConfig()
    if (!config.enabled) return
    const now = Date.now()
    const last = lastRealRunAt() ?? bootAt
    let due = false
    if (config.scheduleKind === 'interval') {
      due = now - last >= config.intervalHours * 3_600_000
    } else {
      const scheduled = todayAt(config.dailyTime)
      due = scheduled !== null && now >= scheduled && dayKey(last) !== dayKey(now)
    }
    if (!due) return
    running = true
    try {
      await runClean(ctx, { dryRun: false })
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => { void tick() }, 60_000)
  timer.unref?.()

  // 可选启动清理：延迟 15s 避开装配高峰。
  if (readConfig().cleanOnStart) {
    setTimeout(() => {
      if (disposed || running) return
      running = true
      void runClean(ctx, { dryRun: false }).finally(() => { running = false })
    }, 15_000).unref?.()
  }

  ctx.effect(() => () => {
    disposed = true
    clearInterval(timer)
  }, '@dsh-webui/tmp-cleaner: scheduler')

  // ── HTTP API：GET 全量状态；POST 分发 config / run ──
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/webui-tmp-cleaner',
    handler: async (req: any, res: any) => {
      const respond = (status: number, payload: any) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload))
      }
      const readBody = (): Promise<any> => new Promise((resolveBody) => {
        let data = ''
        req.on('data', (chunk: any) => { data += chunk })
        req.on('end', () => {
          try { resolveBody(JSON.parse(data || '{}')) } catch { resolveBody(null) }
        })
        req.on('error', () => resolveBody(null))
      })
      try {
        if (req.method === 'POST') {
          const body = await readBody()
          if (!body || typeof body.action !== 'string') return respond(400, { ok: false, error: '缺少 action' })

          if (body.action === 'config') {
            const patch = (body.patch && typeof body.patch === 'object') ? body.patch : {}
            const next = normalizeConfig({ ...readConfig(), ...patch })
            if (settingsScope !== undefined) {
              await settingsScope.update(next)
            }
            return respond(200, { ok: true, config: next })
          }

          if (body.action === 'run' || body.action === 'preview') {
            const dryRun = body.action === 'preview' ? true : body.dryRun !== false
            const roots = Array.isArray(body.roots) ? body.roots.filter((r: unknown): r is string => typeof r === 'string') : undefined
            const result = await runClean(ctx, { dryRun, roots })
            return respond(200, {
              ok: true,
              result: {
                ...result,
                items: result.items.slice(0, 300), // 响应体截断，防超大列表
              },
              totalItems: result.items.length,
            })
          }

          return respond(400, { ok: false, error: `未知 action：${body.action}` })
        }

        // GET：配置 + 最近日志 + 下次预计触发时间。
        const config = readConfig()
        const last = lastRealRunAt()
        let nextDue: string | null = null
        if (config.enabled) {
          const base = last ?? bootAt
          if (config.scheduleKind === 'interval') {
            nextDue = new Date(base + config.intervalHours * 3_600_000).toISOString()
          } else {
            const scheduled = todayAt(config.dailyTime)
            if (scheduled !== null) {
              // 今天计划时刻之后还没跑过 → 下次就是今天；否则顺延到明天。
              const ranAfterScheduledToday = last !== null && last >= scheduled
              nextDue = new Date(
                !ranAfterScheduledToday && Date.now() < scheduled ? scheduled : scheduled + 86_400_000,
              ).toISOString()
            }
          }
        }
        return respond(200, { ok: true, config, recent: recentLogs(), lastRunAt: last !== null ? new Date(last).toISOString() : null, nextDue })
      } catch (error: any) {
        respond(500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), '@dsh-webui/tmp-cleaner: route')

  // ── agent 工具：webui_tmp_clean ──
  ctx.tools.register(defineTool({
    name: 'webui_tmp_clean',
    description: [
      '清理各工作区的临时垃圾：工作区根下 _tmp/ 文件夹的全部到龄内容（AI 临时脚本的约定归宿），',
      '以及 *.tmp/*.bak/*.log/.DS_Store/Thumbs.db 等内置规则命中的文件。',
      'action=preview 只列出将清理的清单不动任何文件；action=run 真实删除并记录日志。',
      '受最小文件年龄保护（默认 24 小时内的新文件不会动）。需要自定义规则或改触发时间请说明，由用户在设置里调整。',
    ].join(''),
    parameters: {
      action: { type: 'string', enum: ['preview', 'run'], required: true, description: 'preview=预览待清理清单；run=执行删除。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string' },
          workspaces: { type: 'array', items: { type: 'string' } },
          count: { type: 'number', required: true },
          freedBytes: { type: 'number' },
          truncated: { type: 'boolean' },
          sample: { type: 'array', items: { type: 'string' } },
          errors: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args: unknown, value: any) => [{
        type: 'text',
        text: value.mode === 'run'
          ? `已清理 ${value.count} 个条目（释放 ${humanBytes(value.freedBytes)}）${value.truncated ? '（达到单轮上限被截断）' : ''}。样例：\n${(value.sample ?? []).map((s: string) => `- ${s}`).join('\n') || '(无)'}`
          : `预览：共 ${value.count} 个待清理条目${value.truncated ? '（截断展示）' : ''}。样例：\n${(value.sample ?? []).map((s: string) => `- ${s}`).join('\n') || '(无)'}`,
      }],
    },
    async execute(args: unknown) {
      const params = args as Record<string, unknown>
      const action = params.action === 'run' ? 'run' : 'preview'
      const result = await runClean(ctx, { dryRun: action === 'preview' })
      return {
        mode: action,
        workspaces: result.workspaces,
        count: result.items.length,
        freedBytes: result.freedBytes,
        truncated: result.truncated,
        sample: result.items.slice(0, 50).map(i => i.path),
        errors: result.errors.slice(0, 10),
      }
    },
    presentCall: () => ({ card: 'generic', title: '工作区临时垃圾清理', kind: 'other', rawInput: null }),
  }))
}

/** 字节数人性化（工具输出用）。 */
function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u += 1
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`
}
