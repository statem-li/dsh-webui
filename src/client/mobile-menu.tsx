/**
 * mobile-menu — 移动端「菜单按钮 + 工作区抽屉」（P1-App-5 重构，替代 app-tabbar）。
 *
 * 用户原话三件套：① 对话框（底部输入）② 对话流（消息列表全屏）③ 左上角菜单按钮，
 * 点击从左侧滑出「覆盖对话的工作区抽屉」（会话列表 + 新建 + 次要入口）。
 * 本组件只承担第③件：左上角菜单钮 + 左侧滑出抽屉；①对话框 / ②对话流是宿主内容区，
 * 由既有 mobile-minimal / responsive 等窄屏适配承担，不在本文件触碰。
 *
 * 设计要点：
 *  - 组件无参数：用 `useIsMobile()` 判端，桌面直接 return null（零渲染、零样式注入）。
 *  - 运行时会话 / 工作区服务经 `setMobileMenuServices(sessions, workspaces)` 注入
 *    （与 session-pin/context-menu.tsx 的模块级 setter 同款先例），由 index.ts 在
 *    apply() 时调用；未注入时会话列表降级为「会话列表暂不可用」（绝不以猜测代码蒙混）。
 *  - 会话列表仅在抽屉打开时读取 `sessions.list` 快照 + 订阅（红线 B：无常驻 observer、
 *    无轮询）；关闭即退订并清空。列表项取 displayTitle（截断 1 行），当前会话主题色左边条。
 *  - 新建会话走 `IWorkspaces.startSession()`（公开契约的新会话流程）；切换走
 *    `ISessions.open(id)`；次要入口（设置/用量/团队/记忆）用已实证 selector 模拟原生
 *    click（app-tabbar 同一组契约）。
 *  - 全部 fixed 全屏元素用 createPortal 挂到 document.body（记忆红线：祖先带
 *    backdrop-filter / transform 时 fixed 会被钉进局部坐标系，必须挂 body）。
 *
 * 红线 A：以下注入式 CSS（SHEET）注释内未写出「星号紧跟正斜杠」两字符序列
 *         （该风险仅用文字描述，字符序列本身不出现）。
 * 红线 B：无轮询 / 无常驻 observer；会话列表仅在抽屉打开期间 subscribe，关闭即退订。
 * 红线 C：全部影响宿主的选择器与动效规则包在 @media (max-width: 767.98px) 或
 *         (prefers-reduced-motion: reduce) 内；桌面零渲染、零样式注入。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ISessions, IWorkspaces, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { useIsMobile } from './responsive'

const STYLE_ID = 'dsh-webui-mobile-menu-styles'

// ── 运行时会话 / 工作区服务（apply 时注入；未提供时相关动作降级为无操作）──────
let sessions: ISessions | undefined
let workspaces: IWorkspaces | undefined

/** 由 index.ts（apply 时）注入运行时会话 / 工作区服务。 */
export function setMobileMenuServices(s: ISessions | undefined, w: IWorkspaces | undefined): void {
  sessions = s
  workspaces = w
}

/** 次要入口组：label → 触发目标 selector（与 app-tabbar 同一组已实证契约）。 */
const ENTRIES: ReadonlyArray<{ id: string; label: string; icon: string; selector: string }> = [
  { id: 'settings', label: '设置', icon: '⚙️', selector: '[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]' },
  { id: 'usage', label: '用量', icon: '📊', selector: '[data-nav-slot="usage"] .dsh-nav-btn' },
  { id: 'team', label: '团队', icon: '👥', selector: '[data-nav-slot="team"] .dsh-nav-btn' },
  { id: 'memory', label: '记忆', icon: '🧠', selector: '[data-nav-slot="memory"] .dsh-nav-btn' },
]

/** 会话列表项（源：sessions.list 快照投影）。 */
interface SessionItem {
  id: SessionId
  title: string
  current: boolean
}

/** 从会话列表快照投影出抽屉列表：隐藏 blank（无内容占位行），取 displayTitle。 */
function readSessionItems(): SessionItem[] {
  if (sessions === undefined) return []
  const snap = sessions.list.getSnapshot()
  const current = snap.current
  const items: SessionItem[] = []
  for (const id of snap.ids) {
    const summary = snap.byId[id]
    if (summary === undefined || summary.blank === true) continue
    items.push({
      id,
      title: summary.displayTitle.trim() !== '' ? summary.displayTitle : '新会话',
      current: id === current,
    })
  }
  return items
}

/** 幂等注入一段样式（与 app-tabbar / mobile-app-shell 同套思路）；返回移除函数。 */
function ensureStyle(): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/mobile-menu'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

