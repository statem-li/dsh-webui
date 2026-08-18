/**
 * dsh-memory 插件入口（host half）：本地文件记忆引擎。
 * 挂载：
 * - session/event → turn/end 捕获 → LLM 提取候选 → 直接入库 + changes 变更流
 * - ticker → 每 N 轮增量编译 / 会话结束 final 编译 / 每日编译（衰减+折叠+滚出+daily）
 * - agent/pre-step → 记忆注入（带来源 user message，绝不写 system prompt）
 * - tools → memory_search / memory_remember / memory_pin / memory_tag / memory_forget
 * - webServer → /api/dsh-memory/*（面板数据 + 裁决操作）
 */

import type { Context } from '@deepseek-ai/cordis'
import { mountMemoryRoutes } from './api.js'
import { compileAll, workspaceHashOf } from './engine/compile.js'
import { extractCandidates, transcriptFromEvents } from './engine/extract.js'
import { createMemoryInjector } from './engine/inject.js'
import { MemoryStore, entryIdOf, summarize } from './engine/store.js'
import { createTicker } from './engine/ticker.js'
import { registerMemoryTools } from './tools.js'
import type { MemoryConfig } from './types.js'
import { DEFAULT_CONFIG } from './types.js'

/** Stable Cordis plugin name。 */
export const name = 'dsh-memory'

/** 硬依赖服务。 */
export const inject = ['webServer', 'tools']

/** 最小 agent 面（供提取与 ticker）。 */
interface LiveAgent {
  readonly id: string
  readonly options: { provider?: string; model?: string }
  readonly session: {
    readonly id: string
    readonly header?: { cwd?: string }
  }
}

/** 解析插件配置（cordis.patch.yml config 覆盖默认）。 */
function resolveConfig(input: Partial<MemoryConfig> | undefined): MemoryConfig {
  const config: MemoryConfig = { ...DEFAULT_CONFIG }
  if (input === undefined || typeof input !== 'object') return config
  const candidate = input as Record<string, unknown>
  const numbers = ['extractEveryTurns', 'compileEveryTurns', 'compileThreshold', 'decayLambda', 'hitBonus', 'injectTokenBudget', 'injectRefreshSteps', 'extractMaxChars', 'minImportance'] as const
  for (const key of numbers) {
    const value = candidate[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      ;(config as unknown as Record<string, unknown>)[key] = value
    }
  }
  if (typeof candidate.dailyCompileEnabled === 'boolean') {
    config.dailyCompileEnabled = candidate.dailyCompileEnabled
  }
  return config
}

/** 应用入口。 */
export function applyMemory(ctx: Context, input: Partial<MemoryConfig> | undefined): void {
  const config = resolveConfig(input)
  const store = new MemoryStore()
  const logError = (stage: string, error: unknown): void => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    ctx.logger?.warn?.(`[dsh-memory] ${stage}: ${message}`)
    // 落盘错误日志：DSH 控制台日志不落盘，重启后据此排查崩溃根因。
    void store.appendErrorLog(stage, message).catch(() => undefined)
  }

  // ── 全局错误捕获（诊断崩溃根因；无论错误来自哪个插件都记录） ─────────
  // 注意：注册 unhandledRejection 监听后 Node 不再因未处理拒绝而默认崩溃，
  // 这里只记录证据（含堆栈）供 errors.log 排查，随后交由 DSH 自身处理。
  function uncaughtListener(error: Error): void { logError('uncaughtException', error) }
  function unhandledListener(reason: unknown): void { logError('unhandledRejection', reason) }
  process.on('uncaughtException', uncaughtListener)
  process.on('unhandledRejection', unhandledListener)
  ctx.effect(() => () => {
    process.removeListener('uncaughtException', uncaughtListener)
    process.removeListener('unhandledRejection', unhandledListener)
  }, 'dsh-memory: process error hooks')

  // ── ticker：轮数 / 会话结束 / 每日（内部串行队列） ──────────────────
  const ticker = createTicker(ctx, store, config)
  ctx.effect(() => ticker.dispose, 'dsh-memory: ticker')

  // ── pre-step 注入（prepend：在下游贡献之后追加到最终 messages） ──────
  const injector = createMemoryInjector(store, config, ctx.logger)
  ctx.on('agent/pre-step', ((
    payload: { agent: LiveAgent; messages: unknown[]; signal: AbortSignal },
    next: () => Promise<{ kind: 'enter'; messages: unknown[] } | { kind: 'reject' }>,
  ) => injector.preStepListener(payload, next)) as never, { prepend: true })
  ctx.on('agent/disposed', ({ agent }) => {
    injector.disposeSession(agent.session.id)
  })

  // ── 模型工具 ─────────────────────────────────────────────────────────
  const toolsDispose = registerMemoryTools(ctx, store, config)
  ctx.effect(() => toolsDispose, 'dsh-memory: tools')

  // ── HTTP API ─────────────────────────────────────────────────────────
  const routesDispose = mountMemoryRoutes(ctx, store, config)
  ctx.effect(() => routesDispose, 'dsh-memory: routes')

  // ── turn/end 捕获：提取（增量窗口） + ticker ────────────────────────
  const turnBuffers = new Map<string, Array<{ type: string; data: unknown }>>()

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      turnBuffers.set(session.id, [])
      return
    }
    if (event.type === 'turn/end') {
      const buffer = turnBuffers.get(session.id) ?? []
      turnBuffers.delete(session.id)
      const turnNumber = (event.data as { turn?: number }).turn ?? 0
      // ticker 调度（计数/每日/增量编译/会话结束 final）——串行队列内。
      // 关键：Node 24 默认 unhandled rejection 会 throw 并杀死进程，
      // 所有 fire-and-forget 的 promise 必须显式 catch。
      void ticker.onTurnEnd(session.id, { id: session.id }).catch(error => logError('ticker.onTurnEnd', error))
      // 提取（LLM 失败跳过本轮，绝不阻塞；写入走同一条串行队列）。
      const agents = ctx.get('agents')
      const agent = agents?.get(session.id) as LiveAgent | undefined
      if (agent === undefined) return
      void ticker.enqueue(async () => {
        await extractTurn(ctx, store, config, agent, buffer, turnNumber)
      }).catch(error => logError('extractTurn', error))
      return
    }
    if (event.type === 'user/message' || event.type === 'assistant/message') {
      const buffer = turnBuffers.get(session.id)
      if (buffer === undefined) return
      buffer.push({ type: event.type, data: event.data })
    }
  })

  ctx.logger?.info?.('[dsh-memory] memory engine mounted')
}

