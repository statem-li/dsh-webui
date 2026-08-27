/**
 * mobile-app-shell — 移动端「APP 一般体验」层（P0-App-1/2/3/4）。
 *
 * 在既有移动端适配（mobile-overrides / responsive / back-to-top / popover-shell）之上，
 * 叠加「原生 App 一般」体验层，index.ts 用单个 ctx.effect 挂载，返回一次组合清理函数：
 *
 *  P0-App-1  meta 沉浸化：宿主 index.html 的 viewport=`width=device-width,
 *            initial-scale=1`【无 viewport-fit=cover】（architect 实证），原地追加
 *            `viewport-fit=cover`（浏览器只认第一个 viewport meta，绝不新增第二个），
 *            并注入 apple/mobile-web-app-capable、status-bar-style=black-translucent、
 *            title=DSH。**主题色不注入**——宿主 ThemePresenter 已动态管理
 *            meta[name=theme-color]（architect 实证：避免双 meta 冲突）。
 *  P0-App-2  全局质感样式：窄屏 tap-highlight 透明 / text-size-adjust /
 *            overscroll-behavior / -webkit-overflow-scrolling / :active 亮度反馈。
 *  P0-App-3/4 波纹 + 震动：同一 pointerdown(捕获) 监听；不调 stopPropagation /
 *            stopImmediatePropagation；窄屏才生效；每元素同时最多 1 个波纹；
 *            全局限速每秒 8 个；pointercancel 取消；reduced-motion 跳过波纹但保留震动。
 *
 * 红线 A：以下注入式 CSS 注释内未写出「星号紧跟正斜杠」两字符序列（风险仅用文字描述）。
 * 红线 B：波纹 span 为临时节点，(setTimeout+animationend 双保险) 保证 320ms 内移除、
 *         全局限速每 8 个，杜绝无界 DOM 堆积。
 * 红线 C：所有影响宿主的选择器规则均包在 @media (max-width: 767.98px) 或
 *         (prefers-reduced-motion: reduce) 内；.webui-ripple 类仅由本模块在移动端
 *         运行时创建，包裹媒体内确保桌面零回归。
 */

const APP_SHELL_STYLE_ID = 'dsh-webui-app-shell-styles'

/** viewport-fit=cover 匹配（大小写不敏感、允许空格）。 */
const VIEWPORT_COVER_RE = /\bviewport-fit\s*=\s*cover\b/i

/** 移动端媒体查询（与 responsive.ts 的 MOBILE_MQ 断点一致）。 */
const MOBILE_MQ = '(max-width: 767.98px)'

/** 单波纹生命周期（ms）。 */
const RIPPLE_LIFE_MS = 320
/** 波纹动画时长（ms）。 */
const RIPPLE_ANIM_MS = 320
/** 波纹全局限速：每秒最多创建个数（滑动窗口计数，红线 B）。 */
const MAX_RIPPLES_PER_SECOND = 8
/** 波纹命中目标：可交互元素。 */
const TAP_TARGET_SELECTOR = 'button, [role="button"], a, [data-webui-tap]'
/** 波纹排除：命中目标落在这些容器/元素内则跳过（防 Select/datalist/文本选区/输入干扰）。 */
const TAP_EXCLUDE_SELECTOR =
  'input, select, textarea, [contenteditable], [data-input-scroll], .webui-panel, [data-native-select]'

/** 幂等注入一段样式（与 injectResponsiveStyles / injectMobileOverrides 同套思路）。 */
function ensureStyle(id: string, css: string): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(id) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = id
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/mobile-app-shell'
    tag.textContent = css
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

