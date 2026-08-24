/**
 * 一个 pi-ai 提供方 profile 的模型列表编辑器，外加「获取可用模型」动作。
 *
 * 列表是 profile 的 `models` 数组在卡片内的形态：空列表表示「使用该路由
 * 的内建目录」，任何条目都替换该目录，因此行只能被有意添加。获取动作询问
 * **表单当前显示**的端点——包括键入但尚未保存的 key——这样添加提供方可以
 * 一趟完成；返回的是用户勾选的候选，绝不背后写入配置。
 *
 * 无法询问的提供方（端点不可达、协议没有可读列表）不是死路：失败显示在
 * 用户仍可手填的行旁边。
 *
 * 移植自官方 ui-settings-models 的 ModelListEditor.tsx；headers 字段按任务
 * 约定省略（有安全风险）。文案使用本地中文字典，不依赖 locale 插件。
 */

import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { DiscoveredModelView, IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { messageOf } from './store.ts'

/** 「对话供应商」区块的本地文案（中文）。 */
export const chatCopy = {
  chatTitle: '对话供应商',
  configuredGroup: '已配置',
  presetGroup: '目录预设',
  addCustom: '添加自定义提供方',
  customTag: '自定义',
  unconfigured: '未配置',
  keyInput: 'API 密钥',
  keyPlaceholder: '输入 API 密钥',
  keyStored: '已配置——输入新值可替换',
  keyEnvLocked: '由启动环境提供（只读）',
  baseUrl: 'API 地址',
  baseUrlDefault: '提供方默认',
  apiProtocol: 'API 协议',
  apiProtocolUnset: '未选择',
  models: '模型目录',
  restoreDefaults: '恢复默认',
  modelsEmpty: '模型选择器中将不显示任何模型；目录外 ID 仍可直接发送。',
  modelId: '模型 ID',
  modelName: '显示名称',
  contextWindow: '上下文窗口',
  maxTokens: '最大输出 token',
  modelAdvanced: '容量',
  supportsImage: '识图',
  supportsImageHint: '聊天中发送的图片直接交给该模型识别（多模态），不再降级为辅助视觉文字描述。',
  supportsImageGen: '生图',
  supportsImageGenHint: '声明该模型可生成图片，生图候选列表将标注「生图」。',
  supportsVideoGen: '生视频',
  supportsVideoGenHint: '声明该模型可生成视频，生视频候选列表将标注「生视频」。',
  capabilityHint: '模型能力（手动开关声明）',
  detectReasoning: '🔍 检测推理等级',
  detectReasoningTitle: '逐级探测该模型支持的推理等级（off/minimal/low/medium/high/xhigh/max），完成后自动保存配置。识图/生图/生视频请用上方开关手动声明，不做实测。',
  detectingReasoning: '检测中…（约 30 秒）',
  capSaveFailed: '能力声明保存失败',
  addModel: '添加模型',
  removeModel: '删除模型',
  modelIdRequired: '模型 ID 不能为空。',
  modelIdDuplicate: '模型 ID 不能重复。',
  modelNameInvalid: '显示名称不能为空。',
  modelContextInvalid: '上下文窗口必须是正数，例如 131072、256K 或 1M。',
  modelMaxTokensInvalid: '最大输出 token 数必须是正数，例如 8192、64K 或 1M。',
  reasoningEfforts: '推理等级',
  effortLevel: '等级',
  effortWire: '线上值',
  effortOffWire: '留空表示不发送该参数',
  effortHint: '模型选择器中可选的等级；线上值即发送给提供方的参数。',
  modelEffortsInvalid: '推理等级必须是 off、minimal、low、medium、high、xhigh、max 之一，且每个等级需映射到非空的线上值。',
  modelEffortsOnlyOff: '至少声明一个 off 之外的推理等级。',
  fetchModels: '获取可用模型',
  fetching: '正在询问提供方…',
  fetchNeedsBaseUrl: '请先填写 API 地址，再获取。',
  fetchEmpty: '该提供方没有列出任何模型，请手动添加。',
  fetchUnsupported: '该供应商不支持模型列表查询（端点未提供 /models 接口），请手动填写下方模型列表。',
  fetchKeyInvalid: '请求被拒绝（403）：通常是 API 密钥无效或未填写。请先在卡片中填写正确的密钥，再重新获取。',
  fetchTitle: '选择要添加的模型',
  fetchDescription: '以下是该提供方当前可用的模型，勾选要添加的。',
  fetchAdopt: '添加所选',
  close: '关闭',
  cancel: '取消',
  save: '保存',
  saving: '保存中…',
  saved: '已保存。',
  create: '创建',
  creating: '创建中…',
  delete: '删除',
  confirmDelete: '确认删除？',
  deleting: '删除中…',
  providerId: 'Provider ID',
  providerIdHint: '以小写字母开头的标识，在请求中唯一标识该提供方，并用于派生凭据名。',
  providerIdInvalid: '需以小写字母开头，之后可用小写字母、数字和短横线。',
  providerIdTaken: '已有提供方使用了这个 ID。',
  displayName: '显示名称',
  customNeedsBaseUrl: '自定义提供方需要填写 API 地址。',
  customNeedsModels: '自定义提供方至少需要一个模型。',
  keyBlank: '请输入 API 密钥；留空则保持已存储的密钥。',
  keyBlankNew: '请输入 API 密钥；若该提供方以其他方式鉴权，可以留空。',
  keyIllegalCharacters: '该 API 密钥格式错误，请检查。',
  credentialConfigured: 'API 密钥已配置',
  credentialMissing: 'API 密钥缺失',
  loadFailed: '加载提供方目录失败',
  retry: '重试',
  readOnly: '当前部署的设置文档为只读。',
  conflict: '这张卡片打开期间，这些设置已被其他地方改动。请关闭后重新打开，在当前值上编辑。',
} as const

/** 文案键联合。 */
export type ChatCopyKey = keyof typeof chatCopy

/** 区块内本地化函数类型。 */
export type T = (key: ChatCopyKey) => string

/** 直接查字典的本地化函数（MVP 仅中文）。 */
export const t: T = (key) => chatCopy[key]

/**
 * 展开编辑 UI 的共享伪类样式：focus 描边、placeholder、disabled、按钮 hover
 * 都无法用内联样式表达，随首个编辑器挂载注入一次（幂等）。规格与官方
 * ModelsSection.module.css 的 `.input:focus/::placeholder/:disabled` 与各
 * 按钮 `:hover` 一致。
 */
export function ensureProviderFieldStyles(): void {
  const marker = 'dsh-webui-provider-fields'
  if (document.getElementById(marker) !== null) return
  const style = document.createElement('style')
  style.id = marker
  style.textContent = [
    '.dsh-webui-field:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
    '.dsh-webui-field::placeholder{color:var(--dsw-alias-label-dimmed,#c9cdd4)}',
    '.dsh-webui-field:disabled{opacity:.6;cursor:default}',
    '.dsh-webui-link-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
    '.dsh-webui-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
    '.dsh-webui-icon-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}',
    '.dsh-webui-capsule-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
    '.dsh-webui-primary-btn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill))}',
    '.dsh-webui-secondary-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,rgba(0,0,0,0.05))}',
    '.dsh-webui-danger-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}',
  ].join('\n')
  document.head.append(style)
}

/**
 * 一条已配置的模型行。结构上保持开放，与官方 DeepSeek catalog 编辑器的
 * 行一样：本卡不编辑的 profile 字段——未来 schema 新增的，或 settings.yaml
 * 手写的——必须在此编辑中幸存，而不是被重建丢弃。
 */
export type ModelDraft = Record<string, unknown>

/** 一行中的文本字段；未设置或非字符串时返回空串。 */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** 一行中的数字字段；未设置或非数字时返回 `undefined`。 */
function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** 模型声明的 input 模态数组；未声明（继承路由默认 text）时为 `undefined`。 */
function inputOf(model: ModelDraft): string[] | undefined {
  const input = model['input']
  return Array.isArray(input) ? input.filter((x): x is string => typeof x === 'string') : undefined
}

/** 该模型是否声明支持图像输入（识图）。 */
function supportsImage(model: ModelDraft): boolean {
  return inputOf(model)?.includes('image') === true
}

/** 接受的后缀拼写：十进制数 + 可选 K/M 后缀。 */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i

/** 十进制后缀刻度——`1M` 是 1000K，与模型容量的报价习惯一致。 */
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const

/**
 * 读取键入的容量，用户可写 `256K` 或 `1M` 而不必数零。存储值保持纯 token
 * 数。
 * @param text - 原始字段文本。
 * @returns token 数；空白时 `undefined`（继承），不可读时 `NaN`（写入前
 * 由校验拒绝）。
 */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  const scaled = Number(match[1]) * scale
  // 十进制倍数在二进制浮点里不精确（2.3 * 1e6 略高几个 ULP），整数意图吸回。
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/**
 * 把存储值拼回能经 {@link parseCapacity} 往返的最短形式；不是整千的数就
 * 原样写出。
 * @param value - 存储的容量。
 * @returns 字段文本。
 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}

/**
 * 容量字段的常用档位，作为输入框的下拉预设；列表外的值仍可自由键入。
 * 上下文窗口覆盖主流模型报价（含 Claude 的 200K 与 Gemini 的 1M/2M），
 * 输出上限取常见的生成预算档位。
 */
const CAPACITY_PRESETS: Readonly<Record<CapacityField, readonly string[]>> = {
  contextWindow: ['2M', '1M', '512K', '400K', '256K', '200K', '128K', '96K', '64K', '48K', '32K', '24K', '16K', '8K'],
  maxTokens: ['256K', '128K', '64K', '32K', '24K', '16K', '12K', '8K', '4K', '2K'],
}

/**
 * 一个模型 profile 可声明的全部推理等级，按升级顺序。与官方 llm-pi-ai 的
 * `THINKING_LEVELS` 镜像；适配器 schema 拒绝任何其他键，因此编辑器只提供
 * 这些。
 */
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** 一条用户自有模型数组的本地化校验失败。 */
export interface ModelsValidationFailure {
  /** 从 0 计的模型位置。 */
  index: number
  /** 消息键。 */
  key: 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid'
  | 'modelMaxTokensInvalid' | 'modelEffortsInvalid' | 'modelEffortsOnlyOff'
}

/**
 * 校验一个模型声明的 `reasoningEfforts`，规则与 pi-ai 适配器解析时强制的一
 * 致：集合之外的等级、非 `null` 且非非空字符串的值、除 `off` 外留空的
 * `null`、以及没有 off 之外思考等级的映射，全部拒绝。
 * @param value - 模型的 `reasoningEfforts`（若有声明）。
 * @returns 失败键；适配器可接受时 undefined。
 */
export function validateModelReasoningEfforts(value: unknown): 'modelEffortsInvalid' | 'modelEffortsOnlyOff' | undefined {
  if (value === undefined || value === false) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'modelEffortsInvalid'
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return 'modelEffortsOnlyOff'
  let thinking = false
  for (const [level, wire] of entries) {
    if (!(REASONING_LEVELS as readonly string[]).includes(level)) return 'modelEffortsInvalid'
    if (wire === null) {
      // 只有 off 允许留空（wire 参数缺席）；声明的思考等级必须点名发送的值。
      if (level !== 'off') return 'modelEffortsInvalid'
    } else if (typeof wire !== 'string' || wire.length === 0) {
      return 'modelEffortsInvalid'
    } else if (level !== 'off') {
      thinking = true
    }
  }
  return thinking ? undefined : 'modelEffortsOnlyOff'
}

/** 把 schema 校验过的 catalog 值转成 records，不丢隐藏字段。 */
export function modelDrafts(value: unknown): ModelDraft[] {
  if (!Array.isArray(value)) return []
  return value.map(entry =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as ModelDraft
      : {})
}

/**
 * 校验序列化 schema 表达不了的适配器约束（与官方 validateDeepSeekModels
 * 同步的宿主端 catalogModel 约束）。
 * @param value - 用户自有的 `models` 值；继承时为 undefined。
 * @returns 第一行非法行，或适配器可接受时 undefined。
 */
export function validateModels(value: unknown): ModelsValidationFailure | undefined {
  if (value === undefined) return undefined
  const models = modelDrafts(value)
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    // 比较前去空白：粘贴伪影是适配器永不匹配的，未去空白的比较会让
    // `model ` 绕过与自身孪生的重复检查。
    const id = model['id']
    const trimmed = typeof id === 'string' ? id.trim() : undefined
    if (trimmed === undefined || trimmed.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(trimmed)) return { index, key: 'modelIdDuplicate' }
    seen.add(trimmed)
    const name = model['name']
    if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
      return { index, key: 'modelNameInvalid' }
    }
    const contextWindow = model['contextWindow']
    if (contextWindow !== undefined
      && (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
      return { index, key: 'modelContextInvalid' }
    }
    const maxTokens = model['maxTokens']
    if (maxTokens !== undefined
      && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
      return { index, key: 'modelMaxTokensInvalid' }
    }
    const effortsFailure = validateModelReasoningEfforts(model['reasoningEfforts'])
    if (effortsFailure !== undefined) return { index, key: effortsFailure }
  }
  return undefined
}

