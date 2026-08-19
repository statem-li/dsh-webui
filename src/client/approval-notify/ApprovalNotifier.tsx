/**
 * 审批提醒：有工具调用等待审批时，在页面顶部弹出提示（toast）。
 * 通过 useSessions 监听各会话的 pendingInteraction==='approval'，
 * 新出现的审批弹一次提示，审批解决后允许再次提醒。
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

export type ApprovalNotifierProps = PropsRuntime<'shell.overlay'>

/** 提示自动消失时长（ms）。 */
const TOAST_MS = 6000

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

/** 有审批待处理时顶部弹提示；点击可关闭。 */
export function ApprovalNotifier({ useSessions }: ApprovalNotifierProps): JSX.Element | null {
  const byId = useSessions(state => state.byId)
  const [toast, setToast] = useState<{ title: string; count: number } | null>(null)
  const notifiedRef = useRef<Set<string>>(new Set())
  const timerRef = useRef<number | null>(null)

  const approvalEntries = useMemo(() => (
    Object.values(byId).filter(session => session.pendingInteraction === 'approval')
  ), [byId])

  useEffect(() => {
    const pendingIds = approvalEntries.map(session => String(session.id))
    // 已解决（不再待审批）的会话移出 notified，允许下次再次提醒。
    for (const id of [...notifiedRef.current]) {
      if (!pendingIds.includes(id)) notifiedRef.current.delete(id)
    }
    const fresh = approvalEntries.filter(session => !notifiedRef.current.has(String(session.id)))
    if (fresh.length === 0) return
    for (const session of fresh) notifiedRef.current.add(String(session.id))
    setToast({
      title: fresh[0].displayTitle,
      count: fresh.length,
    })
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { setToast(null) }, TOAST_MS)
  }, [approvalEntries])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  if (toast === null) return null
  return createPortal(
    <div style={toastStyle} role="status" onClick={() => { setToast(null) }}>
      <span style={titleStyle}>
        <span style={dotStyle} aria-hidden />
        审批提醒
      </span>
      <span>
        「{toast.title}」{toast.count > 1 ? ` 等 ${toast.count} 个会话` : ''} 有工具调用等待审批
      </span>
    </div>,
    document.body,
  )
}
