/**
 * team — 运行引擎（host 半身）。
 *
 * 一次 Run = 把链条/计划展开成**波次**（wave）序列，逐波推进并把快照写回 run.json：
 *   queued → running ─(全部步骤 done)→ done
 *                    ─(某步 error 且 stopOnError)→ error
 *                    ─(取消)→ cancelled（当前步 abort，后续 pending → skipped）
 *
 * 并行语义：同一波次里的步骤**并发执行**（受 maxParallel 限制），波次之间严格串行。
 * 一个步骤的上游上下文只包含**更早波次**的产出——同波伙伴彼此看不到对方结果，
 * 所以提示词里会显式告知「谁在与你同时干活」，避免重复劳动与互相假设。
 *
 * 两条执行通道（并行时按角色 executor 各自选择）：
 *  - llm 直跑：ctx.llm.stream，可精确指定 provider/model；无工具。
 *  - subagent：ctx.subagents.start（需要 agent 上下文），有完整工具能力；模型继承父会话。
 *
 * 流式增量：每 ~500ms 把当前步累积输出（截断）写进 run.json 的 steps[i].output，
 * 对话流 HUD 直接轮询快照即可看到实时进度，无需额外 SSE 通道。
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  TeamError,
  effectiveGlobals,
  normalizePlan,
  type ModelBinding,
  type PlanWaveItem,
  type Run,
  type RunStep,
  type StartRunInput,
  type StepAttempt,
  type StepErrorKind,
  type StepPhase,
  type Team,
  type TeamGlobals,
} from './types.js'
import {
  assertTeamRunnable,
  describePlan,
  findCoreRole,
  isResumable,
  listProviders,
  planChain,
  planResume,
  planRoles,
  planWaves,
  resolveCandidates,
  resolveModelChecked,
  waveCountOf,
  type ModelCandidate,
  type PlannedStep,
  type ProviderView,
} from './roster.js'
import {
  backoffMs,
  classifyFailure,
  failureLabel,
  isRetryable,
  retryAfterHint,
  shouldFallback,
} from './failure.js'
import {
  PLAN_SYSTEM,
  buildPlanPrompt,
  buildSystem,
  buildUserPrompt,
  renderFinalDocument,
  renderStepDocument,
} from './prompts.js'
import {
  capabilityCatalog,
  renderCapabilityNotice,
  renderInlineSkills,
  resolveCapabilities,
  type CapabilityCatalog,
  type ToolRestrictionLike,
} from './capabilities.js'
import { TeamStore } from './store.js'
import { TEAM_SCHEMA_VERSION, type TodoItemLite } from './types.js'

/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any

// ── 最小 LLM / subagent 契约（与 automation 同款，避免拉依赖链） ──

interface LlmChunk {
  type: string
  text?: string
  reason?: { kind: string, failure?: { message?: string } }
}

export interface LlmLike {
  stream(opts: {
    provider: string
    model: string
    messages: unknown[]
    system?: string
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<LlmChunk>
}

interface ContentBlockLike { type: string, text?: string }

interface SubagentRunLike {
  /**
   * 本地运行的子会话 id（DSH 规定本地 run.id === 子会话 id）。
   * 用于跟踪子会话日志、把思考/正文增量转发成步骤实时快照；
   * remote provider 的 id 不对应本地会话，读取不到日志则静默无过程流。
   */
  id?: string
  result: Promise<{
    output: ContentBlockLike[]
    structured?: unknown
    stopReason: string
    diagnostic?: string
  }>
  dispose(): Promise<void>
}

interface SubagentRuntimeLike {
  list(): string[]
  start(name: string, request: {
    parent: unknown
    prompt: ContentBlockLike[]
    label?: string
    signal?: AbortSignal
    /** 子 agent 工具可见性限制（DSH SubagentStartRequest.toolFilter）。 */
    toolFilter?: ToolRestrictionLike
  }): Promise<SubagentRunLike>
}

/** 工具 execute 的运行上下文（决定能否走 subagent 通道）。 */
export interface ExecLike {
  agent?: unknown
  signal?: AbortSignal
}

/** 默认单步输出上限。 */
const DEFAULT_MAX_TOKENS = 4096
/** 流式快照写盘节流间隔。 */
const SNAPSHOT_INTERVAL_MS = 500
/** 步骤输出写入快照的截断长度（完整内容在产物文件里）。 */
const SNAPSHOT_OUTPUT_MAX = 4000
/** 输入快照截断长度。 */
const INPUT_SNAPSHOT_MAX = 2000
/** 单步保留的尝试记录条数（更早的轨迹对诊断意义有限）。 */
const MAX_ATTEMPT_RECORDS = 8
/** 主脑自主编排的输出预算与超时（只要一小段 JSON，不需要大预算）。 */
const PLAN_MAX_TOKENS = 1200
const PLAN_TIMEOUT_MS = 90_000

/** 运行中的句柄（内存态，用于取消）。 */
interface ActiveRun {
  runId: string
  controller: AbortController
}

/** 引擎依赖。 */
export interface EngineDeps {
  ctx: AnyContext
  store: TeamStore
}

/** 启动运行的可选执行上下文（工具触发时带 agent → 可用 subagent）。 */
export interface RunContext {
  exec?: ExecLike | null
}

/** 团队运行引擎。 */
export class TeamEngine {
  private readonly ctx: AnyContext
  private readonly store: TeamStore
  private readonly active = new Map<string, ActiveRun>()
  private queue: Array<() => void> = []
  private runningCount = 0
  /** 本次运行的能力目录快照（每个 Run 开始时取一次，避免每步重扫技能目录）。 */
  private catalog: CapabilityCatalog | null = null

  constructor(deps: EngineDeps) {
    this.ctx = deps.ctx
    this.store = deps.store
  }

  /** 当前进行中的运行 id。 */
  activeRunIds(): string[] {
    return [...this.active.keys()]
  }

