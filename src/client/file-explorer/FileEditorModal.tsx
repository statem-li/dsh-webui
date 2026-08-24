/**
 * dsh-file-explorer — 打开文件统一入口：
 *   图片扩展名 → 图片查看器；文本 → 「内容 + 时间线」双区布局：
 *     右栏默认是当前文件内容（CodeMirror，可直接编辑保存），
 *     左侧时间线点选任一时点后右栏切到该时点 vs 当前的双栏对比，
 *     点时间线顶部的「当前内容」随时回到编辑；
 *   二进制 → 十六进制预览 + 下载；超大 → 说明 + 下载。
 * 保存走 version 守卫，冲突时可「仍要覆盖」。
 */

import { useEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
// oneDark = 完整编辑器主题（activeLine/选区/gutter/光标暗色化 + 语法配色）；
// 只用 oneDarkHighlightStyle 会让当前行高亮等 chrome 残留浅色默认值（白条）。
import { oneDark } from '@codemirror/theme-one-dark'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, explorerSource, type FileReadSource, writeFile } from './api.ts'
import { languageForPath } from './languages.ts'
import type { FileExplorerLocaleKey } from './locales.ts'
import { css } from './styles.ts'
import { FeModal } from './FeModal.tsx'
import { FileHistoryView } from './FileHistoryView.tsx'
import { ImageViewer } from './ImageViewer.tsx'

type T = (key: FileExplorerLocaleKey) => string

/** 组件内统一经此取数：source 缺省时回退 file-explorer 默认源。 */
function sourceOf(source: FileReadSource | undefined): FileReadSource {
  return source ?? explorerSource
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|ico|cur|svg|avif)$/i

function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path)
}

/** Format a byte count for display. */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

/** Render leading bytes as a classic hex dump (offset | hex | ascii). */
export function toHexDump(bytes: Uint8Array): string {
  const lines: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.subarray(offset, Math.min(offset + 16, bytes.length))
    let hex = ''
    let ascii = ''
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]
      hex += `${byte.toString(16).padStart(2, '0')} `
      ascii += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '·'
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
  /** 当前会话 id：修改历史快照按会话存放，缺失时历史视图提示不可用。 */
  sessionId?: string
  /** 取数来源；缺省走 file-explorer（工作区校验），产物场景传 deliverableSource。 */
  source?: FileReadSource
  onClose: () => void
  t: T
}

export function FileEditorModal({ open, path, sessionId, source, onClose, t }: FileEditorModalProps): JSX.Element {
  if (isImagePath(path)) {
    return <ImageViewer open={open} path={path} onClose={onClose} t={t} rawUrl={source?.rawUrl} />
  }
  return <TextFileModal open={open} path={path} sessionId={sessionId} source={source} onClose={onClose} t={t} />
}

