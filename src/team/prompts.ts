/**
 * team — prompt 装配（host 半身）。
 *
 * 一步的输入 = 角色系统提示词（system）+ 用户消息（任务 + 本步说明 + 上游产出）。
 * 上游注入按 globals.upstreamWindow 与 outputChunkChars 裁剪：
 *  - 'last'        最近一步全量（截断到预算）+ 更早步骤各取摘要头
 *  - 'all-summary' 全部步骤各取摘要头（均分预算）
 */

import type { PlannedStep } from './roster.js'
import type { Role, RunStep, Team, TeamGlobals } from './types.js'

/** 摘要头长度（'all-summary' 与更早步骤用）。 */
const SUMMARY_HEAD = 1200

/** 按预算截断文本，超出时标注截断。 */
function clip(text: string, budget: number): string {
  if (text.length <= budget) return text
  return `${text.slice(0, budget)}\n\n…（已截断，完整内容见产物文件）`
}

/** 角色的 system 提示词：角色 prompt + 团队上下文 + 输出纪律。 */
export function buildSystem(team: Team, role: Role, synthesize: boolean): string {
  const roster = team.roles
    .map(r => `- ${r.name}（${r.en}）：${r.tagline}`)
    .join('\n')
  if (synthesize) {
    return [
      role.prompt.trim() !== ''
        ? role.prompt
        : `你是「${role.name}」，团队的协调中枢与最终整合者。`,
      '',
      `## 团队「${team.name}」成员`,
      roster,
      '',
      '## 本步任务：最终整合',
      '你现在处于协作链的最后一步。上游各角色的产出会在用户消息里按顺序给出。',
      '- 整合全部产出，消解彼此矛盾之处（指出冲突并给出取舍理由）。',
      '- 产出面向用户的最终交付物：结论先行，其后是依据与关键细节，最后是遗留问题与建议的下一步。',
      '- 明确标注哪些内容是你补充的（各角色都没覆盖的空白）。',
      '- 直接输出交付物本体，不要复述流程、不要写「好的我来整合」这类开场话。',
    ].join('\n')
  }
  return [
    role.prompt.trim() !== '' ? role.prompt : `你是「${role.name}」，${role.tagline}。`,
    '',
    `## 团队「${team.name}」成员`,
    roster,
    '',
    '## 输出纪律',
    '- 只做你职责范围内的事，其余交回主脑。',
    '- 结论先行，其后是依据与细节，最后列出遗留问题与建议的下一步。',
    '- 不确定处显式标注「待确认」，不要用猜测填充事实。',
    '- 直接输出成果本体，不要写开场寒暄与流程复述。',
  ].join('\n')
}

/** 上游产出注入片段。 */
function buildUpstream(
  previous: readonly RunStep[],
  globals: TeamGlobals,
): string {
  const done = previous.filter(step => step.status === 'done' && step.output.trim() !== '')
  if (done.length === 0) return ''
  const budget = globals.outputChunkChars

  if (globals.upstreamWindow === 'all-summary') {
    const per = Math.max(300, Math.floor(budget / done.length))
    return done.map(step =>
      `### 上游 · ${step.roleName}（第 ${step.index + 1} 步）\n${clip(step.output, per)}`).join('\n\n')
  }

  // 'last'：最近一步全量（占大头），更早步骤各取摘要头。
  const last = done[done.length - 1]
  const earlier = done.slice(0, -1)
  const earlierBudget = earlier.length > 0 ? Math.min(SUMMARY_HEAD, Math.floor(budget / 3 / earlier.length)) : 0
  const parts: string[] = []
  for (const step of earlier) {
    parts.push(`### 上游摘要 · ${step.roleName}（第 ${step.index + 1} 步）\n${clip(step.output, earlierBudget)}`)
  }
  const lastBudget = earlier.length > 0 ? Math.floor(budget * 2 / 3) : budget
  parts.push(`### 上游产出 · ${last.roleName}（第 ${last.index + 1} 步，最近一步）\n${clip(last.output, lastBudget)}`)
  return parts.join('\n\n')
}

/** 整合步的上游注入：全部步骤按预算均分。 */
function buildAllOutputs(previous: readonly RunStep[], globals: TeamGlobals): string {
  const done = previous.filter(step => step.output.trim() !== '')
  if (done.length === 0) return '（上游没有产出。）'
  const per = Math.max(400, Math.floor(globals.outputChunkChars / done.length))
  return done.map((step) => {
    const state = step.status === 'done' ? '' : `（本步状态：${step.status}）`
    return `### ${step.roleName} · ${step.tagline}${state}\n${clip(step.output, per)}`
  }).join('\n\n')
}