  /** 请求取消一次运行；返回是否命中。 */
  cancel(runId: string): boolean {
    const handle = this.active.get(runId)
    if (handle === undefined) return false
    handle.controller.abort()
    return true
  }

  /**
   * 启动一次运行：同步创建 run.json（status=queued）并返回快照，
   * 执行在后台推进（调用方无需等待）。
   *
   * 计划来源优先级：input.plan（显式并行波次）> chainId（链，含链内并行组）
   * > roles（临时点兵）。autoPlan=true 时先落一个「编排中」的空壳 run，
   * 由后台先问主脑要计划再填充步骤。
   */
  start(input: StartRunInput, context: RunContext = {}): Run {
    const globals = this.store.readGlobals()
    // 当前团队：显式 teamId 优先；为空时按发起会话的「当前团队」解析（会话级）。
    const team = this.store.resolveTeamForSession(input.teamId, input.sessionId ?? '')
    const merged = effectiveGlobals(globals, team)
    const autoPlan = input.autoPlan === true

    const chain = input.chainId !== undefined && input.chainId !== ''
      ? team.chains.find(c => c.id === input.chainId) ?? null
      : null
    if (input.chainId !== undefined && input.chainId !== '' && chain === null) {
      throw new TeamError(`链条不存在：${input.chainId}`, 'chain_not_found', 404)
    }
    if (!autoPlan) assertTeamRunnable(team, chain)
    else if (team.roles.length === 0) {
      throw new TeamError(`团队「${team.name}」还没有角色，请先添加角色`, 'team_empty', 409)
    }

    const roleIds = new Set(team.roles.map(role => role.id))
    const explicitPlan = input.plan !== undefined
      ? normalizePlan(input.plan, roleIds, { maxPerWave: Math.max(1, merged.maxParallel) })
      : []

    const planned = autoPlan
      ? []
      : explicitPlan.length > 0
        ? planWaves(team, explicitPlan, input.synthesize !== false, merged.maxParallel)
        : chain !== null
          ? planChain(team, chain, merged.maxParallel)
          : planRoles(team, input.roles ?? [], input.synthesize !== false)
    if (!autoPlan && planned.length === 0) {
      throw new TeamError('没有可执行的步骤（链条为空或角色 id 都不存在）', 'plan_empty', 409)
    }

    const task = input.task.trim()
    if (task === '') throw new TeamError('任务描述不能为空', 'task_required', 400)

    const planMode: Run['planMode'] = autoPlan
      ? 'auto'
      : explicitPlan.length > 0 ? 'plan' : chain !== null ? 'chain' : 'roles'

    const runId = this.store.allocRunId()
    const now = new Date().toISOString()
    const run: Run = {
      schemaVersion: TEAM_SCHEMA_VERSION,
      id: runId,
      teamId: team.id,
      teamName: team.name,
      chainId: chain?.id ?? null,
      chainName: chain?.name ?? (autoPlan ? '主脑自主派发' : describePlan(planned)),
      task,
      status: 'queued',
      origin: input.origin ?? 'panel',
      planMode,
      ...(input.sessionId !== undefined && input.sessionId !== '' ? { sessionId: input.sessionId } : {}),
      ...(input.modelOverrides !== undefined ? { modelOverrides: input.modelOverrides } : {}),
      startedAt: now,
      waveCount: waveCountOf(planned),
      steps: planned.map(step => stepSnapshot(step)),
    }
    this.store.saveRun(run)
    this.store.trimRuns()

    // 后台推进（受 maxConcurrentRuns 限制）。
    void this.enqueue(merged.maxConcurrentRuns, async () => {
      await this.execute(runId, team, planned, merged, context, {
        autoPlan,
        synthesize: input.synthesize !== false,
      })
    })
    return run
  }

  /** 并发闸门：超出 maxConcurrentRuns 时排队。 */
  private async enqueue(limit: number, job: () => Promise<void>): Promise<void> {
    if (this.runningCount >= limit) {
      await new Promise<void>((resolve) => { this.queue.push(resolve) })
    }
    this.runningCount += 1
    try {
      await job()
    } finally {
      this.runningCount -= 1
      const next = this.queue.shift()
      if (next !== undefined) next()
    }
  }

  /** 执行整个 Run（按波次推进，波次内并发；每步落盘快照）。 */
  private async execute(
    runId: string,
    team: Team,
    initialPlan: readonly PlannedStep[],
    globals: TeamGlobals,
    context: RunContext,
    options: { autoPlan: boolean, synthesize: boolean, resumeRound?: number },
  ): Promise<void> {
    let run = this.store.readRun(runId)
    if (run === null) return
    const resumeRound = options.resumeRound ?? 0

    const controller = new AbortController()
    this.active.set(runId, { runId, controller })
    const providers = listProviders(this.ctx)
    // 能力目录取一次快照供全部步骤复用（工具表 + 技能表 + 技能包账本）。
    try {
      this.catalog = await capabilityCatalog(this.ctx)
    } catch {
      this.catalog = null
    }

    run = { ...run, status: 'running' }
    this.store.saveRun(run)

    let planned = initialPlan
    let failed = false
    /** run 级异常信息（不能只写进局部 run：后续会重读磁盘，会把它覆盖掉）。 */
    let runError = ''

    // ── autoPlan：先让主脑给出派发计划，再据此填充步骤 ──
    if (options.autoPlan) {
      try {
        const decided = await this.askForPlan(team, run.task, globals, controller.signal, providers)
        planned = planWaves(team, decided.waves, options.synthesize, globals.maxParallel)
        if (planned.length === 0) {
          // 主脑没给出可用分工：退回「全体非主脑角色串行 + 整合」，不让运行空转。
          planned = planRoles(
            team,
            team.roles.filter(role => role.group !== 'core').map(role => role.id),
            options.synthesize,
          )
        }
        run = {
          ...(this.store.readRun(runId) ?? run),
          chainName: describePlan(planned),
          waveCount: waveCountOf(planned),
          ...(decided.note !== '' ? { planNote: decided.note } : {}),
          steps: planned.map(step => stepSnapshot(step)),
        }
        this.store.saveRun(run)
      } catch (error) {
        runError = `主脑编排失败：${error instanceof Error ? error.message : String(error)}`
        this.store.saveRun({
          ...(this.store.readRun(runId) ?? run),
          status: 'error',
          finishedAt: new Date().toISOString(),
          error: runError,
          errorKind: classifyFailure(runError),
        })
        this.active.delete(runId)
        return
      }
    }

    try {
      for (const wave of groupByWave(planned)) {
        if (controller.signal.aborted) break
        const outcomes = wave.length === 1
          ? [await this.runStep({
              runId, team, planned: wave[0], globals, providers, controller, context, peers: [], resumeRound,
            })]
          : await Promise.all(wave.map(step => this.runStep({
            runId,
            team,
            planned: step,
            globals,
            providers,
            controller,
            context,
            peers: wave.filter(other => other.index !== step.index).map(other => other.role.name),
            resumeRound,
          })))
        run = this.store.readRun(runId) ?? run
        if (outcomes.includes('error')) {
          failed = true
          if (globals.stopOnError) break
        }
      }
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error)
      if (runError === '') runError = '运行失败（未提供错误信息）'
      failed = true
    } finally {
      this.active.delete(runId)
    }

