/**
 * dsh-memory 主面板（Modal，与技能面板同款框架）：
 * Tab（全部 / 变更 / 置顶）、项目切换 chips、搜索 + 标签筛选、
 * 置顶区 + 时间线分组（今天/本周/更早/长期）、条目卡片操作（置顶/编辑/删除/移项目）、
 * 变更裁决（保留/删除/改标签/移项目）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconRefreshOutline14,
  IconTrashOutline16,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangeView, MemoryApi, MemoryEntryView, MemoryListResponse, ProjectView } from './api.js'
import { css, ensureStyles } from './styles.js'
import { changeActionLabel } from './Notify.tsx'
import { modalAnimClass } from '../modal-animation.js'

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
  /** 正在播放收回动画（此时 Modal 仍挂载，播放 pop-out）。 */
  closing?: boolean
  onClose: () => void
  initialTab?: MemoryTab
} & InjectFace<MemoryApi> & PropsLocale<'dshMemory'>

/** 分割标签输入（逗号/空格/中文逗号）。 */
function splitTags(raw: string): string[] {
  return raw.split(/[,，\s]+/).map(tag => tag.trim()).filter(Boolean).slice(0, 8)
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
export function MemoryPanel({ open, closing = false, onClose, initialTab, t, ...api }: MemoryPanelProps): JSX.Element {
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

  const renderCard = (entry: MemoryEntryView): JSX.Element => (    <li key={entry.id} className={entry.pinned ? `${css.card} ${css.cardPinned}` : css.card}>
      {entry.pinned && <span className={css.pinMark}><PinIcon size={14} filled /></span>}
      <div className={css.cardMain}>
        {editing?.entryId === entry.id ? (
          <div className={css.inlineForm}>
            <textarea
              className={css.inlineTextarea}
              value={editing.content}
              aria-label={t('edit')}
              onChange={(event) => { setEditing({ ...editing, content: event.currentTarget.value }) }}
            />
            <input
              className={css.inlineInput}
              value={editing.tags}
              placeholder={t('tagEditPlaceholder')}
              aria-label={t('tagEditPlaceholder')}
              onChange={(event) => { setEditing({ ...editing, tags: event.currentTarget.value }) }}
            />
            <div className={css.addMeta}>
              <label className={css.check}>
                <input
                  type="radio"
                  name={`dsh-memory-edit-scope-${entry.id}`}
                  checked={editing.scope === 'global'}
                  onChange={() => { setEditing({ ...editing, scope: 'global', projectHash: null }) }}
                />
                {t('moveToGlobal')}
              </label>
              <label className={css.check}>
                <input
                  type="radio"
                  name={`dsh-memory-edit-scope-${entry.id}`}
                  checked={editing.scope === 'project'}
                  onChange={() => {
                    setEditing({
                      ...editing,
                      scope: 'project',
                      projectHash: editing.projectHash ?? projects.find(p => p.entryCount > 0)?.hash ?? projects[0]?.hash ?? null,
                    })
                  }}
                />
                {t('moveToProject')}
              </label>
              {editing.scope === 'project' && (
                <select
                  className={css.tagSelect}
                  value={editing.projectHash ?? ''}
                  aria-label={t('projectPlaceholder')}
                  onChange={(event) => { setEditing({ ...editing, projectHash: event.currentTarget.value || null }) }}
                >
                  {projects.map(project => (
                    <option key={project.hash} value={project.hash}>
                      {project.alias ?? project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? project.hash}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className={css.editButtons}>
              <Button variant="primary" size="sm" disabled={busy} onClick={saveEdit}>{t('save')}</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(null) }}>{t('cancel')}</Button>
            </div>
          </div>
        ) : moving?.entryId === entry.id ? (
          <div className={css.inlineForm}>
            <div className={css.editButtons}>
              <Button
                variant={moving.target === 'global' ? 'primary' : 'outline'}
                size="sm"
                disabled={busy}
                onClick={() => { setMoving({ ...moving, target: 'global' }) }}
              >
                {t('moveToGlobal')}
              </Button>
              <Button
                variant={moving.target === 'project' ? 'primary' : 'outline'}
                size="sm"
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
              <Button variant="primary" size="sm" disabled={busy} onClick={saveMove}>{t('save')}</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => { setMoving(null) }}>{t('cancel')}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className={css.cardHead}>
              <div className={css.cardContent}>
                {entry.pinned && <span className={css.pinMark}><PinIcon size={12} filled /></span>}
                {entry.content}
              </div>
              <div className={css.cardActions}>
                <Tooltip label={entry.pinned ? t('unpin') : t('pin')} side="top" delayMs={500}>
                  <button type="button" className={css.iconAction} aria-label={entry.pinned ? t('unpin') : t('pin')} disabled={busy} onClick={() => { handlePin(entry) }}>
                    <PinIcon size={14} filled={entry.pinned} />
                  </button>
                </Tooltip>
                <Tooltip label={t('edit')} side="top" delayMs={500}>
                  <button type="button" className={css.iconAction} aria-label={t('edit')} disabled={busy} onClick={() => { startEdit(entry) }}>
                    <IconEditOutline16 size={14} />
                  </button>
                </Tooltip>
                <Tooltip label={t('move')} side="top" delayMs={500}>
                  <button type="button" className={css.iconAction} aria-label={t('move')} disabled={busy} onClick={() => { startMove(entry) }}>
                    <IconFolderOpenOutline16 size={14} />
                  </button>
                </Tooltip>
                <Tooltip label={t('delete')} side="top" delayMs={500}>
                  <button type="button" className={css.iconAction} aria-label={t('delete')} disabled={busy} onClick={() => { handleDelete(entry) }}>
                    <IconTrashOutline16 size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className={css.cardFoot}>
              {entry.tags.length > 0 && (
                <div className={css.chips}>
                  {entry.tags.map(tagName => (
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
              <div className={css.cardMeta}>
                <span>{entry.scope === 'global' ? t('scopeGlobal') : projectName(entry.projectHash, projects)}</span>
                <span>{entry.importance}</span>
                <span>{entry.source === 'manual' ? t('sourceManual') : t('sourceExtract')}</span>
                <span>{relativeTime(entry.updatedAt)}</span>
                {entry.layer === 'long' && <span>{t('groupLongterm')}</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </li>
  )

  /** 渲染一条变更（含前后内容对比，无删除按钮）。 */
  const renderChange = (change: ChangeView): JSX.Element => {
    const hasDiff = change.before !== undefined && change.after !== undefined && change.before !== change.after
    return (
      <li key={change.id} className={css.changeRow}>
        <span className={change.action === 'delete' ? `${css.changeBadge} ${css.changeBadgeDelete}` : css.changeBadge}>
          {changeActionLabel(change.action)}
        </span>
        <div className={css.cardMain}>
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

  const renderEmpty = (text: string): JSX.Element => <div className={css.empty}>{text}</div>

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t('close')}
      title={t('panelTitle')}
      className={`${css.modal ?? ''} ${modalAnimClass(closing)}`}
      contentClassName={css.modalBody ?? ''}
    >
      <div className={css.panel} aria-busy={state.status === 'loading'}>
        {/* Tab：全部 / 变更 */}
        <div className={css.tabs} role="tablist">
          {(['all', 'changes'] as const).map(key => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? `${css.tab} ${css.tabActive}` : css.tab}
              onClick={() => { setTab(key) }}
            >
              {key === 'all' ? t('tabAll') : `${t('tabChanges')}${changes.length > 0 ? ` (${changes.length})` : ''}`}
            </button>
          ))}
        </div>

        {/* 置顶区（常驻固定在全部/变更之上，所有 Tab 可见） */}
        {state.status === 'ready' && pinned.length > 0 && (
          <>
            <div className={css.sectionTitle}>{t('tabPinned')}</div>
            <ul className={css.cardList}>{pinned.map(renderCard)}</ul>
          </>
        )}

        {/* 手动添加记忆 */}
        <div className={css.addRow}>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={adding}
            onClick={() => { setAdding(value => !value) }}
          >
            {t('add')}
          </Button>
        </div>
        {adding && (
          <div className={css.addForm}>
            <textarea
              className={css.inlineTextarea}
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
                <input
                  type="checkbox"
                  checked={addPinned}
                  onChange={(event) => { setAddPinned(event.currentTarget.checked) }}
                />
                {t('addPinned')}
              </label>
              <label className={css.check}>
                <input
                  type="radio"
                  name="dsh-memory-add-scope"
                  checked={addScope === 'global'}
                  onChange={() => { setAddScope('global') }}
                />
                {t('addScopeGlobal')}
              </label>
              <label className={css.check}>
                <input
                  type="radio"
                  name="dsh-memory-add-scope"
                  checked={addScope === 'project'}
                  onChange={() => {
                    setAddScope('project')
                    // 默认选中第一个项目（若无选择）。
                    if (addProject === '') {
                      const first = projects.find(project => project.entryCount > 0) ?? projects[0]
                      if (first !== undefined) setAddProject(first.hash)
                    }
                  }}
                />
                {t('addScopeProject')}
              </label>
              {addScope === 'project' && (
                <select
                  className={css.tagSelect}
                  value={addProject}
                  aria-label={t('projectPlaceholder')}
                  onChange={(event) => { setAddProject(event.currentTarget.value) }}
                >
                  {projects.length === 0 && <option value="">{t('noProjects')}</option>}
                  {projects.map(project => (
                    <option key={project.hash} value={project.hash}>
                      {project.alias ?? project.path.split(/[\\/]/).filter(Boolean).at(-1) ?? project.hash}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className={css.editButtons}>
              <Button variant="primary" size="sm" disabled={busy || addContent.trim() === ''} onClick={saveAdd}>
                {t('save')}
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => { setAdding(false) }}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        )}

        {/* 项目切换（全部/全局/项目 —— 所有 Tab 通用，置顶区同样按此筛选） */}
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
            return (
              <>
                <label className={css.check} title={t('autoMemory')}>
                  <input
                    type="checkbox"
                    checked={project?.autoMemory ?? true}
                    disabled={busy}
                    onChange={(event) => {
                      void run(() => api.meta(hash, { autoMemory: event.currentTarget.checked }))
                    }}
                  />
                  {t('autoMemory')}
                </label>
                <Tooltip label={t('clearProject')} side="top" delayMs={500}>
                  <button type="button" className={css.iconAction} aria-label={t('clearProject')} disabled={busy} onClick={handleClearProject}>
                    <IconTrashOutline16 size={14} />
                  </button>
                </Tooltip>
              </>
            )
          })()}
        </div>

        {/* 搜索 + 标签筛选（全部 Tab） */}
        {tab === 'all' && (
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
          </div>
        )}

        {error !== '' && <p className={css.error}>{error}</p>}

        {state.status === 'loading' && renderEmpty(t('loading'))}
        {state.status === 'error' && (
          <div className={css.empty}>
            {t('error')}
            <button type="button" className={css.chip} onClick={() => { void load() }}>{t('retry')}</button>
          </div>
        )}

        {/* 全部：时间线（置顶区已在 Tab 上方固定展示） */}
        {state.status === 'ready' && tab === 'all' && (
          <>
            {(Object.keys(grouped) as GroupKey[]).map(groupKey => (
              grouped[groupKey].length > 0 && (
                <div key={groupKey}>
                  <div className={css.sectionTitle}>{groupTitles[groupKey]}</div>
                  <ul className={css.cardList}>{grouped[groupKey].map(renderCard)}</ul>
                </div>
              )
            ))}
            {filtered.length === 0 && renderEmpty(t('empty'))}
          </>
        )}

        {/* 变更（按当前 全部/全局/项目 筛选） */}
        {state.status === 'ready' && tab === 'changes' && (
          <>
            <div className={css.sectionTitle}>{t('todayChanges')}</div>
            {visibleChanges.length === 0
              ? renderEmpty(t('changesEmpty'))
              : <ul className={css.cardList}>{visibleChanges.map(renderChange)}</ul>}
          </>
        )}
      </div>
    </Modal>
  )
}
