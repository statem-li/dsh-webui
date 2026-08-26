/**
 * team — Agent 工具（host 半身）。
 *
 * 三个工具：
 *  - team_list：列出可用团队与其角色/链（模型自选合适团队与链）。
 *  - team_run ：启动一次团队接力执行；**同步等待完成**并返回最终交付物摘要
 *               （工具触发天然带 agent 上下文 → 角色可走 subagent 通道，有工具能力）。
 *  - team_status：查看某次/最近一次运行的状态与每步模型来源。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TeamEngine } from './engine.js'
import type { TeamStore } from './store.js'
import { generateTeam } from './generate.js'
import { runProgress } from './roster.js'
import type { ModelBinding, Run, Team } from './types.js'
import { normalizeBinding } from './types.js'

/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any

/** 轮询等待运行结束的间隔与上限。 */
const POLL_MS = 1000
/** 工具内等待上限（超时后返回「仍在运行」，不杀运行）。 */
const WAIT_LIMIT_MS = 20 * 60 * 1000

export interface TeamToolDeps {
  ctx: AnyContext
  store: TeamStore
  engine: TeamEngine
}

/** 团队视图（给模型看）。 */
function presentTeam(team: Team): Record<string, unknown> {
  return {
    id: team.id,
    name: team.name,
    ...(team.description !== undefined ? { description: team.description } : {}),
    defaultModel: team.model.provider !== '' ? `${team.model.provider}/${team.model.model}` : '(未设置，用全局默认)',
    roles: team.roles.map(role => ({
      id: role.id,
      name: role.name,
      tagline: role.tagline,
      group: role.group,
      model: role.model !== null ? `${role.model.provider}/${role.model.model}` : '继承团队',
      executor: role.executor,
    })),
    chains: team.chains.map(chain => ({
      id: chain.id,
      name: chain.name,
      // 并行组用 A‖B 表示：同一波次的角色会同时开跑。
      steps: describeChainSteps(chain),
      finalSynthesize: chain.finalSynthesize,
    })),
  }
}

