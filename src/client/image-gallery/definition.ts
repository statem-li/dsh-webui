/**
 * dsh-image-gallery — 生图结果会话节点定义。
 *
 * 监听会话事件流里 generate_image 工具的生命周期：
 *   1. tool/call（name=generate_image）→ start，记住调用身份与 prompt；
 *   2. tool/result（content 文本含 imageUrl）→ update，解析生成的图片 URL；
 * 同一 callId 的事件归并到同一个 Context，最终发布为「生成的图片」画廊节点。
 *
 * 匹配策略刻意精确：
 *   - tool/call 只匹配生图工具名（避免为其它工具建 Context）；
 *   - tool/result 只匹配文本里含 "imageUrl" 的结果（生图成功的特征），
 *     其余工具的 result 不产生任何匹配，不留 pending Context。
 */
import type {
  ConversationMatch,
  ConversationNodeContext,
  ConversationNodeDefinition,
  ConversationLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'

/** 一张成功生成、可展示的图片。 */
export interface GeneratedImageEntry {
  readonly callId: string
  readonly model: string | null
  readonly url: string
  readonly prompt: string | null
}

/** 发布到 Chat 渲染器的载荷。 */
export interface GeneratedImagesChatData {
  readonly images: readonly GeneratedImageEntry[]
  /** 来源工具名（generate_image / browser_screenshot），用于区分标题。 */
  readonly toolName: string
}

interface GeneratedImagesState extends GeneratedImagesChatData {
  readonly toolName: string
  readonly promptRaw: string | null
}

/** 当前识别的图片工具名（宿主可增减；这里覆盖 dsh-vision-helper 的 generate_image 与 AI 浏览器的 browser_screenshot / browser_see）。 */
const IMAGE_TOOL_NAMES = new Set(['generate_image', 'browser_screenshot', 'browser_see'])

function isImageToolName(value: string): boolean {
  return IMAGE_TOOL_NAMES.has(value)
}

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
  return { urls, model: typeof record.model === 'string' ? record.model : null }
}

/** 从 tool/call arguments（JSON 字符串）里取 prompt 字段。 */
function parsePrompt(argumentsRaw: string): string | null {
  try {
    const parsed = JSON.parse(argumentsRaw) as { prompt?: unknown }
    return typeof parsed.prompt === 'string' ? parsed.prompt : null
  } catch {
    return null
  }
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/** 只含 result（start 被窗口截断）时，从 matches 里回演出画廊状态。 */
function fallbackState(context: ConversationNodeContext): GeneratedImagesState | undefined {
  let images: GeneratedImageEntry[] = []
  for (const match of context.matches) {
    if (match.event.type !== 'tool/result') continue
    const text = resultText(match.event.data.message.content)
    if (text === null) continue
    const parsed = parseImageResult(text)
    if (parsed === null) continue
    const callId = String(match.event.data.message.source.callId)
    for (const url of parsed.urls) {
      images = [...images, { callId, model: parsed.model, url, prompt: null }]
    }
  }
  return images.length === 0 ? undefined : { toolName: 'generate_image', promptRaw: null, images }
}

/** 生图画廊会话节点定义（Chat 目标）。 */
export const generatedImagesDefinition: ConversationNodeDefinition<GeneratedImagesState> = {
  kind: 'generated-images',
  target: 'chat',
  match: (event): { id: string; role: 'start' | 'update' } | null => {
    if (event.type === 'tool/call') {
      return isImageToolName(event.data.name)
        ? { id: String(event.data.callId), role: 'start' }
        : null
    }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      const text = resultText(event.data.message.content)
      if (!isImageResultText(text)) return null
      const callId = event.data.message.source.callId
      return { id: String(callId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool/call') throw new Error('generated-images start requires tool/call')
    return {
      toolName: match.event.data.name,
      promptRaw: parsePrompt(match.event.data.arguments),
      images: [],
    }
  },
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
      prompt: context.state.promptRaw,
    }))
    return { ...context.state, images: [...context.state.images, ...entries] }
  },
  publication: () => 'immediate',
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
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
      data: { images: state.images, toolName: state.toolName } satisfies GeneratedImagesChatData,
    }
  },
}