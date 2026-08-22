/**
 * dsh-file-explorer — 轻量受控弹窗：portal 到 body（避开宿主层叠上下文），
 * 打开时卡片从中心点 scale 放大蔓延出现、关闭时向中心缩小消失，
 * 遮罩同步淡入淡出。官方 Modal 无动效，故自建；样式见 styles.ts 的 fe-modal-*。
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** 退出动画时长（ms），需 ≥ styles.ts 中 fe-pop-out 的时长。 */
const EXIT_MS = 240

export interface FeModalProps {
  open: boolean
  /** 用户请求关闭（Esc/遮罩/关闭钮）；父级把 open 置 false 后播放退出动画。 */
  onClose: () => void
  title: string
  closeLabel?: string
  /** 卡片宽度（css width 值）。 */
  width?: string
  footer?: ReactNode
  className?: string
  children: ReactNode
}

export function FeModal({ open, onClose, title, closeLabel = 'Close', width, footer, className, children }: FeModalProps): JSX.Element | null {
  const [visible, setVisible] = useState(open)
  const closing = !open && visible
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  // open → true：立即渲染并播放入场动画。
  useEffect(() => {
    if (open) setVisible(true)
  }, [open])

  // open → false 且仍在渲染：播放退出动画，结束后真正卸载。
  useEffect(() => {
    if (open || !visible) return
    const timer = window.setTimeout(() => { setVisible(false) }, EXIT_MS)
    return () => { window.clearTimeout(timer) }
  }, [open, visible])

  // Esc 关闭（仅在完全打开时生效）。
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!visible) return null

  // ⚠ 类名避开 "modal"/"panel"/"drawer" 子串：玻璃主题的浮层总选择器按子串
  // 匹配会给每个命中元素加 backdrop-filter+高光投影，root/mask/header 等
  // 结构层被误伤会叠出「多层卡片」；只有 dialog 本体保留 modal 词以获得毛玻璃。
  return createPortal(
    <div className={closing ? 'fe-pop-root fe-pop-closing' : 'fe-pop-root'}>
      <div className="fe-pop-mask" aria-hidden="true" onClick={onClose} />
      <div
        className={className !== undefined ? `fe-modal-dialog ${className}` : 'fe-modal-dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width !== undefined ? { width } : undefined}
      >
        <div className="fe-pop-head">
          <h2 className="fe-pop-title">{title}</h2>
          <button type="button" className="fe-pop-close" aria-label={closeLabel} onClick={onClose}>
            <IconCloseOutline16 size={14} />
          </button>
        </div>
        <div className="fe-pop-body">{children}</div>
        {footer !== undefined && <div className="fe-pop-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
