/**
 * team — host 半身装配（HTTP 路由 + 工具 + 设置命名空间 + 提示词注入）。
 *
 * 路由（loopback-only，前缀 /api/webui-team）：
 *   GET  /teams                     → { ok, teams, activeTeamId }
 *   POST /teams                     → { action: create|generate|duplicate|remove|rename|activate|reset }
 *   GET  /teams/<id>                → { ok, team }
 *   POST /teams/<id>                → 保存该团队编制（body = team 对象）
 *   GET/POST /globals               → 全局默认读写
 *   GET  /providers                 → 模型枚举（provider 分组）
 *   GET  /capabilities              → 能力目录（可装配的工具 / 技能 / 技能包）
 *   GET/POST /chat-mode?sessionId=  → 对话框团队开关
 *   POST /runs                      → 启动运行
 *   GET  /runs?teamId=&limit=       → 运行清单
 *   GET  /runs/active?sessionId=    → 本会话活跃运行快照（HUD 轮询）
 *   GET  /runs/<id>                 → 运行快照
 *   GET  /runs/<id>/output?name=    → 单步完整产出（name=steps 文件名，或 final）
 *   POST /runs/<id>/cancel          → 取消运行
 *   POST /runs/<id>/resume          → 一键接续（同一个 run 上重跑未完成步骤）
 *   POST /runs/<id>/remove          → 删除运行记录
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import z from '@deepseek-ai/schemastery'
import { TeamStore } from './store.js'
import { TeamEngine } from './engine.js'
import { generateTeam } from './generate.js'
import { capabilityCatalog } from './capabilities.js'
import { registerTeamTools } from './tools.js'
import { applyTeamChatMode } from './chat-mode.js'
import { listProviders, isResumable, runProgress } from './roster.js'
import { TeamError, normalizeBinding, type ModelBinding, type Run } from './types.js'

/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any

export const TEAM_ROUTE_PREFIX = '/api/webui-team'
export const TEAM_SETTINGS_NAMESPACE = 'webui-team'

// ── loopback 校验（与 automation/routes.ts 同款）──────────────────────────────

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
    return close <= 1 ? null : host.slice(1, close)
  }
  const first = host.indexOf(':')
  const last = host.lastIndexOf(':')
  if (first !== last) return null
  return first === -1 ? host : host.slice(0, first)
}

function loopbackAllowed(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = hostNameOf(req.headers.host)
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => { data += String(chunk) })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(data === '' ? '{}' : data) as unknown
        resolve(parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

function errorStatus(error: unknown): number {
  return error instanceof TeamError ? error.status : 500
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ── settings 命名空间（globals 的 settings.yaml 影射）────────────────────────

const SETTINGS_SCHEMA = z.object({
  defaultProvider: z.string().default(''),
  defaultModel: z.string().default(''),
  activeTeamId: z.string().default(''),
  timeoutSec: z.number().step(1).min(10).max(3600).default(300),
  maxRetries: z.number().step(1).min(0).max(5).default(1),
  maxConcurrentRuns: z.number().step(1).min(1).max(5).default(1),
  maxParallel: z.number().step(1).min(1).max(5).default(2),
  autoPlan: z.boolean().default(false),
  outputChunkChars: z.number().step(1).min(500).default(8000),
  stopOnError: z.boolean().default(true),
  autoFallback: z.boolean().default(true),
})

/** 把 settings 值同步进 globals.json（settings 为「用户可见配置面」，文件为运行时真源）。 */
function syncSettingsToGlobals(scope: any, store: TeamStore): void {
  if (scope === undefined) return
  let value: Record<string, unknown>
  try {
    value = (scope.get() ?? {}) as Record<string, unknown>
  } catch {
    return
  }
  const provider = typeof value.defaultProvider === 'string' ? value.defaultProvider.trim() : ''
  const model = typeof value.defaultModel === 'string' ? value.defaultModel.trim() : ''
  const patch: Record<string, unknown> = {}
  if (provider !== '' || model !== '') patch.defaultModel = { provider, model }
  if (typeof value.activeTeamId === 'string' && value.activeTeamId.trim() !== '') patch.activeTeamId = value.activeTeamId.trim()
  for (const key of ['timeoutSec', 'maxRetries', 'maxConcurrentRuns', 'maxParallel', 'outputChunkChars'] as const) {
    if (typeof value[key] === 'number') patch[key] = value[key]
  }
  if (typeof value.stopOnError === 'boolean') patch.stopOnError = value.stopOnError
  if (typeof value.autoFallback === 'boolean') patch.autoFallback = value.autoFallback
  if (typeof value.autoPlan === 'boolean') patch.autoPlan = value.autoPlan
  if (Object.keys(patch).length === 0) return
  try { store.patchGlobals(patch) } catch { /* ignore */ }
}