/** 询问一次端点所需、取自 live 表单的信息。 */
export interface ProbeTarget {
  /** 应答的适配器家族所属设置命名空间。 */
  settingsNs: string
  /** 正在编辑的路由（若有）。能描述它的适配器从自己的注册表作答。 */
  provider?: string
  /** 表单当前显示的端点。 */
  baseURL?: string
  /** 表单命名的 wire 协议（若命名）。 */
  api?: string
  /** 键入表单且尚未存储的 key（若有）。 */
  apiKey?: string
}

/** {@link ModelListEditor} 的 props。 */
export interface ModelListEditorProps {
  /** 当前草稿中的行。 */
  models: readonly ModelDraft[]
  /** 替换草稿行。 */
  onChange: (models: ModelDraft[]) => void
  /** 用户层当前是否拥有整个数组（无覆盖时继承）。 */
  overridden?: boolean
  /** 移除用户自有的数组、回到继承；创建场景缺省。 */
  onReset?: () => void
  /** 获取动作的端点事实。 */
  probe: ProbeTarget
  /** 获取动作调用的 wire 面。 */
  api: Pick<IApiClient, 'llm'>
  /** 禁用所有控件（只读部署或挂起的写入）。 */
  disabled: boolean
}

/** 展开箭头；行展开时转成向下。 */
function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 一行模型的删除图标。 */
function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 「检测推理等级」实时进度:分组行式列表(不用表格)。host 每完成一项写入状态,
 * 前端轮询渲染——完成的项立即点亮(✓/✗ + 说明),运行中的显示「… 检测中」。
 * 全部完成后底部显示自动保存结果。中性色,无表格。
 */
