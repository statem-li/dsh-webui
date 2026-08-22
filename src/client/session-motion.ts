/**
 * webui — 会话切换柔和过渡（client 半身，纯 CSS + 一个滑动高亮层）。
 *
 * 原生行为：点击侧边栏会话行后，React 直接替换中央会话子树（实测整棵
 * ConversationRoot 都会卸载重建），侧边栏选中高亮也只是「旧行底色消失、
 * 新行底色出现」的两个独立瞬变——观感「硬切」。本模块在不触碰 DSH 源码
 * 的前提下补上三层柔和感：
 *
 *  1. 内容区入场动画：利用「切换即整树重建」的事实——新的 viewArea /
 *     composerHero 元素挂载时 CSS animation 自动播放一次，实现淡入+轻微
 *     上浮。零 JS 时序管理：不订阅 store、不用 rAF/MutationObserver/WAAPI，
 *     冻结 rAF 的环境照常工作。选择器全部限定在常驻锚点
 *     [data-conversation-scroll] 内并用稳定语义后缀（CSS Modules hash 前缀
 *     随构建变化、后缀不变）：
 *       - 会话态消息流 [class*="viewArea"]：ConversationRoot.module.css 的
 *         .viewArea，仅在会话整树重建（=切换会话/首屏）时重新挂载；对话/
 *         轨迹视图 tab、检查弹层等局部更新不触碰它，不会反复播动画。
 *       - 空白会话 Hero [class*="composerHero"]：hero 态的 composerStack
 *         变体，欢迎语 + 居中输入卡整体浮现。
 *  2. 顶部面包屑标题行：root 的直接子级中除滚动体外的元素（header），
 *    以 :has() 反向定位，纯透明度轻淡入，与新内容同节奏浮现。
 *  3. 侧边栏选中高亮滑动：注入一个与官方选中底色同色的浮动高亮层，
 *    点击另一行时从旧位置平滑滑到新位置（FLIP 式），动画期间临时透明化
 *    新行官方底色、结束后无缝交还——高亮像流体一样「流」到目标行，而
 *    不是两处底色各自瞬变。仅监听 aria-selected 属性变化，不动任何交互。
 *
 * 边界与安全：
 *  - `both` fill 只覆盖挂载后首次播放期，播完即常态样式；中途异常只损失
 *    动画，不影响布局与交互。
 *  - 高亮层 z-index:-1 夹在树容器（JS 标记 relative+z-index:0 形成的局部
 *    stacking context）背景与行内容之间，永不遮挡文字、不拦截点击
 *    （pointer-events:none）。行内拖拽指示线等 absolute 伪元素均以行自身
 *    （.dropBefore/.dropBefore 已 relative）为参照，不受树容器定位影响。
 *  - prefers-reduced-motion: reduce 时全部禁用（与官方 Rows.module.css 的
 *    无障碍约定一致）。
 *  - 不新增除高亮层外的 DOM、不改任何元素常态样式（除 transition 一项），
 *    对玻璃质感主题与官方浮层零干扰。
 */

/** 注入样式节点 id（幂等注入标记）。 */
const STYLE_ID = 'dsh-webui-session-motion'

/** 滑动高亮层类名与宿主标记、接管期标记。 */
const PILL_CLASS = 'dsh-webui-swap-pill'
const HOST_CLASS = 'dsh-webui-swap-host'
const TAKING_CLASS = 'dsh-webui-motion-taking'

/** 滑动动画时长（ms）与缓动。 */
const SLIDE_DURATION = 260
const SLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

const CSS = `
/* ===== dsh-webui 会话切换柔和过渡 ===== */
/* 内容主体入场：淡入 + 10px 上浮（easeOutExpo 系缓动，起步快收尾绵）。
   仅在元素挂载时播放一次——会话切换即整树重建，正好等价于"切换瞬间"。 */
@keyframes dsh-webui-swap-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
[data-conversation-scroll] :is([class*="viewArea"], [class*="composerHero"]) {
  animation: dsh-webui-swap-in 400ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
/* 顶部面包屑标题行：root 的直接子级中除滚动体外的那个（即 header），
   纯透明度轻淡入，与新内容同节奏浮现。 */
div:has(> [data-conversation-scroll]) > :not([data-conversation-scroll]) {
  animation: dsh-webui-swap-fade 300ms ease-out both;
}
@keyframes dsh-webui-swap-fade {
  from { opacity: 0.2; }
  to { opacity: 1; }
}
/* 侧边栏行底色平滑渐变：hover 与选中态不再瞬切 */
:is([class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"]):not([class*="dsh-webui-"]) {
  transition: background-color 160ms ease;
}
/* 滑动高亮层与其宿主（role=tree 即官方滚动列表容器）：宿主建立局部
 * stacking context，让高亮层 z-index:-1 落在容器背景之上、行内容之下。 */
[role="tree"].${HOST_CLASS} {
  position: relative;
  z-index: 0;
}
.${PILL_CLASS} {
  position: absolute;
  left: 0;
  width: 100%;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover);
  pointer-events: none;
  opacity: 0;
  z-index: -1;
}
/* 滑动接管期：新行官方底色暂时透明（结束后无缝交还），并停用其底色过渡 */
[role="treeitem"].${TAKING_CLASS} {
  background: transparent !important;
  transition: none !important;
}
/* 尊重系统「减弱动态效果」偏好 */
@media (prefers-reduced-motion: reduce) {
  [data-conversation-scroll] :is([class*="viewArea"], [class*="composerHero"]),
  div:has(> [data-conversation-scroll]) > :not([data-conversation-scroll]) {
    animation: none;
  }
  :is([class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"]),
  [role="treeitem"].${TAKING_CLASS} {
    transition: none !important;
  }
}
`

