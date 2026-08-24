/**
 * sidebar-nav — 侧边栏导航区共享挂载器（webui 插件内部）。
 *
 * 「用量/余额」与 PlanWeave 入口从 sidebar.footer.action 迁入侧边栏上部，
 * 排在「自动化」菜单项（#dsh-automation-menu-host）正下方：
 *  - 锚点 = `[data-slot="sidebar.workspaces"]`（slots 渲染器的稳定锚 div，
 *    与 automation mount.tsx 同一契约），host 插在浏览区容器之前；
 *  - host 内含固定顺序的槽位容器（usage / planweave）：各入口经 useNavSlot
 *    轮询拿到自己的槽位后 portal 进去——顺序确定、互不覆盖；
 *  - 「技能」「记忆」两个入口的槽位（AUTO_ROW_SLOTS）由 AutomationApp 的
 *    React 树渲染在「自动化」host 内部，与自动化按钮合成一行（见 SHEET
 *    合并行规则）——外部脚本不 append 槽位，避免与 React 首次提交竞态；
 *    useNavSlot 持续校验兜住任何失联场景；
 *  - rail 折叠态由 useRail 观察 data-shell-overlay 框架容器的属性切换
 *    （与 AutomationApp 相同的 DOM 契约），rail 下导航行收缩为图标钮、
 *    合并行恢复纵向排列（纯 CSS :has 跟随）。
 */

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PopoverAnchor } from './popover-shell.js'

/** nav host id（本模块创建）。 */
const HOST_ID = 'dsh-webui-nav-host'
/** slots 渲染器的稳定锚点（automation mount.tsx 的 ANCHOR_SELECTOR 同款）。 */
const ANCHOR_SELECTOR = '[data-slot="sidebar.workspaces"]'
/** automation 菜单项 host id（mount.tsx 创建；本模块排在其后）。 */
const AUTO_HOST_ID = 'dsh-automation-menu-host'
/** 侧边栏折叠观察：AutomationApp / sidebar-float 相同的框架容器选择器。 */
const FRAME_SELECTOR = 'div:has(> [data-shell-overlay])'

/** nav host 内槽位名 → 顺序即 DOM 顺序（用量一行，PlanWeave 一行）。 */
const SLOT_NAMES = ['usage', 'planweave'] as const

/** 「自动化」host 内的合并行槽位：技能/记忆与自动化按钮同行（顺序即 DOM 顺序）。 */
const AUTO_ROW_SLOTS = ['skills', 'memory'] as const

/** 槽位名。 */
export type NavSlotName = (typeof SLOT_NAMES | typeof AUTO_ROW_SLOTS)[number]

let started = false
let pollTimer = 0

