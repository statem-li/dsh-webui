/**
 * Tool entry node: shadows the built-in `tool-call` chat node at a lower slot
 * priority. Instead of rendering the whole tool tree inline, it collapses one
 * turn's calls into a single clickable chip; clicking opens the shared
 * activity drawer with the full call list and a summary card.
 *
 * The chip renders for the FIRST tool-call node of the turn (by the chat node
 * order); every sibling node of the same turn renders null.
 */

import { memo, useEffect, useMemo, useState } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: activates the ui-conversation SlotMap augmentation so ChatNodeViewProps
// resolves its owner/keyed share (selectedCallId, cwd, openFile, inspectCall…).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconApiOutline14, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { callDurationMs, callName, callSummary, classifyActivity, computeStats, formatDuration, isRunning, parseDownload, READONLY_TOOLS, resultText, shortenPath, type DownloadInfo } from './tool-stats.ts'
import { useNow } from './use-now.ts'
import { activityStore, type ActivityHandlers, type ActivityStore } from './activity-drawer.tsx'

const NS = 'dts'

const EMPTY: readonly ChatNode<'tool-call'>[] = []

/** Turn number owning one chat node, or undefined outside a turn/step location. */
function turnNumber(node: {
  readonly location?: { readonly kind?: string; readonly turn?: { readonly turn?: number } }
}): number | undefined {
  const location = node.location
  if (location === undefined) return undefined
  if (location.kind === 'turn' || location.kind === 'step') return location.turn?.turn
  return undefined
}

/** Handoff props the drawer needs from the seat (registered into the store). */
type HandoffProps = ActivityHandlers

/**
 * One simplified tool row used INSIDE the drawer: state dot, name, one-line
 * summary, and truncated expandable output. Also exported for the drawer.
 */
export const SimpleToolRow = memo(function SimpleToolRow({
  block, selected, cwd, openFile, inspectCall,
}: {
  readonly block: ToolCallBlock
  readonly selected: boolean
  readonly cwd?: string | undefined
  readonly openFile: (path: string) => void
  readonly inspectCall: (callId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const running = isRunning(block)
  const name = callName(block)
  const argsRaw = 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
  const summary = callSummary(block)
  const output = resultText(block)
  const failed = !running && block.isError
  const stopped = !running && !block.isError && block.error !== undefined
  const state = running ? 'running' : failed ? 'error' : stopped ? 'stopped' : 'ok'
  const now = useNow(running)
  const duration = callDurationMs(block, now)
  const activity = classifyActivity(block)

  return (
    <div
      className={`${NS}__call`}
      data-selected={selected || undefined}
      data-state={state}
    >
      <div
        className={`${NS}__row`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(value => !value)
          }
        }}
      >
        <span className={`${NS}__dot`} data-state={state} aria-hidden />
        <span className={`${NS}__row-name`}>{name || block.callId}</span>
        <span className={`${NS}__row-summary`} title={summary}>{summary}</span>
        {running && duration !== undefined && activity === 'download' && (
          <span className={`${NS}__row-live`} data-kind="download" title="下载中">
            <span className={`${NS}__progress`} aria-hidden />
            <span>下载中 · {formatDuration(duration)}</span>
          </span>
        )}
        {running && duration !== undefined && activity === 'command' && duration > 1000 && (
          <span className={`${NS}__row-live`} data-kind="command" title="执行中">
            <span className={`${NS}__progress`} aria-hidden />
            <span>执行中 · {formatDuration(duration)}</span>
          </span>
        )}
        {running && duration !== undefined
          && !(activity === 'download' || (activity === 'command' && duration > 1000)) && (
          <span className={`${NS}__row-time`} data-running title="耗时">
            ⏳ {formatDuration(duration)}
          </span>
        )}
        {!running && duration !== undefined && (
          <span className={`${NS}__row-time`} title="耗时">{formatDuration(duration)}</span>
        )}
        <button
          type="button"
          className={`${NS}__inspect`}
          title="在轨迹中查看"
          aria-label={`在轨迹中查看 ${name}`}
          onClick={(event) => {
            event.stopPropagation()
            inspectCall(block.callId)
          }}
        >
          ⤴
        </button>
        <span className={`${NS}__chevron`} data-open={open || undefined} aria-hidden>▶</span>
      </div>
      {open && (
        <div className={`${NS}__row-body`}>
          {argsRaw !== '' && (
            <div className={`${NS}__row-args`}>
              <span className={`${NS}__row-label`}>参数</span>
              <code>{argsRaw}</code>
            </div>
          )}
          {output !== '' && (
            <div className={`${NS}__row-output`}>
              <span className={`${NS}__row-label`}>输出</span>
              <pre className={`${NS}__row-pre`}>{output}</pre>
            </div>
          )}
          {argsRaw === '' && output === '' && (
            <div className={`${NS}__row-empty`}>{running ? '执行中…' : '无输出'}</div>
          )}
        </div>
      )}
    </div>
  )
})

