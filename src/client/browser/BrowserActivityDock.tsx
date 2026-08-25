/**
 * dsh-browser — 会话内浏览器常驻按钮 + 右侧滑出抽屉（client 半身）。
 *
 * 常驻按钮挂在 `conversation.input.left`（输入框工具行，记忆开关旁），当前会话有
 * 浏览器活动时图标高亮并脉冲；点击滑出抽屉。
 *
 * 抽屉布局（2026-10 重做）是一套真正的浏览器 chrome：
 *   ┌ tabstrip   品牌标记 · 标签页 · 新建 · 关闭
 *   ├ toolbar    后退/前进/刷新 · 地址栏（可编辑、安全标识、加载进度）· 收藏 · 选取 · 更多
 *   ├ bookmarks  书签胶囊 · 管理面板（可在「更多」里整条隐藏）
 *   ├ 画面区     原生 WebContentsView 贴合于此；未贴合时回退实时帧 img
 *   └ 时间线     底部悬浮细轨（最新一条操作），点开展开完整列表
 * 左缘 4px 把手可拖拽调宽（localStorage 持久化）。
 *
 * 浏览器本体是壳内嵌视图；抽屉里的鼠标/键盘/滚轮事件按帧坐标缩放后经
 * `/api/dsh-browser/input` 回传 CDP Input 域。
 */
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { browserActivityStore } from './activity'
import {
  BackIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, CopyIcon, ForwardIcon,
  GlobeIcon, InsecureIcon, LockIcon, MoreIcon, PickIcon, PlusIcon, ReloadIcon, StarIcon, TrashIcon,
} from './icons'

/** 抽屉收起动画时长（与 styles 里 transition 保持一致）。 */
const CLOSE_ANIM_MS = 300
/** 抽屉宽度持久化键与边界。 */
const WIDTH_KEY = 'dsh-webui.browser.drawerWidth'
const MIN_WIDTH = 520
/** 右侧留白（与 styles 的 max-width 计算保持一致）。 */
const EDGE_GAP = 44
/** 书签栏显示偏好持久化键。 */
const BOOKMARKS_KEY = 'dsh-webui.browser.bookmarksBar'

interface SessionStep {
  seq: number
  tool: string
  label: string
  detail: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  finishedAt: number | null
  result: string
}

/** 壳内浏览器标签页信息。 */
interface BrowserTabInfo {
  tabId: string
  title: string
  url: string
  active: boolean
}

interface SessionDetail {
  ok?: boolean
  sessionId?: string
  active?: boolean
  running?: boolean
  url?: string
  title?: string
  canBack?: boolean
  canForward?: boolean
  steps?: SessionStep[]
  shell?: boolean
  tabs?: BrowserTabInfo[]
  activeTabId?: string | null
}

/** 元素选取结果（与 /api/dsh-browser/element 响应一致）。 */
interface PickedElement {
  found: boolean
  selector: string
  tag: string
  id: string
  className: string
  role: string
  text: string
  label: string
}

/** 把元素选取结果拼成一行可读摘要（填入对话框用）。 */
function buildSummary(info: PickedElement): string {
  let s = `<${info.tag}`
  if (info.id !== '') s += `#${info.id}`
  const cls = info.className.trim().split(/\s+/).slice(0, 3).join('.')
  if (cls !== '') s += `.${cls}`
  if (info.role !== '') s += ` role="${info.role}"`
  s += '>'
  const t = (info.text !== '' ? info.text : info.label).trim()
  if (t !== '') s += ` "${t.length > 80 ? t.slice(0, 80) + '…' : t}"`
  return s
}

const STATUS_TEXT: Record<SessionStep['status'], string> = {
  running: '进行中',
  done: '完成',
  error: '失败',
}

/** 星环加载动画：星球 + 倾斜环绕行（画面加载中的视觉反馈）。 */
function LoadingOrbit() {
  return (
    <svg className="dsh-browser-loading__orbit" width="60" height="60" viewBox="0 0 80 80" aria-hidden>
      <defs>
        <radialGradient id="dsh-orbit-planet" cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#8ec5ff" />
          <stop offset="0.55" stopColor="#4a9eff" />
          <stop offset="1" stopColor="#2456b8" />
        </radialGradient>
        <linearGradient id="dsh-orbit-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7cb8ff" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#4a9eff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#4a9eff" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="40" cy="40" r="14" fill="url(#dsh-orbit-planet)" />
      <g className="dsh-browser-loading__ring">
        <ellipse cx="40" cy="40" rx="31" ry="10" fill="none" stroke="url(#dsh-orbit-ring)" strokeWidth="2.6" />
        <circle className="dsh-browser-loading__sat" cx="71" cy="40" r="2.6" fill="#cfe6ff" />
      </g>
    </svg>
  )
}

/** URL → 去 www 的主机名（失败返回空串）。 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** 站点首字母标记（代替 favicon：内嵌视图取不到 favicon，也不想额外发请求）。 */
function initialOf(text: string, url: string): string {
  const host = hostOf(url)
  const src = host !== '' ? host : text.trim()
  const ch = src.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0)
  return ch === '' ? '·' : ch
}

/** 图标按钮：统一 28×28 命中区 + Tooltip；工具栏/标签栏共用。 */
function IconButton({
  label, onClick, children, active = false, disabled = false, danger = false, tooltipSide = 'bottom',
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  danger?: boolean
  tooltipSide?: 'top' | 'bottom'
}) {
  const cls = [
    'dsh-browser-ico',
    active ? 'dsh-browser-ico--on' : '',
    danger ? 'dsh-browser-ico--danger' : '',
  ].filter(Boolean).join(' ')
  const btn = (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active}>
      {children}
    </button>
  )
  // 禁用态不挂 Tooltip：DSH Tooltip 依赖子元素事件，disabled 按钮不派发。
  if (disabled) return btn
  return <Tooltip label={label} side={tooltipSide} delayMs={420}>{btn}</Tooltip>
}

function StepRow({ step }: { step: SessionStep }) {
  return (
    <div className={`dsh-browser-step dsh-browser-step--${step.status}`}>
      <div className="dsh-browser-step__row">
        <span className="dsh-browser-step__dot" aria-hidden />
        <span className="dsh-browser-step__label">{step.label || step.tool}</span>
        <span className="dsh-browser-step__status">{STATUS_TEXT[step.status]}</span>
      </div>
      {step.status === 'error' && step.result !== '' && (
        <div className="dsh-browser-step__result">{step.result}</div>
      )}
    </div>
  )
}

