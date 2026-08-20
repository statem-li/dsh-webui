/**
 * dsh-image-gallery — 生图画廊渲染组件。
 *
 * 将一次会话中 generate_image 的成功结果渲染为并排缩略图：
 *   - 单击缩略图打开原图 Lightbox（Esc / 点击遮罩关闭）；
 *   - Lightbox 右上角「保存图片」按钮：优先弹系统「另存为」对话框
 *     （showSaveFilePicker，位置和文件名由用户自选）；不支持该 API 的
 *     浏览器自动降级为普通下载（浏览器默认下载目录）；
 *   - 链接失效（生图链接仅 24 小时有效）时显示占位提示。
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { css } from './styles'

type GalleryViewProps =
  PropsRuntime<'conversation.chat.node', 'generated-images'>
  & PropsLocale<'gallery'>

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

export function GeneratedImageGallery({ node, t }: GalleryViewProps) {
  const images = node.data.images
  const isScreenshot = node.data.toolName === 'browser_screenshot'
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

  return (
    <div className={css.gallery}>
      <div className={css.head}>{isScreenshot ? t('gig.headScreenshot', { n: images.length }) : t('gig.head', { n: images.length })}</div>
      <div className={css.row}>
        {images.map((image, index) => (
          <button
            type="button"
            key={`${image.callId}:${index}`}
            className={css.item}
            onClick={() => { setOpenIndex(index); setSaveState('idle') }}
            title={t('gig.thumbTitle')}
          >
            <img
              src={image.url}
              alt={`${t('gig.head', { n: images.length })} ${index + 1}`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              draggable={false}
              className={css.thumb}
              onError={() => setBroken(prev => new Set(prev).add(index))}
            />
            <span className={css.badge}>{index + 1}</span>
          </button>
        ))}
      </div>
      {open !== undefined && (
        <div
          className={css.backdrop}
          role="dialog"
          aria-modal="true"
          aria-label={t('gig.lightboxAria')}
          onClick={() => setOpenIndex(null)}
        >
          <div className={css.stage} onClick={event => event.stopPropagation()}>
            <button
              type="button"
              className={css.saveButton}
              onClick={event => { event.stopPropagation(); void onSave() }}
              disabled={saveState === 'saving'}
              aria-label={t('gig.save')}
            >
              <svg className={css.saveIcon} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M8 1v8m0 0L4.5 5.5M8 9l3.5-3.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2.5 11.5v2h11v-2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
              </svg>
              <span>
                {saveState === 'idle' && t('gig.save')}
                {saveState === 'saving' && t('gig.saving')}
                {saveState === 'saved' && t('gig.saved')}
                {saveState === 'failed' && t('gig.saveFailed')}
              </span>
            </button>
            {broken.has(openIndex as number) ? (
              <div className={css.broken}>{t('gig.broken')}</div>
            ) : (
              <img
                src={open.url}
                alt={`${t('gig.lightboxAria')} ${(openIndex as number) + 1}`}
                className={css.full}
                onError={() => setBroken(prev => new Set(prev).add(openIndex as number))}
              />
            )}
            <div className={css.metaLine}>
              <span>#{(openIndex as number) + 1}</span>
              {open.model !== null && <span className={css.model}>{open.model}</span>}
            </div>
            <div className={css.hintLine}>{t('gig.hint')}</div>
          </div>
        </div>
      )}
    </div>
  )
}