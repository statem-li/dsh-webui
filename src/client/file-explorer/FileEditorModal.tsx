/**
 * dsh-file-explorer — 打开文件统一入口：
 *   图片扩展名 → 图片查看器；文本 → CodeMirror 编辑/保存；
 *   二进制 → 十六进制预览 + 下载；超大 → 说明 + 下载。
 * 文本读取记录 version，保存用 replaceIfVersion 守卫，冲突时可「仍要覆盖」。
 */

import { useEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { syntaxHighlighting } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, rawFileUrl, readFile, readBinaryPreview, writeFile } from './api.ts'
import { languageForPath } from './languages.ts'
import type { FileExplorerLocaleKey } from './locales.ts'
import { css } from './styles.ts'
import { FeModal } from './FeModal.tsx'
import { ImageViewer } from './ImageViewer.tsx'

type T = (key: FileExplorerLocaleKey) => string

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|ico|cur|svg|avif)$/i

function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path)
}

/** Format a byte count for display. */
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

/** Render leading bytes as a classic hex dump (offset | hex | ascii). */
function toHexDump(bytes: Uint8Array): string {
  const lines: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.subarray(offset, Math.min(offset + 16, bytes.length))
    let hex = ''
    let ascii = ''
    for (let i = 0; i < 16; i++) {
      if (i < chunk.length) {
        const byte = chunk[i]
        hex += `${byte.toString(16).padStart(2, '0')} `
        ascii += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '·'
      } else {
        hex += '   '
      }
      if (i === 7) hex += ' '
    }
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex} ${ascii}`)
  }
  return lines.join('\n')
}

/** Translate a load/save error into display copy. */
function describeError(error: unknown, t: T): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'FS_NOT_TEXT': return t('binaryHint')
      case 'FS_TOO_LARGE': return t('tooLarge')
      case 'FS_NOT_FOUND': return t('notFound')
      case 'FS_STALE_VERSION': return t('staleConflict')
      default: break
    }
  }
  return t('error')
}

type LoadState = 'loading' | 'error' | 'ready' | 'binary'

interface BinaryData {
  dump: string
  size: number
  truncated: boolean
}

export interface FileEditorModalProps {
  open: boolean
  path: string
  onClose: () => void
  t: T
}

export function FileEditorModal({ open, path, onClose, t }: FileEditorModalProps): JSX.Element {
  if (isImagePath(path)) {
    return <ImageViewer open={open} path={path} onClose={onClose} t={t} />
  }
  return <TextFileModal open={open} path={path} onClose={onClose} t={t} />
}

function TextFileModal({ open, path, onClose, t }: FileEditorModalProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [loadErrorCode, setLoadErrorCode] = useState('')
  const [binary, setBinary] = useState<BinaryData | null>(null)
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
    setLoadErrorCode('')
    setBinary(null)
    setDirty(false)
    setConflict(false)
    readFile(path).then(
      (file) => {
        if (!current) return
        setContent(file.content)
        setVersion(file.version)
        setLoadState('ready')
      },
      async (error: unknown) => {
        if (!current) return
        // 二进制文件：拉头部字节做十六进制预览，任何类型都能打开看点内容。
        if (error instanceof ApiError && error.code === 'FS_NOT_TEXT') {
          try {
            const preview = await readBinaryPreview(path)
            if (!current) return
            const bytes = Uint8Array.from(atob(preview.base64), char => char.charCodeAt(0))
            setBinary({ dump: toHexDump(bytes), size: preview.size, truncated: preview.truncated })
            setLoadState('binary')
            return
          } catch {
            // 预览也失败时落到通用错误提示。
          }
        }
        setLoadError(describeError(error, t))
        setLoadErrorCode(error instanceof ApiError ? error.code ?? '' : '')
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

  const downloadButton = (
    <a className={css.downloadLink} href={rawFileUrl(path, true)} download>{t('download')}</a>
  )

  let footer = (
    <div className={css.editorFooter}>
      <span className={css.editorStatus}>{''}</span>
      <span style={{ flex: 1 }} />
      <Button variant="outline" onClick={onClose}>{t('close')}</Button>
    </div>
  )
  if (loadState === 'ready' || conflict) {
    footer = (
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
  } else if (loadState === 'binary') {
    footer = (
      <div className={css.editorFooter}>
        <span className={css.editorStatus}>
          {t('sizeLabel')} · {formatBytes(binary?.size ?? 0)}{binary?.truncated === true ? ` · ${t('hexTruncated')}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {downloadButton}
        <Button variant="outline" onClick={onClose}>{t('close')}</Button>
      </div>
    )
  } else if (loadState === 'error' && (loadErrorCode === 'FS_TOO_LARGE' || loadErrorCode === 'FS_NOT_TEXT')) {
    footer = (
      <div className={css.editorFooter}>
        <span style={{ flex: 1 }} />
        {downloadButton}
        <Button variant="outline" onClick={onClose}>{t('close')}</Button>
      </div>
    )
  }

  const titlePrefix = loadState === 'ready' || loadState === 'loading' ? t('editorTitle') : t('viewTitle')

  return (
    <FeModal
      open={open}
      onClose={() => { if (!saving) onClose() }}
      closeLabel={t('close')}
      title={`${titlePrefix} · ${fileNameOf(path)}`}
      className={css.editorModal}
      width="min(960px, 92vw)"
      footer={footer}
    >
      {loadState === 'loading' && <div className={css.status}>{t('loading')}</div>}
      {loadState === 'error' && <div className={css.statusError}>{loadError}</div>}
      {loadState === 'binary' && (
        <div className={css.binaryCard}>
          <div className={css.binaryHint}>{t('binaryPeekNote')}</div>
          <pre className={css.hexDump}>{binary?.dump ?? ''}</pre>
        </div>
      )}
      {loadState === 'ready' && <div className={css.editorHost} ref={hostRef} />}
    </FeModal>
  )
}
