/**
 * 「对话供应商」右详情：一个提供方的编辑卡片，覆盖三种目标：
 * - `edit`：已配置行——从用户层 profile 起稿，保存走最小路径 ops；
 * - `adopt`：目录预设行——未配置但适配器已发货，同样的表单，保存即创建；
 * - `custom`：自定义提供方——适配器不发货的路由，route id 在此被*选择*，
 *   一次性 `settings.mutate` 写入整个 `providers.<route>` profile。
 *
 * 主字段是 write-only 的 **API Key** 输入（本页从不询问环境变量名——键入
 * 的密钥经 `credentials.set` 存入 profile 引用的凭据名，profile 无引用时
 * 派生 `<ROUTE>_API_KEY`；pi-ai profile 仅在键入密钥时把派生名记为
 * `apiKeyEnv`，留空则物化一个无引用的 profile 走提供方原生认证）。
 * 其余字段：baseURL、协议（仅手工声明的 pi-ai 路由）、模型列表（含获取
 * 可用模型）。headers 字段按任务约定省略（有安全风险）。
 *
 * 每次编辑都以最小 `settings.mutate` 路径 ops 落在存储的 section 上——卡片
 * 只点名自己能看见的字段，而不是从部分描述符重建整棵子树。
 *
 * 移植自官方 ui-settings-models 的 ProviderEditor.tsx / CustomProviderCard.tsx。
 */

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  CredentialView, IApiClient, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  deletePath, getPath, hasPath, nodeAtPath, rehydrateSchema, setPath, validateDraft,
} from '@deepseek-ai/dsh-client-schema-form'
import { ModelListEditor, modelDrafts, validateModels } from './ModelListEditor.tsx'
import type { ModelDraft, T } from './ModelListEditor.tsx'
import { chatCopy, t as chatT } from './ModelListEditor.tsx'
import { deriveKeyRef, messageOf, protocolChoices } from './store.ts'
import type { ModelsSettingsState } from './store.ts'

/** 详情卡片的目标模式。 */
export type ChatProviderMode = 'edit' | 'adopt' | 'custom'

/** 详情卡片寻址的一个提供方目标。 */
export interface ChatProviderTarget {
  /** 稳定的提供方路由 id。 */
  provider: string
  /** 人类可读的提供方名。 */
  displayName: string
  /** 配置该提供方的设置命名空间。 */
  settingsNs: string
  /** 从该 section 根到提供方 profile 的路径（空 = 整个 section）。 */
  settingsPath: readonly string[]
  /** 本页惯例引用下可写的凭据名（删除时一并 unset）。 */
  credentialRef?: string
  /** 适配器报告该路由为手工声明（无内建 catalog 条目）。 */
  declared?: boolean
  /** 编辑 / 目录预设创建 / 自定义创建。 */
  mode: ChatProviderMode
}

/** {@link ChatProviderDetail} 的 props。 */
export interface ChatProviderDetailProps {
  /** 当前页面快照（提供命名空间视图与写权限）。 */
  state: ModelsSettingsState
  /** 正在编辑/创建的目标。 */
  target: ChatProviderTarget
  /** wire 面。 */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** 本地化函数；缺省用内置中文字典。 */
  t?: T
  /** 关闭卡片；`changed` 报告是否有提交落地。 */
  onClose: (changed: boolean) => void
}

/** 未知命名空间只渲染提示（与官方 EditorLayout 对齐）。 */
type EditorLayout = 'deepseek' | 'pi-ai' | 'unknown'

/** 官方 DeepSeek 公共端点，作为 deepseek baseURL 的占位。 */
const DEEPSEEK_PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** 自定义路由 id 的合法性：小写字母开头，之后小写字母/数字/短横线。 */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** 与官方 apiKey.ts 同步的浏览器侧密钥判断。 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

/** 是否被一对匹配引号包裹（粘贴伪影）。 */
function isQuoted(value: string): boolean {
  const first = value[0]
  if (first !== '"' && first !== '\'' && first !== '`') return false
  return value.length > 1 && value.endsWith(first)
}

/**
 * 判断 key 输入当前值：空字段不算失败（每张卡打开时都空，即使已存 key，
 * 空 = 保留旧值）；只有空白是失败（键入的输入绝不静默丢弃）。
 */