/** 确保 host 已创建并插到「自动化」菜单下方（幂等）；返回是否已就位。 */
function ensureHostPlaced(): boolean {
  const anchor = document.querySelector(ANCHOR_SELECTOR)
  if (anchor === null) return false
  const parent = anchor.parentElement
  if (parent === null) return false
  let host = document.getElementById(HOST_ID) as HTMLDivElement | null
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
  if (!inPlace) {
    parent.insertBefore(host, auto !== null ? (auto.nextElementSibling ?? anchor) : anchor)
  }
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

/** 轮询获取指定槽位容器（未就位时返回 null，组件据此暂不渲染）。
 *
 * 槽位可能位于 nav host（usage / planweave）或自动化 host（skills / memory
 * 合并行），因此全局按 data-nav-slot 查找——槽位名由本模块统一创建，唯一。
 *
 * **永不停止**：未就位时 100ms 阶梯快查（10 次后退 400ms）；找到后退化为
 * 800ms 慢速校验——同一节点 setSlot 被 React 直接跳过，零渲染开销。这样
 * 槽位一旦被移除/替换（HMR、React 重建 host、竞态清空等），portal 会自动
 * 迁到新槽；否则会攥着游离的旧槽引用把入口「弄丢」且不再恢复。
 */
export function useNavSlot(name: NavSlotName): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let timer = 0
    let tries = 0
    const poll = (): void => {
      const found = document.querySelector<HTMLElement>(`[data-nav-slot='${name}']`)
      if (found !== null) tries = 0
      else tries += 1
      setSlot(found)
      timer = window.setTimeout(poll, found !== null ? 800 : tries <= 10 ? 100 : 400)
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
/* 行尾附加内容（今日用量等）：等宽小字右贴 */
/* 行尾附加内容（今日用量等）：等宽数字右贴 */
.dsh-nav-trailing{flex:none;margin-left:auto;font-size:13px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);font-family:ui-monospace,SFMono-Regular,monospace}
/* 折叠 rail 态：只留图标（与原生 rail 图标钮 / auto-nav 同款几何） */
.dsh-nav-btn[data-rail='true']{width:36px;height:36px;padding:0;margin:0 0 8px;justify-content:center;border-radius:8px}
/* 未读 badge（记忆入口）：右上角小圆标 */
.dsh-nav-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;box-sizing:border-box;padding:0 4px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--dsw-alias-state-warn-primary,#e8a33d);color:#0e1116;font-size:10px;font-weight:700;line-height:16px}
/* 合并行：「自动化」host 承载 [自动化][技能][记忆] 一行；槽位 display:contents，
   让按钮直接参与行布局、宽度收缩为内容宽（放不下时允许折行兜底）。 */
#dsh-automation-menu-host{display:flex;flex-wrap:wrap;align-items:center;gap:2px}
#dsh-automation-menu-host>[data-nav-slot]{display:contents}
#dsh-automation-menu-host .dsh-nav-btn{width:auto;flex:none;margin:0 0 4px}
/* 折叠 rail 态：恢复纵向图标列（与原生 rail 图标钮节奏一致） */
#dsh-automation-menu-host:has(.dsh-nav-btn[data-rail]){flex-direction:column;align-items:flex-start;gap:0}
#dsh-automation-menu-host:has(.dsh-nav-btn[data-rail]) .dsh-nav-btn{width:36px;margin:0 0 8px}
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
  /** 行尾附加内容（如今日用量数字；rail 态不渲染）。 */
  trailing?: ReactNode
  /** 悬停：滑出卡片（hover 模式）。 */
  onMouseEnter?: (e: MouseEvent<HTMLButtonElement>) => void
  /** 移出按钮：启动自动收回计时（hover 模式）。 */
  onMouseLeave?: () => void
  /** 点击（hover 模式 = 切换钉住）。 */
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
}

/** 渲染一条导航行按钮（与 auto-nav 同款观感）。 */
export function NavButton({
  icon, label, rail = false, expanded = false, badge = 0, badgeTitle, ariaLabel, trailing,
  onMouseEnter, onMouseLeave, onClick,
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
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {icon}
      {!rail && <span className="dsh-nav-label">{label}</span>}
      {!rail && trailing !== undefined && (
        <span className="dsh-nav-trailing">{trailing}</span>
      )}
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

/** 「导航行右缘」滑出锚点（PopoverShell 用）。
 *
 * 合并行之后各入口按钮的右缘不再贴侧栏边——若仍以「按钮右缘 +8」定位，
 * 自动化/技能的卡片会叠在侧边栏上方。统一取按钮所在导航行容器（自动化
 * 合并行 host，或 nav host 的独立行）右缘 +8 作水平位；top 取按钮顶缘 -6
 * （与记忆面板既有效果一致）。rail 窄条下行容器即窄条本身，行为不变。
 */
export function navAnchorFrom(el: Element | null): PopoverAnchor | null {
  if (el === null) return null
  const row = el.closest(`#${AUTO_HOST_ID}`) ?? el.closest(`#${HOST_ID}`)
  if (row === null) return null
  const rowRect = row.getBoundingClientRect()
  const btnRect = el.getBoundingClientRect()
  return { left: Math.round(rowRect.right + 8), top: Math.round(btnRect.top - 6) }
}