// ── 路由处理 ────────────────────────────────────────────────────────────────

interface RouteDeps {
  ctx: AnyContext
  store: TeamStore
  engine: TeamEngine
}

async function handleTeams(deps: RouteDeps, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const { store } = deps
  const querySession = (url.searchParams.get('sessionId') ?? '').trim()
  if (req.method === 'POST') {
    const body = await readBody(req)
    const action = typeof body.action === 'string' ? body.action : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    const session = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    /**
     * 「设为当前团队」的目标会话：带 sessionId 只写会话级（不污染其它会话与全局默认）；
     * 不带（旧调用方/工具）回退写全局默认。
     */
    const setCurrent = (teamId: string): void => {
      if (session !== '') store.setSessionActiveTeam(session, teamId)
      else store.patchGlobals({ activeTeamId: teamId })
    }
    if (action === 'create') {
      const team = store.createTeam(name !== '' ? name : '新团队', { seed: body.seed === true })
      setCurrent(team.id)
      json(res, 200, { ok: true, team, teams: store.listTeams(), activeTeamId: store.sessionActiveTeamId(session) })
      return
    }
    if (action === 'duplicate') {
      const team = store.duplicateTeam(id, name !== '' ? name : undefined)
      setCurrent(team.id)
      json(res, 200, { ok: true, team, teams: store.listTeams(), activeTeamId: store.sessionActiveTeamId(session) })
      return
    }
    if (action === 'remove') {
      const result = store.removeTeam(id)
      json(res, 200, { ok: true, ...result, teams: store.listTeams() })
      return
    }
    if (action === 'rename') {
      const team = store.readTeam(id)
      const saved = store.saveTeam({ ...team, name: name !== '' ? name : team.name })
      json(res, 200, { ok: true, team: saved, teams: store.listTeams() })
      return
    }
    if (action === 'activate') {
      setCurrent(id)
      json(res, 200, {
        ok: true,
        activeTeamId: store.sessionActiveTeamId(session),
        teams: store.listTeams(),
      })
      return
    }
    if (action === 'reset') {
      const team = store.resetTeam(id)
      json(res, 200, { ok: true, team, teams: store.listTeams() })
      return
    }
    if (action === 'generate') {
      const brief = typeof body.brief === 'string' ? body.brief : ''
      const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
      const model = typeof body.model === 'string' ? body.model.trim() : ''
      const teamModel = normalizeBinding(body.teamModel)
      const team = await generateTeam(deps.ctx, store, {
        brief,
        ...(provider !== '' ? { provider } : {}),
        ...(model !== '' ? { model } : {}),
        ...(teamModel !== null ? { teamModel } : {}),
      })
      setCurrent(team.id)
      json(res, 200, { ok: true, team, teams: store.listTeams(), activeTeamId: store.sessionActiveTeamId(session) })
      return
    }
    throw new TeamError(`未知动作：${action}`, 'unknown_action', 400)
  }
  json(res, 200, { ok: true, teams: store.listTeams(), activeTeamId: store.sessionActiveTeamId(querySession) })
}

async function handleTeamDetail(
  deps: RouteDeps, teamId: string, req: IncomingMessage, res: ServerResponse,
): Promise<void> {
  const { store } = deps
  if (req.method === 'POST') {
    const body = await readBody(req)
    const payload = (body.team !== undefined ? body.team : body) as Record<string, unknown>
    const saved = store.saveTeam({ ...payload, id: teamId })
    json(res, 200, { ok: true, team: saved, teams: store.listTeams() })
    return
  }
  json(res, 200, { ok: true, team: store.readTeam(teamId) })
}

async function handleGlobals(deps: RouteDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { store } = deps
  if (req.method === 'POST') {
    const body = await readBody(req)
    const patch: Record<string, unknown> = { ...(body.globals !== undefined ? body.globals as Record<string, unknown> : body) }
    if (patch.defaultModel !== undefined) {
      patch.defaultModel = normalizeBinding(patch.defaultModel) ?? { provider: '', model: '' }
    }
    json(res, 200, { ok: true, globals: store.patchGlobals(patch) })
    return
  }
  json(res, 200, { ok: true, globals: store.readGlobals() })
}