function DetectProgress({ state }: { state?: any }): ReactNode {
  if (!state) return null
  const items: Array<any> = Array.isArray(state.items) ? state.items : []
  const doneCount = items.filter(i => i.status === 'done').length
  const levelRows = items.filter(i => i.key.startsWith('level:'))
  const rowOf = (it: any): ReactNode => {
    const mark = it.status === 'pending' ? '—'
      : it.status === 'running' ? '…'
        : it.ok === true ? '✓' : it.ok === false ? '✗' : '—'
    const markColor = it.status !== 'done'
      ? 'var(--dsw-alias-label-tertiary, #8f959e)'
      : it.ok === true ? 'var(--dsw-alias-label-primary, #1f2329)' : 'var(--dsw-alias-label-tertiary, #8f959e)'
    return (
      <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '2px 0', minWidth: 0 }}>
        <span style={{ flex: 'none', width: 96, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-primary, #1f2329)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {it.key.startsWith('level:') ? it.key.slice(6) : it.label}
        </span>
        <span style={{ flex: 'none', width: 76, fontSize: 12, lineHeight: '18px', color: markColor }}>{mark}{it.status === 'running' ? ' 检测中' : ''}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8f959e)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.note}>
          {it.note}
        </span>
      </div>
    )
  }
  const groupTitle = (t: string): ReactNode => (
    <div style={{ marginTop: 4, marginBottom: 2, fontSize: 12, lineHeight: '18px', fontWeight: 500, color: 'var(--dsw-alias-label-secondary, #4e5969)' }}>{t}</div>
  )
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      padding: '8px 12px',
      border: '1px solid var(--dsw-alias-border-l3, #e5e6eb)',
      borderRadius: 10,
    }}>
      {levelRows.length > 0 ? groupTitle('推理等级') : null}
      {levelRows.map(rowOf)}
      <p style={{ ...hintStyle, marginTop: 6 }}>
        {state.running
          ? `检测中… ${doneCount}/${items.length}（可离开此页，后台继续）`
          : `已自动保存：推理等级 ${state.savedLevels ? '✓' : '—'}${state.saveError ? `｜保存出错：${state.saveError}` : ''}`}
      </p>
    </div>
  )
}
/** 能力声明开关：小圆钮 switch + 标签，title 承载说明；点击切换后由回调落盘。 */
function CapabilitySwitch({ label, hint, checked, disabled, onToggle }: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onToggle: (on: boolean) => void
}): ReactNode {
  return (
    <label style={capSwitchRowStyle} title={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        style={checked ? capSwitchOnStyle : capSwitchStyle}
        onClick={() => { onToggle(!checked) }}
      >
        <span style={checked ? capKnobOnStyle : capKnobStyle} />
      </button>
      <span style={capSwitchLabelStyle}>{label}</span>
    </label>
  )
}

/** 作为文本编辑的两个 token 数，位于一行模型的 disclosure 之后。 */
type CapacityField = 'contextWindow' | 'maxTokens'

/** 空容量字段的占位：适配器自身的路由级回退（llm-pi-ai 的默认值），以人话拼写。 */
const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '256K',
  maxTokens: '32K',
}

