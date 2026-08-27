import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import MarkdownRender, { MarkdownCodeBlockNode } from 'markstream-react'
import type { NodeComponentProps } from 'markstream-react'
import type {
  CodeBlockNode,
  CustomComponentNode,
  HeadingNode,
  ImageNode,
  InlineCodeNode,
  LinkNode,
  ParagraphNode,
  ParsedNode,
} from 'stream-markdown-parser'
import { IconThinkOutline14, JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { ImageGallery } from '@deepseek-ai/dsh-client-ui-attachment'
import type { ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment'
import type {
  AssistantChatData, ChatNode, ChatNodeViewProps, ChatViewSlotProps, TurnTailOwnerProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { SHIKI_LANGUAGES } from './shiki.ts'
import { activityBus } from './activity-bus.ts'
import { DiagramBlock, isDiagramLang } from './diagram.tsx'
import { MoodBlock, isMoodLang } from '../mood/MoodBlock.tsx'
import { FlowCard, type ReplyCardMeta } from './flow-card.tsx'
import { isGeneratedImageUrl } from '../image-gallery/registry'
import { DEFAULT_GALLERY_LABELS, GalleryStrip } from '../image-gallery/GalleryStrip'
import { sanitizeHtmlFragment } from '../../shared/sanitize-html.ts'

const CUSTOM_COMPONENT_SCOPE = 'dsh-better-markdown'

function isFileMentions(value: unknown): value is MarkdownFileMentions {
  return typeof value === 'object' && value !== null && 'resolve' in value
    && typeof value.resolve === 'function'
}

function rendererFileMentions(ctx: NodeComponentProps['ctx']): MarkdownFileMentions | undefined {
  const value = ctx?.codeBlockProps?.fileMentions
  return isFileMentions(value) ? value : undefined
}

function safeLink(url: string): string | undefined {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? url : undefined
  } catch {
    return undefined
  }
}

function remoteImage(url: string): string | undefined {
  const safe = safeLink(url)
  return safe?.startsWith('http:') || safe?.startsWith('https:') ? safe : undefined
}

/** Preserve DSH's external-only Markdown image policy. */
export function DshImageNode({ node }: NodeComponentProps<ImageNode>) {
  const src = remoteImage(node.src)
  if (src === undefined) return <span className="dsh-better-markdown__image-alt">{node.alt}</span>
  return <img className="dsh-better-markdown__image" src={src} alt={node.alt} title={node.title ?? undefined} referrerPolicy="no-referrer" />
}

/** image_strip 自定义节点类型名（postTransform 聚合产物，渲染器按 type 查组件）。 */
const IMAGE_STRIP_TYPE = 'image_strip'

/**
 * markdown 生图画廊条：回复正文里连续出现的生图结果图片（模型用 ![]() 把
 * generate_image 的 URL 复制进了总结卡），原先每张都渲染成 max-width:100% 的
 * 大图、竖排占满整行，非常浪费空间。这里把它们重排成与消息流画廊一致的样式——
 * 多张并排缩略图（带序号角标）、单张小图（≤360px），点击打开全屏 Lightbox。
 * 仅当图片 URL 命中 image-gallery 注册表（确为生图结果）才生效；
 * 普通 markdown 图片（文档截图等）完全不受影响。
 */
export function MarkdownImageStrip({ node }: NodeComponentProps<CustomComponentNode>) {
  const images = useMemo(() => {
    const children = Array.isArray(node.children) ? node.children : []
    const result: { src: string; alt: string }[] = []
    for (const child of children) {
      if (child === null || typeof child !== 'object') continue
      const candidate = child as { type?: unknown; src?: unknown; alt?: unknown }
      if (candidate.type !== 'image' || typeof candidate.src !== 'string') continue
      const src = remoteImage(candidate.src)
      if (src === undefined || !isGeneratedImageUrl(src)) continue
      result.push({ src, alt: typeof candidate.alt === 'string' ? candidate.alt : '' })
    }
    return result
  }, [node.children])
  if (images.length === 0) return null
  return (
    <GalleryStrip images={images.map(image => ({ url: image.src, model: null }))} labels={DEFAULT_GALLERY_LABELS} />
  )
}

/** 段落是否为「纯图片段落」（只含 image，可夹空白文本）；是则返回其中的 image 列表。 */
function paragraphImages(node: ParsedNode): ImageNode[] | null {
  if (node.type !== 'paragraph') return null
  const children = ((node as ParagraphNode).children ?? []) as ParsedNode[]
  if (children.length === 0) return null
  const images: ImageNode[] = []
  for (const child of children) {
    if (child.type === 'image') { images.push(child as ImageNode); continue }
    // 行尾空白/换行产生的空 text 允许夹带
    if (child.type === 'text' && typeof (child as { content?: unknown }).content === 'string'
      && String((child as { content?: unknown }).content).trim() === '') continue
    return null
  }
  return images
}

/**
 * postTransform：把顶层连续的「纯图片段落」聚合成单个 image_strip 自定义节点。
 * 仅当段内全部图片都是注册表登记过的生图结果 URL 才聚合——普通 markdown 图片
 * 的节点结构原样保留，渲染行为零变化。流式增量解析下该变换幂等（每次全量
 * 重 parse，同一文本产出同一结构），不会引起节点来回跳动。
 */
function collectImageStrips(nodes: ParsedNode[]): ParsedNode[] {
  const out: ParsedNode[] = []
  let pending: ImageNode[] = []
  const flush = (): void => {
    if (pending.length === 0) return
    const strip = {
      type: IMAGE_STRIP_TYPE,
      tag: IMAGE_STRIP_TYPE,
      content: '',
      children: pending,
      raw: '',
    } as unknown as ParsedNode
    out.push(strip)
    pending = []
  }
  for (const node of nodes) {
    const images = paragraphImages(node)
    if (images !== null && images.every(image => isGeneratedImageUrl(image.src))) {
      pending.push(...images)
      continue
    }
    flush()
    out.push(node)
  }
  flush()
  return out
}

/** Markstream 的节点后处理：目录锚点注入 + 生图图片条聚合。 */
function postProcessNodes(nodes: ParsedNode[]): ParsedNode[] {
  return injectHeadingIds(collectImageStrips(nodes))
}

/** Preserve safe external links while leaving relative and unsafe targets inert. */
export function DshLinkNode({ node, children }: NodeComponentProps<LinkNode>) {
  const href = safeLink(node.href)
  if (href === undefined) return <>{children ?? node.text}</>
  return <a href={href} target="_blank" rel="noopener noreferrer">{children ?? node.text}</a>
}

/** Preserve DSH's URL promotion and settled file-mention behavior for inline code. */
export function DshInlineCodeNode({ node, ctx }: NodeComponentProps<InlineCodeNode>) {
  const href = safeLink(node.code)
  if (href?.startsWith('http:') || href?.startsWith('https:')) {
    return <code><a href={href} target="_blank" rel="noopener noreferrer">{node.code}</a></code>
  }
  const mention = rendererFileMentions(ctx)?.resolve(node.code)
  if (mention !== undefined) {
    return (
      <code>
        <button
          type="button"
          className="dsh-better-markdown__file-mention"
          title={mention.title}
          aria-label={mention.label}
          onClick={mention.open}
        >
          {node.code}
        </button>
      </code>
    )
  }
  return <code>{node.code}</code>
}

/**
 * Fenced code blocks. mermaid 围栏（及各图种关键字）走 DiagramBlock 渲染成图，
 * 引擎按需加载（见 diagram.tsx）；`mood` 围栏走 MoodBlock 渲染成自述卡片
 * （见 mood/MoodBlock.tsx）；其余语言仍走 Markstream 的 worker-free Shiki。
 */
export function DshCodeBlockNode({ node, ctx }: NodeComponentProps<CodeBlockNode>) {
  if (isDiagramLang(node.language)) {
    return <DiagramBlock node={node} isDark={ctx?.isDark ?? false} />
  }
  if (isMoodLang(node.language)) {
    return <MoodBlock node={node} />
  }
  return (
    <MarkdownCodeBlockNode
      node={node}
      loading={node.loading}
      stream={ctx?.codeBlockStream ?? true}
      isDark={ctx?.isDark ?? false}
      langs={SHIKI_LANGUAGES}
      onCopy={ctx?.events.onCopy}
    />
  )
}

/**
 * Current color scheme as a stable snapshot: true when the theme presenter
 * applied `body[data-ds-dark-theme]`. Follows live theme switches via a
 * MutationObserver so code blocks re-highlight without a reload.
 */
function useIsDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof document === 'undefined') return () => {}
      const observer = new MutationObserver(onChange)
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      return () => { observer.disconnect() }
    },
    () => typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme'),
  )
}

