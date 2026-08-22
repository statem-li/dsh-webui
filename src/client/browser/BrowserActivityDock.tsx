/**
 * dsh-browser — 会话内浏览器常驻按钮 + 右侧滑出预览抽屉（client 半身）。
 *
 * 常驻按钮挂在 `conversation.input.left`（输入框工具行，记忆开关旁）：
 * 与记忆开关一样始终可见；当前会话有浏览器活动（engaged）时图标高亮并脉冲，
 * 点击从右侧滑出预览抽屉：实时显示浏览器画面（CDP screencast 帧）+ 操作时间线。
 * 浏览器本体是有头渲染但窗口在屏幕外——抽屉内可直接鼠标/键盘/滚轮操作页面
 * （事件按帧坐标缩放后经 /api/dsh-browser/input 回传到 CDP Input 域）。
 * 抽屉不全宽——左侧留一条空隙，点击空隙区域抽屉从左往右滑出收回。
 */
import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { browserActivityStore } from './activity'

/** 浏览器图标（线条风格：球形网状地球，语义清晰，小尺寸下干净）。 */
function BrowserIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="4.2" ry="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.2 9h17.6M3.2 15h17.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** 抽屉收起动画时长（与 styles 里 transition 保持一致）。 */
const CLOSE_ANIM_MS = 300

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

function siteHostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * 抽屉内的快捷标签栏：点标签 = 在内嵌浏览器里新开一个标签页打开站点
 * （不打断 AI 正在操作的页面；浏览器未启动则自动拉起）；
 * 「＋」展开管理面板：添加/删除快捷站点。
 */