/** 全局质感样式：窄屏触控/滚动/字号 + 波纹动画 + 动效降级兜底。 */
const APP_SHELL_SHEET = `
@media (max-width: 767.98px) {
  /* 去掉移动端默认点击高亮（蓝/灰方框），改由 :active 亮度反馈承担 */
  * { -webkit-tap-highlight-color: transparent; }
  /* 防 iOS 旋转/聚焦时字体被系统放大 */
  html { text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
  /* 顶部/底部橡皮筋回弹限制在自身滚动上下文内（contain 保滚动上下文） */
  body { overscroll-behavior-y: contain; }
  /* 滚动容器补 momentum 滚动（宿主已定义时重复声明也无碍） */
  [data-conversation-scroll],
  [data-input-scroll] {
    -webkit-overflow-scrolling: touch;
  }
  /* 统一点击轻反馈：亮度下降（既有 :active scale 只作用于 .webui-* 与 .psh-close，互补不冲突） */
  button,
  [role="button"],
  a:active { filter: brightness(.92); }
}

/* 波纹节点（仅移动端运行时创建；@keyframes 为纯定义、无桌面副作用） */
@media (max-width: 767.98px) {
  .webui-ripple {
    position: fixed;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    pointer-events: none;
    z-index: 1200;
    /* fallback：不支持 color-mix 的旧内核回退到半透明白 */
    background-color: rgba(255, 255, 255, .3);
    background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 35%, transparent);
    will-change: transform, opacity;
    animation: webui-ripple ${RIPPLE_ANIM_MS}ms ease-out forwards;
  }
}
@keyframes webui-ripple {
  /* scale 1 到 8~10，透明度 .35 到 0 */
  from { transform: scale(1); opacity: .35; }
  to { transform: scale(9); opacity: 0; }
}
/* 动效降级兜底：偏好减少动态时即便节点存在也不播动画、直接不可见 */
@media (prefers-reduced-motion: reduce) {
  .webui-ripple { animation: none !important; opacity: 0 !important; }
}
`

/**
 * P0-App-1：meta 沉浸化。
 *
 *  - 仅当 viewport meta 存在且 content 缺 `viewport-fit=cover` 时才动作并记录原 content；
 *    不新增第二个 viewport meta（浏览器取第一个生效）。
 *  - 仅当 viewport 追加成功时才注入 apple/mobile-web-app-capable、status-bar-style、
 *    title 等辅助 meta（沉浸状态栏依赖 fit=cover 生效）。
 *  - theme-color 不注入（宿主 ThemePresenter 已接管唯一 meta[name=theme-color]）。
 *  - dispose：还原 viewport content + 移除自建 meta 节点。
 */
function applyMeta(): () => void {
  const createdNodes: HTMLMetaElement[] = []
  let prevContent: string | null = null
  let appended = false
  let viewport: HTMLMetaElement | null = null

  if (typeof document !== 'undefined') {
    viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (viewport) {
      const content = viewport.getAttribute('content') ?? ''
      if (!VIEWPORT_COVER_RE.test(content)) {
        prevContent = content
        // 尾部去空格后再追加，避免重复空串；只调 setAttribute 记录原值供还原。
        viewport.setAttribute('content', `${content.replace(/\s*$/, '')}, viewport-fit=cover`)
        appended = true

        // 仅当 viewport 追加成功才注入（视口沉浸依赖 fit=cover）。仅不存在才注入。
        const desired: ReadonlyArray<readonly [string, string]> = [
          ['apple-mobile-web-app-capable', 'yes'],
          ['mobile-web-app-capable', 'yes'],
          ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
          ['apple-mobile-web-app-title', 'DSH'],
        ]
        for (const [name, value] of desired) {
          const existing = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
          if (existing) continue
          const meta = document.createElement('meta')
          meta.name = name
          meta.content = value
          document.head.appendChild(meta)
          createdNodes.push(meta)
        }
      }
    }
  }

  return () => {
    if (appended && prevContent !== null && viewport) {
      viewport.setAttribute('content', prevContent)
    }
    for (const node of createdNodes) node.remove()
  }
}

/**
 * P0-App-3 + P0-App-4：波纹 + 震动（同一 pointerdown 捕获监听驱动）。
 *
 *  - 捕获阶段可先命中，但不调 stopPropagation / stopImmediatePropagation，
 *    绝不干扰宿主与其他插件的监听器。
 *  - 窄屏才生效（波纹+震动都是移动端体验）；reduced-motion 时跳过波纹、保留震动。
 *  - 每元素同时最多 1 个波纹（新击重定位到新触点，旧波纹即移除）；全局限速每秒 8 个。
 *  - pointercancel 取消波纹；setTimeout+animationend 双保险清理，320ms 内必移除。
 * 返回移除函数。
 */
