/**
 * Shared activity drawer: a window-level bus that collects one turn's
 * reasoning and tool-call material from the two shadow plugins, plus the
 * right-side drawer panel that renders it on demand.
 *
 * dsh-better-markdown publishes `reasoning` entries; dsh-tool-summary
 * publishes `tools` and hosts the panel. Both read the same window key, so
 * the bus is created lazily by whichever plugin touches it first.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IconApiOutline14, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { computeStats, formatDuration, isRunning, shortenPath, type ToolStats } from './tool-stats.ts'
import { kindByToolName, type ActivityKind } from './activity-kind.ts'
import { useNow } from './use-now.ts'
import { groupReasoning } from './reasoning-classify.ts'
import { ToolCallTreeList } from './ToolGroupNodeView.tsx'

/** One reasoning block stranded in the drawer. */
export interface ActivityReasoningItem {
  readonly text: string
  readonly running: boolean
}

/** Everything the drawer can show for one turn. */
export interface ActivityTurnData {
  readonly reasoning?: readonly ActivityReasoningItem[]
  readonly tools?: readonly ChatNode<'tool-call'>[]
  readonly toolsCwd?: string | undefined
  readonly turnStart?: number | undefined
}

/** The cross-plugin bus shape. */
export type ViewMode = 'reasoning' | 'tools'

export interface ActivityHandlers {
  readonly openFile: (path: string) => void
  readonly inspectCall: (callId: string) => void
}

export interface ActivityStore {
  readonly openTurn: number | null
  readonly activeMode: ViewMode | null
  open(turn: number, mode: ViewMode): void
  close(): void
  setReasoning(turn: number, items: readonly ActivityReasoningItem[]): void
  setTools(turn: number, nodes: readonly ChatNode<'tool-call'>[], cwd: string | undefined, turnStart: number | undefined): void
  setHandlers(handlers: ActivityHandlers): void
  subscribe(fn: () => void): () => void
  get(turn: number): ActivityTurnData | undefined
  handlers(): ActivityHandlers
}

const STORE_KEY = '__dshActivityDrawerStore__'

/** Create-or-read the shared window bus. */
export function activityStore(): ActivityStore {
  const globalObj = globalThis as Record<string, unknown>
  const existing = globalObj[STORE_KEY] as ActivityStore | undefined
  if (existing !== undefined) return existing
  const listeners = new Set<() => void>()
  const data = new Map<number, ActivityTurnData>()
  let openTurn: number | null = null
  let activeMode: ViewMode | null = null
  let handlers: ActivityHandlers = { openFile: () => {}, inspectCall: () => {} }
  const notify = (): void => {
    for (const fn of [...listeners]) {
      try { fn() } catch { /* a dying listener must not kill the bus */ }
    }
  }
  const store: ActivityStore = {
    get openTurn() { return openTurn },
    get activeMode() { return activeMode },
    open: (turn, mode) => { openTurn = turn; activeMode = mode; notify() },
    close: () => { openTurn = null; activeMode = null; notify() },
    setReasoning: (turn, items) => {
      data.set(turn, { ...(data.get(turn) ?? {}), reasoning: items })
      notify()
    },
    setTools: (turn, nodes, cwd, turnStart) => {
      data.set(turn, { ...(data.get(turn) ?? {}), tools: nodes, toolsCwd: cwd, turnStart })
      notify()
    },
    setHandlers: (next) => { handlers = next },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    get: (turn) => data.get(turn),
    handlers: () => handlers,
  }
  globalObj[STORE_KEY] = store
  return store
}

