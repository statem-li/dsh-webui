/**
 * session-pin — 会话侧边栏置顶 / 归档按钮 / 右键菜单（client 半身核心）。
 *
 * 纯 DOM 注入，不改 DSH 源码。三件事：
 *
 *  1. 归档按钮：会话行 hover 时的三个点按钮让位给「归档」按钮（一键归档，
 *     点击直接调 workspaces.archiveSession，行随归档集回显消失）。三个点被
 *      CSS 隐藏，完整操作入口（置顶/重命名/分叉/归档）迁到右键菜单。
 *  2. 置顶：置顶会话在所在工作区分组内排到最前，标题前加图钉标记；置顶
 *     列表持久化在 store（localStorage）。折叠分组内被折叠隐藏的置顶会话
 *     （官方折叠时不渲染折叠区外的会话行）以插件自绘的「置顶补行」显示在
 *     折叠窗口顶部（图钉 + 标题，可点击打开 / 右键菜单）——置顶始终可见，
 *     同时不干预官方折叠行为（用户可自由折叠）。
 *  3. 右键菜单：contextmenu 命中会话行时弹出自绘菜单（置顶/取消置顶、
 *     重命名、分叉、归档）。
 *
 * 会话行不携带 data-session-id，sessionId 经 React fiber（主路径）或标题
 * 匹配（兜底）解析（见 store.ts）。DSH 每次重渲染会按官方顺序重建行，故用
 * MutationObserver（仅关注会话行增删）+ sessions.list 订阅 + 低频轮询兜底
 * 反复对齐置顶顺序与归档按钮。
 */

