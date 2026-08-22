/**
 * webui — 对话完成胶囊（host 半身）。
 *
 * 全局监听 `session/event`（含后台会话）：任一会话 turn/end 时提取
 *   - 会话标题（session/title 事件 > cwd basename > session id）
 *   - 触发回合的用户问题（回合内最后一条真人 user/message 的文本）
 *   - 助手回复全文（本回合 assistant/message 的 text 块按序拼接）
 * 存入内存完成列表（最近 MAX_ITEMS 条，seq 单调递增）。
 * GET /api/webui-done-pill?since=N 供前端轮询增量（items = seq > N，升序）。
 *
 * 设计约束：
 *  - 只报非 subagent 会话（header.origin === 'subagent' 跳过）；
 *  - aborted 回合不算完成（用户主动停止）；
 *  - 最小服务契约（与 rewind.ts 同款做法），不引入 dsh-session 类型依赖。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

const ROUTE = '/api/webui-done-pill'
/** 内存完成列表上限。 */
const MAX_ITEMS = 50
/** 单条问题/回复文本上限（超出截断加省略号；本地回传足够展示全文）。 */
const MAX_TEXT_CHARS = 20000

// ── 最小服务契约 ────────────────────────────────────────────────────────────

interface SessionLike {
  id: string
  header?: { cwd?: string; origin?: string }
  events?: readonly SessionEventLike[]
}

interface SessionEventLike {
  type: string
  seq: number
  data?: {
    turn?: number
    title?: unknown
    reason?: { kind?: unknown }
    message?: { content?: unknown }
    content?: unknown
    source?: { kind?: unknown }
  }
}

interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServerService {
  register(route: WebServerRoute): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServerService
  }
}

// ── 数据结构 ────────────────────────────────────────────────────────────────

export interface DonePillEntry {
  /** 单调递增序号（也是增量拉取水位）。 */
  seq: number
  /** 稳定 id（seq 字符串化，供前端去重/已读标记）。 */
  id: string
  sessionId: string
  /** 会话显示标题（title 事件 > cwd basename > id）。 */
  title: string
  /** 触发回合的用户问题文本（找不到真人消息时为空串）。 */
  question: string
  /** 本回合助手回复全文（text 块拼接）。 */
  answer: string
  /** 回合结束时间戳。 */
  endedAt: number
  turn: number
  /** 结束原因 kind（error 时前端标注「出错结束」）。 */
  reasonKind: string
}

/** 内容块数组 → 纯文本（text 块取原文；image 等非文本块输出占位标记）。 */
function blocksToText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const type = (block as { type?: unknown }).type
    if (type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    } else if (type === 'image') {
      parts.push('[图片]')
    }
  }
  return parts.join('\n').trim()
}

function clampText(text: string): string {
  return text.length <= MAX_TEXT_CHARS ? text : `${text.slice(0, MAX_TEXT_CHARS)}…`
}

/** cwd → 显示名（与 client displayTitleOf 同款规则：去尾分隔符取末段）。 */
function workspaceTitleOf(cwd: string): string {
  return cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
}

// ── 插件体 ──────────────────────────────────────────────────────────────────

