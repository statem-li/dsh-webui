/**
 * SessionMessageNav — 会话消息导航 UI（client 半身核心组件）。
 *
 * 两大能力：
 *  1. 头部右上角「消息 N」按钮 → 弹出本会话全部已发送消息（user + steering）；
 *     点击某条 → 会话自动滚动到该消息并高亮闪烁。
 *  2. 右侧中间「消息横条」：透明无背景的一列细横条，**每条横条 = 一条你发送
 *     的消息**：
 *     - 不显示文字；不在阅读位置 = 灰色，当前阅读位置（active）= 蓝色
 *       （蓝色横条加宽 1.5 倍）；
 *     - 点击某条 → 会话自动滚动到该消息并高亮闪烁；
 *     - 消息多时面板可滚动，当前阅读位置的消息自动滚入面板视野；
 *     - 按住面板空白处上下拖动 → 像拉滚轮一样滚动会话；
 *     - 列表随会话实时更新（新消息到达自动出现）。
 *
 * 依赖 DOM 契约（ui-conversation 稳定提供）：
 *  - [data-conversation-scroll] — 会话滚动容器（scrollport）
 *  - [data-chat-flow] — 聊天流列表
 *  - [data-chat-anchor-key] — 每个聊天节点行的稳定锚点（= node.key）
 *  - [data-composer-seat] — 底部粘贴输入区
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（槽位注册的类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { css, injectStyles } from './styles'

export type SessionMessageNavProps = PropsRuntime<'conversation.session.header.utilities'>

/** 面板上一条横条（一条我发送的消息）。 */
interface Bar {
  key: string
  index: number
  seq: number
  time: number
  full: string
}

/** 面板位置（左上角 viewport 坐标）。 */
interface PanelPos {
  x: number
  y: number
}

/** 按钮位置（左上角 viewport 坐标；会话区右上角）。 */
interface ButtonPos {
  x: number
  y: number
}

const PANEL_WIDTH = 196
/** 行高估算（18px 行 + 2px 间距），用于面板高度计算。 */
const PANEL_ROW_HEIGHT = 20
const PANEL_PADDING = 16
/** 面板默认最多同时显示的横条数（超出由滚轮平滑滚动）。 */
const MAX_VISIBLE_ROWS = 10
/** 数量徽标按钮的宽度估算（右对齐定位用）。 */
const BUTTON_WIDTH = 44

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** 内容块 → 纯文本预览（图片/工具块给占位符）。 */
function blocksText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text': parts.push(block.text); break
      case 'reasoning': parts.push('[思考]'); break
      case 'image': parts.push('[图片]'); break
      case 'tool-call': parts.push(`[工具：${block.name}]`); break
      case 'tool-result': parts.push('[工具结果]'); break
      default: parts.push('[内容]')
    }
  }
  return parts.join('\n').trim()
}

/** 用户消息节点 → 预览文本。 */
function messageText(node: ChatNode): string {
  switch (node.kind) {
    case 'user':
    case 'steering':
    case 'context':
      return blocksText(node.data.content)
    default:
      return ''
  }
}

/** 用户消息节点 → 时间戳。 */
function messageTime(node: ChatNode): number {
  switch (node.kind) {
    case 'user':
    case 'steering':
    case 'context':
      return node.data.time
    default:
      return 0
  }
}

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

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

/**
 * 会话消息导航入口：渲染头部右上角「消息」按钮 + 右侧中间消息横条面板。
 * @param props - 会话标准套件（sessionId / useSession 等，框架注入）。
 */