import type { ClientContext, ISessions, IWorkspaces, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { getPinned, isBlankRow, isPinned, resolveFiberProp, resolveSessionId, rowTitle, subscribePinned } from './store'
import { openSessionPinMenu, setSessionPinServices } from './context-menu'

/** 会话行选择器（CSS Modules 后缀稳定）。 */
const SESSION_ROW_SEL = '[class*="sessionRow"]'
/** 分组 header 行选择器（ProjectRowItem，点击整行展开/折叠整组）。 */
const GROUP_HEADER_SEL = '[class*="projectRow"]'
/** 会话行溢出按钮（组内 >5 个会话时的「展开 N 个 / 收起」按钮）。 */
const OVERFLOW_BTN_SEL = '[class*="sessionOverflowButton"]'
/** 归档按钮类名（样式表 + 幂等注入标记）。 */
const ARCHIVE_BTN_CLASS = 'dsp-archive-btn'
/** 置顶标记类名。 */
const PIN_BADGE_CLASS = 'dsp-pin-badge'

/** 归档按钮图标（SVG 字符串；与 icons.tsx 的 ArchiveIcon 同一 path）。 */
const ARCHIVE_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">'
  + '<path fill-rule="evenodd" clip-rule="evenodd" d="M15.8659 2.05975C17.2603 2.05995 18.3913 3.19096 18.3914 4.58527V5.4874C18.3914 6.02747 18.2192 6.52672 17.9303 6.93735C17.9336 6.96524 17.9388 6.99318 17.9388 7.02195V12.8884C17.9388 13.6345 17.9395 14.2379 17.8996 14.7254C17.8642 15.1593 17.7936 15.5499 17.6373 15.9141L17.5654 16.0685C17.278 16.6328 16.8405 17.1046 16.3038 17.434L16.0679 17.5661C15.66 17.7739 15.2196 17.8598 14.7237 17.9003C14.2362 17.9401 13.6327 17.9405 12.8867 17.9405H7.11122C6.36511 17.9405 5.76171 17.9401 5.27418 17.9003C4.84051 17.8649 4.44949 17.7952 4.08545 17.6391L3.93104 17.5661C3.36673 17.2785 2.89392 16.8414 2.56465 16.3044L2.43245 16.0685C2.22473 15.6608 2.13878 15.2211 2.09825 14.7254C2.05841 14.2379 2.05912 13.6345 2.05912 12.8884V7.02195C2.05912 6.99284 2.06422 6.96449 2.06758 6.93629C1.77931 6.52592 1.60858 6.02687 1.60858 5.4874V4.58527C1.60876 3.19084 2.73962 2.05975 4.1341 2.05975H15.8659ZM16.4984 7.92936C16.296 7.98169 16.0847 8.01288 15.8659 8.01291H4.1341C3.91478 8.01291 3.70246 7.98194 3.49955 7.92936V12.8884C3.49955 13.6582 3.50053 14.1927 3.53445 14.608C3.56769 15.0146 3.62923 15.244 3.71635 15.415L3.7925 15.5514C3.98339 15.8627 4.25749 16.1165 4.58464 16.2833L4.72529 16.3435C4.88095 16.3993 5.08638 16.4402 5.39158 16.4651C5.80685 16.4991 6.34138 16.5001 7.11122 16.5001H12.8867C13.6564 16.5001 14.1911 16.499 14.6063 16.4651C15.0128 16.432 15.2423 16.3703 15.4133 16.2833L15.5508 16.2061C15.8618 16.0152 16.116 15.7419 16.2827 15.415L16.3429 15.2732C16.3985 15.1177 16.4396 14.9128 16.4645 14.608C16.4985 14.1927 16.4984 13.6583 16.4984 12.8884V7.92936ZM4.1341 3.50019C3.53511 3.50019 3.0492 3.98631 3.04902 4.58527V5.4874C3.04902 6.08649 3.535 6.57248 4.1341 6.57248H15.8659C16.4648 6.57228 16.951 6.08638 16.951 5.4874V4.58527C16.9509 3.98644 16.4647 3.50038 15.8659 3.50019H4.1341Z"/>'
  + '<path d="M12.7962 12.5661V11.0832H7.20548V12.5661L12.7962 12.5661Z"/>'
  + '</svg>'

/** 置顶标记图标（SVG 字符串；与 icons.tsx 的 PinIcon 同一 path）。 */
const PIN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>'
  + '</svg>'

/** 是否为会话行或包含会话行的节点（MutationObserver 过滤用）。 */
function touchesSessionRow(node: Node): boolean {
  if (!(node instanceof Element)) return false
  return node.matches(SESSION_ROW_SEL) || node.querySelector(SESSION_ROW_SEL) !== null
}

// ── 归档按钮 ───────────────────────────────────────────────────────────────

/** 为每个非 blank 会话行注入归档按钮（幂等；blank 行无操作按钮）。 */
function ensureArchiveButtons(sessions: ISessions | undefined, workspaces: IWorkspaces | undefined): void {
  for (const row of document.querySelectorAll<HTMLElement>(SESSION_ROW_SEL)) {
    if (isBlankRow(row)) continue
    const actions = row.querySelector<HTMLElement>('[class*="rowActions"]')
    if (actions === null) continue
    if (actions.querySelector(`.${ARCHIVE_BTN_CLASS}`) !== null) continue

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = ARCHIVE_BTN_CLASS
    btn.setAttribute('aria-label', '归档会话')
    btn.setAttribute('title', '归档会话')
    btn.innerHTML = ARCHIVE_SVG
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      const id = resolveSessionId(row, sessions, new Set())
      if (id === null) return
      workspaces?.archiveSession(id).catch(() => { /* 归档失败非致命 */ })
    })
    actions.appendChild(btn)
  }
}

// ── 置顶标记 + 排序 ────────────────────────────────────────────────────────

/** 会话行的「可移动单元」：sessionRow 向上到 container 直接子级的那个元素。
 *  ui-workspace 用 HoverCard 包裹行，sessionRow 并非 groupSection/tree 的
 *  直接子级——移动时必须搬 HoverCard wrapper，否则只搬了内层 div。 */
function topLevelUnit(row: HTMLElement, container: Element): HTMLElement {
  let node: HTMLElement = row
  while (node.parentElement !== null && node.parentElement !== container) node = node.parentElement
  return node
}

/** 会话行条目（解析一次，排序与标记复用）。 */
interface SessionEntry {
  /** 会话行元素（标题/操作按钮所在）。 */
  row: HTMLElement
  /** 可移动单元（HoverCard wrapper，container 的直接子级）。 */
  unit: HTMLElement
  /** 解析出的 sessionId（fiber 主路径 + 标题消歧兜底）。 */
  id: SessionId | null
}

/** 收集容器内全部会话行条目（sessionRow 经 HoverCard wrapper 包裹，不限层级）。 */
function collectEntries(container: Element, sessions: ISessions | undefined, consumed: Set<string>): SessionEntry[] {
  return Array.from(container.querySelectorAll<HTMLElement>(SESSION_ROW_SEL))
    .map(row => ({ row, unit: topLevelUnit(row, container), id: resolveSessionId(row, sessions, consumed) }))
}