/** 从标题文本生成稳定的 URL slug（保留中文/字母/数字，其余转连字符）。 */
function slugify(text: string): string {
  const base = text.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'section'
}

/** 剥离常见行内 Markdown 标记，得到与 parser 提取文本接近的纯文本。 */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
}

/** 同名 slug 去重：首个原样，其后追加 -2/-3… */
function dedupSlug(used: Map<string, number>, slug: string): string {
  const count = used.get(slug) ?? 0
  used.set(slug, count + 1)
  return count === 0 ? slug : `${slug}-${count + 1}`
}

/** 给标题节点注入 attrs.id，供 TOC 锚点跳转（内置 HeadingNode 会透传 attrs）。 */
function injectHeadingIds(nodes: ParsedNode[]): ParsedNode[] {
  const used = new Map<string, number>()
  return nodes.map((node) => {
    if (node.type !== 'heading') return node
    const heading = node as HeadingNode
    const id = dedupSlug(used, slugify(heading.text ?? ''))
    return { ...heading, attrs: { ...(heading.attrs ?? {}), id } }
  })
}

interface HeadingInfo {
  readonly level: number
  readonly text: string
  readonly id: string
}

/** 从 Markdown 源码提取标题列表（跳过代码围栏），生成与 postTransformNodes 一致的 id。 */
function extractHeadings(text: string): HeadingInfo[] {
  const result: HeadingInfo[] = []
  const used = new Map<string, number>()
  let inFence = false
  for (const raw of text.split('\n')) {
    const line = raw.trimStart()
    if (/^```|^~~~/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line)
    if (!match) continue
    const level = match[1].length
    const clean = stripInlineMarkdown(match[2])
    const id = dedupSlug(used, slugify(clean))
    result.push({ level, text: clean || match[2].trim(), id })
  }
  return result
}

/**
 * 找元素最近的可滚动祖先（overflow-y 为 auto/scroll/overlay 且真的有溢出）。
 * 找不到返回 null —— 调用方据此决定是否退回 window 级滚动。
 */
function nearestScrollParent(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element.parentElement
  while (node !== null && node !== document.body && node !== document.documentElement) {
    const overflowY = window.getComputedStyle(node).overflowY
    const scrollable = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
    if (scrollable && node.scrollHeight > node.clientHeight + 1) return node
    node = node.parentElement
  }
  return null
}

/**
 * TOC 跳转：**只滚动最近的那个滚动容器**，绝不用 scrollIntoView。
 *
 * scrollIntoView 会把目标的**每一个**可滚动祖先都滚一遍，document 也算在内。
 * Markdown 正文出现在 `position:fixed` 弹层里（团队详情卡 / 交付物卡）时，
 * 浏览器为了「把元素滚进视口」会连宿主文档一起挪 —— 表现为点目录后整个壳子页面
 * 往上跳（弹层本身是 fixed 不动，底下的页面却位移了）。手动改 scrollTop 只作用于
 * 命中的那一个容器，不会外溢。
 */
function scrollToHeading(id: string): void {
  const target = document.getElementById(id)
  if (target === null) return
  const container = nearestScrollParent(target)
  // 顶部呼吸空间沿用 CSS 的 scroll-margin-top（styles.css 为标题锚点设过）。
  const marginTop = Number.parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0
  if (container === null) {
    // 没有内层滚动容器：退回窗口滚动（普通长文档场景，本就该滚页面）。
    const top = target.getBoundingClientRect().top + window.scrollY - marginTop
    window.scrollTo({ top, behavior: 'smooth' })
    return
  }
  const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top - marginTop
  container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' })
}

/** 悬浮目录：标题 ≥ 3 个时展示在 Markdown 正文上方，点击平滑滚动到对应标题。 */
function MarkdownToc({ headings }: { headings: readonly HeadingInfo[] }) {
  if (headings.length < 3) return null
  const jump = (id: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault()
    scrollToHeading(id)
  }
  return (
    <details className="dsh-better-markdown__toc" open>
      <summary className="dsh-better-markdown__toc-summary">
        <span className="dsh-better-markdown__toc-title">目录</span>
        <span className="dsh-better-markdown__toc-count">{headings.length}</span>
      </summary>
      <nav className="dsh-better-markdown__toc-nav">
        {headings.map(heading => (
          <a
            key={heading.id}
            href={`#${heading.id}`}
            className={`dsh-better-markdown__toc-item dsh-better-markdown__toc-item--l${heading.level}`}
            title={heading.text}
            onClick={jump(heading.id)}
          >
            {heading.text}
          </a>
        ))}
      </nav>
    </details>
  )
}