/** 快捷标签网站（全局书签，跨会话共享）。 */
interface BookmarkSite {
  id: string
  title: string
  url: string
}

/**
 * 书签栏：点胶囊 = 在内嵌浏览器新开标签打开（不打断 AI 正在操作的页面）；
 * 右端「管理」展开面板做增删。收藏当前页由工具栏的星形按钮负责。
 */
function BookmarksBar({ sites, sessionId, currentUrl, onChanged, onMutate }: {
  sites: BookmarkSite[]
  sessionId: string
  currentUrl: string
  onChanged: () => void
  onMutate: (payload: Record<string, unknown>) => void
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const curHost = hostOf(currentUrl)

  const openSite = useCallback((siteUrl: string): void => {
    fetch('/api/dsh-browser/navigate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, url: siteUrl, newTab: true }),
    })
      .then(() => { onChanged() })
      .catch(() => {})
  }, [sessionId, onChanged])

  const addSite = useCallback((): void => {
    if (title.trim() === '' || url.trim() === '') return
    onMutate({ action: 'add', title: title.trim(), url: url.trim() })
    setTitle('')
    setUrl('')
  }, [title, url, onMutate])

  return (
    <div className="dsh-browser-sites">
      <div className="dsh-browser-sites__row">
        {sites.length === 0 && !panelOpen && (
          <span className="dsh-browser-sites__empty">还没有书签 — 用工具栏的星形按钮收藏当前页</span>
        )}
        {sites.map((s) => {
          const active = curHost !== '' && hostOf(s.url) === curHost
          return (
            <Tooltip key={s.id} label={`新标签页打开 · ${s.url}`} side="bottom" delayMs={480}>
              <button
                type="button"
                className={active ? 'dsh-browser-site dsh-browser-site--active' : 'dsh-browser-site'}
                onClick={() => { openSite(s.url) }}
              >
                <span className="dsh-browser-site__mark" aria-hidden>{initialOf(s.title, s.url)}</span>
                {s.title}
              </button>
            </Tooltip>
          )
        })}
        <button
          type="button"
          className={panelOpen ? 'dsh-browser-sites__manage dsh-browser-sites__manage--on' : 'dsh-browser-sites__manage'}
          onClick={() => { setPanelOpen((v) => !v) }}
          aria-expanded={panelOpen}
          aria-label="管理书签"
          title="添加 / 删除书签"
        >
          {panelOpen ? <ChevronUpIcon size={14} /> : <PlusIcon size={14} />}
        </button>
      </div>
      {panelOpen && (
        <div className="dsh-browser-sites__editor">
          <div className="dsh-browser-sites__form">
            <input
              className="dsh-browser-sites__input dsh-browser-sites__input--title"
              placeholder="名称"
              value={title}
              maxLength={40}
              onChange={(e) => { setTitle(e.target.value) }}
              onKeyDown={(e) => { if (e.key === 'Enter') addSite() }}
            />
            <input
              className="dsh-browser-sites__input dsh-browser-sites__input--url"
              placeholder="网址，如 github.com"
              value={url}
              onChange={(e) => { setUrl(e.target.value) }}
              onKeyDown={(e) => { if (e.key === 'Enter') addSite() }}
            />
            <button
              type="button"
              className="dsh-browser-sites__save"
              onClick={addSite}
              disabled={title.trim() === '' || url.trim() === ''}
            >
              添加
            </button>
          </div>
          {sites.length > 0 && (
            <div className="dsh-browser-sites__list">
              {sites.map((s) => (
                <div key={s.id} className="dsh-browser-sites__item">
                  <span className="dsh-browser-sites__item-title">{s.title}</span>
                  <span className="dsh-browser-sites__item-url">{s.url}</span>
                  <button
                    type="button"
                    className="dsh-browser-sites__del"
                    onClick={() => { onMutate({ action: 'remove', id: s.id }) }}
                    aria-label={`删除 ${s.title}`}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 标签页栏：切换 / 关闭 / 新建；标签带站点首字母标记。 */
function TabsBar({ tabs, onSwitch, onClose }: {
  tabs: BrowserTabInfo[]
  onSwitch: (tabId: string) => void
  onClose: (tabId: string) => void
}) {
  return (
    <div className="dsh-browser-tabs" role="tablist" aria-label="浏览器标签页">
      {tabs.map((t) => (
        <div
          key={t.tabId}
          role="tab"
          aria-selected={t.active}
          tabIndex={t.active ? 0 : -1}
          className={t.active ? 'dsh-browser-tab dsh-browser-tab--active' : 'dsh-browser-tab'}
          title={`${t.title}\n${t.url}`}
          onClick={() => { if (!t.active) onSwitch(t.tabId) }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSwitch(t.tabId) } }}
        >
          <span className="dsh-browser-tab__mark" aria-hidden>{initialOf(t.title, t.url)}</span>
          <span className="dsh-browser-tab__title">{t.title || '新标签页'}</span>
          <button
            type="button"
            className="dsh-browser-tab__close"
            onClick={(e) => { e.stopPropagation(); onClose(t.tabId) }}
            aria-label={`关闭标签 ${t.title}`}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * 地址栏：非编辑态展示「安全标识 + 域名强调 + 路径淡化」，点击进入编辑并全选；
 * Enter 导航（缺协议由服务端补 https），Esc 取消。加载中在底缘显示进度轨。
 */
function OmniBox({ url, loading, onNavigate }: {
  url: string
  loading: boolean
  onNavigate: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const begin = useCallback((): void => {
    setText(url)
    setEditing(true)
  }, [url])

  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (el === null) return
    el.focus()
    el.select()
  }, [editing])

  const commit = useCallback((): void => {
    const next = text.trim()
    setEditing(false)
    if (next === '' || next === url) return
    onNavigate(next)
  }, [text, url, onNavigate])

  // 非编辑态的三段式展示：协议 + 域名（强调）+ 其余路径（淡化）。
  const parts = useMemo(() => {
    if (url === '') return null
    try {
      const u = new URL(url)
      return { secure: u.protocol === 'https:', host: u.hostname.replace(/^www\./, ''), rest: `${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}` }
    } catch {
      return { secure: false, host: '', rest: url }
    }
  }, [url])

  return (
    <div className="dsh-browser-omni" onClick={() => { if (!editing) begin() }}>
      {parts !== null && !editing && (
        <span
          className={parts.secure ? 'dsh-browser-omni__lock' : 'dsh-browser-omni__lock dsh-browser-omni__lock--insecure'}
          title={parts.secure ? '连接已加密（HTTPS）' : '连接未加密'}
        >
          {parts.secure ? <LockIcon size={13} /> : <InsecureIcon size={13} />}
        </span>
      )}
      {editing
        ? (
          <input
            ref={inputRef}
            className="dsh-browser-omni__input"
            value={text}
            placeholder="输入网址后回车"
            spellCheck={false}
            onChange={(e) => { setText(e.target.value) }}
            onBlur={() => { setEditing(false) }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') setEditing(false)
            }}
          />
        )
        : (
          <button type="button" className="dsh-browser-omni__text" title={url} onClick={begin}>
            {parts === null
              ? <span className="dsh-browser-omni__placeholder">输入网址后回车</span>
              : (
                <>
                  <span className="dsh-browser-omni__host">{parts.host}</span>
                  {parts.rest}
                </>
              )}
          </button>
        )}
      {loading && <span className="dsh-browser-omni__prog" aria-hidden />}
    </div>
  )
}

/** 更多菜单：书签栏显隐 / 复制网址 / 关闭其他标签 / 关闭浏览器。 */
function MoreMenu({ open, onOpenChange, items }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  items: Array<{ key: string; label: string; hint?: string; disabled?: boolean; onSelect: () => void }>
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current !== null && !wrapRef.current.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [open, onOpenChange])

  return (
    <div className="dsh-browser-more-wrap" ref={wrapRef}>
      <IconButton label="更多" active={open} onClick={() => { onOpenChange(!open) }}>
        <MoreIcon size={16} />
      </IconButton>
      {open && (
        <div className="dsh-browser-more" role="menu">
          {items.map((it) => (
            it.key.startsWith('sep')
              ? <div key={it.key} className="dsh-browser-more__sep" role="separator" />
              : (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  className="dsh-browser-more__item"
                  disabled={it.disabled === true}
                  onClick={() => { onOpenChange(false); it.onSelect() }}
                >
                  {it.label}
                  {it.hint !== undefined && <span className="dsh-browser-more__hint">{it.hint}</span>}
                </button>
              )
          ))}
        </div>
      )}
    </div>
  )
}

/** 读取持久化的抽屉宽度（越界值回落到默认「留 44px 空隙」）。 */
function readWidth(): number {
  const max = Math.max(MIN_WIDTH, window.innerWidth - EDGE_GAP)
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY)
    const n = raw === null ? NaN : Number(raw)
    if (Number.isFinite(n) && n >= MIN_WIDTH) return Math.min(n, max)
  } catch { /* 隐私模式禁用 storage */ }
  return max
}

/**
 * 右侧滑出预览抽屉：左侧留一条空隙（hitzone），点击空隙收回。
 * 滑入动画结束后把壳内嵌视图（或独立窗口）精确贴合到画面区屏幕坐标——原生
 * 渲染 + 原生输入；未贴合期间用实时帧 img 兜底显示并接收交互。
 */
function BrowserDrawer({ sessionId, onClose, onPickElement }: {
  sessionId: string
  onClose: () => void
  onPickElement: (info: PickedElement) => void
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [frameUrl, setFrameUrl] = useState('')
  const [frameError, setFrameError] = useState(false)
  // 开合动画：挂载后下一帧展开；关闭时先播放收起动画再真正卸载。
  const [open, setOpen] = useState(false)
  const closingRef = useRef(false)
  const frameBoxRef = useRef<HTMLDivElement | null>(null)
  const frameElRef = useRef<HTMLImageElement | null>(null)
  const frameSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })

  // 真实窗口是否已贴合盖住画面区：贴合后停掉帧轮询（画面由原生窗口接管）。
  const attachedRef = useRef(false)
  // 操作时间线：默认收起为底部悬浮细轨（一句话），点开才展开完整列表。
  const [timelineOpen, setTimelineOpen] = useState(false)
  // 元素选取模式：开启后隐藏原生视图、画面回到 img 帧流（React 才能收到点击）。
  const [picking, setPicking] = useState(false)
  const pickingRef = useRef(false)
  const setPickingBoth = useCallback((v: boolean): void => {
    pickingRef.current = v
    setPicking(v)
  }, [])

  // hover 范围提示：选取模式下鼠标移动实时采集命中元素范围，叠加高亮框。
  const [hover, setHover] = useState<{ tag: string; left: number; top: number; width: number; height: number } | null>(null)
  const hoverPendingRef = useRef<{ x: number; y: number } | null>(null)
  const hoverInFlightRef = useRef(false)
  const hoverSeqRef = useRef(0)

  // ── 新增 UI 状态：宽度拖拽 / 书签栏显隐 / 更多菜单 / 导航忙态 / 复制反馈 ──
  const [width, setWidth] = useState<number>(() => readWidth())
  const [resizing, setResizing] = useState(false)
  const [bookmarksOn, setBookmarksOn] = useState<boolean>(() => {
    try { return window.localStorage.getItem(BOOKMARKS_KEY) !== '0' } catch { return true }
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [navBusy, setNavBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sites, setSites] = useState<BookmarkSite[]>([])

  const activeTab = detail?.tabs?.find((t) => t.active) ?? null
  const currentUrl = activeTab?.url ?? detail?.url ?? ''
  const steps = (detail?.steps ?? []).slice().reverse()
  const running = detail?.active === true || steps.some(s => s.status === 'running')

  /** 时间线占用的画面高度：收起=细轨 34px；展开=min(300, 45%)。原生视图需让位。 */
  const timelineReserveH = useCallback((frameH: number): number => {
    return timelineOpen ? Math.min(300, Math.round(frameH * 0.45)) : 34
  }, [timelineOpen])

  // 把浏览器视图贴合到画面区（壳内模式=挂载 WebContentsView，DIP 坐标；
  // 独立窗口兜底模式=移动 Chrome app 窗口到屏幕坐标，物理 px）。
  const syncViewBounds = useCallback((): void => {
    // 元素选取模式下不贴合原生视图：画面保持 img 帧流，React 才能收到点击。
    if (pickingRef.current) return
    const box = frameBoxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    if (rect.width < 60 || rect.height < 60) return
    const dpr = window.devicePixelRatio || 1
    const reserve = timelineReserveH(rect.height)
    fetch('/api/dsh-browser/view-bounds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        x: Math.round((window.screenX + rect.left) * dpr),
        y: Math.round((window.screenY + rect.top) * dpr),
        w: Math.round(rect.width * dpr),
        h: Math.round((rect.height - reserve) * dpr),
        dpr,
      }),
    })
      .then((r) => r.json())
      .then((data: any) => {
        // 贴合成功：原生视图/窗口接管画面，服务端已停 screencast，客户端也停止拉帧。
        if (data && data.ok === true && data.hidden === false) attachedRef.current = true
      })
      .catch(() => {})
  }, [sessionId, timelineReserveH])

  // 窗口收回屏幕外。
  const hideView = useCallback((): void => {
    fetch('/api/dsh-browser/view-bounds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {})
  }, [sessionId])

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // 抽屉打开：先开帧流（滑入动画过渡画面），贴合真实窗口后即停（服务端 +
  // 客户端两侧都停），卸载时兜底再关一次——没人看时绝不推帧/编码。
  useEffect(() => {
    attachedRef.current = false
    fetch('/api/dsh-browser/screencast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, on: true }),
    }).catch(() => {})
    return () => {
      fetch('/api/dsh-browser/screencast', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, on: false }),
      }).catch(() => {})
    }
  }, [sessionId])

  // 滑入动画结束后贴合真实窗口；期间/失败时 img 帧流兜底可见。
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(syncViewBounds, CLOSE_ANIM_MS + 60)
    // 抽屉展开期间窗口尺寸变化：重新贴合（防抖）。
    let rt = 0
    const onResize = (): void => {
      window.clearTimeout(rt)
      rt = window.setTimeout(syncViewBounds, 200)
      // 视口变窄时把抽屉宽度收进合法区间。
      setWidth((w) => Math.min(w, Math.max(MIN_WIDTH, window.innerWidth - EDGE_GAP)))
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(rt)
      window.removeEventListener('resize', onResize)
    }
  }, [open, syncViewBounds])

  // 布局变化（时间线展开/收起、书签栏显隐、宽度拖完）都要重新贴合原生视图，
  // 否则画面区与视图错位（旧版只在时间线切换时重贴）。
  useEffect(() => {
    if (!open) return
    syncViewBounds()
  }, [timelineOpen, bookmarksOn, open, syncViewBounds])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    hideView()
    setOpen(false)
    window.setTimeout(onClose, CLOSE_ANIM_MS)
  }, [onClose, hideView])

  // ── 宽度拖拽：左缘把手，指针事件全程捕获，松手写入 localStorage ──
  const startResize = useCallback((e: React.PointerEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const max = Math.max(MIN_WIDTH, window.innerWidth - EDGE_GAP)
    setResizing(true)
    const onMove = (ev: PointerEvent): void => {
      // 把手在左缘：向左拖动（clientX 变小）= 变宽
      const next = Math.min(max, Math.max(MIN_WIDTH, startW + (startX - ev.clientX)))
      setWidth(next)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setResizing(false)
      // 拖动期间原生视图不跟随（避免每帧一次 IPC）；松手后一次性重贴。
      syncViewBounds()
      setWidth((w) => {
        try { window.localStorage.setItem(WIDTH_KEY, String(Math.round(w))) } catch { /* 忽略 */ }
        return w
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [width, syncViewBounds])

  // 书签数据：抽屉打开时拉一次，增删后由响应回填。
  const refreshSites = useCallback((): void => {
    fetch('/api/dsh-browser/sites', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: any) => { if (d?.ok && Array.isArray(d.sites)) setSites(d.sites) })
      .catch(() => {})
  }, [])

  useEffect(() => { refreshSites() }, [refreshSites])

  const mutateSites = useCallback((payload: Record<string, unknown>): void => {
    fetch('/api/dsh-browser/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((d: any) => { if (d?.ok && Array.isArray(d.sites)) setSites(d.sites) })
      .catch(() => {})
  }, [])

  // 轮询操作详情（时间线 + url/title + 标签列表 + 历史可用性）。
  const refreshDetail = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/dsh-browser/session?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      const data: SessionDetail = await res.json()
      setDetail(data)
    } catch { /* 保持上次 */ }
  }, [sessionId])

  useEffect(() => {
    void refreshDetail()
    // 后台标签页不轮询（抽屉画面不可见时没人看时间线）；回到前台立即补一次。
    const tick = (): void => { if (!document.hidden) void refreshDetail() }
    const timer = window.setInterval(tick, 800)
    const onVisible = (): void => { if (!document.hidden) void refreshDetail() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshDetail])

  // 标签动作后除刷新列表外还须重新贴合原生视图：壳子 create-tab 只建视图不挂载，
  // switch/close 也只改服务端 activeTabId——不重挂的话画面区仍是旧标签。
  const afterTabAction = useCallback((): void => {
    void refreshDetail()
    syncViewBounds()
  }, [refreshDetail, syncViewBounds])

  const postTab = useCallback((payload: Record<string, unknown>): void => {
    fetch('/api/dsh-browser/tabs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ...payload }),
    })
      .then(() => { afterTabAction() })
      .catch(() => {})
  }, [sessionId, afterTabAction])

  // 导航控制（后退/前进/刷新）：忙态点亮地址栏进度轨，完成后刷新详情。
  const control = useCallback((action: 'back' | 'forward' | 'reload'): void => {
    setNavBusy(true)
    fetch('/api/dsh-browser/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, action }),
    })
      .catch(() => {})
      .finally(() => {
        setNavBusy(false)
        void refreshDetail()
      })
  }, [sessionId, refreshDetail])

  // 地址栏回车：在当前标签导航（不新开标签）。
  const navigateTo = useCallback((next: string): void => {
    setNavBusy(true)
    fetch('/api/dsh-browser/navigate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, url: next }),
    })
      .catch(() => {})
      .finally(() => {
        setNavBusy(false)
        void refreshDetail()
      })
  }, [sessionId, refreshDetail])

  const copyUrl = useCallback((): void => {
    if (currentUrl === '') return
    navigator.clipboard.writeText(currentUrl)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => { setCopied(false) }, 1500)
      })
      .catch(() => {})
  }, [currentUrl])

  // 收藏/取消收藏当前页（按 host 判定是否已在书签里）。
  const curHost = hostOf(currentUrl)
  const bookmarked = useMemo(
    () => curHost !== '' && sites.some((s) => hostOf(s.url) === curHost),
    [sites, curHost],
  )
  const toggleBookmark = useCallback((): void => {
    if (currentUrl === '') return
    const hit = sites.find((s) => hostOf(s.url) === curHost)
    if (hit !== undefined) {
      mutateSites({ action: 'remove', id: hit.id })
      return
    }
    const title = activeTab?.title !== undefined && activeTab.title !== '' ? activeTab.title : curHost
    mutateSites({ action: 'add', title: title.slice(0, 40), url: currentUrl })
    // 收藏后自动展开书签栏，让用户看到结果落在哪。
    setBookmarksOn(true)
    try { window.localStorage.setItem(BOOKMARKS_KEY, '1') } catch { /* 忽略 */ }
  }, [currentUrl, sites, curHost, activeTab, mutateSites])

  const toggleBookmarksBar = useCallback((): void => {
    setBookmarksOn((v) => {
      const next = !v
      try { window.localStorage.setItem(BOOKMARKS_KEY, next ? '1' : '0') } catch { /* 忽略 */ }
      return next
    })
  }, [])

  // 轮询 screencast 最新帧：带 since 增量拉取，静止时服务端返回 304 空体，
  // 不下载/不解码图片；连续无新帧自动降频，一旦有新帧立即恢复高频。
  // 坐标映射基准（x-frame-width/height）同步维护。
  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    let lastRev = 0
    let intervalMs = 150
    let idleStreak = 0
    let timer = 0

    const restartTimer = (ms: number): void => {
      window.clearInterval(timer)
      timer = window.setInterval(() => { void poll() }, ms)
    }

    const poll = async (): Promise<void> => {
      try {
        // 真实窗口已接管画面 / 后台标签页：不再拉帧（服务端 screencast 也已停）。
        if (attachedRef.current || document.hidden) return
        const res = await fetch(`/api/dsh-browser/frame?sessionId=${encodeURIComponent(sessionId)}&since=${lastRev}`, { cache: 'no-store' })
        if (res.status === 304) {
          idleStreak++
          if (idleStreak >= 3 && intervalMs < 1200) {
            intervalMs = Math.min(1200, intervalMs * 2)
            restartTimer(intervalMs)
          }
          return
        }
        if (!res.ok) { if (alive) setFrameError(true); return }
        idleStreak = 0
        if (intervalMs !== 150) { intervalMs = 150; restartTimer(intervalMs) }
        const rev = Number(res.headers.get('x-frame-rev')) || 0
        const w = Number(res.headers.get('x-frame-width')) || 0
        const h = Number(res.headers.get('x-frame-height')) || 0
        const blob = await res.blob()
        if (!alive) return
        if (w > 0 && h > 0) frameSizeRef.current = { width: w, height: h }
        if (rev > 0) lastRev = rev
        const url = URL.createObjectURL(blob)
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = url
        setFrameUrl(url)
        setFrameError(false)
      } catch { /* 保持上次 */ }
    }

    void poll()
    timer = window.setInterval(() => { void poll() }, intervalMs)
    return () => {
      alive = false
      window.clearInterval(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sessionId])

  // 抽屉内坐标 → 远程视口坐标（按 img 实际显示尺寸线性缩放）。
  const toPage = useCallback((clientX: number, clientY: number) => {
    const el = frameElRef.current ?? frameBoxRef.current
    const size = frameSizeRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const sx = size.width > 0 ? size.width / rect.width : 1
    const sy = size.height > 0 ? size.height / rect.height : 1
    return {
      x: Math.max(0, Math.round((clientX - rect.left) * sx)),
      y: Math.max(0, Math.round((clientY - rect.top) * sy)),
    }
  }, [])

  const sendInput = useCallback((payload: Record<string, unknown>) => {
    fetch('/api/dsh-browser/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ...payload }),
    }).catch(() => {})
  }, [sessionId])

  // 鼠标移动：合并发送（一次在途只保留最新坐标），快速移动时不堆积 POST 请求。
  const movePending = useRef<{ x: number; y: number } | null>(null)
  const moveInFlight = useRef(false)
  const sendMove = useCallback((): void => {
    const next = movePending.current
    if (next === null || moveInFlight.current) return
    moveInFlight.current = true
    fetch('/api/dsh-browser/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, type: 'mouse', event: 'move', x: next.x, y: next.y }),
    })
      .catch(() => {})
      .finally(() => {
        moveInFlight.current = false
        // 在途期间又产生了新坐标：补发最新一次。
        const cur = movePending.current
        if (cur !== null && (cur.x !== next.x || cur.y !== next.y)) sendMove()
      })
  }, [sessionId])

  // 清除 hover 高亮，并使在途的 hover 请求失效（返回后不再落地）。
  const clearHover = useCallback((): void => {
    hoverSeqRef.current++
    hoverPendingRef.current = null
    setHover(null)
  }, [])

  // hover 预览：合并发送（一次在途只保留最新坐标），返回命中元素范围后画框。
  const queryHover = useCallback((): void => {
    if (!pickingRef.current) return
    const next = hoverPendingRef.current
    if (next === null || hoverInFlightRef.current) return
    hoverInFlightRef.current = true
    const seq = ++hoverSeqRef.current
    fetch('/api/dsh-browser/element', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, x: next.x, y: next.y }),
    })
      .then((r) => r.json())
      .then((data: any) => {
        if (seq !== hoverSeqRef.current) return
        const r = data?.rect
        if (data && data.ok === true && data.found === true && r && Number(r.width) > 0) {
          setHover({
            tag: String(data.tag || ''),
            left: Number(r.left) || 0,
            top: Number(r.top) || 0,
            width: Number(r.width) || 0,
            height: Number(r.height) || 0,
          })
        } else {
          setHover(null)
        }
      })
      .catch(() => { if (seq === hoverSeqRef.current) setHover(null) })
      .finally(() => {
        hoverInFlightRef.current = false
        const cur = hoverPendingRef.current
        if (cur !== null && (cur.x !== next.x || cur.y !== next.y)) queryHover()
      })
  }, [sessionId])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (pickingRef.current) {
      // 选取模式：不转发到页面，改为采集 hover 元素范围画高亮框。
      const { x, y } = toPage(e.clientX, e.clientY)
      const last = hoverPendingRef.current
      if (last !== null && last.x === x && last.y === y) return
      hoverPendingRef.current = { x, y }
      queryHover()
      return
    }
    const { x, y } = toPage(e.clientX, e.clientY)
    const last = movePending.current
    if (last !== null && last.x === x && last.y === y) return
    movePending.current = { x, y }
    sendMove()
  }, [toPage, sendMove, queryHover])

  const buttonOf = (b: number): string => (b === 2 ? 'right' : b === 1 ? 'middle' : 'left')

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (pickingRef.current) return
    const { x, y } = toPage(e.clientX, e.clientY)
    sendInput({ type: 'mouse', event: 'down', x, y, button: buttonOf(e.button) })
  }, [toPage, sendInput])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (pickingRef.current) return
    const { x, y } = toPage(e.clientX, e.clientY)
    sendInput({ type: 'mouse', event: 'up', x, y, button: buttonOf(e.button) })
  }, [toPage, sendInput])

  const onClick = useCallback((e: React.MouseEvent) => {
    if (pickingRef.current) return
    const { x, y } = toPage(e.clientX, e.clientY)
    sendInput({ type: 'mouse', event: 'click', x, y })
  }, [toPage, sendInput])

  // 进入选取模式：隐藏原生视图（detach），让画面回到 img 帧流——这样点击才
  // 落在 React 的 img 上而不是被原生视图吃掉；detach 完成后恢复帧轮询刷新画面。
  const enterPickMode = useCallback((): void => {
    setPickingBoth(true)
    clearHover()
    fetch('/api/dsh-browser/view-bounds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, keepViewport: true }),
    })
      .then(() => { attachedRef.current = false })
      .catch(() => {})
  }, [sessionId, setPickingBoth, clearHover])

  // 退出选取模式（未采集）：重新贴合原生视图，恢复原生渲染/输入。
  const exitPickMode = useCallback((): void => {
    setPickingBoth(false)
    clearHover()
    syncViewBounds()
  }, [setPickingBoth, clearHover, syncViewBounds])

  // 选取模式下点击画面：坐标换算到页面视口 → CDP 采集元素 → 回填对话框。
  const pickAt = useCallback(async (clientX: number, clientY: number): Promise<void> => {
    const { x, y } = toPage(clientX, clientY)
    setPickingBoth(false)
    clearHover()
    try {
      const res = await fetch('/api/dsh-browser/element', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, x, y }),
      })
      const data: any = await res.json()
      if (data && data.ok === true && data.found === true && typeof data.selector === 'string' && data.selector !== '') {
        onPickElement(data as PickedElement)
        // 采集成功：回填后收起抽屉，让用户立即看到输入框里的定位信息。
        requestClose()
      } else {
        // 该坐标无元素（空白处）：退出选取模式，恢复原生视图。
        syncViewBounds()
      }
    } catch {
      syncViewBounds()
    }
  }, [toPage, sessionId, setPickingBoth, clearHover, onPickElement, requestClose, syncViewBounds])

  // Esc 关闭；选取模式/更多菜单打开时 Esc 只关它们、不关抽屉。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (pickingRef.current) { exitPickMode(); return }
      if (menuOpen) { setMenuOpen(false); return }
      requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exitPickMode, requestClose, menuOpen])

  // 滚轮：原生 passive:false 才能 preventDefault（阻止滚动 DSH 面板），并回传远程浏览器。
  useEffect(() => {
    const box = frameBoxRef.current
    if (!box) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (pickingRef.current) return
      const { x, y } = toPage(e.clientX, e.clientY)
      sendInput({ type: 'wheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY })
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => { box.removeEventListener('wheel', onWheel) }
  }, [toPage, sendInput])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (pickingRef.current) return
    const modifiers: string[] = []
    if (e.ctrlKey || e.metaKey) modifiers.push(e.ctrlKey ? 'ctrl' : 'meta')
    if (e.shiftKey) modifiers.push('shift')
    if (e.altKey) modifiers.push('alt')
    const isShortcut = e.ctrlKey || e.metaKey || e.altKey
    if (e.key === 'Tab' || isShortcut || e.key.length > 1) {
      e.preventDefault()
      sendInput({ type: 'key', key: e.key, modifiers })
    } else if (e.key.length === 1) {
      e.preventDefault()
      sendInput({ type: 'text', text: e.key })
    }
  }, [sendInput])

  // hover 高亮框：把页面视口坐标范围换算成 img 显示坐标（相对 frame 容器），
  // 在 hover/画面尺寸变化时重算。
  const pickBoxStyle = useMemo(() => {
    if (!hover) return null
    const img = frameElRef.current
    const box = frameBoxRef.current
    const size = frameSizeRef.current
    if (!img || !box || size.width <= 0 || size.height <= 0) return null
    const imgRect = img.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    const sx = imgRect.width / size.width
    const sy = imgRect.height / size.height
    return {
      left: (imgRect.left - boxRect.left) + hover.left * sx,
      top: (imgRect.top - boxRect.top) + hover.top * sy,
      width: hover.width * sx,
      height: hover.height * sy,
    }
  }, [hover, frameUrl])

  const tabs = detail?.tabs ?? []
  const menuItems = [
    {
      key: 'bookmarks',
      label: bookmarksOn ? '隐藏书签栏' : '显示书签栏',
      onSelect: toggleBookmarksBar,
    },
    { key: 'copy', label: '复制当前网址', disabled: currentUrl === '', onSelect: copyUrl },
    { key: 'sep1', label: '', onSelect: () => {} },
    {
      key: 'closeOthers',
      label: '关闭其他标签页',
      hint: tabs.length > 1 ? String(tabs.length - 1) : undefined,
      disabled: tabs.length < 2,
      onSelect: () => {
        for (const t of tabs) if (!t.active) postTab({ action: 'close', tabId: t.tabId })
      },
    },
    {
      key: 'stop',
      label: '关闭浏览器（释放内存）',
      onSelect: () => {
        fetch('/api/dsh-browser/tabs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, action: 'close', tabId: detail?.activeTabId ?? '' }),
        }).catch(() => {})
        requestClose()
      },
    },
  ]

  return createPortal(
    <>
      {/* 左侧留白点击区：覆盖整屏但被抽屉盖住右侧，实际可点的就是左边那条空隙 */}
      <div
        className={open ? 'dsh-browser-scrim dsh-browser-scrim--on' : 'dsh-browser-scrim'}
        onClick={requestClose}
        aria-hidden
      />
      <div
        className={[
          'dsh-browser-drawer',
          open ? 'dsh-browser-drawer--open' : '',
          resizing ? 'dsh-browser-drawer--resizing' : '',
        ].filter(Boolean).join(' ')}
        style={{ ['--dshb-width' as any]: `${width}px` }}
        role="dialog"
        aria-label="AI 浏览器"
      >
        {/* 左缘拖拽把手：调节抽屉宽度（持久化） */}
        <div
          className="dsh-browser-grip"
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调节浏览器宽度"
        />

        {/* ── ① 标签页栏 ── */}
        <div className="dsh-browser-tabstrip">
          <span className="dsh-browser-brand">
            <GlobeIcon size={14} />
            <span className={running ? 'dsh-browser-brand__dot dsh-browser-brand__dot--run' : 'dsh-browser-brand__dot'} aria-hidden />
          </span>
          <TabsBar
            tabs={tabs}
            onSwitch={(tabId) => { postTab({ action: 'switch', tabId }) }}
            onClose={(tabId) => { postTab({ action: 'close', tabId }) }}
          />
          <IconButton label="新建标签页" onClick={() => { postTab({ action: 'new' }) }}>
            <PlusIcon size={16} />
          </IconButton>
          <IconButton label="关闭浏览器面板（Esc）" onClick={requestClose}>
            <CloseIcon size={16} />
          </IconButton>
        </div>

        {/* ── ② 工具栏：导航 + 地址栏 + 动作 ── */}
        <div className="dsh-browser-toolbar">
          <div className="dsh-browser-toolbar__nav">
            <IconButton label="后退" disabled={detail?.canBack !== true} onClick={() => { control('back') }}>
              <BackIcon size={16} />
            </IconButton>
            <IconButton label="前进" disabled={detail?.canForward !== true} onClick={() => { control('forward') }}>
              <ForwardIcon size={16} />
            </IconButton>
            <IconButton label="刷新" onClick={() => { control('reload') }}>
              <ReloadIcon size={16} />
            </IconButton>
          </div>
          <OmniBox url={currentUrl} loading={navBusy} onNavigate={navigateTo} />
          <span className="dsh-browser-toolbar__sep" aria-hidden />
          <div className="dsh-browser-toolbar__actions">
            <IconButton
              label={copied ? '已复制网址' : '复制网址'}
              active={copied}
              disabled={currentUrl === ''}
              onClick={copyUrl}
            >
              {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            </IconButton>
            <IconButton
              label={bookmarked ? '取消收藏' : '收藏当前页'}
              active={bookmarked}
              disabled={currentUrl === ''}
              onClick={toggleBookmark}
            >
              <StarIcon size={16} filled={bookmarked} />
            </IconButton>
            <IconButton
              label={picking ? '退出选取模式（Esc）' : '选取元素：点击画面元素，把定位信息填入对话框'}
              active={picking}
              onClick={() => { picking ? exitPickMode() : enterPickMode() }}
            >
              <PickIcon size={16} />
            </IconButton>
            <MoreMenu open={menuOpen} onOpenChange={setMenuOpen} items={menuItems} />
          </div>
        </div>

        {/* ── ③ 书签栏（可在「更多」里隐藏）── */}
        {bookmarksOn && (
          <BookmarksBar
            sites={sites}
            sessionId={sessionId}
            currentUrl={currentUrl}
            onChanged={afterTabAction}
            onMutate={mutateSites}
          />
        )}

        {/* ── 画面区 ── */}
        <div className="dsh-browser-view">
          <div ref={frameBoxRef} className={picking ? 'dsh-browser-stage dsh-browser-stage--picking' : 'dsh-browser-stage'}>
            {frameError
              ? (
                <div className="dsh-browser-blank">
                  <span>浏览器画面不可用</span>
                  <span className="dsh-browser-blank__hint">壳子未启动或视图已关闭，可新建标签页重试</span>
                </div>
              )
              : frameUrl === ''
                ? (
                  <div className="dsh-browser-loading">
                    <LoadingOrbit />
                    <span className="dsh-browser-loading__text">正在加载</span>
                  </div>
                )
                : (
                  <img
                    ref={frameElRef}
                    src={frameUrl}
                    alt={picking ? '选取元素：点击画面中的元素' : '浏览器实时画面（可直接操作）'}
                    tabIndex={0}
                    draggable={false}
                    onError={() => { setFrameError(true) }}
                    onMouseMove={onMouseMove}
                    onMouseDown={onMouseDown}
                    onMouseUp={onMouseUp}
                    onClick={(e) => {
                      if (pickingRef.current) { void pickAt(e.clientX, e.clientY) }
                      else { onClick(e) }
                    }}
                    onKeyDown={onKeyDown}
                  />
                )}
            {picking && pickBoxStyle && hover && (
              <div
                className="dsh-browser-pickbox"
                style={{
                  left: pickBoxStyle.left,
                  top: pickBoxStyle.top,
                  width: pickBoxStyle.width,
                  height: pickBoxStyle.height,
                }}
              >
                {hover.tag !== '' && (
                  <span className="dsh-browser-pickbox__tag">{`<${hover.tag}>`}</span>
                )}
              </div>
            )}
            {picking && (
              <div className="dsh-browser-pickhint">
                <PickIcon size={13} />
                点击要选取的元素 · Esc 退出
              </div>
            )}
          </div>
        </div>

        {/* ── 操作时间线：底部悬浮细轨 + 点击展开完整列表；原生视图高度让位 ── */}
        <div className="dsh-browser-track">
          <button
            type="button"
            className="dsh-browser-track__bar"
            onClick={() => { setTimelineOpen((v) => !v) }}
            aria-expanded={timelineOpen}
          >
            <span className={`dsh-browser-step__dot${running ? ' dsh-browser-step__dot--run' : ''}`} aria-hidden />
            <span className="dsh-browser-track__latest">
              {steps[0] ? steps[0].label : '等待 AI 操作…'}
            </span>
            {steps.length > 0 && <span className="dsh-browser-track__count">{steps.length}</span>}
            <span className="dsh-browser-track__toggle" aria-hidden>
              {timelineOpen ? <ChevronDownIcon size={14} /> : <ChevronUpIcon size={14} />}
            </span>
          </button>
          {timelineOpen && (
            <div className="dsh-browser-track__list">
              {steps.length === 0
                ? <div className="dsh-browser-track__empty">暂无操作记录</div>
                : steps.map(step => <StepRow key={step.seq} step={step} />)}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

export interface BrowserSeatProps {
  sessionId: SessionId
  /** 输入区 owner share（当前草稿，选取结果追加到其尾部）。 */
  input: { draft: string }
  /** 输入动作面（官方公开写入路径 setDraft，对齐 PromptOptimizeButton）。 */
  inputActions: { setDraft: (text: string) => void }
}

/**
 * 会话内浏览器常驻按钮（conversation.input.left 条目，始终可见）。
 * 悬停按钮时上方滑出「禁止 AI 使用浏览器」权限卡片：「禁止」为会话级开关
 * （/api/dsh-browser/allow?sessionId=…，host 只拦本会话的 browser_* 调用，
 * 不写全局配置）；点击按钮本体仍开合预览抽屉。
 */
export const BrowserSeat = memo(function BrowserSeat({ sessionId, input, inputActions }: BrowserSeatProps) {
  const store = browserActivityStore()
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  useEffect(() => store.subscribe(forceUpdate), [store])
  const info = store.active.get(String(sessionId))
  const engaged = info !== undefined
  const [open, setOpen] = useState(false)

  // ---- 悬停权限卡片：「禁止 AI 使用浏览器」+「提速模式」------------------
  // allow=true 允许（host 默认）；false=本会话禁止（host 拦截本会话 browser_*）；
  // null=加载中。会话级：只影响当前对话，不改全局配置。
  const [allow, setAllow] = useState<boolean | null>(null)
  // speed=true 注入网页操作提速策略（host 默认）；false=不注入；null=加载中。
  const [speed, setSpeed] = useState<boolean | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  const gateHideTimer = useRef<number | null>(null)

  /** 本会话的 allow 接口地址（读写同一端点，带 sessionId 走会话级语义）。 */
  const allowUrl = `/api/dsh-browser/allow?sessionId=${encodeURIComponent(String(sessionId))}`

  const refreshAllow = useCallback((): void => {
    fetch(allowUrl, { cache: 'no-store' })
      .then((r) => r.json())
      .then((r: any) => { if (r && typeof r.allow === 'boolean') setAllow(r.allow as boolean) })
      .catch(() => {})
  }, [allowUrl])

  const refreshSpeed = useCallback((): void => {
    fetch('/api/dsh-browser/speed', { cache: 'no-store' })
      .then((r) => r.json())
      .then((r: any) => { if (r && typeof r.enabled === 'boolean') setSpeed(r.enabled as boolean) })
      .catch(() => {})
  }, [])

  /** hover 进入按钮/卡片：立即显示并取消延迟关闭，同时刷新最新开关状态。 */
  const showGate = useCallback((): void => {
    if (gateHideTimer.current !== null) {
      window.clearTimeout(gateHideTimer.current)
      gateHideTimer.current = null
    }
    setGateOpen(true)
    refreshAllow()
    refreshSpeed()
  }, [refreshAllow, refreshSpeed])

  /** hover 移出：延迟 0.12 秒再收起，给鼠标跨过按钮↔卡片的间隙留时间。 */
  const scheduleGateHide = useCallback((): void => {
    if (gateHideTimer.current !== null) window.clearTimeout(gateHideTimer.current)
    gateHideTimer.current = window.setTimeout(() => {
      gateHideTimer.current = null
      setGateOpen(false)
    }, 120)
  }, [])

  useEffect(() => () => {
    if (gateHideTimer.current !== null) window.clearTimeout(gateHideTimer.current)
  }, [])

  /** 切换「禁止」开关：写回 allow 取反值（仅当前会话生效，不动全局）。 */
  const toggleDeny = useCallback((): void => {
    if (allow === null) return
    const next = !allow
    setAllow(next)
    fetch(allowUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allow: next }),
    }).catch(() => {})
  }, [allow, allowUrl])

  /** 切换「提速模式」：写回 enabled 取反值（host 按开关注入系统提示词策略）。 */
  const toggleSpeed = useCallback((): void => {
    if (speed === null) return
    const next = !speed
    setSpeed(next)
    fetch('/api/dsh-browser/speed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => {})
  }, [speed])

  // 最新草稿：选取结果要追加到「当前」草稿尾部，用 ref 避免回调闭包旧值。
  const draftRef = useRef(input.draft)
  draftRef.current = input.draft

  // 选取结果回填：`[选择器] 元素摘要` 追加到草稿尾部，待用户补充后手动发送。
  const handlePickElement = useCallback((info: PickedElement): void => {
    const line = `[${info.selector}] ${buildSummary(info)}`
    const draft = draftRef.current.trim()
    const next = draft === '' ? line : `${draft}\n${line}`
    inputActions.setDraft(next)
  }, [inputActions])

  const denied = allow === false
  const tip = engaged
    ? `AI 浏览器${info.label !== '' ? `：${info.label}` : '操作中'}${info.detail !== '' ? ` · ${info.detail}` : ''}`
    : denied ? 'AI 浏览器（已禁止 AI 使用）' : 'AI 浏览器'

  const seatButton = (
    <button
      type="button"
      className={engaged
        ? 'dsh-browser-seat dsh-browser-seat--on'
        : denied
          ? 'dsh-browser-seat dsh-browser-seat--denied'
          : 'dsh-browser-seat'}
      aria-label={tip}
      aria-pressed={engaged}
      onClick={() => { setOpen(v => !v) }}
    >
      <GlobeIcon size={14} />
    </button>
  )

  return (
    <>
      {/* 权限卡片展开期间不渲染 Tooltip：避免提示文字叠在卡片上（remount 无状态无感） */}
      <div className="dsh-browser-seat-wrap" onMouseEnter={showGate} onMouseLeave={scheduleGateHide}>
        {gateOpen
          ? seatButton
          : <Tooltip label={tip} side="top" delayMs={500}>{seatButton}</Tooltip>}
        <div
          className={gateOpen ? 'dsh-browser-gate dsh-browser-gate--on' : 'dsh-browser-gate'}
          role="dialog"
          aria-label="AI 浏览器权限"
          aria-hidden={!gateOpen}
        >
          <div className="dsh-browser-gate__head">
            <span className="dsh-browser-gate__title"><GlobeIcon size={14} /> AI 浏览器</span>
            <span className={denied ? 'dsh-browser-gate__state dsh-browser-gate__state--deny' : 'dsh-browser-gate__state'}>
              {denied ? '已禁止' : '已允许'}
            </span>
          </div>
          <div className="dsh-browser-gate__row">
            <div className="dsh-browser-gate__copy">
              <span className="dsh-browser-gate__label">禁止 AI 使用浏览器</span>
              <span className="dsh-browser-gate__desc">开启后 AI 在当前对话调用浏览器工具将被拒绝，其他对话不受影响。</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={denied}
              aria-label="禁止 AI 使用浏览器"
              className="dsh-browser-gate__switch"
              disabled={allow === null}
              onClick={toggleDeny}
            >
              <span className="dsh-browser-gate__knob" />
            </button>
          </div>
          <div className="dsh-browser-gate__row">
            <div className="dsh-browser-gate__copy">
              <span className="dsh-browser-gate__label">提速模式</span>
              <span className="dsh-browser-gate__desc">自动注入网页操作提速策略（批量 evaluate/batch、直达 URL、少截快照），表单类任务从数分钟压到数十秒。下一轮对话生效。</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={speed === true}
              aria-label="浏览器提速模式"
              className="dsh-browser-gate__switch"
              disabled={speed === null || denied}
              onClick={toggleSpeed}
            >
              <span className="dsh-browser-gate__knob" />
            </button>
          </div>
        </div>
      </div>
      {open && <BrowserDrawer sessionId={String(sessionId)} onPickElement={handlePickElement} onClose={() => { setOpen(false) }} />}
    </>
  )
})