/** 同步置顶标记：置顶行标题前加图钉，非置顶行移除。 */
function syncPinBadges(entries: readonly SessionEntry[]): void {
  for (const { row, id } of entries) {
    const pinned = id !== null && isPinned(id)
    const badge = row.querySelector<HTMLElement>(`.${PIN_BADGE_CLASS}`)
    if (pinned && badge === null) {
      const el = document.createElement('span')
      el.className = PIN_BADGE_CLASS
      el.innerHTML = PIN_SVG
      const title = row.querySelector<HTMLElement>('[class*="title"]')
      if (title !== null) row.insertBefore(el, title)
      else row.prepend(el)
    } else if (!pinned && badge !== null) {
      badge.remove()
    }
  }
}

/** 置顶排序滑动动画时长与缓动（与 session-motion 的侧边栏高亮滑动同款节奏）。 */
const SLIDE_MS = 260
const SLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** 系统「减弱动态效果」偏好。 */
function motionReduced(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * 对单个「会话行容器」重排：置顶会话按置顶顺序排最前，其余保持原顺序。
 * 容器 = 分组视图的 groupSection，或 flat 视图的 `[role="tree"]`。
 * 移动的是 HoverCard wrapper（unit）；顺序已正确时不移动（幂等，避免与
 * MutationObserver 互相触发）。
 * @param animate - true 时对发生位移的行做 FLIP 滑动动画（置顶/取消置顶触发）。
 */
function orderContainer(container: Element, entries: readonly SessionEntry[], animate: boolean): void {
  if (entries.length < 2) return
  // unit 去重（每个 wrapper 恰含一个 sessionRow，防御性去重）。
  const unique: SessionEntry[] = []
  const seen = new Set<HTMLElement>()
  for (const entry of entries) {
    if (seen.has(entry.unit)) continue
    seen.add(entry.unit)
    unique.push(entry)
  }

  const pinnedIds = getPinned()
  const pinnedSet = new Set(pinnedIds)
  const expected: HTMLElement[] = [
    ...pinnedIds
      .map(id => unique.find(entry => entry.id === id)?.unit)
      .filter((unit): unit is HTMLElement => unit !== undefined),
    ...unique
      .filter(entry => entry.id === null || !pinnedSet.has(entry.id))
      .map(entry => entry.unit),
  ]
  const current = unique.map(entry => entry.unit)
  if (current.length === expected.length && current.every((unit, index) => unit === expected[index])) return

  // anchor = 会话行区域之后的第一个兄弟元素（溢出按钮等），移动前记录。
  const anchor = current[current.length - 1].nextElementSibling

  // FLIP 动画：移动前先记录每个 unit 的位置，移动后再反向补偿 + 平滑滑到新位置。
  const firstRects = animate && !motionReduced()
    ? current.map(unit => unit.getBoundingClientRect())
    : null

  // 用 DocumentFragment 一次性按 expected 顺序重插：insertBefore 到固定 anchor
  // 会逆序，fragment 则保留内部顺序、插入锚点前。
  const frag = document.createDocumentFragment()
  for (const unit of expected) frag.appendChild(unit)
  container.insertBefore(frag, anchor)

  if (firstRects === null) return
  current.forEach((unit, index) => {
    const last = unit.getBoundingClientRect()
    const dx = firstRects[index].left - last.left
    const dy = firstRects[index].top - last.top
    if (dx === 0 && dy === 0) return
    // 取消该元素上在跑的动画（连续置顶/取消时避免叠加），再播滑动。
    unit.getAnimations().forEach(a => a.cancel())
    const anim = unit.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0px, 0px)' },
      ],
      { duration: SLIDE_MS, easing: SLIDE_EASING },
    )
    // 兜底：动画时长 + 缓冲后强制结束，防 rAF 冻结/异常让元素停在反向补偿帧。
    window.setTimeout(() => { anim.cancel() }, SLIDE_MS + 80)
  })
}