export function SessionMessageNav(props: SessionMessageNavProps): ReactNode {
  const { sessionId, useSession } = props
  const snapshot = useSession(s => s)

  const hostRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [buttonPos, setButtonPos] = useState<ButtonPos | null>(null)
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [hover, setHover] = useState<{ key: string; y: number } | null>(null)
  const measureRef = useRef<() => void>(() => {})
  // 无滚动条滚动（transform 驱动）：滚轮与 active 跟随共用位置状态。
  const scrollPosRef = useRef(0)
  const scrollTargetRef = useRef(0)
  const scrollRafRef = useRef(0)
  // 面板空白处拖动 → 滚动会话。
  const dragRef = useRef<{
    down: boolean
    dragging: boolean
    moved: number
    startX: number
    startY: number
    startScrollTop: number
  } | null>(null)

  // 本会话已发送消息（user + steering，按时间正序 = 流顺序）。
  const userMessages = useMemo(() => {
    const chat = snapshot?.chat
    if (chat === undefined) return [] as Array<{ key: string; node: ChatNode }>
    const out: Array<{ key: string; node: ChatNode }> = []
    for (const key of chat.order) {
      const node = chat.nodes.get(key) as ChatNode | undefined
      if (node === undefined || node.visibility === 'hidden') continue
      if (node.kind === 'user' || node.kind === 'steering') out.push({ key, node })
    }
    return out
  }, [snapshot])

  // 横条数据：每条 = 一条我发送的消息（点击跳转 + 悬停显示内容）。
  const bars = useMemo<Bar[]>(() => userMessages.map((entry, index) => ({
    key: entry.key,
    index,
    seq: entry.node.anchorSeq,
    time: messageTime(entry.node),
    full: messageText(entry.node),
  })), [userMessages])

  const scrollportOf = useCallback((): HTMLElement | null => {
    const rootEl = hostRef.current
    if (rootEl === null) return null
    const phase = rootEl.closest('[data-phase]')
    const found = phase?.querySelector('[data-conversation-scroll]')
      ?? document.querySelector('[data-conversation-scroll]')
    return found instanceof HTMLElement ? found : null
  }, [])

  const findRow = useCallback((scrollport: HTMLElement, key: string): HTMLElement | null => {
    for (const row of scrollport.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
      if (row.dataset.chatAnchorKey === key) return row
    }
    return null
  }, [])

  /** 滚动到某节点并高亮闪烁。 */
  const jumpTo = useCallback((key: string): void => {
    const scrollport = scrollportOf()
    if (scrollport === null) return
    const row = findRow(scrollport, key)
    if (row === null) return
    const sr = scrollport.getBoundingClientRect()
    const rr = row.getBoundingClientRect()
    const target = scrollport.scrollTop + (rr.top - sr.top)
    scrollport.scrollTo({ top: target, behavior: 'smooth' })
    row.classList.add(css.flash)
    window.setTimeout(() => { row.classList.remove(css.flash) }, 2400)
  }, [scrollportOf, findRow])

  /**
   * 重新测量：按钮锚点（与「对话/轨迹」标签页同一行、右侧）+ 面板锚点
   * （右侧垂直居中）+ 当前阅读位置对应的我的消息（视口内第一条可见的我的
   * 消息；否则视口上方最近一条）。
   */
  const measure = useCallback((): void => {
    const scrollport = scrollportOf()
    if (scrollport === null || bars.length === 0) {
      setPanelPos(null)
      setButtonPos(null)
      return
    }
    const sr = scrollport.getBoundingClientRect()
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const composerTop = composer?.getBoundingClientRect().top
    const visibleBottom = composerTop !== undefined && composerTop > sr.top ? composerTop : sr.bottom
    const flow = scrollport.querySelector('[data-chat-flow]')

    let lastAbove: string | null = null
    let firstVisibleUser: string | null = null
    if (flow !== null) {
      for (const row of flow.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
        const key = row.dataset.chatAnchorKey
        if (key === undefined) continue
        const node = (snapshot?.chat.nodes.get(key) as ChatNode | undefined)
        if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) continue
        const rect = row.getBoundingClientRect()
        if (rect.height <= 0) continue
        if (rect.bottom <= sr.top + 1) {
          lastAbove = key
        } else if (rect.top < visibleBottom && firstVisibleUser === null) {
          firstVisibleUser = key
        }
      }
    }
    const active = firstVisibleUser ?? lastAbove
    setActiveKey(prev => (prev === active ? prev : active))

    // 按钮：与 header 的「对话/轨迹」标签页同一行（垂直居中对齐），仍靠右侧
    // （右缘内侧避开滚动条）；无标签页时回落到滚动区顶部。
    const buttonX = sr.left + scrollport.clientWidth - BUTTON_WIDTH - 12
    const phase = hostRef.current?.closest('[data-phase]')
    const tablist = phase?.querySelector('[role="tablist"]')
    const tabRect = tablist instanceof HTMLElement ? tablist.getBoundingClientRect() : null
    const buttonY = tabRect !== null && tabRect.height > 0
      ? tabRect.top + Math.max(0, (tabRect.height - 28) / 2) + 28
      : sr.top + 10
    setButtonPos(prev => (
      prev !== null && Math.abs(prev.x - buttonX) < 0.5 && Math.abs(prev.y - buttonY) < 0.5
        ? prev
        : { x: buttonX, y: buttonY }
    ))

    const panelHeight = clamp(
      bars.length * PANEL_ROW_HEIGHT + PANEL_PADDING,
      56,
      MAX_VISIBLE_ROWS * PANEL_ROW_HEIGHT + PANEL_PADDING,
    )
    const x = sr.left + scrollport.clientWidth - PANEL_WIDTH - 12
    const y = sr.top + Math.max(24, (sr.height - panelHeight) / 2)
    setPanelPos(prev => (
      prev !== null && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5 ? prev : { x, y }
    ))
  }, [scrollportOf, snapshot, bars.length])

  measureRef.current = measure

  // 挂载/会话切换：注入样式 + 立即测量 + 绑定监听（监听器只按 sessionId 绑定，
  // 测量逻辑经 measureRef 取最新闭包，避免流式更新时反复解绑）。
  useLayoutEffect(() => {
    const removeStyles = injectStyles()
    measureRef.current()
    const scrollport = scrollportOf()
    if (scrollport === null) return removeStyles
    let raf = 0
    const schedule = (): void => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        measureRef.current()
      })
    }
    const onScroll = (): void => { schedule() }
    scrollport.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(schedule)
      const flow = scrollport.querySelector('[data-chat-flow]')
      if (flow !== null) resizeObserver.observe(flow)
      resizeObserver.observe(scrollport)
    }
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(schedule)
      mutationObserver.observe(scrollport, { childList: true, subtree: true })
    }
    return () => {
      scrollport.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      if (raf !== 0) window.cancelAnimationFrame(raf)
      removeStyles()
    }
  }, [sessionId, scrollportOf])

  // 弹窗外点关闭 / Esc 关闭。
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node
        && !hostRef.current?.contains(event.target)
        && !wrapRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => () => { dragRef.current = null }, [])

  // 平滑滚动到面板内目标位置（transform 驱动，无滚动条）。
  const applyScroll = useCallback((target: number, smooth: boolean): void => {
    const panel = panelRef.current
    const scroller = scrollerRef.current
    if (panel === null || scroller === null) return
    const max = Math.max(0, scroller.scrollHeight - panel.clientHeight)
    const t = clamp(target, 0, max)
    scrollTargetRef.current = t
    if (!smooth) {
      scrollPosRef.current = t
      scroller.style.transform = `translateY(${-t}px)`
      if (scrollRafRef.current !== 0) cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = 0
      return
    }
    if (scrollRafRef.current !== 0) return
    const tick = (): void => {
      const s = scrollerRef.current
      if (s === null) {
        scrollRafRef.current = 0
        return
      }
      const pos = scrollPosRef.current
      const goal = scrollTargetRef.current
      const next = pos + (goal - pos) * 0.18
      if (Math.abs(goal - next) < 0.5) {
        scrollPosRef.current = goal
        s.style.transform = `translateY(${-goal}px)`
        scrollRafRef.current = 0
        return
      }
      scrollPosRef.current = next
      s.style.transform = `translateY(${-next}px)`
      scrollRafRef.current = requestAnimationFrame(tick)
    }
    scrollRafRef.current = requestAnimationFrame(tick)
  }, [])

  // 鼠标滚轮滚动横条面板（无滚动条）：内容超限时滚轮平滑滚动；不足时不劫持。
  useEffect(() => {
    const panel = panelRef.current
    if (panel === null) return
    const onWheel = (event: WheelEvent): void => {
      const scroller = scrollerRef.current
      if (scroller === null) return
      const max = Math.max(0, scroller.scrollHeight - panel.clientHeight)
      if (max <= 0) {
        scrollPosRef.current = 0
        scrollTargetRef.current = 0
        return
      }
      event.preventDefault()
      applyScroll(scrollTargetRef.current + event.deltaY, true)
    }
    panel.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      panel.removeEventListener('wheel', onWheel)
      if (scrollRafRef.current !== 0) cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = 0
      scrollPosRef.current = 0
      scrollTargetRef.current = 0
    }
  }, [panelPos, bars.length, applyScroll])

  // 当前阅读位置的消息高亮并平滑滚入面板视野。
  useEffect(() => {
    if (activeKey === null || panelRef.current === null) return
    const panel = panelRef.current
    let row: HTMLElement | null = null
    for (const el of panel.querySelectorAll<HTMLElement>('[data-bar-key]')) {
      if (el.dataset.barKey === activeKey) { row = el; break }
    }
    if (row === null) return
    const target = row.offsetTop - (panel.clientHeight - row.offsetHeight) / 2
    applyScroll(target, true)
  }, [activeKey, bars.length, applyScroll])

  // 面板空白处按住拖动 → 滚动会话（2 倍手感）。
  const onPanelPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.target instanceof HTMLElement && event.target.closest('button') !== null) return
    const scrollport = scrollportOf()
    if (scrollport === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      down: true,
      dragging: false,
      moved: 0,
      startX: event.clientX,
      startY: event.clientY,
      startScrollTop: scrollport.scrollTop,
    }
  }

  const onPanelPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || !drag.down) return
    drag.moved += Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY)
    if (!drag.dragging && drag.moved > 6) drag.dragging = true
    if (!drag.dragging) return
    const scrollport = scrollportOf()
    if (scrollport === null) return
    const max = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight)
    scrollport.scrollTop = clamp(
      drag.startScrollTop + (event.clientY - drag.startY) * 2,
      0,
      max,
    )
  }

  const onPanelPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag === null) return
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 忽略 */ }
  }

  const totalCount = userMessages.length
  const showButton = totalCount > 0
  const showPanel = panelPos !== null && bars.length >= 1
  const hoverBar = hover === null ? null : bars.find(bar => bar.key === hover.key) ?? null

  const loadOlder = useCallback((): void => {
    const scrollport = scrollportOf()
    const flow = scrollport?.querySelector('[data-chat-flow]')
    const button = flow?.querySelector('button')
    if (button instanceof HTMLButtonElement && !button.disabled) button.click()
  }, [scrollportOf])

  // 自动加载更早消息：只要会话还有未加载历史（hasMore）就自动连续加载，
  // 直到全部加载完——无需手动点「加载更早」。
  // 防死循环：正在加载时（loadingOlder）等待；连续多次加载但没有任何新
  // 消息进入（bars 数不变，疑似加载失败/无进展）则停止自动加载。
  const autoLoadRef = useRef({ attempts: 0, lastCount: -1 })
  useEffect(() => {
    if (snapshot?.openState !== 'open') return
    if (snapshot?.hasMore !== true || snapshot?.loadingOlder === true) return
    const state = autoLoadRef.current
    if (state.attempts >= 8 && bars.length === state.lastCount) return
    const timer = window.setTimeout(() => {
      state.lastCount = bars.length
      state.attempts += 1
      loadOlder()
    }, 400)
    return () => { window.clearTimeout(timer) }
  }, [snapshot?.openState, snapshot?.hasMore, snapshot?.loadingOlder, bars.length, loadOlder])

  return (
    <div ref={hostRef} className={css.host}>
      {showButton && buttonPos !== null && createPortal(
        <div
          ref={wrapRef}
          className={css.buttonWrap}
          style={{ left: buttonPos.x, top: buttonPos.y, width: BUTTON_WIDTH }}
        >
          <button
            type="button"
            className={css.trigger}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`查看本会话已发送消息，共 ${totalCount} 条`}
            title="查看本会话全部已发送消息"
            onClick={() => { setOpen(prev => !prev) }}
          >
            <span className={css.triggerBadge}>{totalCount}</span>
          </button>
          {open && (
            <div className={css.popup} role="listbox" aria-label="会话消息列表">
              <div className={css.popupHead}>
                <span>消息列表</span>
                <small>共 {totalCount} 条已发送 · {sessionId}</small>
              </div>
              <div className={css.popupList}>
                {userMessages.map((entry, index) => {
                  const node = entry.node
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      role="option"
                      className={css.item}
                      onClick={() => {
                        jumpTo(entry.key)
                        setOpen(false)
                      }}
                    >
                      <span className={css.itemIndex}>{String(index + 1).padStart(2, '0')}</span>
                      <span className={css.itemMeta}>{formatTime(messageTime(node))}</span>
                      <span className={css.itemText}>{truncate(messageText(node), 160) || '(空消息)'}</span>
                    </button>
                  )
                })}
                {snapshot?.hasMore === true && (
                  <button
                    type="button"
                    className={css.loadOlder}
                    disabled={snapshot.loadingOlder === true}
                    onClick={loadOlder}
                  >
                    {snapshot.loadingOlder === true ? '加载中…' : '更早的消息尚未加载 — 点击加载'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
      {showPanel && panelPos !== null && createPortal(
        <div
          ref={panelRef}
          className={css.panel}
          style={{ left: panelPos.x, top: panelPos.y, width: PANEL_WIDTH, height: clamp(bars.length * PANEL_ROW_HEIGHT + PANEL_PADDING, 56, MAX_VISIBLE_ROWS * PANEL_ROW_HEIGHT + PANEL_PADDING) }}
          onPointerDown={onPanelPointerDown}
          onPointerMove={onPanelPointerMove}
          onPointerUp={onPanelPointerUp}
          onPointerLeave={() => { setHover(null) }}
        >
          <div ref={scrollerRef} className={css.scroller}>
            {bars.map(bar => (
              <div key={bar.key} data-bar-key={bar.key} className={css.row}>
                <button
                  type="button"
                  className={[css.bar, bar.key === activeKey ? css.barActive : ''].filter(Boolean).join(' ')}
                  aria-label={`跳转到我的第 ${bar.index + 1} 条消息`}
                  onMouseEnter={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setHover({ key: bar.key, y: rect.top + rect.height / 2 })
                  }}
                  onClick={() => { jumpTo(bar.key) }}
                />
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
      {hoverBar !== null && panelPos !== null && hover !== null && createPortal(
        <div
          className={css.tip}
          style={{
            left: panelPos.x - 312 < 8
              ? panelPos.x + PANEL_WIDTH + 12
              : panelPos.x - 312,
            top: clamp(hover.y - 20, 8, window.innerHeight - 196),
          }}
        >
          <div className={css.tipHead}>
            <span>我</span>
            <span className={css.tipMeta}>
              {hoverBar.seq > 0 ? `#${hoverBar.seq} · ` : ''}{formatTime(hoverBar.time)}
            </span>
          </div>
          <div className={css.tipBody}>
            {hoverBar.full !== '' ? truncate(hoverBar.full, 400) : '(空消息)'}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
