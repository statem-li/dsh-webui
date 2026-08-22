/**
 * webui — PlanWeave 模块（host 半身）。
 *
 * 把 PlanWeave 的「计划 → 任务图 → 认领/执行/评审/反馈」循环接到 DSH：
 *  - settings 命名空间 `planweave`：默认项目名 + 执行模型 + 每轮步数。
 *  - 模型工具：planweave_init / planweave_status / planweave_run（agent 可在对话中直接调用）。
 *  - HTTP API：GET /api/planweave/status（loopback，供 client 半身面板轮询）。
 *
 * 核心引擎复用 @planweave-ai/runtime；执行器用 ctx.llm（Phase 0 的 DshExecutorAdapter）。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, dirname, resolve, sep } from 'node:path'
import { PlanweaveEngine } from './engine.js'
import { registerPlanweaveSkillsTool } from './skills.js'
import { EXAMPLE_MANIFEST, EXAMPLE_PROMPT_FILES } from './example-package.js'
import {
  removeTaskNode,
  addTaskNode,
  setTaskDependencies,
  addBlock,
  removeBlock,
  updateBlockPrompt,
  updateBlockPlanning,
  updateTaskPrompt,
  updateTaskAcceptance,
  updateTaskTitle,
  updateTaskExecutor,
  builtinExecutorNames,
  loadPackage,
  runDoctor,
  searchProject,
  getStatistics,
  getTodoGroups,
  validateGraphQuality,
  undoDesktopPlanGraphCommand,
  redoDesktopPlanGraphCommand,
  listProjects,
  initManagedProject,
} from '@planweave-ai/runtime'
import { startAutoRunBg, pauseAutoRunBg, resumeAutoRunBg, stopAutoRunBg, getAutoRunBgState, latestAutoRunBg } from './autorun.js'
import { spawn } from 'node:child_process'
import {
  executeImplementation,
  executeReview,
  executeFeedback,
  executeImplementationSubagent,
  executeReviewSubagent,
  executeFeedbackSubagent,
  defaultSubagentProvider,
  type DshLlm,
  type ExecutorModel,
  type ExecLike,
} from './executor.js'

const SETTINGS_NS = settingsNamespace('planweave')
const ROUTE_PREFIX = '/api/planweave'

interface PlanweaveConfig {
  projectName: string
  provider: string
  model: string
  maxSteps: number
}

/** settings schema（schemastery）。 */
const configSchema = z.object({
  projectName: z.string().default('default'),
  provider: z.string().default(''),
  model: z.string().default(''),
  maxSteps: z.number().step(1).min(1).max(20).default(5),
})

// ── 协调循环（claim → 执行 → submit，重复 maxSteps 次） ──

export interface RunEnv {
  ctx: Context
  exec: ExecLike | null
  /** 仅 llm 直跑路径需要；subagent 路径为 null（无需配置执行模型）。 */
  llm: DshLlm | null
  model: ExecutorModel | null
  provider: string | null
}

/** 有 subagent provider 且当前有 agent 上下文时，走完整 agent 路径，否则 llm 直跑。 */
function useSubagent(env: RunEnv): boolean {
  return env.provider !== null && env.exec?.agent !== undefined && env.llm !== null && env.model !== null
    ? true
    : env.provider !== null && env.exec?.agent !== undefined
}

/** 执行单个已认领项（block/feedback），完成提交并返回一行事件描述。 */
export async function executeClaimStep(
  engine: PlanweaveEngine,
  env: RunEnv,
  label: string,
  claim: Extract<Awaited<ReturnType<typeof engine.claim>>, { kind: 'block' | 'feedback' }>,
): Promise<string> {
  if (claim.kind === 'block') {
    const prompt = await engine.prompt(claim.ref)
    if (claim.blockType === 'implementation') {
      const { reportPath } = useSubagent(env)
        ? await executeImplementationSubagent(env.ctx, env.exec!, env.provider!, prompt, claim.ref)
        : await executeImplementation(env.llm!, env.model!, prompt, claim.ref)
      const submit = await engine.submitResult(claim.ref, reportPath)
      return `${label} 实现 ${claim.ref} → ${submit.status}（${submit.runId}）`
    }
    const { resultPath, outcome } = useSubagent(env)
      ? await executeReviewSubagent(env.ctx, env.exec!, env.provider!, prompt, claim.ref, claim.taskId)
      : await executeReview(env.llm!, env.model!, prompt, claim.ref, claim.taskId)
    const submit = await engine.submitReview(claim.ref, resultPath)
    return `${label} 评审 ${claim.ref} → ${outcome.verdict}（${submit.reviewAttemptId}${submit.feedbackId ? '，生成反馈 ' + submit.feedbackId : ''}）`
  }
  const { reportPath } = useSubagent(env)
    ? await executeFeedbackSubagent(env.ctx, env.exec!, env.provider!, claim.content, claim.sourceReviewBlockRef)
    : await executeFeedback(env.llm!, env.model!, claim.content, claim.sourceReviewBlockRef)
  const submit = await engine.submitFeedback(reportPath)
  return `${label} 反馈 ${claim.feedbackId} → ${submit.status}（${submit.submissionId}）`
}

