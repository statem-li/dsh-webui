/**
 * webui — 对话「退回」能力（client 半身）。
 *
 * 给「我发送的消息」（user 节点）在复制按钮旁增加一个「退回」按钮。点击后：
 *   1. 先调 host `/api/webui-rewind/restore` 回退工作区文件到该消息发送前；
 *   2. 文件回退成功后，再「原地回退」上下文：
 *        - 有上一条已完成 turn：fork 到该边界 → 打开子会话 → 归档原会话
 *          （原对话从列表消失，只留回退后的对话）；
 *        - 第一条消息：归档原会话 → 回到空白会话。
 *
 * 顺序保证一致性：文件回退失败则绝不切上下文，用户停留在原会话且文件未被
 * 改动，可放心重试。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClientContext, ISessions, IWorkspaces, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: 激活 ui-conversation 的 SlotMap / ChatNodeDataMap 合并声明。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  Button, IconCheckOutline16, IconCopyOutline16,
  JsonBlock, MessageText, Modal, RiskConfirmation, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'

// ── 回退图标（图标库无 undo 语义，内联 Material undo：逆时针回退箭头）─────

function IconUndoOutline16({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"
        fill="currentColor"
      />
    </svg>
  )
}

// ── 样式 ────────────────────────────────────────────────────────────────────

const STYLE_ID = 'dsh-webui-rewind-styles'

const SHEET = `
.dsh-rewind-userRow{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.dsh-rewind-userStack{display:flex;flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(525px,82%)}
.dsh-rewind-bubble{max-width:100%;background:var(--dsw-specific-bubble,var(--dsw-alias-bg-layer-3,#1b1e24));border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px;color:var(--dsw-alias-label-primary,#ddd);overflow-wrap:anywhere;white-space:pre-wrap}
.dsh-rewind-referenceSummary{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:18px}
.dsh-rewind-actions{display:flex;align-items:center;gap:10px;height:28px}
.dsh-rewind-time{padding-right:12px;font-size:14px;line-height:24px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}
.dsh-rewind-action{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:none;border-radius:28px;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer}
.dsh-rewind-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-rewind-action:disabled{opacity:.4;cursor:default}
.dsh-rewind-action:disabled:hover{background:transparent;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-rewind-action-busy{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-rewind-error{font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary,#bbb);overflow-wrap:anywhere}
@media (hover:hover){
  [data-time-hover-root] .dsh-rewind-time{opacity:0;transition:opacity 80ms ease}
  [data-time-hover-root]:hover .dsh-rewind-time,[data-time-hover-root]:focus-within .dsh-rewind-time{opacity:1}
}
`

let injected = false

function injectStyles(): () => void {
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/rewind'
    tag.textContent = SHEET
    document.head.appendChild(tag)
    injected = true
  }
  return () => {
    if (!injected) return
    document.getElementById(STYLE_ID)?.remove()
    injected = false
  }
}

// ── 工具 ────────────────────────────────────────────────────────────────────

/** 把 user 消息 content 拆成 text / 图片 / 其余块（与官方 contentParts 对齐）。 */
function contentParts(content: readonly ContentBlock[]): {
  text: string
  images: Array<{ attachment: ImageAttachmentRef }>
  rest: ContentBlock[]
} {
  const texts: string[] = []
  const images: Array<{ attachment: ImageAttachmentRef }> = []
  const rest: ContentBlock[] = []
  for (const block of content) {
    const b = block as { type: string; text?: string; attachment?: ImageAttachmentRef }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) images.push({ attachment: b.attachment })
    else rest.push(block)
  }
  return { text: texts.join(''), images, rest }
}

