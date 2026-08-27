/**
 * webui — 会话 Web UI 插件样式（运行时注入 <style>，卸载时移除）。
 * 类名前缀 webui-；颜色走 DSH 主题令牌（--dsw-alias-*），缺省兜底深色值。
 */

export const css = {
  host: 'webui-host',
  viewTile: 'webui-view-tile',
  viewTileActive: 'webui-view-tile-active',
  trigger: 'webui-trigger',
  triggerBadge: 'webui-trigger-badge',
  popup: 'webui-popup',
  popupHead: 'webui-popup-head',
  popupList: 'webui-popup-list',
  item: 'webui-item',
  itemIndex: 'webui-item-index',
  itemMeta: 'webui-item-meta',
  itemText: 'webui-item-text',
  loadOlder: 'webui-load-older',
  panel: 'webui-panel',
  scroller: 'webui-scroller',
  row: 'webui-row',
  bar: 'webui-bar',
  barActive: 'webui-bar-active',
  tip: 'webui-tip',
  tipHead: 'webui-tip-head',
  tipMeta: 'webui-tip-meta',
  tipBody: 'webui-tip-body',
  flash: 'webui-flash',
  providerBadge: 'webui-provider-badge',
  shotBtn: 'webui-shot-btn',
  shotBtnBusy: 'webui-shot-btn-busy',
  shotPopup: 'webui-shot-popup',
  shotPopupHead: 'webui-shot-popup-head',
  shotPopupBody: 'webui-shot-popup-body',
  shotImg: 'webui-shot-img',
  shotPath: 'webui-shot-path',
  shotActions: 'webui-shot-actions',
  shotAction: 'webui-shot-action',
  shotPrimary: 'webui-shot-primary',
  shotError: 'webui-shot-error',
  exportFrame: 'webui-export-frame',
} as const

const STYLE_ID = 'dsh-webui-styles'