/** 全量对齐：归档按钮 + 置顶标记 + 置顶排序 + 置顶补行。 */
function applyAll(sessions: ISessions | undefined, workspaces: IWorkspaces | undefined, animate = false): void {
  ensureArchiveButtons(sessions, workspaces)

  const consumed = new Set<string>()
  // 分组视图：会话行都在 groupSection 内；flat 视图：无 groupSection，行在 tree 下。
  const groups = Array.from(document.querySelectorAll('[class*="groupSection"]'))
  const containers: Element[] = groups.length > 0
    ? groups
    : Array.from(document.querySelectorAll('[role="tree"]'))
  for (const container of containers) {
    const entries = collectEntries(container, sessions, consumed)
    syncPinBadges(entries)
    orderContainer(container, entries, animate)
  }

  // 置顶补行：折叠分组内被隐藏的置顶会话以自绘行显示（不干预官方折叠）。
  if (groups.length > 0) syncPinnedSurrogates(groups, sessions, workspaces)
}

// ── 置顶补行（折叠窗口外的置顶会话以自绘行显示） ───────────────────────────

/** 自绘置顶行容器类名（幂等注入标记）。 */
const SURROGATE_LIST_CLASS = 'dsp-pin-surrogates'
/** 自绘置顶行类名。 */
const SURROGATE_CLASS = 'dsp-pin-surrogate'

/**
 * 从分组 header 行沿 React fiber 链解析 GroupNode.key（真实工作区 =
 * workspaceId；未分组桶 = 空字符串）。fiber 不可用时返回 null。
 */
function groupKeyOf(header: HTMLElement): string | null {
  return resolveFiberProp(header, (props) => {
    const group = props.group
    if (group === null || typeof group !== 'object') return null
    const key = (group as { key?: unknown }).key
    // 空字符串是官方 UNGROUPED_KEY（未分组桶），同样合法。
    return typeof key === 'string' ? key : null
  })
}

/**
 * 分组内全部可见会话 id（archived 与缺失 summary 已过滤，顺序 = account
 * 顺序）：真实工作区取 workspace.sessionIds；未分组桶取不在任何 workspace
 * account 内的散会话。
 */
function groupSessionIds(
  key: string,
  sessions: ISessions | undefined,
  workspaces: IWorkspaces | undefined,
): SessionId[] {
  const wsState = workspaces?.list.getSnapshot()
  const items = wsState?.items ?? []
  const archived = new Set(wsState?.archivedSessionIds ?? [])
  const byId = sessions?.list.getSnapshot().byId ?? {}
  if (key !== '') {
    const ws = items.find(item => item.workspaceId === key)
    if (ws === undefined) return []
    return ws.sessionIds.filter(id => byId[id] !== undefined && !archived.has(id))
  }
  const accounted = new Set(items.flatMap(item => item.sessionIds))
  return (sessions?.list.getSnapshot().ids ?? [])
    .filter(id => byId[id] !== undefined && !accounted.has(id) && !archived.has(id))
}

/**
 * 收集组内「被折叠隐藏」的置顶会话（完整列表有、已渲染行无），按置顶顺序
 * 返回；需要展示标题，会话已不存在 / 无标题的跳过。
 */
function hiddenPinnedEntries(
  group: Element,
  key: string,
  sessions: ISessions | undefined,
  workspaces: IWorkspaces | undefined,
): { id: SessionId; title: string }[] {
  const pinned = getPinned()
  if (pinned.length === 0) return []
  const pinnedSet = new Set(pinned)
  // 组内已渲染（DOM 实际存在）的会话行 id。
  const visible = new Set<string>()
  const consumed = new Set<string>()
  for (const row of group.querySelectorAll<HTMLElement>(SESSION_ROW_SEL)) {
    const id = resolveSessionId(row, sessions, consumed)
    if (id !== null) visible.add(id)
  }
  const hidden = groupSessionIds(key, sessions, workspaces)
    .filter(id => pinnedSet.has(id) && !visible.has(id))
  if (hidden.length === 0) return []
  const byId = sessions?.list.getSnapshot().byId ?? {}
  return pinned
    .filter(id => hidden.includes(id))
    .map(id => ({ id, title: byId[id]?.displayTitle ?? '' }))
    .filter(entry => entry.title !== '')
}

/**
 * 同步「置顶补行」：折叠分组内被隐藏的置顶会话以自绘行显示在折叠窗口
 * 顶部（header 之后），置顶始终可见；不干预官方折叠行为，用户可自由
 * 折叠/展开。行内容：图钉 + 标题，点击打开会话，右键弹出置顶菜单。
 *
 * 幂等：id 序列一致时不重建 DOM（避免与 MutationObserver 互相触发死
 * 循环），仅标题 / 当前会话高亮变化时原地更新；React 重渲染打乱注入
 * 位置时用 header.after(container) 原地「搬」回去——移动已有节点不会
 * 重建 DOM，避免出现「消失一帧再出现」的闪烁。
 *
 * 每个分组独立处理：任一分组命中幂等分支也必须继续处理后面的分组
 * （早期版本此处 return 会漏掉后续分组，表现为另一个工作区的置顶补行
 * 迟到到下一轮兜底轮询才出现＝折叠时闪一下）。
 */
