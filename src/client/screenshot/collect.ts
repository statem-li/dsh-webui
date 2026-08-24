/**
 * webui — 对话截图：会话消息抽取（client 端）。
 *
 * 从 ConversationSnapshot 里按范围取出可截图的文本：
 *  - reply：当前这条 AI 回复；
 *  - turn：这条回复所在的一轮（我的提问 + AI 回复，含同轮内多步回复）；
 *  - all：整段会话（按时间顺序的全部提问与回复）。
 *
 * 只取文本块：reasoning（思考）、tool-call（工具调用）、图片附件不进截图——
 * 截图是给人看的成稿，不是调试轨迹。
 */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 截图范围。 */
export type ShotRange = 'reply' | 'turn' | 'all'

/** 一条待截图消息。 */
export interface ShotMessage {
  role: 'user' | 'assistant'
  text: string
}

/** turn-tail 节点的 data 里我们用到的部分（避免依赖内部实现细节）。 */
interface TailData {
  turn?: number
  closing?: {
    finalNode?: { messageId?: unknown }
    blocks?: readonly { kind?: string; text?: string }[]
  } | null
}

/** user 节点的 data 里我们用到的部分。 */
interface UserData {
  content?: readonly { type?: string; text?: string }[]
}

/** 拼接 assistant 文本块（丢弃思考/工具/图片块）。 */
function assistantText(data: TailData): string {
  const blocks = data.closing?.blocks ?? []
  return blocks
    .filter(block => block.kind === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('')
}

/** 拼接 user 文本块。 */
function userText(data: UserData): string {
  const content = data.content ?? []
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('')
}

/** 把一个 chat 节点转成待截图消息（不可截图则返回 null）。 */
function toMessage(node: { kind: string; data: unknown } | undefined): ShotMessage | null {
  if (node === undefined) return null
  if (node.kind === 'user') {
    const text = userText(node.data as UserData)
    return text.trim() === '' ? null : { role: 'user', text }
  }
  if (node.kind === 'turn-tail') {
    const text = assistantText(node.data as TailData)
    return text.trim() === '' ? null : { role: 'assistant', text }
  }
  return null
}

/** 找到承载指定 messageId 的 turn-tail 节点键与轮次。 */
function locateTail(snapshot: ConversationSnapshot, messageId: unknown): { key: string; turn: number } | null {
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key)
    if (node === undefined || node.kind !== 'turn-tail') continue
    const data = node.data as TailData
    if (data.closing?.finalNode?.messageId !== messageId) continue
    return { key, turn: typeof data.turn === 'number' ? data.turn : -1 }
  }
  return null
}

/**
 * 按范围抽取待截图消息。
 * @param snapshot - 当前会话快照。
 * @param messageId - 触发截图的那条 AI 回复的 id。
 * @param range - 截图范围。
 * @returns 时间顺序的消息数组（空数组表示无可截内容）。
 */
export function collectMessages(
  snapshot: ConversationSnapshot,
  messageId: unknown,
  range: ShotRange,
): ShotMessage[] {
  const located = locateTail(snapshot, messageId)
  if (range === 'reply') {
    if (located === null) return []
    const message = toMessage(snapshot.chat.nodes.get(located.key))
    return message === null ? [] : [message]
  }
  if (range === 'turn') {
    if (located === null || located.turn < 0) return []
    const out: ShotMessage[] = []
    for (const key of snapshot.chat.locations.getTurn(located.turn)) {
      const message = toMessage(snapshot.chat.nodes.get(key))
      if (message !== null) out.push(message)
    }
    return out
  }
  const out: ShotMessage[] = []
  for (const key of snapshot.chat.order) {
    const message = toMessage(snapshot.chat.nodes.get(key))
    if (message !== null) out.push(message)
  }
  return out
}