    run = this.store.readRun(runId) ?? run
    const cancelled = controller.signal.aborted
    const steps = run.steps.map(step => (
      step.status === 'pending' || step.status === 'running'
        ? { ...step, status: 'skipped' as const }
        : step
    ))
    const status: Run['status'] = cancelled ? 'cancelled' : failed ? 'error' : 'done'

    // 成功且有整合步时，把整合产出写为最终交付物。
    let finalFile = run.finalFile
    if (!cancelled) {
      const synth = [...steps].reverse().find(step => step.synthesize && step.status === 'done')
      const source = synth ?? [...steps].reverse().find(step => step.status === 'done')
      if (source !== undefined) {
        try {
          const full = source.outputFile !== undefined
            ? this.store.readStepOutput(runId, source.outputFile)
            : source.output
          finalFile = this.store.writeFinal(runId, renderFinalDocument(team, run.chainName, run.task, full))
        } catch { /* 交付物写入失败不影响运行结论 */ }
      }
    }

    // 失败原因：优先 run 级异常，否则汇总失败步骤的错误 —— 否则面板/HUD 只能看到
    // 一个没有任何线索的 error 状态（历史缺陷：catch 写进局部 run 后被磁盘重读覆盖）。
    let errorText = ''
    let errorKind: StepErrorKind | undefined
    if (cancelled) {
      errorText = '运行已取消'
      errorKind = 'cancelled'
    } else if (failed) {
      const failedSteps = steps.filter(step => step.status === 'error')
      errorKind = failedSteps.find(step => step.errorKind !== undefined)?.errorKind
        ?? (runError !== '' ? classifyFailure(runError) : 'unknown')
      if (runError !== '') {
        errorText = runError
      } else {
        const reasons = failedSteps
          .map(step => `${step.roleName}：${step.error !== undefined && step.error !== '' ? step.error : '未提供错误信息'}`)
        errorText = reasons.length > 0
          ? reasons.join('；')
          : '运行失败但未采集到具体原因（可能是所有步骤都未开始执行）'
      }
    }

