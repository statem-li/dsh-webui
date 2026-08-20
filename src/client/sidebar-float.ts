/**
 * webui — 侧边栏模式（固定 / 悬浮）client 半身。
 *
 * 设置项「固定侧边栏」控制两种模式：
 *  - 固定（fixed=true，默认）：完全原生行为 —— 侧边栏常驻占位（挤压主内容）、
 *    点击折叠按钮收成 56px rail；不注入悬浮样式、不显示热区、不干预布局 store。
 *  - 悬浮（fixed=false）：侧边栏以悬浮层覆盖主内容（主内容始终全宽、不挤压），
 *    左侧边缘常驻一个 16px 热区，移入即展开、移出（含侧边栏与热区）延迟折叠，
 *    防止误触发。展开/折叠复用 DSH 布局 store 的 `sidebar` 状态（经
 *    ctx.layout.toggleSidebar 切换），因此侧边栏内容（会话列表/工作区/页脚动作）
 *    与视觉风格完全不变，仅交互方式不同。
 *
 * 悬浮模式下启动即折叠（只有热区，悬停展开），这是悬浮侧边栏的标准交互。
 * 仅通过 DOM/CSS 注入实现，不改动 DSH 源码。依赖 DSH 布局契约：
 *  - 根 AppFrame 是一个含 `[data-shell-overlay]` 直接子元素的 div（稳定标识）；
 *  - 其前三个子元素依次为：侧边栏列 / 中心列 / 详情列（顺序稳定）；
 *  - 折叠态由 frame 上的 `data-sidebar-collapsed` 属性表示。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

// ---- 与设置行 / host 共享的常量（设置行在 sidebar-float-row.tsx 引用）----
export const SIDEBAR_FLOAT_API = '/api/sidebar-float'
export const SIDEBAR_FLOAT_STORAGE_KEY = 'dsh.sidebarFloat.fixed'
export const SIDEBAR_FLOAT_DEFAULT_FIXED = true
/** 设置行切换后广播给悬浮模块的自定义事件（detail: { fixed: boolean }）。 */
export const SIDEBAR_FLOAT_MODE_EVENT = 'dsh:sidebar-float-mode'

const STYLE_ID = 'dsh-webui-sidebar-float-styles'
const BODY_CLASS = 'dsh-sidebar-float'
const INIT_CLASS = 'dsh-sidebar-float-init'
const NO_ANIM_CLASS = 'dsh-sidebar-float-no-anim'
const HOTZONE_CLASS = 'dsh-sidebar-hotzone'
const HOTZONE_OFF_CLASS = 'dsh-sidebar-hotzone-off'

/** 低于该宽度视为窄屏（与内核 SIDEBAR_AUTO_COLLAPSE=1024 对齐），悬浮模式不启用。 */
const WIDE_BREAKPOINT = 1024
/** 展开过渡时长（需求：100-200ms）。 */
const EXPAND_MS = 160
/** 移出折叠延迟（需求：200-300ms），防止误触发。 */
const COLLAPSE_DELAY_MS = 260
/** 热区悬停宽度（px）。 */
const HOTZONE_WIDTH = 16
/** 展开态侧边栏默认宽度（与内核 SIDEBAR_DEFAULT=280 一致）。 */
const SIDEBAR_DEFAULT_WIDTH = 280

/**
 * 悬浮模式的全局覆盖样式。选择器全部基于稳定 DOM 契约，避免依赖哈希后的
 * CSS Modules 类名（跨构建不稳定）。仅在 `body.dsh-sidebar-float` 存在时生效，
 * 固定模式（原生）下完全不影响布局。
 */
