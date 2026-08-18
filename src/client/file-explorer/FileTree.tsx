/**
 * dsh-file-explorer — 懒加载文件树。目录点击展开时才拉取子条目，已加载的
 * 目录在组件存活期间缓存；文件双击回调打开编辑器。
 */

import { useEffect, useState } from 'react'
import {
  IconChevronRightOutline14,
  IconCodeOutline16,
  IconFolderClose16,
  IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { listDirectory, type DirEntry } from './api.ts'
import type { FileExplorerLocaleKey } from './locales.ts'
import { css } from './styles.ts'

type T = (key: FileExplorerLocaleKey) => string

/** 用一个与父路径一致的分隔符拼出子路径。 */
function joinPath(parent: string, name: string): string {
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return parent.endsWith('/') || parent.endsWith('\\') ? `${parent}${name}` : `${parent}${sep}${name}`
}

interface DirState {
  status: 'idle' | 'loading' | 'error' | 'ready'
  entries?: DirEntry[]
}

interface TreeNodeProps {
  path: string
  name: string
  onOpenFile: (path: string) => void
  t: T
}

function FileNode({ path, name, onOpenFile }: TreeNodeProps): JSX.Element {
  return (
    <li>
      <button
        type="button"
        className={css.treeRow}
        title={name}
        onDoubleClick={() => { onOpenFile(path) }}
      >
        <span className={css.treeChevron} style={{ width: 12 }} aria-hidden="true" />
        <IconCodeOutline16 className={css.treeIcon} size={14} aria-hidden="true" />
        <span className={css.treeName}>{name}</span>
      </button>
    </li>
  )
}

function DirNode({ path, name, onOpenFile, t }: TreeNodeProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [state, setState] = useState<DirState>({ status: 'idle' })

  const toggle = (): void => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (state.status === 'idle') {
      setState({ status: 'loading' })
      listDirectory(path).then(
        (entries) => { setState({ status: 'ready', entries }) },
        () => { setState({ status: 'error' }) },
      )
    }
  }

  return (
    <li>
      <button
        type="button"
        className={css.treeRow}
        title={name}
        data-open={expanded ? 'true' : undefined}
        aria-expanded={expanded}
        onClick={toggle}
      >
        <IconChevronRightOutline14 className={css.treeChevron} size={12} aria-hidden="true" />
        {expanded
          ? <IconFolderOpen16 className={css.treeIcon} size={14} aria-hidden="true" />
          : <IconFolderClose16 className={css.treeIcon} size={14} aria-hidden="true" />}
        <span className={css.treeName}>{name}</span>
      </button>
      {expanded && state.status === 'loading' && <div className={css.status}>{t('loading')}</div>}
      {expanded && state.status === 'error' && <div className={css.statusError}>{t('error')}</div>}
      {expanded && state.status === 'ready' && (
        state.entries !== undefined && state.entries.length === 0
          ? <div className={css.status}>{t('emptyDir')}</div>
          : (
            <ul className={css.treeChildren}>
              {(state.entries ?? []).map(entry => entry.type === 'directory'
                ? (
                  <DirNode
                    key={entry.name}
                    path={joinPath(path, entry.name)}
                    name={entry.name}
                    onOpenFile={onOpenFile}
                    t={t}
                  />
                )
                : (
                  <FileNode
                    key={entry.name}
                    path={joinPath(path, entry.name)}
                    name={entry.name}
                    onOpenFile={onOpenFile}
                    t={t}
                  />
                ))}
            </ul>
          )
      )}
    </li>
  )
}

interface FileTreeProps {
  rootPath: string
  onOpenFile: (path: string) => void
  t: T
}

/** 根目录条目列表。 */
export function FileTree({ rootPath, onOpenFile, t }: FileTreeProps): JSX.Element {
  const [state, setState] = useState<DirState>({ status: 'loading' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (rootPath === '') return
    let current = true
    setState({ status: 'loading' })
    listDirectory(rootPath).then(
      (entries) => { if (current) setState({ status: 'ready', entries }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [rootPath, reload])

  if (state.status === 'loading') return <div className={css.status}>{t('loading')}</div>
  if (state.status === 'error') {
    return (
      <>
        <div className={css.statusError}>{t('error')}</div>
        <button type="button" className={css.retryButton} onClick={() => { setReload(value => value + 1) }}>
          {t('retry')}
        </button>
      </>
    )
  }
  if (state.entries === undefined || state.entries.length === 0) {
    return <div className={css.status}>{t('emptyDir')}</div>
  }
  return (
    <ul className={css.tree}>
      {state.entries.map(entry => entry.type === 'directory'
        ? (
          <DirNode
            key={entry.name}
            path={joinPath(rootPath, entry.name)}
            name={entry.name}
            onOpenFile={onOpenFile}
            t={t}
          />
        )
        : (
          <FileNode
            key={entry.name}
            path={joinPath(rootPath, entry.name)}
            name={entry.name}
            onOpenFile={onOpenFile}
            t={t}
          />
        ))}
    </ul>
  )
}