    this.store.saveRun({
      ...run,
      steps,
      status,
      finishedAt: new Date().toISOString(),
      ...(finalFile !== undefined ? { finalFile } : {}),
      ...(errorText !== '' ? { error: errorText } : {}),
      ...(errorKind !== undefined ? { errorKind } : {}),
    })
  }

  /**
   * 一键接续：在**同一个 run 上**重跑所有未完成的步骤（error / skipped / pending /
   * 被中断卡住的 running），已完成步骤的产物与顺序完全保留。
   *
   * 为什么不新建 run：接续的价值就是「只补失败的那一段」——新建 run 会丢掉已完成
   * 步骤的产物，还会让 HUD 里出现两条看起来一样的运行记录。同一个 run 上重跑还能
   * 让上游注入（按 wave 取更早波次的 done 产出）天然成立。
   *
   * 幂等与并发：run 仍在跑（内存里有 active 句柄，或磁盘状态 running/queued）时拒绝；
   * 全部步骤已完成时拒绝（无可接续内容）。
   */
  resume(runId: string, context: RunContext = {}): Run {
    const run = this.store.readRun(runId)
    if (run === null) throw new TeamError(`找不到运行：${runId}`, 'run_not_found', 404)
    if (this.active.has(runId) || run.status === 'running' || run.status === 'queued') {
      throw new TeamError('该运行仍在进行中，无需接续', 'run_active', 409)
    }
    if (!isResumable(run)) {
      throw new TeamError('本次运行的所有步骤都已完成，没有需要接续的内容', 'run_complete', 409)
    }

    const globals = this.store.readGlobals()
    const team = this.store.resolveTeamForSession(run.teamId, run.sessionId ?? '')
    const merged = effectiveGlobals(globals, team)
    const { planned, missing } = planResume(team, run)
    if (planned.length === 0) {
      throw new TeamError(
        missing.length > 0
          ? `未完成步骤的角色已从团队中删除（${missing.join('、')}），无法接续`
          : '没有可接续的步骤',
        'resume_empty', 409,
      )
    }

    const resumeCount = (run.resumeCount ?? 0) + 1
    const resumedAt = new Date().toISOString()
    /** 把待重跑步骤复位成 pending（清掉上一轮的错误痕迹，保留已完成步骤原样）。 */
    const retryIndexes = new Set(planned.map(step => step.index))
    const next: Run = {
      ...run,
      status: 'queued',
      resumeCount,
      resumedAt,
      finishedAt: undefined as unknown as string,
      steps: run.steps.map(step => (retryIndexes.has(step.index)
        ? {
            ...step,
            status: 'pending' as const,
            output: '',
            outputChars: 0,
            error: '',
            errorKind: undefined as unknown as StepErrorKind,
            phase: undefined as unknown as StepPhase,
            phaseNote: '',
            retries: 0,
            attempts: [],
            resumeRound: resumeCount,
            startedAt: undefined as unknown as string,
            finishedAt: undefined as unknown as string,
          }
        : step)),
      error: missing.length > 0 ? `已跳过被删除角色的步骤：${missing.join('、')}` : '',
      errorKind: undefined as unknown as StepErrorKind,
    }
    // 用 JSON 往返抹掉 undefined 字段，避免 run.json 里留下 "finishedAt": null。
    const cleaned = JSON.parse(JSON.stringify(next)) as Run
    this.store.saveRun(cleaned)

    void this.enqueue(merged.maxConcurrentRuns, async () => {
      await this.execute(runId, team, planned, merged, context, {
        autoPlan: false,
        synthesize: true,
        resumeRound: resumeCount,
      })
    })
    return cleaned
  }

  /** 执行单步；返回 'done' | 'error' | 'skipped'。 */
  private async runStep(args: {
    runId: string
    team: Team
    planned: PlannedStep
    globals: TeamGlobals
    providers: readonly ProviderView[]
    controller: AbortController
    context: RunContext
    /** 同波次并行伙伴的展示名（写进提示词，避免重复劳动）。 */
    peers: readonly string[]
    /** 接续轮次（0 = 首轮运行）。 */
    resumeRound?: number
  }): Promise<'done' | 'error' | 'skipped'> {
    const { runId, team, planned, globals, providers, controller, context, peers } = args
    const resumeRound = args.resumeRound ?? 0
    const startedAt = new Date().toISOString()

    let run = this.store.readRun(runId)
    if (run === null) return 'skipped'

    /** 阶段写入助手（phase + 说明 + 进入时间，UI 用来显示「现在在干什么、持续多久」）。 */
    const setPhase = (phase: StepPhase, note?: string): void => {
      this.patchStep(runId, planned.index, {
        phase,
        phaseSince: new Date().toISOString(),
        ...(note !== undefined ? { phaseNote: note } : { phaseNote: '' }),
      })
    }

    this.patchStep(runId, planned.index, {
      status: 'running',
      startedAt,
      phase: 'resolving',
      phaseSince: startedAt,
      phaseNote: '解析模型与能力装配',
      error: '',
      ...(resumeRound > 0 ? { resumeRound } : {}),
    })

    // 1) 解析模型候选序列（主模型 + 备用链）。失败 → 本步 error，给可操作提示。
    let candidates: ModelCandidate[]
    try {
      candidates = resolveCandidates({
        ctx: this.ctx, team, role: planned.role, globals,
        ...(run.modelOverrides !== undefined ? { modelOverrides: run.modelOverrides } : {}),
      }, providers, { autoFallback: globals.autoFallback })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.patchStep(runId, planned.index, {
        status: 'error',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: message,
        errorKind: classifyFailure(message),
        phase: 'resolving',
        phaseNote: '',
      })
      return 'error'
    }

    // 2) 装配 prompt。
    // 上游只取**更早波次**的产出：同波伙伴与自己同时开跑，产出尚不存在，
    // 也不该被引用（否则会读到别人半截的流式快照）。
    const previous = run.steps.filter(step => waveOf(step) < planned.wave)
    let system = buildSystem(team, planned.role, planned.synthesize)
    const userPrompt = buildUserPrompt(team, planned, run.task, previous, globals, run.chainName, peers)

    // 3) 选通道。
    const channel = this.pickChannel(planned.role.executor, context)
    const warnings: string[] = []
    if (channel === 'subagent') {
      warnings.push('subagent 通道的模型继承父会话，团队/角色模型设置不生效')
    } else if (planned.role.executor === 'subagent') {
      warnings.push('无 agent 上下文，已降级为 llm 直跑（本步无工具能力）')
    }

    // 3.5) 解析角色能力装配（工具 + 技能），拼进 system；subagent 通道另交 toolFilter。
    let toolFilter: ToolRestrictionLike | null = null
    let capabilityInfo: RunStep['capabilities']
    try {
      const resolvedCaps = await resolveCapabilities(this.ctx, planned.role, this.catalog ?? undefined)
      toolFilter = resolvedCaps.toolFilter
      const notice = renderCapabilityNotice(resolvedCaps, channel)
      const inlineSkills = channel === 'llm' ? await renderInlineSkills(this.ctx, resolvedCaps) : ''
      const extra = [notice, inlineSkills].filter(part => part !== '').join('\n\n')
      if (extra !== '') system = `${system}\n\n${extra}`
      if (resolvedCaps.toolMode !== 'inherit' || resolvedCaps.skillMode !== 'inherit') {
        capabilityInfo = {
          toolMode: resolvedCaps.toolMode,
          tools: resolvedCaps.toolNames,
          skillMode: resolvedCaps.skillMode,
          skills: resolvedCaps.skillNames,
          ...(resolvedCaps.missingTools.length > 0 ? { missingTools: resolvedCaps.missingTools } : {}),
          ...(resolvedCaps.missingSkills.length > 0 ? { missingSkills: resolvedCaps.missingSkills } : {}),
          ...(channel === 'llm' && resolvedCaps.toolMode !== 'inherit'
            ? { note: 'llm 直跑通道无工具执行能力，工具装配仅作提示声明' }
            : {}),
        }
      }
      if (resolvedCaps.missingTools.length > 0 || resolvedCaps.missingSkills.length > 0) {
        warnings.push(`装配清单有当前环境缺失项：${[...resolvedCaps.missingTools, ...resolvedCaps.missingSkills].join('、')}`)
      }
      if (channel === 'llm' && resolvedCaps.skillMode === 'allow' && inlineSkills !== '') {
        warnings.push('技能正文已内联进提示词（llm 通道无 skill 工具）')
      }
    } catch {
      // 能力解析失败不阻断执行：按「完全继承」跑。
    }

    const warning = warnings.length > 0 ? warnings.join('；') : undefined

    this.patchStep(runId, planned.index, {
      inputSnapshot: userPrompt.slice(0, INPUT_SNAPSHOT_MAX),
      modelUsed: candidates[0].binding,
      modelSource: candidates[0].source,
      channel,
      ...(capabilityInfo !== undefined ? { capabilities: capabilityInfo } : {}),
      ...(warning !== undefined ? { warning } : {}),
    })

    // 4) 执行：候选模型（主 → 备用）× 每个候选的重试（带归类退避）。
    //    只有「原地重试有意义」的失败才退避重试；只有「换模型有救」的失败才降级
    //    到备用模型 —— 鉴权/额度不足这类错误在同一个供应商上重试纯属浪费时间。
    const maxAttempts = Math.max(1, globals.maxRetries + 1)
    const attempts: StepAttempt[] = []
    let totalTries = 0
    let lastError = ''
    let lastKind: StepErrorKind = 'unknown'

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex]
      if (controller.signal.aborted) return 'skipped'
      if (candidate.fallback) {
        this.patchStep(runId, planned.index, {
          modelUsed: candidate.binding,
          modelSource: candidate.source,
          fallbackUsed: true,
        })
        setPhase('dispatch', `已降级到备用模型 ${candidate.binding.model}（原因：${failureLabel(lastKind)}）`)
      } else {
        setPhase('dispatch', channel === 'subagent' ? '已派发子 agent，等待响应' : '已下发请求，等待首个响应')
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (controller.signal.aborted) return 'skipped'
        totalTries += 1
        const tryStartedAt = new Date().toISOString()
        try {
          const text = await this.invoke({
            channel,
            binding: candidate.binding,
            system,
            userPrompt,
            globals,
            controller,
            context,
            toolFilter,
            label: `${team.name} · ${planned.role.name}`,
            runId,
            stepIndex: planned.index,
            onDelta: (accumulated) => {
              this.patchStep(runId, planned.index, {
                output: tailSnapshot(accumulated),
                outputChars: accumulated.length,
              })
            },
            onPhase: (phase, note) => { setPhase(phase, note) },
          })
          setPhase('saving', '产物落盘中')
          const outputFile = this.store.writeStepOutput(
            runId, planned.index, planned.role.id,
            renderStepDocument(team, planned, text, {
              provider: candidate.binding.provider, model: candidate.binding.model,
              source: candidate.source, channel, startedAt,
            }),
          )
          attempts.push({
            attempt: totalTries,
            model: candidate.binding,
            fallback: candidate.fallback,
            status: 'done',
            startedAt: tryStartedAt,
            finishedAt: new Date().toISOString(),
          })
          this.patchStep(runId, planned.index, {
            status: 'done',
            output: tailSnapshot(text),
            outputChars: text.length,
            outputFile,
            finishedAt: new Date().toISOString(),
            phase: 'saving',
            phaseNote: '',
            error: '',
            attempts: attempts.slice(-MAX_ATTEMPT_RECORDS),
            ...(totalTries > 1 ? { retries: totalTries - 1 } : {}),
          })
          return 'done'
        } catch (error) {
          if (controller.signal.aborted) return 'skipped'
          lastError = error instanceof Error ? error.message : String(error)
          if (lastError === '') lastError = '未提供错误信息'
          lastKind = classifyFailure(lastError)
          const retrySame = attempt < maxAttempts && isRetryable(lastKind)
          const canFallback = candidateIndex + 1 < candidates.length && shouldFallback(lastKind)
          const wait = retrySame ? backoffMs(lastKind, attempt, retryAfterHint(lastError)) : 0
          attempts.push({
            attempt: totalTries,
            model: candidate.binding,
            fallback: candidate.fallback,
            status: 'error',
            errorKind: lastKind,
            error: lastError.slice(0, 400),
            startedAt: tryStartedAt,
            finishedAt: new Date().toISOString(),
            ...(wait > 0 ? { backoffMs: wait } : {}),
          })
          this.patchStep(runId, planned.index, {
            retries: totalTries - 1,
            error: `${failureLabel(lastKind)}：${lastError}`,
            errorKind: lastKind,
            attempts: attempts.slice(-MAX_ATTEMPT_RECORDS),
          })
          if (retrySame) {
            setPhase('retrying', `${failureLabel(lastKind)}，${Math.round(wait / 1000)}s 后重试（第 ${totalTries + 1} 次尝试）`)
            const alive = await delay(wait, controller.signal)
            if (!alive) return 'skipped'
            continue
          }
          if (canFallback) break
          // 既不能原地重试也没有可换的模型：本步到此为止。
          candidateIndex = candidates.length
          break
        }
      }
      if (!shouldFallback(lastKind)) break
    }

    this.patchStep(runId, planned.index, {
      status: 'error',
      finishedAt: new Date().toISOString(),
      error: `${failureLabel(lastKind)}：${lastError}`,
      errorKind: lastKind,
      retries: Math.max(0, totalTries - 1),
      attempts: attempts.slice(-MAX_ATTEMPT_RECORDS),
      phase: 'retrying',
      phaseNote: '',
    })
    return 'error'
  }

  /** 通道选择（docs §4.3）。 */
  private pickChannel(pref: string, context: RunContext): 'llm' | 'subagent' {    const hasAgent = context.exec?.agent !== undefined
    const runtime = this.subagents()
    const canSubagent = hasAgent && runtime !== null && runtime.list().length > 0
    if (pref === 'llm') return 'llm'
    if (pref === 'subagent') return canSubagent ? 'subagent' : 'llm'
    return canSubagent ? 'subagent' : 'llm'
  }

  /**
   * 取 subagents 运行时；不可用时返回 null（角色降级为 llm 直跑）。
   *
   * 必须走 `ctx.get('subagents')`：cordis 对**未在 inject 声明**的服务做裸属性访问
   * （`ctx.subagents`）会直接抛 `cannot get property "subagents" without inject`，
   * 而该异常发生在 pickChannel 里、runStep 的 try 之外 —— 整个运行会在第一步就崩，
   * 表现为「秒失败、所有步骤 skipped、连模型都没解析」。`ctx.get()` 对缺失服务返回
   * undefined，可安全降级。
   */
  private subagents(): SubagentRuntimeLike | null {
    let runtime: SubagentRuntimeLike | undefined
    try {
      runtime = this.ctx.get?.('subagents') as SubagentRuntimeLike | undefined
    } catch {
      return null
    }
    return runtime !== undefined && runtime !== null && typeof runtime.list === 'function' ? runtime : null
  }

  /**
   * 主脑自主派发：问一次模型要「波次计划」。
   *
   * 走 llm 直跑通道（要的是结构化 JSON，不需要工具），模型按主脑角色解析
   * （core 角色覆盖 → 团队默认 → 全局默认）。解析失败/角色名不合法的项被丢弃，
   * 全部无效时返回空波次由调用方兜底。
   */
  private async askForPlan(
    team: Team,
    task: string,
    globals: TeamGlobals,
    signal: AbortSignal,
    providers: readonly ProviderView[],
  ): Promise<{ waves: PlanWaveItem[][], note: string }> {
    const core = findCoreRole(team)
    if (core === null) throw new TeamError('团队没有主脑角色（core 分组），无法自主编排', 'no_core_role', 409)
    const { binding } = resolveModelChecked({ ctx: this.ctx, team, role: core, globals }, providers)

    const stepController = new AbortController()
    const onAbort = (): void => stepController.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => stepController.abort(), PLAN_TIMEOUT_MS)
    let text = ''
    try {
      text = await this.invokeLlm(
        { ...binding, maxTokens: PLAN_MAX_TOKENS },
        PLAN_SYSTEM,
        buildPlanPrompt(team, task, globals.maxParallel),
        stepController.signal,
        () => {},
      )
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }

    const parsed = extractJsonObject(text)
    const roleIds = new Set(team.roles.filter(role => role.id !== core.id).map(role => role.id))
    const waves = normalizePlan(parsed.waves, roleIds, {
      maxWaves: 4,
      maxPerWave: Math.max(1, globals.maxParallel),
    })
    const note = typeof parsed.note === 'string' ? parsed.note.trim().slice(0, 300) : ''
    return { waves, note }
  }

  /** 调用一次通道（统一超时 + 取消语义）。 */
  private async invoke(args: {
    channel: 'llm' | 'subagent'
    binding: ModelBinding
    system: string
    userPrompt: string
    globals: TeamGlobals
    controller: AbortController
    context: RunContext
    /** 角色工具装配（仅 subagent 通道生效）。 */
    toolFilter: ToolRestrictionLike | null
    label: string
    runId: string
    stepIndex: number
    onDelta: (accumulated: string) => void
    /** 阶段变更回调（thinking / writing / tooling）。 */
    onPhase?: (phase: StepPhase, note?: string) => void
  }): Promise<string> {
    const {
      channel, binding, system, userPrompt, globals, controller, context, toolFilter,
      label, runId, stepIndex, onDelta, onPhase,
    } = args
    const stepController = new AbortController()
    const onAbort = (): void => stepController.abort()
    controller.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => stepController.abort(), globals.timeoutSec * 1000)
    try {
      if (channel === 'subagent') {
        const text = await this.invokeSubagent(
          `${system}\n\n---\n\n${userPrompt}`,
          label, context, stepController.signal, toolFilter,
          {
            onDelta,
            onTodos: (todos) => { this.patchStep(runId, stepIndex, { todos }) },
            ...(onPhase !== undefined ? { onPhase } : {}),
          },
        )
        onDelta(text)
        return text
      }
      return await this.invokeLlm(binding, system, userPrompt, stepController.signal, onDelta, onPhase)
    } catch (error) {
      if (controller.signal.aborted) throw new TeamError('运行已取消', 'cancelled', 409)
      if (stepController.signal.aborted) throw new TeamError(`本步超时（${globals.timeoutSec}s）`, 'step_timeout', 504)
      throw error
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }

  /** llm 直跑：累积 text-delta，节流写快照。 */
  private async invokeLlm(
    binding: ModelBinding,
    system: string,
    userPrompt: string,
    signal: AbortSignal,
    onDelta: (accumulated: string) => void,
    onPhase?: (phase: StepPhase, note?: string) => void,
  ): Promise<string> {
    const llm = this.ctx.get?.('llm') as LlmLike | undefined
    if (llm === undefined) throw new TeamError('llm 服务不可用', 'llm_unavailable', 503)
    const messages = [createUserMessage({
      content: [{ type: 'text', text: userPrompt }],
      source: { kind: 'plugin', plugin: 'dsh-webui' },
    })]
    let out = ''
    let lastFlush = 0
    /** 已上报的阶段（避免每个 chunk 都写盘）。 */
    let phase: StepPhase | null = null
    const reportPhase = (next: StepPhase, note?: string): void => {
      if (phase === next) return
      phase = next
      onPhase?.(next, note)
    }
    for await (const chunk of llm.stream({
      provider: binding.provider,
      model: binding.model,
      messages,
      system,
      maxTokens: binding.maxTokens ?? DEFAULT_MAX_TOKENS,
      signal,
    })) {
      if (chunk.type === 'reasoning-delta') {
        reportPhase('thinking', '模型正在推理')
        continue
      }
      if (chunk.type === 'text-delta') {
        reportPhase('writing', '正在产出正文')
        out += chunk.text ?? ''
        const now = Date.now()
        if (now - lastFlush >= SNAPSHOT_INTERVAL_MS) {
          lastFlush = now
          onDelta(out)
        }
        continue
      }
      if (chunk.type !== 'finish') continue
      const reason = chunk.reason
      if (reason === undefined) continue
      if (reason.kind === 'error') throw new Error(reason.failure?.message ?? '模型调用失败')
      if (reason.kind === 'aborted') throw new Error('模型调用被中止')
      if (reason.kind !== 'stop' && reason.kind !== 'max-tokens') {
        throw new Error(`模型未正常结束：${reason.kind}`)
      }
    }
    if (out.trim() === '') {
      throw new Error(`模型未返回内容（${binding.provider}/${binding.model}）`)
    }
    onDelta(out)
    return out
  }

  /**
   * subagent 通道：完整 agent（有工具），模型继承父会话。
   * `toolFilter` 非空时经 `subagents.start({ toolFilter })` 真实限制子 agent 的工具可见性
   * （被限制的工具从子 agent 提示词消失且拒绝执行）；provider 不支持该能力时降级为不限制。
   */
  private async invokeSubagent(
    prompt: string,
    label: string,
    context: RunContext,
    signal: AbortSignal,
    toolFilter: ToolRestrictionLike | null,
    /** 过程流出口：子会话的思考/正文增量实时转发（写步骤快照）。 */
    handlers: {
      onDelta: (accumulated: string) => void
      onTodos: (todos: TodoItemLite[]) => void
      onPhase?: (phase: StepPhase, note?: string) => void
    },
  ): Promise<string> {
    const runtime = this.subagents()
    if (runtime === null) throw new TeamError('subagents 服务不可用', 'subagent_unavailable', 503)
    const names = runtime.list()
    if (names.length === 0) throw new TeamError('没有可用的 subagent provider', 'subagent_none', 503)
    const parent = context.exec?.agent
    if (parent === undefined) throw new TeamError('当前无 agent 上下文，无法派发 subagent', 'no_agent', 409)
    const request = {
      parent,
      prompt: [{ type: 'text', text: prompt }],
      label,
      signal,
      ...(toolFilter !== null ? { toolFilter } : {}),
    }
    let run: SubagentRunLike
    try {
      run = await runtime.start(names[0], request)
    } catch (error) {
      // provider 不支持 toolFilter 能力时（capability 校验拒绝）降级重试一次，不限制工具。
      if (toolFilter !== null) {
        run = await runtime.start(names[0], { parent, prompt: request.prompt, label, signal })
      } else {
        throw error
      }
    }
    // 跟踪子会话日志：框架只回传最终文本，但本地子会话的事件流（思考/正文
    // 增量、todo_write 任务清单）持续落盘 —— 用水位线读原语把过程实时转发，
    // 用户不用干等，HUD/详情卡能看到子 agent 正在做什么、清单完成了什么。
    const stopTail = this.tailSubagentSession(run.id, handlers, signal)
    try {
      const result = await run.result
      if (result.stopReason !== 'completed' && result.stopReason !== 'max-tokens') {
        throw new Error(`subagent 未正常结束：${result.stopReason}${result.diagnostic !== undefined ? ` — ${result.diagnostic}` : ''}`)
      }
      const text = (Array.isArray(result.output) ? result.output : [])
        .filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join('\n')
        .trim()
      if (text === '') throw new Error('subagent 未返回内容')
      return text
    } finally {
      stopTail()
      await run.dispose()
    }
  }

  /**
   * 跟踪子 agent 会话日志，把思考/正文增量与任务清单转发给上层。
   *
   * 实现：sessionPersistence.readFrom(id, watermark) 是官方的「从水位线读后缀」
   * 原语（SQLite 后端只物理读后缀），每秒轮询一次：
   *  - assistant/chunk 的 reasoning-delta / text-delta → 拼成 Markdown 快照
   *    （思考为引用块、正文原样）经 handlers.onDelta 写进 run.json；
   *  - tool/call 的 todo_write → 解析其 todos 参数经 handlers.onTodos 写入步骤
   *    的结构化字段 —— HUD 卡与详情卡即可像对话流一样看到子 agent 的过程。
   * 子会话 id 拿不到 / 后端不支持 / 日志未就绪时静默降级零过程流。
   */
  private tailSubagentSession(
    childId: string | undefined,
    handlers: {
      onDelta: (accumulated: string) => void
      onTodos: (todos: TodoItemLite[]) => void
      onPhase?: (phase: StepPhase, note?: string) => void
    },
    signal: AbortSignal,
  ): () => void {
    if (childId === undefined || childId === '') return () => {}
    const persistence = this.ctx.get?.('sessionPersistence') as {
      readFrom?: (id: string, fromSeq: number, signal?: AbortSignal) => Promise<{ events?: unknown[] }>
    } | undefined
    if (persistence?.readFrom === undefined) return () => {}
    let stopped = false
    let watermark = 0
    let thinking = ''
    let answer = ''
    let todos: TodoItemLite[] | null = null
    /** 已上报阶段（同一阶段不重复写盘）。 */
    let phase: StepPhase | null = null
    const reportPhase = (next: StepPhase, note?: string): void => {
      // 工具调用会反复发生（每次工具名不同），tooling 阶段允许带新 note 重报。
      if (phase === next && next !== 'tooling') return
      phase = next
      handlers.onPhase?.(next, note)
    }
    const renderSnapshot = (): string => {
      // 思考可能极长：快照只保留尾部（进行中看最新思路最有用）。
      const thinkTail = thinking.length > 2400 ? `…${thinking.slice(-2400)}` : thinking
      const parts: string[] = []
      if (thinkTail.trim() !== '') {
        parts.push(`> 🧠 **思考**\n>\n> ${thinkTail.trim().replace(/\n/g, '\n> ')}`)
      }
      if (answer.trim() !== '') parts.push(answer)
      return parts.join('\n\n')
    }
    void (async (): Promise<void> => {
      while (!stopped && !signal.aborted) {
        try {
          const inspection = await persistence.readFrom!(childId, watermark, signal)
          const events = Array.isArray(inspection?.events) ? inspection.events : []
          let grew = false
          for (const event of events) {
            const e = event as {
              seq?: number
              type?: string
              data?: {
                chunk?: { type?: string, text?: string }
                name?: string
                arguments?: string
              }
            }
            if (typeof e.seq === 'number' && e.seq > watermark) watermark = e.seq
            // 任务清单：todo_write 工具调用（arguments 为 JSON 字符串）。
            if (e.type === 'tool/call' && e.data?.name === 'todo_write' && typeof e.data.arguments === 'string') {
              const parsedTodos = parseTodoWriteArgs(e.data.arguments)
              if (parsedTodos !== null) {
                todos = parsedTodos
                handlers.onTodos(todos)
              }
              continue
            }
            // 其它工具调用 → tooling 阶段（把工具名报给 UI，用户能看到「在跑 pwsh / 在读文件」）。
            if (e.type === 'tool/call' && typeof e.data?.name === 'string' && e.data.name !== '') {
              reportPhase('tooling', `正在调用工具 ${e.data.name}`)
              continue
            }
            // 思考/正文增量。
            const chunk = e.data?.chunk
            if (e.type !== 'assistant/chunk' || chunk === null || typeof chunk !== 'object') continue
            if (typeof chunk.text !== 'string' || chunk.text === '') continue
            if (chunk.type === 'reasoning-delta') {
              thinking += chunk.text
              grew = true
              reportPhase('thinking', '子 agent 正在推理')
            } else if (chunk.type === 'text-delta') {
              answer += chunk.text
              grew = true
              reportPhase('writing', '子 agent 正在产出正文')
            }
          }
          if (grew) handlers.onDelta(renderSnapshot())
        } catch {
          // 会话日志尚未就绪 / 后端不支持 / 已取消：静默重试或退出。
          if (signal.aborted) break
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    })()
    return () => { stopped = true }
  }

  /**
   * 原子更新某步字段（读—改—写 run.json）。
   *
   * 并行波次里多个步骤会交替调用本方法：readRun/saveRun 都是同步 fs 调用，
   * Node 单线程下这段读—改—写不会被其它 JS 打断，所以并发步骤各自只改自己
   * 那一项、互不覆盖（写盘本身也是 tmp+rename 原子替换）。
   */
  private patchStep(runId: string, index: number, patch: Partial<RunStep>): void {
    const run = this.store.readRun(runId)
    if (run === null) return
    const steps = run.steps.map(step => (step.index === index ? { ...step, ...patch } : step))
    try {
      this.store.saveRun({ ...run, steps })
    } catch { /* 写盘失败不打断执行 */ }
  }
}

/** 计划步 → 初始快照。 */
function stepSnapshot(step: PlannedStep): RunStep {
  return {
    index: step.index,
    wave: step.wave,
    roleId: step.role.id,
    roleName: step.synthesize ? `${step.role.name}（整合）` : step.role.name,
    tagline: step.role.tagline,
    group: step.role.group,
    synthesize: step.synthesize,
    status: 'pending',
    inputSnapshot: '',
    output: '',
    modelUsed: { provider: '', model: '' },
    modelSource: 'team',
  }
}

/** 读快照的波次（旧快照没有 wave 字段时按 index 兜底 = 全串行）。 */
function waveOf(step: RunStep): number {
  return typeof step.wave === 'number' ? step.wave : step.index
}

/**
 * 可取消的等待：返回 false 表示等待期间被取消（调用方应放弃本步）。
 * 退避重试必须用它而不是裸 setTimeout —— 否则用户点「取消运行」后还要干等一分钟。
 */
function delay(ms: number, signal: AbortSignal): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(!signal.aborted)
  if (signal.aborted) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(!signal.aborted)
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 把计划按 wave 分组（升序），同组内保持 index 顺序。 */
function groupByWave(planned: readonly PlannedStep[]): PlannedStep[][] {
  const buckets = new Map<number, PlannedStep[]>()
  for (const step of planned) {
    const list = buckets.get(step.wave)
    if (list === undefined) buckets.set(step.wave, [step])
    else list.push(step)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, steps]) => steps.sort((a, b) => a.index - b.index))
}

