/**
 * dsh-memory 主面板 —— 主从布局（master-detail）：
 *  ┌──────────┬────────────────────────────┐
 *  │ 条目列表  │  详情：标题 / meta / 完整 MD │
 *  │ (紧凑行)  │  （查看 · 编辑 · 移动 · 新建）│
 *  └──────────┴────────────────────────────┘
 * 左列只放「标题 + 摘要 + 时间 + 重要度迷你条」，空间留给右侧详情做完整 Markdown
 * 渲染；置顶条目排列表最前（📌 标识），时间分组作为列表内小节标题。
 *
 * 卡片为 PopoverShell solid 模式（不透明实底，玻璃质感豁免）；顶部两层：
 * head（下划线 Tab + 统计）→ toolbar（搜索 / 作用域下拉 / 标签 / 动作），
 * 筛选到具体项目时插入上下文条（项目名 + 别名 / 自动记忆开关 / 清空）。
 *
 * 四个 Tab：
 *  - 全部：主从布局 + 搜索 / 作用域 / 标签筛选 + 添加 / 多选删除 / 一键整理；
 *  - 变更：作用域 + 今天/全部 段控，全宽列表（动作徽标 + 摘要 + 前后对比）；
 *  - 修订：整理前快照，可一键回滚；
 *  - 设置：引擎运行时配置（分组行卡片，见 SettingsTab）。
 *
 * 数据加载分片：list/tags 随筛选条件走；changes / revisions / config / summary
 * 各自独立加载，切 Tab 时按需拉取——避免每次改一个字符就把五个接口全打一遍。
 * 搜索框输入走 260ms 防抖。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconCloseFill14,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconPlusOutline16,
  IconRefreshOutline14,
  IconSearchOutline16,
  IconSparkle16,
  IconTrashOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { MarkstreamMarkdown } from '../markdown/renderer.js'
import type {
  ChangeView,
  MemoryApi,
  MemoryConfigView,
  MemoryEntryView,
  MemoryKind,
  MemoryListResponse,
  MemorySummaryResponse,
  ProjectView,
  RevisionView,
} from './api.js'
import { css, ensureStyles } from './styles.js'
import { SettingsTab } from './SettingsTab.js'
import { makeT, type MemoryLocaleKey, type MemoryT } from './locales.js'
import { modalStaggerClass } from '../modal-animation.js'
import { PshBody, PshHead, PopoverShell, type PopoverAnchor } from '../popover-shell.js'

/** 面板 Tab。 */
export type MemoryTab = 'all' | 'changes' | 'revisions' | 'settings'

/** 时间分组。 */
type GroupKey = 'today' | 'week' | 'earlier' | 'longterm'

/** 面板数据状态。 */
type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: MemoryListResponse }

/** 项目筛选值：all | global | project:<hash>。 */
type ScopeFilter = 'all' | 'global' | `project:${string}`

/** 变更 Tab 的时间范围。 */
type ChangeRange = 'today' | 'all'

/** 编辑中的条目（含归属范围与元数据，保存时一并提交）。 */
interface EditState {
  entryId: string
  content: string
  tags: string
  scope: 'global' | 'project'
  projectHash: string | null
  importance: number
  pinned: boolean
  kind: MemoryKind
}

/** 移动中的条目。 */
interface MoveState {
  entryId: string
  target: 'global' | 'project'
  project: string
}

/** 面板 props。 */
export type MemoryPanelProps = {
  open: boolean
  /** 正在播放收回动画（此时卡片仍挂载，播放滑出）。 */
  closing?: boolean
  onClose: () => void
  initialTab?: MemoryTab
  /** 入口锚点（按钮右缘+顶缘视口坐标）：卡片贴其右侧滑出；null 回退底部 sheet。 */
  anchor?: PopoverAnchor | null
  /** 鼠标进入卡片（hover 模式：取消自动收回）。 */
  onCardMouseEnter?: () => void
  /** 鼠标离开卡片（hover 模式：启动自动收回计时）。 */
  onCardMouseLeave?: () => void
  /** 轻量翻译函数（入口经 makeT 提供）。 */
  t?: MemoryT
} & MemoryApi

/** 全部记忆类型（编辑区下拉）。 */
const KINDS: readonly MemoryKind[] = ['identity', 'preference', 'fact', 'decision', 'gotcha', 'session-summary']

/** 记忆类型 → 文案 key。 */
const KIND_LABEL: Record<MemoryKind, MemoryLocaleKey> = {
  identity: 'kindIdentity',
  preference: 'kindPreference',
  fact: 'kindFact',
  decision: 'kindDecision',
  gotcha: 'kindGotcha',
  'session-summary': 'kindSession',
}

/** 分割标签输入（逗号/空格/中文逗号）。 */
function splitTags(raw: string): string[] {
  return raw.split(/[,，\s]+/).map(tag => tag.trim()).filter(Boolean).slice(0, 8)
}

/** 提取条目标题：`【主题】…` 取主题；否则取首个短首行；都没有回退正文前 40 字。 */
function entryTitle(content: string): string {
  const trimmed = content.trim()
  const bracket = trimmed.match(/^【([^】]{1,30})】/)
  if (bracket !== null) return bracket[1].trim()
  const firstLine = (trimmed.split('\n', 1)[0] ?? '').replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s*/, '').trim()
  if (firstLine !== '' && firstLine.length <= 60) return firstLine
  return trimmed.slice(0, 40)
}

