/**
 * dsh-file-explorer — 图片查看器：经 /api/file-explorer/raw 直读字节流，
 * 支持适应窗口/自由缩放/下载，复用 FeModal 的中心蔓延开合动效。
 */

import { useEffect, useState } from 'react'
import { rawFileUrl } from './api.ts'
import { FeModal } from './FeModal.tsx'
import type { FileExplorerLocaleKey } from './locales.ts'
import { css } from './styles.ts'

type T = (key: FileExplorerLocaleKey) => string

/** 缩放步进与上下限。 */
const ZOOM_STEP = 1.25
const ZOOM_MIN = 0.1
const ZOOM_MAX = 8

interface ImageViewerProps {
  open: boolean
  path: string
  /** raw 字节流来源；缺省走 file-explorer（产物场景传 deliverableSource.rawUrl）。 */
  rawUrl?: (path: string, download?: boolean) => string
  onClose: () => void
  t: T
}

export function ImageViewer({ open, path, rawUrl, onClose, t }: ImageViewerProps): JSX.Element {
  const rawOf = rawUrl ?? rawFileUrl
  const [failed, setFailed] = useState(false)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  /** 'fit' = 适应窗口；数字 = 相对原始尺寸的倍率。 */
  const [zoom, setZoom] = useState<number | 'fit'>('fit')

  useEffect(() => {
    if (!open) return
    setFailed(false)
    setNatural(null)
    setZoom('fit')
  }, [open, path])

  const stepZoom = (factor: number): void => {
    setZoom(prev => {
      const base = prev === 'fit' ? (natural !== null && natural.width > 0 ? 1 : 0.5) : prev
      return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, base * factor))
    })
  }

  const name = path.split(/[\\/]/).pop() ?? path

  const toolbar = (
    <div className={css.viewerToolbar}>
      <button type="button" className={css.viewerButton} onClick={() => { stepZoom(1 / ZOOM_STEP) }}>{t('zoomOut')}</button>
      <span className={css.viewerZoomLabel}>
        {zoom === 'fit' ? t('zoomReset') : `${Math.round(zoom * 100)}%`}
      </span>
      <button type="button" className={css.viewerButton} onClick={() => { stepZoom(ZOOM_STEP) }}>{t('zoomIn')}</button>
      <button type="button" className={css.viewerButton} onClick={() => { setZoom('fit') }}>{t('zoomReset')}</button>
      <span style={{ flex: 1 }} />
      <a className={css.viewerButton} href={rawOf(path, true)} download>{t('download')}</a>
    </div>
  )

  return (
    <FeModal
      open={open}
      onClose={onClose}
      closeLabel={t('close')}
      title={`${t('viewTitle')} · ${name}`}
      className={css.viewerModal}
      maximizable
      footer={toolbar}
    >
      <div className={css.viewerStage}>
        {failed
          ? <div className={css.statusError}>{t('imageError')}</div>
          : (
            <img
              key={path}
              className={css.viewerImg}
              src={rawOf(path)}
              alt={name}
              draggable={false}
              style={zoom === 'fit' || natural === null ? undefined : {
                maxWidth: 'none',
                maxHeight: 'none',
                width: Math.round(natural.width * zoom),
              }}
              onLoad={(event) => {
                const image = event.currentTarget
                setNatural({ width: image.naturalWidth, height: image.naturalHeight })
              }}
              onError={() => { setFailed(true) }}
            />
          )}
      </div>
    </FeModal>
  )
}
