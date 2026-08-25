/**
 * skill-source — 技能 slash 源(替代内核 ui-skill 的平铺技能列表)。
 *
 * 与技能模块联动:输入 `/` 后先展示技能集合(bundle),选中集合后进入,
 * 再展示该集合下的技能。两级导航利用 slash 管线的 `continue: true` 协议:
 * 选中集合时落地 `/bundleId:` 文本并保持菜单打开,管线在光标处重新跟踪,
 * 第二级的 query 形如 `bundleId:` → candidates 返回该集合下的技能。
 *
 * 数据源为 dsh-webui host 半身已挂载的 /api/skill-manager(与技能管理面板
 * 同一份数据:集合 + 散装技能),零 DSH 源码改动。
 *
 * 除 slash 源外,本模块同时补注册 `tool.call.toolview` key='skill' 的
 * SkillRow(内核 ui-skill 插件在 web profile 中被禁用后,技能调用的工具行
 * 由本插件接管,组件与文案照搬内核实现,样式改注入模式)。
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 inputTriggers 服务声明与 InputTriggerSource 契约。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  InputTriggerSource, InputTriggerServiceContract, ClientSessionContext, CandidateRequest,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: 激活 ui-tool 的 SlotMap 合并(tool.call.toolview 的 key 注册契约)。
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { SkillRow } from './SkillRow.tsx'
import { en, NS, zh, type SkillKey } from './locales.ts'
import { injectSkillRowStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dedicated skill tool row's copy. */
    skill: SkillKey
  }
}

/** 技能管理面板数据模型(与 /api/skill-manager 响应一致)。 */
interface SkillView {
  name: string
  description: string
}

interface BundleView {
  id: string
  name: string
  skillCount: number
  skills: SkillView[]
}

interface SkillSnapshot {
  bundles: BundleView[]
  loose: SkillView[]
}

/** 快照 + 开关状态(/api/skill-toggles/status 的 skills 表;缺省视为启用)。 */
interface ResolvedSnapshot extends SkillSnapshot {
  enabled: Record<string, boolean>
}

/** /api/skill-toggles/presets 响应里本模块关心的两块。 */
interface PresetWire {
  overrides?: Record<string, Record<string, boolean>>
}

/** 集合内技能入口的候选 value 前缀(bundle 与 skill 候选区分)。 */
const BUNDLE_MARK = 'bundle:'
const SKILL_MARK = 'skill:'
/** 散装技能虚拟集合 id。 */
const LOOSE_ID = '_loose'
/** 快照 TTL:技能面板改动后,slash 菜单最多滞后此间隔(秒)。 */
const SNAPSHOT_TTL_MS = 30 * 1000

/** 一个会话的目录抓取:共享 promise + settle 快照 + 拉取时刻 + 自身 abort。 */
interface CatalogFetch {
  promise: Promise<ResolvedSnapshot>
  settled?: ResolvedSnapshot
  fetchedAt: number
  abort: AbortController
}

/** 会话级目录缓存。 */
const fetches = new Map<SessionId, CatalogFetch>()
/** 会话级 lexicon 失效监听器。 */
const lexiconListeners = new Map<SessionId, Set<() => void>>()

/** apply() 时捕获的 client root ctx(读 sessions 快照拿会话预设 id)。 */
let rootCtx: ClientContext | undefined

/** 预设名单/覆盖缓存(全客户端共享;TTL 与快照一致)。 */
let presetsCache: { at: number; promise: Promise<PresetWire | null> } | undefined

function fetchPresets(): Promise<PresetWire | null> {
  if (presetsCache !== undefined && Date.now() - presetsCache.at < SNAPSHOT_TTL_MS) {
    return presetsCache.promise
  }
  const promise = fetch('/api/skill-toggles/presets', {
    headers: { accept: 'application/json' },
  })
    .then((response) => response.ok ? response.json() as Promise<PresetWire> : null)
    .catch(() => null)
  presetsCache = { at: Date.now(), promise }
  return promise
}

/** 当前会话运行的 Agent 预设 id(client sessions 列表快照;读不到返回 undefined)。 */
function sessionPresetOf(sessionId: SessionId): string | undefined {
  try {
    const sessions = (rootCtx as unknown as { get?: (name: string) => unknown } | undefined)?.get?.('sessions') as
      | { list?: { getSnapshot?: () => { byId?: Record<string, { agentPreset?: string }> } } }
      | undefined
    const byId = sessions?.list?.getSnapshot?.()?.byId
    const preset = byId?.[sessionId]?.agentPreset
    return typeof preset === 'string' && preset !== '' ? preset : undefined
  } catch {
    return undefined
  }
}

