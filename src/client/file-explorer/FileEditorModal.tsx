/**
 * dsh-file-explorer — 编辑器弹窗：CodeMirror 6 + 语法高亮，双击打开的文件
 * 在此展示/编辑/保存。读文件记录 version，保存用 replaceIfVersion 守卫，
 * 冲突时提示并可「仍要覆盖」。
 */

import { useEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { syntaxHighlighting } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, readFile, writeFile } from './api.ts'
import { languageForPath } from './languages.ts'
import type { FileExplorerLocaleKey } from './locales.ts'
import { css } from './styles.ts'

type T = (key: FileExplorerLocaleKey) => string

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Translate a load/save error into display copy. */
function describeError(error: unknown, t: T): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'FS_NOT_TEXT': return t('binaryError')
      case 'FS_TOO_LARGE': return t('tooLarge')
      case 'FS_NOT_FOUND': return t('notFound')
      case 'FS_STALE_VERSION': return t('staleConflict')
      default: break
    }
  }
  return t('error')
}

type LoadState = 'loading' | 'error' | 'ready'

export interface FileEditorModalProps {
  open: boolean
  path: string
  onClose: () => void
  t: T
}

export function FileEditorModal({ open, path, onClose, t }: FileEditorModalProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [content, setContent] = useState('')
  const [version, setVersion] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)

  // Load the file when the target changes.
  useEffect(() => {
    if (!open || path === '') return
    let current = true
    setLoadState('loading')
    setLoadError('')
    setDirty(false)
    setConflict(false)
    readFile(path).then(
      (file) => {
        if (!current) return
        setContent(file.content)
        setVersion(file.version)
        setLoadState('ready')
      },
      (error: unknown) => {
        if (!current) return
        setLoadError(describeError(error, t))
        setLoadState('error')
      },
    )
    return () => { current = false }
  }, [open, path, t])

  // Mount / destroy the CodeMirror editor.
  useEffect(() => {
    if (!open || loadState !== 'ready') {
      viewRef.current?.destroy()
      viewRef.current = null
      return
    }
    const host = hostRef.current
    if (host === null) return

    const language = languageForPath(path)
    const extensions: Extension[] = [basicSetup, syntaxHighlighting(oneDarkHighlightStyle)]
    if (language !== null) extensions.push(language)

    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          ...extensions,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setDirty(true)
          }),
        ],
      }),
      parent: host,
    })
    viewRef.current = view

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [open, loadState, path, content])

  const save = (): void => {
    const view = viewRef.current
    if (view === null || saving) return
    const next = view.state.doc.toString()
    setSaving(true)
    writeFile(path, next, conflict ? undefined : version).then(
      (result) => {
        setVersion(result.version)
        setDirty(false)
        setConflict(false)
        setSaving(false)
      },
      (error: unknown) => {
        setSaving(false)
        if (error instanceof ApiError && error.code === 'FS_STALE_VERSION') {
          setConflict(true)
        }
      },
    )
  }

  const footer = (
    <div className={css.editorFooter}>
      <span className={css.editorStatus}>
        {conflict ? t('staleConflict') : dirty ? t('unsaved') : ''}
      </span>
      <span style={{ flex: 1 }} />
      <Button variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button>
      <Button
        variant="primary"
        disabled={(!dirty && !conflict) || saving}
        onClick={save}
      >
        {conflict ? t('overwrite') : t('save')}
      </Button>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose() }}
      closeLabel={t('close')}
      title={`${t('editorTitle')} · ${fileNameOf(path)}`}
      className={css.editorModal}
      footer={footer}
    >
      {loadState === 'loading' && <div className={css.status}>{t('loading')}</div>}
      {loadState === 'error' && <div className={css.statusError}>{loadError}</div>}
      {loadState === 'ready' && <div className={css.editorHost} ref={hostRef} />}
    </Modal>
  )
}
