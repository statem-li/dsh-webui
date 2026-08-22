/**
 * session-pin — 样式注入（client 半身）。
 *
 * 选择器全部基于稳定的 CSS Modules 后缀（`sessionRow` / `rowActions` /
 * `iconButton` / `title`），哈希前缀随构建变化、后缀不变（与 session-motion
 * 同一 DOM 契约）。注入随插件生命周期清理。
 */

/** 注入样式节点 id（幂等标记）。 */
const STYLE_ID = 'dsh-webui-session-pin-styles'

const SHEET = `
/* ===== dsh-webui 会话置顶 / 归档按钮 / 右键菜单 ===== */

/* 1) 会话行的三个点按钮让位给归档按钮：隐藏官方 ellipsis 触发钮。
   （右键菜单已接管完整操作入口，行内只保留一键归档。） */
[class*="sessionRow"] [class*="rowActions"] [class*="iconButton"] {
  display: none !important;
}

/* 2) 行内归档按钮：与官方 iconButton 同款几何（16px，tertiary → hover primary）。 */
.dsp-archive-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 4px;
  padding: 0;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsp-archive-btn:hover {
  color: var(--dsw-alias-label-primary, #eee);
}

/* 3) 置顶标记：标题前的图钉，品牌蓝。 */
.dsp-pin-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 2px;
  margin-right: 2px;
  color: var(--dsw-alias-state-business-primary, #4176e6);
}

/* 4) 右键菜单：贴合 DSH Menu 观感 + 磨砂玻璃底。
   backdrop-filter 直加在浮层本体（本卡 portal 到 body，非布局容器）；
   底色用 color-mix 从主题菜单色派生 76% 半透明，深/浅主题与玻璃质感
   token 都自动适配，模糊透出背后内容。 */
.dsp-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 998;
}
.dsp-menu {
  position: fixed;
  z-index: 999;
  min-width: 160px;
  box-sizing: border-box;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14));
  border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #16181d)) 76%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(1.6);
  backdrop-filter: blur(18px) saturate(1.6);
  box-shadow: var(--dsw-shadow-lv3, 0 8px 40px rgba(0,0,0,.5));
  user-select: none;
}
.dsp-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #eee);
  font-size: 13px;
  line-height: 18px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.dsp-menu-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06));
}
.dsp-menu-item[data-danger='true'] {
  color: var(--dsw-alias-state-error-primary, #f0524d);
}
.dsp-menu-item[data-danger='true']:hover {
  background: var(--dsw-alias-state-error-hover, rgba(240,82,77,.12));
}
.dsp-menu-item > svg {
  flex: none;
  color: var(--dsw-alias-label-secondary, #bbb);
}
.dsp-menu-item[data-danger='true'] > svg {
  color: var(--dsw-alias-state-error-primary, #f0524d);
}
.dsp-menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--dsw-alias-border-l1, rgba(255,255,255,.08));
}

/* 5) 重命名弹窗：居中浮层 + 输入框 + 胶囊按钮。 */
.dsp-rename-mask {
  position: fixed;
  inset: 0;
  z-index: 998;
  background: var(--dsw-alias-bg-mask-1, rgba(0,0,0,.45));
}
.dsp-rename-card {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 999;
  width: min(360px, calc(100vw - 40px));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 18px 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14));
  border-radius: 14px;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #16181d));
  box-shadow: var(--dsw-shadow-lv3, 0 8px 40px rgba(0,0,0,.5));
}
.dsp-rename-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  color: var(--dsw-alias-label-primary, #eee);
}
.dsp-rename-input {
  height: 32px;
  box-sizing: border-box;
  padding: 0 10px;
  font-size: 14px;
  line-height: 22px;
  font-family: inherit;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14));
  background: var(--dsw-alias-bg-layer-1, #101216);
  color: var(--dsw-alias-label-primary, #eee);
  outline: none;
}
.dsp-rename-input:focus {
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
}
.dsp-rename-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.dsp-rename-btn {
  height: 30px;
  padding: 0 16px;
  border: none;
  border-radius: 15px;
  font-size: 13px;
  line-height: 18px;
  font-family: inherit;
  cursor: pointer;
}
.dsp-rename-btn[data-kind='ghost'] {
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14));
  color: var(--dsw-alias-label-primary, #eee);
}
.dsp-rename-btn[data-kind='primary'] {
  background: var(--dsw-alias-state-business-primary, #4176e6);
  color: #ffffff;
}
.dsp-rename-btn[data-kind='primary']:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 6) 置顶补行：折叠窗口顶部自绘的置顶会话行（图钉 + 标题），
   高度/圆角/内边距与官方会话行一致。 */
.dsp-pin-surrogates {
  padding: 2px 0;
}
.dsp-pin-surrogate {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  box-sizing: border-box;
  padding: 0 8px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--dsw-alias-label-primary, #eee);
}
.dsp-pin-surrogate:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06));
}
.dsp-pin-surrogate-selected,
.dsp-pin-surrogate-selected:hover {
  background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,.1));
}
.dsp-pin-surrogate-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-state-business-primary, #4176e6);
}
.dsp-pin-surrogate [data-role="title"] {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 20px;
}

@media (prefers-reduced-motion: reduce) {
  .dsp-menu, .dsp-rename-card { transition: none; }
}
`

/** 注入置顶/归档/右键菜单样式（幂等）；返回移除函数。 */
export function injectSessionPinStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.dataset.plugin = '@dsh-external/dsh-webui'
    style.dataset.pluginCss = 'webui/session-pin'
    style.textContent = SHEET
    document.head.appendChild(style)
  }
  return () => { style?.remove() }
}
