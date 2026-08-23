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
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ClientContext, ISessions, IWorkspaces, SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: 激活 ui-conversation 的 SlotMap / ChatNodeDataMap 合并声明。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: 拉入 ModelDirectoryState（ui-model-selection 的共享模型目录状态）。
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import {
  Button, IconCheckOutline16, IconCopyOutline16,
  JsonBlock, MessageText, Modal, Tooltip, writeClipboard,
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

/** 编辑图标（Material edit：铅笔）。 */
function IconEditOutline16({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
        fill="currentColor"
      />
    </svg>
  )
}

/** 刷新图标（Material refresh：重试/重新生成）。 */
function IconRefreshOutline16({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
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
.dsh-rewind-visionTag{display:inline-flex;align-items:center;padding:2px 8px;border-radius:8px;font-size:11px;line-height:16px;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-tertiary,#888);cursor:default}
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
.dsh-rewind-diffList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto;font-size:13px;line-height:18px}
.dsh-rewind-diffItem{display:flex;align-items:baseline;gap:8px;color:var(--dsw-alias-label-secondary,#bbb);overflow-wrap:anywhere;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dsh-rewind-diffItem .dsh-rewind-diffPath{min-width:0}
.dsh-rewind-diffTag{flex:0 0 auto;align-self:center;width:18px;height:18px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1;font-family:var(--dsw-font-sans,system-ui)}
.dsh-rewind-diffMod{background:rgba(74,158,255,.16);color:#4a9eff}
.dsh-rewind-diffAdd{background:rgba(52,199,123,.16);color:#34c77b}
.dsh-rewind-diffDel{background:rgba(255,90,95,.16);color:#ff5a5f}
.dsh-rewind-diffMore{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:18px}
.dsh-rewind-edit{width:100%;min-height:132px;max-height:50vh;resize:none;overflow:auto;box-sizing:border-box;padding:10px 12px;border:1px solid var(--dsw-alias-line-divider,rgba(255,255,255,.12));border-radius:12px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,#ddd);font-size:14px;line-height:22px;font-family:inherit;outline:none}
.dsh-rewind-edit:focus{border-color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-rewind-edit:disabled{opacity:.55}
.dsh-rewind-inlineEditor{display:flex;flex-direction:column;gap:8px;width:min(760px,100%);min-width:min(600px,100%);box-sizing:border-box}
.dsh-rewind-editActions{display:flex;justify-content:flex-end;gap:8px}
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
  sessions: Pick<ISessions, 'fork' | 'open' | 'binding' | 'list'>
  workspaces: Pick<IWorkspaces, 'startSession' | 'archiveSession'>
  /** 当前会话的共享模型目录（ui-model-selection）；辅助视觉徽章读当前选中模型。 */
  directory?: SnapshotStore<ModelDirectoryState>
}

// ── 辅助视觉徽章：当前模型不支持图片输入时，用户消息图片下方标注 ──────────

/** provider/model → input 是否含 image 的缓存（60s），来自 /api/vision-helper/providers。 */
let visionCapCache: { at: number; map: Map<string, boolean> } | null = null

/**
 * 当前会话选中模型是否声明了图片输入。
 * @returns true=支持（不显示徽章）；false=不支持（显示徽章）；undefined=未知（不显示）。
 */
function useModelSupportsImage(directory: SnapshotStore<ModelDirectoryState> | undefined): boolean | undefined {
  const state = useSyncExternalStore(
    fn => directory?.subscribe(fn) ?? (() => {}),
    () => directory?.getSnapshot(),
  )
  const provider = state?.current?.provider
  const model = state?.current?.model
  const key = provider && model ? `${provider}/${model}` : undefined
  const [supports, setSupports] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    if (key === undefined) return
    if (visionCapCache !== null && Date.now() - visionCapCache.at < 60_000) {
      setSupports(visionCapCache.map.get(key))
      return
    }
    let alive = true
    fetch('/api/vision-helper/providers', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: any) => {
        if (!alive || !d || d.ok === false) return
        const map = new Map<string, boolean>()
        let anyImageDeclared = false
        for (const p of d.providers ?? []) {
          for (const m of p.models ?? []) {
            const has = Array.isArray(m.input) && m.input.includes('image')
            if (has) anyImageDeclared = true
            map.set(`${p.id}/${m.id}`, has)
          }
        }
        visionCapCache = { at: Date.now(), map }
        // 数据可信度兜底：整个目录没有任何模型声明 image，说明 host 版本过旧
        // （inputModalities 未暴露，全部 null）而非真的全不支持——此时视为未知，
        // 不显示徽章，避免对支持识图的模型误标。
        setSupports(anyImageDeclared ? map.get(key) : undefined)
      })
      .catch(() => { /* 接口不可用则不显示徽章 */ })
    return () => { alive = false }
  }, [key])
  return supports
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

/**
 * 等待一个会话「浮出」客户端会话列表。fork 出的子会话在首条用户消息落盘前
 * 是 blank，会被列表折叠（不进 ids）；此时对它 open()，list snapshot 会把
 * current 打成 undefined（selected 不在列表且无 address），UI 闪进「无会话
 * 空态」。所以切换前必须等它浮出。超时兜底放行，不卡死重发流程。
 */
function waitSessionSurfaced(list: ISessions['list'], id: SessionId, timeoutMs = 4000): Promise<void> {
  const surfaced = (): boolean => {
    const snapshot = list.getSnapshot()
    return snapshot.ids.includes(id) || snapshot.byId[id] !== undefined
  }
  if (surfaced()) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = window.setTimeout(finish, timeoutMs)
    const unsub = list.subscribe(() => { if (surfaced()) finish() })
    function finish(): void {
      window.clearTimeout(timer)
      unsub()
      resolve()
    }
  })
}

// ── 退回前的差异查询（host /api/webui-rewind/diff）───────────────

/** host /diff 响应：当前工作区相对「这条消息发送前」快照的差异。 */
interface RewindDiffResult {
  ok: boolean
  changed: boolean
  summary: { modified: number; added: number; deleted: number }
  modified: string[]
  added: string[]
  deleted: string[]
  error?: string
}

/** 用差异结果拼一句给用户看的话：本次会回退哪些文件。 */
function describeDiff(diff: RewindDiffResult): string {
  const { modified, added, deleted } = diff.summary
  const parts: string[] = []
  if (modified > 0) parts.push(`恢复 ${modified} 个已修改文件`)
  if (deleted > 0) parts.push(`恢复 ${deleted} 个已删除文件`)
  if (added > 0) parts.push(`删除 ${added} 个新增文件`)
  const changes = parts.length > 0 ? `本次将${parts.join('、')}` : '工作区文件无变化'
  return `将回退工作区文件到这条消息发送前的状态，并消除这条消息及之后的上下文。${changes}，此操作不可撤销。`
}

// ── 组件 ────────────────────────────────────────────────────────────────────

/**
 * 覆盖官方 user / steering 节点渲染：右对齐气泡（图片 / 文本 / 其余块）+
 * 复制 + 退回。退回只对 user（turn-opening）开放。
 */
export const UserRewindNodeView = memo(function UserRewindNodeView({
  node, renderMessageImages, useSession, sessionId, sessions, workspaces, directory,
}: ChatNodeViewProps<'user' | 'steering'> & RewindInjected) {
  const data = node.data
  const { text, images, rest } = useMemo(() => contentParts(data.content), [data.content])
  const referenceLabels = data.referenceLabels
  // 当前选中模型是否声明图片输入；false = 图片经辅助视觉降级（显示徽章）。
  const supportsImage = useModelSupportsImage(directory)

  // 该消息所属 turn 号；退回 = fork 到上一个已完成 turn 的 turn/end seq。
  const turnNumber = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn.turn
    : undefined
  const prevTurnEnd = useSession(snapshot => (
    turnNumber === undefined ? undefined : snapshot.turnEnds.get(turnNumber - 1)
  ))
  // 退回只对 turn-opening 的 user 消息开放；steering 打断消息不显示退回。
  const isUser = node.kind === 'user'

  // 会话运行态（决定「修改 / 刷新重载」可用性）。
  const running = useSession(snapshot => snapshot.running)
  // 仅纯文本消息支持「编辑重发 / 重新生成」（图片与附加块无法通过 prompt 原样重发）。
  const textEditable = isUser && images.length === 0 && rest.length === 0 && text.trim() !== ''
  // 第一条消息之前没有可 fork 的 turn 边界；编辑/重发需要 fork 到该边界，故仅对非首条开放。
  const canForkBack = prevTurnEnd !== undefined
  // 修改该对话：纯文本、非运行中、非首条。
  const canEdit = textEditable && !running && canForkBack
  // 刷新重载（重新生成）：纯文本、非运行中、非首条。中断/停止后可重试，
  // 正常完成的对话也可点它重新生成这条消息的回复。
  const canRetry = textEditable && !running && canForkBack

  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [diffInfo, setDiffInfo] = useState<RewindDiffResult | null>(null)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const editRef = useRef<HTMLTextAreaElement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const bubbleHeightRef = useRef(0)
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

  /**
   * 执行退回闭环：先（可选）回退文件，成功后 fork 上下文。
   * @param skipRestore 无文件修改时为 true，跳过文件回退直接切上下文。
   */
  const doRewind = useCallback((skipRestore: boolean) => {
    setBusy(true)
    const seq = node.anchorSeq
    void (async () => {
      let errorMsg: string | null = null
      try {
        if (!skipRestore) {
          const res = await fetch('/api/webui-rewind/restore', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, seq }),
          })
          const result = await res.json() as { ok?: boolean; error?: string }
          if (result.ok !== true) errorMsg = result.error ?? '未知错误'
        }
        if (errorMsg === null) {
          // 文件回退成功后，才「原地回退」：
          //   - 有上一条已完成 turn：fork 到该边界 → 等子会话浮出列表 → 打开
          //     子会话 → 归档原会话。不等浮出就 open 会把 current 打到不在
          //     列表的 blank 会话上，UI 闪进「无会话空态」再恢复（用户看到的
          //     「像刷新一样的闪屏」）。
          //   - 第一条消息：先 startSession 切到新空白会话，再归档原会话。
          //     顺序反了的话，归档瞬间 current 被清成 no-session，同样闪空态。
          if (prevTurnEnd !== undefined) {
            const childId = await sessions.fork({ sessionId, atSeq: prevTurnEnd })
            await waitSessionSurfaced(sessions.list, childId)
            sessions.open(childId)
            await archiveBestEffort(workspaces, sessionId)
          } else {
            workspaces.startSession()
            await archiveBestEffort(workspaces, sessionId)
          }
        }
      } catch (err: unknown) {
        errorMsg = err instanceof Error ? err.message : String(err)
      } finally {
        if (errorMsg !== null) setError(errorMsg)
        setConfirmOpen(false)
        setBusy(false)
      }
    })()
  }, [node.anchorSeq, sessionId, sessions, prevTurnEnd, workspaces])

  const onRewind = useCallback(() => {
    if (busy) return
    setError(null)
    setBusy(true)
    const seq = node.anchorSeq
    // 先查差异：无文件修改直接退回（不弹窗），有修改再弹确认框。
    void fetch(`/api/webui-rewind/diff?sessionId=${encodeURIComponent(sessionId)}&seq=${seq}`)
      .then((res) => res.json())
      .then((result: RewindDiffResult) => {
        if (result.ok !== true) {
          setError(result.error ?? '未知错误')
          setBusy(false)
          return
        }
        if (result.changed) {
          setDiffInfo(result)
          setConfirmOpen(true)
          setBusy(false)
        } else {
          void doRewind(true)
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setBusy(false)
      })
  }, [busy, node.anchorSeq, sessionId, doRewind])

  const onConfirmRewind = useCallback(() => {
    if (busy) return
    void doRewind(false)
  }, [busy, doRewind])

  /**
   * 重新发送：fork 到这条消息之前的 turn 边界 → 先在后台把新文本发进子会话
   * （fork 完成后 child 即已 listed，binding 可直接解析，无需先切换）→ 等
   * 子会话浮出列表（blank 解除，见 waitSessionSurfaced）→ open 切换 → 归档
   * 原会话。切过去时第一条消息已落进会话日志，且不会闪「无会话空态」。
   * prompt 失败时不切换、不归档原会话（原地保留现场可重试），并静默清掉
   * 空壳子会话。
   */
  const forkAndResend = useCallback(async (textToSend: string): Promise<void> => {
    if (prevTurnEnd === undefined) return
    const childId = await sessions.fork({ sessionId, atSeq: prevTurnEnd })
    let child = sessions.binding(childId)?.session
    let opened = false
    if (child === undefined) {
      // 兜底：child 尚不可 binding 时回退旧顺序（先切再取）。
      sessions.open(childId)
      opened = true
      child = sessions.binding(childId)?.session
    }
    let sent = false
    if (child !== undefined) {
      const res = await child.prompt([{ type: 'text', text: textToSend }], 'queue')
      sent = res.ok
      if (!res.ok) console.warn('[dsh-webui-rewind] resend prompt failed:', res.error)
    } else {
      console.warn('[dsh-webui-rewind] child binding unresolved after fork:', childId)
    }
    if (sent) {
      await waitSessionSurfaced(sessions.list, childId)
      if (!opened) sessions.open(childId)
      await archiveBestEffort(workspaces, sessionId)
    } else if (!opened) {
      try { await workspaces.archiveSession(childId) } catch { /* 清理尽力而为 */ }
    }
  }, [prevTurnEnd, sessionId, sessions, workspaces])

  /**
   * 编辑器自适应高度：贴内容高度，且不小于原气泡高度（编辑时不比原文区域
   * 更矮）。封顶 50vh 与 CSS max-height 一致；但视口高度异常（如无头/最小化
   * 窗口的 innerHeight=0）时跳过 JS 封顶，交给 CSS min-height 兜底。
   */
  const growEditor = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    const vhCap = Math.round(window.innerHeight * 0.5)
    const cap = vhCap >= 240 ? vhCap : Number.POSITIVE_INFINITY
    const target = Math.max(el.scrollHeight, bubbleHeightRef.current)
    el.style.height = `${Math.min(target, cap)}px`
  }, [])

  /** 修改该对话：气泡原位进入内联编辑（预填当前文本），不弹窗。 */
  const onOpenEditor = useCallback(() => {
    if (busy || !canEdit) return
    setError(null)
    // 先记住原气泡渲染高度：编辑框初始不矮于它，长消息不会被压成小窗。
    bubbleHeightRef.current = bubbleRef.current?.offsetHeight ?? 0
    setEditText(text)
    setEditing(true)
  }, [busy, canEdit, text])

  // 进入编辑态后聚焦输入框并把光标移到末尾。
  useEffect(() => {
    if (!editing) return
    const el = editRef.current
    if (el === null) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
    growEditor(el)
  }, [editing, growEditor])

  const onCancelEdit = useCallback(() => {
    if (busy) return
    setEditing(false)
    setError(null)
  }, [busy])

  /**
   * 修改后重新发送：不关编辑器，发送期间禁用输入；成功则会话切换、本节点
   * 随旧会话卸载，失败时错误内联显示在编辑器下方，可直接重试或取消。
   */
  const onResendEdited = useCallback(() => {
    if (busy) return
    const trimmed = editText.trim()
    if (trimmed === '') return
    setBusy(true)
    void forkAndResend(trimmed)
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { setBusy(false) })
  }, [busy, editText, forkAndResend])

  /** 编辑框快捷键：Esc 取消；Ctrl/Cmd+Enter 发送。 */
  const onEditKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      if (!busy) {
        event.stopPropagation()
        setEditing(false)
        setError(null)
      }
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onResendEdited()
    }
  }, [busy, onResendEdited])

  /** 刷新重载：直接以原文本重新发起这次对话（重新生成回复）。 */
  const onRetry = useCallback(() => {
    if (busy || !canRetry) return
    setError(null)
    setBusy(true)
    void forkAndResend(text.trim())
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { setBusy(false) })
  }, [busy, canRetry, text, forkAndResend])

  const showBubble = text !== '' || rest.length > 0

  return (
    <>
      <div className="dsh-rewind-userRow" data-time-hover-root>
        {editing ? (
          /* 编辑器挂在整行（不受 userStack 525px 气泡宽限制）：≥600px、常规 ≤760px */
          <div className="dsh-rewind-inlineEditor">
            <textarea
              ref={editRef}
              className="dsh-rewind-edit"
              value={editText}
              disabled={busy}
              placeholder="输入新的消息内容…"
              onChange={(event) => { setEditText(event.currentTarget.value); growEditor(event.currentTarget) }}
              onKeyDown={onEditKeyDown}
            />
            <div className="dsh-rewind-editActions">
              <Button variant="outline" disabled={busy} onClick={onCancelEdit}>取消</Button>
              <Button variant="primary" disabled={busy || editText.trim() === ''} onClick={onResendEdited}>重新发送</Button>
            </div>
          </div>
        ) : (
          <div className="dsh-rewind-userStack">
            {renderMessageImages({ images, align: 'end' })}
            {images.length > 0 && supportsImage === false && (
              <div
                className="dsh-rewind-visionTag"
                title="当前模型不支持直接读图：这张图已由辅助视觉模型转成文字描述后发给模型"
              >
                辅助视觉
              </div>
            )}
            {showBubble && (
            <div className="dsh-rewind-bubble" ref={bubbleRef}>
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
        )}
        {!editing && (
        <div className="dsh-rewind-actions">
          <span className="dsh-rewind-time">{formatTime(data.time)}</span>
          <Tooltip label={copied ? '已复制' : '复制'} side="bottom">
            <button type="button" className="dsh-rewind-action" aria-label="复制" onClick={onCopy}>
              {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
            </button>
          </Tooltip>
          {isUser && canEdit && (
            <Tooltip label="修改并重新发送这条消息" side="bottom">
              <button
                type="button"
                className="dsh-rewind-action"
                aria-label="修改该对话"
                disabled={busy}
                onClick={onOpenEditor}
              >
                <IconEditOutline16 />
              </button>
            </Tooltip>
          )}
          {isUser && canRetry && (
            <Tooltip label="重新生成这条消息的回复" side="bottom">
              <button
                type="button"
                className="dsh-rewind-action"
                aria-label="重新生成回复"
                disabled={busy}
                onClick={onRetry}
              >
                <IconRefreshOutline16 />
              </button>
            </Tooltip>
          )}
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
        )}
        {error !== null && <p className="dsh-rewind-error">{error}</p>}
      </div>
      <Modal
        open={confirmOpen}
        onClose={() => { if (!busy) setConfirmOpen(false) }}
        title="退回确认"
        description={diffInfo !== null ? describeDiff(diffInfo) : '将回退工作区文件到这条消息发送前的状态，并消除这条消息及之后的上下文。'}
        footer={(
          <>
            <Button variant="outline" disabled={busy} onClick={() => { if (!busy) setConfirmOpen(false) }}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={onConfirmRewind}>退回</Button>
          </>
        )}
      >
        {diffInfo !== null && (() => {
          // 逐个列出具体文件路径（每类最多 8 条，超出折叠为计数）——用户需要
          // 在确认前确切知道哪些文件会被动到，不做目录级聚合。
          const shownMod = diffInfo.modified.slice(0, 8)
          const shownAdded = diffInfo.added.slice(0, 8)
          const shownDel = diffInfo.deleted.slice(0, 8)
          const modMore = Math.max(0, diffInfo.modified.length - shownMod.length)
          const addedMore = Math.max(0, diffInfo.added.length - shownAdded.length)
          const delMore = Math.max(0, diffInfo.deleted.length - shownDel.length)
          return (
            <ul className="dsh-rewind-diffList">
              {shownMod.map((f) => (
                <li key={`m-${f}`} className="dsh-rewind-diffItem"><span className="dsh-rewind-diffTag dsh-rewind-diffMod">改</span><span className="dsh-rewind-diffPath">{f}</span></li>
              ))}
              {modMore > 0 && <li className="dsh-rewind-diffMore">… 另有 {modMore} 个已修改文件</li>}
              {shownAdded.map((f) => (
                <li key={`a-${f}`} className="dsh-rewind-diffItem"><span className="dsh-rewind-diffTag dsh-rewind-diffAdd">增</span><span className="dsh-rewind-diffPath">{f}</span></li>
              ))}
              {addedMore > 0 && <li className="dsh-rewind-diffMore">… 另有 {addedMore} 个新增文件</li>}
              {shownDel.map((f) => (
                <li key={`d-${f}`} className="dsh-rewind-diffItem"><span className="dsh-rewind-diffTag dsh-rewind-diffDel">删</span><span className="dsh-rewind-diffPath">{f}</span></li>
              ))}
              {delMore > 0 && <li className="dsh-rewind-diffMore">… 另有 {delMore} 个已删除文件</li>}
            </ul>
          )
        })()}
      </Modal>
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
  // modelDirectories（ui-model-selection）就绪后再接线：辅助视觉徽章需要
  // 当前会话的共享模型目录来读「当前选中模型」。
  ctx.inject(['slots', 'sessions', 'workspaces', 'modelDirectories'], (scope) => {
    const sessions = scope.sessions
    const workspaces = scope.workspaces
    const models = scope.modelDirectories
    const injectFace = (sessionId: SessionId): RewindInjected => ({
      sessions,
      workspaces,
      directory: models.directoryFor(sessionId).store,
    })
    scope.slots.inject('conversation.chat.node', () => scope.slots.register({
      name: 'conversation.chat.node',
      key: 'user',
      priority: -100,
      locale: 'conversation',
      inject: injectFace,
    }, UserRewindNodeView))
    scope.slots.inject('conversation.chat.node', () => scope.slots.register({
      name: 'conversation.chat.node',
      key: 'steering',
      priority: -100,
      locale: 'conversation',
      inject: injectFace,
    }, UserRewindNodeView))
  })
}