function notifyListeners(sessionId: SessionId): void {
  for (const listener of [...(lexiconListeners.get(sessionId) ?? [])]) {
    try { listener() } catch (error) { console.error('[skill-source] lexicon listener failed:', error) }
  }
}

/** 拉取技能快照 + 开关状态(会话级单飞;TTL 过期后重取;失败不毒化缓存键)。 */
function fetchSnapshot(sessionId: SessionId): Promise<ResolvedSnapshot> {
  const existing = fetches.get(sessionId)
  if (existing !== undefined && Date.now() - existing.fetchedAt < SNAPSHOT_TTL_MS) {
    return existing.promise
  }
  // 共享 fetch 自带 abort,不接收调用方 signal:关闭菜单/切换 keystroke 的
  // abort 只淘汰调用方,不杀死其它消费者仍在用的预取(内核 ui-skill 同款)。
  const abort = new AbortController()
  const entry: CatalogFetch = { promise: undefined as never, fetchedAt: Date.now(), abort }
  const promise = (async () => {
    const [listResponse, toggleResponse, presetWire] = await Promise.all([
      fetch('/api/skill-manager/list', {
        headers: { accept: 'application/json' },
        signal: abort.signal,
      }),
      fetch('/api/skill-toggles/status', {
        headers: { accept: 'application/json' },
        signal: abort.signal,
      }).catch(() => null),
      fetchPresets(),
    ])
    const body = await listResponse.json() as SkillSnapshot & { error?: string }
    if (!listResponse.ok) throw new Error(body.error ?? `skill list failed (${String(listResponse.status)})`)
    let enabled: Record<string, boolean> = {}
    if (toggleResponse !== null && toggleResponse.ok) {
      const toggles = await toggleResponse.json() as { skills?: Record<string, boolean>; error?: string }
      if (toggles.skills !== undefined) enabled = toggles.skills
    }
    // 会话预设覆盖:该会话所属 Agent 预设里显式 false 的技能,在 slash 菜单
    // 里同样隐藏(与 host 闸门语义一致——预设层只能收窄全局层)。
    const presetId = sessionPresetOf(sessionId)
    const overrides = presetId === undefined ? undefined : presetWire?.overrides?.[presetId]
    if (overrides !== undefined) {
      const merged: Record<string, boolean> = { ...enabled }
      for (const [name, state] of Object.entries(overrides)) {
        if (state === false) merged[name] = false
      }
      enabled = merged
    }
    return { ...body, enabled }
  })()
  entry.promise = promise
  fetches.set(sessionId, entry)
  promise.then(
    (snapshot) => {
      entry.settled = snapshot
      notifyListeners(sessionId)
    },
    () => { if (fetches.get(sessionId) === entry) fetches.delete(sessionId) },
  )
  return promise
}

/** 失效一个会话的缓存(技能面板改动后调用;sessionId 缺省时全清)。 */
export function invalidateSkillCache(sessionId?: SessionId): void {
  // 预设覆盖与全局开关一起失效:面板改动可能改了任意预设的账本。
  presetsCache = undefined
  if (sessionId === undefined) {
    for (const key of [...fetches.keys()]) {
      const entry = fetches.get(key)
      if (entry === undefined) continue
      fetches.delete(key)
      entry.abort.abort()
      notifyListeners(key)
    }
    return
  }
  const entry = fetches.get(sessionId)
  if (entry === undefined) return
  fetches.delete(sessionId)
  entry.abort.abort()
  notifyListeners(sessionId)
}

/** 技能是否启用(缺省视为启用)。 */
function skillEnabled(snapshot: ResolvedSnapshot, name: string): boolean {
  return snapshot.enabled[name] !== false
}

/** 全部启用技能名(集合内 + 散装),供输入框 `/name` 的 chip 装饰。 */
function allSkillNames(snapshot: ResolvedSnapshot): string[] {
  const names: string[] = []
  for (const bundle of snapshot.bundles) {
    for (const skill of bundle.skills) {
      if (skillEnabled(snapshot, skill.name)) names.push(skill.name)
    }
  }
  for (const skill of snapshot.loose) {
    if (skillEnabled(snapshot, skill.name)) names.push(skill.name)
  }
  return names
}

/** 集合 id → 集合内启用技能(loose 为散装)。 */
function skillsOf(snapshot: ResolvedSnapshot, bundleId: string): SkillView[] {
  const source = bundleId === LOOSE_ID ? snapshot.loose : snapshot.bundles.find(bundle => bundle.id === bundleId)?.skills ?? []
  return source.filter(skill => skillEnabled(snapshot, skill.name))
}

/** 解析第二级 query(`bundleId:` 或 `bundleId:过滤词`)→ 集合 id + 过滤词。 */
function parseLevelQuery(query: string): { bundleId: string; rest: string } | null {
  const match = /^([a-z0-9_-]+):(.*)$/.exec(query)
  if (match === null) return null
  return { bundleId: match[1]!, rest: match[2]! }
}