/** Recursive call list for the drawer (root + subcalls). */
export function ToolCallTreeList({ block, cwd, openFile, inspectCall }: {
  readonly block: ToolCallBlock
  readonly cwd?: string | undefined
  readonly openFile: (path: string) => void
  readonly inspectCall: (callId: string) => void
}) {
  return (
    <div className={`${NS}__drawer-call`}>
      <SimpleToolRow
        block={block}
        selected={false}
        cwd={cwd}
        openFile={openFile}
        inspectCall={inspectCall}
      />
      {block.subCalls.length > 0 && (
        <div className={`${NS}__subcalls`} data-subcalls>
          {block.subCalls.map(child => (
            <ToolCallTreeList key={child.callId} block={child} cwd={cwd} openFile={openFile} inspectCall={inspectCall} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The entry chip: one compact line that opens the drawer. Registered into the
 * shared store so the drawer can render the full material without re-reading
 * the conversation projection.
 */
const ToolEntry = memo(function ToolEntry({
  nodes, turn, turnStart, cwd, openFile, inspectCall,
}: {
  readonly nodes: readonly ChatNode<'tool-call'>[]
  readonly turn: number
  readonly turnStart?: number | undefined
  readonly cwd?: string | undefined
  readonly openFile: (path: string) => void
  readonly inspectCall: (callId: string) => void
}) {
  const store: ActivityStore = activityStore()
  useEffect(() => {
    store.setTools(turn, nodes, cwd, turnStart)
    store.setHandlers({ openFile, inspectCall })
  }, [store, turn, nodes, cwd, turnStart, openFile, inspectCall])
  const stats = useMemo(() => computeStats(nodes.map(node => node.data.root)), [nodes])
  const readOnly = useMemo(() => nodes.filter(node => READONLY_TOOLS.has(callName(node.data.root))).length, [nodes])
  const running = stats.running > 0
  const now = useNow(running)
  // "当前工具"的时长：取仍在运行的最早一个 tool/call 时间，而不是整轮 turn 开始时间。
  const toolStart = useMemo(() => {
    let earliest: number | undefined
    for (const node of nodes) {
      const block = node.data.root
      if (isRunning(block) && (earliest === undefined || block.time < earliest)) earliest = block.time
    }
    return earliest
  }, [nodes])
  const elapsed = toolStart !== undefined ? Math.max(0, now - toolStart) : undefined
  // 统计仍在运行的工具类型，决定是否在对话流外面直接显示下载/执行进度卡片。
  const liveActivity = useMemo(() => {
    let hasDownload = false
    let hasCommand = false
    let downloadInfo: DownloadInfo | undefined
    for (const node of nodes) {
      const block = node.data.root
      if (!isRunning(block)) continue
      const activity = classifyActivity(block)
      if (activity === 'download') {
        hasDownload = true
        if (downloadInfo === undefined) downloadInfo = parseDownload(block)
      } else if (activity === 'command') {
        hasCommand = true
      }
    }
    return { hasDownload, hasCommand, downloadInfo }
  }, [nodes])
  const showDownload = running && liveActivity.hasDownload
  const showCommand = running && !liveActivity.hasDownload && liveActivity.hasCommand && (elapsed ?? 0) > 1000

  return (
    <div className={`${NS}__entry-wrap`}>
      <button
        type="button"
        className={`${NS}__entry`}
        data-running={running || undefined}
        title="点击打开本轮思考与工具调用详情"
        aria-label={`本轮工具调用 ${stats.total} 次，点击查看`}
        onClick={() => { store.open(turn, 'tools') }}
      >
        <span className={`${NS}__entry-icon`} aria-hidden><IconApiOutline14 size={14} /></span>
        <span className={`${NS}__entry-text`}>
          {running
            ? elapsed !== undefined
              ? `工具调用中 · ${formatDuration(elapsed)}`
              : '工具调用中'
            : `工具 ×${stats.total}`}
        </span>
        {readOnly > 0 && <span className={`${NS}__entry-sub`}>只读 {readOnly}</span>}
        {stats.errors > 0 && <span className={`${NS}__entry-err`}>⚠ {stats.errors}</span>}
      </button>
      {showDownload && (
        <div className={`${NS}__download-card`}>
          <div className={`${NS}__download-head`}>
            <IconDownloadOutline16 size={14} aria-hidden />
            <span className={`${NS}__download-title`}>下载中 · {formatDuration(elapsed ?? 0)}</span>
          </div>
          {liveActivity.downloadInfo?.url !== undefined && liveActivity.downloadInfo.url !== '' && (
            <div className={`${NS}__download-url`} title={liveActivity.downloadInfo.url}>{liveActivity.downloadInfo.url}</div>
          )}
          {liveActivity.downloadInfo?.output !== undefined && liveActivity.downloadInfo.output !== '' && (
            <div className={`${NS}__download-dest`} title={liveActivity.downloadInfo.output}>保存到 <code>{liveActivity.downloadInfo.output}</code></div>
          )}
          <div className={`${NS}__download-progress`}><span className={`${NS}__progress`} aria-hidden /></div>
        </div>
      )}
      {showCommand && (
        <div className={`${NS}__entry-live`} data-kind="command">
          <span className={`${NS}__progress`} aria-hidden />
          <span>执行中 · {formatDuration(elapsed ?? 0)}</span>
        </div>
      )}
    </div>
  )
})

/** Shadows the built-in `tool-call` renderer: one chip per turn, drawer on click. */
export const ToolGroupNodeView = memo(function ToolGroupNodeView(props: ChatNodeViewProps<'tool-call'>) {
  const { node, useSession, cwd, openFile, inspectCall } = props
  const turn = turnNumber(node)
  const nodes = useSession(snapshot => {
    if (turn === undefined) return EMPTY
    return snapshot.chat.locations.getTurn(turn)
      .map(key => snapshot.chat.nodes.get(key))
      .filter((candidate): candidate is ChatNode<'tool-call'> => (
        candidate !== undefined && candidate.kind === 'tool-call'
      ))
  })
  const turnStart = useSession(snapshot => {
    if (turn === undefined) return undefined
    return snapshot.turnTimings.get(turn)?.startTime
  })
  if (nodes.length === 0) return null
  // Only the first node of the turn renders the chip; siblings render empty.
  if (node.key !== nodes[0]?.key) return null
  return (
    <ToolEntry
      nodes={nodes}
      turn={turn as number}
      turnStart={turnStart}
      cwd={cwd}
      openFile={openFile}
      inspectCall={inspectCall}
    />
  )
})