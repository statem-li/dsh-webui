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

import { useState } from 'react'
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
  // 容量以文本编辑，因此字段的击键保存在这里，而不是每次变更都从解析值
  // 重推——那会把 `1000` 中途重写为 `1K`。不可读文本保留到 blur 之后，让
  // 拒绝文案点名用户仍可见的行；每个字段一个 buffer，互不挤占。
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(new Map())

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

  /** 一行的已声明等级映射；无声明时为空映射。 */
  const effortMapOf = (model: ModelDraft): Record<string, string | null> => {
    const efforts = model['reasoningEfforts']
    return typeof efforts === 'object' && efforts !== null && !Array.isArray(efforts)
      ? efforts as Record<string, string | null>
      : {}
  }

  /** 一个等级的线上值字段显示什么：存储值，省略的 off 显示为空。 */
  const effortWire = (map: Record<string, string | null>, level: string): string => {
    const value = map[level]
    return value === null || value === undefined ? '' : String(value)
  }

  /** 勾选/取消一个已声明等级，勾选时线上值从等级名播种。 */
  const toggleEffort = (index: number, level: string, on: boolean): void => {
    const current = effortMapOf(models[index]!)
    const next: Record<string, string | null> = { ...current }
    if (on) next[level] = level === 'off' ? null : level
    else delete next[level]
    patch(index, { reasoningEfforts: next })
  }

  /** 编辑一个等级的线上值；清空 off 表示「不发送该参数」。 */
  const setEffortWire = (index: number, level: string, text: string): void => {
    const current = effortMapOf(models[index]!)
    const next: Record<string, string | null> = { ...current }
    next[level] = text.length === 0 ? (level === 'off' ? null : '') : text
    patch(index, { reasoningEfforts: next })
  }

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
      // 已配置的条目默认不勾选：采纳选择永不静默重写用户修正过的容量。
      const known = new Set(models.map(model => textOf(model, 'id')))
      setCandidates(found)
      setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)))
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
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2329)' }}>
          {chatCopy.models}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {props.overridden === true && props.onReset !== undefined
            ? (
              <button
                type="button"
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
        <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              style={inputStyle}
              type="text"
              value={textOf(model, 'id')}
              placeholder={chatCopy.modelId}
              aria-label={`${chatCopy.modelId} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { id: event.target.value }) }}
            />
            <input
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
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <span style={fieldLabelStyle}>{chatCopy.contextWindow}</span>
                    <input
                      style={inputStyle}
                      type="text"
                      inputMode="numeric"
                      value={capacityText(model, index, 'contextWindow')}
                      placeholder={CAPACITY_HINT.contextWindow}
                      aria-label={`${chatCopy.contextWindow} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) => { editCapacity(index, 'contextWindow', event.target.value) }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <span style={fieldLabelStyle}>{chatCopy.maxTokens}</span>
                    <input
                      style={inputStyle}
                      type="text"
                      inputMode="numeric"
                      value={capacityText(model, index, 'maxTokens')}
                      placeholder={CAPACITY_HINT.maxTokens}
                      aria-label={`${chatCopy.maxTokens} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) => { editCapacity(index, 'maxTokens', event.target.value) }}
                    />
                  </label>
                </div>
                <div style={effortBlockStyle}>
                  <span style={fieldLabelStyle}>{chatCopy.reasoningEfforts}</span>
                  <p style={hintStyle}>{chatCopy.effortHint}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {REASONING_LEVELS.map(level => {
                      const map = effortMapOf(model)
                      const checked = level in map
                      return (
                        <label key={level} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            aria-label={`${chatCopy.effortLevel} ${level} ${index + 1}`}
                            onChange={(event) => { toggleEffort(index, level, event.target.checked) }}
                          />
                          <span style={effortLevelNameStyle}>{level}</span>
                          <input
                            style={inputStyle}
                            type="text"
                            value={effortWire(map, level)}
                            placeholder={level === 'off' ? chatCopy.effortOffWire : level}
                            aria-label={`${chatCopy.effortWire} ${level} ${index + 1}`}
                            disabled={disabled || !checked}
                            onChange={(event) => { setEffortWire(index, level, event.target.value) }}
                          />
                        </label>
                      )
                    })}
                  </div>
                </div>
              </>
            )
            : null}
        </div>
      ))}
      <button
        type="button"
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
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2329)' }}>
              {chatCopy.fetchTitle}
            </div>
            <p style={hintStyle}>{chatCopy.fetchDescription}</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {candidates.map(candidate => (
                <li key={candidate.id}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={picked.has(candidate.id)}
                      onChange={() => { toggle(candidate.id) }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-primary, #1f2329)' }}>{candidate.id}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" style={secondaryButtonStyle} onClick={closePicker}>
                {chatCopy.cancel}
              </button>
              <button type="button" style={primaryButtonStyle} onClick={adoptPicked}>
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

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '6px 8px',
  fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  background: 'var(--dsw-alias-bg-layer-1, #fff)',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  outline: 'none',
}

const iconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
  cursor: 'pointer',
}

const linkButtonStyle: CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  border: 'none',
  borderRadius: 6,
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(22,93,255,0.08))',
  color: 'var(--dsw-alias-brand-primary, #165dff)',
  cursor: 'pointer',
}

const addModelButtonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '4px 10px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px dashed var(--dsw-alias-border-l3, #c9cdd4)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
  cursor: 'pointer',
}

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
}

/* 推理等级区块：容量之下、全宽、带顶部分隔线。 */
const effortBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingTop: 10,
  marginTop: 2,
  borderTop: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
}

/* 等级名：wire 标识，等宽字体，与候选 id 一致。 */
const effortLevelNameStyle: CSSProperties = {
  fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, monospace)',
  fontSize: 13,
  minWidth: 64,
  color: 'var(--dsw-alias-label-primary, #1f2329)',
}

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

const errorStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
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

const modalStyle: CSSProperties = {
  width: 420,
  maxWidth: 'calc(100vw - 48px)',
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

const primaryButtonStyle: CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  borderRadius: 6,
  border: 'none',
  background: 'var(--dsw-alias-button-primary-fill, #165dff)',
  color: 'var(--dsw-alias-label-primary-foreground, #fff)',
  cursor: 'pointer',
}

const secondaryButtonStyle: CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  cursor: 'pointer',
}