function TextFileModal({ open, path, sessionId, source, onClose, t }: FileEditorModalProps): JSX.Element {
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
  // 右栏视图：「当前内容」（可编辑）↔ 选中时点的对比 diff。打开默认内容——
  // 文件本体第一眼可见可改；历史以左侧时间线常驻，点时点才展开对比。
  const [histView, setHistView] = useState<'current' | 'diff'>('current')
  const draftRef = useRef<string | null>(null)
  // 磁盘内容基准的 ref 镜像：编辑器挂载 doc 取这里（不进 effect deps），
  // 保存成功后 setContent 同步 state 与 ref 都不会触发编辑器重挂丢光标。
  const contentRef = useRef('')
  // 历史页保存成功后的递增值：让对比视图按新磁盘内容重算（色块/差异即时更新）。
  const [histReload, setHistReload] = useState(0)

  /** 放弃未保存修改：把编辑器内容重置回磁盘版本。 */
  const discardChanges = (): void => {
    const editor = viewRef.current
    if (editor !== null) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } })
    }
    draftRef.current = null
    setDirty(false)
    setConflict(false)
  }

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
    // 打开文件默认落在当前内容上（历史异步加载，不阻塞看文件）。
    setHistView('current')
    draftRef.current = null
    const src = sourceOf(source)
    src.content(path).then(
      (file) => {
        if (!current) return
        contentRef.current = file.content
        setContent(file.content)
        setVersion(file.version)
        setLoadState('ready')
      },
      async (error: unknown) => {
        if (!current) return
        // 二进制文件：拉头部字节做十六进制预览，任何类型都能打开看点内容。
        if (error instanceof ApiError && error.code === 'FS_NOT_TEXT') {
          try {
            const preview = await src.binaryPreview(path)
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
  }, [open, path, source, t])

  // Mount / destroy the CodeMirror editor.
  // 挂载位置：右栏处于「当前内容」视图时 → FileHistoryView 渲染的 hostRef 宿主。
  // 切到对比视图时卸载，回来时以草稿重建，未保存修改不丢。
  const editorActive = open && loadState === 'ready' && histView === 'current'
  useEffect(() => {
    if (!editorActive) {
      viewRef.current?.destroy()
      viewRef.current = null
      return
    }
    const host = hostRef.current
    if (host === null) return

    const language = languageForPath(path)
    const extensions: Extension[] = [basicSetup, oneDark]
    if (language !== null) extensions.push(language)

    const editor = new EditorView({
      state: EditorState.create({
        doc: draftRef.current ?? contentRef.current,
        extensions: [
          ...extensions,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setDirty(true)
          }),
        ],
      }),
      parent: host,
    })
    viewRef.current = editor

    return () => {
      const mounted = viewRef.current
      if (mounted !== null) {
        draftRef.current = mounted.state.doc.toString()
        mounted.destroy()
        viewRef.current = null
      }
    }
  }, [editorActive, path])

  const save = (): void => {
    const view = viewRef.current
    if (view === null || saving) return
    const next = view.state.doc.toString()
    setSaving(true)
    writeFile(path, next, conflict ? undefined : version).then(
      (result) => {
        setVersion(result.version)
        setContent(next)
        setDirty(false)
        setConflict(false)
        setSaving(false)
        draftRef.current = null
        setHistReload(value => value + 1)
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
    <a className={css.downloadLink} href={sourceOf(source).rawUrl(path, true)} download>{t('download')}</a>
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
        {histView === 'diff' && (
          <Button variant="primary" disabled={saving} onClick={() => { setHistView('current') }}>
            {t('backToContent')}
          </Button>
        )}
        {histView === 'current' && (
          <>
            {dirty && !conflict && (
              <Button variant="outline" disabled={saving} onClick={discardChanges}>{t('histDiscard')}</Button>
            )}
            <Button variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button>
          </>
        )}
        {histView === 'current' && (
          <Button
            variant="primary"
            disabled={(!dirty && !conflict) || saving}
            onClick={save}
          >
            {conflict ? t('overwrite') : t('save')}
          </Button>
        )}
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

  const titlePrefix = loadState !== 'ready' && loadState !== 'loading' ? t('viewTitle') : t('editorTitle')

  return (
    <FeModal
      open={open}
      onClose={() => { if (!saving) onClose() }}
      closeLabel={t('close')}
      title={`${titlePrefix} · ${fileNameOf(path)}`}
      className={css.editorModal}
      width='min(1180px, 96vw)'
      maximizable
      forceMaximized={true}
      footer={footer}
    >
      {loadState === 'ready' || conflict ? (
        <FileHistoryView
          sessionId={sessionId}
          path={path}
          t={t}
          contentMode={histView === 'current'}
          editorHostRef={hostRef}
          reloadToken={histReload}
          onRequestCompare={() => { setHistView('diff') }}
          onRequestContent={() => { setHistView('current') }}
        />
      ) : (
        <>
          {loadState === 'loading' && <div className={css.status}>{t('loading')}</div>}
          {loadState === 'error' && <div className={css.statusError}>{loadError}</div>}
          {loadState === 'binary' && (
            <div className={css.binaryCard}>
              <div className={css.binaryHint}>{t('binaryPeekNote')}</div>
              <pre className={css.hexDump}>{binary?.dump ?? ''}</pre>
            </div>
          )}
        </>
      )}
    </FeModal>
  )
}