async function runCoordination(
  engine: PlanweaveEngine,
  env: RunEnv,
  maxSteps: number,
): Promise<string> {
  const lines: string[] = []
  lines.push(`执行方式：${useSubagent(env) ? `subagent(${env.provider})` : 'llm 直跑'}`)
  for (let i = 0; i < maxSteps; i += 1) {
    const claim = await engine.claim()
    if (claim.kind === 'none') {
      lines.push(`第 ${i + 1} 步：无更多可认领项（${claim.reason ?? '计划已完成或无可就绪项'}）`)
      break
    }
    if (claim.kind === 'blocked') {
      lines.push(`阻塞：${claim.reason}${claim.ref ? `（${claim.ref}）` : ''}`)
      break
    }
    if (claim.kind === 'batch') {
      lines.push(`并行批次：${claim.refs.join(', ')}（逐项推进）`)
      for (const ref of claim.refs) {
        const sub = await engine.claimRef(ref)
        if (sub.kind !== 'block' && sub.kind !== 'feedback') {
          lines.push(`并行项 ${ref} 无法认领（${sub.kind}）`)
          continue
        }
        lines.push(await executeClaimStep(engine, env, `[并行]`, sub))
      }
      continue
    }
    if (claim.kind !== 'block' && claim.kind !== 'feedback') continue
    lines.push(await executeClaimStep(engine, env, `[${i + 1}]`, claim))
  }
  return lines.join('\n')
}

// ── 工具注册 ──

function readConfig(ctx: Context): PlanweaveConfig {
  let raw: Partial<PlanweaveConfig> | undefined
  try {
    raw = ctx.settings.get(SETTINGS_NS) as Partial<PlanweaveConfig> | undefined
  } catch (error) {
    // settings 命名空间读取失败不致命：回退环境变量与默认值。
    console.warn('[planweave] settings namespace unreadable:', error instanceof Error ? error.message : String(error))
  }
  return {
    projectName: typeof raw?.projectName === 'string' && raw.projectName !== '' ? raw.projectName : 'default',
    provider: typeof raw?.provider === 'string' && raw.provider !== ''
      ? raw.provider
      : (process.env.PLANWEAVE_EXEC_PROVIDER ?? ''),
    model: typeof raw?.model === 'string' && raw.model !== ''
      ? raw.model
      : (process.env.PLANWEAVE_EXEC_MODEL ?? ''),
    maxSteps: typeof raw?.maxSteps === 'number' && Number.isFinite(raw.maxSteps)
      ? Math.min(20, Math.max(1, Math.round(raw.maxSteps)))
      : 5,
  }
}

function resolveLlm(ctx: Context): { llm: DshLlm; model: ExecutorModel } {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('llm 服务不可用')
  const config = readConfig(ctx)
  if (config.provider === '' || config.model === '') {
    throw new Error('未配置 PlanWeave 执行模型：请在「设置 → 插件 → 可配置 → PlanWeave」里填 Provider 与 Model 并保存；也可用环境变量 PLANWEAVE_EXEC_PROVIDER / PLANWEAVE_EXEC_MODEL 兜底')
  }
  return { llm: llm as DshLlm, model: { provider: config.provider, model: config.model } }
}