/** 从模型输出里稳健提取 JSON 对象（容忍 markdown 围栏与前后缀噪声）。 */
function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new TeamError('主脑没有返回合法的计划 JSON', 'plan_bad_json', 502)
  }
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TeamError('主脑返回的计划不是 JSON 对象', 'plan_bad_json', 502)
  }
  return parsed as Record<string, unknown>
}

/** 快照输出：保留尾部（流式进行中看最新内容最有用）。 */
function tailSnapshot(text: string): string {
  if (text.length <= SNAPSHOT_OUTPUT_MAX) return text
  return `…（前文已截断）\n${text.slice(-SNAPSHOT_OUTPUT_MAX)}`
}

/** todo_write 的 arguments（JSON 字符串）→ 任务清单投影；非法/空列表返回 null。 */
function parseTodoWriteArgs(raw: string): TodoItemLite[] | null {
  try {
    const parsed = JSON.parse(raw) as { todos?: unknown }
    if (!Array.isArray(parsed.todos)) return null
    const items: TodoItemLite[] = []
    for (const item of parsed.todos) {
      const it = (item ?? {}) as { content?: unknown, status?: unknown }
      const content = typeof it.content === 'string' ? it.content.trim() : ''
      if (content === '') continue
      const status = it.status === 'in_progress' || it.status === 'completed' || it.status === 'pending'
        ? it.status
        : 'pending'
      items.push({ content, status })
    }
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}