/** 技能候选(第二级)。 */
function skillCandidate(skill: SkillView): { name: string; description?: string; value: string } {
  return { name: skill.name, description: skill.description, value: `${SKILL_MARK}${skill.name}` }
}

/** 集合候选(第一级);仅当集合内仍有启用技能时才出现。 */
function bundleCandidate(snapshot: ResolvedSnapshot, bundle: BundleView): { name: string; description: string; value: string } | null {
  const enabledCount = skillsOf(snapshot, bundle.id).length
  if (enabledCount === 0) return null
  return {
    name: bundle.name,
    description: `${String(enabledCount)} 个技能`,
    value: `${BUNDLE_MARK}${bundle.id}`,
  }
}

/**
 * 注册技能 slash 源与 SkillRow 工具行。
 * @param ctx - client root context。
 */
export function apply(ctx: ClientContext): void {
  rootCtx = ctx
  ctx.effect(() => {
    return () => { if (rootCtx === ctx) rootCtx = undefined }
  }, 'skill-source: root ctx capture')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skill-source: dictionaries')
  injectSkillRowStyles()
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'skill', locale: NS },
    SkillRow,
  ))

  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  if (inputTriggers === undefined) {
    console.warn('[skill-source] inputTriggers 服务不可用,技能 slash 源未注册')
    return
  }

  const source: InputTriggerSource = {
    trigger: '/',
    name: 'skill',
    order: 2,
    async candidates(session: ClientSessionContext, req: CandidateRequest) {
      let snapshot: ResolvedSnapshot
      try {
        snapshot = await fetchSnapshot(session.sessionId)
      } catch {
        return []
      }
      if (req.signal.aborted) return []
      const level = parseLevelQuery(req.query)
      if (level !== null && skillsOf(snapshot, level.bundleId).length > 0) {
        // 第二级:已进入某集合,展示该集合下启用技能(可按冒号后文本过滤)。
        return skillsOf(snapshot, level.bundleId)
          .filter(skill => skill.name.startsWith(level.rest))
          .map(skillCandidate)
      }
      // 第一级:集合列表(可按 query 过滤集合名;空集合自动隐藏)。
      const bundles = snapshot.bundles
        .filter(bundle => bundle.name.startsWith(req.query) || bundle.id.startsWith(req.query))
        .map(bundle => bundleCandidate(snapshot, bundle))
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      const looseEnabled = skillsOf(snapshot, LOOSE_ID)
      if (looseEnabled.length > 0) {
        bundles.push({
          name: '散装技能',
          description: `${String(looseEnabled.length)} 个技能`,
          value: `${BUNDLE_MARK}${LOOSE_ID}`,
        })
      }
      return bundles
    },
    warm(session: ClientSessionContext) {
      fetchSnapshot(session.sessionId).catch(() => {})
    },
    lexicon(session: ClientSessionContext) {
      const entry = fetches.get(session.sessionId)
      return entry?.settled === undefined ? undefined : allSkillNames(entry.settled)
    },
    subscribeLexicon(session: ClientSessionContext, listener: () => void) {
      const key = session.sessionId
      const listeners = lexiconListeners.get(key) ?? new Set()
      listeners.add(listener)
      lexiconListeners.set(key, listeners)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) lexiconListeners.delete(key)
      }
    },
    onPick({ candidate }) {
      const value = candidate.value ?? ''
      if (value.startsWith(BUNDLE_MARK)) {
        // 选中集合 → 落地 `/id:` 并保持菜单打开,进入第二级。
        const bundleId = value.slice(BUNDLE_MARK.length)
        return { text: `/${bundleId}:`, continue: true }
      }
      // 选中技能 → 落地 `/name `(与内核 ui-skill 一致的 plain-text 引用路径)。
      return { text: `/${candidate.name} ` }
    },
  }

  ctx.effect(() => {
    // 若 web profile 尚未禁用内核 ui-skill(同名 /skill 源),注册会抛错;
    // 捕获后仅降级(不注册 slash 源),SkillRow 工具行等其余功能不受影响。
    let unregister: (() => void) | undefined
    try {
      unregister = inputTriggers.registerSource(source)
    } catch (error) {
      console.warn('[skill-source] /skill 源注册失败(可能内核 ui-skill 仍激活):', error)
    }
    return () => {
      if (unregister !== undefined) unregister()
      for (const key of [...fetches.keys()]) {
        fetches.get(key)?.abort.abort()
        fetches.delete(key)
      }
      lexiconListeners.clear()
    }
  }, 'skill-source: slash source')
}