/** Summary card for the drawer's tool section. */
function DrawerToolSummary({ stats, cwd, openFile, kinds }: {
  readonly stats: ToolStats
  readonly cwd?: string | undefined
  readonly openFile: (path: string) => void
  readonly kinds: ReadonlyMap<string, ActivityKind>
}) {
  return (
    <div className="dts__summary">
      <div className="dts__summary-title"><IconApiOutline14 size={13} aria-hidden /> 工具调用总结</div>
      <div className="dts__summary-line">
        共 <b>{stats.total}</b> 次调用
        {stats.running > 0 && <> · <b>{stats.running}</b> 次进行中</>}
        {stats.errors > 0 && <> · ⚠ <b>{stats.errors}</b> 次失败</>}
      </div>
      {stats.byTool.length > 0 && (
        <div className="dts__chips">
          {stats.byTool.map(({ name, count }) => (
            <span key={name} className="dts__chip" data-tool={name} data-kind={kinds.get(name)?.key}>{name} ×{count}</span>
          ))}
        </div>
      )}
      {stats.files.length > 0 && (
        <div className="dts__files">
          {stats.files.map(path => (
            <button
              key={path}
              type="button"
              className="dts__file"
              title={path}
              onClick={() => { openFile(path) }}
            >
              {shortenPath(path, cwd)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Classified reasoning blocks with per-category headings and jump targets. */
function ReasoningGroups({ items, activeIndex, jumpToCategory }: {
  readonly items: readonly ActivityReasoningItem[]
  readonly activeIndex: number | null
  /** Jump to the first reasoning item of the given global-index offset. */
  jumpToCategory: (firstIndex: number) => void
}) {
  const groups = useMemo(() => groupReasoning(items), [items])
  let cursor = 0
  return (
    <div className="dts__modal-reasoning">
      {groups.map(group => {
        const firstIndex = cursor
        cursor += group.items.length
        return (
          <div key={group.category.label} className="dts__modal-reasoning-group" data-reasoning-category={group.category.label}>
            <div className="dts__modal-reasoning-group-title" role="button" tabIndex={0} onClick={() => jumpToCategory(firstIndex)}>
              {group.category.icon} {group.category.label} ({group.items.length})
            </div>
            {group.items.map((item) => {
              const globalIndex = firstIndex + group.items.indexOf(item)
              return (
                <div
                  key={globalIndex}
                  data-reasoning-index={globalIndex}
                  data-active={activeIndex === globalIndex || undefined}
                  className="dts__modal-reasoning-item"
                  data-running={item.running || undefined}
                >
                  <span className="dts__modal-reasoning-item-index" aria-hidden>{globalIndex + 1}</span>
                  <span className="dts__modal-reasoning-item-text">{item.text}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** The centered modal: two separate panels — thinking and tools. */
function DrawerPanel({ turn, data, store, openFile, inspectCall }: {
  readonly turn: number
  readonly data: ActivityTurnData | undefined
  readonly store: ActivityStore
  readonly openFile: (path: string) => void
  readonly inspectCall: (callId: string) => void
}) {
  const reasoning = data?.reasoning ?? []
  const toolNodes = data?.tools ?? []
  const blocks = useMemo(() => toolNodes.map(node => node.data.root), [toolNodes])
  const stats = useMemo(() => computeStats(blocks), [blocks])
  const kinds = useMemo(() => kindByToolName(blocks), [blocks])
  const close = (): void => { store.close() }
  const mode = store.activeMode

  // Live elapsed time + auto-scroll while the turn is still working.
  const reasoningRunning = reasoning.some(item => item.running)
  const toolsRunning = stats.running > 0
  const anyRunning = reasoningRunning || toolsRunning
  const now = useNow(anyRunning)
  const turnStart = data?.turnStart
  const elapsed = turnStart !== undefined ? Math.max(0, now - turnStart) : undefined
  // "当前工具"的时长：取仍在运行的最早一个 tool/call 时间，而非整轮 turn 总时长。
  const toolsElapsed = useMemo(() => {
    let earliest: number | undefined
    for (const node of toolNodes) {
      const block = node.data.root
      if (isRunning(block) && (earliest === undefined || block.time < earliest)) earliest = block.time
    }
    return earliest !== undefined ? Math.max(0, now - earliest) : undefined
  }, [toolNodes, now])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!anyRunning) return
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [anyRunning, now, reasoning, toolNodes])

  // Jump navigation over reasoning items (querySelector over refs: refs get
  // cleared by effects and are unreliable across re-renders).
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const jumpTo = (index: number): void => {
    setActiveIndex(index)
    const el = document.querySelector(`[data-reasoning-index="${index}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <div className="dts__modal-backdrop" onClick={close} aria-hidden />
      <div className="dts__modal" role="dialog" aria-label={`第 ${turn} 轮活动详情`}>
        <header className="dts__modal-head">
          <span className="dts__modal-title">
            第 {turn} 轮
            {mode === 'reasoning' && (
              <> · <IconThinkOutline14 size={14} aria-hidden /> {reasoning.length}</>
            )}
            {mode === 'tools' && (
              <> · <IconApiOutline14 size={14} aria-hidden /> {toolNodes.length}</>
            )}
          </span>
          <button type="button" className="dts__modal-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <div className="dts__modal-scroll" ref={scrollRef}>
          {mode !== 'tools' && reasoning.length > 0 && (
            <div className="dts__modal-panel">
              <header className="dts__modal-panel-head">
                <span className="dts__modal-panel-title"><IconThinkOutline14 size={14} aria-hidden /> 思考过程</span>
                {reasoningRunning && elapsed !== undefined && (
                  <span className="dts__modal-panel-live">思考中 · {formatDuration(elapsed)}</span>
                )}
                <span className="dts__modal-panel-count">{reasoning.length}</span>
              </header>
              {reasoning.length > 1 && (
                <nav className="dts__reasoning-nav" aria-label="思考条目导航">
                  {reasoning.map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      className="dts__reasoning-nav-item"
                      data-active={activeIndex === index || undefined}
                      title={`跳到第 ${index + 1} 条思考`}
                      onClick={() => { jumpTo(index) }}
                    >
                      {index + 1}
                    </button>
                  ))}
                </nav>
              )}
              <ReasoningGroups items={reasoning} activeIndex={activeIndex} jumpToCategory={jumpTo} />
            </div>
          )}
          {mode !== 'reasoning' && toolNodes.length > 0 && (
            <div className="dts__modal-panel">
              <header className="dts__modal-panel-head">
                <span className="dts__modal-panel-title"><IconApiOutline14 size={14} aria-hidden /> 工具调用</span>
                {toolsRunning && toolsElapsed !== undefined && (
                  <span className="dts__modal-panel-live">进行中 · {formatDuration(toolsElapsed)}</span>
                )}
                <span className="dts__modal-panel-count">{toolNodes.length}</span>
              </header>
              <DrawerToolSummary stats={stats} cwd={data?.toolsCwd} openFile={openFile} kinds={kinds} />
              <div className="dts__modal-tools">
                {toolNodes.map(node => (
                  <ToolCallTreeList
                    key={node.key}
                    block={node.data.root}
                    cwd={data?.toolsCwd}
                    openFile={openFile}
                    inspectCall={inspectCall}
                  />
                ))}
              </div>
            </div>
          )}
          {reasoning.length === 0 && toolNodes.length === 0 && (
            <div className="dts__empty">这一轮没有可显示的思考或工具调用</div>
          )}
        </div>
      </div>
    </>
  )
}

/** Drawer app: subscribes to the bus and renders the panel when open. */
function DrawerApp() {
  const [openTurn, setOpenTurn] = useState<number | null>(null)
  const [data, setData] = useState<ActivityTurnData | undefined>(undefined)
  useEffect(() => {
    const store = activityStore()
    const render = (): void => {
      const turn = store.openTurn
      setOpenTurn(turn)
      setData(turn === null ? undefined : store.get(turn))
    }
    render()
    return store.subscribe(render)
  }, [])
  if (openTurn === null) return null
  const store = activityStore()
  const handlers = store.handlers()
  return (
    <DrawerPanel
      turn={openTurn}
      data={data}
      store={store}
      openFile={handlers.openFile}
      inspectCall={handlers.inspectCall}
    />
  )
}

let mounted = false

/** Mount the drawer root once (idempotent). */
export function mountActivityDrawer(): void {
  if (mounted) return
  mounted = true
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-activity-drawer-root') !== null) return
  const host = document.createElement('div')
  host.id = 'dsh-activity-drawer-root'
  document.body.appendChild(host)
  createRoot(host).render(<DrawerApp />)
}