/** 拼写可能未设置的存储数：未设置时为空串。 */
function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

/** 采纳一个候选，保留提供方披露的容量。 */
function adopt(candidate: DiscoveredModelView): ModelDraft {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
  }
}

/** 渲染模型列表及其获取动作。 */
export function ModelListEditor(props: ModelListEditorProps): ReactNode {
  const { models, onChange, probe, api, disabled } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  // 行携带 id 与 name；容量是例外，折叠到披露里，免得每行挤四个输入框。
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  // 容量以「预设下拉 + 自由键入」的单框编辑，字段的击键保存在这里，而不
  // 是每次变更都从解析值重推——那会把 `1000` 中途重写为 `1K`。不可读文本
  // 保留到 blur 之后，让拒绝文案点名用户仍可见的行；每个字段一个 buffer，
  // 互不挤占。
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(new Map())
  // 当前展开预设面板的字段（`行:字段` 键）；undefined = 全部收起。同一时刻
  // 至多一个面板展开。自绘面板而非原生 datalist：后者的弹出层由浏览器绘制，
  // 在部分环境里点击无响应，且无法与主题同步。
  const [capacityMenu, setCapacityMenu] = useState<string | undefined>(undefined)

  // 一键能力检测:后台任务 + 轮询。host 每完成一项写入状态,前端每 800ms
  // 拉取一次,逐条实时点亮;全部完成后 host 自动落盘,client 同步本地草稿。
  const [detecting, setDetecting] = useState<ReadonlySet<number>>(new Set())
  const [detectState, setDetectState] = useState<ReadonlyMap<number, any>>(new Map())
  const [detectError, setDetectError] = useState<ReadonlyMap<number, string>>(new Map())

  // 生图/生视频能力声明(model-router.json capabilities):手动开关读写,不再实测。
  const [caps, setCaps] = useState<Record<string, string[]>>({})
  const [capsError, setCapsError] = useState<string | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      fetch('/api/model-capabilities', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: any) => {
          if (!alive) return
          if (d && typeof d.capabilities === 'object' && d.capabilities !== null) {
            setCaps(d.capabilities as Record<string, string[]>)
          }
        })
        .catch(() => { /* 接口不可用时无标签 */ })
    }
    load()
    // 其他模型行勾选/取消后,本行同步最新声明(同一 provider/model key)。
    window.addEventListener('dsh-webui:model-capabilities-changed', load)
    return () => {
      alive = false
      window.removeEventListener('dsh-webui:model-capabilities-changed', load)
    }
  }, [])

  /** 生图/生视频声明的 key:provider/model;行内任一字段缺失则不可写。 */
  const capKeyOf = (index: number): string => {
    const provider = probe.provider
    const modelId = textOf(models[index]!, 'id')
    return provider !== undefined && modelId.length > 0 ? `${provider}/${modelId}` : ''
  }

  /** 切换生图/生视频开关:乐观更新 + POST 全量落盘,失败回滚。 */
  const toggleCap = (index: number, cap: 'image' | 'video', on: boolean): void => {
    const key = capKeyOf(index)
    if (!key) return
    const next = { ...caps }
    const cur = new Set<string>(next[key] ?? [])
    if (on) cur.add(cap)
    else cur.delete(cap)
    if (cur.size > 0) next[key] = [...cur]
    else delete next[key]
    setCaps(next)
    setCapsError(undefined)
    fetch('/api/model-capabilities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: next }),
    })
      .then((r) => r.json())
      .then((d: any) => {
        if (!d || d.ok !== true) {
          setCapsError((d && d.error) || chatCopy.capSaveFailed)
          setCaps(caps) // 回滚
          return
        }
        window.dispatchEvent(new CustomEvent('dsh-webui:model-capabilities-changed'))
      })
      .catch(() => {
        setCapsError(chatCopy.capSaveFailed)
        setCaps(caps) // 回滚
      })
  }

  /** 切换识图开关:读写模型草稿的 input 数组(含/不含 image)。 */
  const toggleVision = (index: number, on: boolean): void => {
    const model = models[index]!
    if (on) {
      patch(index, { input: Array.from(new Set([...(inputOf(model) ?? ['text']), 'image'])) })
    } else {
      const rest = (inputOf(model) ?? []).filter(x => x !== 'image')
      // 只剩 text/空 → 删字段恢复继承(与 host 落盘口径一致)。
      patch(index, { input: rest.length <= 1 ? undefined : rest })
    }
  }

  const runFullDetect = (index: number): void => {
    const provider = probe.provider
    const modelId = textOf(models[index]!, 'id')
    if (!provider || !modelId) return
    if (detecting.has(index)) return
    setDetecting(current => new Set(current).add(index))
    setDetectError(current => new Map(current).set(index, ''))
    let timer: number | undefined
    const pollOnce = async (): Promise<void> => {
      try {
        const r = await fetch('/api/detect-capability', { cache: 'no-store' })
        const d: any = await r.json()
        if (!d?.ok || !d.state) return
        setDetectState(current => new Map(current).set(index, d.state))
        if (!d.state.running) {
          if (timer !== undefined) window.clearInterval(timer)
          // 本地草稿同步(与 host 落盘一致,避免保存时覆盖)。
          // 识图/生图/生视频由手动开关声明,检测只写推理等级。
          const st = d.state
          const patches: Record<string, unknown> = {}
          const thinkers = (st.items ?? []).filter((i: any) => i.key.startsWith('level:') && i.ok === true && i.key !== 'level:off')
          if (thinkers.length > 0) {
            const efforts: Record<string, string | null> = { off: null }
            for (const t of thinkers) efforts[t.key.slice(6)] = t.key.slice(6)
            patches.reasoningEfforts = efforts
          }
          if (Object.keys(patches).length > 0) patch(index, patches)
          setDetecting(current => {
            const next = new Set(current)
            next.delete(index)
            return next
          })
        }
      } catch { /* 轮询失败下次再试 */ }
    }
    fetch('/api/detect-capability', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model: modelId }),
    })
      .then((r) => r.json())
      .then((d: any) => {
        if (!d || !d.ok) {
          setDetectError(current => new Map(current).set(index, `检测失败：${(d && d.error) || '未知错误'}`))
          setDetecting(current => {
            const next = new Set(current)
            next.delete(index)
            return next
          })
          return
        }
        if (d.state !== undefined && d.state !== null) setDetectState(current => new Map(current).set(index, d.state))
        timer = window.setInterval(() => { void pollOnce() }, 800)
        void pollOnce()
      })
      .catch((error) => {
        setDetectError(current => new Map(current).set(index, `检测失败：${String(error?.message ?? error)}`))
        setDetecting(current => {
          const next = new Set(current)
          next.delete(index)
          return next
        })
      })
  }

  // 预设项的悬停高亮无法用内联样式表达 :hover；随编辑器挂载注入一次规则。
  // 同一注入块还携带展开 UI 共享的 focus/placeholder/hover 伪类样式。
  useEffect(() => {
    ensureProviderFieldStyles()
    const marker = 'dsh-webui-capacity-menu'
    if (document.getElementById(marker) !== null) return
    const style = document.createElement('style')
    style.id = marker
    style.textContent =
      '.dsh-capacity-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(22,93,255,0.08))}'
    document.head.append(style)
  }, [])

  /** 一个容量字段的 buffer 键；行移动时行号半段随之移动。 */
  const bufferKey = (index: number, field: CapacityField): string => `${String(index)}:${field}`

  const patch = (index: number, next: Record<string, unknown>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      // 重建而非展开覆盖：被清空的可选字段必须离开 profile，而不是存成
      // schema 会拒绝的值。先展开让本卡不编辑的字段幸存；空掉的可选字段
      // 再丢弃。
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  /** 键入或选取一个容量拼写，即时解析进草稿。 */
  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    setEditing(current => new Map(current).set(bufferKey(index, field), text))
    patch(index, { [field]: parseCapacity(text) })
  }

  /** 容量字段显示什么：输入中显示 buffer，否则显示存储值。 */
  const capacityText = (model: ModelDraft, index: number, field: CapacityField): string =>
    editing.get(bufferKey(index, field)) ?? capacitySpelling(numberOf(model, field))

  /** 删除一行并让后续行上移，buffer 一次性重编号。 */
  const reindexOnRemove = (
    current: ReadonlyMap<string, string>,
    index: number,
  ): Map<string, string> => {
    const next = new Map<string, string>()
    for (const [key, value] of current) {
      const at = Number(key.slice(0, key.indexOf(':')))
      if (at === index) continue
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value)
    }
    return next
  }

  const toggleExpanded = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.llm.discoverModels({
        settingsNs: probe.settingsNs,
        ...probe.provider === undefined ? {} : { provider: probe.provider },
        ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
        ...probe.api === undefined ? {} : { api: probe.api },
        ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
      })
      if (!response.result.ok) {
        const msg = response.result.error.message
        // 404/not found = 端点不支持 /models 列表接口；403 = 密钥无效/缺失。
        // 其余错误原样展示。
        if (/404|not found/i.test(msg)) setFailure(chatCopy.fetchUnsupported)
        else if (/403/i.test(msg)) setFailure(chatCopy.fetchKeyInvalid)
        else setFailure(msg)
        return
      }
      const found = response.result.value.models
      if (found.length === 0) {
        setFailure(chatCopy.fetchEmpty)
        return
      }
      // 全部候选默认不勾选，由用户显式挑选要添加的模型；采纳选择永不
      // 静默重写用户修正过的容量。
      setCandidates(found)
      setPicked(new Set())
    } catch (error) {
      // 传输拒绝而非作答；不捕获按钮会一直 busy 且无任何提示。
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
  }

  const adoptPicked = (): void => {
    /* v8 ignore next -- 对话框只在候选加载后渲染 */
    if (candidates === undefined) return
    const byId = new Map(models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      // 用户已调校过的行胜过提供方自己的数字。按 id 键控：id 仍为空的
      // 半输入行不匹配，候选作为自己的行加入——正确，因为无 id 的行还不
      // 是模型，创建/保存门禁会拒绝它。
      byId.set(candidate.id, byId.get(candidate.id) ?? adopt(candidate))
    }
    onChange([...byId.values()])
    closePicker()
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  // 适配器已描述的路由无需端点即可作答；只有两者皆无的草稿无话可问。
  const askable = probe.provider !== undefined || (probe.baseURL !== undefined && probe.baseURL.length > 0)

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, lineHeight: '18px', fontWeight: 500, color: 'var(--dsw-alias-label-secondary, #4e5969)' }}>
          {chatCopy.models}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {props.overridden === true && props.onReset !== undefined
            ? (
              <button
                type="button"
                className="dsh-webui-link-btn"
                style={linkButtonStyle}
                disabled={disabled}
                onClick={props.onReset}
              >
                {chatCopy.restoreDefaults}
              </button>
            )
            : null}
          <button
            type="button"
            className="dsh-webui-link-btn"
            disabled={disabled || busy || !askable}
            title={askable ? undefined : chatCopy.fetchNeedsBaseUrl}
            style={linkButtonStyle}
            onClick={() => { void fetchModels() }}
          >
            {busy ? chatCopy.fetching : chatCopy.fetchModels}
          </button>
        </span>
      </div>
      {models.length === 0
        ? <p style={hintStyle}>{chatCopy.modelsEmpty}</p>
        : null}
      {models.map((model, index) => (
        <div key={index} style={modelEntryStyle}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="dsh-webui-field"
              style={inputStyle}
              type="text"
              value={textOf(model, 'id')}
              placeholder={chatCopy.modelId}
              aria-label={`${chatCopy.modelId} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { id: event.target.value }) }}
            />
            <input
              className="dsh-webui-field"
              style={inputStyle}
              type="text"
              value={textOf(model, 'name')}
              placeholder={chatCopy.modelName}
              aria-label={`${chatCopy.modelName} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { name: event.target.value === '' ? undefined : event.target.value }) }}
            />
            <button
              type="button"
              className="dsh-webui-icon-btn"
              style={iconButtonStyle}
              aria-label={`${chatCopy.modelAdvanced} ${index + 1}`}
              aria-expanded={expanded.has(index)}
              title={chatCopy.modelAdvanced}
              onClick={() => { toggleExpanded(index) }}
            >
              <IconChevron open={expanded.has(index)} />
            </button>
            <button
              type="button"
              className="dsh-webui-icon-btn dsh-webui-icon-btn-danger"
              style={{ ...iconButtonStyle, color: 'var(--dsw-alias-state-error-primary, #d54941)' }}
              aria-label={`${chatCopy.removeModel} ${index + 1}`}
              title={chatCopy.removeModel}
              disabled={disabled}
              onClick={() => {
                onChange(models.filter((_model, at) => at !== index))
                // 两个 store 都以位置键控，后续行上移后会继承邻居的状态，
                // 必须同步重编号。
                setExpanded((current) => {
                  const next = new Set<number>()
                  for (const at of current) {
                    if (at < index) next.add(at)
                    else if (at > index) next.add(at - 1)
                  }
                  return next
                })
                setEditing(current => reindexOnRemove(current, index))
              }}
            >
              <IconTrash />
            </button>
          </div>
          {expanded.has(index)
            ? (
              <>
                <div style={{ display: 'flex', gap: 12, paddingLeft: 4 }}>
                  {(['contextWindow', 'maxTokens'] as const).map((field) => {
                    const menuKey = `${String(index)}:${field}`
                    const menuOpen = capacityMenu === menuKey
                    return (
                      <div
                        key={field}
                        style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}
                      >
                        <span style={fieldLabelStyle}>{chatCopy[field]}</span>
                        <input
                          className="dsh-webui-field"
                          style={capacityInputStyle}
                          type="text"
                          value={capacityText(model, index, field)}
                          placeholder={CAPACITY_HINT[field]}
                          aria-label={`${chatCopy[field]} ${index + 1}`}
                          role="combobox"
                          aria-expanded={menuOpen}
                          aria-controls={`dsh-capacity-menu-${field}`}
                          disabled={disabled}
                          onChange={(event) => { editCapacity(index, field, event.target.value) }}
                          onClick={() => { setCapacityMenu(current => current === menuKey ? undefined : menuKey) }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') setCapacityMenu(undefined)
                          }}
                        />
                        {menuOpen
                          ? (
                            <>
                              {/* 透明遮罩：点面板外任意处收起，免挂全局监听。 */}
                              <div style={capacityMenuBackdropStyle} onClick={() => { setCapacityMenu(undefined) }} />
                              <div
                                id={`dsh-capacity-menu-${field}`}
                                role="listbox"
                                aria-label={chatCopy[field]}
                                style={capacityMenuPanelStyle}
                              >
                                {CAPACITY_PRESETS[field].map(preset => (
                                  <button
                                    key={preset}
                                    type="button"
                                    className="dsh-capacity-menu-item"
                                    style={capacityMenuItemStyle}
                                    // mousedown 抢在 input blur 之前完成选择，
                                    // 避免焦点抖动引起面板闪关。
                                    onMouseDown={(event) => {
                                      event.preventDefault()
                                      editCapacity(index, field, preset)
                                      setCapacityMenu(undefined)
                                    }}
                                  >
                                    {preset}
                                  </button>
                                ))}
                              </div>
                            </>
                          )
                          : null}
                      </div>
                    )
                  })}
                </div>
                <div style={capabilityBlockStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={fieldLabelStyle}>{chatCopy.capabilityHint}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <CapabilitySwitch
                      label={chatCopy.supportsImage}
                      hint={chatCopy.supportsImageHint}
                      checked={supportsImage(model)}
                      disabled={disabled}
                      onToggle={(on) => { toggleVision(index, on) }}
                    />
                    <CapabilitySwitch
                      label={chatCopy.supportsImageGen}
                      hint={chatCopy.supportsImageGenHint}
                      checked={(caps[capKeyOf(index)] ?? []).includes('image')}
                      disabled={disabled || capKeyOf(index) === ''}
                      onToggle={(on) => { toggleCap(index, 'image', on) }}
                    />
                    <CapabilitySwitch
                      label={chatCopy.supportsVideoGen}
                      hint={chatCopy.supportsVideoGenHint}
                      checked={(caps[capKeyOf(index)] ?? []).includes('video')}
                      disabled={disabled || capKeyOf(index) === ''}
                      onToggle={(on) => { toggleCap(index, 'video', on) }}
                    />
                  </div>
                  {capsError !== undefined ? <p style={errorStyle}>{capsError}</p> : null}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={fieldLabelStyle}>推理等级</span>
                    <button
                      type="button"
                      style={{ ...capabilityTestButtonStyle, color: 'var(--dsw-alias-state-business-primary, #4176e6)', borderColor: 'var(--dsw-alias-state-business-primary, #4176e6)' }}
                      disabled={disabled || detecting.has(index) || probe.provider === undefined}
                      title={chatCopy.detectReasoningTitle}
                      onClick={(event) => { event.stopPropagation(); runFullDetect(index) }}
                    >
                      {detecting.has(index) ? chatCopy.detectingReasoning : chatCopy.detectReasoning}
                    </button>
                    {probe.provider === undefined ? <span style={hintStyle}>保存供应商后可检测</span> : null}
                  </div>
                  {(detectError.get(index) ?? '') !== ''
                    ? <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #d54941)' }}>{detectError.get(index)}</p>
                    : null}
                  <DetectProgress state={detectState.get(index)} />
                </div>
              </>
            )
            : null}
        </div>
      ))}
      <button
        type="button"
        className="dsh-webui-capsule-btn"
        style={addModelButtonStyle}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '' }]) }}
      >
        + {chatCopy.addModel}
      </button>
      {failure !== undefined ? <p style={errorStyle}>{failure}</p> : null}
      {candidates !== undefined ? (
        <div style={overlayStyle} onClick={closePicker}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={chatCopy.fetchTitle}
            style={modalStyle}
            onClick={(event) => { event.stopPropagation() }}
          >
            <div style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: 'var(--dsw-alias-label-primary, #1f2329)' }}>
              {chatCopy.fetchTitle}
            </div>
            <p style={hintStyle}>{chatCopy.fetchDescription}</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {candidates.map(candidate => (
                <li key={candidate.id} style={candidateStyle}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={picked.has(candidate.id)}
                      onChange={() => { toggle(candidate.id) }}
                    />
                    <span style={candidateIdStyle}>{candidate.id}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" className="dsh-webui-secondary-btn" style={secondaryButtonStyle} onClick={closePicker}>
                {chatCopy.cancel}
              </button>
              <button type="button" className="dsh-webui-primary-btn" style={primaryButtonStyle} onClick={adoptPicked}>
                {chatCopy.fetchAdopt}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/* ---------- 内联样式（主题令牌 + fallback） ---------- */

/* 官方 .modelEntry：每条模型一个细边框盒，与行卡片语言一致。 */
const modelEntryStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 8,
  padding: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

/* 官方 .input 规格：32px 高、14px 字、8px 圆角、0 10px 内边距。 */
const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  height: 32,
  padding: '0 10px',
  fontSize: 14,
  lineHeight: '22px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  background: 'var(--dsw-alias-bg-layer-1, #fff)',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  outline: 'none',
}

/* 容量预设输入框：.input 规格叠加共享 chevron——点击弹出常用档位列表，
 * 仍可自由键入任意值（如 131072）。chevron 内嵌位置与 .selectInput 一致
 * （右 12px，右内边距预留 32px）。 */
const capacityInputStyle: CSSProperties = {
  ...inputStyle,
  paddingRight: 32,
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\'%3E%3Cpath d=\'M3 4.5L6 7.5L9 4.5\' stroke=\'%2381858C\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  backgroundSize: '12px 12px',
}

/* 预设面板的透明遮罩：铺满视口承接「点外部收起」。 */
const capacityMenuBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 990,
}

/* 预设面板：填充面 + 浮层阴影，贴着所属输入框下缘展开；深浅主题经令牌同步。 */
const capacityMenuPanelStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  zIndex: 991,
  boxSizing: 'border-box',
  maxHeight: 240,
  overflowY: 'auto',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: 'var(--dsw-alias-bg-module-platform, #fff)',
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
}

/* 预设项：行内小按钮；悬停高亮由注入的 .dsh-capacity-menu-item:hover 提供。 */
const capacityMenuItemStyle: CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  lineHeight: '20px',
  textAlign: 'left',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  cursor: 'pointer',
}

