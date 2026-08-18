/**
 * dsh-memory 调度器：三个触发点（design §5.3）。
 * 1. 每 N 轮（默认 10）增量编译 timeline；
 * 2. 会话结束（turn/end 后 debounce 静默期）final 编译；
 * 3. 每日一次：全量衰减 → 短期折叠进长期 → 低分滚出 → daily 日志落盘 → 产物重编译。
 * 并发安全：所有写入经同一个串行队列（内存锁）执行。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MemoryConfig } from '../types.js'
import { compileAll, promoteEntries, writeDailyLog } from './compile.js'
import { decayImportance, shouldEvict } from './scoring.js'
import {
  localDate,
  nowIso,
  summarize,
  type MemoryStore,
} from './store.js'

/** 会话结束判定静默期（毫秒）。 */
const SESSION_END_DEBOUNCE_MS = 15_000

/** 每日检查定时器间隔（毫秒，仅兜底；正常由 turn/end 驱动）。 */
const DAILY_CHECK_INTERVAL_MS = 60 * 60 * 1000

/** 从 store 读的 Agent 最小面（id 即可，供调度去重）。 */
export interface TickerAgent {
  readonly id: string
}

/**
 * 创建 ticker。返回 { onTurnEnd, enqueue, dispose }。
 * onTurnEnd 由 session/event 的 turn/end 分支调用；enqueue 供提取等写操作
 * 共用同一条串行队列（内存锁：避免 ticker 与捕获并发读写同一 store）。
 */
export function createTicker(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
): { onTurnEnd: (sessionId: string, agent: TickerAgent) => Promise<void>; enqueue: <T>(task: () => Promise<T>) => Promise<T>; dispose: () => void } {
  // 串行写队列（内存锁：ticker 与 turn/end 捕获共用同一 store 实例，串行化避免同日多写竞争）。
  let queue: Promise<void> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
  const enqueueSafe = (task: () => Promise<void>): void => {
    enqueue(task).catch(error => {
      ctx.logger?.warn?.(`[dsh-memory] ticker task failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** 每会话的 final 编译 debounce 计时器。 */
  const sessionEndTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** 每日编译（幂等：lastDailyDate 前置判断，避免同日重复）。 */
  async function runDailyCompile(): Promise<void> {
    const today = localDate()
    const state = await store.readState()
    const last = state.lastDailyDate
    state.lastDailyDate = today
    await store.writeState(state)
    if (last === today) return

    const days = last === null ? 1 : Math.max(1, Math.floor((Date.parse(today) - Date.parse(last)) / 86_400_000))

    // 1-3) 衰减 → 折叠 → 滚出 → 原子写回（走 store 写队列，避免与提取/裁决并发覆盖）。
    let promoted: Array<import('../types.ts').MemoryEntry> = []
    let evicted: Array<import('../types.ts').MemoryEntry> = []
    await store.replaceEntries(entries => {
      const decayed = entries.map(entry => ({
        ...entry,
        importance: decayImportance(entry.importance, days, config.decayLambda),
      }))
      const result = promoteEntries(decayed, config.compileThreshold)
      promoted = result.promoted
      const kept: typeof result.remaining = []
      evicted = []
      for (const entry of result.remaining) {
        if (shouldEvict(entry, config.compileThreshold)) evicted.push(entry)
        else kept.push(entry)
      }
      return [...promoted, ...kept]
    })

    // 4) 变更流。
    for (const entry of promoted) {
      await store.appendChange({
        action: 'promote',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: summarize(entry.content),
      })
    }
    for (const entry of evicted) {
      await store.appendChange({
        action: 'delete',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `低分条目滚出：${summarize(entry.content)}`,
      })
    }

    // 5) 产物重编译 + daily 日志。
    await compileAll(store, config)
    await writeDailyLog(store)
    ctx.logger?.debug?.(`[dsh-memory] daily compile done (promoted=${promoted.length}, evicted=${evicted.length})`)
  }

  /** 每 N 轮增量编译（timeline 重写）。 */
  async function runTurnCompile(sessionId: string, turnCount: number): Promise<void> {
    if (turnCount % config.compileEveryTurns !== 0) return
    await compileAll(store, config)
    ctx.logger?.debug?.(`[dsh-memory] incremental compile (session=${sessionId}, turns=${turnCount})`)
  }

  /** 会话结束 final 编译（debounce）。 */
  function scheduleSessionEnd(sessionId: string): void {
    const existing = sessionEndTimers.get(sessionId)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      sessionEndTimers.delete(sessionId)
      enqueueSafe(async () => {
        await compileAll(store, config)
        await writeDailyLog(store)
        ctx.logger?.debug?.(`[dsh-memory] final compile (session=${sessionId})`)
      })
    }, SESSION_END_DEBOUNCE_MS)
    sessionEndTimers.set(sessionId, timer)
  }

  /** turn/end 统一入口（返回排队任务的 promise，供调用方串行衔接）。 */
  function onTurnEnd(sessionId: string, _agent: TickerAgent): Promise<void> {
    const result = enqueue(async () => {
      const state = await store.readState()
      const per = state.perSession[sessionId] ?? { turnCount: 0, lastInjectedStep: 0 }
      per.turnCount += 1
      state.perSession[sessionId] = per

      // 日期切换 → 每日编译。
      const today = localDate()
      if (state.lastDailyDate !== today) {
        await store.writeState(state)
        if (config.dailyCompileEnabled) await runDailyCompile()
      } else {
        await store.writeState(state)
      }

      // 每 N 轮增量编译。
      await runTurnCompile(sessionId, per.turnCount)
    })
    scheduleSessionEnd(sessionId)
    return result
  }

  // 兜底每日检查（每小时；正常情况 turn/end 已驱动）。
  const timerService = ctx.get('timer')
  const checkInterval = timerService?.interval(() => {
    enqueueSafe(async () => {
      const state = await store.readState()
      const today = localDate()
      if (state.lastDailyDate !== today && config.dailyCompileEnabled) {
        await runDailyCompile()
      }
    })
  }, DAILY_CHECK_INTERVAL_MS)

  function dispose(): void {
    if (typeof checkInterval === 'function') checkInterval()
    for (const timer of sessionEndTimers.values()) clearTimeout(timer)
    sessionEndTimers.clear()
  }

  return { onTurnEnd, enqueue, dispose }
}

/** 会话级 ticker 状态读取（供 inject 用，避免重复读文件）。 */
export async function sessionTurnCount(store: MemoryStore, sessionId: string): Promise<number> {
  const state = await store.readState()
  return state.perSession[sessionId]?.turnCount ?? 0
}

/** 当前时间 ISO（供 change 记录）。 */
export function tickerNow(): string {
  return nowIso()
}