/** 一轮的提取与入库（提取频率由 extractEveryTurns 控制）。 */
async function extractTurn(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
  agent: LiveAgent,
  buffer: Array<{ type: string; data: unknown }>,
  turnNumber: number,
): Promise<void> {
  const transcript = transcriptFromEvents(buffer)
  if (transcript.trim() === '') return
  // 频率控制：turn 编号对 extractEveryTurns 取模（turn 从 1 开始）。
  if (config.extractEveryTurns > 1 && turnNumber % config.extractEveryTurns !== 1) return

  // 失败退避：连续 3 次提取失败（0 候选/LLM 错误）后降频为每 10 轮一次，
  // 避免在模型 API 不稳定时每轮都发起额外调用雪上加霜。
  const tickerState = await store.readState()
  const sessionState = tickerState.perSession[agent.id]
  if ((sessionState?.extractFailStreak ?? 0) >= 3 && turnNumber % 10 !== 1) return

  // 提取诊断：开始/结束都落盘，据此确认提取是否卡死（LLM 流不结束）或未被调用。
  const startedAt = Date.now()
  void store.appendExtractLog(`turn=${turnNumber} chars=${transcript.length} route=${agent.options.provider ?? 'default'} start`)
  const candidates = await extractCandidates(ctx, agent, transcript, config)
  void store.appendExtractLog(`turn=${turnNumber} done ${Date.now() - startedAt}ms candidates=${candidates.length}`)
  ctx.logger?.debug?.(`[dsh-memory] extract turn=${turnNumber} chars=${transcript.length} candidates=${candidates.length} route=${agent.options.provider ?? 'default'}`)
  if (candidates.length === 0) {
    // 更新失败计数（退避状态）。
    const latest = await store.readState()
    const per = latest.perSession[agent.id] ?? { turnCount: 0, lastInjectedStep: 0 }
    per.extractFailStreak = (per.extractFailStreak ?? 0) + 1
    latest.perSession[agent.id] = per
    await store.writeState(latest)
    return
  }

  let added = 0
  let updated = 0
  for (const candidate of candidates) {
    // 工作区判定失败 → 回退 global（design §8）。
    let scope: 'global' | 'project' = candidate.scope
    let hash: string | null = null
    if (scope === 'project') {
      hash = workspaceHashOf(agent.session.header)
      if (hash === null) scope = 'global'
    }
    // 变更对比：update 时记录旧内容（before，必须在 upsert 前读取）。
    const beforeEntry = await store.getEntry(entryIdOf(candidate.content, scope, hash))
    const { created, entry } = await store.upsertEntry({
      content: candidate.content,
      scope,
      projectHash: hash,
      tags: candidate.tags,
      importance: candidate.importance,
      source: 'extract',
    })
    // 项目层首次落盘时确保 meta.json 存在（否则面板项目列表看不到该项目）。
    if (scope === 'project' && hash !== null) {
      const meta = await store.readProjectMeta(hash)
      if (meta === undefined) {
        await store.writeProjectMeta(hash, {
          path: agent.session.header?.cwd ?? '未知工作区',
          alias: null,
          locked: false,
        })
      }
    }
    if (created) added += 1
    else updated += 1
    await store.appendChange({
      action: created ? 'add' : 'update',
      entryId: entry.id,
      scope: entry.scope,
      projectHash: entry.projectHash,
      summary: summarize(entry.content),
      before: beforeEntry?.content,
      after: entry.content,
    })
  }
  // 成功：清零失败计数。
  const successState = await store.readState()
  const successPer = successState.perSession[agent.id] ?? { turnCount: 0, lastInjectedStep: 0 }
  successPer.extractFailStreak = 0
  successState.perSession[agent.id] = successPer
  await store.writeState(successState)
  // 有新增/更新时刷新产物（增量编译）。
  if (added + updated > 0) {
    await compileAll(store, config)
    ctx.logger?.debug?.(`[dsh-memory] extracted ${added} new, ${updated} updated`)
  }
}
