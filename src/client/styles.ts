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
} as const

const STYLE_ID = 'dsh-webui-styles'

const SHEET = `
/* 视图图块 + 消息按钮一行（右上角 utilities 区，与 Session log 同行） */
.webui-host{display:flex;align-items:center;gap:8px;position:relative;flex:none}
/* 图块按钮（对话/轨迹） */
.webui-view-tile{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-tertiary,#888);font-size:13px;line-height:16px;font-weight:500;cursor:pointer;white-space:nowrap;transition:border-color .12s,color .12s,background .12s,box-shadow .12s}
.webui-view-tile:hover{border-color:var(--dsw-alias-border-l1,#555);color:var(--dsw-alias-label-primary,#ddd)}
.webui-view-tile-active{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 12%,transparent)}
.webui-view-tile-active:hover{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff)}
/* 隐藏原生「对话/轨迹」标签页行（视图切换改由右上角图块接管） */
[data-slot="conversation.session.header"] [role="tablist"]{display:none}
/* 原生标签页行移除后 header 变矮，补底部留白避免图块贴住分割线 */
[data-slot="conversation.session.header"] > header{padding-bottom:10px}
/* 消息数量按钮（内联，仅数量徽标） */
.webui-trigger{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 2px;border:none;background:transparent;cursor:pointer}
.webui-trigger-badge{flex:0 0 auto;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--dsw-alias-state-business-primary,#4a9eff);color:#fff;font-size:11px;line-height:20px;text-align:center;font-weight:600;transition:transform 120ms, box-shadow 120ms}
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
/* 无背景横条面板：只显示横条本身；无滚动条（超出由滚轮平滑滚动） */
.webui-panel{position:fixed;z-index:1100;padding:6px 8px;overflow:hidden;cursor:default;touch-action:none;user-select:none;background:transparent}
.webui-scroller{display:flex;flex-direction:column;gap:2px;will-change:transform}
.webui-row{width:100%;height:18px;display:flex;align-items:center;justify-content:flex-end;flex:0 0 auto}
.webui-bar{display:block;width:15px;height:5px;padding:0;border:none;border-radius:3px;background:var(--dsw-alias-scrollbar-bg-l2,#667085);opacity:.6;cursor:pointer;flex:0 0 auto;transition:width .16s ease,background .12s,opacity .12s}
.webui-bar:hover{opacity:1;background:var(--dsw-alias-scrollbar-hover-l2,#8a94a8)}
.webui-bar-active{width:23px;background:var(--dsw-alias-state-business-primary,#4a9eff);opacity:1;box-shadow:0 0 6px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 55%,transparent)}
.webui-bar-active:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 78%,#fff)}
.webui-tip{position:fixed;z-index:1300;width:300px;max-height:180px;display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;background:var(--dsw-specific-tip,var(--dsw-alias-bg-layer-3,#1b1e24));box-shadow:var(--dsw-shadow-lv2,0 4px 20px rgba(0,0,0,.4));pointer-events:none;overflow:hidden}
.webui-tip-head{display:flex;gap:8px;align-items:baseline;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd);white-space:nowrap}
.webui-tip-meta{color:var(--dsw-alias-label-tertiary,#888);font-weight:400;font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace)}
.webui-tip-body{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical}
.webui-flash{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px;border-radius:8px;animation:webui-flash-pulse 2.4s ease-out}
@keyframes webui-flash-pulse{0%{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 22%,transparent)}60%{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 10%,transparent)}100%{background:transparent}}
`

let injected = false

/** 注入全局样式（幂等）；返回移除函数。 */
export function injectStyles(): () => void {
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/webui'
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
