/**
 * dsh-file-explorer — 轻量受控弹窗：portal 到 body（避开宿主层叠上下文），
 * 打开时卡片从中心点 scale 放大蔓延出现、关闭时向中心缩小消失，
 * 遮罩同步淡入淡出。官方 Modal 无动效，故自建；样式见 styles.ts 的 fe-modal-*。
 * maximizable 时标题栏出现「最大化/还原」钮：铺满近全屏（98vw × 96vh），
 * 内容区随 dialog 拉伸（见 styles.ts 的 data-maximized 规则）。
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
  /** 卡片宽度（css width 值）；最大化时被近全屏尺寸取代。 */
  width?: string
  footer?: ReactNode
  className?: string
  /** 显示标题栏「最大化/还原」按钮（内部自管状态，每次打开复位）。 */
  maximizable?: boolean
  /** 外部强制最大化态（如历史视图自动全屏）：值变化即覆盖；undefined 不干预。 */
  forceMaximized?: boolean
  children: ReactNode
}

/** 最大化/还原角标图标。 */
function MaximizeIcon({ restore, size = 14 }: { restore?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      {restore ? (
        <path
          d="M6.5 2v4.5H2M9.5 2v4.5H14M6.5 14V9.5H2M9.5 14V9.5h4.5"
          stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
        />
      ) : (
        <path
          d="M2 5.8V2h3.8M14 5.8V2h-3.8M2 10.2V14h3.8M14 10.2V14h-3.8"
          stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

export function FeModal({ open, onClose, title, closeLabel = 'Close', width, footer, className, maximizable, forceMaximized, children }: FeModalProps): JSX.Element | null {
  const [visible, setVisible] = useState(open)
  const closing = !open && visible
  const [maximized, setMaximized] = useState(false)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  // open → true：立即渲染并播放入场动画；最大化态复位（每次打开从常规尺寸起）。
  useEffect(() => {
    if (open) {
      setVisible(true)
      setMaximized(false)
    }
  }, [open])

  // 外部强制最大化（如「历史」视图要求自动全屏）：值变化即覆盖手动状态；
  // undefined 表示不干预，用户仍可随时用标题栏按钮切换。
  useEffect(() => {
    if (forceMaximized === undefined) return
    setMaximized(forceMaximized)
  }, [forceMaximized])

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

  const isMax = maximizable === true && maximized
  // 最大化走 inline 尺寸覆盖 width prop；max-height/body flex 由 data 属性规则接管。
  const sizeStyle = isMax ? { width: '98vw', height: '96vh' } : (width !== undefined ? { width } : undefined)

  // ⚠ 类名避开 "modal"/"panel"/"drawer" 子串：玻璃主题的浮层总选择器按子串
  // 匹配会给每个命中元素加 backdrop-filter+高光投影，root/mask/header 等
  // 结构层被误伤会叠出「多层卡片」；dialog 本体虽保留 modal 词，但同时声明
  // data-solid 实底豁免——文件浏览器全程禁用玻璃/模糊（见 styles.ts 末段）。
  return createPortal(
    <div className={closing ? 'fe-pop-root fe-pop-closing' : 'fe-pop-root'}>
      <div className="fe-pop-mask" aria-hidden="true" onClick={onClose} />
      <div
        className={className !== undefined ? `fe-modal-dialog ${className}` : 'fe-modal-dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-solid=""
        data-maximized={isMax || undefined}
        style={sizeStyle}
      >
        <div className="fe-pop-head">
          <h2 className="fe-pop-title">{title}</h2>
          <span className="fe-pop-head-actions">
            {maximizable === true && (
              <button
                type="button"
                className="fe-pop-close"
                aria-label={isMax ? '还原' : '最大化'}
                title={isMax ? '还原' : '最大化'}
                onClick={() => { setMaximized(value => !value) }}
              >
                <MaximizeIcon restore={isMax} />
              </button>
            )}
            <button type="button" className="fe-pop-close" aria-label={closeLabel} onClick={onClose}>
              <IconCloseOutline16 size={14} />
            </button>
          </span>
        </div>
        <div className="fe-pop-body">{children}</div>
        {footer !== undefined && <div className="fe-pop-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
