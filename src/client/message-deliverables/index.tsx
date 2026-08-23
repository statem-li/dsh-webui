/**
 * message-deliverables — 消息操作栏「产物」按钮（client 半身）。
 *
 * 放在 assistant 消息 actions 行（截图按钮旁）：点击展开会话产物大卡片
 * （左清单右预览）。数据来自 host 端 fs 写入记账（/api/webui-deliverables），
 * 服务重启后依然可用——官方「产物」行挂在当次会话流上，重启即逝，本入口补位。
 */
import { useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { css as rootCss } from '../styles'
import { DeliverablesCard } from './card.tsx'
import { ensureStyles } from './styles.ts'

/** 归档盒图标：与消息栏其他 16px 线性图标同风格。 */
function BoxIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1.5 3.2c0-.66.54-1.2 1.2-1.2h10.6c.66 0 1.2.54 1.2 1.2v1.6c0 .4-.2.76-.5.98v6.02a2.2 2.2 0 0 1-2.2 2.2H4.2A2.2 2.2 0 0 1 2 11.8V5.78c-.3-.22-.5-.58-.5-.98V3.2zm2 2.8v5.8c0 .39.31.7.7.7h7.6c.39 0 .7-.31.7-.7V6h-9zM3 3.5v.7h10v-.7H3zm3.25 4h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5z"
      />
    </svg>
  )
}

/**
 * assistant 消息的产物按钮（conversation.chat.assistant-actions，
 * 渲染在截图按钮旁）。会话 id 缺失时不渲染（无数据源）。
 */
export function AssistantDeliverablesAction(props: PropsRuntime<'conversation.chat.assistant-actions'>) {
  const { sessionId } = props
  const [open, setOpen] = useState(false)
  if (sessionId === undefined) return null
  return (
    <>
      <button
        type="button"
        className={rootCss.shotBtn}
        aria-label="产物文件"
        onClick={() => { setOpen(true) }}
      >
        <BoxIcon />
      </button>
      <DeliverablesCard open={open} sessionId={sessionId} onClose={() => { setOpen(false) }} />
    </>
  )
}

/** 注册 assistant 消息产物按钮（order 6，紧随截图 order 5）。 */
export function applyMessageDeliverables(ctx: ClientContext): void {
  ensureStyles()
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'webui-deliverables',
    order: 6,
  }, AssistantDeliverablesAction))
}