/**
 * 自定义 html_block / html_inline 渲染：markstream 内置的 HtmlBlockNode 会走
 * 「结构化渲染」把 HTML 内部再解析一遍，模型输出的整篇 HTML（缩进行、`<a>`、
 * `<span>` 等）被误解析成 Text 代码块堆。这里直接用净化后的原始 HTML 交给
 * 浏览器原生解析（dangerouslySetInnerHTML），样式属性保留、效果与截图管线一致。
 * 净化（sanitizeHtmlFragment）与 host 截图管线共用 src/shared/sanitize-html.ts：
 * 剔除结构风险标签、剥事件属性、URL 协议白名单、style 值消毒。
 */
export function WebuiHtmlBlockNode({ node }: NodeComponentProps<{ type: 'html_block'; content: string; tag?: string }>) {
  const html = useMemo(() => sanitizeHtmlFragment(
    typeof node.content === 'string' ? node.content : '',
  ), [node.content])
  if (html === '') return null
  return <div className="dsh-better-markdown__html" dangerouslySetInnerHTML={{ __html: html }} />
}

export function WebuiHtmlInlineNode({ node }: NodeComponentProps<{ type: 'html_inline'; content: string; tag?: string }>) {
  const html = useMemo(() => sanitizeHtmlFragment(
    typeof node.content === 'string' ? node.content : '',
  ), [node.content])
  if (html === '') return null
  return <span className="dsh-better-markdown__html-inline" dangerouslySetInnerHTML={{ __html: html }} />
}