function apiKeyFailure(draft: string): 'keyBlank' | 'keyIllegalCharacters' | undefined {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'keyBlank'
  if (ENV_LINE.test(value) || isQuoted(value)) return 'keyIllegalCharacters'
  if (!LEGAL_API_KEY.test(value)) return 'keyIllegalCharacters'
  return undefined
}

/** 用户 section 的一棵子树作为普通草稿对象（缺失 → 空）。 */
function draftAt(namespace: SettingsNamespaceView, path: readonly string[]): Record<string, unknown> {
  const subtree = getPath(namespace.user, path)
  if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree)) return {}
  return structuredClone(subtree) as Record<string, unknown>
}

/**
 * 携带 `after` 越过 `before` 的最小路径 ops，两侧都是卡片所见。只有卡片
 * 观察过的键被点名；两侧都缺席的字段不产生 op——这正是路径寻址而非重建
 * section 的意义。
 */
export function pathOps(
  base: readonly string[],
  before: unknown,
  after: Record<string, unknown>,
): SettingsPathOpView[] {
  const previous = typeof before === 'object' && before !== null && !Array.isArray(before)
    ? before as Record<string, unknown>
    : {}
  const ops: SettingsPathOpView[] = []
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue
    ops.push({ op: 'set', path: [...base, key], value })
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: 'unset', path: [...base, key] })
  }
  return ops
}

/** 拥有命名空间选择的编辑布局。 */
function layoutOf(ns: string): EditorLayout {
  if (ns === 'llm-deepseek') return 'deepseek'
  if (ns === 'llm-pi-ai') return 'pi-ai'
  return 'unknown'
}

/** 该 profile 解析出的密钥经由的凭据引用。 */
function refFor(namespace: SettingsNamespaceView, path: readonly string[], provider: string): string {
  const profile = getPath(namespace.value, path)
  const named = typeof profile === 'object' && profile !== null
    ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv
    : undefined
  return typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(provider)
}

/**
 * 渲染「对话供应商」右详情。
 * @param props - 目标、快照、wire 面与回调。
 * @returns 详情卡片。
 */