/** 容器 + 抽屉 + 遮罩 + 列表 + 入口组样式。全部包媒体内；动效降级单独包 prefers-reduced-motion。 */
const SHEET = `
@media (max-width: 767.98px) {
  /* ── 左上角菜单按钮：44×44 毛玻璃浮钮，点击开/关抽屉，图标旋转 90° 微动效 ── */
  .webui-m-menu-btn {
    position: fixed;
    left: calc(var(--webui-safe-left, 0px) + 10px);
    top: calc(var(--webui-safe-top, 0px) + 8px);
    z-index: 280;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--dsw-alias-bg-module-platform, #0e1116) 82%, transparent);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
    color: var(--dsw-alias-label-primary, #1f2328);
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,.18);
    transition: background-color 160ms ease, box-shadow 220ms ease, transform 160ms ease;
  }
  .webui-m-menu-btn svg {
    transition: transform 220ms cubic-bezier(.2, .8, .2, 1);
  }
  .webui-m-menu-btn.open {
    background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 28%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 45%, transparent);
  }
  .webui-m-menu-btn.open svg {
    transform: rotate(90deg);
  }
  .webui-m-menu-btn:active {
    transform: scale(.94);
  }

  /* ── 遮罩：全屏半透明 fade；open 时可点击关抽屉 ── */
  .webui-m-mask {
    position: fixed;
    inset: 0;
    z-index: 1090;
    background: rgba(0, 0, 0, .45);
    opacity: 0;
    pointer-events: none;
    transition: opacity 220ms ease;
  }
  .webui-m-mask.open {
    opacity: 1;
    pointer-events: auto;
  }

  /* ── 抽屉打开时压低「对话完成胶囊」：DonePill 挂在 shell.overlay 槽 z-index
       9400，会穿透抽屉(1100)浮在其上。AppMenu 在 open 时给 body 打
       data-webui-mobile-menu-open 标记，这里用 !important 压到抽屉之下，
       由遮罩压暗（胶囊 pointer 事件也被遮罩挡住，不会误点）。 ── */
  body[data-webui-mobile-menu-open] .dsh-done-pill {
    z-index: 100 !important;
  }

  /* ── 抽屉：覆盖对话的工作区，左侧滑入 ── */
  .webui-m-drawer {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: min(320px, 84vw);
    z-index: 1100;
    transform: translateX(-100%);
    transition: transform 280ms cubic-bezier(.2, .8, .2, 1);
    background: color-mix(in srgb, var(--dsw-alias-bg-module-platform, #0e1116) 86%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-right: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: calc(var(--webui-safe-top, 0px) + 12px) 14px calc(var(--webui-safe-bottom, 0px) + 12px);
  }
  .webui-m-drawer.open {
    transform: translateX(0);
  }

  /* ── 抽屉头部：标题 + 关闭 ── */
  .webui-m-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .webui-m-drawer-title {
    font-size: 17px;
    font-weight: 600;
    color: var(--dsw-alias-label-primary, #1f2328);
    line-height: 24px;
  }
  .webui-m-drawer-close {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--dsw-alias-label-tertiary, #999);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  .webui-m-drawer-close:active {
    background: rgba(255,255,255,.08);
  }

  /* ── 新建会话主按钮 ── */
  .webui-m-new {
    width: 100%;
    min-height: 46px;
    border-radius: 12px;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 88%, #000);
    cursor: pointer;
    transition: transform 140ms ease, filter 140ms ease;
  }
  .webui-m-new:active {
    transform: scale(.97);
    filter: brightness(.94);
  }

  /* ── 会话列表滚动区：overscroll 限制在自身滚动上下文内 ── */
  .webui-m-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    margin-top: 14px;
    -webkit-overflow-scrolling: touch;
  }
  .webui-m-item {
    position: relative;
    width: 100%;
    min-height: 44px;
    border: none;
    background: none;
    text-align: left;
    padding: 10px 12px 10px 16px;
    border-radius: 10px;
    color: var(--dsw-alias-label-secondary, #61666b);
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    transition: background-color 140ms ease;
    box-sizing: border-box;
  }
  .webui-m-item:active {
    background: rgba(255,255,255,.06);
  }
  /* 当前会话：主题色左边条。 */
  .webui-m-item.current {
    background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 16%, transparent);
    color: var(--dsw-alias-label-primary, #1f2328);
  }
  .webui-m-item.current::before {
    content: "";
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 3px;
    border-radius: 2px;
    background: var(--dsw-alias-state-business-primary, #4176e6);
  }
  .webui-m-item-title {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .webui-m-empty {
    padding: 20px 12px;
    text-align: center;
    color: var(--dsw-alias-label-tertiary, #999);
    font-size: 13px;
  }

  /* ── 次要入口组：一行小按钮横排 ── */
  .webui-m-entries {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .webui-m-entry {
    flex: 1 1 auto;
    min-width: 64px;
    min-height: 42px;
    border-radius: 10px;
    border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
    background: color-mix(in srgb, var(--dsw-alias-bg-module-platform, #0e1116) 60%, transparent);
    color: var(--dsw-alias-label-secondary, #61666b);
    font-size: 12px;
    font-family: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
    transition: transform 140ms ease, background-color 140ms ease;
  }
  .webui-m-entry:active {
    transform: scale(.96);
    background: rgba(255,255,255,.08);
  }
}

/* 动效降级：偏好减少动态时全部过渡/变换直接到终态。 */
@media (prefers-reduced-motion: reduce) {
  .webui-m-menu-btn,
  .webui-m-menu-btn svg,
  .webui-m-mask,
  .webui-m-drawer,
  .webui-m-new,
  .webui-m-entry {
    transition: none !important;
  }
  .webui-m-menu-btn.open svg { transform: none; }
  .webui-m-menu-btn:active { transform: none; }
  .webui-m-new:active { transform: none; }
  .webui-m-entry:active { transform: none; }
}
`

