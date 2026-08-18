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
  t: T
}

type WorkspaceState = 'loading' | 'error' | 'ready'

export function FileExplorerDrawer({ open, onClose, t }: FileExplorerDrawerProps): JSX.Element | null {
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([])
  const [wsState, setWsState] = useState<WorkspaceState>('loading')
  const [selected, setSelected] = useState('')
  const [openFile, setOpenFile] = useState<string | null>(null)

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

  if (!open) return null

  const current = workspaces.find(workspace => workspace.id === selected)

  return (
    <>
      <div className={css.backdrop} aria-hidden="true" onClick={onClose} />
      <div className={css.drawer} role="dialog" aria-label={t('drawerTitle')}>
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