/**
 * Markstream wrapper configured for assistant output with raw-HTML rendered.
 * 历史：曾用 htmlPolicy="escape"（原始 HTML 一律转义成源码），模型输出整篇
 * HTML（如带内联样式的公告/总结卡）显示为纯文本；改用 "trusted" 解析，并以
 * 自定义 html_block/html_inline 组件（WebuiHtmlBlockNode/WebuiHtmlInlineNode）
 * 接管渲染，避免 markstream 结构化渲染把 HTML 误解析成代码块。
 */
export const MarkstreamMarkdown = memo(function MarkstreamMarkdown({ text, streaming, fileMentions }: {
  text: string
  streaming: boolean
  fileMentions?: MarkdownFileMentions | undefined
}) {
  const isDark = useIsDark()
  const codeBlockProps = useMemo(() => ({
    fileMentions: streaming ? undefined : fileMentions,
  }), [fileMentions, streaming])
  const parseOptions = useMemo(() => ({ postTransformNodes: postProcessNodes }), [])
  const headings = useMemo(() => extractHeadings(text), [text])
  return (
    <div className="dsh-better-markdown__markdown" data-markdown-renderer="markstream-react">
      <MarkdownToc headings={headings} />
      <MarkdownRender
        content={text}
        final={!streaming}
        customId={CUSTOM_COMPONENT_SCOPE}
        htmlPolicy="trusted"
        fade={false}
        smoothStreaming={false}
        viewportPriority={false}
        codeBlockStream={streaming}
        codeBlockProps={codeBlockProps}
        parseOptions={parseOptions}
        isDark={isDark}
      />
    </div>
  )
})

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** A ticking clock for live elapsed-time displays. */
function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => { setNow(Date.now()) }, intervalMs)
    return () => { clearInterval(id) }
  }, [active, intervalMs])
  return now
}

