/**
 * session-pin — 右键菜单与重命名弹窗（React 半身）。
 *
 * 非 React 的 maintainer（dom 逻辑）通过 window 自定义事件请求打开菜单 /
 * 重命名弹窗；本模块的常驻 <SessionPinOverlay> 监听事件、渲染菜单与弹窗，
 * 并在用户选择后调用运行时会话/工作区服务（置顶 / 重命名 / 分叉 / 归档）。
 *
 * 事件契约：
 *  - `dsh:session-pin-menu`   detail: { sessionId, x, y, pinned, title }
 *  - `dsh:session-pin-rename` detail: { sessionId, title }
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ISessions, IWorkspaces, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { ArchiveIcon, ForkIcon, PinIcon, RenameIcon } from './icons'
import { isPinned, pin, unpin } from './store'

/** 打开右键菜单的自定义事件名。 */
export const MENU_EVENT = 'dsh:session-pin-menu'
/** 打开重命名弹窗的自定义事件名。 */
export const RENAME_EVENT = 'dsh:session-pin-rename'

/** 运行时会话 / 工作区服务（apply 时注入；未提供时相关动作降级为无操作）。 */
let sessions: ISessions | undefined
let workspaces: IWorkspaces | undefined

/** 由 apply 注入运行时服务。 */
export function setSessionPinServices(s: ISessions | undefined, w: IWorkspaces | undefined): void {
  sessions = s
  workspaces = w
}

interface MenuState {
  sessionId: SessionId
  x: number
  y: number
  pinned: boolean
  title: string
}

interface RenameState {
  sessionId: SessionId
  title: string
}

/** 触发右键菜单（供 maintainer 调用）。 */
export function openSessionPinMenu(state: MenuState): void {
  window.dispatchEvent(new CustomEvent<MenuState>(MENU_EVENT, { detail: state }))
}

/** 触发重命名弹窗（供 maintainer 调用）。 */
export function openSessionPinRename(state: RenameState): void {
  window.dispatchEvent(new CustomEvent<RenameState>(RENAME_EVENT, { detail: state }))
}

/** 分叉会话：在最后完成的回合切分并打开子会话（与 ui-workspace 同款）。 */
function doFork(sessionId: SessionId): void {
  sessions?.fork({ sessionId, increaseTitle: true })
    .then(childId => { sessions?.open(childId) })
    .catch(() => { /* fork 失败保持当前选择 */ })
}

/** 归档会话（log 与记账槽保留，行随归档集回显消失）。 */
function doArchive(sessionId: SessionId): void {
  workspaces?.archiveSession(sessionId).catch(() => { /* 归档失败非致命 */ })
}

/** 重命名会话（durable title 覆盖；host 归一化）。 */
async function doRename(sessionId: SessionId, title: string): Promise<string | null> {
  const session = sessions?.binding(sessionId)?.session
  if (session === undefined) return '未知会话'
  try {
    const result = await session.rename(title)
    if (!result.ok) return result.error.message
    return null
  } catch (reason) {
    return reason instanceof Error ? reason.message : String(reason)
  }
}

