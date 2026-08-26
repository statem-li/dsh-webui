/**
 * team — 对话框团队开关（host 半身，docs §6.5）。
 *
 * 生效机制（零 DSH 源码改动）：
 *  1. 会话级开关持久化在 ${DSH_HOME}/team/chat-mode.json（sessionId → 状态）。
 *  2. 注册 systemPrompt section `team-mode`：**仅当渲染所属的那个会话开启**时，注入
 *     该会话所选团队的编制说明与调用约定。会话身份取自 DSH 传给 text() 的
 *     AssembleContext —— `assembleContextFor()` 会带上 `agent`，而 `agent.id`
 *     就是 SessionId。
 *  3. 模型据此在需要多角色协作时调用 team_run 工具；工具触发天然带 agent 上下文，
 *     角色可走 subagent 通道（有完整工具能力）。
 *  4. 关闭（或拿不到会话身份）时 text 返回空串 → renderPrompt 自动丢弃，零 token 占用。
 */

import type { TeamStore } from './store.js'
import type { ChatModeState, Team } from './types.js'

/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any

/** 团队编制摘要（注入提示词用）。 */
function describeTeam(team: Team, mode: ChatModeState): string[] {
  const lines: string[] = []
  lines.push(`### 团队「${team.name}」（id: ${team.id}）`)
  if (team.description !== undefined && team.description !== '') lines.push(team.description)
  lines.push('可用角色：')
  for (const role of team.roles) {
    lines.push(`- \`${role.id}\` ${role.name}（${role.en}）：${role.tagline}`)
  }
  if (team.chains.length > 0) {
    lines.push('可用协作链（`‖` = 该组角色并行同时执行）：')
    for (const chain of team.chains) {
      const parts: string[] = []
      for (const step of chain.steps) {
        const label = step.kind === 'synthesize'
          ? '主脑整合'
          : (team.roles.find(r => r.id === step.roleId)?.name ?? step.roleId)
        if (step.kind === 'role' && step.parallel === true && parts.length > 0) {
          parts[parts.length - 1] = `${parts[parts.length - 1]}‖${label}`
          continue
        }
        parts.push(label)
      }
      const tail = chain.finalSynthesize && !chain.steps.some(s => s.kind === 'synthesize') ? ' → 主脑整合' : ''
      lines.push(`- \`${chain.id}\` ${chain.name}：${parts.join(' → ')}${tail}`)
    }
  }
  if (mode.chainId !== '') {
    lines.push(`本会话已指定链：\`${mode.chainId}\`（调用 team_run 时优先用它）。`)
  } else {
    lines.push('本会话未指定链：由你根据任务性质选择最合适的链，或用 plan 参数自行编排并行波次。')
  }
  return lines
}