/** Format an elapsed millisecond duration for compact display. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--'
  const seconds = ms / 1000
  if (seconds < 1) return `${Math.round(ms)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  return `${minutes}m ${rest.toString().padStart(2, '0')}s`
}

/** One reasoning entry inside the turn-level group. */
interface ReasoningItem {
  readonly text: string
  /** Whether its owning step is still streaming. */
  readonly running: boolean
}

/**
 * Turn-level reasoning ENTRY: instead of rendering reasoning inline (and
 * fighting the transcript scroll), one compact chip per turn opens the shared
 * activity drawer with the full reasoning material. While the turn is still
 * thinking the chip labels itself "思考中…".
 */
function ReasoningEntry({ items, running, t, turn, thinkingStart }: {
  items: readonly ReasoningItem[]
  running: boolean
  turn: number
  thinkingStart?: number | undefined
  t: ChatViewSlotProps['t']
}) {
  const bus = activityBus()
  useEffect(() => {
    bus?.setReasoning(turn, items)
  }, [bus, turn, items])
  const now = useNow(running)
  const elapsed = thinkingStart !== undefined ? Math.max(0, now - thinkingStart) : undefined
  // 当前正在输出的思考文字（最后一个仍 running 的 reasoning 文本）。
  const liveText = useMemo(() => {
    if (!running) return ''
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]
      if (item !== undefined && item.running) return item.text
    }
    return ''
  }, [items, running])
  // 跟随最新：思考文字增长时把预览框滚到底——但仅当读者停在底部。
  // 向上翻阅即停止自动跟随（想看哪里自己滚），滚回底部（≤24px）自动恢复；
  // 阈值与 ChatView 的 FOLLOW_THRESHOLD 一致。滚动事件记录「读者是否钉在底部」，
  // 纯几何判断无法区分「内容自己长高」和「读者上翻」，必须有这面旗子。
  const liveRef = useRef<HTMLDivElement | null>(null)
  const livePinnedRef = useRef(true)
  const onLiveScroll = useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    livePinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24
  }, [])
  useEffect(() => {
    if (!running) return
    const el = liveRef.current
    if (el === null) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    // 双保险：滚动事件尚未派发的一帧内，几何距离也能拦住一次误跟随。
    if (!livePinnedRef.current && distance > 24) return
    el.scrollTop = el.scrollHeight
  }, [liveText, running])

  return (
    <div className="dsh-better-markdown__reasoning-entry" data-running={running || undefined}>
      {running && <span className="dsh-better-markdown__visually-hidden">{t('row.running')}</span>}
      <button
        type="button"
        className="dsh-better-markdown__reasoning-entry-btn"
        title="点击打开本轮思考详情"
        aria-label={`本轮思考 ${items.length} 次，点击查看`}
        onClick={() => { bus?.open(turn, 'reasoning') }}
      >
        <span className="dsh-better-markdown__reasoning-entry-icon" aria-hidden><IconThinkOutline14 size={14} /></span>
        <span>
          {running
            ? elapsed !== undefined ? `思考中 · ${formatDuration(elapsed)}` : '思考中…'
            : `思考 ×${items.length}`}
        </span>
      </button>
      {running && liveText !== '' && (
        <div className="dsh-better-markdown__reasoning-live" ref={liveRef} onScroll={onLiveScroll} aria-live="polite">
          {liveText}
        </div>
      )}
    </div>
  )
}

