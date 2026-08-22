/**
 * dsh-memory 主面板 —— 主从布局（master-detail）：
 *  ┌──────────┬────────────────────────────┐
 *  │ 条目列表  │  详情：标题 / meta / 完整 MD │
 *  │ (紧凑行)  │  （查看 · 编辑 · 移动 · 新建）│
 *  └──────────┴────────────────────────────┘
 * 左列只放「标题 + 摘要 + 时间」，空间留给右侧详情做完整 Markdown 渲染；
 * 置顶条目排列表最前（📌 标识），时间分组作为列表内小节标题。
 * Tab（全部 / 变更）：变更 tab 为全宽列表（badge + 摘要 + 前后对比）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconRefreshOutline14,
  IconTrashOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { MarkstreamMarkdown } from '../markdown/renderer.js'
import type { ChangeView, MemoryApi, MemoryEntryView, MemoryListResponse, ProjectView } from './api.js'
import { css, ensureStyles } from './styles.js'
import { changeActionLabel } from './Notify.tsx'
import { makeT, type MemoryT } from './locales.js'
import { modalStaggerClass } from '../modal-animation.js'
import { PshBody, PshHead, PopoverShell, type PopoverAnchor } from '../popover-shell.js'

/** 面板 Tab。 */
export type MemoryTab = 'all' | 'changes'

/** 时间分组。 */
type GroupKey = 'today' | 'week' | 'earlier' | 'longterm'

/** 面板数据状态。 */
type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: MemoryListResponse }

/** 项目筛选值：all | global | project:<hash>。 */
type ScopeFilter = 'all' | 'global' | `project:${string}`

/** 编辑中的条目（含归属范围，保存时可同时修改项目/全局）。 */
interface EditState {
  entryId: string
  content: string
  tags: string
  scope: 'global' | 'project'
  projectHash: string | null
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

/** 相对时间（今天 HH:mm / 昨天 / N 天前）。 */
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
 * 大脑/记忆图标（Lucide `brain`，MIT 开源，24 viewBox + stroke-width 2，
 * 标准矢量设计——小尺寸下依然清晰，替代自绘细描边版）。
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
  const [tag, setTag] = useState('')
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [allTags, setAllTags] = useState<Array<{ tag: string; count: number }>>([])
  const [changes, setChanges] = useState<ChangeView[]>([])
  const [editing, setEditing] = useState<EditState | null>(null)
  const [moving, setMoving] = useState<MoveState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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

