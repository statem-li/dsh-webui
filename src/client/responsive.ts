/**
 * dsh-webui — 移动端响应式基础设施。
 *
 * 统一「手机/窄屏」识别与全局覆盖，解决插件在手机浏览器上布局错乱的问题：
 *
 *  1. `MOBILE_BREAKPOINT` / `isMobileViewport()` / `useIsMobile()`：
 *     以 <768px 为手机断点（覆盖手机竖屏与小平板竖屏），供内联样式组件
 *     （用量工作台、峰谷账单等）实时切换全屏布局。
 *  2. `injectResponsiveStyles()`：注入一份全局移动端覆盖 CSS，负责两件插件
 *     自身样式无法覆盖的事：
 *       - DSH 官方设置面板（供应商/模型等 section 所在）在手机上从
 *         「188px 左导航 + 内容」两栏，改为「顶部横向滚动导航 + 单列内容」，
 *         否则内容列会被压到只剩 ~140px，供应商页完全不可用。
 *       - 所有居中对话框（Modal primitive / 设置面板）在手机上全宽/全高。
 *
 * 各插件的弹窗/抽屉/内部多列布局的移动端适配，仍写在各自 `styles.ts` 的
 * `@media (max-width: 767.98px)` 块里，保持与组件同生命周期。
 */
import { useEffect, useState } from 'react'

/** 手机断点（px）：视口宽度 <768 视为移动端。 */
export const MOBILE_BREAKPOINT = 768

/** 媒体查询串：767.98px，避免与 768 边界重叠。 */
const MOBILE_MQ = `(max-width: ${MOBILE_BREAKPOINT - 0.02}px)`

/** 同步判断当前是否移动端（SSR/无 matchMedia 时返回 false）。 */
export function isMobileViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(MOBILE_MQ).matches
}

/** React hook：跟随视口宽度实时返回是否移动端。 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() => isMobileViewport())
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(MOBILE_MQ)
    const onChange = (event: MediaQueryListEvent): void => { setMobile(event.matches) }
    setMobile(mql.matches)
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => { mql.removeEventListener('change', onChange) }
    }
    // 旧 Safari 兼容。
    if (typeof mql.addListener === 'function') {
      mql.addListener(onChange)
      return () => { mql.removeListener(onChange) }
    }
    return undefined
  }, [])
  return mobile
}

const STYLE_ID = 'dsh-webui-responsive-styles'

/**
 * 全局移动端覆盖样式。这里只放插件自身无法覆盖的宿主（DSH 设置面板）与
 * 通用对话框行为；插件自有弹窗的移动端规则在各组件 styles 里。
 */
const SHEET = `
@media (max-width: 767.98px) {
  /* 遮罩容器去掉 24px 留白，让内部对话框真正贴边全屏。 */
  [role="presentation"]:has(> [role="dialog"][aria-modal="true"]) {
    padding: 0 !important;
  }

  /* 所有居中对话框（Modal primitive / 设置面板）→ 移动端全宽。 */
  [role="presentation"] > [role="dialog"][aria-modal="true"] {
    width: 100vw !important;
    max-width: 100vw !important;
    border-radius: 0 !important;
  }

  /* ── DSH 官方设置面板（aria-labelledby 的那一个）：全高 + 两栏改单列 ── */
  [role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby] {
    height: 100vh !important;
    height: 100dvh !important;
    max-height: 100vh !important;
    max-height: 100dvh !important;
    flex-direction: column !important;
  }

  /* 左侧 188px 导航 → 顶部横向滚动 tab 条。 */
  [role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby] > nav {
    flex: none !important;
    width: 100% !important;
    height: auto !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 8px !important;
    padding: 8px 12px !important;
    border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)) !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    -webkit-overflow-scrolling: touch;
  }

  /* 标题行（「设置」）隐藏，给横向 tab 腾空间。 */
  [role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby] > nav > div:first-child {
    display: none !important;
  }

  /* 导航项列表横向排开并滚动。 */
  [role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby] > nav > div:last-child {
    flex-direction: row !important;
    gap: 4px !important;
    min-width: 0 !important;
    flex: 1 !important;
    overflow-x: auto !important;
  }

  /* 导航按钮不换行、缩小高度，适配单行滚动。 */
  [role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby] > nav button {
    flex: none !important;
    height: 36px !important;
    padding: 0 12px !important;
    white-space: nowrap !important;
  }

  /* 内容列全宽。 */
  [role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby] > div:last-child {
    min-width: 0 !important;
    flex: 1 1 auto !important;
  }

  /* options 滚动区左右留白缩小。 */
  [role="presentation"] > [role="dialog"][aria-modal="true"][aria-labelledby] > div:last-child > div:last-child {
    padding: 0 16px 16px !important;
  }
}
`

let injected = false

/** 注入全局响应式覆盖样式（幂等）；返回移除函数。 */
export function injectResponsiveStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/responsive'
    tag.textContent = SHEET
    document.head.appendChild(tag)
    injected = true
  }
  return () => {
    if (!injected) return
    document.getElementById(STYLE_ID)?.remove()
    injected = false
  }
}
