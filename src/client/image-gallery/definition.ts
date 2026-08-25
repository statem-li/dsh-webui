/**
 * dsh-image-gallery — 生图结果会话节点定义。
 *
 * 监听会话事件流里生图工具的成功结果（tool/result 文本含 imageUrl 指纹），
 * 按「轮次（turn）」归并：同一轮 assistant 回合里的所有生图结果聚进同一个
 * 画廊节点，多图在节点内并排一行（放不下自动换行），不再一次调用占一行。
 *
 * 引擎语义利用（conversation-assembler）：
 *   - 本 definition 不 match tool/call，即 Context 永远没有 start Match；
 *   - 同一 turn 的每条生图 result 以 update 角色进入同一个 Context
 *     （id = turn-N）。引擎对「无 start 的纯 update Context」不会调用
 *     start()/update()，state 保持 undefined，但 matches 照常按 seq 累积；
 *   - buildViewNode 直接从 matches 回演出图片列表——事件数据全部来自
 *     日志，重放/翻页（prepend 合并 matches）结果确定。
 * 这样规避了「同 id 收到第二个 start Match 会 throw」的引擎不变量，
 * 同时拿到跨调用归并。
 */
import type {
  ConversationMatch,
  ConversationNodeContext,
  ConversationNodeDefinition,
  ConversationLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import { registerGeneratedImageUrls } from './registry'

/** 一张成功生成、可展示的图片。 */
export interface GeneratedImageEntry {
  readonly callId: string
  readonly model: string | null
  readonly url: string
}

/** 发布到 Chat 渲染器的载荷。 */
export interface GeneratedImagesChatData {
  readonly images: readonly GeneratedImageEntry[]
}

interface GeneratedImagesState extends GeneratedImagesChatData {}

/** 从 tool/result 的 message.content 里取第一个纯文本块。 */
function resultText(content: readonly unknown[]): string | null {
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; content?: unknown }
    if (candidate.type !== 'tool-result') continue
    const inner = Array.isArray(candidate.content) ? candidate.content : []
    for (const part of inner) {
      if (part === null || typeof part !== 'object') continue
      const textBlock = part as { type?: unknown; text?: unknown }
      if (textBlock.type === 'text' && typeof textBlock.text === 'string') return textBlock.text
    }
  }
  return null
}

/** 生图成功的文本结果里一定带 imageUrl 字段——用这个做 result 侧的低成本指纹。 */
function isImageResultText(text: string | null): boolean {
  return text !== null && /"imageUrl"\s*:/.test(text)
}

/** 解析生图结果 JSON：{ ok, model, imageUrls?/imageUrl? } → 展示 URL 列表。 */
function parseImageResult(text: string): { urls: readonly string[]; model: string | null } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const record = parsed as {
    ok?: unknown
    model?: unknown
    imageUrls?: unknown
    imageUrl?: unknown
    imageDataUrl?: unknown
  }
  if (record.ok !== true) return null
  const urls: string[] = []
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value !== '' && !urls.includes(value)) urls.push(value)
  }
  if (Array.isArray(record.imageUrls)) {
    for (const item of record.imageUrls) push(item)
  }
  // 单图字段兜底（旧版工具结果 / imageDataUrl）
  push(record.imageUrl)
  if (typeof record.imageDataUrl === 'string' && record.imageDataUrl) push(record.imageDataUrl)
  if (urls.length === 0) return null
  // 登记进共享注册表：markdown 渲染器靠它识别「回复正文里 ![]() 引用的图是不是生图结果」。
  registerGeneratedImageUrls(urls)
  return { urls, model: typeof record.model === 'string' ? record.model : null }
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/** 从 matches（本 turn 的全部生图 result）回演出画廊状态——本 definition 的唯一状态来源。 */
function stateFromMatches(context: ConversationNodeContext): GeneratedImagesState | undefined {
  let images: GeneratedImageEntry[] = []
  for (const match of context.matches) {
    if (match.event.type !== 'tool/result') continue
    const text = resultText(match.event.data.message.content)
    if (text === null) continue
    const parsed = parseImageResult(text)
    if (parsed === null) continue
    const callId = String(match.event.data.message.source.callId)
    for (const url of parsed.urls) {
      images = [...images, { callId, model: parsed.model, url }]
    }
  }
  return images.length === 0 ? undefined : { images }
}

/** 生图画廊会话节点定义（Chat 目标，按 turn 归并）。 */
export const generatedImagesDefinition: ConversationNodeDefinition<GeneratedImagesState> = {
  kind: 'generated-images',
  target: 'chat',
  match: (event): { id: string; role: 'update' } | null => {
    // 只认生图成功的 result；同一 turn 的所有结果归并到同一个 Context。
    // 刻意不 match tool/call：没有 start Match 就不会触发引擎的
    // 「同 id 二次 start」不变量，归并得以安全进行。
    if (event.type !== 'tool/result' || !isAppendSurfaceEvent(event)) return null
    const text = resultText(event.data.message.content)
    if (!isImageResultText(text)) return null
    return { id: `turn-${event.data.turn}`, role: 'update' }
  },
  // 引擎不变量下 start()/update() 不会被调用（本 definition 无 start Match，
  // 纯 update 的 Context 引擎不调用这两个钩子）；实现仅为满足接口并兜底。
  start: () => ({ images: [] }),
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    const text = resultText(match.event.data.message.content)
    if (text === null) return context.state
    const parsed = parseImageResult(text)
    if (parsed === null) return context.state
    const callId = String(match.event.data.message.source.callId)
    const entries: GeneratedImageEntry[] = parsed.urls.map(url => ({
      callId,
      model: parsed.model,
      url,
    }))
    return { images: [...context.state.images, ...entries] }
  },
  publication: () => 'immediate',
  buildViewNode: (context) => {
    const state = context.state ?? stateFromMatches(context)
    if (state === undefined || state.images.length === 0) return null
    const anchor = context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0
    return {
      key: context.key,
      kind: 'generated-images',
      id: context.id,
      target: 'chat',
      anchorSeq: anchor,
      location: locationOf(context),
      visibility: 'visible',
      data: { images: state.images } satisfies GeneratedImagesChatData,
    }
  },
}
