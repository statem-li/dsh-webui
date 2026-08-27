/**
 * team — client 侧类型（与 host src/team/types.ts 对齐的视图子集）。
 */

export type ModelSource = 'run' | 'role' | 'team' | 'global'
export type RoleGroup = 'core' | 'judge' | 'act' | 'guard'
export type ExecutorPref = 'auto' | 'llm' | 'subagent'
export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'interrupted'
export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'
export type RunOrigin = 'panel' | 'chat-toggle' | 'tool'

/** 失败归类（与 host src/team/failure.ts 一致）。 */
export type StepErrorKind =
  | 'rate_limit' | 'timeout' | 'auth' | 'quota' | 'network'
  | 'server' | 'model_missing' | 'content' | 'cancelled' | 'unknown'

/** 步骤执行阶段（running 时表示「现在在干什么」）。 */
export type StepPhase =
  | 'resolving' | 'dispatch' | 'thinking' | 'writing' | 'tooling' | 'retrying' | 'saving'

/** 单次尝试记录（重试 / 模型降级轨迹）。 */
export interface StepAttempt {
  attempt: number
  model: ModelBinding
  fallback: boolean
  status: 'done' | 'error'
  errorKind?: StepErrorKind
  error?: string
  startedAt: string
  finishedAt: string
  backoffMs?: number
}

export interface ModelBinding {
  provider: string
  model: string
  reasoningEffort?: string
  maxTokens?: number
}

/** 角色在编制图上的位置（world 绝对像素，可为负 —— 无限画布）。 */
export interface NodePos {
  x: number
  y: number
}

/** 工具装配模式。 */
export type ToolMode = 'inherit' | 'allow' | 'deny'
/** 技能装配模式。 */
export type SkillMode = 'inherit' | 'allow' | 'none'

/** 角色能力装配（插件工具 + 技能包）。 */
export interface RoleCapabilities {
  toolMode: ToolMode
  tools: string[]
  skillMode: SkillMode
  skills: string[]
  skillBundles: string[]
}

/** 能力装配默认值。 */
export const DEFAULT_CAPABILITIES: RoleCapabilities = {
  toolMode: 'inherit',
  tools: [],
  skillMode: 'inherit',
  skills: [],
  skillBundles: [],
}

/** 可装配的工具。 */
export interface ToolOption {
  name: string
  description: string
}

/** 可装配的技能。 */
export interface SkillOption {
  name: string
  description: string
  modelInvocable: boolean
}

/** 技能包。 */
export interface BundleOption {
  id: string
  name: string
  skills: string[]
}

/** 能力目录。 */
export interface CapabilityCatalog {
  tools: ToolOption[]
  skills: SkillOption[]
  bundles: BundleOption[]
}

export interface Role {
  id: string
  name: string
  en: string
  tagline: string
  group: RoleGroup
  prompt: string
  model: ModelBinding | null
  /** 备用模型链（主模型失败且「换模型有救」时按序尝试）。 */
  fallbackModels?: ModelBinding[]
  executor: ExecutorPref
  label?: string
  tags?: string[]
  /** 手工拖拽后的位置；缺省用自动环形布局。 */
  pos?: NodePos
  /** 头像：emoji 或短字符（缺省用 name 首字）。 */
  avatar?: string
  /** 能力装配（工具 + 技能）；缺省 = 完全继承会话。 */
  capabilities?: RoleCapabilities
}

/**
 * 链步骤。`parallel: true` = 与上一步同波次并行执行（同时开跑，彼此看不到对方产出）。
 */
export type ChainStep =
  | { kind: 'role', roleId: string, taskNote?: string, parallel?: boolean }
  | { kind: 'synthesize', roleId?: string }

export interface Chain {
  id: string
  name: string
  steps: ChainStep[]
  finalSynthesize: boolean
}

export interface DirectLink {
  from: string
  to: string
  label?: string
  kind: 'bidirectional' | 'directed'
}

export interface Team {
  schemaVersion: number
  id: string
  name: string
  description?: string
  model: ModelBinding
  /** 团队级备用模型链（角色未单独配置时继承）。 */
  fallbackModels?: ModelBinding[]
  roles: Role[]
  chains: Chain[]
  directLinks: DirectLink[]
  createdAt: string
  updatedAt: string
}

export interface TeamSummary {
  id: string
  name: string
  description?: string
  model: ModelBinding
  roleCount: number
  chainCount: number
  updatedAt: string
  readonly?: boolean
  issue?: string
}