async function handleChatMode(deps: RouteDeps, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { store } = deps
  if (req.method === 'POST') {
    const body = await readBody(req)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    const patch: Record<string, unknown> = {}
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (typeof body.teamId === 'string') patch.teamId = body.teamId.trim()
    if (typeof body.chainId === 'string') patch.chainId = body.chainId.trim()
    if (typeof body.force === 'boolean') patch.force = body.force
    const state = store.writeChatMode(sessionId, patch)
    json(res, 200, { ok: true, state })
    return
  }
  const sessionId = url.searchParams.get('sessionId') ?? ''
  json(res, 200, { ok: true, state: store.readChatMode(sessionId) })
}

async function handleRuns(deps: RouteDeps, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { store, engine } = deps
  if (req.method === 'POST') {
    const body = await readBody(req)
    const teamId = typeof body.teamId === 'string' ? body.teamId.trim() : ''
    const task = typeof body.task === 'string' ? body.task : ''
    const chainId = typeof body.chainId === 'string' ? body.chainId.trim() : ''
    const roles = Array.isArray(body.roles)
      ? body.roles.filter((r): r is string => typeof r === 'string' && r.trim() !== '').map(r => r.trim())
      : []
    const overrides: Record<string, ModelBinding> = {}
    if (body.modelOverrides !== null && typeof body.modelOverrides === 'object') {
      for (const [roleId, value] of Object.entries(body.modelOverrides as Record<string, unknown>)) {
        const binding = normalizeBinding(value)
        if (binding !== null && binding.provider !== '' && binding.model !== '') overrides[roleId] = binding
      }
    }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    // plan：并行波次数组（[[roleId,…],…]，也接受 [{roleId,taskNote}] 形式）；
    // autoPlan：让主脑先自己编排并行计划。两者都优先于 chainId/roles。
    const plan = Array.isArray(body.plan) ? body.plan : undefined
    const autoPlan = body.autoPlan === true
    const useChain = !autoPlan && plan === undefined && chainId !== ''
    const run = engine.start({
      teamId,
      ...(useChain ? { chainId } : {}),
      ...(!autoPlan && plan === undefined && roles.length > 0 ? { roles } : {}),
      ...(plan !== undefined ? { plan: plan as never } : {}),
      ...(autoPlan ? { autoPlan: true } : {}),
      task,
      ...(Object.keys(overrides).length > 0 ? { modelOverrides: overrides } : {}),
      origin: 'panel',
      ...(sessionId !== '' ? { sessionId } : {}),
      synthesize: body.synthesize !== false,
    })
    json(res, 200, { ok: true, run })
    return
  }
  const teamId = url.searchParams.get('teamId') ?? ''
  const sessionId = url.searchParams.get('sessionId') ?? ''
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10)
  json(res, 200, {
    ok: true,
    runs: store.listRuns({ ...(teamId !== '' ? { teamId } : {}), ...(sessionId !== '' ? { sessionId } : {}), limit: Number.isFinite(limit) ? limit : 50 }),
    activeRunIds: engine.activeRunIds(),
  })
}

function handleActiveRuns(deps: RouteDeps, url: URL, res: ServerResponse): void {
  const { store } = deps
  const sessionId = url.searchParams.get('sessionId') ?? ''
  // 会话严格隔离：只返回本会话的活跃运行。
  const shown = sessionId !== '' ? store.activeRuns(sessionId) : []
  // 最近一次已结束的运行：同样只取本会话的（HUD 结束后停留展示汇总）。
  const recent = sessionId !== ''
    ? store.listRuns({ limit: 12 }).filter(summary =>
        summary.status !== 'running' && summary.status !== 'queued' && summary.sessionId === sessionId)
    : []
  const lastFinished = recent.length > 0 ? store.readRun(recent[0].id) : null
  json(res, 200, {
    ok: true,
    runs: shown.map(run => withRunFlags(run)),
    ...(lastFinished !== null
      ? { lastFinished: withRunFlags(lastFinished) }
      : {}),
  })
}

/**
 * 给运行快照补上派生字段：progress 统计 + resumable（能否一键接续）。
 * UI 不该自己推断状态机，服务端算一次所有入口共用。
 */
function withRunFlags(run: Run): Run & { progress: ReturnType<typeof runProgress>, resumable: boolean } {
  return { ...run, progress: runProgress(run), resumable: isResumable(run) }
}

/** 校验调用方对本运行的会话归属；无归属的旧运行放行（跨会话禁止操作）。 */
function assertRunOwnership(store: TeamStore, runId: string, sessionId: string): void {
  const run = store.readRun(runId)
  if (run === null) throw new TeamError(`找不到运行：${runId}`, 'run_not_found', 404)
  if (sessionId !== '' && run.sessionId !== undefined && run.sessionId !== '' && run.sessionId !== sessionId) {
    throw new TeamError('该运行不是本会话发起的，无法操作', 'run_foreign', 403)
  }
}