export function applyDonePill(ctx: Context): void {
  const titles = new Map<string, string>()
  const items: DonePillEntry[] = []
  // 正在执行的回合：turn/start 时记录开始时间 + 触发消息（该会话最近的
  // 真人 user/message，steering 中途插话也跟随更新）+ 会话标题快照，
  // turn/end 移除（含 aborted）。供前端展示「正在执行的消息 + 实时时长」。
  // 服务重启后清零。subagent 回合不进表（与完成列表口径一致）。
  const runningTurns = new Map<string, { since: number; question: string; title: string }>()
  const lastQuestions = new Map<string, string>()
  // seq = 启动时间戳 + 计数器：进程内单调；重启后启动时间戳变大，
  // 新 seq 必然大于客户端在旧进程里见过的所有 seq（增量水位永不回绕卡死）。
  const seqBase = Date.now()
  let counter = 0

  /** 会话显示标题：缓存 title 事件 > 日志反查 > cwd basename > id。 */
  function titleOf(session: SessionLike): string {
    const cached = titles.get(session.id)
    if (cached !== undefined && cached !== '') return cached
    const events = session.events ?? []
    for (let i = events.length - 1; i >= 0; i--) {
      const data = events[i]?.data
      if (events[i]?.type === 'session/title' && typeof data?.title === 'string' && data.title !== '') {
        titles.set(session.id, data.title)
        return data.title
      }
    }
    const cwd = session.header?.cwd
    if (typeof cwd === 'string' && cwd !== '') {
      const base = workspaceTitleOf(cwd)
      if (base !== '') return base
    }
    return session.id
  }

  /**
   * 反向扫描事件日志：收集本回合 assistant/message 文本（保持正序拼接），
   * 遇到第一条真人 user/message 记为触发问题后停止。
   */
  function extractTurnTexts(events: readonly SessionEventLike[], turn: number): { question: string; answer: string } {
    const answerParts: string[] = []
    let question = ''
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event === undefined) continue
      if (event.type === 'assistant/message') {
        if (event.data?.turn === turn) {
          const text = blocksToText(event.data.message?.content)
          if (text !== '') answerParts.push(text)
        }
        continue
      }
      if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
        question = clampText(blocksToText(event.data.content))
        break
      }
    }
    return { question, answer: clampText(answerParts.reverse().join('\n\n')) }
  }

  ctx.on('session/event', ((session: SessionLike, event: SessionEventLike) => {
    try {
      if (event.type === 'session/title') {
        if (typeof event.data?.title === 'string' && event.data.title !== '') {
          titles.set(session.id, event.data.title)
        }
        return
      }
      if (event.type === 'user/message') {
        // 真人消息（含 queued / steering）：记录为该会话最新触发消息；
        // 若回合已在执行中，同步刷新正在执行的消息展示。
        if (event.data?.source?.kind === 'user') {
          const text = clampText(blocksToText(event.data.content))
          if (text !== '') {
            lastQuestions.set(session.id, text)
            const running = runningTurns.get(session.id)
            if (running !== undefined) runningTurns.set(session.id, { ...running, question: text })
          }
        }
        return
      }
      if (event.type === 'turn/start') {
        if (session.header?.origin === 'subagent') return
        runningTurns.set(session.id, { since: Date.now(), question: lastQuestions.get(session.id) ?? '', title: titleOf(session) })
        return
      }
      if (event.type !== 'turn/end') return
      // 回合结束（含 aborted / subagent）都清除执行计时。
      runningTurns.delete(session.id)
      lastQuestions.delete(session.id)
      if (session.header?.origin === 'subagent') return
      const reasonKind = typeof event.data?.reason?.kind === 'string' ? event.data.reason.kind : ''
      if (reasonKind === 'aborted') return
      const turn = typeof event.data?.turn === 'number' ? event.data.turn : -1
      const events = session.events ?? []
      const { question, answer } = extractTurnTexts(events, turn)
      // 空回合（无回复也无提问，例如纯斜杠命令回合）不值得上报。
      if (question === '' && answer === '') return
      counter += 1
      const seq = seqBase + counter
      items.push({
        seq,
        id: String(seq),
        sessionId: session.id,
        title: titleOf(session),
        question,
        answer,
        endedAt: Date.now(),
        turn,
        reasonKind,
      })
      if (items.length > MAX_ITEMS) items.splice(0, items.length - MAX_ITEMS)
    } catch (error) {
      ctx.logger?.warn?.(`[webui-done-pill] turn/end handling failed for ${session.id}: ${String(error)}`)
    }
  }) as never, { global: true })

  const webServer = ctx.get('webServer') as WebServerService | undefined
  if (webServer === undefined) return
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
        return
      }
      let since = 0
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const raw = url.searchParams.get('since')
        if (raw !== null && /^\d+$/.test(raw)) since = Number(raw)
      } catch { /* since 解析失败按 0 处理 */ }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({
        ok: true,
        version: seqBase + counter,
        items: items.filter(item => item.seq > since),
        running: [...runningTurns.entries()].map(([sessionId, info]) => ({
          sessionId,
          since: info.since,
          question: info.question,
          title: info.title,
        })),
      }))
    },
  }), 'webui: done-pill route')

  console.log(`[dsh-webui] done-pill mounted: ${ROUTE} (global session/event listener active)`)
}
