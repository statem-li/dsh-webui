/**
 * 交互提醒：有工具调用等待审批 / 有提问等待回答时，在页面顶部弹出提示（toast）并播放提示音。
 * 通过 useSessions 监听各会话的 pendingInteraction（approval / question），
 * 新出现的交互弹一次提示 + 播一次音，交互解决后允许再次提醒。
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

export type ApprovalNotifierProps = PropsRuntime<'shell.overlay'>

/** 提示自动消失时长（ms）。 */
const TOAST_MS = 6000

type InteractionKind = 'approval' | 'question'

interface ToastState {
  kind: InteractionKind
  title: string
  count: number
}

/** 播放提示音：优先 host 端 PowerShell 播放（绕开 autoplay）；失败时浏览器端 Audio 兜底。 */
function playSound(): void {
  fetch('/api/task-done-sound/play', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).catch(() => {
    try {
      const audio = new Audio('/dyn-assets/task-done.wav')
      audio.volume = 1
      const p = audio.play()
      if (p !== undefined && typeof p.catch === 'function') p.catch(() => { /* autoplay 拦截忽略 */ })
    } catch { /* 忽略 */ }
  })
}

const toastStyle: CSSProperties = {
  position: 'fixed',
  top: 56,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 9000,
  minWidth: 240,
  maxWidth: 420,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))',
  background: 'var(--dsw-alias-bg-overlay, #1c1f26)',
  boxShadow: '0 12px 32px rgba(0,0,0,.35)',
  color: 'var(--dsw-alias-label-primary, #eee)',
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
}

const titleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontWeight: 600,
  color: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
}

const dotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
}

function kindTitle(kind: InteractionKind): string {
  return kind === 'approval' ? '审批提醒' : '提问提醒'
}

function kindBody(kind: InteractionKind): string {
  return kind === 'approval' ? '有工具调用等待审批' : '有提问等待回答'
}

/** 有审批/提问待处理时顶部弹提示 + 播提示音；点击可关闭。 */
export function ApprovalNotifier({ useSessions }: ApprovalNotifierProps): JSX.Element | null {
  const byId = useSessions(state => state.byId)
  const [toast, setToast] = useState<ToastState | null>(null)
  const notifiedRef = useRef<Set<string>>(new Set())
  const timerRef = useRef<number | null>(null)

  const pendingEntries = useMemo(() => (
    Object.values(byId).filter(session => session.pendingInteraction === 'approval' || session.pendingInteraction === 'question')
  ), [byId])

  useEffect(() => {
    const pendingKeys = pendingEntries.map(session => `${String(session.id)}:${session.pendingInteraction}`)
    // 已解决（不再待处理）的交互移出 notified，允许下次再次提醒。
    for (const key of [...notifiedRef.current]) {
      if (!pendingKeys.includes(key)) notifiedRef.current.delete(key)
    }
    const fresh = pendingEntries.filter(session => {
      const key = `${String(session.id)}:${session.pendingInteraction}`
      return !notifiedRef.current.has(key)
    })
    if (fresh.length === 0) return
    for (const session of fresh) notifiedRef.current.add(`${String(session.id)}:${session.pendingInteraction}`)
    const firstKind = fresh[0].pendingInteraction === 'question' ? 'question' as const : 'approval' as const
    setToast({
      kind: firstKind,
      title: fresh[0].displayTitle,
      count: fresh.length,
    })
    playSound()
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { setToast(null) }, TOAST_MS)
  }, [pendingEntries])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  if (toast === null) return null
  return createPortal(
    <div style={toastStyle} role="status" onClick={() => { setToast(null) }}>
      <span style={titleStyle}>
        <span style={dotStyle} aria-hidden />
        {kindTitle(toast.kind)}
      </span>
      <span>
        「{toast.title}」{toast.count > 1 ? ` 等 ${toast.count} 个会话` : ''} {kindBody(toast.kind)}
      </span>
    </div>,
    document.body,
  )
}
