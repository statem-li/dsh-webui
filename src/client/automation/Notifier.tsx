/**
 * automation — 全局完成通知（shell.overlay 常驻插槽）。
 *
 * 对应 openhanako 的「定时任务执行完毕/失败」桌面通知：低频轮询 host 事件流，
 * 出现新的 success/error 完成事件时在页面顶部弹 toast（点击消失，5s 自动收）。
 */

import { useEffect, useRef, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { getEvents } from './api.ts'
import type { AutomationEvent } from './types.ts'
import { t } from './locales.ts'

const POLL_MS = 30_000
const TOAST_STAY_MS = 5000

export function AutomationNotifier(): JSX.Element | null {
  const [toast, setToast] = useState<{ key: number, event: AutomationEvent } | null>(null)
  const cursorRef = useRef(0)
  const seqRef = useRef(0)
  // 面板打开的会话里已经看到过的事件不再弹（由 App 通过 localStorage 游标对齐）。
  const suppressBefore = useRef<number>(Date.now())

  useEffect(() => {
    try {
      const stored = Number.parseInt(localStorage.getItem(CURSOR_KEY) ?? '0', 10) || 0
      cursorRef.current = stored
      // 首次挂载：只关心「从现在起」的事件；把游标快进到当前。
      void getEvents(stored).then(data => {
        cursorRef.current = data.cursor
        localStorage.setItem(CURSOR_KEY, String(data.cursor))
      }).catch(() => {})
    } catch { /* ignore */ }

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const data = await getEvents(cursorRef.current)
          cursorRef.current = data.cursor
          try {
            localStorage.setItem(CURSOR_KEY, String(data.cursor))
          } catch { /* ignore */ }
          const fresh = data.events.filter(event =>
            event.status !== 'skipped' && event.at >= suppressBefore.current)
          if (fresh.length === 0) return
          const latest = fresh[fresh.length - 1]
          seqRef.current += 1
          setToast({ key: seqRef.current, event: latest })
        } catch { /* 服务不可达：静默 */ }
      })()
    }, POLL_MS)

    return () => { window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (toast === null) return undefined
    const timer = window.setTimeout(() => setToast(null), TOAST_STAY_MS)
    return () => { window.clearTimeout(timer) }
  }, [toast])

  if (toast === null) return null
  return (
    <div className="auto-toast" role="status" onClick={() => setToast(null)}>
      <span>{toast.event.status === 'error' ? t('notifyFailed', { label: toast.event.jobLabel }) : t('notifyDone', { label: toast.event.jobLabel })}</span>
    </div>
  )
}

/** 注册全局通知（shell.overlay 常驻插槽）。 */
export function applyAutomationNotifier(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'automation-notifier',
    order: 90,
  }, AutomationNotifier))
}

const CURSOR_KEY = 'dsh-webui.automation.events.cursor'
