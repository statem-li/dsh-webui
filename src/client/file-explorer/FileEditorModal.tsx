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
// oneDark = 完整编辑器主题（activeLine/选区/gutter/光标暗色化 + 语法配色）；
// 只用 oneDarkHighlightStyle 会让当前行高亮等 chrome 残留浅色默认值（白条）。
import { oneDark } from '@codemirror/theme-one-dark'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { MarkstreamMarkdown } from '../markdown/renderer'
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

/** Markdown 文件在卡片里默认渲染展示（可切源码编辑）。 */
const MARKDOWN_EXT_RE = /\.(md|markdown|mdx)$/i

function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path)
}

function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT_RE.test(path)
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
  // 「编辑 ↔ 历史」模式；历史模式下渲染时间线 + 双栏对比，编辑器暂离但草稿保留。
  const [mode, setMode] = useState<'edit' | 'history'>('edit')
  const draftRef = useRef<string | null>(null)
  // 「渲染 ↔ 源码」视图：markdown 文件默认渲染展示，可切源码编辑；
  // renderText 是渲染视图展示的内容（跟随编辑器当前文本，含未保存修改）。
  const [view, setView] = useState<'render' | 'source'>('source')
  const [renderText, setRenderText] = useState('')

  const switchMode = (next: 'edit' | 'history'): void => {
    if (next === mode) return
    // 进历史前把未保存的编辑内容收进草稿，返回时原样恢复到编辑器。
    if (next === 'history' && viewRef.current !== null) {
      draftRef.current = viewRef.current.state.doc.toString()
    }
    setMode(next)
  }

  // 渲染 ↔ 源码切换：离开编辑器前把当前 doc 收进草稿位（与进历史同法），
  // 往返切换不丢未保存修改；渲染视图展示的正是这份最新文本。
  const switchView = (next: 'render' | 'source'): void => {
    if (next === view) return
    if (next === 'render') {
      const text = viewRef.current?.state.doc.toString() ?? (draftRef.current ?? content)
      draftRef.current = text
      setRenderText(text)
    }
    setView(next)
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
    setMode('edit')
    draftRef.current = null
    const markdown = isMarkdownPath(path)
    setView(markdown ? 'render' : 'source')
    setRenderText('')
    const src = sourceOf(source)
    src.content(path).then(
      (file) => {
        if (!current) return
        setContent(file.content)
        setVersion(file.version)
        // 渲染视图的初始内容 = 磁盘内容（此后切换视图时跟随编辑器文本）。
        if (markdown) setRenderText(file.content)
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

  // Mount / destroy the CodeMirror editor. 历史模式或渲染视图暂离时销毁，返回时以草稿重建。
  useEffect(() => {
    if (!open || loadState !== 'ready' || mode !== 'edit' || view !== 'source') {
      viewRef.current?.destroy()
      viewRef.current = null
      return
    }
    const host = hostRef.current
    if (host === null) return

    const language = languageForPath(path)
    const extensions: Extension[] = [basicSetup, oneDark]
    if (language !== null) extensions.push(language)

    // 局部名用 editor：外层 view 是「渲染/源码」视图 state，避免遮蔽。
    const editor = new EditorView({
      state: EditorState.create({
        doc: draftRef.current ?? content,
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
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [open, loadState, mode, view, path, content])

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
        draftRef.current = null
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

  // 历史对比入口：仅文本内容就绪时开放（历史视图是文本对比）。
  const historyToggle = loadState === 'ready' ? (
    <Button
      variant="outline"
      disabled={saving}
      onClick={() => { switchMode(mode === 'edit' ? 'history' : 'edit') }}
    >
      {mode === 'edit' ? t('historyBtn') : t('histBack')}
    </Button>
  ) : null

  // 渲染 ↔ 源码切换入口：仅 markdown 文件、编辑模式、内容就绪时开放。
  const viewToggle = loadState === 'ready' && mode === 'edit' && isMarkdownPath(path) ? (
    <Button
      variant="outline"
      disabled={saving}
      onClick={() => { switchView(view === 'render' ? 'source' : 'render') }}
    >
      {view === 'render' ? t('sourceView') : t('renderedView')}
    </Button>
  ) : null

  let footer = (
    <div className={css.editorFooter}>
      <span className={css.editorStatus}>{''}</span>
      <span style={{ flex: 1 }} />
      {historyToggle}
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
        {viewToggle}
        {historyToggle}
        <Button variant="outline" disabled={saving} onClick={onClose}>{t('cancel')}</Button>
        {mode === 'edit' && (
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

  const historyMode = mode === 'history' && loadState === 'ready'
  const titlePrefix = historyMode
    ? t('histModalTitle')
    : loadState !== 'ready' && loadState !== 'loading'
      ? t('viewTitle')
      : mode === 'edit' && view === 'render' ? t('viewTitle') : t('editorTitle')

  return (
    <FeModal
      open={open}
      onClose={() => { if (!saving) onClose() }}
      closeLabel={t('close')}
      title={`${titlePrefix} · ${fileNameOf(path)}`}
      className={css.editorModal}
      width={historyMode ? 'min(1180px, 96vw)' : 'min(960px, 92vw)'}
      maximizable
      forceMaximized={historyMode}
      footer={footer}
    >
      {historyMode ? (
        <FileHistoryView sessionId={sessionId} path={path} t={t} />
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
          {loadState === 'ready' && view === 'source' && <div className={css.editorHost} ref={hostRef} />}
          {loadState === 'ready' && view === 'render' && (
            <div className={css.markdownBody}>
              <MarkstreamMarkdown text={renderText} streaming={false} />
            </div>
          )}
        </>
      )}
    </FeModal>
  )
}
