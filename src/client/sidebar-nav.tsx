/**
 * sidebar-nav — 侧边栏导航区共享挂载器（webui 插件内部）。
 *
 * 「用量/余额」「技能」「记忆」三个入口从 sidebar.footer.action 迁入侧边栏上部，
 * 排在「自动化」菜单项（#dsh-automation-menu-host）正下方：
 *  - 锚点 = `[data-slot="sidebar.workspaces"]`（slots 渲染器的稳定锚 div，
 *    与 automation mount.tsx 同一契约），host 插在浏览区容器之前；
 *  - host 内含固定顺序的槽位容器（usage / memory 各一）：各入口经 useNavSlot
 *    轮询拿到自己的槽位后 portal 进去——顺序确定、互不覆盖；
 *  - 自动化 host 尚未挂载时先贴浏览区之前，轮询检测到后自动修正到其正下方
 *    （两个模块的 apply 时序无关紧要）；
 *  - rail 折叠态由 useRail 观察 data-shell-overlay 框架容器的属性切换
 *    （与 AutomationApp 相同的 DOM 契约），rail 下导航行收缩为图标钮。
 */

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** nav host id（本模块创建）。 */
const HOST_ID = 'dsh-webui-nav-host'
/** slots 渲染器的稳定锚点（automation mount.tsx 的 ANCHOR_SELECTOR 同款）。 */
const ANCHOR_SELECTOR = '[data-slot="sidebar.workspaces"]'
/** automation 菜单项 host id（mount.tsx 创建；本模块排在其后）。 */
const AUTO_HOST_ID = 'dsh-automation-menu-host'
/** 侧边栏折叠观察：AutomationApp / sidebar-float 相同的框架容器选择器。 */
const FRAME_SELECTOR = 'div:has(> [data-shell-overlay])'

/** 槽位名 → 顺序即 DOM 顺序（用量/技能一组，记忆一组）。 */
const SLOT_NAMES = ['usage', 'memory'] as const

/** 槽位名。 */
export type NavSlotName = (typeof SLOT_NAMES)[number]

let started = false
let pollTimer = 0

/** 确保 host 已创建并插到「自动化」菜单下方（幂等）；返回是否已就位。 */
function ensureHostPlaced(): boolean {
  const anchor = document.querySelector(ANCHOR_SELECTOR)
  if (anchor === null) return false
  const parent = anchor.parentElement
  if (parent === null) return false
  let host = document.getElementById<HTMLDivElement>(HOST_ID)
  if (host === null) {
    host = document.createElement('div')
    host.id = HOST_ID
    host.dataset.plugin = '@dsh-external/dsh-webui'
    for (const name of SLOT_NAMES) {
      const slot = document.createElement('div')
      slot.dataset.navSlot = name
      host.appendChild(slot)
    }
  }
  const auto = document.getElementById(AUTO_HOST_ID)
  // 就位判定：host 与锚点同父、在锚点之前，且（若自动化 host 存在）在其之后。
  const inPlace = host.parentElement === parent
    && (anchor.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
    && (auto === null || (auto.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
  if (inPlace) return true
  parent.insertBefore(host, auto !== null ? (auto.nextElementSibling ?? anchor) : anchor)
  return true
}

/**
 * 挂载导航区 host（幂等单例）。首次调用者持有清理权（停轮询、移除 host），
 * 后续调用返回 no-op——与 automation mount.tsx 的所有权模式一致。
 */
export function ensureNavMount(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (started) return () => {}
  started = true
  ensureHostPlaced()
  // 低频轮询兜底：侧边栏重挂 / 自动化 host 后到时自动补位。
  pollTimer = window.setInterval(() => { ensureHostPlaced() }, 1500)
  return () => {
    window.clearInterval(pollTimer)
    pollTimer = 0
    started = false
    document.getElementById(HOST_ID)?.remove()
  }
}

/** 轮询获取指定槽位容器（host 未就位时返回 null，组件据此暂不渲染）。 */
export function useNavSlot(name: NavSlotName): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let timer = 0
    const poll = (): void => {
      const found = document.getElementById(HOST_ID)
        ?.querySelector<HTMLElement>(`:scope > [data-nav-slot='${name}']`) ?? null
      setSlot(found)
      if (found === null) timer = window.setTimeout(poll, 400)
    }
    poll()
    return () => { window.clearTimeout(timer) }
  }, [name])
  return slot
}

