/**
 * 「对话供应商」快照 store：将可配置提供方目录（`llm.providers`）、设置
 * 命名空间（`settings.describe`）与引用的凭据（`credentials.describe`）
 * join 成一份快照。Host 始终是唯一事实源——每次变更都走 wire 写入，页面
 * 从下一次 describe（推送失效或手动重拉）重渲染。
 *
 * 移植自官方 ui-settings-models 的 store.ts，删除了 onboarding 相关逻辑
 * （onboardingReadiness / WELCOME_NOTICE / OnboardingReadiness 等引导流程，
 * 不属于供应商模块）。
 */

import type {
  ConfigurableProviderView, CredentialView, IApiClient, SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { getPath, hasPath, nodeAtPath, rehydrateSchema } from '@deepseek-ai/dsh-client-schema-form'

/**
 * 任意路由键沿 dict schema 走到同一个 profile 节点，因此这个探测键选一个
 * 不可能与已配置路由冲突的名字。
 */
const PROBE_ROUTE = '\u0000probe'

/** 页面渲染的一行提供方。 */
export interface ProviderRow {
  /** 目录条目（路由 id、显示名、设置地址、live 状态）。 */
  entry: ConfigurableProviderView
  /** 任一层是否配置了该提供方（其 profile 能解析）。 */
  configured: boolean
  /** 是否仅用户层持有该 profile（删除可还原 base 层）。 */
  removable: boolean
  /** 解析出的 profile 所引用的凭据名（若有）。 */
  apiKeyEnv: string | undefined
  /** {@link apiKeyEnv} 的凭据状态（describe 之后）。 */
  credential: CredentialView | undefined
}

/** 页面快照。 */
export interface ModelsSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 整页加载失败文本；行级写入失败留在编辑器内。 */
  error: string | null
  /** 凭据补全失败；提供方/设置行仍可用。 */
  credentialError: string | null
  /** 设置提供方是否接受写入。 */
  writable: boolean
  /** 每个可配置提供方与其配置/凭据状态的 join。 */
  rows: readonly ProviderRow[]
  /** 按 ns 的命名空间视图，供编辑器的 schema/层/secret 使用。 */
  namespaces: ReadonlyMap<string, SettingsNamespaceView>
}

/**
 * 被拒绝的 wire 调用的人类可读文本。传输失败以 Error reject；Host 或
 * runtime 可能 reject 任意值，页面仍要给出说法。
 * @param error - rejection 值。
 * @returns 要展示的消息。
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 为提供方路由派生惯例凭据引用：v1 页面从不询问环境变量名，因此键入的
 * 密钥存到该派生引用下，profile 以 `apiKeyEnv` 记录之。
 * @param provider - 提供方路由 id（如 `anthropic`、`minimax-cn`）。
 * @returns 派生的引用名（如 `MINIMAX_CN_API_KEY`）。
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * 手工声明的路由可命名的 wire 协议，读自所属命名空间自身的 schema。这里
 * 是 schema 读取而非 wire 字段，因此页面提供的选项不会与适配器接受的
 * 选项漂移：两者同源于同一份 `Config`。
 * @param namespace - 声明了 profile 形状的命名空间视图。
 * @returns 协议标识，schema 中没有则为空列表。
 */
export function protocolChoices(namespace: SettingsNamespaceView | undefined): string[] {
  if (namespace === undefined) return []
  const node = nodeAtPath(rehydrateSchema(namespace.schema), ['providers', PROBE_ROUTE, 'api'])
  const list = (node as { type?: string; list?: readonly { value?: unknown }[] } | undefined)
  if (list?.type !== 'union' || list.list === undefined) return []
  return list.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}

/** 解析出的 profile 所引用的凭据名（其 `apiKeyEnv` 字段）。 */
function apiKeyEnvOf(namespace: SettingsNamespaceView | undefined, path: readonly string[]): string | undefined {
  if (namespace === undefined) return undefined
  const profile = getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** 「对话供应商」页面控制器（每个 settings 面板一个）。 */
export class ModelsSettingsStore {
  /** 区块渲染所用的快照（uSES-safe store）。 */
  readonly store: SnapshotStore<ModelsSettingsState> = createSnapshotStore<ModelsSettingsState>({
    status: 'idle', error: null, credentialError: null, writable: false, rows: [], namespaces: new Map(),
  })

  /** 最新一次 load 生效；旧响应永不覆盖新响应。 */
  private generation = 0

  /**
   * @param api - wire 面（settings/credentials/llm 域）。
   */
  constructor(private readonly api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>) {}

  /**
   * 刷新整页快照：目录与命名空间并行，随后对每个引用做一次批量凭据
   * describe。失败时保留上一份可用 rows 并浮出错误。
   * @returns 无；结果由快照承载。
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    let providers: ConfigurableProviderView[]
    let writable: boolean
    let views: SettingsNamespaceView[]
    try {
      const [providersResponse, settingsResponse] = await Promise.all([
        this.api.llm.providers({}),
        this.api.settings.describe({}),
      ])
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
      if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
      providers = providersResponse.result.value.providers
      writable = settingsResponse.result.value.writable
      views = settingsResponse.result.value.namespaces
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
      return
    }
    const namespaces = new Map(views.map(view => [view.ns, view]))
    const rows: ProviderRow[] = providers.map((entry) => {
      const namespace = namespaces.get(entry.settingsNs)
      const configured = namespace !== undefined
        && (entry.settingsPath.length === 0 || getPath(namespace.value, entry.settingsPath) !== undefined)
      const removable = namespace !== undefined
        && entry.settingsPath.length > 0
        && hasPath(namespace.user, entry.settingsPath)
        && !hasPath(namespace.base, entry.settingsPath)
      return {
        entry,
        configured,
        removable,
        apiKeyEnv: apiKeyEnvOf(namespace, entry.settingsPath),
        credential: undefined,
      }
    })
    const refs = [...new Set(rows.flatMap(row => row.apiKeyEnv === undefined ? [] : [row.apiKeyEnv]))]
    let credentials: Record<string, CredentialView> = {}
    let credentialError: string | null = null
    if (refs.length > 0) {
      try {
        const response = await this.api.credentials.describe({ refs })
        // 凭据状态对本页是补全信息：业务拒绝或传输失败都不使 load 失败，
        // 只记录 credentialError 供 UI 决定是否提示。
        if (response.result.ok) credentials = response.result.value.credentials
        else credentialError = response.result.error.message
      } catch (error) {
        credentialError = messageOf(error)
      }
    }
    if (generation !== this.generation) return
    this.store.update((s) => {
      s.status = 'ready'
      s.error = null
      s.credentialError = credentialError
      s.writable = writable
      s.rows = rows.map(row => ({
        ...row,
        ...row.apiKeyEnv !== undefined && credentials[row.apiKeyEnv] !== undefined
          ? { credential: credentials[row.apiKeyEnv] }
          : {},
      }))
      s.namespaces = namespaces
    })
  }
}

/**
 * 一行 join 结果能否按现状服务模型请求：路由已注册到适配器注册表，且其
 * 解析出的 profile 引用的凭据已存储。profile 未引用任何凭据的，走提供方
 * 自身的认证路径（Bedrock 链、Vertex ADC、无需任何东西的网关），与无设置
 * 地址的 live 路由一样，都不欠本页一把 key。
 * @param row - 一行 join 后的提供方。
 * @returns 用户是否已经有这个提供方可对话。
 */
export function providerUsable(row: ProviderRow): boolean {
  if (!row.entry.active) return false
  if (row.apiKeyEnv === undefined) return true
  return row.credential?.configured === true
}
