/**
 * dsh-browser — 会话内浏览器常驻按钮 + 内嵌面板（client 半身）。
 *
 * 常驻按钮挂在 `conversation.input.left`（输入框工具行，记忆开关旁）：
 * 与记忆开关一样始终可见；当前会话有浏览器活动（engaged）时图标高亮并脉冲，
 * 点击展开内嵌面板，面板内实时显示浏览器画面（CDP screencast 帧，可直接鼠标/
 * 键盘/滚轮操作）+ 操作时间线（已发送指令 / 正在执行 / 结果，轮询 /session）。
 * 无活动时按钮置灰但仍在。
 */
import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { browserActivityStore } from './activity'

/** 浏览器图标（内联 globe，避免额外图标依赖）。 */
function GlobeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <ellipse cx="12" cy="12" rx="4" ry="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9h17M3.5 15h17" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** 全屏切换图标（展开 / 收缩四角）。 */
function FullscreenIcon({ size = 14, exiting = false }: { size?: number; exiting?: boolean }) {
  const d = exiting
    ? 'M9 4v3a2 2 0 0 1-2 2H4M15 4v3a2 2 0 0 0 2 2h3M9 20v-3a2 2 0 0 0-2-2H4M15 20v-3a2 2 0 0 1 2-2h3'
    : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface SessionStep {
  seq: number
  tool: string
  label: string
  detail: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  finishedAt: number | null
  result: string
}

interface SessionDetail {
  ok?: boolean
  sessionId?: string
  active?: boolean
  running?: boolean
  url?: string
  title?: string
  steps?: SessionStep[]
}

const STATUS_TEXT: Record<SessionStep['status'], string> = {
  running: '进行中',
  done: '完成',
  error: '失败',
}

function StepRow({ step }: { step: SessionStep }) {
  return (
    <div className={`dsh-browser-step dsh-browser-step--${step.status}`}>
      <div className="dsh-browser-step__row">
        <span className="dsh-browser-step__dot" aria-hidden />
        <span className="dsh-browser-step__label">{step.label || step.tool}</span>
        <span className="dsh-browser-step__status">{STATUS_TEXT[step.status]}</span>
      </div>
      {step.detail !== '' && <div className="dsh-browser-step__detail">{step.detail}</div>}
      {step.result !== '' && <div className="dsh-browser-step__result">{step.result}</div>}
    </div>
  )
}

/** 内嵌面板：左侧实时画面（screencast 帧，可直接操作）+ 右侧操作时间线。 */
function BrowserPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [frameUrl, setFrameUrl] = useState('')
  const [frameError, setFrameError] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const frameBoxRef = useRef<HTMLDivElement | null>(null)
  const frameElRef = useRef<HTMLImageElement | null>(null)
  const frameSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })

  // 轮询操作详情（时间线 + url/title）。
  useEffect(() => {
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/dsh-browser/session?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
        const data: SessionDetail = await res.json()
        if (alive) setDetail(data)
      } catch { /* 保持上次 */ }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 800)
    return () => { alive = false; window.clearInterval(timer) }
  }, [sessionId])

  // 轮询 screencast 最新帧：/frame 返回缓存帧 + x-frame-width/height（坐标映射基准）。
  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/dsh-browser/frame?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
        if (!res.ok) { if (alive) setFrameError(true); return }
        const w = Number(res.headers.get('x-frame-width')) || 0
        const h = Number(res.headers.get('x-frame-height')) || 0
        const blob = await res.blob()
        if (!alive) return
        if (w > 0 && h > 0) frameSizeRef.current = { width: w, height: h }
        const url = URL.createObjectURL(blob)
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = url
        setFrameUrl(url)
        setFrameError(false)
      } catch { /* 保持上次 */ }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 150)
    return () => {
      alive = false
      window.clearInterval(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sessionId])

  // 面板内坐标 → 远程视口坐标（按 img 实际显示尺寸线性缩放）。
  const toPage = useCallback((clientX: number, clientY: number) => {
    const el = frameElRef.current ?? frameBoxRef.current
    const size = frameSizeRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const sx = size.width > 0 ? size.width / rect.width : 1
    const sy = size.height > 0 ? size.height / rect.height : 1
    return {
      x: Math.max(0, Math.round((clientX - rect.left) * sx)),
      y: Math.max(0, Math.round((clientY - rect.top) * sy)),
    }
  }, [])

  const sendInput = useCallback((payload: Record<string, unknown>) => {
    fetch('/api/dsh-browser/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ...payload }),
    }).catch(() => {})
  }, [sessionId])

  const lastMove = useRef(0)
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const now = Date.now()
    if (now - lastMove.current < 40) return
    lastMove.current = now
    const { x, y } = toPage(e.clientX, e.clientY)
    sendInput({ type: 'mouse', event: 'move', x, y })
  }, [toPage, sendInput])

  const buttonOf = (b: number): string => (b === 2 ? 'right' : b === 1 ? 'middle' : 'left')

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const { x, y } = toPage(e.clientX, e.clientY)
    sendInput({ type: 'mouse', event: 'down', x, y, button: buttonOf(e.button) })
  }, [toPage, sendInput])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const { x, y } = toPage(e.clientX, e.clientY)
    sendInput({ type: 'mouse', event: 'up', x, y, button: buttonOf(e.button) })
  }, [toPage, sendInput])

  const onClick = useCallback((e: React.MouseEvent) => {
    const { x, y } = toPage(e.clientX, e.clientY)
    sendInput({ type: 'mouse', event: 'click', x, y })
  }, [toPage, sendInput])

  // 滚轮：原生 passive:false 才能 preventDefault（阻止滚动 DSH 面板），并回传远程浏览器。
  useEffect(() => {
    const box = frameBoxRef.current
    if (!box) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const { x, y } = toPage(e.clientX, e.clientY)
      sendInput({ type: 'wheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY })
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => { box.removeEventListener('wheel', onWheel) }
  }, [toPage, sendInput])

  // 键盘：可打印字符走 insertText；特殊键/组合键走 dispatchKey；跳过 IME 组合态。
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    const modifiers: string[] = []
    if (e.ctrlKey || e.metaKey) modifiers.push(e.ctrlKey ? 'ctrl' : 'meta')
    if (e.shiftKey) modifiers.push('shift')
    if (e.altKey) modifiers.push('alt')
    const isShortcut = e.ctrlKey || e.metaKey || e.altKey
    if (e.key === 'Tab' || isShortcut || e.key.length > 1) {
      e.preventDefault()
      sendInput({ type: 'key', key: e.key, modifiers })
    } else if (e.key.length === 1) {
      e.preventDefault()
      sendInput({ type: 'text', text: e.key })
    }
  }, [sendInput])

  const steps = (detail?.steps ?? []).slice().reverse()
  const running = detail?.active === true || steps.some(s => s.status === 'running')

  return createPortal(
    <>
      <div className="dsh-browser-panel__backdrop" onClick={onClose} aria-hidden />
      <div className={fullscreen ? 'dsh-browser-panel dsh-browser-panel--fullscreen' : 'dsh-browser-panel'} role="dialog" aria-label="AI 浏览器操作面板">
        <header className="dsh-browser-panel__head">
          <span className="dsh-browser-panel__title">
            <GlobeIcon size={16} /> AI 浏览器{running ? ' · 操作中' : ''}
          </span>
          <button
            type="button"
            className="dsh-browser-panel__fullscreen"
            onClick={() => { setFullscreen(v => !v) }}
            aria-label={fullscreen ? '退出全屏' : '全屏'}
          >
            <FullscreenIcon exiting={fullscreen} />
          </button>
          <button type="button" className="dsh-browser-panel__close" onClick={onClose} aria-label="关闭">✕</button>
          <span className="dsh-browser-panel__url" title={detail?.url || ''}>
            {detail?.title || detail?.url || ''}
          </span>
        </header>
        <div className="dsh-browser-panel__body">
          <div ref={frameBoxRef} className="dsh-browser-panel__frame">
            {frameError
              ? <span className="dsh-browser-panel__frame-empty">浏览器画面不可用</span>
              : frameUrl === ''
                ? <span className="dsh-browser-panel__frame-empty">画面连接中…</span>
                : (
                  <img
                    ref={frameElRef}
                    src={frameUrl}
                    alt="浏览器实时画面（可直接操作）"
                    tabIndex={0}
                    draggable={false}
                    onError={() => { setFrameError(true) }}
                    onMouseMove={onMouseMove}
                    onMouseDown={onMouseDown}
                    onMouseUp={onMouseUp}
                    onClick={onClick}
                    onKeyDown={onKeyDown}
                  />
                )}
          </div>
          <div className="dsh-browser-panel__timeline">
            <div className="dsh-browser-panel__tl-head">操作时间线 · 已发送指令</div>
            {steps.length === 0
              ? <div className="dsh-browser-panel__empty">暂无操作记录</div>
              : steps.map(step => <StepRow key={step.seq} step={step} />)}
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

export type BrowserSeatProps = { sessionId: SessionId }

/** 会话内浏览器常驻按钮（conversation.input.left 条目，始终可见）。 */
export const BrowserSeat = memo(function BrowserSeat({ sessionId }: BrowserSeatProps) {
  const store = browserActivityStore()
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  useEffect(() => store.subscribe(forceUpdate), [store])
  const info = store.active.get(String(sessionId))
  const engaged = info !== undefined
  const [open, setOpen] = useState(false)

  const tip = engaged
    ? `AI 浏览器${info.label !== '' ? `：${info.label}` : '操作中'}${info.detail !== '' ? ` · ${info.detail}` : ''}`
    : 'AI 浏览器'

  return (
    <>
      <Tooltip label={tip} side="top" delayMs={500}>
        <button
          type="button"
          className={engaged ? 'dsh-browser-seat dsh-browser-seat--on' : 'dsh-browser-seat'}
          aria-label={tip}
          aria-pressed={engaged}
          onClick={() => { setOpen(v => !v) }}
        >
          <GlobeIcon size={14} />
        </button>
      </Tooltip>
      {open && <BrowserPanel sessionId={String(sessionId)} onClose={() => { setOpen(false) }} />}
    </>
  )
})
