/**
 * message-deliverables — 会话产物大卡片（client 半身）。
 *
 * 双栏布局：左栏是本会话的产物文件清单（host 端 fs 写入记账，服务重启后
 * 依然可用），点击文件名右栏展示内容——图片内嵌预览、markdown 渲染、
 * 代码/文本只读高亮、二进制 hex 兜底，全程应用内展示不经系统打开。
 * 内容走 /api/webui-deliverables/content|raw|bin 专用路由（按会话记账授权，
 * 覆盖落在注册工作区外的产物）；文件名旁的图标可改用文件浏览器打开。
 */
import { useEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
// oneDark = 完整编辑器主题：activeLine/选区/光标暗色化，避免浅色白条。
import { oneDark } from '@codemirror/theme-one-dark'
import { MarkstreamMarkdown } from '../markdown/renderer'
import {
  ApiError, deliverableRawUrl, fetchDeliverableBin,
  fetchDeliverableContent, fetchSessionDeliverables, type DeliverableItem,
} from '../file-explorer/api.ts'
import { FILE_EXPLORER_OPEN_PATH_EVENT } from '../file-explorer/FileExplorerEntry.tsx'
import { formatBytes, toHexDump } from '../file-explorer/FileEditorModal.tsx'
import { languageForPath } from '../file-explorer/languages.ts'
import { FeModal } from '../file-explorer/FeModal.tsx'
import { css } from './styles.ts'

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|ico|cur|svg|avif)$/i
const MARKDOWN_EXT_RE = /\.(md|markdown|mdx)$/i

function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path)
}

function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT_RE.test(path)
}

function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** 今天显示 HH:mm，更早显示 MM-dd HH:mm。 */
function fmtTime(t: number): string {
  const d = new Date(t)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === new Date().toDateString()) return hm
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

type Preview =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'image' }
  | { kind: 'text'; content: string }
  | { kind: 'hex'; dump: string; size: number; truncated: boolean }

interface DeliverablesCardProps {
  open: boolean
  sessionId?: string
  onClose: () => void
}