const SHEET = `
/* 悬浮模式：中心列横跨第 1/2 轨，详情列固定第 3 轨 —— 主内容始终全宽 */
body.${BODY_CLASS} div:has(> [data-shell-overlay]) > div:nth-child(2) {
  grid-column: 1 / span 2;
}
body.${BODY_CLASS} div:has(> [data-shell-overlay]) > div:nth-child(3) {
  grid-column: 3;
}

/* 侧边栏列改为悬浮层覆盖内容，不参与网格占位 */
body.${BODY_CLASS} div:has(> [data-shell-overlay]) > div:nth-child(1) {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 10;
  width: ${SIDEBAR_DEFAULT_WIDTH}px;
  box-shadow: var(--dsw-shadow-lv3, 0 0 1px 0 rgba(0,0,0,.2), 0 12px 32px 0 rgba(0,0,0,.08));
  transition: left ${EXPAND_MS}ms var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
}

/* 折叠态：整列滑出视野，仅保留左侧热区 */
body.${BODY_CLASS} div:has(> [data-shell-overlay])[data-sidebar-collapsed] > div:nth-child(1) {
  left: calc(-1 * ${SIDEBAR_DEFAULT_WIDTH}px - 1px);
}

/* 悬浮模式隐藏侧边栏拖拽手柄（悬浮层固定宽度，无需拖动） */
body.${BODY_CLASS} div:has(> [data-shell-overlay]) > [data-side="sidebar"] {
  display: none;
}

/* 初始化阶段：强制隐藏侧边栏，避免「先展开再折叠」的首帧闪动 */
body.${BODY_CLASS}.${INIT_CLASS} div:has(> [data-shell-overlay]) > div:nth-child(1) {
  left: calc(-1 * ${SIDEBAR_DEFAULT_WIDTH}px - 1px);
}

/* 初始化/切换瞬间禁用过渡，保证初始态直接落位 */
body.${BODY_CLASS}.${NO_ANIM_CLASS} div:has(> [data-shell-overlay]) > div:nth-child(1) {
  transition: none;
}

/* 左侧常驻热区（固定定位，覆盖侧边栏上方但不拦截折叠态下的内容点击） */
.${HOTZONE_CLASS} {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: ${HOTZONE_WIDTH}px;
  z-index: 15;
  pointer-events: auto;
}

/* 热区视觉提示：左缘一条竖向小竖条，悬停/激活时点亮（品牌蓝） */
.${HOTZONE_CLASS}::after {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 64px;
  border-radius: 0 4px 4px 0;
  background: var(--dsw-alias-state-business-primary, #4176e6);
  opacity: 0.32;
  transition: opacity ${EXPAND_MS}ms var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
}

.${HOTZONE_CLASS}:hover::after {
  opacity: 0.95;
}

/* 侧边栏展开时热区退场：不拦截侧边栏内容点击，也不显示提示条 */
.${HOTZONE_CLASS}.${HOTZONE_OFF_CLASS} {
  pointer-events: none;
}
.${HOTZONE_CLASS}.${HOTZONE_OFF_CLASS}::after {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  body.${BODY_CLASS} div:has(> [data-shell-overlay]) > div:nth-child(1) {
    transition: none;
  }
}
`

/** 同步读取 localStorage 缓存的「固定侧边栏」值（缺省回退默认 true）。 */
export function readCachedFixed(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_FLOAT_STORAGE_KEY)
    if (raw === '0' || raw === 'false') return false
    if (raw === '1' || raw === 'true') return true
  } catch { /* 忽略 */ }
  return SIDEBAR_FLOAT_DEFAULT_FIXED
}

/**
 * 启动侧边栏模式控制；返回清理函数。
 * @param ctx - 浏览器插件上下文（需要 layout 服务）。
 */
