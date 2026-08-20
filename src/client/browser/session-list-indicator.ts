/**
 * dsh-browser — 侧边栏会话列表浏览器标识（client 半身）。
 *
 * DSH 的会话行（ui-workspace SessionNodeItem）没有预留插件 slot，纯插件约束下
 * 只能走 DOM 层注入：用 MutationObserver 观察侧边栏 DOM，扫描会话行
 * （`div[role="treeitem"][aria-selected]`），按「活跃会话的 displayTitle」精确匹配
 * 行内标题文本，在标题前注入浏览器图标（呼吸动画）。活动结束（store 里该会话
 * 消失）即移除图标。
 *
 * 已知局限：匹配依赖 displayTitle 文本；两个会话恰好同标题时会都命中（误报图标，
 * 风险极低且只影响显示）。该位置相对其他能力更受 DSH 前端 DOM 结构变更影响。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { browserActivityStore } from './activity'

const BADGE_CLASS = 'dsh-browser-sidebar-badge'

const GLOBE_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.4"/><ellipse cx="12" cy="12" rx="4" ry="9" stroke="currentColor" stroke-width="2.4"/><path d="M3.5 9h17M3.5 15h17" stroke="currentColor" stroke-width="2.2"/></svg>'

/** 在会话行内定位标题 span（textContent 精确命中活跃会话标题之一）。 */
function findTitleSpan(row: HTMLElement, titles: readonly string[]): HTMLElement | null {
  for (const span of row.querySelectorAll<HTMLElement>('span')) {
    const text = (span.textContent ?? '').trim()
    if (text !== '' && titles.includes(text)) return span
  }
  return null
}

/** 启动侧边栏浏览器标识注入；返回停止函数（移除监听与全部图标）。 */
export function applySessionListIndicator(ctx: ClientContext): () => void {
  if (typeof document === 'undefined') return () => {}
  const store = browserActivityStore()
  const sessions = ctx.sessions

  let raf = 0
  const schedule = (): void => {
    if (raf !== 0) return
    raf = requestAnimationFrame(() => { raf = 0; scan() })
  }

  const titleOf = (sessionId: string): string | undefined => {
    const byId = sessions.list.getSnapshot().byId as Record<string, { displayTitle?: string } | undefined>
    return byId[sessionId]?.displayTitle
  }

  const scan = (): void => {
    const active = store.active
    // 活跃 sessionId → title 的映射；同标题会话只保留一个（已知局限）。
    const byTitle = new Map<string, string>()
    for (const [sessionId, info] of active) {
      const title = titleOf(sessionId)
      if (title !== undefined && title !== '') {
        byTitle.set(title, `${info.label}${info.detail !== '' ? ` · ${info.detail}` : ''}`)
      }
    }
    const titles = [...byTitle.keys()]

    const rows = document.querySelectorAll<HTMLElement>('div[role="treeitem"][aria-selected]')
    for (const row of rows) {
      const titleSpan = findTitleSpan(row, titles)
      const title = titleSpan === null ? '' : (titleSpan.textContent ?? '').trim()
      const tip = title === '' ? undefined : byTitle.get(title)
      const badge = row.querySelector<HTMLElement>(`.${BADGE_CLASS}`)

      // 不需要图标：移除已存在的。
      if (tip === undefined || titleSpan === null) {
        badge?.remove()
        continue
      }
      const fullTip = `AI 浏览器：${tip}`
      // 已正确位于标题前：仅同步 tooltip（不产生 DOM 结构变化，避免观察器自激）。
      if (badge !== null && badge.previousElementSibling === titleSpan) {
        if (badge.title !== fullTip) badge.title = fullTip
        continue
      }
      // 需要插入或修正位置。
      badge?.remove()
      const el = document.createElement('span')
      el.className = BADGE_CLASS
      el.title = fullTip
      el.setAttribute('aria-label', `AI 浏览器操作中：${tip}`)
      el.innerHTML = GLOBE_SVG
      titleSpan.before(el)
    }
  }

  const unsubStore = store.subscribe(schedule)
  const unsubList = sessions.list.subscribe(schedule)
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  schedule()

  return () => {
    unsubStore()
    unsubList()
    observer.disconnect()
    if (raf !== 0) cancelAnimationFrame(raf)
    for (const el of document.querySelectorAll(`.${BADGE_CLASS}`)) el.remove()
  }
}
