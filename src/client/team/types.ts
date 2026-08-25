/**
 * team — client 侧类型（与 host src/team/types.ts 对齐的视图子集）。
 */

export type ModelSource = 'run' | 'role' | 'team' | 'global'
export type RoleGroup = 'core' | 'judge' | 'act' | 'guard'
export type ExecutorPref = 'auto' | 'llm' | 'subagent'
export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'interrupted'
export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'
export type RunOrigin = 'panel' | 'chat-toggle' | 'tool'

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

export type ChainStep =
  | { kind: 'role', roleId: string, taskNote?: string }
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
  outputChunkChars: number
  stopOnError: boolean
}

export interface RunStep {
  index: number
  roleId: string
  roleName: string
  tagline: string
  group: RoleGroup
  synthesize: boolean
  status: StepStatus
  inputSnapshot: string
  output: string
  outputFile?: string
  modelUsed: ModelBinding
  modelSource: ModelSource
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
  retries?: number
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
  startedAt: string
  finishedAt?: string
  steps: RunStep[]
  error?: string
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