/** 注册全部 PlanWeave 工具，返回合并 disposer。 */
function registerTools(ctx: Context): () => void {
  const disposers: Array<() => void> = []

  disposers.push(ctx.tools.register(defineTool({
    name: 'planweave_init',
    description: '初始化（或打开）一个 PlanWeave 计划项目：把它作为本地任务图来跟踪实现/评审进度。首次调用会创建一个空计划，之后可复用同名项目。',
    parameters: {
      projectName: { type: 'string', description: '项目名（用于派生稳定的项目目录；默认 default）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const config = readConfig(ctx)
      const name = typeof args.projectName === 'string' && args.projectName !== '' ? args.projectName : config.projectName
      const engine = await PlanweaveEngine.open(name)
      const paths = await engine.paths()
      return `PlanWeave 项目已就绪：projectId=${engine.projectId}，packageDir=${paths.packageDir}。可用 planweave_status 查看、planweave_run 推进。`
    },
    presentCall: args => ({ card: 'generic' as const, kind: 'other' as const, title: `初始化 PlanWeave：${String(args.projectName ?? '')}`, rawInput: args }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'planweave_status',
    description: '查看 PlanWeave 计划项目的执行状态：任务/块状态、当前可认领项、反馈与计数。',
    parameters: {
      projectName: { type: 'string', description: '项目名（默认取设置里的 projectName）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const config = readConfig(ctx)
      const name = typeof args.projectName === 'string' && args.projectName !== '' ? args.projectName : config.projectName
      const engine = await PlanweaveEngine.open(name)
      const status = await engine.status()
      const blocks = status.blocks.map(b => `${b.ref}:${b.status}`).join(', ')
      const next = status.nextClaimable.join(', ')
      return [
        `任务：${status.taskTotal} 个（${status.counts.tasks.implemented} 已完成）`,
        `块：${status.blockTotal} 个（${status.counts.blocks.completed} 已完成 / ${status.counts.blocks.in_progress} 进行中）`,
        `当前可认领：${next === '' ? '无' : next}`,
        blocks === '' ? '' : `块状态：${blocks}`,
      ].filter(Boolean).join('\n')
    },
    presentCall: () => ({ card: 'generic' as const, kind: 'other' as const, title: '查看 PlanWeave 状态', rawInput: null }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'planweave_run',
    description: '推进 PlanWeave 计划：按就绪顺序认领并执行实现/评审块、处理评审反馈，最多循环若干步。执行用设置里配置的模型。',
    parameters: {
      projectName: { type: 'string', description: '项目名（默认取设置里的 projectName）。' },
      steps: { type: 'integer', description: '本次最多推进的步数（默认取设置里的 maxSteps）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const config = readConfig(ctx)
      const name = typeof args.projectName === 'string' && args.projectName !== '' ? args.projectName : config.projectName
      const stepsRaw = typeof args.steps === 'number' ? args.steps : Number(args.steps)
      const maxSteps = Number.isFinite(stepsRaw) && stepsRaw > 0
        ? Math.min(20, Math.max(1, Math.round(stepsRaw)))
        : config.maxSteps
      const { llm, model } = resolveLlm(ctx)
      const engine = await PlanweaveEngine.open(name)
      const env: RunEnv = {
        ctx,
        exec: exec as ExecLike | null,
        llm,
        model,
        provider: defaultSubagentProvider(ctx),
      }
      const summary = await runCoordination(engine, env, maxSteps)
      const status = await engine.status()
      return summary + `\n\n当前状态：${status.counts.tasks.implemented}/${status.taskTotal} 任务完成，${status.counts.blocks.completed}/${status.blockTotal} 块完成。`
    },
    presentCall: () => ({ card: 'generic' as const, kind: 'other' as const, title: '推进 PlanWeave 计划', rawInput: null }),
  })))

  return () => { for (const dispose of disposers) dispose() }
}

// ── HTTP API（loopback，供 client 半身） ──

function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function loopbackAllowed(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = (req.headers.host ?? '').trim().toLowerCase()
  return host === 'localhost' || host.startsWith('localhost:') || host === '127.0.0.1' || host.startsWith('127.0.0.1:') || host === '::1'
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(value))
}

async function handleStatus(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const config = readConfig(ctx)
    const url = new URL(req.url ?? '/', 'http://localhost')
    const name = url.searchParams.get('projectName') ?? config.projectName
    const engine = await PlanweaveEngine.open(name)
    const status = await engine.status()
    json(res, 200, { ok: true, projectId: engine.projectId, status })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** 任务图视图（节点/依赖 × 运行状态），供 client 渲染 SVG 任务图。 */
async function handleGraph(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const config = readConfig(ctx)
    const url = new URL(req.url ?? '/', 'http://localhost')
    const name = url.searchParams.get('projectName') ?? config.projectName
    const engine = await PlanweaveEngine.open(name)
    const graph = await engine.graph()
    json(res, 200, { ok: true, projectId: engine.projectId, graph })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

// ── 最近产物时间线（GET /records） ──

type ArtifactKind = 'run' | 'review' | 'feedback' | 'submission'

/** 时间线单条记录（GET /records 响应元素）。 */
interface ArtifactRecord {
  id: string
  kind: ArtifactKind
  ref: string
  taskId: string
  summary: string
  at: string
  dir: string
}

/** 扫描阶段的候选条目：摘要延后到排序截断之后才读，避免为尾部记录白读文件。 */
interface ArtifactHit {
  kind: ArtifactKind
  id: string
  ref: string
  taskId: string
  dir: string
  mtimeMs: number
}

const RECORDS_DEFAULT_LIMIT = 30
const RECORDS_MAX_LIMIT = 100

/** limit 参数解析：默认 30、上限 100、非法回退默认。 */
function parseRecordsLimit(raw: string | null): number {
  if (raw === null) return RECORDS_DEFAULT_LIMIT
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return RECORDS_DEFAULT_LIMIT
  return Math.min(RECORDS_MAX_LIMIT, Math.round(n))
}

/** 摘要整理：多行并成单行、去首尾空白、截断到 160 字符。 */
function toRecordSummary(text: string): string {
  return text.replace(/\r?\n/g, ' ').trim().slice(0, 160)
}

/** 列出 parent 下的子目录名；父目录不存在/不可读时返回空数组（容错）。 */
async function listSubDirs(parent: string): Promise<string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch {
    return []
  }
}

/** 读 UTF-8 文本文件；任何失败返回 null（容错）。 */
async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** 从 JSON 文本提取一个字符串字段；解析失败或字段缺失返回 null。 */
function jsonTextField(text: string, field: string): string | null {
  try {
    const value = (JSON.parse(text) as Record<string, unknown>)[field]
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

/**
 * 扫描 resultsDir 全部磁盘产物，收集时间线候选：
 *  - `<taskId>/blocks/<blockId>/runs/RUN-*` → run（ref=`<taskId>#<blockId>`）
 *  - `<taskId>/reviews/<blockId>/attempts/REV-*` → review（ref 同上）
 *  - `<taskId>/feedback/FE-*` → feedback（ref 取其 feedback.json 的 sourceReviewBlockRef）
 *  - `<taskId>/feedback/FE-x/submissions/FS-x` → submission（ref 复用所属 FE 的）
 * stat 失败的目录跳过；feedback.json 读不出 sourceReviewBlockRef 时该 FE 连同其 submissions 一起跳过。
 */
async function collectArtifactHits(resultsDir: string): Promise<ArtifactHit[]> {
  const hits: ArtifactHit[] = []
  const add = async (
    kind: ArtifactKind,
    id: string,
    ref: string,
    taskId: string,
    dir: string,
  ): Promise<void> => {
    try {
      const info = await stat(dir)
      if (!info.isDirectory()) return
      hits.push({ kind, id, ref, taskId, dir, mtimeMs: info.mtimeMs })
    } catch {
      // 目录刚被清理等竞态——跳过该条。
    }
  }

  for (const taskId of await listSubDirs(resultsDir)) {
    // 实现与反馈修复的执行产物。
    for (const blockId of await listSubDirs(join(resultsDir, taskId, 'blocks'))) {
      const runsRoot = join(resultsDir, taskId, 'blocks', blockId, 'runs')
      for (const runId of await listSubDirs(runsRoot)) {
        if (!runId.startsWith('RUN-')) continue
        await add('run', runId, `${taskId}#${blockId}`, taskId, join(runsRoot, runId))
      }
    }
    // 评审尝试产物。
    for (const blockId of await listSubDirs(join(resultsDir, taskId, 'reviews'))) {
      const attemptsRoot = join(resultsDir, taskId, 'reviews', blockId, 'attempts')
      for (const attemptId of await listSubDirs(attemptsRoot)) {
        if (!attemptId.startsWith('REV-')) continue
        await add('review', attemptId, `${taskId}#${blockId}`, taskId, join(attemptsRoot, attemptId))
      }
    }
    // 反馈信封与其修复提交。
    for (const feedbackId of await listSubDirs(join(resultsDir, taskId, 'feedback'))) {
      if (!feedbackId.startsWith('FE-')) continue
      const feedbackDir = join(resultsDir, taskId, 'feedback', feedbackId)
      const raw = await readTextFile(join(feedbackDir, 'feedback.json'))
      const sourceRef = raw === null ? null : jsonTextField(raw, 'sourceReviewBlockRef')
      if (sourceRef === null || sourceRef === '') continue
      await add('feedback', feedbackId, sourceRef, taskId, feedbackDir)
      for (const submissionId of await listSubDirs(join(feedbackDir, 'submissions'))) {
        if (!submissionId.startsWith('FS-')) continue
        await add('submission', submissionId, sourceRef, taskId, join(feedbackDir, 'submissions', submissionId))
      }
    }
  }
  return hits
}

/** 组装时间线：全部候选按目录 mtime 降序取前 limit 条，再逐条填 summary（单条损坏跳过）。 */
async function collectRecentRecords(resultsDir: string, limit: number): Promise<ArtifactRecord[]> {
  const hits = await collectArtifactHits(resultsDir)
  hits.sort((a, b) => b.mtimeMs - a.mtimeMs || a.dir.localeCompare(b.dir))
  const records: ArtifactRecord[] = []
  for (const hit of hits.slice(0, limit)) {
    let summary: string | null = null
    if (hit.kind === 'run' || hit.kind === 'submission') {
      const text = await readTextFile(join(hit.dir, 'report.md'))
      summary = text === null ? null : toRecordSummary(text)
    } else if (hit.kind === 'review') {
      const text = await readTextFile(join(hit.dir, 'review-result.json'))
      // content 字段缺失/JSON 损坏时回退文件原文片段。
      summary = text === null ? null : toRecordSummary(jsonTextField(text, 'content') ?? text)
    } else {
      const text = await readTextFile(join(hit.dir, 'feedback.json'))
      summary = text === null ? null : toRecordSummary(jsonTextField(text, 'content') ?? '')
    }
    if (summary === null) continue
    records.push({
      id: hit.id,
      kind: hit.kind,
      ref: hit.ref,
      taskId: hit.taskId,
      summary,
      at: new Date(hit.mtimeMs).toISOString(),
      dir: hit.dir,
    })
  }
  return records
}

/** 全局最近产物时间线（run/review/feedback/submission 按 mtime 混排），供 client 渲染时间线。 */
async function handleRecords(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const config = readConfig(ctx)
    const url = new URL(req.url ?? '/', 'http://localhost')
    const name = url.searchParams.get('projectName') ?? config.projectName
    const limit = parseRecordsLimit(url.searchParams.get('limit'))
    const engine = await PlanweaveEngine.open(name)
    const paths = await engine.paths()
    const records = await collectRecentRecords(paths.resultsDir, limit)
    json(res, 200, { ok: true, records })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 一键播种示例计划（POST /seed）：把内置六任务示例包写入项目 packageDir。
 * 已有非空计划时默认拒绝，仅 body.force === true 才覆盖（破坏性操作需显式确认）。
 */
async function handleSeed(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const config = readConfig(ctx)
    const name = typeof body.projectName === 'string' && body.projectName !== '' ? body.projectName : config.projectName
    const force = body.force === true
    const engine = await PlanweaveEngine.open(name)
    const paths = await engine.paths()
    if (paths.packageDir === undefined || paths.packageDir === '') {
      throw new Error('无法定位 packageDir')
    }
    // 空计划判定：读现有 manifest 的 nodes 数。
    let existingNodes = -1
    try {
      const existing = await engine.graph()
      existingNodes = existing.nodes.length
    } catch {
      existingNodes = 0 // 读不出图视为空
    }
    if (existingNodes > 0 && !force) {
      json(res, 409, { ok: false, error: `项目已有 ${String(existingNodes)} 个任务；传 force:true 才会覆盖` })
      return
    }
    writeFileSync(join(paths.packageDir, 'manifest.json'), `${JSON.stringify(EXAMPLE_MANIFEST, null, 2)}\n`, 'utf8')
    for (const file of EXAMPLE_PROMPT_FILES) {
      const target = join(paths.packageDir, file.path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.content, 'utf8')
    }
    const status = await engine.status()
    json(res, 200, { ok: true, taskTotal: status.taskTotal, blockTotal: status.blockTotal })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 供应商/模型枚举（GET /providers）：读 DSH 内置 `llm-pi-ai` 命名空间的
 * providers 配置（与 webui_sync_reasoning 同一数据源），供设置卡把
 * Provider/Model 渲染成下拉选择而不是手填。
 */
async function handleProviders(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    interface ProviderModelLike { id?: unknown; name?: unknown }
    interface ProviderEntryLike { displayName?: unknown; models?: ProviderModelLike[] }
    let raw: unknown
    try {
      raw = ctx.settings.get(settingsNamespace('llm-pi-ai'))
    } catch {
      raw = undefined
    }
    const providersMap = (raw as { providers?: Record<string, ProviderEntryLike> } | undefined)?.providers ?? {}
    const providers = Object.entries(providersMap).map(([id, entry]) => ({
      id,
      displayName: typeof entry?.displayName === 'string' && entry.displayName !== '' ? entry.displayName : id,
      models: (Array.isArray(entry?.models) ? entry.models : [])
        .map(m => typeof m?.id === 'string' && m.id !== '' ? m.id : (typeof m?.name === 'string' ? m.name : ''))
        .filter(s => s !== ''),
    }))
    json(res, 200, { ok: true, providers })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 删除任务节点（POST /tasks/remove）：body { taskId }。走 runtime 的
 * removeTaskNode（图编辑事务，带诊断）；进行中/被依赖等非法删除会以
 * ok:false + 诊断文本返回，由前端展示。
 */
async function handleRemoveTask(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const config = readConfig(ctx)
    const name = typeof body.projectName === 'string' && body.projectName !== '' ? body.projectName : config.projectName
    const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : ''
    if (taskId === '') throw new Error('taskId 不能为空')
    const engine = await PlanweaveEngine.open(name)
    const result = await removeTaskNode(engine.root, taskId)
    if (!result.ok || result.diagnostics.length > 0) {
      json(res, 409, {
        ok: false,
        error: result.diagnostics.map(d => d.message).join('; ') || `任务 ${taskId} 无法删除`,
      })
      return
    }
    const status = await engine.status()
    json(res, 200, {
      ok: true,
      removed: taskId,
      affectedTasks: result.affectedTasks,
      taskTotal: status.taskTotal,
      blockTotal: status.blockTotal,
    })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 新建任务节点（POST /tasks）：body { title, promptMarkdown?, acceptance?,
 * withReview? }。走 runtime 的 addTaskNode 图编辑事务；prompt 缺省给模板。
 */
async function handleCreateTask(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const config = readConfig(ctx)
    const name = typeof body.projectName === 'string' && body.projectName !== '' ? body.projectName : config.projectName
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (title === '') throw new Error('任务标题不能为空')
    const acceptanceRaw = Array.isArray(body.acceptance) ? body.acceptance : []
    const acceptance = acceptanceRaw.map(a => typeof a === 'string' ? a.trim() : '').filter(s => s !== '')
    const promptMarkdown = typeof body.promptMarkdown === 'string' && body.promptMarkdown.trim() !== ''
      ? body.promptMarkdown
      : `# ${title}\n\n（补充本任务的执行提示词：目标、边界与产出要求）`
    const withReview = body.withReview === true
    const engine = await PlanweaveEngine.open(name)
    const result = await addTaskNode(engine.root, {
      title,
      promptMarkdown,
      ...(acceptance.length > 0 ? { acceptance } : {}),
      blockTypes: withReview ? ['implementation', 'review'] : ['implementation'],
    })
    if (!result.ok || result.diagnostics.length > 0) {
      json(res, 409, { ok: false, error: result.diagnostics.map(d => d.message).join('; ') || '新建任务失败' })
      return
    }
    const status = await engine.status()
    json(res, 200, { ok: true, affectedTasks: result.affectedTasks, taskTotal: status.taskTotal, blockTotal: status.blockTotal })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 设置任务上游依赖（POST /tasks/deps）：body { taskId, dependsOn[] }。
 * 整表设置（以本次提交为准），走 runtime 的 setTaskDependencies 事务。
 */
async function handleSetDeps(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const config = readConfig(ctx)
    const name = typeof body.projectName === 'string' && body.projectName !== '' ? body.projectName : config.projectName
    const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : ''
    const dependsOn = (Array.isArray(body.dependsOn) ? body.dependsOn : [])
      .map(d => typeof d === 'string' ? d.trim() : '').filter(s => s !== '')
    if (taskId === '') throw new Error('taskId 不能为空')
    if (dependsOn.includes(taskId)) throw new Error('任务不能依赖自己')
    const engine = await PlanweaveEngine.open(name)
    const result = await setTaskDependencies({ projectRoot: engine.root, taskId, dependsOn })
    if (!result.ok || result.diagnostics.length > 0) {
      json(res, 409, { ok: false, error: result.diagnostics.map(d => d.message).join('; ') || '依赖设置失败' })
      return
    }
    json(res, 200, { ok: true, taskId, dependsOn })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

// ── Auto Run（后台推进）与产物内容 ──

/** POST /autorun/start：启动后台自动推进（HTTP 无 agent 上下文 → llm 直跑）。 */
async function handleAutoRunStart(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const config = readConfig(ctx)
    const name = typeof body.projectName === 'string' && body.projectName !== '' ? body.projectName : config.projectName
    const stepsRaw = typeof body.maxSteps === 'number' ? body.maxSteps : Number(body.maxSteps)
    const maxSteps = Number.isFinite(stepsRaw) && stepsRaw > 0 ? Math.min(200, Math.round(stepsRaw)) : Math.min(60, config.maxSteps * 6)
    // 已有未完结的 run 则拒绝重复启动（前端先 stop 或等完成）。
    const existing = latestAutoRunBg(name)
    if (existing !== undefined && (existing.status === 'running' || existing.status === 'paused')) {
      json(res, 409, { ok: false, error: `已有进行中的 Auto Run（${existing.id}，${existing.status}）`, snapshot: existing })
      return
    }
    const { llm, model } = resolveLlm(ctx)
    const engine = await PlanweaveEngine.open(name)
    const env: RunEnv = { ctx, exec: null, llm, model, provider: defaultSubagentProvider(ctx) }
    const snapshot = startAutoRunBg({ projectName: name, maxSteps, engine, env })
    json(res, 200, { ok: true, snapshot })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** POST /autorun/control：body { action: 'pause'|'resume'|'stop', id }。 */
async function handleAutoRunControl(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const id = typeof body.id === 'string' ? body.id : ''
    if (id === '') throw new Error('id 不能为空')
    let snapshot
    if (body.action === 'pause') snapshot = pauseAutoRunBg(id)
    else if (body.action === 'resume') snapshot = resumeAutoRunBg(id)
    else if (body.action === 'stop') snapshot = stopAutoRunBg(id)
    else throw new Error(`未知操作：${String(body.action)}`)
    if (snapshot === undefined) throw new Error('Auto Run 不存在')
    json(res, 200, { ok: true, snapshot })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** GET /autorun/state?id=…；不带 id 时返回该项目最近一次。 */
async function handleAutoRunState(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const config = readConfig(ctx)
    const name = url.searchParams.get('projectName') ?? config.projectName
    const id = url.searchParams.get('id')
    const snapshot = (id !== null && id !== '' ? getAutoRunBgState(id) : undefined) ?? latestAutoRunBg(name)
    json(res, 200, { ok: true, snapshot: snapshot ?? null })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * GET /record-content?dir=<abs>&file=report.md|review-result.json|feedback.json：
 * 读取单个产物文件文本。安全：dir 必须位于当前项目 resultsDir 内（containment）。
 */
async function handleRecordContent(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const config = readConfig(ctx)
    const name = url.searchParams.get('projectName') ?? config.projectName
    const dir = url.searchParams.get('dir') ?? ''
    const file = url.searchParams.get('file') ?? 'report.md'
    if (dir === '') throw new Error('dir 不能为空')
    if (!/^[A-Za-z0-9._-]+$/.test(file)) throw new Error('file 名不合法')
    const engine = await PlanweaveEngine.open(name)
    const paths = await engine.paths()
    const resolvedDir = resolve(dir)
    const resultsRoot = resolve(paths.resultsDir)
    if (!resolvedDir.startsWith(resultsRoot + sep) && resolvedDir !== resultsRoot) {
      json(res, 403, { ok: false, error: '路径越出项目产物目录' })
      return
    }
    const target = join(resolvedDir, file)
    const content = await readFile(target, 'utf8')
    json(res, 200, { ok: true, content, file })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** 在文件管理器中打开产物目录（POST /reveal { dir }，含 containment 校验）。 */
async function handleReveal(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const config = readConfig(ctx)
    const name = typeof body.projectName === 'string' && body.projectName !== '' ? body.projectName : config.projectName
    const dir = typeof body.dir === 'string' ? body.dir : ''
    if (dir === '') throw new Error('dir 不能为空')
    const engine = await PlanweaveEngine.open(name)
    const paths = await engine.paths()
    const resolvedDir = resolve(dir)
    const resultsRoot = resolve(paths.resultsDir)
    if (!resolvedDir.startsWith(resultsRoot + sep)) {
      json(res, 403, { ok: false, error: '路径越出项目产物目录' })
      return
    }
    if (process.platform === 'win32') spawn('explorer.exe', [resolvedDir])
    else if (process.platform === 'darwin') spawn('open', [resolvedDir])
    else spawn('xdg-open', [resolvedDir])
    json(res, 200, { ok: true })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * 统一图编辑事务（POST /edit）：body { op, ...params }。
 * op ∈ block.add | block.remove | block.prompt | block.planning |
 *      task.prompt | task.acceptance | task.title | task.executor
 */
async function handleEdit(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  const str = (v: unknown): string => typeof v === 'string' ? v : ''
  try {
    const body = await readBody(req)
    const config = readConfig(ctx)
    const name = typeof body.projectName === 'string' && body.projectName !== '' ? body.projectName : config.projectName
    const engine = await PlanweaveEngine.open(name)
    const op = str(body.op)
    switch (op) {
      case 'block.add': {
        const type = body.type === 'review' ? 'review' as const : 'implementation' as const
        const title = str(body.title).trim()
        if (title === '') throw new Error('块标题不能为空')
        const promptMarkdown = str(body.promptMarkdown) !== '' ? str(body.promptMarkdown) : `# ${title}\n\n（补充本块的执行提示词）`
        const dependsOn = Array.isArray(body.dependsOn) ? body.dependsOn.filter(d => typeof d === 'string') : undefined
        await addBlock(engine.root, {
          taskId: str(body.taskId),
          type,
          title,
          promptMarkdown,
          ...(dependsOn !== undefined ? { dependsOn } : {}),
        })
        break
      }
      case 'block.remove':
        await removeBlock(engine.root, str(body.ref))
        break
      case 'block.prompt':
        await updateBlockPrompt(engine.root, str(body.ref), str(body.markdown))
        break
      case 'block.planning': {
        const fields: { reviewRequired?: boolean; maxFeedbackCycles?: number } = {}
        if (typeof body.reviewRequired === 'boolean') fields.reviewRequired = body.reviewRequired
        if (Number.isFinite(Number(body.maxFeedbackCycles))) fields.maxFeedbackCycles = Math.max(0, Math.round(Number(body.maxFeedbackCycles)))
        await updateBlockPlanning(engine.root, str(body.ref), fields)
        break
      }
      case 'task.prompt':
        await updateTaskPrompt(engine.root, str(body.taskId), str(body.markdown))
        break
      case 'task.acceptance': {
        const acceptance = Array.isArray(body.acceptance)
          ? body.acceptance.map(a => typeof a === 'string' ? a.trim() : '').filter(s => s !== '')
          : []
        if (acceptance.length === 0) throw new Error('至少需要一条验收标准')
        await updateTaskAcceptance(engine.root, str(body.taskId), acceptance)
        break
      }
      case 'task.title':
        await updateTaskTitle(engine.root, str(body.taskId), str(body.title).trim())
        break
      case 'task.executor':
        await updateTaskExecutor(engine.root, str(body.taskId), str(body.executor) !== '' ? str(body.executor) : null)
        break
      default:
        throw new Error(`未知编辑操作：${op}`)
    }
    const status = await engine.status()
    json(res, 200, { ok: true, taskTotal: status.taskTotal, blockTotal: status.blockTotal })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** GET /task-source?id=<taskId 或 blockRef>：读任务/块的源提示词 markdown（packageDir containment）。 */
async function handleTaskSource(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const config = readConfig(ctx)
    const name = url.searchParams.get('projectName') ?? config.projectName
    const id = url.searchParams.get('id') ?? url.searchParams.get('taskId') ?? ''
    const engine = await PlanweaveEngine.open(name)
    const graph = await engine.graph()
    let promptPath = ''
    let title = ''
    let acceptance: string[] | undefined
    const taskNode = graph.nodes.find(n => n.taskId === id)
    if (taskNode !== undefined) {
      promptPath = taskNode.promptPath
      title = taskNode.title
      acceptance = taskNode.acceptance
    } else {
      // block ref：<taskId>#<blockId> —— 从 manifest 定位块 prompt。
      const pkg = await loadPackage(engine.root)
      const block = pkg.manifest.nodes.flatMap(n => n.type === 'task' ? n.blocks.map(b => ({ taskId: n.id, b })) : []).find(x => `${x.taskId}#${x.b.id}` === id)
      if (block === undefined) throw new Error(`找不到任务或块：${id}`)
      promptPath = block.b.prompt
      title = block.b.title
    }
    if (promptPath === '') throw new Error(`${id} 无提示词文件`)
    const paths = await engine.paths()
    const target = resolve(paths.packageDir, promptPath)
    const pkgRoot = resolve(paths.packageDir)
    if (!target.startsWith(pkgRoot + sep)) throw new Error('路径越出计划包目录')
    const content = await readFile(target, 'utf8')
    json(res, 200, {
      ok: true,
      content,
      path: promptPath,
      ...(taskNode !== undefined ? { taskId: id } : { ref: id }),
      ...(acceptance !== undefined ? { acceptance } : {}),
      title,
    })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** GET /executors：内置 executor 名清单（任务分配下拉）。 */
async function handleExecutors(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  json(res, 200, { ok: true, executors: [...builtinExecutorNames] })
}

/** GET /projects：全部项目清单（供工作台切换）。 */
async function handleListProjects(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    ensurePlanweaveHomeForProjects()
    const projects = await listProjects()
    json(res, 200, {
      ok: true,
      projects: projects.map(p => ({
        id: p.projectId,
        name: p.name,
        kind: p.kind,
        rootPath: p.rootPath,
        canvases: p.taskCanvases.length,
      })),
    })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** POST /projects { name }：新建托管项目（幂等，同名返回既有项目）。 */
async function handleCreateProject(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name === '') throw new Error('项目名不能为空')
    ensurePlanweaveHomeForProjects()
    const project = await initManagedProject(name)
    json(res, 200, { ok: true, id: project.projectId, name: project.name })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** 项目管理操作前确保 runtime 的 PLANWEAVE_HOME 指向 DSH 数据根。 */
function ensurePlanweaveHomeForProjects(): void {
  // listProjects/initManagedProject 内部经 resolvePlanweaveHome 读环境变量；
  // engine.open 时 workspace.ensurePlanweaveHome 已设置过，这里兜底再设一次。
  if (process.env.PLANWEAVE_HOME !== undefined && process.env.PLANWEAVE_HOME !== '') return
  const dshHome = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh')
  process.env.PLANWEAVE_HOME = join(dshHome, 'planweave')
}

/** POST /doctor：状态/结果一致性体检（body.repair=true 时自动修复）。 */
async function handleDoctor(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const config = readConfig(ctx)
    const name = typeof body.projectName === 'string' && body.projectName !== '' ? body.projectName : config.projectName
    const engine = await PlanweaveEngine.open(name)
    const report = await engine.doctor(body.repair === true)
    json(res, 200, { ok: true, report })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** GET /search?q=…：全项目搜索（任务/块/提示词/产物）。 */
async function handleSearch(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const config = readConfig(ctx)
    const name = url.searchParams.get('projectName') ?? config.projectName
    const q = url.searchParams.get('q') ?? ''
    if (q.trim() === '') {
      json(res, 200, { ok: true, results: [] })
      return
    }
    const engine = await PlanweaveEngine.open(name)
    const results = await searchProject(engine.root, q, { limit: 40 })
    json(res, 200, { ok: true, results })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** GET /statistics：效率统计透传。 */
async function handleStatistics(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const config = readConfig(ctx)
    const engine = await PlanweaveEngine.open(url.searchParams.get('projectName') ?? config.projectName)
    json(res, 200, { ok: true, statistics: await getStatistics(engine.root) })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** GET /todos：待办分组透传。 */
async function handleTodos(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const config = readConfig(ctx)
    const engine = await PlanweaveEngine.open(url.searchParams.get('projectName') ?? config.projectName)
    json(res, 200, { ok: true, todos: await getTodoGroups(engine.root) })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** GET /quality：图质量校验报告。 */
async function handleQuality(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const config = readConfig(ctx)
    const engine = await PlanweaveEngine.open(url.searchParams.get('projectName') ?? config.projectName)
    const report = await validateGraphQuality({ projectRoot: engine.root })
    json(res, 200, { ok: true, report })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** POST /graph-history：图编辑历史（body.action = undo | redo）。 */
async function handleGraphHistory(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const config = readConfig(ctx)
    const name = typeof body.projectName === 'string' && body.projectName !== '' ? body.projectName : config.projectName
    const engine = await PlanweaveEngine.open(name)
    const result = body.action === 'undo'
      ? await undoDesktopPlanGraphCommand(engine.root)
      : body.action === 'redo'
        ? await redoDesktopPlanGraphCommand(engine.root)
        : undefined
    if (result === undefined) throw new Error(`未知操作：${String(body.action)}`)
    if (!result.ok || result.diagnostics.length > 0) {
      json(res, 409, { ok: false, error: result.diagnostics.map(d => d.message).join('; ') || `${String(body.action)} 失败` })
      return
    }
    json(res, 200, { ok: true })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** 读 JSON 请求体（上限 1 MiB）。 */
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

/**
 * UI 一键推进（POST /run）：HTTP 无 agent 上下文，固定走 llm 直跑路径；
 * 完整 agent 执行请在对话里调 planweave_run 工具。
 */
async function handleRun(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  try {
    const body = await readBody(req)
    const config = readConfig(ctx)
    const name = typeof body.projectName === 'string' && body.projectName !== '' ? body.projectName : config.projectName
    const stepsRaw = typeof body.steps === 'number' ? body.steps : Number(body.steps)
    const maxSteps = Number.isFinite(stepsRaw) && stepsRaw > 0
      ? Math.min(20, Math.max(1, Math.round(stepsRaw)))
      : config.maxSteps
    const { llm, model } = resolveLlm(ctx)
    const engine = await PlanweaveEngine.open(name)
    const env: RunEnv = { ctx, exec: null, llm, model, provider: defaultSubagentProvider(ctx) }
    const summary = await runCoordination(engine, env, maxSteps)
    const status = await engine.status()
    json(res, 200, { ok: true, summary, counts: status.counts, taskTotal: status.taskTotal, blockTotal: status.blockTotal })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

// ── 插件体 ──

export function applyPlanweaveHost(ctx: Context): void {
  // 1) settings 命名空间（重复加载时读取现有值，不覆盖）。
  //    注册失败必须留痕：命名空间缺失会让「可配置」页签的卡片消失
  //    （卡片可见性 = host describe 的命名空间 ∩ 已注册卡片）。
  try {
    ctx.settings.register(SETTINGS_NS, configSchema)
  } catch (error) {
    console.warn('[planweave] settings.register failed — 设置里将看不到 PlanWeave 卡片:',
      error instanceof Error ? error.message : String(error))
  }

  // 2) 模型工具。
  const toolsDispose = registerTools(ctx)
  ctx.effect(() => toolsDispose, 'webui: planweave tools')

  // 2.5) 技能安装工具：把随包的 7 个 PlanWeave 技能装入 DSH 技能目录。
  ctx.effect(() => registerPlanweaveSkillsTool(ctx), 'webui: planweave skills tool')

  // 3) HTTP API（loopback）。
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/status`) {
        void handleStatus(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/graph`) {
        void handleGraph(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/records`) {
        void handleRecords(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/providers`) {
        void handleProviders(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/edit`) {
        void handleEdit(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/task-source`) {
        void handleTaskSource(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/executors`) {
        void handleExecutors(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/projects`) {
        void handleListProjects(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/projects`) {
        void handleCreateProject(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/doctor`) {
        void handleDoctor(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/search`) {
        void handleSearch(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/statistics`) {
        void handleStatistics(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/todos`) {
        void handleTodos(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/quality`) {
        void handleQuality(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/graph-history`) {
        void handleGraphHistory(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/run`) {
        void handleRun(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/seed`) {
        void handleSeed(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/tasks/remove`) {
        void handleRemoveTask(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/tasks`) {
        void handleCreateTask(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/tasks/deps`) {
        void handleSetDeps(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/autorun/start`) {
        void handleAutoRunStart(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/autorun/control`) {
        void handleAutoRunControl(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/autorun/state`) {
        void handleAutoRunState(ctx, req, res)
        return
      }
      if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/record-content`) {
        void handleRecordContent(ctx, req, res)
        return
      }
      if (req.method === 'POST' && url.pathname === `${ROUTE_PREFIX}/reveal`) {
        void handleReveal(ctx, req, res)
        return
      }
      json(res, 404, { ok: false, error: `no route for ${req.method} ${url.pathname}` })
    },
  }), 'webui: planweave routes')
}