function syncPinnedSurrogates(
  groups: Element[],
  sessions: ISessions | undefined,
  workspaces: IWorkspaces | undefined,
): void {
  const current = sessions?.list.getSnapshot().current
  for (const group of groups) {
    const header = group.querySelector<HTMLElement>(GROUP_HEADER_SEL)
    if (header === null) continue
    const key = groupKeyOf(header)
    if (key === null) continue
    const hidden = hiddenPinnedEntries(group, key, sessions, workspaces)
    const container = group.querySelector<HTMLElement>(`.${SURROGATE_LIST_CLASS}`)
    if (hidden.length === 0) {
      container?.remove()
      continue
    }

    // 幂等分支：id 序列一致 → 只原地更新标题 / 高亮，必要时把容器搬回
    // header 之后（移动已有节点，不销毁重建，避免闪烁）。
    if (container !== null) {
      const ids = Array.from(container.querySelectorAll<HTMLElement>(`.${SURROGATE_CLASS}`))
        .map(el => el.dataset.sessionId)
      const idsMatch = ids.length === hidden.length && hidden.every((h, i) => ids[i] === h.id)
      if (idsMatch) {
        if (container.previousElementSibling !== header) header.after(container)
        hidden.forEach((h, i) => {
          const row = container.children[i] as HTMLElement | undefined
          const titleEl = row?.querySelector<HTMLElement>('[data-role="title"]')
          if (titleEl !== undefined && titleEl !== null && titleEl.textContent !== h.title) {
            titleEl.textContent = h.title
          }
          row?.classList.toggle(`${SURROGATE_CLASS}-selected`, h.id === current)
        })
        // 本组已对齐，继续处理后面的分组（早期版本这里 return 会漏组）。
        continue
      }
      container.remove()
    }

    // 新建容器（header 之后 = 折叠窗口顶部）。
    const list = document.createElement('div')
    list.className = SURROGATE_LIST_CLASS
    for (const { id, title } of hidden) {
      const row = document.createElement('div')
      row.className = SURROGATE_CLASS
      row.classList.toggle(`${SURROGATE_CLASS}-selected`, id === current)
      row.dataset.sessionId = id
      const icon = document.createElement('span')
      icon.className = `${SURROGATE_CLASS}-icon`
      icon.innerHTML = PIN_SVG
      const titleEl = document.createElement('span')
      titleEl.dataset.role = 'title'
      titleEl.textContent = title
      titleEl.title = title
      row.append(icon, titleEl)
      list.appendChild(row)
    }
    // 事件委托（容器级；重建时旧容器整体移除，监听随之释放）。
    list.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const row = target.closest<HTMLElement>(`.${SURROGATE_CLASS}`)
      if (row === null) return
      const id = row.dataset.sessionId as SessionId | undefined
      if (id !== undefined) sessions?.open(id)
    })
    list.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      const target = event.target
      if (!(target instanceof Element)) return
      const row = target.closest<HTMLElement>(`.${SURROGATE_CLASS}`)
      if (row === null) return
      const id = row.dataset.sessionId as SessionId | undefined
      if (id === undefined) return
      openSessionPinMenu({
        sessionId: id,
        x: event.clientX,
        y: event.clientY,
        pinned: true,
        title: row.querySelector('[data-role="title"]')?.textContent ?? '',
      })
    })
    header.after(list)
  }
}

// ── 右键菜单 ───────────────────────────────────────────────────────────────

/** 右键命中会话行 → 弹出自绘菜单（blank 行不弹）。 */
function onContextMenu(event: MouseEvent, sessions: ISessions | undefined): void {
  const target = event.target
  if (!(target instanceof Element)) return
  const row = target.closest<HTMLElement>(SESSION_ROW_SEL)
  if (row === null || isBlankRow(row)) return
  event.preventDefault()
  const id = resolveSessionId(row, sessions, new Set())
  if (id === null) return
  openSessionPinMenu({
    sessionId: id,
    x: event.clientX,
    y: event.clientY,
    pinned: isPinned(id),
    title: rowTitle(row) ?? '',
  })
}

