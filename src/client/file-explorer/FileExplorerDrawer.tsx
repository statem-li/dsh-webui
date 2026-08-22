/**
 * dsh-file-explorer — 抽屉主体：工作区切换 + 懒加载文件树 + 编辑器弹窗。
 */

import { useEffect, useState } from 'react'
import { listWorkspaces, type WorkspaceView } from './api.ts'
import { FileTree } from './FileTree.tsx'
import { FileEditorModal } from './FileEditorModal.tsx'
import type { FileExplorerLocaleKey } from './locales.ts'
import { css } from './styles.ts'

type T = (key: FileExplorerLocaleKey) => string

interface FileExplorerDrawerProps {
  open: boolean
  onClose: () => void
  /** 当前会话的工作区根（cwd）；有值时抽屉自动跟随到对应工作区。 */
  currentCwd?: string
  t: T
}

type WorkspaceState = 'loading' | 'error' | 'ready'

/** 退出动画兜底时长（ms），需 ≥ styles.ts 中 fe-drawer-out 的时长。 */
const DRAWER_EXIT_MS = 300

/** 归一化路径用于比较（统一分隔符、去尾斜杠、忽略大小写——Windows）。 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 按 cwd 选择最匹配的工作区：先精确命中，再取 cwd 所在的最深工作区。 */
function pickWorkspaceByCwd(workspaces: WorkspaceView[], cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  const target = normalizePath(cwd)
  let best: WorkspaceView | undefined
  for (const workspace of workspaces) {
    const root = normalizePath(workspace.path)
    if (target === root) return workspace.id
    if (target.startsWith(`${root}/`)) {
      if (best === undefined || root.length > normalizePath(best.path).length) best = workspace
    }
  }
  return best?.id
}

export function FileExplorerDrawer({ open, onClose, currentCwd, t }: FileExplorerDrawerProps): JSX.Element | null {
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([])
  const [wsState, setWsState] = useState<WorkspaceState>('loading')
  const [selected, setSelected] = useState('')
  const [openFile, setOpenFile] = useState<string | null>(null)
  // 滑出动画：父级把 open 置 false 后仍渲染到动画播完再卸载。
  const [visible, setVisible] = useState(open)
  const closing = !open && visible

  useEffect(() => {
    if (open) setVisible(true)
  }, [open])

  useEffect(() => {
    if (open || !visible) return
    const timer = window.setTimeout(() => { setVisible(false) }, DRAWER_EXIT_MS)
    return () => { window.clearTimeout(timer) }
  }, [open, visible])

  // Esc 关闭抽屉（文件弹窗打开时先让弹窗响应 Esc）。
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && openFile === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose, open, openFile])

  useEffect(() => {
    if (!open) return
    let current = true
    setWsState('loading')
    listWorkspaces().then(
      (list) => {
        if (!current) return
        setWorkspaces(list)
        setWsState('ready')
        setSelected(prev => list.some(workspace => workspace.id === prev) ? prev : (list[0]?.id ?? ''))
      },
      () => { if (current) setWsState('error') },
    )
    return () => { current = false }
  }, [open])

  // 跟随当前会话的工作区（打开后、会话切换时自动跳到对应工作区）。
  useEffect(() => {
    if (!open || wsState !== 'ready') return
    const preferred = pickWorkspaceByCwd(workspaces, currentCwd)
    if (preferred === undefined) return
    setSelected(prev => (prev === preferred ? prev : preferred))
  }, [open, wsState, workspaces, currentCwd])

  if (!visible) return null

  const current = workspaces.find(workspace => workspace.id === selected)

  return (
    <>
      <div
        className={closing ? `${css.backdrop} ${css.backdropClosing}` : css.backdrop}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        className={closing ? `${css.drawer} ${css.drawerClosing}` : css.drawer}
        role="dialog"
        aria-label={t('drawerTitle')}
      >
        <div className={css.drawerHeader}>
          <span className={css.drawerTitle}>{t('drawerTitle')}</span>
        </div>
        <div className={css.workspaceRow}>
          <select
            className={css.workspaceSelect}
            value={selected}
            aria-label={t('workspaceLabel')}
            onChange={(event) => { setSelected(event.currentTarget.value) }}
          >
            {workspaces.map(workspace => (
              <option key={workspace.id} value={workspace.id}>{workspace.title}</option>
            ))}
          </select>
        </div>
        <div className={css.drawerBody}>
          {wsState === 'loading' && <div className={css.status}>{t('loading')}</div>}
          {wsState === 'error' && <div className={css.statusError}>{t('error')}</div>}
          {wsState === 'ready' && workspaces.length === 0 && (
            <div className={css.status}>{t('emptyWorkspaces')}</div>
          )}
          {wsState === 'ready' && current !== undefined && (
            <FileTree rootPath={current.path} onOpenFile={(path) => { setOpenFile(path) }} t={t} />
          )}
        </div>
      </div>
      <FileEditorModal
        open={openFile !== null}
        path={openFile ?? ''}
        onClose={() => { setOpenFile(null) }}
        t={t}
      />
    </>
  )
}
