/**
 * 弹窗开合动画（用量工作台 / 技能面板 / 记忆面板共用）——对齐「自动化」卡片的滑入滑出手感：
 * - 弹出：fade + 自底部 24px 上滑进入（无缩放；automation sheet-in 同款位移与曲线），mount 时播放。
 * - 收回：fade + 下滑 24px 退出（automation sheet-out 同款反向曲线），closing 阶段播放，结束后再卸载。
 * - 内容：`.dsh-modal-stagger` 容器在卡片滑入后 60ms 轻微上浮跟进（automation 内部区块同款
 *   rise-in），关闭时动画自动解除、随卡片整体收回渐隐。
 *
 * 用法：入口组件用 useModalClose 持有 closing 态，把 closing 传给弹窗，
 * 弹窗把 closing 映射成 slide-out class（卡片）与 mask 的淡出 class；
 * 需要内容错落感的面板在内容根容器上加 `dsh-modal-stagger` 即可。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 动画时长（ms），CSS 与 hook 计时保持一致（与 automation 的 AUTO_ANIM_MS 同值）。 */
export const MODAL_ANIM_MS = 240

const STYLE_ID = 'dsh-modal-animation-styles'

const SHEET = `
@keyframes dsh-modal-slide-in {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dsh-modal-slide-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(24px); }
}
@keyframes dsh-modal-side-in {
  from { opacity: 0; transform: translateX(-14px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes dsh-modal-side-out {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(-10px); }
}
@keyframes dsh-modal-rise-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dsh-modal-mask-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes dsh-modal-mask-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
.dsh-modal-slide-in { animation: dsh-modal-slide-in ${MODAL_ANIM_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.dsh-modal-slide-out { animation: dsh-modal-slide-out ${MODAL_ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards; }
.dsh-modal-side-in { animation: dsh-modal-side-in ${MODAL_ANIM_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.dsh-modal-side-out { animation: dsh-modal-side-out ${MODAL_ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards; }
/* 内容错落：卡片播放滑入（底部上滑 / 右侧滑入均可）时生效，关闭时随卡片整体收回。
   fill-mode 必须用 backwards（延迟期应用 from 帧隐藏）而非 both——both 会在动画
   结束后残留 to 帧 transform（即使 translateY(0)），使该容器成为后代 position:fixed
   元素（图表 tooltip）的包含块，浮层整体偏移。 */
.dsh-modal-slide-in .dsh-modal-stagger,
.dsh-modal-side-in .dsh-modal-stagger {
  animation: dsh-modal-rise-in ${MODAL_ANIM_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  animation-delay: 60ms;
}
.dsh-modal-mask-in { animation: dsh-modal-mask-in ${MODAL_ANIM_MS}ms ease; }
.dsh-modal-mask-out { animation: dsh-modal-mask-out ${MODAL_ANIM_MS}ms ease forwards; }
@media (prefers-reduced-motion: reduce) {
  .dsh-modal-slide-in, .dsh-modal-slide-out, .dsh-modal-side-in, .dsh-modal-side-out,
  .dsh-modal-mask-in, .dsh-modal-mask-out { animation: none; }
  .dsh-modal-slide-in .dsh-modal-stagger, .dsh-modal-side-in .dsh-modal-stagger { animation: none; }
}
`

/** 注入弹窗动画样式（幂等）。 */
export function ensureModalAnimStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 卡片动画 class（open 阶段滑入，closing 阶段滑出）。 */
export function modalAnimClass(closing: boolean): string {
  return closing ? 'dsh-modal-slide-out' : 'dsh-modal-slide-in'
}

/** 卡片动画 class——右侧滑入变体（贴入口弹出的 popover 卡片用）。 */
export function modalSideAnimClass(closing: boolean): string {
  return closing ? 'dsh-modal-side-out' : 'dsh-modal-side-in'
}

/** 遮罩动画 class（自定义弹窗才有遮罩，如用量工作台）。 */
export function modalMaskAnimClass(closing: boolean): string {
  return closing ? 'dsh-modal-mask-out' : 'dsh-modal-mask-in'
}

/** 内容容器 class：卡片滑入后错落跟进（配合 modalAnimClass 使用）。 */
export const modalStaggerClass = 'dsh-modal-stagger'

/**
 * 弹窗关闭动画状态机：先置 closing 播放收回动画，结束后再真正 onClose。
 * `open` 由入口传入：弹窗再次打开时重置 closing（否则上一次收回动画会把
 * closing 卡在 true，重开后弹窗透明且遮罩挡住整页）。
 */
export function useModalClose(open: boolean, onClose: () => void, durationMs = MODAL_ANIM_MS): { closing: boolean; requestClose: () => void } {
  const [closing, setClosing] = useState(false)
  const timerRef = useRef<number | null>(null)
  const closingRef = useRef(false)

  // 打开（含重新打开）时重置关闭态：在绘制前同步复位，避免一帧透明闪现。
  useLayoutEffect(() => {
    if (open) {
      closingRef.current = false
      setClosing(false)
    }
  }, [open])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    timerRef.current = window.setTimeout(() => {
      onClose()
    }, durationMs)
  }, [onClose, durationMs])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  return { closing, requestClose }
}