// ── 装配 ───────────────────────────────────────────────────────────────────

/** 会话列表数据变化后重对齐的去抖间隔（非视觉紧急路径）。 */
const APPLY_DEBOUNCE_MS = 50
/** 低频兜底轮询间隔（侧边栏重挂 / 观察失联兜底）。 */
const POLL_MS = 1500

/**
 * 启动会话置顶 / 归档按钮 / 右键菜单维护器；返回停止函数。
 * @param ctx - 浏览器插件上下文（读取 sessions / workspaces 服务）。
 */
export function startSessionPin(ctx: ClientContext): () => void {
  if (typeof document === 'undefined') return () => {}

  const sessions = (ctx as any).get('sessions') as ISessions | undefined
  const workspaces = (ctx as any).get('workspaces') as IWorkspaces | undefined
  setSessionPinServices(sessions, workspaces)

  let disposed = false
  let applyTimer = 0

  const schedule = (): void => {
    if (disposed) return
    if (applyTimer !== 0) return
    applyTimer = window.setTimeout(() => {
      applyTimer = 0
      if (!disposed) applyAll(sessions, workspaces)
    }, APPLY_DEBOUNCE_MS)
  }

  // 会话行增删 / 重排（折叠展开、React 重渲染恢复官方顺序）→ 立即对齐。
  //
  // 这里必须同步（不去抖）：折叠工作区时官方把组内会话行整批移出 DOM，若
  // 等 50ms 去抖再补「置顶补行」，中间会有若干帧「置顶行已消失、补行还没
  // 出现」——即折叠瞬间闪一下。MutationObserver 回调在 DOM 变更后的微任务
  // 里执行，早于本次绘制，同步补齐即可做到零闪。
  //
  // 死循环防护：applyAll 幂等（顺序/补行已正确时不写 DOM），第二轮不再产生
  // 变更，观察者自然停摆；万一遇到与官方渲染互相打脸的病态情况，短窗口内
  // 连续同步对齐超过阈值就退回去抖，避免同步递归占满主线程。
  const SYNC_BURST_LIMIT = 8
  const SYNC_BURST_WINDOW_MS = 200
  let syncBurst = 0
  let lastSyncAt = 0

  const applyNow = (): void => {
    const now = Date.now()
    syncBurst = now - lastSyncAt > SYNC_BURST_WINDOW_MS ? 1 : syncBurst + 1
    lastSyncAt = now
    if (syncBurst > SYNC_BURST_LIMIT) { schedule(); return }
    applyAll(sessions, workspaces)
  }

  const observer = new MutationObserver((mutations) => {
    if (disposed) return
    const relevant = mutations.some(mutation => {
      for (const node of mutation.addedNodes) if (touchesSessionRow(node)) return true
      for (const node of mutation.removedNodes) if (touchesSessionRow(node)) return true
      return false
    })
    if (relevant) applyNow()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // 会话列表变化 → 去抖后无动画重排；置顶列表变化 → 立即带动画重排
  // （置顶补行同步刷新，让刚置顶的会话立即可见）。
  const unsubscribeSessions = sessions?.list.subscribe(schedule)
  const unsubscribePinned = subscribePinned(() => {
    if (!disposed) applyAll(sessions, workspaces, true)
  })

  // 低频兜底（侧边栏重挂、观察失联）。
  const poll = window.setInterval(() => { if (!disposed) applyAll(sessions, workspaces) }, POLL_MS)

  const onCtx = (event: MouseEvent): void => { onContextMenu(event, sessions) }
  document.addEventListener('contextmenu', onCtx, true)

  // 首轮对齐。
  applyAll(sessions, workspaces)

  return () => {
    disposed = true
    if (applyTimer !== 0) window.clearTimeout(applyTimer)
    window.clearInterval(poll)
    observer.disconnect()
    unsubscribeSessions?.()
    unsubscribePinned()
    document.removeEventListener('contextmenu', onCtx, true)
    // 清理注入的归档按钮、置顶标记与置顶补行。
    for (const el of document.querySelectorAll(
      `.${ARCHIVE_BTN_CLASS}, .${PIN_BADGE_CLASS}, .${SURROGATE_LIST_CLASS}`,
    )) el.remove()
  }
}
