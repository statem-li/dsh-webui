/**
 * dsh-webui — 移动端全局覆盖（触控目标/输入字号/头部收起/消息窄胶囊等）。
 *
 * 与 responsive.ts 分工：
 *   - responsive.ts 管「宿主设置面板单列化 + 对话框全屏」这类插件自身 CSS 覆盖不了的行为；
 *   - 本文件管「插件自有组件（view-tile/trigger/psh-close/消息条/正文）」在窄屏的
 *     触控目标、字号、safe-area、点击反馈，以及输入框属性兜底（JS setAttribute）。
 *
 * 红线 A：以下所有注入注释均未写出「星号紧跟正斜杠」两字符序列（风险处仅用文字描述）。
 * 红线 B：输入框属性兜底在设置成功后立即停止 MutationObserver，避免逐 token 空转。
 * 红线 C：全部规则包 @media (max-width: 767.98px) 或 (prefers-reduced-motion: reduce)，
 *         不写任何媒体外的全局选择器，避免桌面回归与宿主 DragHandle 被误伤。
 */

const STYLE_ID = 'dsh-webui-mobile-overrides'

/** 幂等注入一段样式；返回移除函数。与 injectResponsiveStyles() 套路一致。 */
function ensureStyle(id: string, css: string): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(id) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = id
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/mobile-overrides'
    tag.textContent = css
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

const SHEET = `
@media (max-width: 767.98px) {
  /* ── 触控目标：关键按钮提到触碰基线（至少 44px 高命中区） ── */
  .webui-view-tile,
  .webui-trigger,
  .webui-trigger-badge,
  .psh-close {
    min-height: 44px;
  }
  .webui-view-tile,
  .webui-trigger {
    min-width: 44px;
  }

  /* ── 正文/输入字号：不小于 16px，防 iOS 聚焦键盘自动放大页面 ── */
  [data-conversation-scroll] [class*="body"],
  [data-composer-seat] {
    font-size: clamp(16px, 4vmin, 17px);
  }
  [data-input-scroll] textarea {
    font-size: 16px !important;
    line-height: 1.45;
  }

  /* ── 会话头部 titleRow：去掉为右上按钮组预留的 100px，改 8px ── */
  [data-slot="conversation.session.header"] [class*="titleRow"] {
    padding-right: 8px !important;
    min-height: 44px;
  }
  /* 右上按钮组允许换行 + 右对齐，避免与标题重叠（若真机重叠再回退，见 P-B4） */
  [data-slot="conversation.session.header"] [class*="webui-host"] {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* ── 全局点击反馈：按钮/图块按下轻微缩放 + 背景变化 ── */
  .webui-view-tile,
  .webui-trigger,
  .psh-close,
  .webui-panel button {
    transition: transform 120ms ease, background-color 120ms ease;
  }
  .webui-view-tile:active,
  .webui-trigger:active,
  .psh-close:active,
  .webui-panel button:active {
    transform: scale(.96);
  }

  /* ── 「消息」扁平条：极简模式演进为彻底隐藏（用户拍板；见 mobile-minimal.ts 规则 6）。
     本文件保留一条隐性同步——.webui-panel 直接 display:none；真正的 !important
     版本由 mobile-minimal.ts 接管（双保险可接受）。红线 A：注释内未写出「星号+
     斜杠」两字符序列，风险仅用文字描述。 ── */
  .webui-panel {
    display: none;
  }

  /* ── touch-action：仅对交互/滚动容器，避免拖拽 handle 被误伤（宿主 DragHandle 为 touch-action:none） ── */
  [data-conversation-scroll] *,
  [data-composer-card] {
    touch-action: manipulation;
  }

  /* ── 全屏 sheet 底部 safe-area 内边距（仅此一条，勿在媒体外重复） ── */
  .psh-card[data-mode="sheet"] {
    padding-bottom: var(--webui-safe-bottom, 0px);
  }
}

/* ── 动效降级：所有过渡/缩放动画在用户偏好减少动态时直接到终态 ── */
@media (prefers-reduced-motion: reduce) {
  .webui-view-tile,
  .webui-trigger,
  .psh-close,
  .webui-panel button {
    transition: none !important;
  }
  .webui-view-tile:active,
  .webui-trigger:active,
  .psh-close:active,
  .webui-panel button:active {
    transform: none !important;
  }
}
`

/** 注入全局移动端覆盖；返回移除函数。 */
export function injectMobileOverrides(): () => void {
  return ensureStyle(STYLE_ID, SHEET)
}

/**
 * 输入框属性兜底：为宿主 textarea 补齐 inputmode/enterkeyhint/autocomplete。
 * 这些是「属性」而非样式，CSS 无法修改，只能用 JS setAttribute 补。
 * 红线 B：textarea 是常驻节点（已核实跨 draft 复用、不随 draft 重挂），
 * 设置成功后立即断开 observer，避免后续逐 token 的 DOM 变更反复触发
 * querySelector+hasAttribute 空转。
 */
export function applyMobileInputAttributes(): () => void {
  if (typeof document === 'undefined') return () => {}
  let disposed = false
  let mo: MutationObserver | null = null
  const mark = 'data-webui-input-attrs'
  const apply = (): void => {
    if (disposed) return
    const ta = document.querySelector<HTMLTextAreaElement>('[data-input-scroll] textarea')
    if (!ta || ta.hasAttribute(mark)) return
    ta.setAttribute('inputmode', 'text')
    ta.setAttribute('enterkeyhint', 'send')
    ta.setAttribute('autocomplete', 'off')
    ta.setAttribute(mark, '1')
    // 设置成功后立即停止观察（红线 B：避免逐 token DOM 变更反复空转）。
    mo?.disconnect()
  }
  // 先建 observer 再 apply：首次若命中 textarea，disconnect 立即生效。
  mo = new MutationObserver(() => apply())
  mo.observe(document.body, { childList: true, subtree: true })
  apply()
  return () => { disposed = true; mo?.disconnect() }
}
