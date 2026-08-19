/**
 * 弹窗开合动画（用量工作台 / 技能面板 / 记忆面板共用）：
 * - 弹出：fade + 轻微上移 + 缩放进入（mount 时播放）。
 * - 收回：fade + 轻微下移 + 缩放退出（closing 阶段播放，结束后再卸载）。
 *
 * 用法：入口组件用 useModalClose 持有 closing 态，把 closing 传给弹窗，
 * 弹窗把 closing 映射成 pop-out class（卡片）与 mask 的淡出 class。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** 动画时长（ms），CSS 与 hook 计时保持一致。 */
export const MODAL_ANIM_MS = 180

const STYLE_ID = 'dsh-modal-animation-styles'

const SHEET = `
@keyframes dsh-modal-pop-in {
  from { opacity: 0; transform: translateY(14px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes dsh-modal-pop-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(10px) scale(0.97); }
}
@keyframes dsh-modal-mask-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes dsh-modal-mask-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
.dsh-modal-pop-in { animation: dsh-modal-pop-in ${MODAL_ANIM_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.dsh-modal-pop-out { animation: dsh-modal-pop-out ${MODAL_ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards; }
.dsh-modal-mask-in { animation: dsh-modal-mask-in ${MODAL_ANIM_MS}ms ease; }
.dsh-modal-mask-out { animation: dsh-modal-mask-out ${MODAL_ANIM_MS}ms ease forwards; }
@media (prefers-reduced-motion: reduce) {
  .dsh-modal-pop-in, .dsh-modal-pop-out, .dsh-modal-mask-in, .dsh-modal-mask-out { animation: none; }
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

/** 卡片动画 class（open 阶段 pop-in，closing 阶段 pop-out）。 */
export function modalAnimClass(closing: boolean): string {
  return closing ? 'dsh-modal-pop-out' : 'dsh-modal-pop-in'
}

/** 遮罩动画 class（自定义弹窗才有遮罩，如用量工作台）。 */
export function modalMaskAnimClass(closing: boolean): string {
  return closing ? 'dsh-modal-mask-out' : 'dsh-modal-mask-in'
}

/** 弹窗关闭动画状态机：先置 closing 播放收回动画，结束后再真正 onClose。 */
export function useModalClose(onClose: () => void, durationMs = MODAL_ANIM_MS): { closing: boolean; requestClose: () => void } {
  const [closing, setClosing] = useState(false)
  const timerRef = useRef<number | null>(null)

  const requestClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    timerRef.current = window.setTimeout(() => {
      onClose()
    }, durationMs)
  }, [closing, onClose, durationMs])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  return { closing, requestClose }
}