/**
 * 移动端「菜单按钮 + 工作区抽屉」。桌面 return null（零渲染、零样式注入）。
 * 会话列表仅在抽屉打开期间订阅 sessions.list（红线 B：无常驻 observer / 轮询）。
 */
export function AppMenu(): JSX.Element | null {
  const mobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SessionItem[]>([])

  // 样式随移动端状态注入/清理；桌面不注入任何样式（红线 C）。
  useEffect(() => {
    if (!mobile) return undefined
    return ensureStyle()
  }, [mobile])

  // 会话列表仅在抽屉打开期间读取 + 订阅（红线 B）；关闭即退订并清空。
  useEffect(() => {
    if (!open) {
      setItems([])
      return undefined
    }
    const read = (): void => { setItems(readSessionItems()) }
    read()
    if (sessions === undefined) return undefined
    const unsub = sessions.list.subscribe(read)
    return () => { unsub() }
  }, [open])

  // Esc 关闭抽屉。
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open])

  // body 标脏：抽屉打开时压低 DonePill（z-index 见 SHEET），关闭/离场清除。
  useEffect(() => {
    if (mobile && open) {
      document.body.setAttribute('data-webui-mobile-menu-open', '1')
      return () => { document.body.removeAttribute('data-webui-mobile-menu-open') }
    }
    document.body.removeAttribute('data-webui-mobile-menu-open')
    return undefined
  }, [mobile, open])

  if (!mobile) return null

  const openSession = (id: SessionId): void => {
    try { sessions?.open(id) } catch { /* 未知 id 静默；保持当前选择 */ }
    setOpen(false)
  }

  const newSession = (): void => {
    // 新建会话：继承当前工作区打开一个 blank 会话（IWorkspaces.startSession 公开契约）。
    try { workspaces?.startSession() } catch { /* 静默：host 不可用时不阻断 */ }
    setOpen(false)
  }

  const openEntry = (selector: string): void => {
    // 命中即模拟点击打开对应宿主/插件面板；selector 未就位时静默失败。
    document.querySelector<HTMLElement>(selector)?.click()
    setOpen(false)
  }

  return createPortal(
    <>
      <button
        type="button"
        className={`webui-m-menu-btn${open ? ' open' : ''}`}
        aria-label="打开工作区"
        aria-expanded={open}
        onClick={() => { setOpen(prev => !prev) }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <div
        className={`webui-m-mask${open ? ' open' : ''}`}
        aria-hidden="true"
        onClick={() => { setOpen(false) }}
      />

      <aside
        className={`webui-m-drawer${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="工作区"
      >
        <div className="webui-m-drawer-head">
          <div className="webui-m-drawer-title">工作区</div>
          <button
            type="button"
            className="webui-m-drawer-close"
            aria-label="关闭"
            onClick={() => { setOpen(false) }}
          >×</button>
        </div>

        <button type="button" className="webui-m-new" onClick={newSession}>✚ 新建会话</button>

        <div className="webui-m-list" role="list" aria-label="会话列表">
          {items.length === 0 ? (
            <div className="webui-m-empty">{sessions === undefined ? '会话列表暂不可用' : '暂无会话'}</div>
          ) : items.map(item => (
            <button
              key={item.id}
              type="button"
              className={`webui-m-item${item.current ? ' current' : ''}`}
              role="listitem"
              aria-current={item.current || undefined}
              onClick={() => { openSession(item.id) }}
            >
              <span className="webui-m-item-title">{item.title}</span>
            </button>
          ))}
        </div>

        <div className="webui-m-entries" aria-label="工作区入口">
          {ENTRIES.map(entry => (
            <button
              key={entry.id}
              type="button"
              className="webui-m-entry"
              onClick={() => { openEntry(entry.selector) }}
            >
              <span aria-hidden="true">{entry.icon}</span>
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
      </aside>
    </>,
    document.body,
  )
}