/** 链步骤的可读路径（并行组合并成 `a‖b`）。 */
function describeChainSteps(chain: Team['chains'][number]): string[] {
  const out: string[] = []
  for (const step of chain.steps) {
    const label = step.kind === 'synthesize' ? '主脑整合' : step.roleId
    if (step.kind === 'role' && step.parallel === true && out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]}‖${label}`
      continue
    }
    out.push(label)
  }
  return out
}

/** 运行视图（给模型看）。 */
function presentRun(run: Run): Record<string, unknown> {
  const progress = runProgress(run)
  return {
    runId: run.id,
    team: run.teamName,
    chain: run.chainName,
    task: run.task,
    status: run.status,
    progress: `${progress.done}/${progress.total}`,
    ...(run.planMode !== undefined ? { planMode: run.planMode } : {}),
    ...(run.planNote !== undefined ? { planNote: run.planNote } : {}),
    ...(run.waveCount !== undefined && run.waveCount < run.steps.length
      ? { waves: `${run.waveCount} 个波次（存在并行）` }
      : {}),
    startedAt: run.startedAt,
    ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
    ...(run.error !== undefined ? { error: run.error } : {}),
    steps: run.steps.map(step => ({
      index: step.index + 1,
      ...(step.wave !== undefined ? { wave: step.wave + 1 } : {}),
      role: step.roleName,
      status: step.status,
      model: step.modelUsed.provider !== '' ? `${step.modelUsed.provider}/${step.modelUsed.model}` : '',
      modelSource: step.modelSource,
      channel: step.channel ?? '',
      ...(step.warning !== undefined ? { warning: step.warning } : {}),
      ...(step.error !== undefined ? { error: step.error } : {}),
      ...(step.outputFile !== undefined ? { outputFile: `steps/${step.outputFile}` } : {}),
    })),
    ...(run.finalFile !== undefined ? { finalDeliverable: run.finalFile } : {}),
  }
}

/** 解析 modelOverrides 入参：支持数组形式 ["cha=provider/model"] 与对象形式。 */
function parseOverrides(input: unknown): Record<string, ModelBinding> | undefined {
  const out: Record<string, ModelBinding> = {}
  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item !== 'string') continue
      const eq = item.indexOf('=')
      if (eq <= 0) continue
      const roleId = item.slice(0, eq).trim()
      const binding = normalizeBinding(item.slice(eq + 1).trim())
      if (roleId !== '' && binding !== null && binding.provider !== '' && binding.model !== '') {
        out[roleId] = binding
      }
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  if (input === null || typeof input !== 'object') return undefined
  for (const [roleId, value] of Object.entries(input as Record<string, unknown>)) {
    const binding = normalizeBinding(value)
    if (binding !== null && binding.provider !== '' && binding.model !== '') out[roleId] = binding
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * 取调用方会话 id（工具 exec 上下文里带当前 agent，其 `id` 即 SessionId）。
 * 拿不到时返回空串。
 */
function execSessionId(exec: unknown): string {
  const agent = (exec as { agent?: { id?: unknown } } | undefined)?.agent
  const id = agent?.id
  return typeof id === 'string' ? id : ''
}

/** 注册三个团队工具；返回合并 disposer。 */
export function registerTeamTools({ ctx, store, engine }: TeamToolDeps): () => void {
  const disposers: Array<() => void> = []

  // ── team_list ──
  disposers.push(ctx.tools.register(defineTool({
    name: 'team_list',
    description: '列出可用的多智能体团队及其角色、协作链与模型配置。在开启团队模式、或需要决定把任务交给哪个团队/哪条链之前调用。',
    parameters: {
      teamId: { type: 'string', description: '只看某个团队时传它的 id；留空列出全部。' },
    },
    async execute(args) {
      const params = args as unknown as Record<string, unknown>
      const teamId = typeof params.teamId === 'string' ? params.teamId.trim() : ''
      if (teamId !== '') {
        return JSON.stringify(presentTeam(store.readTeam(teamId)), null, 2)
      }
      const globals = store.readGlobals()
      const teams = store.listTeamIds()
        .map(id => store.tryReadTeam(id))
        .filter((r): r is { team: Team } => 'team' in r)
        .map(r => presentTeam(r.team))
      if (teams.length === 0) return '尚无可用团队，请让用户在团队面板新建一个团队。'
      return JSON.stringify({ activeTeamId: globals.activeTeamId, teams }, null, 2)
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    presentCall: args => ({ card: 'generic' as const, kind: 'other' as const, title: '查看团队编制', rawInput: args }),
  })))

  // ── team_run ──
  disposers.push(ctx.tools.register(defineTool({
    name: 'team_run',
    description: [
      '把一个任务交给多智能体团队执行：角色按波次推进——同一波次的角色**并行同时干活**，波次之间串行（后一波看得到前面全部产出），末尾由主脑整合成最终交付物。',
      '适用于需要多角色协作的任务：调研+审查、方案+落地、诊断+修复+验收、取证+成稿等。',
      '三种派发方式（优先级从高到低）：',
      '① plan：自己编排并行计划，形如 [["cha","ping"],["jiang"]] —— 察与评同时跑完，匠再上；互不依赖的工作放同一组能显著省时。',
      '② chainId：用预设协作链（链里可标注并行组）。',
      '③ roles：给一个角色 id 序列，串行接力。',
      '不确定怎么分工时传 autoPlan:true，让主脑先自己出一份并行派发计划再执行。',
      '本工具会等待运行完成并返回最终交付物摘要；产物落盘在团队运行目录，运行进度在对话流团队 HUD 与团队面板实时可见。',
      '简单问答或单步小改动不要用本工具，直接自己回答更快。',
    ].join(''),
    parameters: {
      task: { type: 'string', required: true, description: '交给团队的完整任务描述：目标、边界、验收标准。写得越具体产出越可用。' },
      teamId: { type: 'string', description: '团队 id（先用 team_list 查）。留空使用当前选中团队。' },
      plan: {
        type: 'array',
        items: { type: 'array', items: { type: 'string' } },
        description: '并行派发计划：每个元素是一个波次（同时执行的角色 id 数组），波次之间串行。例 [["cha","ping"],["jiang"]]。优先级高于 chainId/roles。',
      },
      autoPlan: { type: 'boolean', description: 'true = 让主脑先自主编排并行派发计划再执行（不需要你给 plan/chainId/roles）。' },
      chainId: { type: 'string', description: '协作链 id。留空且未给 plan/roles 时自动选用团队第一条链。' },
      roles: { type: 'array', items: { type: 'string' }, description: '临时点兵：角色 id 有序列表（串行接力；与 chainId/plan 互斥）。' },
      synthesize: { type: 'boolean', description: 'plan/roles 派发时是否追加主脑整合步（默认 true）。' },
      modelOverrides: {
        type: 'array',
        items: { type: 'string' },
        description: '本次运行的模型覆盖，每项形如 "角色id=provider/model"（如 "cha=bai/gpt-5.6"）。',
      },
      wait: { type: 'boolean', description: '是否等待运行完成（默认 true）。false 时立即返回 runId，之后用 team_status 查询。' },
    },
    async execute(args, exec) {
      const params = args as unknown as Record<string, unknown>
      // 闸门：对话框团队开关关闭的会话，拒绝把任务转交团队执行。
      // （提示词注入已按会话过滤，这里再兜一道，避免模型凭历史上下文/记忆自行调用。）
      const sessionId = execSessionId(exec)
      if (sessionId !== '' && !store.readChatMode(sessionId).enabled) {
        throw new Error(
          '本会话未开启团队模式（对话框的团队开关是关闭状态），不能调用 team_run。'
          + '请自己直接完成这个任务；确需团队协作时，请用户先在对话框打开团队开关。',
        )
      }
      const task = typeof params.task === 'string' ? params.task.trim() : ''
      if (task === '') throw new Error('task 不能为空')
      const teamId = typeof params.teamId === 'string' ? params.teamId.trim() : ''
      const team = store.resolveTeam(teamId !== '' ? teamId : undefined)

      const roles = Array.isArray(params.roles)
        ? params.roles.filter((r): r is string => typeof r === 'string' && r.trim() !== '').map(r => r.trim())
        : []
      const autoPlan = params.autoPlan === true
      const plan = Array.isArray(params.plan) ? params.plan : undefined
      let chainId = typeof params.chainId === 'string' ? params.chainId.trim() : ''
      // 没给任何派发方式（且没让主脑自主编排）时，退回团队第一条链。
      if (!autoPlan && chainId === '' && roles.length === 0 && plan === undefined) {
        if (team.chains.length === 0) throw new Error(`团队「${team.name}」没有协作链，请传 plan 或 roles 指定角色`)
        chainId = team.chains[0].id
      }
      // plan / autoPlan 优先：显式并行计划下忽略链，避免两种派发语义打架。
      if (autoPlan || plan !== undefined) chainId = ''

      const overrides = parseOverrides(params.modelOverrides)
      const run = engine.start({
        teamId: team.id,
        ...(chainId !== '' ? { chainId } : {}),
        ...(roles.length > 0 && plan === undefined && !autoPlan ? { roles } : {}),
        ...(plan !== undefined ? { plan: plan as never } : {}),
        ...(autoPlan ? { autoPlan: true } : {}),
        task,
        ...(overrides !== undefined ? { modelOverrides: overrides } : {}),
        origin: 'tool',
        ...(sessionId !== '' ? { sessionId } : {}),
        synthesize: params.synthesize !== false,
      }, { exec: exec as any })

      if (params.wait === false) {
        return `已启动团队运行 ${run.id}（${run.teamName} · ${run.chainName}，共 ${run.steps.length} 步）。稍后用 team_status 查询进度。`
      }

      // 等待完成（受工具 signal 影响：调用被中止则停止等待，不杀运行）。
      const deadline = Date.now() + WAIT_LIMIT_MS
      let latest = run
      while (Date.now() < deadline) {
        await new Promise((resolve) => { setTimeout(resolve, POLL_MS) })
        const signal = (exec as { signal?: AbortSignal } | undefined)?.signal
        if (signal?.aborted === true) {
          return `等待被中止，运行 ${run.id} 仍在后台继续。用 team_status 查询。`
        }
        const snapshot = store.readRun(run.id)
        if (snapshot === null) continue
        latest = snapshot
        if (snapshot.status !== 'running' && snapshot.status !== 'queued') break
      }

      const progress = runProgress(latest)
      const lines: string[] = [
        `团队运行 ${latest.id} · ${latest.teamName} · ${latest.chainName} → ${latest.status}（${progress.done}/${progress.total} 步完成）`,
        '',
      ]
      if (latest.planNote !== undefined && latest.planNote !== '') {
        lines.push(`分工思路：${latest.planNote}`, '')
      }
      for (const step of latest.steps) {
        const mark = step.status === 'done' ? '✅' : step.status === 'error' ? '❌' : step.status === 'skipped' ? '⏭' : '⏳'
        const model = step.modelUsed.provider !== '' ? `${step.modelUsed.provider}/${step.modelUsed.model}` : '—'
        // 并行运行时「第 N 步」会误导，改标波次（同波次即并行同时执行）。
        const where = step.wave !== undefined ? `第 ${step.wave + 1} 波` : `第 ${step.index + 1} 步`
        lines.push(`${mark} ${where} ${step.roleName}（${model}｜${step.channel ?? '—'}）${step.error !== undefined ? ` — ${step.error}` : ''}`)
      }
      if (latest.finalFile !== undefined) {
        try {
          const final = store.readFinal(latest.id)
          lines.push('', '## 最终交付物', truncate(final, 6000))
        } catch { /* ignore */ }
      } else {
        const last = [...latest.steps].reverse().find(step => step.status === 'done')
        if (last !== undefined) {
          lines.push('', `## 最后一步产出（${last.roleName}）`, truncate(last.output, 4000))
        }
      }
      if (latest.error !== undefined) lines.push('', `⚠ ${latest.error}`)
      return lines.join('\n')
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    presentCall: args => ({ card: 'generic' as const, kind: 'other' as const, title: '团队协作执行', rawInput: args }),
  })))

  // ── team_status ──
  disposers.push(ctx.tools.register(defineTool({
    name: 'team_status',
    description: '查看团队运行状态：指定 runId 查该次运行，留空查最近一次运行。返回每步状态、实际使用的模型与来源层、产物路径。',
    parameters: {
      runId: { type: 'string', description: '运行 id；留空取最近一次。' },
      full: { type: 'boolean', description: 'true 时附带最终交付物全文。' },
    },
    async execute(args) {
      const params = args as unknown as Record<string, unknown>
      const runId = typeof params.runId === 'string' ? params.runId.trim() : ''
      const run = runId !== ''
        ? store.readRun(runId)
        : (() => {
            const ids = store.listRunIds()
            for (const id of ids) {
              const snapshot = store.readRun(id)
              if (snapshot !== null) return snapshot
            }
            return null
          })()
      if (run === null) return runId !== '' ? `找不到运行：${runId}` : '还没有任何团队运行记录。'
      const view = presentRun(run)
      if (params.full === true && run.finalFile !== undefined) {
        try {
          return `${JSON.stringify(view, null, 2)}\n\n## 最终交付物\n${store.readFinal(run.id)}`
        } catch { /* ignore */ }
      }
      return JSON.stringify(view, null, 2)
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    presentCall: args => ({ card: 'generic' as const, kind: 'other' as const, title: '查看团队运行状态', rawInput: args }),
  })))

  // ── team_create ──
  disposers.push(ctx.tools.register(defineTool({
    name: 'team_create',
    description: [
      '一句话生成一支新的多智能体团队：由模型设计角色编制（角色 + 系统提示词 + 分组）、协作链与直连关系，落盘为新团队并设为当前团队。',
      '当用户说「帮我建一个 xx 团队」「生成一支做 xx 的团队」时调用。',
      '注意：生成不决定模型绑定——所有角色默认继承团队默认模型，生成后提醒用户在团队面板选一次团队默认模型。',
    ].join(''),
    parameters: {
      brief: { type: 'string', required: true, description: '团队需求描述：做什么、需要哪些环节/能力。越具体角色划分越准。' },
      provider: { type: 'string', description: '可选：用于生成的 provider（缺省用全局默认模型）。' },
      model: { type: 'string', description: '可选：用于生成的 model id。' },
    },
    async execute(args, exec) {
      const params = args as unknown as Record<string, unknown>
      const brief = typeof params.brief === 'string' ? params.brief : ''
      const provider = typeof params.provider === 'string' ? params.provider.trim() : ''
      const model = typeof params.model === 'string' ? params.model.trim() : ''
      const signal = (exec as { signal?: AbortSignal } | undefined)?.signal
      const team = await generateTeam(ctx, store, {
        brief,
        ...(provider !== '' ? { provider } : {}),
        ...(model !== '' ? { model } : {}),
        ...(signal !== undefined ? { signal } : {}),
      })
      store.patchGlobals({ activeTeamId: team.id })
      const lines: string[] = [
        `已生成团队「${team.name}」（id: ${team.id}），共 ${team.roles.length} 个角色、${team.chains.length} 条协作链，并设为当前团队。`,
        '',
        '角色：',
        ...team.roles.map(role => `- ${role.name}（${role.id}）· ${role.tagline}`),
      ]
      if (team.chains.length > 0) {
        lines.push('', '协作链：')
        for (const chain of team.chains) {
          const path = chain.steps
            .map(step => (step.kind === 'synthesize' ? '主脑整合' : team.roles.find(r => r.id === step.roleId)?.name ?? step.roleId))
            .join(' → ')
          const tail = chain.finalSynthesize && !chain.steps.some(s => s.kind === 'synthesize') ? ' → 主脑整合' : ''
          lines.push(`- ${chain.id}：${path}${tail}`)
        }
      }
      if (team.model.provider === '') {
        lines.push('', '⚠ 该团队还没设「团队默认模型」：请在左侧「团队」面板顶部选一个模型，全体角色会继承它。')
      }
      return lines.join('\n')
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    presentCall: args => ({ card: 'generic' as const, kind: 'other' as const, title: '一句话生成团队', rawInput: args }),
  })))

  return () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* ignore */ }
    }
  }
}