function applyRippleAndVibrate(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined'
    || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mobileMq = window.matchMedia(MOBILE_MQ)
  const reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)')

  /** 滑动窗口计数：记录的创建时间戳（毫秒）。 */
  const rippleTimes: number[] = []
  /** 元素 → 当前活跃波纹（每元素同时只 1 个）。 */
  const elementRipple = new Map<Element, HTMLSpanElement>()
  /** pointerId → 活跃波纹（pointercancel 用）。 */
  const pointerRipple = new Map<number, HTMLSpanElement>()
  /** 波纹 → 所归属元素（移除时清理 elementRipple）。 */
  const spanTarget = new WeakMap<HTMLSpanElement, Element>()

  const disposeRipple = (span: HTMLSpanElement): void => {
    if (span.dataset.done === '1') return
    span.dataset.done = '1'
    const target = spanTarget.get(span)
    if (target && elementRipple.get(target) === span) elementRipple.delete(target)
    const pid = Number(span.dataset.ptr ?? '-1')
    if (pid >= 0 && pointerRipple.get(pid) === span) pointerRipple.delete(pid)
    spanTarget.delete(span)
    span.remove()
  }

  const onPointerDown = (event: PointerEvent): void => {
    // 非移动端：波纹与震动都跳过（红线 C 桌面零监听影响，且无 App 体验必要）。
    if (!mobileMq.matches) return
    const el = event.target instanceof Element ? event.target : null
    if (el === null) return
    const hit = el.closest(TAP_TARGET_SELECTOR)
    if (hit === null) return
    // 命中后若落在排除容器内则不处理（防触发输入/列表/面板内部误反馈）。
    if (hit.closest(TAP_EXCLUDE_SELECTOR) !== null) return

    // 震动：短促 8ms；reduced-motion 下也保留（震动是触感，不是动态，遵 strategist）。
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(8)
    }

    // reduced-motion：跳过波纹（震动已保留）。
    if (reducedMotionMq.matches) return

    // 全局限速：滑动窗口每秒上限 8 个；超限则只震不波。
    const now = performance.now()
    while (rippleTimes.length > 0 && rippleTimes[0] <= now - 1000) rippleTimes.shift()
    if (rippleTimes.length >= MAX_RIPPLES_PER_SECOND) return
    rippleTimes.push(now)

    const span = document.createElement('span')
    span.className = 'webui-ripple'
    span.dataset.ptr = String(event.pointerId)
    span.style.left = `${event.clientX}px`
    span.style.top = `${event.clientY}px`
    spanTarget.set(span, hit)

    // 每元素同时只 1 个：已有活跃波纹则先移除，新波纹随触点重定位。
    const prev = elementRipple.get(hit)
    if (prev) disposeRipple(prev)
    elementRipple.set(hit, span)
    pointerRipple.set(event.pointerId, span)
    document.body.appendChild(span)

    span.addEventListener('animationend', () => disposeRipple(span), { once: true })
    window.setTimeout(() => disposeRipple(span), RIPPLE_LIFE_MS + 40)
  }

  // pointercancel：浏览器接管手势（如开始滚动）时取消对应波纹。
  const onPointerCancel = (event: PointerEvent): void => {
    const span = pointerRipple.get(event.pointerId)
    if (span) disposeRipple(span)
  }

  document.addEventListener('pointerdown', onPointerDown, { capture: true })
  document.addEventListener('pointercancel', onPointerCancel, { capture: true })

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, { capture: true })
    document.removeEventListener('pointercancel', onPointerCancel, { capture: true })
    // 清理残留波纹节点（幂等）。
    for (const span of Array.from(elementRipple.values())) disposeRipple(span)
    elementRipple.clear()
    pointerRipple.clear()
  }
}

/**
 * 挂载移动端 APP 一般体验层；返回一次性组合移除函数（幂等恢复所有改动）。
 * index.ts 用单个 ctx.effect(...) 调用，随插件生命周期卸载。
 */
export function applyMobileAppShell(): () => void {
  const removers: Array<() => void> = []
  removers.push(applyMeta())
  removers.push(ensureStyle(APP_SHELL_STYLE_ID, APP_SHELL_SHEET))
  removers.push(applyRippleAndVibrate())
  return () => {
    for (let i = removers.length - 1; i >= 0; i--) removers[i]()
  }
}