export function ChatProviderDetail(props: ChatProviderDetailProps): ReactNode {
  const { state, target, api, onClose } = props
  const t = props.t ?? chatT
  const namespace = state.namespaces.get(target.settingsNs)

  // 草稿/提交状态在目标切换时整体重置（父组件也可用 key 强制 remount）。
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    namespace === undefined ? {} : draftAt(namespace, target.settingsPath))
  const [committedOriginal, setCommittedOriginal] = useState<unknown>(() =>
    namespace === undefined ? undefined : getPath(namespace.user, target.settingsPath))
  const [expectedRevision, setExpectedRevision] = useState(() => namespace?.revision ?? 0)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyState, setKeyState] = useState<CredentialView | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)

  // 自定义创建模式专用字段。
  const [route, setRoute] = useState('')
  const [customName, setCustomName] = useState('')
  const [customBaseURL, setCustomBaseURL] = useState('')
  const [customProtocol, setCustomProtocol] = useState('')
  const [customModels, setCustomModels] = useState<readonly ModelDraft[]>([])
  /** 创建模式的 profile 写入已落地；只有 key 写入可能还挂着。 */
  const [committed, setCommitted] = useState(false)

  useEffect(() => {
    setDraft(namespace === undefined ? {} : draftAt(namespace, target.settingsPath))
    setCommittedOriginal(namespace === undefined ? undefined : getPath(namespace.user, target.settingsPath))
    setExpectedRevision(namespace?.revision ?? 0)
    setKeyDraft('')
    setKeyState(undefined)
    setFailure(undefined)
    setSaved(false)
    setDeleteArmed(false)
    setBusy(false)
    setRoute('')
    setCustomName('')
    setCustomBaseURL('')
    setCustomProtocol('')
    setCustomModels([])
    setCommitted(false)
    // 目标身份由 provider + settingsNs + path + mode 决定；revision 变化
    // 时也重置，避免拿旧 revision 做写入基线。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.provider, target.settingsNs, target.settingsPath.join('/'), target.mode, namespace?.revision])

  const layout = layoutOf(target.settingsNs)
  const root = useMemo(() => namespace === undefined ? undefined : rehydrateSchema(namespace.schema), [namespace])
  const node = useMemo(() => namespace !== undefined && root !== undefined
    ? nodeAtPath(root, target.settingsPath)
    : undefined, [root, namespace, target.settingsPath])
  const fallback = namespace === undefined ? undefined : getPath(namespace.value, target.settingsPath)
  const disabled = !state.writable || busy
  // 命名空间缺失时（加载中）退化为惯例引用；describe 未知引用返回 unconfigured，无害。
  const keyRef = target.mode === 'custom'
    ? deriveKeyRef(route.length > 0 ? route : target.provider)
    : namespace === undefined
      ? deriveKeyRef(target.provider)
      : refFor(namespace, target.settingsPath, target.provider)
  // 只有 pi-ai 的 schema 有按路由的协议可供读取；deepseek 整节 profile 跳过。
  const protocols = useMemo(
    () => layout === 'pi-ai' ? protocolChoices(namespace) : [],
    [layout, namespace],
  )

  useEffect(() => {
    let stale = false
    setKeyState(undefined)
    // key 状态只是占位提示，不是编辑前提：业务拒绝或传输失败都不得以未
    // 处理的 rejection 到达浏览器，卡片直接不带「已配置」提示渲染。
    void api.credentials.describe({ refs: [keyRef] }).then(
      (response) => {
        if (stale || !response.result.ok) return
        setKeyState(response.result.value.credentials[keyRef])
      },
      () => undefined,
    )
    return () => { stale = true }
  }, [api.credentials, keyRef])

  // 自定义创建的协议默认取适配器报告的第一个选项。
  useEffect(() => {
    if (target.mode === 'custom' && customProtocol === '' && protocols.length > 0) {
      const first = protocols[0]
      if (first !== undefined) setCustomProtocol(first)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.mode, protocols])

  const stringAt = (source: unknown, key: string): string | undefined => {
    const value = getPath(source, [key])
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  const setField = (key: string, next: string | undefined): void => {
    // 纯空白不存储：stringAt 已把它报为缺席，否则字段渲染为空而草稿仍把
    // 空格带进 settings.yaml，两个适配器都会把该非空串当真值。
    const value = next === undefined || next.trim().length === 0 ? undefined : next
    setDraft(current => value === undefined ? deletePath(current, [key]) : setPath(current, [key], value))
  }

  const modelFailure = validateModels(target.mode === 'custom' ? customModels : getPath(draft, ['models']))
  const keyFailure = apiKeyFailure(keyDraft)
  // 键入的 key 去掉粘贴空白；空白字段产出空串，两个调用点都读作「未提供 key」。
  const keyValue = keyDraft.trim()
  const shownKeyFailure = keyFailure
  const keyLocked = keyState?.writable === false

  /** 表单当前显示的内容，即询问必须携带的：编辑过但未保存的端点，键入未存的 key。 */
  const probeApi = stringAt(draft, 'api') ?? stringAt(fallback, 'api')
  const probeBaseURL = target.mode === 'custom'
    ? (customBaseURL.length > 0 ? customBaseURL : undefined)
    : stringAt(draft, 'baseURL') ?? stringAt(fallback, 'baseURL')
  const probe = {
    settingsNs: target.settingsNs,
    // 命名路由让能描述它的适配器从自己的注册表作答。
    provider: target.mode === 'custom' ? undefined : target.provider,
    ...probeBaseURL === undefined ? {} : { baseURL: probeBaseURL },
    ...probeApi === undefined ? {} : { api: probeApi },
    ...keyValue.length === 0 ? {} : { apiKey: keyValue },
  }

  /** 编辑/预设创建的提交，返回失败消息或 undefined。 */
  const applyOnce = async (): Promise<string | undefined> => {
    const ns = target.settingsNs
    // pi-ai profile 只在要存 key 时命名惯例引用；否则保持提供方原生认证路径。
    const next = layout === 'pi-ai' && stringAt(draft, 'apiKeyEnv') === undefined
      && stringAt(fallback, 'apiKeyEnv') === undefined && keyValue.length > 0
      ? setPath(draft, ['apiKeyEnv'], keyRef)
      : draft
    if (modelFailure !== undefined) {
      return `${chatCopy.modelId} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`
    }
    if (node !== undefined && target.settingsPath.length === 0) {
      const sectionError = validateDraft(node, next)
      if (sectionError !== undefined) return sectionError
    }
    const materializesNativeProfile = layout === 'pi-ai'
      && fallback === undefined
      && committedOriginal === undefined
      && Object.keys(next).length === 0
    const ops: SettingsPathOpView[] = materializesNativeProfile
      ? [{ op: 'set', path: [...target.settingsPath], value: {} }]
      : pathOps(target.settingsPath, committedOriginal, next)
    if (ops.length > 0) {
      const response = await api.settings.mutate({ ns, ops, expectedRevision })
      if (!response.result.ok) {
        return response.result.error.code === 'settings-conflict'
          ? chatCopy.conflict
          : response.result.error.message
      }
      setCommittedOriginal(getPath(response.result.value.user, target.settingsPath))
      setExpectedRevision(response.result.value.revision)
      setDraft(next)
    }
    if (keyValue.length > 0) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      if (!stored.result.ok) return stored.result.error.message
    }
    setKeyDraft('')
    return undefined
  }

  /** 自定义创建的提交，返回失败消息或 undefined。 */
  const createOnce = async (): Promise<string | undefined> => {
    const keyRefForRoute = deriveKeyRef(route)
    const storesKey = keyValue.length > 0
    if (!committed) {
      const profile = {
        ...customName.length === 0 ? {} : { displayName: customName },
        // 与编辑卡一致：只有要存 key 时命名惯例引用，留空保持原生认证。
        ...storesKey ? { apiKeyEnv: keyRefForRoute } : {},
        api: customProtocol,
        baseURL: customBaseURL,
        models: customModels.map(model => ({ ...model })),
      }
      const response = await api.settings.mutate({
        ns: 'llm-pi-ai',
        ops: [{ op: 'set', path: ['providers', route], value: profile }],
        // `taken` 也是快照，id 检查看不到卡打开后才声明的路由；revision
        // 让该竞争变成 settings-conflict 而不是覆盖别人整个 profile。
        expectedRevision: expectedRevision,
      })
      if (!response.result.ok) return response.result.error.message
      // 提供方已存在。key 写入失败后的重试不得重跑这次 mutate：它持有的
      // revision 已被本次写入取代，Host 会答 settings-conflict，key 将永远
      // 无法从这张卡存进去。
      setCommitted(true)
    }
    if (storesKey) {
      const stored = await api.credentials.set({ ref: keyRefForRoute, value: keyValue })
      if (!stored.result.ok) return stored.result.error.message
    }
    return undefined
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = target.mode === 'custom' ? await createOnce() : await applyOnce()
      if (outcome !== undefined) {
        setFailure(outcome)
        return
      }
      setSaved(true)
      onClose(true)
    } catch (error) {
      // 传输失败 reject 而非作答；不捕获卡片会永远 busy 且无任何错误。
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  /** 删除已配置 profile（凭据先删，第二步失败则行仍可见、操作可安全重试）。 */
  const removeOnce = async (): Promise<string | undefined> => {
    try {
      if (target.credentialRef !== undefined) {
        const credential = await api.credentials.unset({ ref: target.credentialRef })
        if (!credential.result.ok) return credential.result.error.message
      }
      const response = await api.settings.mutate({
        ns: target.settingsNs,
        ops: [{ op: 'unset', path: [...target.settingsPath] }],
      })
      if (!response.result.ok) return response.result.error.message
    } catch (error) {
      return messageOf(error)
    }
    onClose(true)
    return undefined
  }

  const confirmDelete = (): void => {
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }
    setBusy(true)
    setFailure(undefined)
    void removeOnce().then((outcome) => {
      if (outcome !== undefined) {
        setFailure(outcome)
        setDeleteArmed(false)
      }
    }).finally(() => { setBusy(false) })
  }

  if (namespace === undefined || root === undefined) {
    return <p style={errorStyle}>{`${target.provider}: 命名空间 ${target.settingsNs} 不可用`}</p>
  }
  if (node === undefined && target.mode !== 'custom') {
    // 目录条目寻址到 schema 无法解析的位置是 Host 侧不一致；显示胜过空白卡。
    return <p style={errorStyle}>{`${target.provider}: unresolvable settings path`}</p>
  }

  /** 用户层之下的目录：组合入口钉住的，或 schema 默认（resolve 会供应）。 */
  const inheritedModels = (): unknown => {
    const pinned = getPath(namespace.base, [...target.settingsPath, 'models'])
    return pinned ?? nodeAtPath(root, [...target.settingsPath, 'models'])?.meta.default
  }

  const modelsOverridden = hasPath(draft, ['models'])
  const models = target.mode === 'custom'
    ? customModels
    : modelDrafts(modelsOverridden ? getPath(draft, ['models']) : inheritedModels())

  const keyPlaceholder = keyLocked
    ? chatCopy.keyEnvLocked
    : keyState?.configured === true
      ? chatCopy.keyStored
      : chatCopy.keyPlaceholder
  const canRemove = target.mode === 'edit'
    && state.rows.find(row => row.entry.provider === target.provider)?.removable === true

  const routeInvalid = route.length > 0 && !ROUTE_PATTERN.test(route)
  const routeTaken = route.length > 0 && state.rows.some(row => row.entry.provider === route)
  const customReady = target.mode === 'custom'
    && route.length > 0 && !routeInvalid && !routeTaken
    && customBaseURL.length > 0 && customProtocol.length > 0
    && customModels.length > 0 && modelFailure === undefined
    && keyFailure === undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2329)' }}>
          {target.mode === 'custom' ? chatCopy.addCustom : target.displayName}
        </span>
        {target.mode !== 'custom' && target.provider !== target.displayName
          ? <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #8f959e)' }}>{target.provider}</span>
          : null}
        {saved ? <span style={{ fontSize: 12, color: 'var(--dsw-alias-state-success-primary, #00b42a)' }}>{chatCopy.saved}</span> : null}
      </div>
      {layout === 'unknown' && target.mode !== 'custom'
        ? <p style={hintStyle}>{`其他字段在 settings.yaml 中（${target.settingsNs}）`}</p>
        : null}

      {target.mode === 'custom'
        ? (
          <>
            <Field label={chatCopy.providerId}>
              <input
                style={inputStyle}
                type="text"
                value={route}
                placeholder="acme-gateway"
                aria-label={chatCopy.providerId}
                disabled={disabled || committed}
                onChange={(event) => { setRoute(event.target.value) }}
              />
            </Field>
            {routeInvalid || routeTaken
              ? <p style={errorStyle}>{t(routeInvalid ? 'providerIdInvalid' : 'providerIdTaken')}</p>
              : <p style={hintStyle}>{chatCopy.providerIdHint}</p>}
            <Field label={chatCopy.displayName}>
              <input
                style={inputStyle}
                type="text"
                value={customName}
                placeholder={route.length === 0 ? chatCopy.displayName : route}
                aria-label={chatCopy.displayName}
                disabled={disabled || committed}
                onChange={(event) => { setCustomName(event.target.value) }}
              />
            </Field>
          </>
        )
        : null}

      <Field label={chatCopy.keyInput}>
        <input
          style={inputStyle}
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder={keyPlaceholder}
          aria-label={chatCopy.keyInput}
          aria-invalid={shownKeyFailure !== undefined}
          disabled={disabled || keyLocked}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
        {shownKeyFailure === undefined
          ? null
          : <p style={errorStyle}>{t(shownKeyFailure === 'keyBlank' && target.mode === 'custom' ? 'keyBlankNew' : shownKeyFailure)}</p>}
      </Field>

      {target.mode === 'custom' || layout !== 'unknown' ? (
        <Field label={chatCopy.baseUrl}>
          <input
            style={inputStyle}
            type="text"
            value={target.mode === 'custom' ? customBaseURL : stringAt(draft, 'baseURL') ?? ''}
            placeholder={target.mode === 'custom'
              ? 'https://gateway.example/v1'
              : layout === 'deepseek'
                ? DEEPSEEK_PUBLIC_BASE_URL
                : stringAt(fallback, 'baseURL') ?? chatCopy.baseUrlDefault}
            aria-label={chatCopy.baseUrl}
            disabled={disabled}
            onChange={(event) => {
              if (target.mode === 'custom') setCustomBaseURL(event.target.value)
              else setField('baseURL', event.target.value === '' ? undefined : event.target.value)
            }}
          />
        </Field>
      ) : null}

      {target.mode === 'custom' || (target.declared === true && layout === 'pi-ai') ? (
        <Field label={chatCopy.apiProtocol}>
          <select
            style={selectInputStyle}
            value={target.mode === 'custom' ? customProtocol : probeApi ?? ''}
            aria-label={chatCopy.apiProtocol}
            disabled={disabled}
            onChange={(event) => {
              if (target.mode === 'custom') setCustomProtocol(event.target.value)
              else setField('api', event.target.value === '' ? undefined : event.target.value)
            }}
          >
            {target.mode === 'custom'
              ? null
              : probeApi === undefined
                ? <option value="">{chatCopy.apiProtocolUnset}</option>
                : null}
            {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        </Field>
      ) : null}

      {target.mode === 'custom' || layout !== 'unknown' ? (
        <div style={{ borderTop: '1px solid var(--dsw-alias-border-l2, #dcdfe6)', paddingTop: 10 }}>
          <ModelListEditor
            models={models}
            overridden={modelsOverridden}
            onChange={target.mode === 'custom' ? setCustomModels : (next) => {
              setDraft(current => setPath(current, ['models'], next))
            }}
            onReset={target.mode === 'custom' ? undefined : () => {
              setDraft(current => deletePath(current, ['models']))
            }}
            probe={probe}
            api={api}
            disabled={disabled}
          />
        </div>
      ) : null}

      {failure !== undefined ? <p style={errorStyle}>{failure}</p> : null}
      {modelFailure !== undefined
        ? <p style={hintStyle}>{`${chatCopy.modelId} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`}</p>
        : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={secondaryButtonStyle}
          disabled={busy}
          onClick={() => { onClose(false) }}
        >
          {chatCopy.cancel}
        </button>
        {canRemove
          ? (
            <button
              type="button"
              style={deleteArmed ? dangerConfirmStyle : dangerButtonStyle}
              disabled={busy}
              onClick={confirmDelete}
            >
              {busy ? chatCopy.deleting : deleteArmed ? chatCopy.confirmDelete : chatCopy.delete}
            </button>
          )
          : null}
        <button
          type="button"
          style={primaryButtonStyle}
          disabled={disabled || (target.mode === 'custom' ? !customReady : modelFailure !== undefined || shownKeyFailure !== undefined)}
          onClick={() => { void submit() }}
        >
          {busy ? (target.mode === 'custom' ? chatCopy.creating : chatCopy.saving) : (target.mode === 'custom' ? chatCopy.create : chatCopy.save)}
        </button>
      </div>
    </div>
  )
}

/** 一个字段（label + 控件 + 字段级错误）。 */
function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </div>
  )
}