type AssistantBlock = AssistantChatData['blocks'][number]

function BetterAssistantMarkdown({ blocks, streaming, interrupted, loadImage, mentions, t, group, card, cardMeta }: {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  interrupted?: boolean | undefined
  loadImage?: ImageLoader | undefined
  mentions?: MarkdownFileMentions | undefined
  t: ChatViewSlotProps['t']
  /** Optional content rendered above the message body (the reasoning group). */
  group?: ReactNode | undefined
  /**
   * 卡片形态：'reply' = 回合最终回复（带总结头部与统计 chip），
   * 'step' = 回合中间步骤（轻量竖线卡），undefined = 不包卡（流式中）。
   */
  card?: 'reply' | 'step' | undefined
  /** 总结卡头部的本轮统计（仅 card === 'reply' 时使用）。 */
  cardMeta?: ReplyCardMeta | undefined
}) {
  const imageLoader = loadImage ?? (() => Promise.reject(new Error(t('image.serviceUnavailable'))))
  const hasVisible = streaming || interrupted === true || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible && group === undefined) return null
  const rendered: ReactNode[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text':
        rendered.push(
          <MarkstreamMarkdown key={index} text={block.text} streaming={streaming} fileMentions={mentions} />,
        )
        break
      case 'reasoning':
        // Reasoning blocks are aggregated at the turn level by the node view;
        // a lone one (non-aggregated path) falls back to the simple row.
        rendered.push(
          <div key={index} className="dsh-better-markdown__reasoning" data-state="ok">
            <div className="dsh-better-markdown__reasoning-item">{block.text}</div>
          </div>,
        )
        break
      case 'image': {
        const start = index
        const group = [block]
        while (index + 1 < blocks.length) {
          const next = blocks[index + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          index += 1
        }
        rendered.push(
          <ImageGallery
            key={start}
            images={group}
            load={imageLoader}
            align="start"
            labels={{
              image: t('image.label'),
              open: t('image.openOriginal'),
              openNamed: label => t('image.openOriginalLabel', { label }),
              loading: t('image.loading'),
              loadFailed: t('image.loadFailed'),
              lightbox: {
                dialog: t('image.preview'),
                close: t('image.closePreview'),
              },
            }}
          />,
        )
        break
      }
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={index}
            label={t('message.unknownBlock')}
            payload={block.block}
            truncatedLabel={total => t('json.truncated', { total })}
          />,
        )
    }
  }
  return (
    <div className="dsh-better-markdown__root" data-streaming={streaming || undefined}>
      <div className="dsh-better-markdown__body">
        {group}
        {rendered.length > 0 && (card !== undefined
          ? <FlowCard variant={card} meta={cardMeta} interrupted={interrupted}>{rendered}</FlowCard>
          : <>{rendered}</>)}
        {interrupted && <span className="dsh-better-markdown__stopped">{t('message.stopped')}</span>}
      </div>
    </div>
  )
}

const EMPTY_STEPS: readonly ChatNode<'assistant-step'>[] = []

/**
 * Turn-level reasoning entry: the FIRST assistant step of a turn renders one
 * compact chip (reasoning material is pushed to the shared activity drawer);
 * sibling steps render only their non-reasoning content.
 */
