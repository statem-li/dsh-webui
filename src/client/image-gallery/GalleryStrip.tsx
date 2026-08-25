/**
 * dsh-image-gallery — 生图画廊通用视图（并排缩略图行 + 全屏 Lightbox）。
 *
 * 两个使用方：
 *  - GeneratedImageGallery：会话事件归并的画廊节点（locale 文案由 slots 注入）；
 *  - markdown 的 image_strip：回复正文里 ![]() 引用的生图 URL（注册表命中时画廊化），
 *    该路径拿不到 locale，缺省走 zh 文案。
 *
 * 展示规则与既有实现一致：多图弹性并排一行（放不下自动换行）、4:3 封面裁剪、
 * 左下角序号角标（仅多图）；单图保持原比例大图（≤360px）不显示角标；
 * 单击打开全屏 Lightbox（暗底居中 + 右上角保存 + Esc/点空白关闭，
 * createPortal 挂 body 规避祖先 backdrop-filter/transform 钉死 fixed 的坑）。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { css } from './styles'
import { zh } from './locales'

/** 一张可展示的图片（markdown 路径 model 恒为 null）。 */
export interface GalleryStripItem {
  readonly url: string
  readonly model: string | null
}

/** Lightbox / 缩略图文案（调用方注入；markdown 路径用 DEFAULT_GALLERY_LABELS）。 */
export interface GalleryStripLabels {
  readonly thumbTitle: string
  readonly hint: string
  readonly broken: string
  readonly lightboxAria: string
  readonly save: string
  readonly saving: string
  readonly saved: string
  readonly saveFailed: string
  /** 缩略图 alt 前缀（「生图结果 · N 张」），参数为张数。 */
  readonly head: (count: number) => string
}

/** zh 字典直出的缺省文案（markdown image_strip 使用）。 */
export const DEFAULT_GALLERY_LABELS: GalleryStripLabels = {
  thumbTitle: zh['gig.thumbTitle'],
  hint: zh['gig.hint'],
  broken: zh['gig.broken'],
  lightboxAria: zh['gig.lightboxAria'],
  save: zh['gig.save'],
  saving: zh['gig.saving'],
  saved: zh['gig.saved'],
  saveFailed: zh['gig.saveFailed'],
  head: count => zh['gig.head'].replace('{n}', String(count)),
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'canceled'

declare global {
  interface Window {
    /** File System Access API：弹系统「另存为」对话框（部分浏览器/上下文不支持）。 */
    showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle>
  }
}

/** 从远程 URL 提取文件名（含扩展名），兜底 gallery-N.png。 */
function filenameFrom(url: string, index: number): string {
  try {
    const last = new URL(url).pathname.split('/').pop() ?? ''
    if (/\.(png|jpe?g|webp|gif)$/i.test(last)) return last
  } catch {
    /* 非 URL 或解析失败，用兜底名 */
  }
  return `gallery-${index + 1}.png`
}

/** 普通下载（浏览器默认下载目录 / 下载栏）。失败返回 false。 */
async function downloadFallback(url: string, filename: string): Promise<boolean> {
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok) return false
    const blob = await response.blob()
    if (blob.size === 0) return false
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    return true
  } catch {
    return false
  }
}

/**
 * 保存图片：优先系统「另存为」对话框（用户自选位置/文件名）；
 * 对话框不可用（手势/权限异常、浏览器不支持）时自动降级为普通下载，
 * 保证任何环境下都能拿到图。
 *
 * 顺序关键：showSaveFilePicker 必须在用户点击手势的有效窗口内调用——
 * 先 await fetch 下载大图会耗尽手势窗口导致 SecurityError，所以先弹
 * 对话框拿到句柄，再取图写入用户所选的位置。
 */
async function saveImage(url: string, filename: string): Promise<SaveState> {
  if (typeof window.showSaveFilePicker === 'function') {
    let handle: FileSystemFileHandle
    try {
      handle = await window.showSaveFilePicker({ suggestedName: filename })
    } catch (error) {
      // 用户取消对话框（AbortError）不是失败
      if (error instanceof DOMException && error.name === 'AbortError') return 'canceled'
      // 手势/权限等异常 → 降级普通下载，不报失败
      return (await downloadFallback(url, filename)) ? 'saved' : 'failed'
    }
    try {
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) return (await downloadFallback(url, filename)) ? 'saved' : 'failed'
      const blob = await response.blob()
      if (blob.size === 0) return (await downloadFallback(url, filename)) ? 'saved' : 'failed'
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'saved'
    } catch {
      return (await downloadFallback(url, filename)) ? 'saved' : 'failed'
    }
  }

  // 不支持 showSaveFilePicker 的浏览器：直接普通下载
  return (await downloadFallback(url, filename)) ? 'saved' : 'failed'
}

export function GalleryStrip({ images, labels }: {
  images: readonly GalleryStripItem[]
  labels?: GalleryStripLabels
}) {
  const t = labels ?? DEFAULT_GALLERY_LABELS
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [broken, setBroken] = useState<ReadonlySet<number>>(new Set())
  const [saveState, setSaveState] = useState<SaveState>('idle')

  useEffect(() => {
    if (openIndex === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenIndex(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openIndex])

  const open = openIndex !== null ? images[openIndex] : undefined

  const onSave = async (): Promise<void> => {
    if (open === undefined || saveState === 'saving') return
    setSaveState('saving')
    const result = await saveImage(open.url, filenameFrom(open.url, openIndex as number))
    // 用户取消对话框 → 静默回到待保存状态
    setSaveState(result === 'canceled' ? 'idle' : result)
  }

  const markBroken = (index: number): void => {
    setBroken(prev => new Set(prev).add(index))
  }

  return (
    <div className={css.gallery}>
      <div className={css.row}>
        {images.map((image, index) => (
          <button
            type="button"
            key={`${image.url}:${index}`}
            className={css.item}
            onClick={() => { setOpenIndex(index); setSaveState('idle') }}
            title={t.thumbTitle}
          >
            <img
              src={image.url}
              alt={`${t.head(images.length)} ${index + 1}`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              draggable={false}
              className={css.thumb}
              onError={() => markBroken(index)}
            />
            {images.length > 1 && <span className={css.badge}>{index + 1}</span>}
          </button>
        ))}
      </div>
      {open !== undefined && createPortal(
        <div
          className={css.backdrop}
          role="dialog"
          aria-modal="true"
          aria-label={t.lightboxAria}
          onClick={() => setOpenIndex(null)}
        >
          <div className={css.stage} onClick={event => event.stopPropagation()}>
            <button
              type="button"
              className={css.saveButton}
              onClick={event => { event.stopPropagation(); void onSave() }}
              disabled={saveState === 'saving'}
              aria-label={t.save}
            >
              <svg className={css.saveIcon} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M8 1v8m0 0L4.5 5.5M8 9l3.5-3.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2.5 11.5v2h11v-2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
              </svg>
              <span>
                {saveState === 'idle' && t.save}
                {saveState === 'saving' && t.saving}
                {saveState === 'saved' && t.saved}
                {saveState === 'failed' && t.saveFailed}
              </span>
            </button>
            {broken.has(openIndex as number) ? (
              <div className={css.broken}>{t.broken}</div>
            ) : (
              <img
                src={open.url}
                alt={`${t.lightboxAria} ${(openIndex as number) + 1}`}
                className={css.full}
                onError={() => markBroken(openIndex as number)}
              />
            )}
            <div className={css.metaLine}>
              <span>#{(openIndex as number) + 1}</span>
              {open.model !== null && <span className={css.model}>{open.model}</span>}
            </div>
            <div className={css.hintLine}>{t.hint}</div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