/** 装配一步的用户消息。 */
export function buildUserPrompt(
  team: Team,
  planned: PlannedStep,
  task: string,
  previous: readonly RunStep[],
  globals: TeamGlobals,
  chainName: string,
  /** 同波次并行伙伴（同时开跑、彼此看不到产出）的展示名。 */
  peers: readonly string[] = [],
): string {
  const head = [
    `# 团队协作任务（${team.name} · ${chainName}）`,
    '',
    '## 总任务',
    task.trim() !== '' ? task : '（未提供任务描述）',
    '',
    `## 你的本步职责（${planned.synthesize ? '最终整合' : planned.role.name}）`,
    planned.taskNote !== undefined && planned.taskNote !== ''
      ? planned.taskNote
      : (planned.synthesize ? '整合上游全部产出，形成最终交付物。' : `按你的角色定位（${planned.role.tagline}）推进这个任务。`),
  ]
  if (peers.length > 0) {
    head.push(
      '',
      '## 并行说明',
      `本步与「${peers.join('、')}」**同时进行**：你看不到他们的产出，他们也看不到你的。`,
      '- 只做你职责范围内的部分，不要替他们的职责下结论、不要复述他们大概会说什么。',
      '- 需要他们的结论才能推进的部分，写成「待汇合确认：…」交给后续整合处理。',
    )
  }
  const upstream = planned.synthesize
    ? buildAllOutputs(previous, globals)
    : buildUpstream(previous, globals)
  if (upstream !== '') {
    head.push('', '## 上游产出', upstream)
  }
  head.push('', '---', '现在开始你的工作，直接输出成果。')
  return head.join('\n')
}

/** 产物文件内容（步骤 md）。 */
export function renderStepDocument(
  team: Team,
  planned: PlannedStep,
  content: string,
  meta: { provider: string, model: string, source: string, channel: string, startedAt: string },
): string {
  return [
    `# ${planned.role.name}（${planned.role.en}）· 第 ${planned.index + 1} 步`,
    '',
    `> 团队：${team.name}｜定位：${planned.role.tagline}`,
    `> 模型：${meta.provider}/${meta.model}（来源：${meta.source}）｜通道：${meta.channel}`,
    `> 开始：${new Date(meta.startedAt).toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '---',
    '',
    content,
    '',
  ].join('\n')
}

/** 最终交付物文件内容。 */
export function renderFinalDocument(
  team: Team,
  chainName: string,
  task: string,
  content: string,
): string {
  return [
    `# 最终交付物 · ${team.name}`,
    '',
    `> 链条：${chainName}`,
    `> 任务：${task}`,
    `> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '---',
    '',
    content,
    '',
  ].join('\n')
}

// ── 主脑自主派发（autoPlan）────────────────────────────────────────────────

/** 编排 prompt 的 system（要求只输出 JSON）。 */
export const PLAN_SYSTEM = [
  '你是多智能体团队的调度主脑。给定一个任务和一份角色名册，你要给出**最省时且不牺牲质量**的派发计划。',
  '',
  '规则：',
  '1. 计划是一个「波次」数组：同一波次里的角色**同时开跑、彼此看不到对方产出**，波次之间串行（后一波能看到前面所有波次的产出）。',
  '2. 互不依赖的工作（例如多路调研、多角度审查、素材收集与竞品分析）放进同一个波次并行；有依赖关系的（先取证再成稿、先实现再评审）必须分到不同波次，后置。',
  '3. 只选真正需要的角色，不要为了凑人把所有角色都排上；一个角色最多出现一次。',
  '4. 主脑自身不要排进波次——最终整合会自动追加。',
  '5. 每个角色给一句 taskNote，写清这一步具体要产出什么（不要复述总任务）。',
  '',
  '只输出一个 JSON 对象，不要 markdown 围栏、不要任何解释：',
  '{"note":"一句话说明分工思路","waves":[[{"roleId":"...","taskNote":"..."},{"roleId":"...","taskNote":"..."}],[{"roleId":"...","taskNote":"..."}]]}',
].join('\n')

/** 编排 prompt 的用户消息。 */
export function buildPlanPrompt(team: Team, task: string, maxParallel: number): string {
  const roster = team.roles
    .filter(role => role.group !== 'core')
    .map(role => `- \`${role.id}\` ${role.name}：${role.tagline}`)
    .join('\n')
  return [
    `# 团队「${team.name}」派发计划`,
    '',
    '## 任务',
    task.trim() !== '' ? task : '（未提供任务描述）',
    '',
    '## 可派发角色（主脑不在此列）',
    roster !== '' ? roster : '（没有可派发的专职角色）',
    '',
    '## 约束',
    `- 单个波次最多 ${maxParallel} 个角色并行（超出请拆成多个波次）。`,
    '- 波次总数不超过 4。',
    '',
    '现在输出计划 JSON。',
  ].join('\n')
}