const SHEET = `
/* 视图图块 + 消息按钮一行（右上角 utilities 区，与 Session log 同行） */
.webui-host{display:flex;align-items:center;gap:8px;position:relative;flex:none}
/* 图块按钮（对话/轨迹）：无外圈线条、无底色（与消息数字按钮同风格）；
   选中态用蓝色光影（辉光 + 淡蓝底），hover 提亮文字 */
.webui-view-tile{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,#888);font-size:13px;line-height:16px;font-weight:500;cursor:pointer;white-space:nowrap;transition:color .12s,background .12s,box-shadow .12s,transform 120ms}
.webui-view-tile:hover{color:var(--dsw-alias-label-primary,#ddd)}
.webui-view-tile-active{color:var(--dsw-alias-state-business-primary,#4a9eff);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 12%,transparent);box-shadow:0 0 10px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 45%,transparent)}
.webui-view-tile-active:hover{color:var(--dsw-alias-state-business-primary,#4a9eff)}
/* 对话完成胶囊的样式已移入 client/done-pill.tsx 自注入的 <style
 * id="dsh-done-pill-css">：本表（dsh-webui-styles）由 Webui.tsx 在**会话视图**
 * 内挂载才注入，而胶囊是 shell.overlay 全局常驻的——放在这里会导致首页/无
 * 会话时胶囊完全没有样式（透明无底无边，浅色主题下等于看不见）。 */
/* 右上角按钮组（对话/轨迹/消息/Session log）左移：titleRow 右侧 padding 让出空间，flex:1 的标题区自动收缩（200-100=100px 净左移） */
[data-slot="conversation.session.header"] [class*="titleRow"]{padding-right:100px}
/* 原生标签页行移除后 header 变矮，补底部留白避免图块贴住分割线 */
[data-slot="conversation.session.header"] > header{padding-bottom:10px}
/* 原生「对话/轨迹」标签行隐藏：右上角图块已接管视图切换（selectView 触发原生
   tab 的 click、readTabs 经 MutationObserver 读 aria-selected），DOM 必须保留，
   仅去掉主题下方的重复入口 */
[data-slot="conversation.session.header"] [role="tablist"]{display:none}
/* 供应商标签（模型选择器旁） */
.webui-provider-badge{display:inline-flex;align-items:center;height:22px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:11px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-secondary,#bbb);font-size:12px;line-height:1;white-space:nowrap}
/* 消息数量按钮（内联，仅数量徽标） */
.webui-trigger{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 2px;border:none;background:transparent;cursor:pointer}
.webui-trigger-badge{flex:0 0 auto;min-width:22px;height:22px;padding:0 7px;border-radius:11px;background:var(--dsw-alias-state-business-primary,#4a9eff);color:#0d3b6e;font-size:13px;line-height:22px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.02em;transition:transform 120ms, box-shadow 120ms}
.webui-trigger:hover .webui-trigger-badge{transform:scale(1.1);box-shadow:0 0 8px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 60%,transparent)}
.webui-trigger[aria-expanded="true"] .webui-trigger-badge{transform:scale(1.1)}
.webui-popup{position:fixed;z-index:1200;width:min(420px, calc(100vw - 24px));max-height:min(480px, 60vh);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 32px rgba(0,0,0,.45));overflow:hidden}
.webui-popup-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd);border-bottom:1px solid var(--dsw-alias-border-l3,#2a2d35)}
.webui-popup-head small{color:var(--dsw-alias-label-tertiary,#888);font-weight:400}
.webui-popup-list{overflow-y:auto;overscroll-behavior:contain;padding:6px;display:flex;flex-direction:column;gap:2px}
.webui-popup-list::-webkit-scrollbar{width:8px}
.webui-popup-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,#333);border-radius:4px}
.webui-item{display:grid;grid-template-columns:34px 84px 1fr;gap:8px;align-items:baseline;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#ddd);text-align:left;cursor:pointer;font:inherit;font-size:12px;line-height:1.5}
.webui-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.webui-item-index{color:var(--dsw-alias-label-tertiary,#888);font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace);font-size:11px}
.webui-item-meta{color:var(--dsw-alias-label-tertiary,#888);font-size:11px;white-space:nowrap}
.webui-item-text{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;color:var(--dsw-alias-label-secondary,#bbb)}
.webui-load-older{margin:4px 6px 2px;padding:6px 10px;border:1px dashed var(--dsw-alias-border-l2,#333);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:11px;cursor:pointer}
.webui-load-older:hover{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff)}
.webui-load-older:disabled{opacity:.5;cursor:default}
/* 无背景横条面板：只显示横条本身；无滚动条（超出由滚轮平滑滚动）。
   整个面板指针穿透（pointer-events:none），热区只剩横条本身（.webui-bar 重新
   开启 auto）——右侧空白区域不拦截滚轮/点击，全部落到对话区。 */
.webui-panel{position:fixed;z-index:1100;padding:6px 8px;overflow:hidden;background:transparent;pointer-events:none}
.webui-scroller{display:flex;flex-direction:column;gap:2px;will-change:transform}
.webui-row{width:100%;height:18px;display:flex;align-items:center;justify-content:flex-end;flex:0 0 auto;pointer-events:none}
.webui-bar{display:block;width:15px;height:5px;padding:0;border:none;border-radius:3px;background:var(--dsw-alias-scrollbar-bg-l2,#667085);opacity:.6;cursor:pointer;flex:0 0 auto;transition:width .16s ease,background .12s,opacity .12s;pointer-events:auto}
.webui-bar:hover{opacity:1;background:var(--dsw-alias-scrollbar-hover-l2,#8a94a8)}
.webui-bar-active{width:23px;background:var(--dsw-alias-state-business-primary,#4a9eff);opacity:1;box-shadow:0 0 6px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 55%,transparent)}
.webui-bar-active:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 78%,#fff)}
.webui-tip{position:fixed;z-index:1300;width:300px;max-height:180px;display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;background:var(--dsw-specific-tip,var(--dsw-alias-bg-layer-3,#1b1e24));box-shadow:var(--dsw-shadow-lv2,0 4px 20px rgba(0,0,0,.4));pointer-events:none;overflow:hidden}
.webui-tip-head{display:flex;gap:8px;align-items:baseline;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd);white-space:nowrap}
.webui-tip-meta{color:var(--dsw-alias-label-tertiary,#888);font-weight:400;font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace)}
.webui-tip-body{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical}
.webui-flash{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px;border-radius:8px;animation:webui-flash-pulse 2.4s ease-out}
@keyframes webui-flash-pulse{0%{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 22%,transparent)}60%{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 10%,transparent)}100%{background:transparent}}
/* 对话截图按钮 + 预览弹窗 */
.webui-shot-btn{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:none;border-radius:28px;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;transition:color .12s,background .12s}
.webui-shot-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#bbb)}
.webui-shot-btn-busy{opacity:.6;cursor:default;pointer-events:none;animation:webui-shot-spin 1s linear infinite}
@keyframes webui-shot-spin{to{transform:rotate(360deg)}}
.webui-shot-popup{position:fixed;z-index:1400;width:min(calc(100vw - 40px),1200px);max-height:calc(100vh - 80px);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden}
.webui-shot-popup-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd);border-bottom:1px solid var(--dsw-alias-border-l3,#2a2d35)}
.webui-shot-popup-head small{color:var(--dsw-alias-label-tertiary,#888);font-weight:400}
.webui-shot-popup-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;padding:12px;display:flex;flex-direction:column;gap:10px}
.webui-shot-popup-body::-webkit-scrollbar{display:none}
.webui-shot-img{width:100%;height:auto;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#333);background:#fff;display:block}
.webui-shot-path{font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary,#888);word-break:break-all;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.02));padding:8px 10px;border-radius:8px}
.webui-shot-actions{display:flex;align-items:center;gap:8px}
.webui-shot-action{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:12px;cursor:pointer;transition:border-color .12s,color .12s}
.webui-shot-action:hover{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff)}
.webui-shot-primary{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 14px;border:1px solid transparent;border-radius:14px;background:var(--dsw-alias-button-primary-fill,#111);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:12px;font-weight:600;text-decoration:none;cursor:pointer;transition:opacity .12s}
.webui-shot-primary:hover{opacity:.86}
.webui-shot-error{font-size:12px;color:var(--dsw-alias-state-danger-primary,#f56c6c);line-height:1.5}
.webui-export-frame{width:100%;height:480px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;background:#fff;display:block}

/* ── 移动端：消息横条提示泡不超出屏幕 ─────────────────────────── */
@media (max-width: 767.98px) {
  .webui-tip{width:min(300px,calc(100vw - 16px))}

  /* ── P0-1 会话顶栏收纳 ───────────────────────────
     1) 标题行去掉为右上按钮组预留的 100px，改 8px（本表媒体外基础规则是 100px）；
     2) 图块/trigger/徽标提到 ≥44×44 触碰基线（用 min-height/min-width，
        不动 height，避免破坏行内布局）；桌面仍走 28/22px 紧凑形态；
     3) 右上按钮组允许换行 + 右对齐，避免窄屏标题与按钮重叠（真机回退见 P-B4）。 */
  [data-slot="conversation.session.header"] [class*="titleRow"]{
    padding-right:8px !important;
    min-height:44px;
  }
  [data-slot="conversation.session.header"] [class*="webui-host"]{
    flex-wrap:wrap;
    justify-content:flex-end;
  }
  .webui-view-tile,
  .webui-trigger,
  .webui-trigger-badge{
    min-width:44px;
    min-height:44px;
  }
}
`

let injected = false

/** 注入全局样式（幂等）；返回移除函数。 */
export function injectStyles(): () => void {
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/styles'
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