export interface TeamGlobals {
  defaultModel: ModelBinding
  activeTeamId: string
  timeoutSec: number
  maxRetries: number
  upstreamWindow: 'last' | 'all-summary'
  maxConcurrentRuns: number
  /** 单个运行内同一波次的最大并发角色数（1 = 全串行）。 */
  maxParallel: number
  /** 面板/工具默认让主脑自主编排并行计划。 */
  autoPlan: boolean
  outputChunkChars: number
  stopOnError: boolean
  /** 主模型失败时自动降级到备用模型链。 */
  autoFallback: boolean
}

export interface RunStep {
  index: number
  /** 波次序号（0 起）：同波次并行执行，波次之间串行。旧快照缺省时按 index 兜底。 */
  wave?: number
  roleId: string
  roleName: string
  tagline: string
  group: RoleGroup
  synthesize: boolean
  status: StepStatus
  /** 当前阶段（running 时有意义）。 */
  phase?: StepPhase
  /** 阶段补充说明（工具名 / 退避原因）。 */
  phaseNote?: string
  /** 阶段进入时间。 */
  phaseSince?: string
  inputSnapshot: string
  output: string
  /** 累计输出字符数。 */
  outputChars?: number
  outputFile?: string
  modelUsed: ModelBinding
  modelSource: ModelSource
  /** 本步是否降级到了备用模型。 */
  fallbackUsed?: boolean
  channel?: 'llm' | 'subagent'
  /** 本步实际生效的能力装配。 */
  capabilities?: {
    toolMode: ToolMode
    tools: string[]
    skillMode: SkillMode
    skills: string[]
    missingTools?: string[]
    missingSkills?: string[]
    note?: string
  }
  warning?: string
  /** 子 agent 任务清单快照（todo_write 调用投影，全量覆盖）。 */
  todos?: Array<{ content: string, status: 'pending' | 'in_progress' | 'completed' }>
  startedAt?: string
  finishedAt?: string
  error?: string
  /** 失败归类（UI 徽标 + 处置建议）。 */
  errorKind?: StepErrorKind
  retries?: number
  /** 重试 / 降级轨迹。 */
  attempts?: StepAttempt[]
  /** 由第几轮「一键接续」重跑产生（缺省 = 首轮）。 */
  resumeRound?: number
}

export interface RunProgress {
  total: number
  done: number
  running: number
  pending: number
  failed: number
}

export interface Run {
  schemaVersion: number
  id: string
  teamId: string
  teamName: string
  chainId: string | null
  chainName: string
  task: string
  status: RunStatus
  origin: RunOrigin
  sessionId?: string
  modelOverrides?: Record<string, ModelBinding>
  /** 计划来源：chain / roles / plan（显式并行计划）/ auto（主脑自主编排）。 */
  planMode?: 'chain' | 'roles' | 'plan' | 'auto'
  /** 主脑自主编排时的分工说明。 */
  planNote?: string
  /** 波次数（< steps.length 即存在并行）。 */
  waveCount?: number
  startedAt: string
  finishedAt?: string
  steps: RunStep[]
  error?: string
  /** run 级失败归类。 */
  errorKind?: StepErrorKind
  /** 已执行的一键接续轮数。 */
  resumeCount?: number
  resumedAt?: string
  /** 服务端判定：能否一键接续（已结束且有未完成步骤）。 */
  resumable?: boolean
  finalFile?: string
  /** 服务端附带的进度统计（active/detail 接口）。 */
  progress?: RunProgress
}

export interface RunSummary {
  id: string
  teamId: string
  teamName: string
  chainName: string
  task: string
  status: RunStatus
  origin: RunOrigin
  /** 发起会话 id（按会话隔离展示）。 */
  sessionId?: string
  startedAt: string
  finishedAt?: string
  doneSteps: number
  totalSteps: number
}

export interface ProviderModelView {
  id: string
  name: string
}

export interface ProviderView {
  id: string
  displayName: string
  models: ProviderModelView[]
}

export interface ChatModeState {
  enabled: boolean
  teamId: string
  chainId: string
  force: boolean
  updatedAt: string
}

/** 分组显示名与配色 token。 */
export const GROUP_META: Readonly<Record<RoleGroup, { label: string, color: string }>> = {
  core: { label: '中枢', color: 'var(--dsw-alias-state-business-primary, #4176e6)' },
  judge: { label: '信息与判断', color: '#3fb96b' },
  act: { label: '落地执行', color: '#e07a5f' },
  guard: { label: '守护支持', color: '#7f9cc0' },
}

/** 模型来源徽标文案。 */
export const SOURCE_LABEL: Readonly<Record<ModelSource, string>> = {
  run: '本次',
  role: '角色',
  team: '团队',
  global: '全局',
}