export const BetterAssistantNodeView = memo(function BetterAssistantNodeView({
  node, useTurnData, openFile, loadImage, fileMentions, t, useSession,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )

  // Aggregate reasoning across every assistant step of this turn.
  const turnNumber = turn?.turn
  const steps = useSession(snapshot => {
    if (turnNumber === undefined) return EMPTY_STEPS
    return snapshot.chat.locations.getTurn(turnNumber)
      .map(key => snapshot.chat.nodes.get(key))
      .filter((candidate): candidate is ChatNode<'assistant-step'> => (
        candidate !== undefined && candidate.kind === 'assistant-step'
      ))
  })
  const reasoningItems = useMemo<readonly ReasoningItem[]>(() => steps.flatMap(step => {
    const stepRunning = step.data.status === 'running'
    return step.data.blocks
      .filter((block): block is Extract<AssistantBlock, { kind: 'reasoning' }> => block.kind === 'reasoning')
      .map(block => ({ text: block.text, running: stepRunning }))
  }), [steps])
  const isFirstStep = steps.length > 0 && node.key === steps[0]?.key
  const turnRunning = steps.some(step => step.data.status === 'running')
  // "当前思考"的起点：取仍在流式输出的那个 step 的首个可见内容时间
  // （firstVisibleTime），而不是整轮的 turn 开始时间，这样计时才是这段思考的时长。
  const thinkingStart = useMemo(() => {
    const runningStep = steps.find(step => step.data.status === 'running')
    return runningStep?.data.time
  }, [steps])

  const visibleBlocks = useMemo(
    () => data.blocks.filter(block => block.kind !== 'reasoning'),
    [data.blocks],
  )
  const entry = isFirstStep && reasoningItems.length > 0
    ? <ReasoningEntry items={reasoningItems} running={turnRunning} turn={turnNumber as number} thinkingStart={thinkingStart} t={t} />
    : undefined

  // 本轮工具调用次数与耗时：复用已有的会话投影（无新增订阅）。
  const toolCount = useSession((snapshot) => {
    if (turnNumber === undefined) return 0
    let count = 0
    for (const key of snapshot.chat.locations.getTurn(turnNumber)) {
      if (snapshot.chat.nodes.get(key)?.kind === 'tool-call') count += 1
    }
    return count
  })
  const timing = useSession((snapshot) => {
    if (turnNumber === undefined) return undefined
    return snapshot.turnTimings.get(turnNumber)
  })
  const streaming = data.status === 'running'
  const interrupted = data.status === 'interrupted'
  // 回合最终回复 = 总结卡（带头部统计）；同一回合内其余已完成片段 = 轻量步骤卡；
  // 仍在流式输出的片段不包卡（避免边框随文字增长不停重排）。
  const isClosingReply = owner !== undefined
  // 中断的片段也当「收尾」用总结卡呈现（头部换成琥珀色「已中断」徽章），
  // 否则中断回合最后只剩一张轻量步骤卡，看不出这一轮结束了。
  const isSummary = isClosingReply || interrupted
  const variant: 'reply' | 'step' | undefined = isSummary
    ? 'reply'
    : streaming ? undefined : 'step'
  const cardMeta = useMemo<ReplyCardMeta | undefined>(() => {
    if (!isSummary) return undefined
    const start = timing?.startTime
    const end = timing?.endTime
    return {
      durationMs: start !== undefined && end !== undefined ? Math.max(0, end - start) : undefined,
      steps: steps.length,
      tools: toolCount,
      thinking: reasoningItems.length,
    }
  }, [isSummary, reasoningItems.length, steps.length, timing, toolCount])

  return (
    <BetterAssistantMarkdown
      blocks={visibleBlocks}
      streaming={streaming}
      interrupted={interrupted}
      loadImage={loadImage}
      mentions={mentions}
      t={t}
      group={entry}
      card={variant}
      cardMeta={cardMeta}
    />
  )
})
