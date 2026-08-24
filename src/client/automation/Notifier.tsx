/**
 * automation — 全局完成通知（shell.overlay 常驻插槽）。
 *
 * 低频轮询 host 事件流，出现新的 success/error 完成事件时在页面顶部弹 toast
 * （点击消失，5s 自动收）。同一轮出现多条时只弹最后一条并标出条数。
 *
 * 游标契约：host 的事件环是内存态，服务重启后 seq 从 0 重新计数。因此本地
 * 缓存的游标若大于服务端 cursor，必须回落到服务端值——否则会一直
 * 「since=旧的大数」，新事件永远筛不出来，通知彻底静默（原实现的坑）。
 */

import { useEffect, useRef, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { getEvents } from './api.ts'
import type { AutomationEvent } from './types.ts'
import { ensureAutomationStyles } from './styles.ts'
import { t } from './locales.ts'

const POLL_MS = 10_000
const TOAST_STAY_MS = 5000
const CURSOR_KEY = 'dsh-webui.automation.events.cursor'

function readCursor(): number {
  try {
    return Number.parseInt(localStorage.getItem(CURSOR_KEY) ?? '0', 10) || 0
  } catch {
    return 0
  }
}

function writeCursor(value: number): void {
  try {
    localStorage.setItem(CURSOR_KEY, String(value))
  } catch { /* ignore */ }
}

export function AutomationNotifier(): JSX.Element | null {
  const [toast, setToast] = useState<{ key: number, event: AutomationEvent, more: number } | null>(null)
  const cursorRef = useRef(0)
  const seqRef = useRef(0)
  /** 挂载时刻：只关心「从现在起」发生的事件。 */
  const suppressBefore = useRef<number>(Date.now())

  useEffect(() => {
    ensureAutomationStyles()
    let alive = true

    const poll = async (initial: boolean): Promise<void> => {
      try {
        const data = await getEvents(cursorRef.current)
        if (!alive) return
        // 服务端重启 → cursor 变小；本地游标必须跟着回落。
        if (data.cursor < cursorRef.current) cursorRef.current = 0
        else cursorRef.current = data.cursor
        writeCursor(cursorRef.current)
        if (initial) return
        const fresh = data.events.filter(event =>
          event.status !== 'skipped' && event.at >= suppressBefore.current)
        if (fresh.length === 0) return
        seqRef.current += 1
        setToast({ key: seqRef.current, event: fresh[fresh.length - 1], more: fresh.length - 1 })
      } catch { /* 服务不可达：静默 */ }
    }

    cursorRef.current = readCursor()
    void poll(true)
    const timer = window.setInterval(() => { void poll(false) }, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (toast === null) return undefined
    const timer = window.setTimeout(() => setToast(null), TOAST_STAY_MS)
    return () => { window.clearTimeout(timer) }
  }, [toast])

  if (toast === null) return null
  const failed = toast.event.status === 'error'
  return (
    <div className="auto-toast" role="status" data-tone={failed ? 'error' : 'info'} onClick={() => setToast(null)}>
      <span className="auto-toast-dot" />
      <span>
        {t(failed ? 'notifyFailed' : 'notifyDone', { label: toast.event.jobLabel })}
        {toast.more > 0 ? ` +${toast.more}` : ''}
      </span>
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