export function DeliverablesCard({ open, sessionId, onClose }: DeliverablesCardProps): JSX.Element {
  const sid = sessionId ?? ''
  const [items, setItems] = useState<DeliverableItem[] | null>(null)
  const [listError, setListError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview>({ kind: 'empty' })
  const hostRef = useRef<HTMLDivElement>(null)

  // 打开时拉取清单（不缓存：每次打开都取最新记账）。
  useEffect(() => {
    if (!open) return
    setItems(null)
    setListError('')
    setSelected(null)
    setPreview({ kind: 'empty' })
    if (sessionId === undefined || sessionId === '') {
      setListError('当前会话不可用。')
      return
    }
    let current = true
    fetchSessionDeliverables(sessionId).then(
      (list) => {
        if (!current) return
        setItems(list)
        if (list.length > 0) setSelected(list[0].path)
      },
      (error: unknown) => {
        if (!current) return
        if (error instanceof ApiError && error.code === 'SERVICE_MISSING') {
          setListError('产物记账服务尚未启用：重启 DSH 服务后生效，之后会话里写入的文件会自动入账。')
        } else {
          setListError(error instanceof ApiError ? error.message : String(error))
        }
      },
    )
    return () => { current = false }
  }, [open, sessionId])

  // 选中文件变化 → 加载预览内容。
  useEffect(() => {
    if (selected === null) {
      setPreview({ kind: 'empty' })
      return
    }
    if (isImagePath(selected)) {
      // 图片走 raw 字节流直读，无需文本读取。
      setPreview({ kind: 'image' })
      return
    }
    let current = true
    setPreview({ kind: 'loading' })
    void (async (): Promise<void> => {
      try {
        // 产物专用路由：按会话记账授权，不受注册工作区包含校验限制。
        const file = await fetchDeliverableContent(sessionId ?? '', selected)
        if (current) setPreview({ kind: 'text', content: file.content })
        return
      } catch (error) {
        if (error instanceof ApiError && error.code === 'FS_NOT_TEXT') {
          try {
            const bin = await fetchDeliverableBin(sessionId ?? '', selected)
            if (current) {
              const bytes = Uint8Array.from(atob(bin.base64), char => char.charCodeAt(0))
              setPreview({ kind: 'hex', dump: toHexDump(bytes), size: bin.size, truncated: bin.truncated })
            }
            return
          } catch { /* 预览也失败 → 落到通用错误 */ }
        }
        if (current) {
          setPreview({ kind: 'error', message: error instanceof ApiError ? error.message : String(error) })
        }
      }
    })()
    return () => { current = false }
  }, [selected, sessionId])

  // 只读 CodeMirror：text 态挂载，其他态销毁。
  useEffect(() => {
    if (preview.kind !== 'text') return
    const host = hostRef.current
    if (host === null || selected === null) return
    const language = languageForPath(selected)
    const extensions = [
      basicSetup,
      oneDark,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ]
    if (language !== null) extensions.push(language)
    const view = new EditorView({
      state: EditorState.create({ doc: preview.content, extensions }),
      parent: host,
    })
    return () => { view.destroy() }
  }, [preview, selected])

  const listBody = (): JSX.Element => {
    if (items === null && listError === '') return <div className={css.status}>正在读取清单…</div>
    if (listError !== '') return <div className={`${css.status} ${css.statusError}`}>{listError}</div>
    if (items === null || items.length === 0) return <div className={css.status}>此会话还没有产物。</div>
    return (
      <>
        {items.map(item => (
          <button
            key={item.path}
            type="button"
            className={css.item}
            data-active={item.path === selected || undefined}
            title={item.path}
            onClick={() => { setSelected(item.path) }}
          >
            <span className={css.itemTop}>
              <span className={css.itemName}>{basenameOf(item.path)}</span>
              <span
                role="button"
                tabIndex={-1}
                className={css.itemOpen}
                aria-label={`用文件浏览器打开 ${basenameOf(item.path)}`}
                title="用文件浏览器打开"
                onClick={(event) => {
                  event.stopPropagation()
                  window.dispatchEvent(new CustomEvent(FILE_EXPLORER_OPEN_PATH_EVENT, { detail: { path: item.path } }))
                }}
              >
                <FolderIcon />
              </span>
            </span>
            <span className={css.itemTime}>{fmtTime(item.time)}</span>
          </button>
        ))}
      </>
    )
  }

  const viewBody = (): JSX.Element => {
    switch (preview.kind) {
      case 'empty':
        return <div className={css.status}>左侧选择一个文件查看内容。</div>
      case 'loading':
        return <div className={css.status}>正在读取…</div>
      case 'error':
        return <div className={`${css.status} ${css.statusError}`}>{preview.message}</div>
      case 'image':
        return (
          <div className={css.imageStage}>
            <img
              key={selected}
              className={css.imageEl}
              src={selected === null ? undefined : deliverableRawUrl(sid, selected)}
              alt={selected === null ? '' : basenameOf(selected)}
              draggable={false}
            />
          </div>
        )
      case 'hex':
        return (
          <>
            <div className={css.status}>
              二进制文件 · 十六进制预览（前 4 KB） · {formatBytes(preview.size)}{preview.truncated ? ' · 仅头部' : ''}
            </div>
            <pre className={css.hexDump}>{preview.dump}</pre>
          </>
        )
      case 'text':
        return isMarkdownPath(selected ?? '')
          ? <div className={css.mdBody}><MarkstreamMarkdown text={preview.content} streaming={false} /></div>
          : <div className={css.textHost} ref={hostRef} />
      default:
        return <div className={css.status}>正在读取…</div>
    }
  }

  // 注意：不在此处按 open 卸载——FeModal 自管开合（含退出动画）。
  return (
    <FeModal
      open={open}
      onClose={onClose}
      closeLabel="关闭"
      title={`产物 · ${items?.length ?? 0} 个文件`}
      width="min(1120px, 94vw)"
      maximizable
      footer={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <span className={css.footPath} title={selected ?? undefined}>{selected ?? ''}</span>
          {selected !== null && <a className={css.footLink} href={deliverableRawUrl(sid, selected, true)} download>下载</a>}
        </div>
      )}
    >
      <div className={css.split}>
        <aside className={css.listPane}>{listBody()}</aside>
        <section className={css.view}>
          <div className={css.viewInner}>{viewBody()}</div>
          <div className={css.viewPath} title={selected ?? undefined}>{selected ?? ''}</div>
        </section>
      </div>
    </FeModal>
  )
}

/** 文件夹图标：列表项的「用文件浏览器打开」入口。 */
function FolderIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.9 4.3c0-.66.54-1.2 1.2-1.2h2.8l1.5 1.5h5.5c.66 0 1.2.54 1.2 1.2v6c0 .66-.54 1.2-1.2 1.2H3.1a1.2 1.2 0 0 1-1.2-1.2V4.3z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}
