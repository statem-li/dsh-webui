/**
 * webui — 单条消息截图按钮 + 保存结果卡片（client 半身）。
 *
 * 对齐 openhanako：截图是「单条消息」级别（不是整个会话）；点击后 host 用
 * 樱花主题渲染成图片保存到文件，前端只弹一个「已保存」小卡片（路径 + 复制 +
 * 下载），不放大图预览（要看全尺寸就下载/打开文件）。
 *
 * 按钮无 Tooltip（hover 不弹描述），直接放在消息 actions 行里。
 */
import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { css } from './styles'

function CameraIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.9 1.8h-3.8l-1.3 2H3a2 2 0 0 0-2 2v6.4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5.8a2 2 0 0 0-2-2h-1.8l-1.3-2zM8 9.6a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"
      />
    </svg>
  )
}

function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

interface ShotResult {
  path: string
  imageUrl: string
}

/**
 * 单条消息截图按钮（无 Tooltip）。点击后截「这一条消息」。
 * @param role - user（纯文本，暖橙）或 assistant（markdown 渲染）。
 * @param text - 该条消息的文本内容；为空则不渲染。
 */
export function MessageScreenshotButton({ role, text, sessionId }: { role: 'user' | 'assistant'; text: string; sessionId?: string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ShotResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const onShot = useCallback((): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    setOpen(true)
    fetch('/api/webui-screenshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role, text, sessionId }),
    }).then((res) => res.json()).then((r: { ok?: boolean; error?: string; path?: string; imageUrl?: string }) => {
      if (r.ok === true && typeof r.path === 'string') {
        setResult({ path: r.path, imageUrl: r.imageUrl ?? '' })
      } else {
        setError(r.error ?? '截图失败')
      }
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    }).finally(() => { setBusy(false) })
  }, [busy, role, text, sessionId])

  const copyPath = useCallback((): void => {
    if (result === null) return
    void navigator.clipboard?.writeText(result.path).catch(() => {})
  }, [result])

  if (text.trim() === '') return null

  return (
    <>
      <button
        type="button"
        className={[css.shotBtn, busy ? css.shotBtnBusy : ''].filter(Boolean).join(' ')}
        aria-label="截图为图片"
        disabled={busy}
        onClick={onShot}
      >
        {busy ? <SpinnerIcon /> : <CameraIcon />}
      </button>
      {open && (result !== null || error !== null) && createPortal(
        <div
          className={css.shotPopup}
          style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
          role="dialog"
          aria-label="截图预览"
        >
          <div className={css.shotPopupHead}>
            <span>{result !== null ? '截图预览' : '截图失败'}</span>
            <button type="button" className={css.shotAction} onClick={() => { setOpen(false) }}>✕</button>
          </div>
          <div className={css.shotPopupBody}>
            {busy && <div className={css.shotPath}>正在渲染…</div>}
            {error !== null && <div className={css.shotError}>{error}</div>}
            {result !== null && (
              <>
                <img className={css.shotImg} src={result.imageUrl} alt="截图预览" />
                <div className={css.shotPath}>{result.path}</div>
                <div className={css.shotActions}>
                  <button type="button" className={css.shotAction} onClick={copyPath}>复制路径</button>
                  <a className={css.shotAction} href={result.imageUrl} download target="_blank" rel="noreferrer">下载</a>
                  <button type="button" className={css.shotAction} onClick={() => { setOpen(false) }}>关闭</button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/**
 * assistant 消息的截图按钮（挂在 conversation.chat.assistant-actions，
 * 渲染在复制和「分支」之间）。通过 useSession 从 messageId 反查该条回复的文本。
 */
export function AssistantScreenshotAction(props: PropsRuntime<'conversation.chat.assistant-actions'>) {
  const { messageId, useSession, sessionId } = props
  const text = useSession(snapshot => {
    for (const key of snapshot.chat.order) {
      const node = snapshot.chat.nodes.get(key)
      if (node === undefined || node.kind !== 'turn-tail') continue
      const closing = (node.data as { closing?: { finalNode?: { messageId?: unknown }; blocks?: readonly { kind: string; text?: string }[] } | null }).closing
      if (closing?.finalNode?.messageId !== messageId) continue
      return closing.blocks
        ?.filter(block => block.kind === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
        .join('') ?? ''
    }
    return ''
  })
  return <MessageScreenshotButton role="assistant" text={text} sessionId={sessionId} />
}

/** 注册 assistant 消息截图按钮（conversation.chat.assistant-actions）。 */
export function applyMessageScreenshot(ctx: ClientContext): void {
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'webui-screenshot',
    order: 5,
  }, AssistantScreenshotAction))
}