async function handleRunDetail(
  deps: RouteDeps, runId: string, tail: string, url: URL, req: IncomingMessage, res: ServerResponse,
): Promise<void> {
  const { store, engine } = deps
  const sessionId = url.searchParams.get('sessionId') ?? ''
  if (tail === 'cancel' && req.method === 'POST') {
    assertRunOwnership(store, runId, sessionId)
    const hit = engine.cancel(runId)
    json(res, 200, { ok: true, cancelled: hit })
    return
  }
  // 一键接续：同一个 run 上重跑 error/skipped/pending 步骤（已完成产物保留）。
  if (tail === 'resume' && req.method === 'POST') {
    assertRunOwnership(store, runId, sessionId)
    const run = engine.resume(runId)
    json(res, 200, { ok: true, run: withRunFlags(run) })
    return
  }
  if (tail === 'remove' && req.method === 'POST') {
    assertRunOwnership(store, runId, sessionId)
    store.removeRun(runId)
    json(res, 200, { ok: true })
    return
  }
  if (tail === 'output') {
    const name = url.searchParams.get('name') ?? ''
    if (name === 'final') {
      json(res, 200, { ok: true, content: store.readFinal(runId) })
      return
    }
    json(res, 200, { ok: true, content: store.readStepOutput(runId, name) })
    return
  }
  const run = store.readRun(runId)
  if (run === null) throw new TeamError(`找不到运行：${runId}`, 'run_not_found', 404)
  json(res, 200, { ok: true, run: withRunFlags(run), progress: runProgress(run) })
}

// ── 装配 ────────────────────────────────────────────────────────────────────

/** 挂载 team 模块（host 半身）。 */
export function applyTeamHost(ctx: AnyContext): void {
  const webServer = ctx.get?.('webServer')
  if (webServer === undefined) return

  const store = new TeamStore()
  store.markInterruptedOnBoot()
  const engine = new TeamEngine({ ctx, store })

  // settings 命名空间（用户可在 settings.yaml 里配全局默认）。
  let scope: any
  try {
    scope = ctx.settings.register(TEAM_SETTINGS_NAMESPACE, SETTINGS_SCHEMA)
    syncSettingsToGlobals(scope, store)
  } catch (error: any) {
    console.log('[webui-team] settings namespace already registered:', error?.message ?? error)
  }

  const deps: RouteDeps = { ctx, store, engine }

  // HTTP 路由（前缀匹配 + 内部分发）。
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: TEAM_ROUTE_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!loopbackAllowed(req)) {
        json(res, 403, { ok: false, error: 'loopback-only' })
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const rest = url.pathname.slice(TEAM_ROUTE_PREFIX.length).replace(/^\/+|\/+$/g, '')
        const parts = rest === '' ? [] : rest.split('/')

        if (parts[0] === 'teams') {
          if (parts.length === 1) return await handleTeams(deps, req, res, url)
          return await handleTeamDetail(deps, parts[1], req, res)
        }
        if (parts[0] === 'globals') return await handleGlobals(deps, req, res)
        if (parts[0] === 'providers') {
          json(res, 200, { ok: true, providers: listProviders(ctx) })
          return
        }
        if (parts[0] === 'capabilities') {
          json(res, 200, { ok: true, ...(await capabilityCatalog(ctx)) })
          return
        }
        if (parts[0] === 'chat-mode') return await handleChatMode(deps, url, req, res)
        if (parts[0] === 'runs') {
          if (parts.length === 1) return await handleRuns(deps, url, req, res)
          if (parts[1] === 'active') return handleActiveRuns(deps, url, res)
          return await handleRunDetail(deps, parts[1], parts[2] ?? '', url, req, res)
        }
        json(res, 404, { ok: false, error: `未知路径：${url.pathname}` })
      } catch (error) {
        json(res, errorStatus(error), { ok: false, error: errorMessage(error) })
      }
    },
  }), 'webui: team routes')

  // Agent 工具。
  try {
    const disposeTools = registerTeamTools({ ctx, store, engine })
    ctx.effect(() => () => disposeTools(), 'webui: team tools')
  } catch (error: any) {
    console.log('[webui-team] tools register failed:', error?.message ?? error)
  }

  // 对话框团队开关的提示词注入。
  try {
    applyTeamChatMode(ctx, store)
  } catch (error: any) {
    console.log('[webui-team] chat mode prompt failed:', error?.message ?? error)
  }
}