function SitesBar({ sessionId, currentUrl, onChanged }: { sessionId: string; currentUrl: string; onChanged: () => void }) {
  const [sites, setSites] = useState<BookmarkSite[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const curHost = siteHostOf(currentUrl)

  const refresh = useCallback((): void => {
    fetch('/api/dsh-browser/sites', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: any) => {
        if (d?.ok && Array.isArray(d.sites)) setSites(d.sites)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const postSites = useCallback((payload: Record<string, unknown>): void => {
    fetch('/api/dsh-browser/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((d: any) => {
        if (d?.ok && Array.isArray(d.sites)) setSites(d.sites)
      })
      .catch(() => {})
  }, [])

  // 新开标签页打开快捷站点（newTab=true，服务端自动拉起浏览器）
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
    postSites({ action: 'add', title: title.trim(), url: url.trim() })
    setTitle('')
    setUrl('')
  }, [title, url, postSites])

  return (
    <div className="dsh-browser-sites">
      <div className="dsh-browser-sites__row">
        {sites.map((s) => {
          const active = curHost !== '' && siteHostOf(s.url) === curHost
          return (
            <button
              key={s.id}
              type="button"
              className={active ? 'dsh-browser-site dsh-browser-site--active' : 'dsh-browser-site'}
              title={`新开标签页打开 ${s.title} · ${s.url}`}
              onClick={() => { openSite(s.url) }}
            >
              {s.title}
            </button>
          )
        })}
        <button
          type="button"
          className={panelOpen ? 'dsh-browser-sites__add dsh-browser-sites__add--on' : 'dsh-browser-sites__add'}
          onClick={() => { setPanelOpen((v) => !v) }}
          aria-expanded={panelOpen}
          aria-label="管理标签网站"
          title="添加/管理标签网站"
        >
          ＋
        </button>
      </div>
      {panelOpen && (
        <div className="dsh-browser-sites__panel">
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
            <button type="button" className="dsh-browser-sites__save" onClick={addSite}>添加</button>
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
                    onClick={() => { postSites({ action: 'remove', id: s.id }) }}
                    aria-label={`删除 ${s.title}`}
                  >
                    ✕
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

/** 标签页栏：展示在「AI 浏览器」标题右侧，支持切换 / 关闭 / 新建。 */
function TabsBar({ tabs, sessionId, onChanged }: {
  tabs: BrowserTabInfo[]
  sessionId: string
  onChanged: () => void
}) {
  const postTab = useCallback((payload: Record<string, unknown>): void => {
    fetch('/api/dsh-browser/tabs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ...payload }),
    })
      .then(() => { onChanged() })
      .catch(() => {})
  }, [sessionId, onChanged])

  return (
    <div className="dsh-browser-tabs">
      {tabs.map((t) => (
        <div
          key={t.tabId}
          className={t.active ? 'dsh-browser-tab dsh-browser-tab--active' : 'dsh-browser-tab'}
          title={`${t.title}\n${t.url}`}
          onClick={() => { if (!t.active) postTab({ action: 'switch', tabId: t.tabId }) }}
        >
          <span className="dsh-browser-tab__title">{t.title || '(空白)'}</span>
          <button
            type="button"
            className="dsh-browser-tab__close"
            onClick={(e) => {
              e.stopPropagation()
              postTab({ action: 'close', tabId: t.tabId })
            }}
            aria-label={`关闭标签 ${t.title}`}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="dsh-browser-tabs__new"
        onClick={() => { postTab({ action: 'new' }) }}
        aria-label="新建标签页"
        title="新建标签页"
      >
        ＋
      </button>
    </div>
  )
}

/** 网址行：当前激活标签的 URL + 一键复制。 */
function UrlCopyBar({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback((): void => {
    const text = url !== '' ? url : ''
    if (text === '') return
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => { setCopied(false) }, 1500)
      })
      .catch(() => {})
  }, [url])
  return (
    <div className="dsh-browser-urlbar">
      <span className="dsh-browser-urlbar__url" title={url}>
        {url !== '' ? url : 'about:blank'}
      </span>
      <button
        type="button"
        className={copied ? 'dsh-browser-urlbar__copy dsh-browser-urlbar__copy--done' : 'dsh-browser-urlbar__copy'}
        onClick={copy}
        disabled={url === ''}
        aria-label="复制网址"
      >
        {copied ? '已复制 ✓' : '⧉ 复制'}
      </button>
    </div>
  )
}

/**
 * 右侧滑出预览抽屉：左侧留一条空隙（hitzone），点击空隙抽屉向右滑出收回；
 * 打开时从右往左滑入。滑入动画结束后，把屏幕外的 Chrome app 窗口精确贴合到
 * 画面区屏幕坐标——原生渲染 + 原生输入（对齐 openhanako 内置浏览器体验）；
 * 收回时窗口先移回屏幕外。img 帧流保留作为动画过渡与兜底预览。
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
  // 操作时间线：默认收起为底部悬浮细条（一句话），点开才展开完整列表。
  const [timelineOpen, setTimelineOpen] = useState(false)
  // 元素选取模式：开启后隐藏原生视图、画面回到 img 帧流（React 才能收到点击），
  // 点击画面采集元素并回填对话框；pickingRef 供 Esc/贴合防抖等非 JSX 处同步读取。
  const [picking, setPicking] = useState(false)
  const pickingRef = useRef(false)
  const setPickingBoth = useCallback((v: boolean): void => {
    pickingRef.current = v
    setPicking(v)
  }, [])

  /** 时间线占用的画面高度：收起=细条 32px；展开=min(300, 45%)。原生视图需让位。 */
  const timelineReserveH = useCallback((frameH: number): number => {
    return timelineOpen ? Math.min(300, Math.round(frameH * 0.45)) : 32
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
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(rt)
      window.removeEventListener('resize', onResize)
    }
  }, [open, syncViewBounds])

  // 展开/收起操作时间线：原生视图高度随之让位，立即重新贴合。
  useEffect(() => {
    if (!open) return
    syncViewBounds()
  }, [timelineOpen, open, syncViewBounds])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    hideView()
    setOpen(false)
    window.setTimeout(onClose, CLOSE_ANIM_MS)
  }, [onClose, hideView])

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

  // 进入选取模式：隐藏原生视图（detach），让画面回到 img 帧流——这样点击才
  // 落在 React 的 img 上而不是被原生视图吃掉；detach 完成后恢复帧轮询刷新画面。
  const enterPickMode = useCallback((): void => {
    setPickingBoth(true)
    fetch('/api/dsh-browser/view-bounds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
      .then(() => { attachedRef.current = false })
      .catch(() => {})
  }, [sessionId, setPickingBoth])

  // 退出选取模式（未采集）：重新贴合原生视图，恢复原生渲染/输入。
  const exitPickMode = useCallback((): void => {
    setPickingBoth(false)
    syncViewBounds()
  }, [setPickingBoth, syncViewBounds])

  // 选取模式下点击画面：坐标换算到页面视口 → CDP 采集元素 → 回填对话框。
  const pickAt = useCallback(async (clientX: number, clientY: number): Promise<void> => {
    const { x, y } = toPage(clientX, clientY)
    setPickingBoth(false)
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
  }, [toPage, sessionId, setPickingBoth, onPickElement, requestClose, syncViewBounds])

  // Esc 关闭；选取模式下 Esc 只退出选取模式、不关抽屉。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (pickingRef.current) exitPickMode()
        else requestClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exitPickMode, requestClose])

  // 轮询操作详情（时间线 + url/title + 标签列表）；tab 操作后可手动触发。
  const refreshDetail = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/dsh-browser/session?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      const data: SessionDetail = await res.json()
      setDetail(data)
    } catch { /* 保持上次 */ }
  }, [sessionId])

  useEffect(() => {
    void refreshDetail()
    const timer = window.setInterval(() => { void refreshDetail() }, 800)
    return () => { window.clearInterval(timer) }
  }, [refreshDetail])

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
        // 真实窗口已接管画面：不再拉帧（服务端 screencast 也已停）。
        if (attachedRef.current) return
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

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (pickingRef.current) return
    const { x, y } = toPage(e.clientX, e.clientY)
    const last = movePending.current
    if (last !== null && last.x === x && last.y === y) return
    movePending.current = { x, y }
    sendMove()
  }, [toPage, sendMove])

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

  // 键盘：可打印字符走 insertText；特殊键/组合键走 dispatchKey；跳过 IME 组合态。
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

  const steps = (detail?.steps ?? []).slice().reverse()
  const running = detail?.active === true || steps.some(s => s.status === 'running')

  return createPortal(
    <>
      {/* 左侧留白点击区：覆盖整屏但被抽屉盖住右侧，实际可点的就是左边那条空隙 */}
      <div
        className={open ? 'dsh-browser-drawer__hitzone dsh-browser-drawer__hitzone--on' : 'dsh-browser-drawer__hitzone'}
        onClick={requestClose}
        aria-hidden
      />
      <div
        className={open ? 'dsh-browser-drawer dsh-browser-drawer--open' : 'dsh-browser-drawer'}
        role="dialog"
        aria-label="AI 浏览器"
      >
        <header className="dsh-browser-drawer__head">
          <span className="dsh-browser-drawer__title">
            <BrowserIcon size={16} /> AI 浏览器{running ? ' · 操作中' : ''}
          </span>
          <TabsBar tabs={detail?.tabs ?? []} sessionId={sessionId} onChanged={() => { void refreshDetail() }} />
          <button
            type="button"
            className={picking ? 'dsh-browser-drawer__pick dsh-browser-drawer__pick--on' : 'dsh-browser-drawer__pick'}
            onClick={() => { picking ? exitPickMode() : enterPickMode() }}
            aria-pressed={picking}
            aria-label="选取元素"
            title={picking ? '退出选取模式（或按 Esc）' : '选取元素：点击画面中的元素，把定位信息填入对话框'}
          >
            {picking ? '退出选取' : '选取元素'}
          </button>
          <button type="button" className="dsh-browser-drawer__close" onClick={requestClose} aria-label="关闭">✕</button>
        </header>
        <div className="dsh-browser-drawer__urlrow">
          <SitesBar sessionId={sessionId} currentUrl={detail?.url ?? ''} onChanged={() => { void refreshDetail() }} />
          <UrlCopyBar url={detail?.tabs?.find((t) => t.active)?.url ?? detail?.url ?? ''} />
        </div>
        <div className="dsh-browser-drawer__body">
          <div ref={frameBoxRef} className={picking ? 'dsh-browser-drawer__frame dsh-browser-drawer__frame--picking' : 'dsh-browser-drawer__frame'}>
            {frameError
              ? <span className="dsh-browser-drawer__empty">浏览器画面不可用</span>
              : frameUrl === ''
                ? <span className="dsh-browser-drawer__empty">画面连接中…</span>
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
            {picking && (
              <div className="dsh-browser-drawer__pickhint">点击要选取的元素 · Esc 退出</div>
            )}
          </div>
        </div>
        {/* 操作时间线：底部悬浮条（一句话）+ 点击展开完整列表；原生视图高度让位 */}
        <div className={timelineOpen ? 'dsh-browser-drawer__timeline dsh-browser-drawer__timeline--expanded' : 'dsh-browser-drawer__timeline'}>
          <button type="button" className="dsh-browser-drawer__tl-bar" onClick={() => { setTimelineOpen((v) => !v) }}>
            <span className={`dsh-browser-step__dot${running ? ' dsh-browser-step__dot--run' : ''}`} aria-hidden />
            <span className="dsh-browser-drawer__tl-latest">
              {steps[0] ? steps[0].label : '等待 AI 操作…'}
            </span>
            <span className="dsh-browser-drawer__tl-toggle">{timelineOpen ? '收起 ▾' : `操作记录${steps.length > 0 ? ` ${steps.length}` : ''} ▴`}</span>
          </button>
          {timelineOpen && (
            <div className="dsh-browser-drawer__tl-list">
              {steps.length === 0
                ? <div className="dsh-browser-drawer__empty">暂无操作记录</div>
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

/** 会话内浏览器常驻按钮（conversation.input.left 条目，始终可见）。 */
export const BrowserSeat = memo(function BrowserSeat({ sessionId, input, inputActions }: BrowserSeatProps) {
  const store = browserActivityStore()
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  useEffect(() => store.subscribe(forceUpdate), [store])
  const info = store.active.get(String(sessionId))
  const engaged = info !== undefined
  const [open, setOpen] = useState(false)

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

  const tip = engaged
    ? `AI 浏览器${info.label !== '' ? `：${info.label}` : '操作中'}${info.detail !== '' ? ` · ${info.detail}` : ''}`
    : 'AI 浏览器'

  return (
    <>
      <Tooltip label={tip} side="top" delayMs={500}>
        <button
          type="button"
          className={engaged ? 'dsh-browser-seat dsh-browser-seat--on' : 'dsh-browser-seat'}
          aria-label={tip}
          aria-pressed={engaged}
          onClick={() => { setOpen(v => !v) }}
        >
          <BrowserIcon size={14} />
        </button>
      </Tooltip>
      {open && <BrowserDrawer sessionId={String(sessionId)} onPickElement={handlePickElement} onClose={() => { setOpen(false) }} />}
    </>
  )
})