/* ---------- 内联样式（主题令牌 + fallback） ---------- */

/* 官方 .input 规格：32px 高、14px 字、8px 圆角、0 10px 内边距。 */
const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
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

/* 官方 .selectInput：隐藏原生箭头，改用共享 chevron（右 12px 内嵌）。 */
const selectInputStyle: CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  paddingRight: 32,
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\'%3E%3Cpath d=\'M3 4.5L6 7.5L9 4.5\' stroke=\'%2381858C\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  backgroundSize: '12px 12px',
  cursor: 'pointer',
  maxWidth: 240,
}

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
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

const primaryButtonStyle: CSSProperties = {
  marginLeft: 'auto',
  height: 36,
  padding: '0 18px',
  fontSize: 14,
  borderRadius: 18,
  border: 'none',
  background: 'var(--dsw-alias-button-primary-fill, #165dff)',
  color: 'var(--dsw-alias-label-primary-foreground, #fff)',
  cursor: 'pointer',
}

const secondaryButtonStyle: CSSProperties = {
  height: 36,
  padding: '0 16px',
  fontSize: 14,
  borderRadius: 18,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  cursor: 'pointer',
}

const dangerButtonStyle: CSSProperties = {
  height: 36,
  padding: '0 16px',
  fontSize: 14,
  borderRadius: 18,
  border: '1px solid var(--dsw-alias-state-error-primary, #d54941)',
  background: 'transparent',
  color: 'var(--dsw-alias-state-error-primary, #d54941)',
  cursor: 'pointer',
}

const dangerConfirmStyle: CSSProperties = {
  ...dangerButtonStyle,
  background: 'var(--dsw-alias-interactive-bg-hover-danger, rgba(213,73,65,0.1))',
}