/** 组装注入文本。 */
function buildInstruction(entries: Array<{ sessionId: string, mode: ChatModeState, team: Team | null }>): string {
  const usable = entries.filter(entry => entry.team !== null)
  if (usable.length === 0) return ''

  const anyForce = usable.some(entry => entry.mode.force)
  const head: string[] = [
    '【团队模式已开启】本会话已开启多智能体团队协作模式。',
  ]
  if (anyForce) {
    head.push(
      '**强制模式**：本会话的每一个实质任务都必须先调用 `team_run` 交给团队执行，'
      + '不要自己直接完成；只有纯粹的闲聊、确认、追问才可直接回答。',
    )
  } else {
    head.push(
      '当任务需要多角色协作（调研+审查、方案+落地、诊断+修复+验收、取证+成稿等），'
      + '或任务较复杂需要分工推进时，调用 `team_run` 工具交给团队接力执行；'
      + '简单问答、单步小改动仍直接自己回答，不要绕远路。',
    )
  }
  head.push(
    '调用约定：`team_run { teamId, task, plan? | chainId? | roles?, autoPlan? }`——task 写清完整目标与验收标准。',
    '**并行派发（省时关键）**：`plan` 是波次数组，同一波次里的角色**同时开跑**，波次之间串行（后一波能看到前面全部产出）。'
    + '把互不依赖的工作放进同一波次，例如 `plan: [["cha","ping"],["jiang"]]` = 察与评并行调研/审查，完成后匠再落地。'
    + '有依赖关系的工作（先取证再成稿、先实现再评审）必须排进后续波次。',
    '同一波次的角色彼此看不到对方产出，所以「需要引用同伴结论」的工作不要排进同一波。',
    '不确定怎么分工时传 `autoPlan: true`，让主脑先自主编排一份并行计划再执行；'
    + '想按预设流程走就用 `chainId`；只需要简单串行接力用 `roles`。',
    '运行产物会落盘，运行进度在对话流上方的团队 HUD 与团队面板中实时可见。',
    '运行结束后用 `team_status` 取回结果摘要，再基于最终交付物回答用户。',
    '',
  )

  if (usable.length === 1) {
    const entry = usable[0]
    head.push(...describeTeam(entry.team as Team, entry.mode))
    head.push(`调用 team_run 时传 teamId: \`${(entry.team as Team).id}\`。`)
    return head.join('\n')
  }

  head.push('当前开启团队模式的会话与对应团队：')
  for (const entry of usable) {
    head.push(`- 会话 \`${entry.sessionId}\` → 团队 \`${(entry.team as Team).id}\`（${(entry.team as Team).name}）`)
  }
  head.push('', '（按当前所在会话选用对应团队；各团队编制如下。）', '')
  for (const entry of usable) {
    head.push(...describeTeam(entry.team as Team, entry.mode), '')
  }
  return head.join('\n')
}

/**
 * 注册团队模式的系统提示词注入。返回 dispose。
 *
 * 读取开销：每次渲染读一次 chat-mode.json + 已开启会话的团队文件；
 * 用 300ms 缓存避免同一轮多次渲染重复读盘。
 */
export function applyTeamChatMode(ctx: AnyContext, store: TeamStore): () => void {
  const cache = new Map<string, { at: number, text: string }>()
  const CACHE_MS = 300

  /**
   * 从 prompt 装配上下文里取「当前会话 id」。
   *
   * DSH 的 `assembleContextFor()` 会把当前 agent 一并放进 AssembleContext
   * （`{ agent, scope: agent }`），而 `agent.id` 就是 SessionId —— 因此注入面
   * **可以**按会话精确取用。历史实现误以为拿不到会话 id 而按「已开启的会话集合」
   * 全局渲染，导致任一会话开启后所有会话都被注入团队指令（关了也照样注入）。
   */
  const sessionIdOf = (context: unknown): string => {
    const agent = (context as { agent?: { id?: unknown } } | undefined)?.agent
    const id = agent?.id
    return typeof id === 'string' ? id : ''
  }

  const render = (context: unknown): string => {
    const sessionId = sessionIdOf(context)
    // 拿不到会话身份时一律不注入：宁可少注入，也不能给「已关闭」的会话注入。
    if (sessionId === '') return ''

    const now = Date.now()
    const hit = cache.get(sessionId)
    if (hit !== undefined && now - hit.at < CACHE_MS) return hit.text

    let text = ''
    try {
      const mode = store.readChatMode(sessionId)
      if (mode.enabled) {
        const result = mode.teamId !== ''
          ? store.tryReadTeam(mode.teamId)
          : (() => {
              try { return { team: store.resolveTeam() } } catch { return { issue: 'no team' } }
            })()
        const team = 'team' in result ? result.team : null
        text = buildInstruction([{ sessionId, mode, team }])
      }
    } catch {
      text = ''
    }
    if (cache.size > 64) cache.clear()
    cache.set(sessionId, { at: now, text })
    return text
  }

  const dispose = ctx.effect(() => ctx.systemPrompt.section({
    name: 'team-mode',
    order: -30,
    text: (context: unknown) => render(context),
  }), 'webui: team chat mode prompt')

  return typeof dispose === 'function' ? dispose : () => {}
}