/** 提取列表摘要：去掉标题部分后的纯文本前 ~64 字符。 */
function entrySnippet(content: string): string {
  const trimmed = content.trim()
  const bracket = trimmed.match(/^【([^】]{1,30})】\s*/)
  let rest = trimmed
  if (bracket !== null) rest = trimmed.slice(bracket[0].length).trim()
  else {
    const nl = trimmed.indexOf('\n')
    const firstLine = (trimmed.split('\n', 1)[0] ?? '').trim()
    if (nl !== -1 && firstLine.length <= 60) rest = trimmed.slice(nl + 1).trim()
  }
  const flat = rest.replace(/[#*`>[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim()
  return flat === '' ? trimmed.replace(/\s+/g, ' ').slice(0, 64) : flat.slice(0, 64)
}

/** 相对时间（刚刚 / N 分钟前 / 昨天 / N 天前 / 日期）。 */
function relativeTime(iso: string, now = new Date()): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''
  const diff = now.getTime() - time
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return new Date(time).toLocaleDateString()
}

/** 绝对时间（详情脚注：本地日期 + 时分）。 */
function absoluteTime(iso: string | null): string {
  if (iso === null) return ''
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''
  const date = new Date(time)
  return `${date.toLocaleDateString()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 按 updatedAt 分组（与 host groupEntries 一致）。 */
function groupEntries(entries: MemoryEntryView[]): Record<GroupKey, MemoryEntryView[]> {
  const groups: Record<GroupKey, MemoryEntryView[]> = { today: [], week: [], earlier: [], longterm: [] }
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  for (const entry of entries) {
    if (entry.layer === 'long') {
      groups.longterm.push(entry)
      continue
    }
    const time = Date.parse(entry.updatedAt)
    if (Number.isNaN(time)) {
      groups.earlier.push(entry)
      continue
    }
    const days = Math.floor((startOfDay - time) / 86_400_000)
    if (days <= 0) groups.today.push(entry)
    else if (days < 7) groups.week.push(entry)
    else groups.earlier.push(entry)
  }
  return groups
}

/** 项目显示名（从 projects 列表按 hash 查；未知 hash 用前缀）。 */
function projectName(hash: string | null, projects: ProjectView[]): string {
  if (hash === null) return ''
  const project = projects.find(candidate => candidate.hash === hash)
  if (project === undefined) return hash.slice(0, 6)
  return project.alias ?? project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? hash.slice(0, 6)
}

/** 敏感凭据检测（与 host 过滤规则同源；用于手动添加时的风险提示，不阻断）。 */
const SENSITIVE_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/i,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/i,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[=:]\s*[^\s,，。；;]{8,}/i,
]

function containsSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * 大脑/记忆图标（Lucide `brain`，MIT 开源，24 viewBox + stroke-width 2）。
 * 来源：https://lucide.dev/icons/brain
 */
export function BrainIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  )
}

/** 置顶图标（线性 SVG）。 */
export function PinIcon({ size = 16, filled = false }: { size?: number; filled?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.8 2.2 13.8 6.2l-2.3.7-2.4 2.4-.7 2.3-1.6-1.6-2.7 2.7-1-1 2.7-2.7-1.6-1.6 2.3-.7 2.4-2.4.7-2.3Z" />
    </svg>
  )
}

// ── 详情区 meta 徽章图标族（11px 线性，Lucide 形，stroke 继承 currentColor）──

/** 全局作用域（地球）。 */
function GlobeIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 1.6 2.7 3.7 2.7 6S9.8 12.4 8 14C6.2 12.4 5.3 10.3 5.3 8S6.2 3.6 8 2Z" />
    </svg>
  )
}

/** 项目作用域（文件夹）。 */
function FolderIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.6h4.8A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
    </svg>
  )
}

/** 手动来源（铅笔）。 */
function PenIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m11.5 2.5 2 2L6 12l-2.7.7L4 10l7.5-7.5Z" />
      <path d="m10 4 2 2" />
    </svg>
  )
}

/** 自动来源（闪光）。 */
function SparkIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.2 9.3 6l3.8 1.3-3.8 1.3L8 12.4 6.7 8.6 2.9 7.3 6.7 6 8 2.2Z" />
      <path d="M12.8 11.4l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5Z" />
    </svg>
  )
}

/** 长期沉淀（层叠）。 */
function LayersIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 2.5 5.5 3L8 8.5l-5.5-3 5.5-3Z" />
      <path d="m2.5 8.5 5.5 3 5.5-3" />
      <path d="m2.5 11.5 5.5 3 5.5-3" />
    </svg>
  )
}

/** 已确认（对勾盾）。 */
function VerifiedIcon({ size = 11 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 13 3.4v4.1c0 3-2 5.5-5 6.7-3-1.2-5-3.7-5-6.7V3.4L8 1.8Z" />
      <path d="m5.8 7.8 1.6 1.6 3-3.2" />
    </svg>
  )
}

/** 多选勾（列表勾选框内）。 */
function CheckMark({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  )
}

/** 电源（启用/禁用）。 */
function PowerIcon({ size = 14, dim = false }: { size?: number; dim?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: dim ? 0.45 : undefined }} aria-hidden="true">
      <path d="M8 1.5v6" />
      <path d="M11.3 3.7a4.7 4.7 0 1 1-6.6 0" />
    </svg>
  )
}

/** 重要度数值 → 条形百分比（初始 10、命中加分上不封顶；20 视为满格）。 */
function importancePercent(importance: number): number {
  if (!Number.isFinite(importance) || importance <= 0) return 0
  return Math.min(100, Math.round((importance / 20) * 100))
}

/** 主面板。 */
export function MemoryPanel({ open, closing = false, onClose, initialTab, anchor = null, onCardMouseEnter, onCardMouseLeave, t = makeT(), ...api }: MemoryPanelProps): JSX.Element | null {
  ensureStyles()
  // slots 的 inject 函数每次渲染返回新 api 对象；用 ref 固定引用，
  // 否则 load 的 useCallback 依赖 api 每次变化 → useEffect 无限重触发请求风暴。
  const apiRef = useRef(api)
  apiRef.current = api
  const [tab, setTab] = useState<MemoryTab>(initialTab ?? 'all')
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [q, setQ] = useState('')
  // 防抖后的搜索词：list 请求只跟这个走（边打字边请求会打爆 host）。
  const [debouncedQ, setDebouncedQ] = useState('')
  const [tag, setTag] = useState('')
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [allTags, setAllTags] = useState<Array<{ tag: string; count: number }>>([])
  const [summary, setSummary] = useState<MemorySummaryResponse | null>(null)
  const [changes, setChanges] = useState<ChangeView[]>([])
  const [changeRange, setChangeRange] = useState<ChangeRange>('today')
  const [revisions, setRevisions] = useState<RevisionView[]>([])
  const [editing, setEditing] = useState<EditState | null>(null)
  const [moving, setMoving] = useState<MoveState | null>(null)
  const [busy, setBusy] = useState(false)
  const [consolidating, setConsolidating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // 手动添加记忆表单。
  const [adding, setAdding] = useState(false)
  const [addContent, setAddContent] = useState('')
  const [addTags, setAddTags] = useState('')
  const [addPinned, setAddPinned] = useState(false)
  const [addScope, setAddScope] = useState<'global' | 'project'>('global')
  const [addProject, setAddProject] = useState('')
  // 主从布局：当前选中的条目。
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 多选删除模式。
  const [selecting, setSelecting] = useState(false)
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set())
  // 运行时配置（设置 Tab，按需加载）。
  const [config, setConfigState] = useState<MemoryConfigView | null>(null)
  // 项目别名草稿（选中某项目时可改名）。
  const [aliasDraft, setAliasDraft] = useState<string | null>(null)

  // 当前 tab / 变更范围的最新值（供 mutation 后的刷新决定拉哪些接口）。
  const tabRef = useRef(tab)
  tabRef.current = tab
  const rangeRef = useRef(changeRange)
  rangeRef.current = changeRange

  // 搜索防抖：260ms 内的连续输入合并成一次请求。
  useEffect(() => {
    if (q === debouncedQ) return undefined
    const timer = window.setTimeout(() => { setDebouncedQ(q) }, 260)
    return () => { window.clearTimeout(timer) }
  }, [q, debouncedQ])

  // ── 数据加载（分片：条目 / 概览 / 变更 / 修订 / 配置各自独立）───────

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    const current = apiRef.current
    if (options.silent !== true) setState({ status: 'loading' })
    setError('')
    try {
      const scopeParam = scope === 'all' ? undefined : scope === 'global' ? 'global' : 'project'
      const projectParam = scope.startsWith('project:') ? scope.slice('project:'.length) : undefined
      const [list, tagsRes] = await Promise.all([
        current.list({
          scope: scopeParam,
          project: projectParam,
          q: debouncedQ !== '' ? debouncedQ : undefined,
          tag: tag !== '' ? tag : undefined,
        }),
        current.tags(),
      ])
      setState({ status: 'ready', snapshot: list })
      setAllTags(tagsRes.tags)
    } catch (loadError) {
      setState({ status: 'error' })
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [scope, debouncedQ, tag])

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await apiRef.current.summary())
    } catch {
      // 概览是装饰性信息，失败静默（不遮蔽列表本身的错误）。
    }
  }, [])

  const loadChanges = useCallback(async (range: ChangeRange) => {
    try {
      const response = await apiRef.current.changes(range === 'all' ? 'all' : undefined)
      setChanges(response.changes)
    } catch (changesError) {
      setError(changesError instanceof Error ? changesError.message : String(changesError))
    }
  }, [])

  const loadRevisions = useCallback(async () => {
    try {
      setRevisions((await apiRef.current.revisions()).revisions)
    } catch (revisionsError) {
      setError(revisionsError instanceof Error ? revisionsError.message : String(revisionsError))
    }
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      setConfigState((await apiRef.current.getConfig()).config)
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError))
    }
  }, [])

  /** 运行时配置补丁（设置 Tab；host 会钳制越界值并回传结果）。 */
  const patchConfig = useCallback(async (patchValue: Partial<MemoryConfigView>) => {
    setError('')
    try {
      const response = await apiRef.current.setConfig(patchValue)
      setConfigState(response.config)
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError))
    }
  }, [])

  /** 恢复引擎默认配置。 */
  const resetConfig = useCallback(async () => {
    setError('')
    try {
      const response = await apiRef.current.resetConfig()
      setConfigState(response.config)
      setNotice(t('settingsReset'))
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError))
    }
  }, [t])

  /** 改动后的静默刷新：条目 + 概览 + 当前 Tab 的数据。 */
  const refresh = useCallback(async () => {
    await load({ silent: true })
    await loadSummary()
    if (tabRef.current === 'changes') await loadChanges(rangeRef.current)
    if (tabRef.current === 'revisions') await loadRevisions()
  }, [load, loadSummary, loadChanges, loadRevisions])

  useEffect(() => {
    if (!open) return
    void load()
    void loadSummary()
  }, [open, load, loadSummary])

  // Tab 按需加载：变更 / 修订 / 设置各自只在被打开时拉取。
  useEffect(() => {
    if (!open) return
    if (tab === 'changes') void loadChanges(changeRange)
    else if (tab === 'revisions') void loadRevisions()
    else if (tab === 'settings') void loadConfig()
  }, [open, tab, changeRange, loadChanges, loadRevisions, loadConfig])

  useEffect(() => {
    if (open && initialTab !== undefined) setTab(initialTab)
  }, [open, initialTab])

  // 面板关闭时复位一次性态（多选集合 / 表单 / 提示语），避免重开时残留。
  useEffect(() => {
    if (open) return
    setSelecting(false)
    setCheckedIds(new Set())
    setEditing(null)
    setMoving(null)
    setAdding(false)
    setNotice('')
    setError('')
  }, [open])

  // 切项目时清空别名草稿：草稿是「当前选中项目」的编辑态，跟着筛选一起复位。
  useEffect(() => { setAliasDraft(null) }, [scope])

  // 提示语（保存成功等）2.4s 后自动消失。
  useEffect(() => {
    if (notice === '') return undefined
    const timer = window.setTimeout(() => { setNotice('') }, 2400)
    return () => { window.clearTimeout(timer) }
  }, [notice])

  // ── 裁决 / 条目操作 ──────────────────────────────────────────────────

  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : String(operationError))
    } finally {
      setBusy(false)
      // 无论成功与否都刷新：清除幽灵条目（已被外部删除/并发丢失的条目），
      // 避免"删除报不存在但面板仍显示"。
      await refresh()
    }
  }

  const handlePin = (entry: MemoryEntryView): void => {
    void run(() => apiRef.current.pin(entry.id, !entry.pinned))
  }

  /** 启用/禁用单条记忆（禁用=保留但不参与注入与编译）。 */
  const handleEnable = (entry: MemoryEntryView): void => {
    void run(() => apiRef.current.enable(entry.id, entry.disabled))
  }

  const handleDelete = (entry: MemoryEntryView): void => {
    if (!window.confirm(t('deleteConfirm'))) return
    void run(() => apiRef.current.deleteEntry(entry.id))
  }

  /** 软废弃（retire）：数据保留，退出活跃生命周期。 */
  const handleRetire = (entry: MemoryEntryView): void => {
    if (!window.confirm(t('retireConfirm'))) return
    void run(() => apiRef.current.retire(entry.id))
  }

  /** 恢复已废弃条目（undo retire）。 */
  const handleRestore = (entry: MemoryEntryView): void => {
    if (!window.confirm(t('restoreConfirm'))) return
    void run(() => apiRef.current.restore(entry.id))
  }

  /** 一键整理（Memory Dream）：当前筛选为某项目时只整理该项目，否则全量。 */
  const handleConsolidate = (): void => {
    if (!window.confirm(t('consolidateConfirm'))) return
    setConsolidating(true)
    setError('')
    void (async () => {
      try {
        const target: 'all' | 'global' | 'project' = scope === 'global'
          ? 'global'
          : scope.startsWith('project:') ? 'project' : 'all'
        const hash = scope.startsWith('project:') ? scope.slice('project:'.length) : undefined
        const response = await apiRef.current.consolidate(target, hash)
        const changed = response.results.reduce((sum, result) => sum + result.changed, 0)
        setNotice(changed > 0 ? t('consolidateDone', { n: changed }) : t('consolidateNoop'))
      } catch (consolidateError) {
        setError(consolidateError instanceof Error ? consolidateError.message : String(consolidateError))
      } finally {
        setConsolidating(false)
        await refresh()
        await loadRevisions()
      }
    })()
  }

  // ── 多选删除 ─────────────────────────────────────────────────────────

  const enterSelecting = (): void => {
    closeForms()
    setSelecting(true)
    setCheckedIds(new Set())
  }

  const exitSelecting = (): void => {
    setSelecting(false)
    setCheckedIds(new Set())
  }

  const toggleChecked = (id: string): void => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 提交手动添加记忆。 */
  const saveAdd = (): void => {
    const content = addContent.trim()
    if (content === '') return
    if (addScope === 'project' && addProject === '') {
      setError(t('selectProject'))
      return
    }
    // 敏感内容风险提示：不阻断，确认后允许保存（用户自担风险）。
    if (containsSensitive(content)) {
      if (!window.confirm(t('sensitiveConfirm'))) return
    }
    void run(async () => {
      const created = await apiRef.current.remember({
        content,
        scope: addScope,
        projectHash: addScope === 'project' ? addProject : undefined,
        tags: splitTags(addTags),
        pinned: addPinned,
        importance: 8,
      })
      setAdding(false)
      setAddContent('')
      setAddTags('')
      setAddPinned(false)
      setAddProject('')
      setNotice(t('addSaved'))
      setSelectedId(created.entry.id)
    })
  }

  /** 清空当前选中项目的全部记忆（仅项目层，全局层不动）。 */
  const handleClearProject = (): void => {
    if (!scope.startsWith('project:')) return
    const hash = scope.slice('project:'.length)
    const project = projects.find(candidate => candidate.hash === hash)
    const name = project?.alias ?? project?.path.split(/[\\/]/).filter(Boolean).at(-1) ?? hash
    if (!window.confirm(t('clearProjectConfirm', { name, count: project?.entryCount ?? 0 }))) return
    void run(() => apiRef.current.deleteProject(hash))
  }

  /** 保存项目别名（空串=清除别名，回退目录名）。 */
  const saveAlias = (hash: string, current: string | null): void => {
    if (aliasDraft === null) return
    const next = aliasDraft.trim()
    setAliasDraft(null)
    if (next === (current ?? '')) return
    void run(async () => {
      await apiRef.current.meta(hash, { alias: next })
      setNotice(t('aliasSaved'))
    })
  }

  /** 回滚到某修订版本。 */
  const handleRollback = (revision: RevisionView): void => {
    if (!window.confirm(t('rollbackConfirm', { id: revision.id, time: relativeTime(revision.at) }))) return
    void run(() => apiRef.current.rollback(revision.id))
  }

  const startEdit = (entry: MemoryEntryView): void => {
    setAdding(false)
    setMoving(null)
    setEditing({
      entryId: entry.id,
      content: entry.content,
      tags: entry.tags.join(', '),
      scope: entry.scope,
      projectHash: entry.projectHash,
      importance: entry.importance,
      pinned: entry.pinned,
      kind: entry.kind,
    })
  }

  const saveEdit = (): void => {
    if (editing === null) return
    const content = editing.content.trim()
    if (content === '') {
      setError(t('addContentPlaceholder'))
      return
    }
    void run(async () => {
      const original = state.status === 'ready'
        ? state.snapshot.entries.find(entry => entry.id === editing.entryId)
        : undefined
      const updated = await apiRef.current.update(editing.entryId, {
        content,
        tags: splitTags(editing.tags),
        importance: editing.importance,
        pinned: editing.pinned,
        kind: editing.kind,
      })
      // 归属变更（全局 ⇄ 项目 / 换项目）：update 后条目 id 可能因内容变化而重算，
      // 所以 move 必须用 update 回传的最新 id，而不是编辑开始时的旧 id。
      const moved = original !== undefined
        && (editing.scope !== original.scope
          || (editing.scope === 'project' && editing.projectHash !== original.projectHash))
      let finalId = updated.entry.id
      if (moved) {
        const movedEntry = await apiRef.current.move(finalId, {
          scope: editing.scope,
          projectHash: editing.scope === 'project' && editing.projectHash !== null ? editing.projectHash : undefined,
        })
        finalId = movedEntry.entry.id
      }
      setEditing(null)
      setSelectedId(finalId)
    })
  }

  const startMove = (entry: MemoryEntryView): void => {
    setAdding(false)
    setEditing(null)
    setMoving({
      entryId: entry.id,
      target: entry.scope === 'global' ? 'project' : 'global',
      project: entry.projectHash ?? '',
    })
  }

  const saveMove = (): void => {
    if (moving === null) return
    void run(async () => {
      if (moving.target === 'project' && moving.project.trim() === '') {
        throw new Error(t('selectProject'))
      }
      const moved = await apiRef.current.move(moving.entryId, {
        scope: moving.target,
        projectHash: moving.target === 'project' ? moving.project.trim() : undefined,
      })
      setMoving(null)
      setSelectedId(moved.entry.id)
    })
  }

  // ── 渲染数据 ─────────────────────────────────────────────────────────

  const snapshot = state.status === 'ready' ? state.snapshot : null
  const projects: ProjectView[] = snapshot?.projects ?? []
  const filtered = useMemo(() => snapshot?.entries ?? [], [snapshot])

  const pinned = useMemo(() => filtered.filter(entry => entry.pinned), [filtered])
  const grouped = useMemo(() => groupEntries(filtered.filter(entry => !entry.pinned)), [filtered])
  // 变更按当前 全部/全局/项目 筛选（chips 选择即时生效）。
  const visibleChanges = useMemo(() => changes.filter(change => {
    if (scope === 'global') return change.scope === 'global'
    if (scope.startsWith('project:')) {
      return change.scope === 'project' && change.projectHash === scope.slice('project:'.length)
    }
    return true
  }), [changes, scope])

  const groupTitles: Record<GroupKey, string> = {
    today: t('groupToday'),
    week: t('groupWeek'),
    earlier: t('groupEarlier'),
    longterm: t('groupLongterm'),
  }

  // 选中条目：过滤结果变化时若失联则自动落到第一条。
  const detail = useMemo(
    () => filtered.find(entry => entry.id === selectedId) ?? null,
    [filtered, selectedId],
  )
  useEffect(() => {
    if (detail === null && filtered.length > 0) setSelectedId(filtered[0]?.id ?? null)
  }, [detail, filtered])
  const closeForms = (): void => { setEditing(null); setMoving(null); setAdding(false) }
  const selectEntry = (entry: MemoryEntryView): void => { closeForms(); setSelectedId(entry.id) }

  // 多选派生与批量删除（依赖 filtered，须在其后定义）。
  const allChecked = filtered.length > 0 && filtered.every(entry => checkedIds.has(entry.id))
  const toggleAllChecked = (): void => {
    setCheckedIds(allChecked ? new Set() : new Set(filtered.map(entry => entry.id)))
  }
  const deleteChecked = (): void => {
    const ids = [...checkedIds]
    if (ids.length === 0) return
    if (!window.confirm(t('deleteSelectedConfirm', { n: ids.length }))) return
    // 批量路由：一次事务删完再编译一次产物（此前是 N 次 /delete，
    // 每次都重编译一遍全部 md 产物）。
    void run(async () => {
      await apiRef.current.deleteBatch(ids)
      exitSelecting()
    })
  }

  /** 左列一行条目。 */
  const renderItemRow = (entry: MemoryEntryView): JSX.Element => {
    const selected = !selecting && entry.id === selectedId
    const checked = checkedIds.has(entry.id)
    const enabled = entry.disabled !== true
    const retired = entry.deprecated === true
    return (
      <li key={entry.id} className={css.itemRow}>
        <button
          type="button"
          className={[
            css.item,
            (selecting ? checked : selected) ? css.itemSelected : '',
            enabled ? '' : css.itemDisabled,
            retired ? css.itemRetired : '',
          ].filter(Boolean).join(' ')}
          data-selected={(selecting ? checked : selected) || undefined}
          aria-pressed={selecting ? checked : undefined}
          onClick={() => { if (selecting) toggleChecked(entry.id); else selectEntry(entry) }}
        >
          {selecting && (
            <span className={css.itemCheck} aria-hidden="true">
              {checked && <CheckMark />}
            </span>
          )}
          <span className={css.itemBody}>
            <span className={css.itemTitle}>
              {entry.pinned && <span className={css.pinMark}><PinIcon size={11} filled /></span>}
              <span className={css.itemTitleText}>{entryTitle(entry.content)}</span>
              <span
                className={css.scopeBadge}
                title={entry.scope === 'global' ? t('scopeGlobal') : projectName(entry.projectHash, projects)}
              >
                {entry.scope === 'global' ? <GlobeIcon size={10} /> : <FolderIcon size={10} />}
                {entry.scope === 'global' ? t('scopeGlobal') : projectName(entry.projectHash, projects)}
              </span>
              {!enabled && <span className={css.disabledMark}>{t('disabledTag')}</span>}
              {retired && <span className={css.retiredMark}>{t('retiredTag')}</span>}
            </span>
            <span className={css.itemSnippet}>{entrySnippet(entry.content)}</span>
            <span className={css.itemFoot}>
              <span className={css.itemTime}>{relativeTime(entry.updatedAt)}</span>
              <span
                className={css.itemScore}
                style={{ ['--pct' as string]: `${importancePercent(entry.importance)}%` }}
                title={`${t('importanceTitle')} ${Number(entry.importance).toFixed(1)}`}
              />
            </span>
          </span>
        </button>
        {/* 行内启用开关：span role=switch（li>button 内禁嵌套 button），点击不触发行选中 */}
        {!selecting && (
          <span
            role="switch"
            aria-checked={enabled}
            aria-label={enabled ? t('enabledAria') : t('disabledAria')}
            title={enabled ? t('disable') : t('enable')}
            tabIndex={0}
            className={`${css.miniSwitch} ${enabled ? css.miniSwitchOn : ''}`}
            onClick={(event) => { event.stopPropagation(); handleEnable(entry) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                handleEnable(entry)
              }
            }}
          />
        )}
      </li>
    )
  }

  /** 详情区头部操作钮组。 */
  const detailActions = (entry: MemoryEntryView): JSX.Element => {
    const enabled = entry.disabled !== true
    const retired = entry.deprecated === true
    return (
      <div className={css.cardActions}>
        <Tooltip label={entry.pinned ? t('unpin') : t('pin')} side="bottom" delayMs={500}>
          <button type="button" className={css.iconAction} aria-label={entry.pinned ? t('unpin') : t('pin')} disabled={busy} onClick={() => { handlePin(entry) }}>
            <PinIcon size={14} filled={entry.pinned} />
          </button>
        </Tooltip>
        <Tooltip label={enabled ? t('disable') : t('enable')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconAction}
            aria-label={enabled ? t('disable') : t('enable')}
            disabled={busy}
            onClick={() => { handleEnable(entry) }}
          >
            <PowerIcon size={14} dim={!enabled} />
          </button>
        </Tooltip>
        <Tooltip label={t('edit')} side="bottom" delayMs={500}>
          <button type="button" className={css.iconAction} aria-label={t('edit')} disabled={busy} onClick={() => { startEdit(entry) }}>
            <IconEditOutline16 size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t('move')} side="bottom" delayMs={500}>
          <button type="button" className={css.iconAction} aria-label={t('move')} disabled={busy} onClick={() => { startMove(entry) }}>
            <IconFolderOpenOutline16 size={14} />
          </button>
        </Tooltip>
        {/* schema v3：soft retire（保留数据）/ restore（复活已废弃）——与彻底删除并排。 */}
        {retired ? (
          <Tooltip label={t('restore')} side="bottom" delayMs={500}>
            <button type="button" className={css.iconAction} aria-label={t('restore')} disabled={busy} onClick={() => { handleRestore(entry) }}>
              <IconRefreshOutline14 size={14} />
            </button>
          </Tooltip>
        ) : (
          <Tooltip label={t('retire')} side="bottom" delayMs={500}>
            <button type="button" className={css.iconAction} aria-label={t('retire')} disabled={busy} onClick={() => { handleRetire(entry) }}>
              <PowerIcon size={14} dim />
            </button>
          </Tooltip>
        )}
        <Tooltip label={t('delete')} side="bottom" delayMs={500}>
          <button type="button" className={`${css.iconAction} ${css.iconActionDanger}`} aria-label={t('delete')} disabled={busy} onClick={() => { handleDelete(entry) }}>
            <IconTrashOutline16 size={14} />
          </button>
        </Tooltip>
      </div>
    )
  }

  /** 归属范围选择（编辑/新建共用）。 */
  const scopeFields = (
    name: string,
    scopeValue: 'global' | 'project',
    onScope: (scope: 'global' | 'project') => void,
    projectValue: string,
    onProject: (hash: string) => void,
  ): JSX.Element => (
    <>
      <label className={css.check}>
        <input type="radio" name={name} checked={scopeValue === 'global'} onChange={() => { onScope('global') }} />
        {t('moveToGlobal')}
      </label>
      <label className={css.check}>
        <input type="radio" name={name} checked={scopeValue === 'project'} onChange={() => {
          onScope('project')
          if (projectValue === '') {
            const first = projects.find(project => project.entryCount > 0) ?? projects[0]
            if (first !== undefined) onProject(first.hash)
          }
        }} />
        {t('moveToProject')}
      </label>
      {scopeValue === 'project' && (
        <select className={css.tagSelect} value={projectValue} aria-label={t('projectPlaceholder')} onChange={(event) => { onProject(event.currentTarget.value) }}>
          {projects.length === 0 && <option value="">{t('noProjects')}</option>}
          {projects.map(project => (
            <option key={project.hash} value={project.hash}>
              {project.alias ?? project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? project.hash}
            </option>
          ))}
        </select>
      )}
    </>
  )

  /** 空态占位（图标 + 主文案 + 可选提示 + 可选动作按钮）。 */
  const renderEmpty = (
    text: string,
    hint?: string,
    action?: { label: string; onClick: () => void },
  ): JSX.Element => (
    <div className={css.empty}>
      <span className={css.emptyIcon}><BrainIcon size={26} /></span>
      <span className={css.emptyText}>{text}</span>
      {hint !== undefined && <span className={css.emptyHint}>{hint}</span>}
      {action !== undefined && (
        <Button variant="outline" size="sm" onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  )

  /** 骨架屏（首次加载）。 */
  const renderSkeleton = (): JSX.Element => (
    <div className={css.skeleton} aria-busy="true">
      <div className={css.skeletonRow} />
      <div className={css.skeletonRow} />
      <div className={css.skeletonRow} />
      <div className={css.skeletonRow} />
    </div>
  )

  if (!open) return null

  const selectedProject = scope.startsWith('project:')
    ? projects.find(candidate => candidate.hash === scope.slice('project:'.length))
    : undefined

  /* 作用域下拉（全部 / 全局 / 各项目）：「全部」工具栏与「变更」工具行共用，
     受控同一个 scope 状态——两处切换保持同步。 */
  const scopeSelectEl = (
    <select
      className={`${css.tagSelect} ${css.scopeSelect}`}
      value={scope}
      aria-label={t('scopeFilterLabel')}
      onChange={(event) => { setScope(event.currentTarget.value as ScopeFilter) }}
    >
      <option value="all">{t('scopeAllOption', { n: summary?.entryCount ?? 0 })}</option>
      <option value="global">{t('scopeGlobalOption', { n: summary?.globalCount ?? 0 })}</option>
      {projects.map(project => (
        <option key={project.hash} value={`project:${project.hash}`}>
          {project.alias ?? project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? project.hash} ({project.entryCount})
        </option>
      ))}
    </select>
  )

  return (
    <PopoverShell
      closing={closing}
      onClose={onClose}
      anchor={anchor}
      onCardMouseEnter={onCardMouseEnter}
      onCardMouseLeave={onCardMouseLeave}
      width={1200}
      ariaLabel={t('panelTitle')}
      solid
    >
      <PshHead title={t('panelTitle')} closeLabel={t('close')} onClose={onClose} />
      <PshBody className={css.modalBody}>
      <div className={`${css.panel} ${modalStaggerClass}`} aria-busy={state.status === 'loading'}>
        {/* 头部：Tab 组 + 统计条 */}
        <div className={css.head}>
          <div className={css.tabs} role="tablist">
            {(['all', 'changes', 'revisions', 'settings'] as const).map(key => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? `${css.tab} ${css.tabActive}` : css.tab}
                onClick={() => { setTab(key); closeForms(); exitSelecting() }}
              >
                {key === 'all' ? t('tabAll')
                  : key === 'changes' ? t('tabChanges')
                    : key === 'revisions' ? t('tabRevisions') : t('tabSettings')}
                {key === 'changes' && summary !== null && summary.todayChanges > 0 && (
                  <span className={css.tabCount}>{summary.todayChanges}</span>
                )}
              </button>
            ))}
          </div>
          {summary !== null && (
            <div className={css.statBar}>
              <span className={`${css.stat} ${css.statLong}`}>
                <span className={css.statValue}>{summary.entryCount}</span>
                {t('statEntries')}
              </span>
              <span className={`${css.statDot} ${css.statLong}`} aria-hidden="true" />
              <span className={`${css.stat} ${css.statLong}`}>
                <span className={css.statValue}>{summary.projectCount}</span>
                {t('statProjects')}
              </span>
              <span className={`${css.statDot} ${css.statLong}`} aria-hidden="true" />
              {summary.pinnedCount !== undefined && (
                <span className={css.stat} title={t('tabPinned')}>
                  <PinIcon size={11} filled />
                  <span className={css.statValue}>{summary.pinnedCount}</span>
                </span>
              )}
              {summary.longtermCount !== undefined && (
                <span className={css.stat} title={t('groupLongterm')}>
                  <LayersIcon size={11} />
                  <span className={css.statValue}>{summary.longtermCount}</span>
                </span>
              )}
              {summary.disabledCount !== undefined && summary.disabledCount > 0 && (
                <span className={css.stat} title={t('disabledTag')}>
                  <PowerIcon size={11} dim />
                  <span className={css.statValue}>{summary.disabledCount}</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* 项目上下文条：只在筛选到具体项目时出现（项目名 + 别名 / 自动记忆 / 清空）。
            作用域切换本身已收进工具栏的下拉，这里不再铺一排项目胶囊。 */}
        {tab !== 'settings' && selectedProject !== undefined && (
          <div className={css.topRow}>
            <span className={css.projectName} title={selectedProject.path}>
              <FolderIcon size={12} />
              {selectedProject.alias ?? selectedProject.path.split(/[\\/]/).filter(Boolean).at(-1) ?? selectedProject.hash}
            </span>
            <div className={css.projectTools}>
              <input
                className={css.inlineInput}
                style={{ width: 160 }}
                value={aliasDraft ?? selectedProject.alias ?? ''}
                placeholder={t('aliasPlaceholder')}
                aria-label={t('projectAlias')}
                title={t('projectAlias')}
                disabled={busy}
                onChange={event => { setAliasDraft(event.currentTarget.value) }}
                onBlur={() => { saveAlias(selectedProject.hash, selectedProject.alias) }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    saveAlias(selectedProject.hash, selectedProject.alias)
                  }
                  if (event.key === 'Escape') setAliasDraft(null)
                }}
              />
              <span className={css.switchLine}>
                <button
                  type="button"
                  className={css.switch}
                  role="switch"
                  aria-checked={selectedProject.autoMemory}
                  aria-label={t('autoMemory')}
                  disabled={busy}
                  onClick={() => { void run(() => apiRef.current.meta(selectedProject.hash, { autoMemory: !selectedProject.autoMemory })) }}
                />
                <span className={css.switchText}>{t('autoMemory')}</span>
              </span>
              <Tooltip label={t('clearProject')} side="top" delayMs={500}>
                <button type="button" className={`${css.iconAction} ${css.iconActionDanger}`} aria-label={t('clearProject')} disabled={busy} onClick={handleClearProject}>
                  <IconTrashOutline16 size={14} />
                </button>
              </Tooltip>
            </div>
          </div>
        )}

        {/* 搜索 + 标签筛选 + 整理/新建/多选（全部 Tab） */}
        {tab === 'all' && (selecting ? (
          <div className={css.searchRow}>
            <span className={css.batchCount}>{t('selectedCount', { n: checkedIds.size })}</span>
            <span className={css.barSep} aria-hidden="true" />
            <Button variant="outline" size="sm" onClick={toggleAllChecked}>{allChecked ? t('collapse') : t('selectAll')}</Button>
            <span className={css.spacer} />
            <Button variant="outline" size="sm" disabled={busy} onClick={exitSelecting}>{t('cancel')}</Button>
            <Button variant="primary" size="sm" disabled={busy || checkedIds.size === 0} onClick={deleteChecked}>
              {t('delete')} ({checkedIds.size})
            </Button>
          </div>
        ) : (
          <div className={css.searchRow}>
            <span className={css.searchBox}>
              <span className={css.searchIcon}><IconSearchOutline16 size={14} /></span>
              <input
                className={css.searchInput}
                value={q}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                onChange={(event) => { setQ(event.currentTarget.value) }}
                onKeyDown={event => { if (event.key === 'Escape' && q !== '') { event.preventDefault(); setQ('') } }}
              />
              {q !== '' && (
                <button type="button" className={css.searchClear} aria-label={t('cancel')} onClick={() => { setQ('') }}>
                  <IconCloseFill14 size={12} />
                </button>
              )}
            </span>
            {scopeSelectEl}
            <select
              className={css.tagSelect}
              value={tag}
              aria-label={t('tagFilterPlaceholder')}
              onChange={(event) => { setTag(event.currentTarget.value) }}
            >
              <option value="">{t('tagFilterPlaceholder')}</option>
              {allTags.map(item => (
                <option key={item.tag} value={item.tag}>{item.tag} ({item.count})</option>
              ))}
            </select>
            <span className={css.spacer} />
            <span className={css.barSep} aria-hidden="true" />
            <Tooltip label={t('retry')} side="top" delayMs={500}>
              <button type="button" className={css.iconAction} aria-label={t('retry')} disabled={busy} onClick={() => { void refresh() }}>
                <IconRefreshOutline14 />
              </button>
            </Tooltip>
            <Tooltip label={consolidating ? t('consolidating') : t('consolidateHint')} side="top" delayMs={500}>
              <button
                type="button"
                className={consolidating ? `${css.iconAction} ${css.iconActionBusy}` : css.iconAction}
                aria-label={t('consolidate')}
                disabled={busy || consolidating}
                onClick={handleConsolidate}
              >
                <IconSparkle16 size={14} />
              </button>
            </Tooltip>
            <Button
              variant="primary"
              size="sm"
              icon={<IconPlusOutline16 size={14} />}
              aria-expanded={adding}
              onClick={() => {
                setAdding(value => !value)
                setEditing(null)
                setMoving(null)
                if (scope.startsWith('project:')) {
                  setAddScope('project')
                  setAddProject(scope.slice('project:'.length))
                }
              }}
            >
              {t('add')}
            </Button>
            <Button variant="outline" size="sm" disabled={filtered.length === 0} onClick={enterSelecting}>
              {t('multiSelect')}
            </Button>
          </div>
        ))}

        {/* 变更 Tab：作用域 + 时间范围段控（今天 / 全部）+ 刷新 */}
        {tab === 'changes' && (
          <div className={css.searchRow}>
            {scopeSelectEl}
            <span className={css.barSep} aria-hidden="true" />
            <div className={css.segment} role="group" aria-label={t('tabChanges')}>
              {(['today', 'all'] as const).map(range => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={changeRange === range}
                  className={changeRange === range ? `${css.segmentItem} ${css.segmentItemActive}` : css.segmentItem}
                  onClick={() => { setChangeRange(range) }}
                >
                  {range === 'today' ? t('changesToday') : t('changesAll')}
                </button>
              ))}
            </div>
            <span className={css.stat}>
              <span className={css.statValue}>{visibleChanges.length}</span>
              {t('statChanges')}
            </span>
            <span className={css.spacer} />
            <Tooltip label={t('retry')} side="top" delayMs={500}>
              <button type="button" className={css.iconAction} aria-label={t('retry')} disabled={busy} onClick={() => { void loadChanges(changeRange) }}>
                <IconRefreshOutline14 />
              </button>
            </Tooltip>
          </div>
        )}

        {notice !== '' && <p className={css.notice}>{notice}</p>}
        {error !== '' && <p className={css.error} role="alert">{error}</p>}

        {tab === 'all' && state.status === 'loading' && renderSkeleton()}
        {tab === 'all' && state.status === 'error' && (
          <div className={css.empty}>
            <span className={css.emptyIcon}><BrainIcon size={26} /></span>
            <span className={css.emptyText}>{t('error')}</span>
            <Button variant="outline" size="sm" onClick={() => { void load() }}>{t('retry')}</Button>
          </div>
        )}

        {/* 全部：主从布局（左列表 / 右详情） */}
        {state.status === 'ready' && tab === 'all' && (
          <div className={css.split}>
            {/* 左列：紧凑条目列表（置顶在前 + 时间分组小节） */}
            {filtered.length === 0 ? (
              // 空态用 div 承载（ul 里塞非 li 元素不合法）；类名沿用左列几何。
              <div className={css.listPane}>
                {renderEmpty(
                  q !== '' || tag !== '' ? t('searchEmpty') : t('empty'),
                  q !== '' || tag !== '' ? t('searchEmptyHint') : undefined,
                  q !== '' || tag !== ''
                    ? { label: t('clearFilters'), onClick: () => { setQ(''); setTag('') } }
                    : undefined,
                )}
              </div>
            ) : (
              <ul className={css.listPane}>
                {pinned.length > 0 && (
                  <li className={css.listSection}>
                    {t('tabPinned')}
                    <span className={css.listSectionCount}>{pinned.length}</span>
                  </li>
                )}
                {pinned.map(renderItemRow)}
                {(Object.keys(grouped) as GroupKey[]).map(groupKey => (
                  grouped[groupKey].length > 0 ? (
                    [
                      <li key={`${groupKey}-section`} className={css.listSection}>
                        {groupTitles[groupKey]}
                        <span className={css.listSectionCount}>{grouped[groupKey].length}</span>
                      </li>,
                      ...grouped[groupKey].map(renderItemRow),
                    ]
                  ) : null
                ))}
              </ul>
            )}
            {/* 右侧：详情（查看 / 编辑 / 移动 / 新建） */}
            <div className={css.detailPane}>
              {adding ? (
                <div className={css.detailForm}>
                  <span className={css.formTitle}>{t('addTitle')}</span>
                  <label className={css.field}>
                    <span className={css.fieldLabel}>{t('addContentPlaceholder')}</span>
                    <textarea
                      className={css.inlineTextarea}
                      style={{ minHeight: 200 }}
                      value={addContent}
                      placeholder={t('addContentPlaceholder')}
                      aria-label={t('addContentPlaceholder')}
                      autoFocus
                      onChange={(event) => { setAddContent(event.currentTarget.value) }}
                    />
                  </label>
                  <label className={css.field}>
                    <span className={css.fieldLabel}>{t('addTagsPlaceholder')}</span>
                    <input
                      className={css.inlineInput}
                      value={addTags}
                      placeholder={t('addTagsPlaceholder')}
                      aria-label={t('addTagsPlaceholder')}
                      onChange={(event) => { setAddTags(event.currentTarget.value) }}
                    />
                  </label>
                  <div className={css.addMeta}>
                    <label className={css.check}>
                      <input type="checkbox" checked={addPinned} onChange={(event) => { setAddPinned(event.currentTarget.checked) }} />
                      {t('addPinned')}
                    </label>
                    {scopeFields('dsh-memory-add-scope', addScope, setAddScope, addProject, setAddProject)}
                  </div>
                  <div className={css.editButtons}>
                    <Button variant="outline" disabled={busy} onClick={() => { setAdding(false) }}>{t('cancel')}</Button>
                    <Button variant="primary" disabled={busy || addContent.trim() === ''} onClick={saveAdd}>{t('save')}</Button>
                  </div>
                </div>
              ) : editing !== null ? (
                <div className={css.detailForm}>
                  <span className={css.formTitle}>{t('editTitle')}</span>
                  <label className={css.field}>
                    <span className={css.fieldLabel}>{t('addContentPlaceholder')}</span>
                    <textarea
                      className={css.inlineTextarea}
                      style={{ minHeight: 200 }}
                      value={editing.content}
                      aria-label={t('edit')}
                      onChange={(event) => { setEditing({ ...editing, content: event.currentTarget.value }) }}
                    />
                  </label>
                  <label className={css.field}>
                    <span className={css.fieldLabel}>{t('tagEditPlaceholder')}</span>
                    <input
                      className={css.inlineInput}
                      value={editing.tags}
                      placeholder={t('tagEditPlaceholder')}
                      aria-label={t('tagEditPlaceholder')}
                      onChange={(event) => { setEditing({ ...editing, tags: event.currentTarget.value }) }}
                    />
                  </label>
                  <div className={css.fieldRow}>
                    <label className={css.field}>
                      <span className={css.fieldLabel}>{t('importanceField')}</span>
                      <input
                        type="number"
                        className={css.numberInput}
                        min={1}
                        max={20}
                        step={0.5}
                        value={editing.importance}
                        aria-label={t('importanceField')}
                        onChange={(event) => {
                          const next = Number(event.currentTarget.value)
                          if (Number.isFinite(next)) setEditing({ ...editing, importance: Math.max(1, Math.min(20, next)) })
                        }}
                      />
                    </label>
                    <label className={css.field}>
                      <span className={css.fieldLabel}>{t('kindLabel')}</span>
                      <select
                        className={css.tagSelect}
                        value={editing.kind}
                        aria-label={t('kindLabel')}
                        onChange={(event) => { setEditing({ ...editing, kind: event.currentTarget.value as MemoryKind }) }}
                      >
                        {KINDS.map(kind => (
                          <option key={kind} value={kind}>{t(KIND_LABEL[kind])}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className={css.addMeta}>
                    <label className={css.check}>
                      <input type="checkbox" checked={editing.pinned} onChange={(event) => { setEditing({ ...editing, pinned: event.currentTarget.checked }) }} />
                      {t('pin')}
                    </label>
                    {scopeFields(`dsh-memory-edit-scope-${editing.entryId}`, editing.scope, (next) => {
                      setEditing({ ...editing, scope: next, projectHash: next === 'global' ? null : editing.projectHash })
                    }, editing.projectHash ?? '', (hash) => { setEditing({ ...editing, scope: 'project', projectHash: hash }) })}
                  </div>
                  <div className={css.editButtons}>
                    <Button variant="outline" disabled={busy} onClick={() => { setEditing(null) }}>{t('cancel')}</Button>
                    <Button variant="primary" disabled={busy || editing.content.trim() === ''} onClick={saveEdit}>{t('save')}</Button>
                  </div>
                </div>
              ) : moving !== null ? (
                <div className={css.detailForm}>
                  <span className={css.formTitle}>{t('moveTitle')}</span>
                  <div className={css.addMeta}>
                    {scopeFields(`dsh-memory-move-scope-${moving.entryId}`, moving.target, (next) => {
                      setMoving({ ...moving, target: next })
                    }, moving.project, (hash) => { setMoving({ ...moving, target: 'project', project: hash }) })}
                  </div>
                  <div className={css.editButtons}>
                    <Button variant="outline" disabled={busy} onClick={() => { setMoving(null) }}>{t('cancel')}</Button>
                    <Button
                      variant="primary"
                      disabled={busy || (moving.target === 'project' && moving.project.trim() === '')}
                      onClick={saveMove}
                    >
                      {t('save')}
                    </Button>
                  </div>
                </div>
              ) : detail !== null ? (
                <>
                  <div className={css.detailHead}>
                    <h3 className={css.detailTitle}>{entryTitle(detail.content)}</h3>
                    {detailActions(detail)}
                  </div>
                  <div className={css.detailMeta}>
                    <span className={css.metaBadge} title={detail.scope === 'global' ? t('scopeGlobal') : projectName(detail.projectHash, projects)}>
                      {detail.scope === 'global' ? <GlobeIcon /> : <FolderIcon />}
                      {detail.scope === 'global' ? t('scopeGlobal') : projectName(detail.projectHash, projects)}
                    </span>
                    <span className={detail.source === 'manual' ? `${css.metaBadge} ${css.metaBadgeAccent}` : css.metaBadge}>
                      {detail.source === 'manual' ? <PenIcon /> : <SparkIcon />}
                      {detail.source === 'manual' ? t('sourceManual') : t('sourceExtract')}
                    </span>
                    <span className={css.metaBadge} title={t('kindLabel')}>{t(KIND_LABEL[detail.kind])}</span>
                    {detail.layer === 'long' && (
                      <span className={`${css.metaBadge} ${css.metaBadgeWarn}`}>
                        <LayersIcon />
                        {t('groupLongterm')}
                      </span>
                    )}
                    {detail.pinned && (
                      <span className={`${css.metaBadge} ${css.metaBadgeWarn}`} title={t('pin')}>
                        <PinIcon size={11} filled />
                        {t('tabPinned')}
                      </span>
                    )}
                    {detail.deprecated === true && (
                      <span className={`${css.metaBadge} ${css.metaBadgeWarn}`} title={t('retire')}>
                        {t('retiredTag')}
                      </span>
                    )}
                    {detail.verified
                      ? <span className={css.metaBadge} title={t('verified')}><VerifiedIcon />{t('verified')}</span>
                      : <span className={`${css.metaBadge} ${css.metaBadgeMuted}`} title={t('unverified')}>{t('unverified')}</span>}
                    {detail.disabled && <span className={css.disabledMark}>{t('disabledTag')}</span>}
                    <span className={css.metaTime} title={absoluteTime(detail.updatedAt)}>{relativeTime(detail.updatedAt)}</span>
                  </div>
                  <div className={css.importanceRow}>
                    <span className={css.importanceLabel}>{t('importanceTitle')}</span>
                    <span className={css.importanceBar} role="img" aria-label={t('importanceTitle')}>
                      <i style={{ width: `${importancePercent(detail.importance)}%` }} />
                    </span>
                    <span className={css.importanceValue}>{Number(detail.importance).toFixed(1)}</span>
                    <span className={css.importanceLabel}>{t('confidenceTitle')}</span>
                    <span className={css.importanceValue}>{Math.round(detail.confidence * 100)}%</span>
                  </div>
                  <div className={css.detailBody}>
                    <MarkstreamMarkdown text={detail.content} streaming={false} />
                  </div>
                  {detail.tags.length > 0 && (
                    <div className={css.detailTags}>
                      {detail.tags.map(tagName => (
                        <button
                          key={tagName}
                          type="button"
                          className={tag === tagName ? `${css.chip} ${css.chipActive}` : css.chip}
                          onClick={() => { setTag(tag === tagName ? '' : tagName) }}
                        >
                          {tagName}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={css.detailFoot}>
                    <span>{t('versionTitle', { n: detail.version })}</span>
                    <span className={css.statDot} aria-hidden="true" />
                    <span>{t('createdAtLabel', { time: absoluteTime(detail.createdAt) })}</span>
                    <span className={css.statDot} aria-hidden="true" />
                    <span>{detail.lastHitAt === null ? t('neverHit') : t('lastHitLabel', { time: relativeTime(detail.lastHitAt) })}</span>
                  </div>
                </>
              ) : (
                renderEmpty(
                  filtered.length === 0 ? t('empty') : t('detailPlaceholder'),
                  filtered.length === 0 ? t('consolidateHint') : undefined,
                )
              )}
            </div>
          </div>
        )}

        {/* 变更（按当前 全部/全局/项目 筛选；全宽列表） */}
        {tab === 'changes' && (
          visibleChanges.length === 0
            ? renderEmpty(t('changesEmpty'))
            : <ul className={css.cardList}>{visibleChanges.map(renderChange)}</ul>
        )}

        {/* 修订版本（整理前快照，可一键回滚） */}
        {tab === 'revisions' && (
          revisions.length === 0
            ? renderEmpty(t('revisionsEmpty'))
            : <ul className={css.cardList}>{revisions.map(renderRevision)}</ul>
        )}

        {/* 设置（运行时配置，改动即时生效） */}
        {tab === 'settings' && (
          <SettingsTab
            config={config}
            busy={busy}
            t={t}
            onPatch={patchValue => { void patchConfig(patchValue) }}
            onReset={() => {
              if (!window.confirm(t('settingsResetConfirm'))) return
              void resetConfig()
            }}
          />
        )}
      </div>
      </PshBody>
    </PopoverShell>
  )

  /** 渲染一条修订版本（快照信息 + 回滚按钮）。 */
  function renderRevision(revision: RevisionView): JSX.Element {
    return (
      <li key={revision.id} className={css.changeRow}>
        <span className={css.changeBadge}>{revision.trigger === 'manual' ? t('revManual') : t('revDaily')}</span>
        <div className={css.changeMain}>
          <div className={css.cardMeta}>
            <span>{revision.scope === 'global' ? t('scopeGlobal') : revision.scope}</span>
            <span className={css.statDot} aria-hidden="true" />
            <span>{t('revEntries', { n: revision.entryCount })}</span>
            <span className={css.statDot} aria-hidden="true" />
            <span title={absoluteTime(revision.at)}>{relativeTime(revision.at)}</span>
          </div>
        </div>
        <div className={css.revActions}>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { handleRollback(revision) }}>
            {t('rollback')}
          </Button>
        </div>
      </li>
    )
  }

  /** 渲染一条变更（含前后内容对比，无删除按钮）。 */
  function renderChange(change: ChangeView): JSX.Element {
    const hasDiff = change.before !== undefined && change.after !== undefined && change.before !== change.after
    const badgeClass = change.action === 'delete'
      ? `${css.changeBadge} ${css.changeBadgeDelete}`
      : change.action === 'add'
        ? `${css.changeBadge} ${css.changeBadgeAdd}`
        : change.action === 'promote'
          ? `${css.changeBadge} ${css.changeBadgePromote}`
          : change.action === 'revise'
            ? `${css.changeBadge} ${css.changeBadgeRevise}`
            : change.action === 'retire'
              ? `${css.changeBadge} ${css.changeBadgeRetire}`
              : css.changeBadge
    return (
      <li key={change.id} className={css.changeRow}>
        <span className={badgeClass}>{changeActionLabel(change.action, t)}</span>
        <div className={css.changeMain}>
          <div className={css.cardMeta}>
            <span>{change.scope === 'global' ? t('scopeGlobal') : projectName(change.projectHash, projects)}</span>
            <span className={css.statDot} aria-hidden="true" />
            <span title={absoluteTime(change.at)}>{relativeTime(change.at)}</span>
          </div>
          {change.action === 'delete' ? (
            <div className={css.cardContent}>{change.summary}</div>
          ) : hasDiff ? (
            /* 左右并排对比：旧 | 新 */
            <div className={css.changeDiff}>
              <div className={css.changeDiffCol}>
                <div className={css.cardMeta}><span>{t('diffOld')}</span></div>
                <div className={`${css.cardContent} ${css.changeOld}`}>{change.before}</div>
              </div>
              <div className={css.changeDiffDivider} />
              <div className={css.changeDiffCol}>
                <div className={css.cardMeta}><span>{t('diffNew')}</span></div>
                <div className={`${css.cardContent} ${css.changeNew}`}>{change.after}</div>
              </div>
            </div>
          ) : (
            <div className={css.cardContent}>{change.after ?? change.summary}</div>
          )}
        </div>
      </li>
    )
  }
}

/** 变更动作徽标文案（双语，走面板 t）。 */
export function changeActionLabel(action: ChangeView['action'], t: MemoryT): string {
  switch (action) {
    case 'add': return t('changeAdd')
    case 'update': return t('changeUpdate')
    case 'promote': return t('changePromote')
    case 'delete': return t('changeDelete')
    case 'revise': return t('changeRevise')
    case 'retire': return t('changeRetire')
  }
}
