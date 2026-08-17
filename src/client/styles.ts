/**
 * dsh-session-message-nav — 样式（运行时注入 <style>，卸载时移除）。
 * 类名前缀 smn-；颜色走 DSH 主题令牌（--dsw-alias-*），缺省兜底深色值。
 */

export const css = {
  host: 'smn-host',
  buttonWrap: 'smn-button-wrap',
  trigger: 'smn-trigger',
  triggerBadge: 'smn-trigger-badge',
  popup: 'smn-popup',
  popupHead: 'smn-popup-head',
  popupList: 'smn-popup-list',
  item: 'smn-item',
  itemIndex: 'smn-item-index',
  itemMeta: 'smn-item-meta',
  itemText: 'smn-item-text',
  loadOlder: 'smn-load-older',
  panel: 'smn-panel',
  scroller: 'smn-scroller',
  row: 'smn-row',
  bar: 'smn-bar',
  barActive: 'smn-bar-active',
  tip: 'smn-tip',
  tipHead: 'smn-tip-head',
  tipMeta: 'smn-tip-meta',
  tipBody: 'smn-tip-body',
  flash: 'smn-flash',
} as const

const STYLE_ID = 'dsh-session-message-nav-styles'

const SHEET = `
.smn-host{position:relative}
/* 按钮容器：fixed 锚定「对话/轨迹」标签页行右侧 */
.smn-button-wrap{position:fixed;z-index:1100}
/* 无包裹无文字：只有数量徽标 */
.smn-trigger{display:flex;align-items:center;justify-content:center;width:100%;height:28px;padding:0;border:none;background:transparent;cursor:pointer}
.smn-trigger-badge{flex:0 0 auto;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--dsw-alias-state-business-primary,#4a9eff);color:#fff;font-size:11px;line-height:20px;text-align:center;font-weight:600;transition:transform 120ms, box-shadow 120ms}
.smn-trigger:hover .smn-trigger-badge{transform:scale(1.1);box-shadow:0 0 8px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 60%,transparent)}
.smn-trigger[aria-expanded="true"] .smn-trigger-badge{transform:scale(1.1)}
.smn-popup{position:absolute;top:calc(100% + 8px);right:0;z-index:1200;width:min(420px, calc(100vw - 24px));max-height:min(480px, 60vh);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 32px rgba(0,0,0,.45));overflow:hidden}
.smn-popup-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd);border-bottom:1px solid var(--dsw-alias-border-l3,#2a2d35)}
.smn-popup-head small{color:var(--dsw-alias-label-tertiary,#888);font-weight:400}
.smn-popup-list{overflow-y:auto;overscroll-behavior:contain;padding:6px;display:flex;flex-direction:column;gap:2px}
.smn-popup-list::-webkit-scrollbar{width:8px}
.smn-popup-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,#333);border-radius:4px}
.smn-item{display:grid;grid-template-columns:34px 84px 1fr;gap:8px;align-items:baseline;padding:8px 10px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#ddd);text-align:left;cursor:pointer;font:inherit;font-size:12px;line-height:1.5}
.smn-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.smn-item-index{color:var(--dsw-alias-label-tertiary,#888);font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace);font-size:11px}
.smn-item-meta{color:var(--dsw-alias-label-tertiary,#888);font-size:11px;white-space:nowrap}
.smn-item-text{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;color:var(--dsw-alias-label-secondary,#bbb)}
.smn-load-older{margin:4px 6px 2px;padding:6px 10px;border:1px dashed var(--dsw-alias-border-l2,#333);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:11px;cursor:pointer}
.smn-load-older:hover{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff)}
.smn-load-older:disabled{opacity:.5;cursor:default}
/* 无背景面板：只显示横条本身；无滚动条（超出由滚轮平滑滚动） */
.smn-panel{position:fixed;z-index:1100;padding:6px 8px;overflow:hidden;cursor:default;touch-action:none;user-select:none;background:transparent}
.smn-scroller{display:flex;flex-direction:column;gap:2px;will-change:transform}
/* 每行固定高度（18px）：横条紧凑排列 */
.smn-row{width:100%;height:18px;display:flex;align-items:center;justify-content:flex-end;flex:0 0 auto}
/* 横条：15px 宽细短线，无文字；不在阅读位置 = 灰色（15px），
   当前阅读位置（active）= 蓝色且加宽 1.5 倍（23px） */
.smn-bar{display:block;width:15px;height:5px;padding:0;border:none;border-radius:3px;background:var(--dsw-alias-scrollbar-bg-l2,#667085);opacity:.6;cursor:pointer;flex:0 0 auto;transition:width .16s ease,background .12s,opacity .12s}
.smn-bar:hover{opacity:1;background:var(--dsw-alias-scrollbar-hover-l2,#8a94a8)}
.smn-bar-active{width:23px;background:var(--dsw-alias-state-business-primary,#4a9eff);opacity:1;box-shadow:0 0 6px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 55%,transparent)}
.smn-bar-active:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 78%,#fff)}
/* 悬停横条 → 对应消息内容浮层 */
.smn-tip{position:fixed;z-index:1300;width:300px;max-height:180px;display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;background:var(--dsw-specific-tip,var(--dsw-alias-bg-layer-3,#1b1e24));box-shadow:var(--dsw-shadow-lv2,0 4px 20px rgba(0,0,0,.4));pointer-events:none;overflow:hidden}
.smn-tip-head{display:flex;gap:8px;align-items:baseline;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd);white-space:nowrap}
.smn-tip-meta{color:var(--dsw-alias-label-tertiary,#888);font-weight:400;font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace)}
.smn-tip-body{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical}
.smn-flash{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px;border-radius:8px;animation:smn-flash-pulse 2.4s ease-out}
@keyframes smn-flash-pulse{0%{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 22%,transparent)}60%{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 10%,transparent)}100%{background:transparent}}
`

let injected = false

/** 注入全局样式（幂等）；返回移除函数。 */
export function injectStyles(): () => void {
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-session-message-nav'
    tag.dataset.pluginCss = 'dsh-session-message-nav/styles'
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