/* 官方 .iconButton：28×28 方形图标钮，hover 由注入的 .dsh-webui-icon-btn
 * 系列提供（普通=中性底、danger=危险底）。 */
const iconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
  cursor: 'pointer',
}

/* 官方 .linkButton：28px 高的透明文字钮，tertiary 色，hover 才浮出底色。
 * （不用 brand-primary：该令牌是反色设计，浅色主题下为黑。） */
const linkButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  padding: '0 10px',
  border: 'none',
  borderRadius: 14,
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
}

/* 官方 .addModelButton：28px 实线胶囊（虚线只属于「空态/添加入口」，模型
 * 目录的添加是常规命令）。 */
const addModelButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 10px',
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 14,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
}

/* 字段标签：与 ChatProviderDetail 的 Field 标签同规格（12/18/500 secondary）。 */
const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  fontWeight: 500,
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
}

/* 能力区块（识图/生图/生视频开关 + 推理等级检测按钮）：容量之下，带顶部分隔线。 */
const capabilityBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  paddingTop: 10,
  marginTop: 2,
  borderTop: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
}

/* 能力声明开关：行内圆钮 switch + 标签（对齐官方 switch 规格的紧凑版）。 */
const capSwitchRowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  userSelect: 'none',
}

const capSwitchStyle: CSSProperties = {
  position: 'relative',
  width: 34,
  height: 18,
  borderRadius: 9,
  border: 'none',
  cursor: 'pointer',
  flex: 'none',
  padding: 0,
  background: 'var(--dsw-alias-border-l2, #dcdfe6)',
  transition: 'background .15s',
}