/** 侧边栏折叠态（rail = 只显示图标）。
 *
 * 观察挂在 body 子树上（attributeFilter 限定 data-sidebar-collapsed）：
 * 框架容器可能在折叠时被 React 重挂，盯单节点会失联；body 级观察 + 低频
 * 兜底重读对「框架迟到 / 节点替换 / 属性时序」都免疫。值不变时 React 自动
 * 跳过渲染，轮询无额外开销。
 */
export function useRail(): boolean {
  const [rail, setRail] = useState(() =>
    document.querySelector(FRAME_SELECTOR)?.hasAttribute('data-sidebar-collapsed') ?? false)
  useEffect(() => {
    const read = (): void => {
      setRail(document.querySelector(FRAME_SELECTOR)?.hasAttribute('data-sidebar-collapsed') ?? false)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-sidebar-collapsed'], subtree: true })
    const timer = window.setInterval(read, 1500)
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
    }
  }, [])
  return rail
}

const STYLE_ID = 'dsh-webui-nav-styles'

const SHEET = `
/* 导航行：与「自动化」菜单行同款几何（透明底 + hover 高亮 + 文字省略） */
.dsh-nav-btn{position:relative;display:flex;align-items:center;gap:8px;width:calc(100% - 4px);height:34px;padding:0 10px;margin:0 2px 4px;box-sizing:border-box;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:14px;line-height:20px;font-family:inherit;cursor:pointer;text-align:left;user-select:none;overflow:hidden;transition:background 120ms ease}
.dsh-nav-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-nav-btn[data-open='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-nav-btn>svg{flex:none;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-nav-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 折叠 rail 态：只留图标（与原生 rail 图标钮 / auto-nav 同款几何） */
.dsh-nav-btn[data-rail='true']{width:36px;height:36px;padding:0;margin:0 0 8px;justify-content:center;border-radius:8px}
/* 未读 badge（记忆入口）：右上角小圆标 */
.dsh-nav-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;box-sizing:border-box;padding:0 4px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--dsw-alias-state-warn-primary,#e8a33d);color:#0e1116;font-size:10px;font-weight:700;line-height:16px}
`

/** 注入导航行样式（幂等）。 */
export function ensureNavStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** NavButton 属性。 */
export interface NavButtonProps {
  /** 行图标（svg 元素，颜色由样式表统一着色）。 */
  icon: ReactNode
  /** 行文字（rail 态不渲染）。 */
  label: string
  /** 折叠态（只留图标）。 */
  rail?: boolean
  /** 面板展开态（高亮底色）。 */
  expanded?: boolean
  /** 未读角标数（0/undefined 不显示；>99 显示 99+）。 */
  badge?: number
  /** 角标悬停提示。 */
  badgeTitle?: string
  /** 无障碍名（缺省用 label）。 */
  ariaLabel?: string
  onClick: () => void
}

/** 渲染一条导航行按钮（与 auto-nav 同款观感）。 */
export function NavButton({
  icon, label, rail = false, expanded = false, badge = 0, badgeTitle, ariaLabel, onClick,
}: NavButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="dsh-nav-btn"
      data-rail={rail || undefined}
      data-open={expanded || undefined}
      aria-label={ariaLabel ?? label}
      aria-expanded={expanded}
      title={rail ? (ariaLabel ?? label) : undefined}
      onClick={onClick}
    >
      {icon}
      {!rail && <span className="dsh-nav-label">{label}</span>}
      {badge > 0 && (
        <span className="dsh-nav-badge" title={badgeTitle}>{badge > 99 ? '99+' : String(badge)}</span>
      )}
    </button>
  )
}

/** 便捷组合：portal 到指定槽位（slot 未就位时不渲染）。 */
export function NavPortal({ name, children }: { name: NavSlotName; children: ReactNode }): JSX.Element | null {
  const slot = useNavSlot(name)
  if (slot === null) return null
  return createPortal(children, slot)
}
