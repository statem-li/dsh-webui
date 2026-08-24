/**
 * webui — 对话截图入口（client 端）：assistant 消息操作栏的相机按钮。
 *
 * 点击打开截图面板（范围 / 主题 / 宽度可选，预览后再决定保存）。消息文本从
 * ConversationSnapshot 里现取——按钮本身不持有内容，面板改范围时重新抽取。
 *
 * 性能注意：这个按钮在**每条** assistant 消息上都有一份，绝不能订阅整份
 * 快照（useSession(s => s) 会让每条消息在每个会话事件上重渲染）。这里让
 * selector 只把快照写进 ref 并返回常量 0：订阅照旧、重渲染为零，点击时从
 * ref 读当前快照即可。
 *
 * 按钮无 Tooltip（对齐官方 IconActions 里的其他按钮）。
 */
import { useCallback, useRef, useState } from 'react'
import type { ClientContext, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useModalClose, ensureModalAnimStyles } from '../modal-animation.js'
import { collectMessages, type ShotMessage, type ShotRange } from './collect.js'
import { ShotPanel } from './Panel.js'
import { cls, ensureStyles } from './styles.js'

/** 相机图标（16px 线性，与操作栏其他图标同风格）。 */
function CameraIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.9 1.8h-3.8l-1.3 2H3a2 2 0 0 0-2 2v6.4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5.8a2 2 0 0 0-2-2h-1.8l-1.3-2zM8 9.6a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"
      />
    </svg>
  )
}

/**
 * assistant 消息的截图按钮（conversation.chat.assistant-actions）。
 * @param props - 槽位标准 props（messageId + useSession / useSessions + sessionId）。
 */
export function AssistantScreenshotAction(
  props: PropsRuntime<'conversation.chat.assistant-actions'>,
): JSX.Element {
  const { messageId, useSession, useSessions, sessionId } = props
  const [open, setOpen] = useState(false)
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })

  // 只把快照落进 ref（返回常量 → 不触发重渲染），点击时再读。
  const snapRef = useRef<ConversationSnapshot | null>(null)
  useSession((snapshot: ConversationSnapshot) => {
    snapRef.current = snapshot
    return 0
  })
  const collect = useCallback((range: ShotRange): ShotMessage[] => {
    const snapshot = snapRef.current
    return snapshot === null ? [] : collectMessages(snapshot, messageId, range)
  }, [messageId])

  // 卡片大标题用会话标题（返回字符串：仅标题变化时重渲染）。
  const title = useSessions(list => {
    const byId = (list as { byId?: Record<string, { displayTitle?: string } | undefined> }).byId ?? {}
    return byId[String(sessionId)]?.displayTitle ?? ''
  })

  return (
    <>
      <button
        type="button"
        className={open ? `${cls.btn} ${cls.btnBusy}` : cls.btn}
        aria-label="截图为图片"
        onClick={() => { setOpen(true) }}
      >
        <CameraIcon />
      </button>
      {open && (
        <ShotPanel closing={closing} onClose={requestClose} collect={collect} title={title} />
      )}
    </>
  )
}

/**
 * 注册截图按钮（conversation.chat.assistant-actions，order 5）。
 * @param ctx - client 插件上下文。
 */
export function applyMessageScreenshot(ctx: ClientContext): void {
  ensureStyles()
  ensureModalAnimStyles()
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'webui-screenshot',
    order: 5,
  }, AssistantScreenshotAction))
}