/** 幂等注入样式表；返回移除函数。 */
function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.dataset.plugin = 'dsh-webui'
    style.textContent = CSS
    document.head.appendChild(style)
  }
  return () => { style?.remove() }
}

/** 当前是否应禁用动画（系统减弱动态效果偏好）。 */
function motionReduced(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

// ── 侧边栏选中高亮滑动 ────────────────────────────────────────────────────
// 仅一个实例（幂等装配）：MutationObserver 监听 aria-selected 变化 →
// FLIP：高亮层从上一选中行位置滑向新行；动画期间新行官方底色由
// TAKING 类透明化，结束无缝交还。

let installed = false
let pill: HTMLDivElement | null = null
let lastSelectedRow: Element | null = null
let activeSlide: Animation | null = null
let selectedObserver: MutationObserver | null = null

/** 高亮层相对宿主（滚动列表）内容系的 top。 */
function pillTopOf(row: Element, host: HTMLElement): number {
  const rowRect = row.getBoundingClientRect()
  const hostRect = host.getBoundingClientRect()
  // 宿主是滚动容器：absolute 子元素定位在内容坐标系，补上滚动偏移。
  return rowRect.top - hostRect.top + host.scrollTop
}

/** 结束一次滑动：交还官方底色、熄灭高亮层。 */
function settleSlide(): void {
  document.querySelectorAll(`.${TAKING_CLASS}`).forEach(el => el.classList.remove(TAKING_CLASS))
  if (pill !== null) pill.style.opacity = '0'
}

/**
 * 从 fromRect 滑到 toRow：设置高亮层并播放动画；fromRect 为 null 时原地淡入。
 * 进行中的旧滑动会被取消并以高亮层当前位置为新起点，连续点击依然连贯。
 */
function slideTo(toRow: HTMLElement): void {
  const host = toRow.closest<HTMLElement>('[role="tree"]')
  if (host === null) { settleSlide(); return }
  if (!host.classList.contains(HOST_CLASS)) host.classList.add(HOST_CLASS)
  if (pill === null || pill.parentElement !== host) {
    pill?.remove()
    pill = document.createElement('div')
    pill.className = PILL_CLASS
    host.appendChild(pill)
  }
  activeSlide?.cancel()
  activeSlide = null

  const toTop = pillTopOf(toRow, host)
  const toHeight = toRow.getBoundingClientRect().height
  toRow.classList.add(TAKING_CLASS)

  const fromTop = lastSelectedRow?.isConnected === true && lastSelectedRow.closest('[role="tree"]') === host
    ? pillTopOf(lastSelectedRow, host)
    : null
  const fromHeight = fromTop !== null ? lastSelectedRow!.getBoundingClientRect().height : toHeight

  pill.style.opacity = '1'
  const frames: Keyframe[] = fromTop === null
    ? [{ top: `${toTop}px`, height: `${toHeight}px`, opacity: 0 }, { opacity: 1 }]
    : [
      { top: `${fromTop}px`, height: `${fromHeight}px`, opacity: 1 },
      { top: `${toTop}px`, height: `${toHeight}px`, opacity: 1 },
    ]
  const anim = pill.animate(frames, { duration: fromTop === null ? 160 : SLIDE_DURATION, easing: SLIDE_EASING })
  activeSlide = anim
  anim.finished.finally(() => {
    if (activeSlide === anim) {
      activeSlide = null
      settleSlide()
    }
  }).catch(() => { /* 被 cancel 时吞掉 */ })
}

function onSelectionChanged(): void {
  const next = document.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]')
  if (next === null || next === lastSelectedRow) return
  const prev = lastSelectedRow
  lastSelectedRow = next
  if (motionReduced()) return
  void prev
  slideTo(next)
}

/** 装配侧边栏高亮滑动（幂等）。返回拆卸函数。 */
function installHighlightSlide(): () => void {
  if (installed || typeof MutationObserver === 'undefined') return () => {}
  installed = true
  lastSelectedRow = document.querySelector('[role="treeitem"][aria-selected="true"]')
  selectedObserver = new MutationObserver(onSelectionChanged)
  selectedObserver.observe(document.body, { attributes: true, attributeFilter: ['aria-selected'], subtree: true })
  return () => {
    selectedObserver?.disconnect()
    selectedObserver = null
    activeSlide?.cancel()
    activeSlide = null
    settleSlide()
    document.querySelectorAll(`.${HOST_CLASS}`).forEach(el => el.classList.remove(HOST_CLASS))
    pill?.remove()
    pill = null
    lastSelectedRow = null
    installed = false
  }
}

/**
 * 装配会话切换柔和过渡（幂等注入样式 + 侧边栏高亮滑动）。
 * @returns 停止函数：移除注入样式与高亮层。
 */
export function applySessionSwitchMotion(): () => void {
  const removeStyles = injectStyles()
  const removeSlide = motionReduced() ? () => {} : installHighlightSlide()
  return () => {
    removeStyles()
    removeSlide()
  }
}