const capSwitchOnStyle: CSSProperties = {
  ...capSwitchStyle,
  background: 'var(--dsw-alias-state-business-primary, #4176e6)',
}

const capKnobStyle: CSSProperties = {
  position: 'absolute',
  top: 2,
  left: 2,
  width: 14,
  height: 14,
  borderRadius: '50%',
  background: 'var(--dsw-alias-label-tertiary, #8f959e)',
  transition: 'left .15s, background .15s',
  boxShadow: '0 1px 2px rgba(0,0,0,.2)',
}

const capKnobOnStyle: CSSProperties = {
  ...capKnobStyle,
  left: 18,
  background: '#fff',
}

const capSwitchLabelStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
  whiteSpace: 'nowrap',
}

/* 「一键检测」按钮：行内 dense 胶囊（28 高、14 圆角、12 字），与列表行
 * 的「测试/编辑」小胶囊同规格；强调色用品牌蓝 business-primary。 */
const capabilityTestButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  height: 28,
  padding: '0 12px',
  border: '1px solid var(--dsw-alias-state-business-primary, #4176e6)',
  borderRadius: 14,
  background: 'transparent',
  color: 'var(--dsw-alias-state-business-primary, #4176e6)',
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
  flex: 'none',
}

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

const errorStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-state-error-primary, #d54941)',
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

/* 官方 .fetchDialog：候选弹窗最大 520px，滚动列表收在浮层内。 */
const modalStyle: CSSProperties = {
  width: 'min(520px, calc(100vw - 48px))',
  maxHeight: '70vh',
  overflowY: 'auto',
  padding: 16,
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-module-platform, #fff)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

/* 候选条目：圆角行 + code 字体 id（官方 .candidate/.candidateId）。 */
const candidateStyle: CSSProperties = {
  borderRadius: 6,
}

const candidateIdStyle: CSSProperties = {
  flex: '1 1 auto',
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  overflowWrap: 'anywhere',
}

/* 弹窗按钮与表单 footer 同规格：36px 高、18px 圆角大胶囊、14 字。 */
const primaryButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 36,
  padding: '0 14px',
  fontSize: 14,
  lineHeight: '22px',
  borderRadius: 18,
  border: 'none',
  background: 'var(--dsw-alias-button-primary-fill, #4176e6)',
  color: 'var(--dsw-alias-label-primary-foreground, #fff)',
  cursor: 'pointer',
}

const secondaryButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 36,
  padding: '0 14px',
  fontSize: 14,
  lineHeight: '22px',
  borderRadius: 18,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  cursor: 'pointer',
}