/** 右键菜单浮层。 */
function MenuCard({ state, onClose, onRename }: {
  state: MenuState
  onClose: () => void
  onRename: () => void
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)

  // 菜单外按下即关闭（菜单内按下不关，留给 click 执行选择）。不再用全屏 mask
  // 或 scroll 关闭：真实右键事件流里 mask 的 onClick/onContextMenu 与侧边栏
  // 滚动都会在菜单刚弹出时误触，导致「很快消失」。Esc 关闭由 Overlay 统一处理。
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (menuRef.current?.contains(event.target) === true) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [onClose])

  const items: Array<{ id: string; label: string; icon: JSX.Element; danger?: boolean; onPick: () => void }> = [
    {
      id: 'pin',
      label: state.pinned ? '取消置顶' : '置顶',
      icon: <PinIcon />,
      onPick: () => { (state.pinned ? unpin : pin)(state.sessionId); onClose() },
    },
    {
      id: 'rename',
      label: '重命名',
      icon: <RenameIcon />,
      onPick: () => { onClose(); onRename() },
    },
    {
      id: 'fork',
      label: '分叉会话',
      icon: <ForkIcon />,
      onPick: () => { doFork(state.sessionId); onClose() },
    },
    {
      id: 'archive',
      label: '归档会话',
      icon: <ArchiveIcon />,
      onPick: () => { doArchive(state.sessionId); onClose() },
    },
  ]

  // 菜单夹在视口内（12px 边距，与 DSH Menu 同款边界策略）。
  const vw = window.innerWidth
  const vh = window.innerHeight
  const estimatedW = 180
  const estimatedH = items.length * 33 + 8
  const left = Math.min(Math.max(8, state.x), Math.max(8, vw - estimatedW - 8))
  const top = Math.min(Math.max(8, state.y), Math.max(8, vh - estimatedH - 8))

  return createPortal(
    <div ref={menuRef} className="dsp-menu" style={{ left, top }} role="menu">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          className="dsp-menu-item"
          data-danger={item.danger === true || undefined}
          role="menuitem"
          onClick={item.onPick}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}

/** 重命名弹窗。 */
function RenameCard({ state, onClose }: { state: RenameState; onClose: () => void }): JSX.Element {
  const [draft, setDraft] = useState(state.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = draft.trim()
  const blocked = busy || trimmed === ''

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (blocked) return
    setBusy(true)
    setError(null)
    void doRename(state.sessionId, trimmed).then(message => {
      setBusy(false)
      if (message === null) onClose()
      else setError(message)
    })
  }

  return createPortal(
    <>
      <div className="dsp-rename-mask" aria-hidden="true" onClick={() => { if (!busy) onClose() }} />
      <form className="dsp-rename-card" role="dialog" aria-modal="true" aria-label="重命名会话" onSubmit={submit}>
        <div className="dsp-rename-title">重命名会话</div>
        <input
          className="dsp-rename-input"
          type="text"
          value={draft}
          autoFocus
          maxLength={200}
          aria-label="会话名称"
          onChange={event => { setDraft(event.target.value) }}
        />
        {error !== null && <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary, #f0524d)' }}>{error}</div>}
        <div className="dsp-rename-actions">
          <button type="button" className="dsp-rename-btn" data-kind="ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="submit" className="dsp-rename-btn" data-kind="primary" disabled={blocked}>确认</button>
        </div>
      </form>
    </>,
    document.body,
  )
}

/** 常驻覆盖层：监听事件渲染右键菜单 / 重命名弹窗。 */
export function SessionPinOverlay(): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [rename, setRename] = useState<RenameState | null>(null)

  useEffect(() => {
    const onMenu = (event: Event): void => {
      const detail = (event as CustomEvent<MenuState>).detail
      if (detail === undefined || typeof detail?.sessionId !== 'string') return
      setRename(null)
      setMenu({
        sessionId: detail.sessionId,
        x: typeof detail.x === 'number' ? detail.x : 0,
        y: typeof detail.y === 'number' ? detail.y : 0,
        pinned: detail.pinned === true,
        title: typeof detail.title === 'string' ? detail.title : '',
      })
    }
    const onRename = (event: Event): void => {
      const detail = (event as CustomEvent<RenameState>).detail
      if (detail === undefined || typeof detail?.sessionId !== 'string') return
      setMenu(null)
      setRename({ sessionId: detail.sessionId, title: typeof detail.title === 'string' ? detail.title : '' })
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { setMenu(null); setRename(null) }
    }
    window.addEventListener(MENU_EVENT, onMenu)
    window.addEventListener(RENAME_EVENT, onRename)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(MENU_EVENT, onMenu)
      window.removeEventListener(RENAME_EVENT, onRename)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <>
      {menu !== null && (
        <MenuCard
          state={menu}
          onClose={() => { setMenu(null) }}
          onRename={() => { setRename({ sessionId: menu.sessionId, title: menu.title }) }}
        />
      )}
      {rename !== null && <RenameCard state={rename} onClose={() => { setRename(null) }} />}
    </>
  )
}