  const load = useCallback(async () => {
    const current = apiRef.current
    setState({ status: 'loading' })
    setError('')
    try {
      const scopeParam = scope === 'all' ? undefined : scope === 'global' ? 'global' : 'project'
      const projectParam = scope.startsWith('project:') ? scope.slice('project:'.length) : undefined
      const [list, tagsRes, changesRes] = await Promise.all([
        current.list({ scope: scopeParam, project: projectParam, q: q !== '' ? q : undefined, tag: tag !== '' ? tag : undefined }),
        current.tags(),
        current.changes(),
      ])
      setState({ status: 'ready', snapshot: list })
      setAllTags(tagsRes.tags)
      setChanges(changesRes.changes)
    } catch (loadError) {
      setState({ status: 'error' })
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [scope, q, tag])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (open && initialTab !== undefined) setTab(initialTab)
  }, [open, initialTab])

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
      // 无论操作成功与否都刷新列表：清除幽灵条目（已被外部删除/并发丢失的条目），
      // 避免"删除报不存在但面板仍显示"。
      await load()
    }
  }

  const handlePin = (entry: MemoryEntryView): void => {
    void run(() => api.pin(entry.id, !entry.pinned))
  }

  const handleDelete = (entry: MemoryEntryView): void => {
    if (!window.confirm(t('deleteConfirm'))) return
    void run(() => api.deleteEntry(entry.id))
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
      await api.remember({
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
    })
  }

  /** 清空当前选中项目的全部记忆（仅项目层，全局层不动）。 */
  const handleClearProject = (): void => {
    if (!scope.startsWith('project:')) return
    const hash = scope.slice('project:'.length)
    const project = projects.find(candidate => candidate.hash === hash)
    const name = project?.alias ?? project?.path.split(/[\\/]/).filter(Boolean).at(-1) ?? hash
    if (!window.confirm(t('clearProjectConfirm', { name, count: project?.entryCount ?? 0 }))) return
    void run(() => api.deleteProject(hash))
  }

  const startEdit = (entry: MemoryEntryView): void => {
    setEditing({
      entryId: entry.id,
      content: entry.content,
      tags: entry.tags.join(', '),
      scope: entry.scope,
      projectHash: entry.projectHash,
    })
  }

  const saveEdit = (): void => {
    if (editing === null) return
    void run(async () => {
      await api.update(editing.entryId, {
        content: editing.content.trim() !== '' ? editing.content : undefined,
        tags: splitTags(editing.tags),
      })
      // 归属变更（全局 ⇄ 项目 / 换项目）。
      const original = state.status === 'ready'
        ? state.snapshot.entries.find(entry => entry.id === editing.entryId)
        : undefined
      const moved = original !== undefined
        && (editing.scope !== original.scope
          || (editing.scope === 'project' && editing.projectHash !== original.projectHash))
      if (moved) {
        await api.move(editing.entryId, {
          scope: editing.scope,
          projectHash: editing.scope === 'project' && editing.projectHash !== null ? editing.projectHash : undefined,
        })
      }
      setEditing(null)
    })
  }

  const startMove = (entry: MemoryEntryView): void => {
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
        throw new Error(t('projectPlaceholder'))
      }
      await api.move(moving.entryId, {
        scope: moving.target,
        projectHash: moving.target === 'project' ? moving.project.trim() : undefined,
        path: moving.target === 'project' ? moving.project.trim() : undefined,
      })
      setMoving(null)
    })
  }

  // ── 渲染数据 ─────────────────────────────────────────────────────────

  const snapshot = state.status === 'ready' ? state.snapshot : null
  const projects: ProjectView[] = snapshot?.projects ?? []
  const filtered = useMemo(() => {
    if (snapshot === null) return []
    return snapshot.entries
  }, [snapshot])

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
    void run(async () => {
      await Promise.all(ids.map(id => api.deleteEntry(id)))
      exitSelecting()
    })
  }

  /** 左列一行条目。 */
  const renderItemRow = (entry: MemoryEntryView): JSX.Element => {
    const selected = !selecting && entry.id === selectedId
    const checked = checkedIds.has(entry.id)
    return (
      <li key={entry.id}>
        <button
          type="button"
          className={selecting
            ? (checked ? `${css.item} ${css.itemSelected}` : css.item)
            : (selected ? `${css.item} ${css.itemSelected}` : css.item)}
          data-selected={(selecting ? checked : selected) || undefined}
          onClick={() => { if (selecting) toggleChecked(entry.id); else selectEntry(entry) }}
        >
          {selecting && (
            <span className={css.itemCheck} aria-hidden="true">
              {checked && (
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8.5 6.5 12 13 4.5" />
                </svg>
              )}
            </span>
          )}
          <span className={css.itemBody}>
            <span className={css.itemTitle}>
              {entry.pinned && <span className={css.pinMark}><PinIcon size={11} filled /></span>}
              <span className={css.itemTitleText}>{entryTitle(entry.content)}</span>
            </span>
            <span className={css.itemSnippet}>{entrySnippet(entry.content)}</span>
            <span className={css.itemTime}>{relativeTime(entry.updatedAt)}</span>
          </span>
        </button>
      </li>
    )
  }

  /** 详情区头部操作钮组。 */
  const detailActions = (entry: MemoryEntryView): JSX.Element => (
    <div className={css.cardActions}>
      <Tooltip label={entry.pinned ? t('unpin') : t('pin')} side="bottom" delayMs={500}>
        <button type="button" className={css.iconAction} aria-label={entry.pinned ? t('unpin') : t('pin')} disabled={busy} onClick={() => { handlePin(entry) }}>
          <PinIcon size={14} filled={entry.pinned} />
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
      <Tooltip label={t('delete')} side="bottom" delayMs={500}>
        <button type="button" className={`${css.iconAction} ${css.iconActionDanger}`} aria-label={t('delete')} disabled={busy} onClick={() => { handleDelete(entry) }}>
          <IconTrashOutline16 size={14} />
        </button>
      </Tooltip>
    </div>
  )

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

  const renderEmpty = (text: string): JSX.Element => <div className={css.empty}>{text}</div>

  if (!open) return null

  return (
    <PopoverShell
      closing={closing}
      onClose={onClose}
      anchor={anchor}
      onCardMouseEnter={onCardMouseEnter}
      onCardMouseLeave={onCardMouseLeave}
      width={980}
      ariaLabel={t('panelTitle')}
    >
      <PshHead title={t('panelTitle')} closeLabel={t('close')} onClose={onClose} />
      <PshBody className={css.modalBody ?? ''}>
      <div className={`${css.panel} ${modalStaggerClass}`} aria-busy={state.status === 'loading'}>
        {/* Tab：全部 / 变更 */}
        <div className={css.tabs} role="tablist">
          {(['all', 'changes'] as const).map(key => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? `${css.tab} ${css.tabActive}` : css.tab}
              onClick={() => { setTab(key); closeForms() }}
            >
              {key === 'all' ? t('tabAll') : `${t('tabChanges')}${changes.length > 0 ? ` (${changes.length})` : ''}`}
            </button>
          ))}
        </div>

        {/* 项目切换 + 自动记忆开关 + 清空项目 */}
        <div className={css.topRow}>
          <div className={css.projectChips} role="group" aria-label={t('scopeGlobal')}>
            <button
              type="button"
              className={scope === 'all' ? `${css.projectChip} ${css.projectChipActive}` : css.projectChip}
              onClick={() => { setScope('all') }}
            >
              {t('tabAll')}
            </button>
            <button
              type="button"
              className={scope === 'global' ? `${css.projectChip} ${css.projectChipActive}` : css.projectChip}
              onClick={() => { setScope('global') }}
            >
              {t('scopeGlobal')}
            </button>
            {projects.map(project => (
              <button
                key={project.hash}
                type="button"
                title={project.path}
                className={scope === `project:${project.hash}` ? `${css.projectChip} ${css.projectChipActive}` : css.projectChip}
                onClick={() => { setScope(scope === `project:${project.hash}` ? 'all' : `project:${project.hash}`) }}
              >
                {project.alias ?? project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? project.hash}
              </button>
            ))}
          </div>
          {/* 选中具体项目时：自动记忆开关 + 清空该项目全部记忆 */}
          {scope.startsWith('project:') && (() => {
            const hash = scope.slice('project:'.length)
            const project = projects.find(candidate => candidate.hash === hash)
            const autoOn = project?.autoMemory ?? true
            return (
              <>
                <span className={css.switchLine}>
                  <button
                    type="button"
                    className={css.switch}
                    role="switch"
                    aria-checked={autoOn}
                    aria-label={t('autoMemory')}
                    disabled={busy}
                    onClick={() => { void run(() => api.meta(hash, { autoMemory: !autoOn })) }}
                  />
                  <span className={css.switchText}>{t('autoMemory')}</span>
                </span>
                <Tooltip label={t('clearProject')} side="top" delayMs={500}>
                  <button type="button" className={`${css.iconAction} ${css.iconActionDanger}`} aria-label={t('clearProject')} disabled={busy} onClick={handleClearProject}>
                    <IconTrashOutline16 size={14} />
                  </button>
                </Tooltip>
              </>
            )
          })()}
        </div>

        {/* 搜索 + 标签筛选 + 新建/多选（全部 Tab） */}
        {tab === 'all' && (selecting ? (
          <div className={css.searchRow}>
            <span className={css.batchCount}>{t('selectedCount', { n: checkedIds.size })}</span>
            <button type="button" className={css.chip} onClick={toggleAllChecked}>{allChecked ? t('collapse') : t('selectAll')}</button>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Button variant="outline" size="sm" disabled={busy} onClick={exitSelecting}>{t('cancel')}</Button>
              <Button variant="primary" size="sm" disabled={busy || checkedIds.size === 0} onClick={deleteChecked}>
                {t('delete')} ({checkedIds.size})
              </Button>
            </div>
          </div>
        ) : (
          <div className={css.searchRow}>
            <input
              className={css.searchInput}
              value={q}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              onChange={(event) => { setQ(event.currentTarget.value) }}
            />
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
            <Tooltip label={t('retry')} side="top" delayMs={500}>
              <button type="button" className={css.iconAction} aria-label={t('retry')} onClick={() => { void load() }}>
                <IconRefreshOutline14 />
              </button>
            </Tooltip>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={adding}
              onClick={() => { setAdding(value => !value); setEditing(null); setMoving(null) }}
            >
              {t('add')}
            </Button>
            <Button variant="ghost" size="sm" onClick={enterSelecting}>
              {t('multiSelect')}
            </Button>
          </div>
        ))}

        {error !== '' && <p className={css.error}>{error}</p>}

        {state.status === 'loading' && renderEmpty(t('loading'))}
        {state.status === 'error' && (
          <div className={css.empty}>
            {t('error')}
            <button type="button" className={css.chip} onClick={() => { void load() }}>{t('retry')}</button>
          </div>
        )}

        {/* 全部：主从布局（左列表 / 右详情） */}
        {state.status === 'ready' && tab === 'all' && (
          filtered.length === 0 ? renderEmpty(t('empty')) : (
            <div className={css.split}>
              {/* 左列：紧凑条目列表（置顶在前 + 时间分组小节） */}
              <ul className={css.listPane}>
                {pinned.length > 0 && <li className={css.listSection}>{t('tabPinned')}</li>}
                {pinned.map(renderItemRow)}
                {(Object.keys(grouped) as GroupKey[]).map(groupKey => (
                  grouped[groupKey].length > 0 ? (
                    [
                      <li key={`${groupKey}-section`} className={css.listSection}>{groupTitles[groupKey]}</li>,
                      ...grouped[groupKey].map(renderItemRow),
                    ]
                  ) : null
                ))}
              </ul>
              {/* 右侧：详情（查看 / 编辑 / 移动 / 新建） */}
              <div className={css.detailPane}>
                {adding ? (
                  <div className={css.detailForm}>
                    <textarea
                      className={css.inlineTextarea}
                      style={{ minHeight: 220 }}
                      value={addContent}
                      placeholder={t('addContentPlaceholder')}
                      aria-label={t('addContentPlaceholder')}
                      autoFocus
                      onChange={(event) => { setAddContent(event.currentTarget.value) }}
                    />
                    <div className={css.addMeta}>
                      <input
                        className={css.inlineInput}
                        style={{ flex: 1, minWidth: 120 }}
                        value={addTags}
                        placeholder={t('addTagsPlaceholder')}
                        aria-label={t('addTagsPlaceholder')}
                        onChange={(event) => { setAddTags(event.currentTarget.value) }}
                      />
                      <label className={css.check}>
                        <input type="checkbox" checked={addPinned} onChange={(event) => { setAddPinned(event.currentTarget.checked) }} />
                        {t('addPinned')}
                      </label>
                      {scopeFields('dsh-memory-add-scope', addScope, setAddScope, addProject, setAddProject)}
                    </div>
                    <div className={css.editButtons}>
                      <Button variant="primary" disabled={busy || addContent.trim() === ''} onClick={saveAdd}>{t('save')}</Button>
                      <Button variant="outline" disabled={busy} onClick={() => { setAdding(false) }}>{t('cancel')}</Button>
                    </div>
                  </div>
                ) : editing !== null && detail !== null && detail.id === editing.entryId ? (
                  <div className={css.detailForm}>
                    <textarea
                      className={css.inlineTextarea}
                      style={{ minHeight: 220 }}
                      value={editing.content}
                      aria-label={t('edit')}
                      onChange={(event) => { setEditing({ ...editing, content: event.currentTarget.value }) }}
                    />
                    <div className={css.addMeta}>
                      <input
                        className={css.inlineInput}
                        style={{ flex: 1, minWidth: 120 }}
                        value={editing.tags}
                        placeholder={t('tagEditPlaceholder')}
                        aria-label={t('tagEditPlaceholder')}
                        onChange={(event) => { setEditing({ ...editing, tags: event.currentTarget.value }) }}
                      />
                      {scopeFields(`dsh-memory-edit-scope-${editing.entryId}`, editing.scope, (next) => {
                        setEditing({ ...editing, scope: next, projectHash: next === 'global' ? null : editing.projectHash })
                      }, editing.projectHash ?? '', (hash) => { setEditing({ ...editing, scope: 'project', projectHash: hash }) })}
                    </div>
                    <div className={css.editButtons}>
                      <Button variant="primary" disabled={busy} onClick={saveEdit}>{t('save')}</Button>
                      <Button variant="outline" disabled={busy} onClick={() => { setEditing(null) }}>{t('cancel')}</Button>
                    </div>
                  </div>
                ) : moving !== null && detail !== null && detail.id === moving.entryId ? (
                  <div className={css.detailForm}>
                    <div className={css.editButtons} style={{ justifyContent: 'flex-start' }}>
                      <Button
                        variant={moving.target === 'global' ? 'primary' : 'outline'}
                        disabled={busy}
                        onClick={() => { setMoving({ ...moving, target: 'global' }) }}
                      >
                        {t('moveToGlobal')}
                      </Button>
                      <Button
                        variant={moving.target === 'project' ? 'primary' : 'outline'}
                        disabled={busy}
                        onClick={() => { setMoving({ ...moving, target: 'project' }) }}
                      >
                        {t('moveToProject')}
                      </Button>
                    </div>
                    {moving.target === 'project' && (
                      <input
                        className={css.inlineInput}
                        value={moving.project}
                        placeholder={t('projectPlaceholder')}
                        aria-label={t('projectPlaceholder')}
                        onChange={(event) => { setMoving({ ...moving, project: event.currentTarget.value }) }}
                      />
                    )}
                    <div className={css.editButtons}>
                      <Button variant="primary" disabled={busy} onClick={saveMove}>{t('save')}</Button>
                      <Button variant="outline" disabled={busy} onClick={() => { setMoving(null) }}>{t('cancel')}</Button>
                    </div>
                  </div>
                ) : detail !== null ? (
                  <>
                    <div className={css.detailHead}>
                      <h3 className={css.detailTitle}>{entryTitle(detail.content)}</h3>
                      {detailActions(detail)}
                    </div>
                    <div className={css.detailMeta}>
                      <span>{detail.scope === 'global' ? t('scopeGlobal') : projectName(detail.projectHash, projects)}</span>
                      <span>{t('importanceLabel', { n: detail.importance })}</span>
                      <span>{detail.source === 'manual' ? t('sourceManual') : t('sourceExtract')}</span>
                      <span>{relativeTime(detail.updatedAt)}</span>
                      {detail.layer === 'long' && <span>{t('groupLongterm')}</span>}
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
                  </>
                ) : (
                  renderEmpty(t('empty'))
                )}
              </div>
            </div>
          )
        )}

        {/* 变更（按当前 全部/全局/项目 筛选；全宽列表） */}
        {state.status === 'ready' && tab === 'changes' && (
          visibleChanges.length === 0
            ? renderEmpty(t('changesEmpty'))
            : <ul className={css.cardList}>{visibleChanges.map(renderChange)}</ul>
        )}
      </div>
      </PshBody>
    </PopoverShell>
  )

  /** 渲染一条变更（含前后内容对比，无删除按钮）。 */
  function renderChange(change: ChangeView): JSX.Element {
    const hasDiff = change.before !== undefined && change.after !== undefined && change.before !== change.after
    return (
      <li key={change.id} className={css.changeRow}>
        <span className={change.action === 'delete' ? `${css.changeBadge} ${css.changeBadgeDelete}` : css.changeBadge}>
          {changeActionLabel(change.action)}
        </span>
        <div className={css.changeMain}>
          <div className={css.cardMeta}>
            <span>{change.scope === 'global' ? t('scopeGlobal') : change.projectHash ?? ''}</span>
            <span>{relativeTime(change.at)}</span>
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