export function applySidebarFloat(ctx: ClientContext): () => void {
  if (typeof document === 'undefined') return () => {}
  const layout = (ctx as any).layout as { toggleSidebar(): void } | undefined

  // ---- 注入样式（幂等）----
  let styleEl = document.getElementById(STYLE_ID)
  if (styleEl === null) {
    styleEl = document.createElement('style')
    styleEl.id = STYLE_ID
    styleEl.dataset.plugin = '@dsh-external/dsh-webui'
    styleEl.dataset.pluginCss = 'webui/sidebar-float'
    styleEl.textContent = SHEET
    document.head.appendChild(styleEl)
  }

  // ---- 热区元素（固定模式下隐藏）----
  const hotzone = document.createElement('div')
  hotzone.className = HOTZONE_CLASS
  hotzone.setAttribute('aria-hidden', 'true')
  document.body.appendChild(hotzone)

  // ---- 状态 ----
  let frameEl: HTMLElement | null = null
  let sidebarEl: HTMLElement | null = null
  let floatMode = false          // 当前是否悬浮模式（fixed=false）
  let open: boolean | null = null // 悬浮模式意图：true=展开 false=折叠（null=未确定）
  let pending = false             // 已触发 toggle，等待 data-sidebar-collapsed 落位
  let active = false              // 宽屏（悬浮模式的附加条件；窄屏交还原生 rail）
  let disposed = false
  let hideTimer = 0
  let recheckTimer = 0
  let lastX = -9999
  let lastY = -9999

  const body = document.body

  const findFrame = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('div:has(> [data-shell-overlay])')

  const isCollapsed = (): boolean =>
    frameEl?.hasAttribute('data-sidebar-collapsed') ?? true

  const syncHotzone = (): void => {
    // 仅悬浮 + 宽屏时显示热区；悬浮内展开时热区退场，避免遮挡侧边栏左缘。
    hotzone.style.display = floatMode && active ? '' : 'none'
    hotzone.classList.toggle(HOTZONE_OFF_CLASS, floatMode && active && open === true)
  }

  /** 触发一次布局 store 切换（经 ctx.layout，与原生折叠按钮同源）。 */
  const doToggle = (): void => {
    if (pending || layout === undefined) return
    pending = true
    try {
      layout.toggleSidebar()
    } catch {
      pending = false
      return
    }
    // 保险：若因未接线等原因迟迟没有属性变化，释放 pending。
    window.setTimeout(() => { pending = false }, 320)
  }

  /** 依据「意图 open」与「实际 data-sidebar-collapsed」对齐布局状态（仅悬浮模式）。 */
  const reconcile = (): void => {
    if (!floatMode || !active || open === null || frameEl === null) return
    if (pending) { syncHotzone(); return }
    const collapsed = isCollapsed()
    if (open && collapsed) doToggle()
    else if (!open && !collapsed) doToggle()
    syncHotzone()
  }

  /** 设定意图状态并立即对齐。 */
  const setOpen = (next: boolean): void => {
    if (open === next) return
    open = next
    reconcile()
    // 展开后重新校验指针位置：覆盖「快速移入后停在侧边栏区域内」的无 move 场景。
    if (next) scheduleRecheck()
  }

  const cancelHide = (): void => {
    if (hideTimer !== 0) { window.clearTimeout(hideTimer); hideTimer = 0 }
  }

  const armHide = (): void => {
    cancelHide()
    hideTimer = window.setTimeout(() => { hideTimer = 0; setOpen(false) }, COLLAPSE_DELAY_MS)
  }

  const scheduleRecheck = (): void => {
    if (recheckTimer !== 0) window.clearTimeout(recheckTimer)
    recheckTimer = window.setTimeout(() => {
      recheckTimer = 0
      if (!pointInside(lastX, lastY)) armHide()
    }, EXPAND_MS + 80)
  }

  /** 判断坐标是否落在热区或侧边栏（并集）内（仅悬浮 + 宽屏）。 */
  const pointInside = (x: number, y: number): boolean => {
    if (!floatMode || !active) return false
    const hz = hotzone.getBoundingClientRect()
    if (x >= hz.left && x < hz.right && y >= hz.top && y < hz.bottom) return true
    const sb = sidebarEl?.getBoundingClientRect()
    if (sb !== undefined && x >= sb.left && x < sb.right && y >= sb.top && y < sb.bottom) return true
    return false
  }

  // rAF 节流指针移动：进入并集 → 展开；离开并集 → 延迟折叠。
  let moveRaf = 0
  const onPointerMove = (event: PointerEvent): void => {
    if (!floatMode) return
    lastX = event.clientX
    lastY = event.clientY
    if (moveRaf !== 0) return
    moveRaf = window.requestAnimationFrame(() => {
      moveRaf = 0
      if (pointInside(lastX, lastY)) { cancelHide(); setOpen(true) }
      else armHide()
    })
  }

  // 指针离开窗口：按折叠处理（进入延迟折叠）。
  const onPointerLeave = (): void => { if (floatMode) armHide() }

  // 观察 frame 的 data-sidebar-collapsed：区分「我方 toggle 落位」与「用户手动点击折叠按钮」。
  let attrObserver: MutationObserver | null = null
  const watchFrame = (frame: HTMLElement): void => {
    frameEl = frame
    sidebarEl = frame.children[0] instanceof HTMLElement ? frame.children[0] as HTMLElement : null

    attrObserver = new MutationObserver(() => {
      if (disposed) return
      if (pending) {
        // 我方 toggle 已落位。
        pending = false
        reconcile()
      } else if (floatMode) {
        // 悬浮模式下外部变化（用户点击侧边栏折叠按钮等）：采纳用户意图。
        open = !isCollapsed()
        syncHotzone()
      }
      // 固定模式下属性变化不干预（原生行为）。
    })
    attrObserver.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
  }

  /**
   * 应用模式：fixed=true → 原生固定；fixed=false → 悬浮。
   * @param fixed - 设置项「固定侧边栏」的值。
   * @param initial - 是否为首帧初始化（首帧需要隐藏+禁过渡防闪动）。
   */
  const applyMode = (fixed: boolean, initial: boolean): void => {
    const nextFloat = !fixed
    if (nextFloat === floatMode) { syncHotzone(); return }
    floatMode = nextFloat

    if (floatMode) {
      // → 悬浮：加 class + 显示热区 + 折叠启动（悬浮标准交互：热区收起，悬停展开）。
      body.classList.add(BODY_CLASS)
      if (initial) body.classList.add(INIT_CLASS, NO_ANIM_CLASS)
      open = false
      reconcile()
      if (initial) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (disposed) return
            body.classList.remove(INIT_CLASS)
            void frameEl?.offsetHeight // 强制回流，让无过渡落位生效
            body.classList.remove(NO_ANIM_CLASS)
            syncHotzone()
          })
        })
      }
    } else {
      // → 固定（原生）：移除悬浮 class + 隐藏热区 + 恢复 store 展开（原生默认）。
      body.classList.remove(BODY_CLASS, INIT_CLASS, NO_ANIM_CLASS)
      open = null
      if (frameEl !== null && isCollapsed() && layout !== undefined) {
        body.classList.add(NO_ANIM_CLASS)
        try { layout.toggleSidebar() } catch { /* 忽略 */ }
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (disposed) return
            void frameEl?.offsetHeight
            body.classList.remove(NO_ANIM_CLASS)
          })
        })
      }
      syncHotzone()
    }
  }

  // 设置行切换（同标签页）或其它标签页（storage 事件）驱动模式切换。
  const onModeEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{ fixed?: boolean }>).detail
    if (typeof detail?.fixed !== 'boolean') return
    applyMode(detail.fixed, false)
  }
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== SIDEBAR_FLOAT_STORAGE_KEY) return
    applyMode(event.newValue !== '0', false)
  }
  window.addEventListener(SIDEBAR_FLOAT_MODE_EVENT, onModeEvent)
  window.addEventListener('storage', onStorage)

  // 等待根 AppFrame 出现（React 首帧挂载后），确定初始模式。
  let bootstrapTimer = 0
  const boot = (): void => {
    if (disposed) return
    const frame = findFrame()
    if (frame === null) {
      bootstrapTimer = window.setTimeout(boot, 50)
      return
    }
    watchFrame(frame)
    // 初始模式（localStorage 同步缓存，避免异步 fetch 导致首帧闪动）。
    const fixed = readCachedFixed()
    applyMode(fixed, true)

    // 与服务端对齐一次（多标签/首次访问兜底）。
    fetch(SIDEBAR_FLOAT_API, { cache: 'no-store' })
      .then(r => r.json())
      .then((r) => {
        if (disposed || typeof r?.fixed !== 'boolean') return
        if (r.fixed !== readCachedFixed()) {
          try { localStorage.setItem(SIDEBAR_FLOAT_STORAGE_KEY, r.fixed ? '1' : '0') } catch { /* 忽略 */ }
          applyMode(r.fixed, false)
        }
      })
      .catch(() => {})
  }

  // 宽屏启用、窄屏禁用悬浮（窄屏交由原生 rail 自动折叠）。
  const mql = typeof window.matchMedia === 'function'
    ? window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`)
    : null
  const updateActive = (): void => {
    const wide = mql?.matches ?? true
    if (wide === active) return
    active = wide
    syncHotzone()
    if (active) reconcile()
  }
  updateActive()
  mql?.addEventListener('change', updateActive)

  document.addEventListener('pointermove', onPointerMove, { passive: true })
  document.documentElement.addEventListener('mouseleave', onPointerLeave)

  boot()

  return () => {
    disposed = true
    if (hideTimer !== 0) window.clearTimeout(hideTimer)
    if (recheckTimer !== 0) window.clearTimeout(recheckTimer)
    if (bootstrapTimer !== 0) window.clearTimeout(bootstrapTimer)
    if (moveRaf !== 0) window.cancelAnimationFrame(moveRaf)
    attrObserver?.disconnect()
    mql?.removeEventListener('change', updateActive)
    window.removeEventListener(SIDEBAR_FLOAT_MODE_EVENT, onModeEvent)
    window.removeEventListener('storage', onStorage)
    document.removeEventListener('pointermove', onPointerMove)
    document.documentElement.removeEventListener('mouseleave', onPointerLeave)
    hotzone.remove()
    body.classList.remove(BODY_CLASS, INIT_CLASS, NO_ANIM_CLASS)
    styleEl?.remove()
  }
}
