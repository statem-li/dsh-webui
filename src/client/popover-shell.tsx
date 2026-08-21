/**
 * popover-shell — 「从入口右侧滑出」的卡片外壳（用量工作台/技能面板/记忆面板共用）。
 *
 * 与 automation 一级卡片（AutomationCard）同款行为：
 *  - popover 模式：贴锚点（入口按钮右缘）弹出，从左向右滑入
 *    （translateX(-14px)→0，automation auto-pop-in 同款），关闭反向收回；
 *    宽度/高度夹在视口内不越界；
 *  - 锚点缺失或视口过窄时回退底部 sheet（translateY(24px) 上滑，同 auto-sheet-in）；
 *  - 遮罩淡入淡出，点击遮罩 / Esc 关闭；Esc 走 props.onClose（面板可自行拦截）。
 *
 * z 层级：mask 999 / card 1000——与 ui-primitives Modal 的 root(1000) 同层，
 * 面板内部的 primitives 二级弹窗（如技能文件查看器）portal 到 body 更靠后，
 * DOM 顺序取胜浮于本壳之上。
 */

import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { MODAL_ANIM_MS, modalSideAnimClass } from './modal-animation.js'

const STYLE_ID = 'dsh-popover-shell-styles'

/** popover 回退阈值：锚点右侧可用宽度低于该值改用底部 sheet。 */
const POPOVER_MIN_SPACE = 520

const SHEET = `
/* ── 遮罩：淡入淡出 ── */
.psh-mask{position:fixed;inset:0;z-index:999;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45))}
.psh-mask[data-anim='in']{animation:dsh-modal-mask-in ${MODAL_ANIM_MS}ms ease both}
.psh-mask[data-anim='out']{animation:dsh-modal-mask-out ${MODAL_ANIM_MS}ms ease both}
/* ── 卡片：贴锚点右侧滑出 / 底部 sheet 回退 ── */
.psh-card{position:fixed;z-index:1000;display:flex;flex-direction:column;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden}
.psh-card[data-mode='popover'][data-anim='in']{animation:dsh-modal-side-in ${MODAL_ANIM_MS}ms cubic-bezier(.2,.8,.2,1) both}
.psh-card[data-mode='popover'][data-anim='out']{animation:dsh-modal-side-out ${MODAL_ANIM_MS}ms cubic-bezier(.4,0,.2,1) both}
.psh-card[data-mode='sheet']{left:12px !important;right:12px;bottom:12px;top:auto !important}
.psh-card[data-mode='sheet'][data-anim='in']{animation:dsh-modal-slide-in ${MODAL_ANIM_MS}ms cubic-bezier(.2,.8,.2,1) both}
.psh-card[data-mode='sheet'][data-anim='out']{animation:dsh-modal-slide-out ${MODAL_ANIM_MS}ms cubic-bezier(.4,0,.2,1) both}
/* ── 通用卡片头部：标题 + 关闭（对齐 auto-card-head 规格）── */
.psh-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.psh-title{flex:1;min-width:0;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary,#eee)}
.psh-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.psh-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
/* 卡片主体滚动区 */
.psh-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
@media (prefers-reduced-motion:reduce){
  .psh-mask,.psh-card{animation:none!important}
}
`

/** 注入外壳样式（幂等）。 */
export function ensureShellStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 锚点：入口按钮右缘 + 顶缘的视口坐标（getBoundingClientRect 系）。 */
export interface PopoverAnchor {
  left: number
  top: number
}

/** PopoverShell 属性。 */
export interface PopoverShellProps {
  /** 正在播放收回动画（此时仍挂载，播 out 动画）。 */
  closing: boolean
  /** 请求关闭（遮罩点击 / Esc / 关闭钮统一走这里）。 */
  onClose: () => void
  /** 入口锚点；null 或右侧空间不足时回退底部 sheet。 */
  anchor: PopoverAnchor | null
  /** 理想宽度（px），实际夹紧为 min(width, 视口右缘余量)。 */
  width?: number
  /** 无障碍名（role=dialog 的 aria-label）。 */
  ariaLabel: string
  children: ReactNode
}

/** 渲染「右侧滑出」卡片（含遮罩）。内容自带头部时无需再用 PshHead。 */
export function PopoverShell({
  closing, onClose, anchor, width = 560, ariaLabel, children,
}: PopoverShellProps): JSX.Element {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const asPopover = anchor !== null && (vw - anchor.left) >= Math.min(POPOVER_MIN_SPACE, width)
  let style: CSSProperties | undefined
  if (anchor !== null && asPopover) {
    // 定位：left=按钮右缘+8；top 与按钮对齐但夹在视口内；宽高不越界。
    const left = Math.round(anchor.left)
    const top = Math.max(8, Math.min(Math.round(anchor.top), vh - 200))
    style = {
      left,
      top,
      maxHeight: `${vh - top - 12}px`,
      width: `${Math.min(width, vw - left - 12)}px`,
    }
  }
  const anim = closing ? 'out' : 'in'
  const mode = asPopover ? 'popover' : 'sheet'

  useEffect(() => {
    if (closing) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [closing, onClose])

  return (
    <>
      <div className="psh-mask" data-anim={anim} aria-hidden="true" onClick={onClose} />
      <div
        className={`psh-card ${modalSideAnimClass(closing)}`}
        data-anim={anim}
        data-mode={mode}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </>
  )
}

/** 卡片头部属性。 */
export interface PshHeadProps {
  title: string
  closeLabel: string
  onClose: () => void
}

/** 通用卡片头部（标题 + 关闭钮）。 */
export function PshHead({ title, closeLabel, onClose }: PshHeadProps): JSX.Element {
  return (
    <div className="psh-head">
      <span className="psh-title">{title}</span>
      <button type="button" className="psh-close" aria-label={closeLabel} onClick={onClose}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

/** 卡片主体滚动容器（flex:1 + overflow hidden，内部面板自行滚动）。 */
export function PshBody({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={className !== undefined && className !== '' ? `psh-body ${className}` : 'psh-body'}>{children}</div>
}
