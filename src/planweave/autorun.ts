/**
 * webui — PlanWeave Auto Run 引擎（host 半身）。
 *
 * 把协调循环后台化：启动后异步逐步「认领 → 执行 → 提交 → 评审 → 反馈」，
 * 支持暂停/恢复/停止，事件写入环形日志供 UI 轮询渲染实时进度。
 * 执行路径与同步推进完全一致（RunEnv 快照：subagent 优先 / llm 直跑）。
 *
 * 与 runtime 自带的 startAutoRun 的区别：那套引擎面向外部 agent CLI profiles；
 * 本引擎复用 DshExecutorAdapter 双路径，DSH 环境零外部依赖即可自动推进。
 */
import { randomUUID } from 'node:crypto'
import type { PlanweaveEngine } from './engine.js'
import { executeClaimStep, type RunEnv } from './host.js'

export type AutoRunStatus = 'running' | 'paused' | 'stopped' | 'completed' | 'failed'

/** 对外快照（JSON 友好）。 */
export interface AutoRunSnapshot {
  id: string
  projectName: string
  status: AutoRunStatus
  startedAt: string
  endedAt: string | null
  steps: number
  maxSteps: number
  events: string[]
}

interface AutoRunInternal {
  id: string
  projectName: string
  status: AutoRunStatus
  startedAt: string
  endedAt: string | null
  steps: number
  maxSteps: number
  events: string[]
  engine: PlanweaveEngine
  env: RunEnv
}

const runs = new Map<string, AutoRunInternal>()
const MAX_EVENTS = 400

function nowClock(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function push(internal: AutoRunInternal, line: string): void {
  internal.events.push(`[${nowClock()}] ${line}`)
  if (internal.events.length > MAX_EVENTS) internal.events.splice(0, internal.events.length - MAX_EVENTS)
}

function snapshotOf(internal: AutoRunInternal): AutoRunSnapshot {
  return {
    id: internal.id,
    projectName: internal.projectName,
    status: internal.status,
    startedAt: internal.startedAt,
    endedAt: internal.endedAt,
    steps: internal.steps,
    maxSteps: internal.maxSteps,
    events: [...internal.events],
  }
}

/** 主循环：串行推进直到停止/暂停/上限/无可认领/异常。 */
async function loop(internal: AutoRunInternal): Promise<void> {
  const { engine, env } = internal
  try {
    while (internal.status === 'running' && internal.steps < internal.maxSteps) {
      const claim = await engine.claim()
      if (internal.status !== 'running') break
      if (claim.kind === 'none') {
        push(internal, `无更多可认领项（${claim.reason ?? '计划已完成'}）`)
        internal.status = 'completed'
        break
      }
      if (claim.kind === 'blocked') {
        push(internal, `阻塞：${claim.reason}${claim.ref !== undefined ? `（${claim.ref}）` : ''}`)
        internal.status = 'failed'
        break
      }
      if (claim.kind === 'batch') {
        push(internal, `并行批次：${claim.refs.join(', ')}`)
        for (const ref of claim.refs) {
          if (internal.status !== 'running') break
          const sub = await engine.claimRef(ref)
          if (sub.kind !== 'block' && sub.kind !== 'feedback') {
            push(internal, `并行项 ${ref} 无法认领（${sub.kind}）`)
            continue
          }
          push(internal, await executeClaimStep(engine, env, '[并行]', sub))
          internal.steps += 1
        }
        continue
      }
      if (claim.kind !== 'block' && claim.kind !== 'feedback') continue
      push(internal, await executeClaimStep(engine, env, `#${String(internal.steps + 1)}`, claim))
      internal.steps += 1
    }
    if (internal.status === 'running' && internal.steps >= internal.maxSteps) {
      push(internal, `已达本次步数上限（${String(internal.maxSteps)} 步），自动暂停。可再次启动继续推进。`)
      internal.status = 'paused'
    }
  } catch (error) {
    internal.status = 'failed'
    push(internal, `执行失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (internal.status !== 'running' && internal.status !== 'paused') {
      internal.endedAt = new Date().toISOString()
    }
  }
}

/** 启动一个后台 Auto Run 并立即返回快照（循环在后台推进）。 */
export function startAutoRunBg(input: {
  projectName: string
  maxSteps: number
  engine: PlanweaveEngine
  env: RunEnv
}): AutoRunSnapshot {
  const internal: AutoRunInternal = {
    id: `ar_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
    projectName: input.projectName,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    steps: 0,
    maxSteps: Math.min(200, Math.max(1, Math.round(input.maxSteps))),
    events: [],
    engine: input.engine,
    env: input.env,
  }
  push(internal, `Auto Run 启动（上限 ${String(internal.maxSteps)} 步，${useSubagentDesc(input.env)}）`)
  runs.set(internal.id, internal)
  void loop(internal).catch(() => undefined)
  return snapshotOf(internal)
}

function useSubagentDesc(env: RunEnv): string {
  return env.provider !== null && env.exec?.agent !== undefined ? `subagent(${env.provider ?? ''})` : 'llm 直跑'
}

/** 取消/查询内部运行（未找到返回 undefined）。 */
function getInternal(id: string): AutoRunInternal | undefined {
  return runs.get(id)
}

/** 暂停。 */
export function pauseAutoRunBg(id: string): AutoRunSnapshot | undefined {
  const internal = getInternal(id)
  if (internal === undefined || internal.status !== 'running') return internal === undefined ? undefined : snapshotOf(internal)
  internal.status = 'paused'
  push(internal, '已暂停。')
  return snapshotOf(internal)
}

/** 恢复（从 paused 继续；loop 重新拉起）。 */
export function resumeAutoRunBg(id: string): AutoRunSnapshot | undefined {
  const internal = getInternal(id)
  if (internal === undefined || internal.status !== 'paused') return internal === undefined ? undefined : snapshotOf(internal)
  internal.status = 'running'
  push(internal, '已恢复。')
  void loop(internal).catch(() => undefined)
  return snapshotOf(internal)
}

/** 停止（终态；进行中的一步完成后退出）。 */
export function stopAutoRunBg(id: string): AutoRunSnapshot | undefined {
  const internal = getInternal(id)
  if (internal === undefined) return undefined
  if (internal.status === 'running' || internal.status === 'paused') {
    internal.status = 'stopped'
    push(internal, '已停止。')
    internal.endedAt = new Date().toISOString()
  }
  return snapshotOf(internal)
}

/** 查询快照。 */
export function getAutoRunBgState(id: string): AutoRunSnapshot | undefined {
  const internal = getInternal(id)
  return internal === undefined ? undefined : snapshotOf(internal)
}

/** 最近一次启动（按项目名过滤；找不到返回 undefined）。 */
export function latestAutoRunBg(projectName: string): AutoRunSnapshot | undefined {
  let found: AutoRunInternal | undefined
  for (const internal of runs.values()) {
    if (internal.projectName !== projectName) continue
    if (found === undefined || internal.startedAt > found.startedAt) found = internal
  }
  return found === undefined ? undefined : snapshotOf(found)
}