/** 简洁本地时间：同一天 HH:mm，否则 MM-DD HH:mm。 */
function formatTime(ts: number): string {
  if (ts <= 0) return ''
  const d = new Date(ts)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${mo}-${day} ${hh}:${mm}`
}

/** 组件注入的业务面（由 applyRewindClient 经 slot inject 提供）。 */
export interface RewindInjected {
  sessions: Pick<ISessions, 'fork' | 'open'>
  workspaces: Pick<IWorkspaces, 'startSession' | 'archiveSession'>
}

/**
 * 归档原会话是退回闭环里的「清理」动作，不是核心目标（核心是文件回退 +
 * fork 上下文）。归档失败不改变「已回退」的结果，降级为告警，避免把一次
 * 已成功的退回误报成「退回失败」。
 */
async function archiveBestEffort(
  workspaces: RewindInjected['workspaces'],
  sessionId: SessionId,
): Promise<void> {
  try {
    await workspaces.archiveSession(sessionId)
  } catch (err) {
    console.warn('[dsh-webui-rewind] archive original session failed:', err)
  }
}

// ── 组件 ────────────────────────────────────────────────────────────────────

/**
 * 覆盖官方 user / steering 节点渲染：右对齐气泡（图片 / 文本 / 其余块）+
 * 复制 + 退回。退回只对 user（turn-opening）开放。
 */
export const UserRewindNodeView = memo(function UserRewindNodeView({
  node, renderMessageImages, useSession, sessionId, sessions, workspaces,
}: ChatNodeViewProps<'user' | 'steering'> & RewindInjected) {
  const data = node.data
  const { text, images, rest } = useMemo(() => contentParts(data.content), [data.content])
  const referenceLabels = data.referenceLabels

  // 该消息所属 turn 号；退回 = fork 到上一个已完成 turn 的 turn/end seq。
  const turnNumber = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn.turn
    : undefined
  const prevTurnEnd = useSession(snapshot => (
    turnNumber === undefined ? undefined : snapshot.turnEnds.get(turnNumber - 1)
  ))
  // 退回只对 turn-opening 的 user 消息开放；steering 打断消息不显示退回。
  const isUser = node.kind === 'user'

  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => {
    copyPending.current = false
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
  }, [])

  const onCopy = useCallback(() => {
    if (copied || copyPending.current) return
    copyPending.current = true
    void writeClipboard(text).then((ok) => {
      copyPending.current = false
      if (!ok) return
      setCopied(true)
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null
        setCopied(false)
      }, 1000)
    })
  }, [copied, text])

  const onRewind = useCallback(() => {
    if (busy) return
    setAcknowledged(false)
    setConfirmOpen(true)
  }, [busy])

  const onConfirmRewind = useCallback(() => {
    if (busy) return
    setBusy(true)
    const seq = node.anchorSeq
    void fetch('/api/webui-rewind/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, seq }),
    }).then((res) => res.json()).then(async (result: { ok?: boolean; error?: string }) => {
      if (result.ok !== true) {
        setError(result.error ?? '未知错误')
        setConfirmOpen(false)
        setBusy(false)
        return
      }
      // 文件回退成功后，才「原地回退」：
      //   - 有上一条已完成 turn：fork 到该边界 → 打开子会话 → 归档原会话。
      //   - 第一条消息：归档原会话 → 回到空白会话。
      try {
        if (prevTurnEnd !== undefined) {
          const childId = await sessions.fork({ sessionId, atSeq: prevTurnEnd })
          // 先 open 后 archive：归档「当前会话」会触发会话列表把 current 清成
          // no-session 空态。若 archive 在前，界面会先闪一下空白再切到子会话；
          // 先 open 让 current 一步从原会话切到子会话，再归档原会话，无空白帧。
          sessions.open(childId)
          await archiveBestEffort(workspaces, sessionId)
        } else {
          await archiveBestEffort(workspaces, sessionId)
          workspaces.startSession()
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setConfirmOpen(false)
        setBusy(false)
      }
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
      setConfirmOpen(false)
      setBusy(false)
    })
  }, [busy, node.anchorSeq, sessionId, sessions, prevTurnEnd, workspaces])

  const showBubble = text !== '' || rest.length > 0

  return (
    <>
      <div className="dsh-rewind-userRow" data-time-hover-root>
        <div className="dsh-rewind-userStack">
          {renderMessageImages({ images, align: 'end' })}
          {showBubble && (
            <div className="dsh-rewind-bubble">
              {text !== '' && <MessageText text={text} />}
              {rest.map((block, i) => (
                <JsonBlock
                  key={i}
                  label="附加内容"
                  payload={block}
                  truncatedLabel={(total: number) => `… 已截断，共 ${total} 字符`}
                />
              ))}
            </div>
          )}
          {referenceLabels !== undefined && referenceLabels.length > 0 && (
            <div className="dsh-rewind-referenceSummary">{referenceLabels.join(' ')}</div>
          )}
        </div>
        <div className="dsh-rewind-actions">
          <span className="dsh-rewind-time">{formatTime(data.time)}</span>
          <Tooltip label={copied ? '已复制' : '复制'} side="bottom">
            <button type="button" className="dsh-rewind-action" aria-label="复制" onClick={onCopy}>
              {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
            </button>
          </Tooltip>
          {isUser && (
            <Tooltip label={prevTurnEnd !== undefined ? '退回到这条消息之前' : '退回并回到空白会话'} side="bottom">
              <button
                type="button"
                className={[ 'dsh-rewind-action', busy ? 'dsh-rewind-action-busy' : '' ].filter(Boolean).join(' ')}
                aria-label="退回到这条消息之前"
                disabled={busy}
                onClick={onRewind}
              >
                <IconUndoOutline16 />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      <RiskConfirmation
        open={confirmOpen}
        title="退回确认"
        description="将回退工作区文件到这条消息发送前的状态，并消除这条消息及之后的上下文。此操作会覆盖当前工作区文件。"
        acknowledgeLabel="我确认要覆盖当前工作区文件"
        cancelLabel="取消"
        confirmLabel="退回"
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { if (!busy) setConfirmOpen(false) }}
        onConfirm={onConfirmRewind}
      />
      {error !== null && (
        <Modal
          open
          onClose={() => { setError(null) }}
          title="退回失败"
          footer={(
            <Button variant="primary" onClick={() => { setError(null) }}>知道了</Button>
          )}
        >
          <p className="dsh-rewind-error">{error}</p>
        </Modal>
      )}
    </>
  )
})

// ── 插件入口 ────────────────────────────────────────────────────────────────

/**
 * 注册覆盖官方 user / steering 节点的 renderer（priority -100 shadow 官方的
 * priority 0）。user 与 steering 共用同一气泡渲染（保持视觉一致），退回按钮
 * 只对 user（turn-opening）开放。挂载时注入样式，卸载时移除。
 */
export function applyRewindClient(ctx: ClientContext): void {
  injectStyles()
  const sessions = ctx.sessions
  const workspaces = ctx.workspaces
  const injectFace = (_sessionId: SessionId): RewindInjected => ({ sessions, workspaces })
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'user',
    priority: -100,
    locale: 'conversation',
    inject: injectFace,
  }, UserRewindNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'steering',
    priority: -100,
    locale: 'conversation',
    inject: injectFace,
  }, UserRewindNodeView))
}
