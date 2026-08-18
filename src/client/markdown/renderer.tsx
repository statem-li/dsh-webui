import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import MarkdownRender, { MarkdownCodeBlockNode } from 'markstream-react'
import type { NodeComponentProps } from 'markstream-react'
import type { CodeBlockNode, ImageNode, InlineCodeNode, LinkNode } from 'stream-markdown-parser'
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

/** Use Markstream's worker-free Shiki renderer for fenced code blocks. */
export function DshCodeBlockNode({ node, ctx }: NodeComponentProps<CodeBlockNode>) {
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

/** Markstream wrapper configured for untrusted assistant output. */
export const MarkstreamMarkdown = memo(function MarkstreamMarkdown({ text, streaming, fileMentions }: {
  text: string
  streaming: boolean
  fileMentions?: MarkdownFileMentions | undefined
}) {
  const codeBlockProps = useMemo(() => ({
    fileMentions: streaming ? undefined : fileMentions,
  }), [fileMentions, streaming])
  return (
    <div className="dsh-better-markdown__markdown" data-markdown-renderer="markstream-react">
      <MarkdownRender
        content={text}
        final={!streaming}
        customId={CUSTOM_COMPONENT_SCOPE}
        htmlPolicy="escape"
        fade={false}
        smoothStreaming={false}
        viewportPriority={false}
        codeBlockStream={streaming}
        codeBlockProps={codeBlockProps}
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
  // 跟随最新：思考文字每增长一次就把滚动框滚到底。
  const liveRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!running) return
    const el = liveRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
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
        <div className="dsh-better-markdown__reasoning-live" ref={liveRef} aria-live="polite">
          {liveText}
        </div>
      )}
    </div>
  )
}

type AssistantBlock = AssistantChatData['blocks'][number]

function BetterAssistantMarkdown({ blocks, streaming, interrupted, loadImage, mentions, t, group, card }: {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  interrupted?: boolean | undefined
  loadImage?: ImageLoader | undefined
  mentions?: MarkdownFileMentions | undefined
  t: ChatViewSlotProps['t']
  /** Optional content rendered above the message body (the reasoning group). */
  group?: ReactNode | undefined
  /** Whether to wrap the rendered content in a card (finalized replies only). */
  card?: boolean | undefined
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
        {rendered.length > 0 && (card
          ? <div className="dsh-better-markdown__card">{rendered}</div>
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
  // Only the closing step of a closed turn is a real "reply" — the rest are
  // intermediate fragments. Card-wrapping every finalized step looks noisy.
  const isClosingReply = owner !== undefined
  return (
    <BetterAssistantMarkdown
      blocks={visibleBlocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      loadImage={loadImage}
      mentions={mentions}
      t={t}
      group={entry}
      card={isClosingReply}
    />
  )
})
