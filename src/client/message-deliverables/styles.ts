/**
 * message-deliverables — 产物大卡片样式（运行时注入 <style>，卸载时由 loader
 * 清理）。类名前缀 wdv-；颜色走 DSH 主题令牌(--dsw-alias-*)。
 * ⚠ 结构类避开 "modal"/"panel"/"drawer" 子串（玻璃主题浮层总选择器按子串
 * 匹配，误伤的结构层会被叠出「多层卡片」）；弹窗本体复用 fe-modal-dialog
 * （含 "modal"，正确获得标准毛玻璃）。
 */

export const css = {
  listPane: 'wdv-list',
  item: 'wdv-item',
  itemTop: 'wdv-item-top',
  itemName: 'wdv-item-name',
  itemTime: 'wdv-item-time',
  itemOpen: 'wdv-item-open',
  split: 'wdv-split',
  view: 'wdv-view',
  viewInner: 'wdv-view-inner',
  viewPath: 'wdv-view-path',
  status: 'wdv-status',
  statusError: 'wdv-status-error',
  imageStage: 'wdv-image-stage',
  imageEl: 'wdv-image-el',
  mdBody: 'wdv-md-body',
  textHost: 'wdv-text-host',
  hexDump: 'wdv-hex-dump',
  footPath: 'wdv-foot-path',
  footLink: 'wdv-foot-link',
} as const

const STYLE_ID = 'dsh-webui-deliverables-styles'

const SHEET = `
.wdv-split{display:flex;gap:14px;width:100%;height:min(64vh,660px);min-height:0}

/* ── 左栏：文件清单 ─────────────────────────────────────────────────── */
.wdv-list{flex:none;width:232px;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding-right:2px}
/* 右侧为「用文件浏览器打开」图标预留 30px：图标绝对定位钉在卡片右缘 */
.wdv-item{position:relative;display:flex;flex-direction:column;gap:1px;width:100%;box-sizing:border-box;padding:7px 34px 7px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;background:transparent;cursor:pointer;text-align:left;font-family:inherit}
.wdv-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.wdv-item[data-active='true']{border-color:var(--dsw-alias-state-business-primary,#4a9eff);background:rgba(74,158,255,.1)}
.wdv-item-top{display:flex;align-items:center;gap:6px;min-width:0}
.wdv-item-name{flex:1;min-width:0;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 「用文件浏览器打开」小图标：钉在卡片右上角右缘；默认低调，hover 点亮 */
.wdv-item-open{position:absolute;top:50%;right:7px;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;border-radius:6px;padding:0;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer}
.wdv-item-open:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-state-business-primary,#4a9eff)}
.wdv-item-time{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);padding-right:24px}

/* ── 右栏：预览体（内容区滚动 + 底部固定路径条）────────────────────── */
.wdv-view-inner{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto}
.wdv-view-path{flex:none;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);word-break:break-all;text-align:left}
.wdv-view{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;background:var(--dsw-alias-bg-base,#0e1116)}
.wdv-status{margin:auto;padding:20px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888)}
.wdv-status-error{color:var(--dsw-alias-state-error-primary,#e0434b)}
/* 图片：棋盘底衬透明区，适应窗口展示 */
.wdv-image-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:14px;background:conic-gradient(var(--dsw-alias-bg-layer-1,#1c1f26) 0 25%,var(--dsw-alias-bg-module,#22252c) 0 50%,var(--dsw-alias-bg-layer-1,#1c1f26) 0 75%,var(--dsw-alias-bg-module,#22252c) 0) 0 0/24px 24px}
.wdv-image-el{max-width:100%;max-height:100%;border-radius:4px}
/* markdown 渲染视图 */
.wdv-md-body{padding:4px 18px 14px;font-size:14px;line-height:1.7;color:var(--dsw-alias-label-primary,#eee)}
.wdv-md-body pre{max-width:100%;overflow-x:auto}
/* 文本/代码：CodeMirror 只读铺满 */
.wdv-text-host{flex:1;min-width:0;min-height:0}
.wdv-text-host .cm-editor{height:100%;background:transparent}
.wdv-text-host .cm-scroller{font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace;font-size:13px;line-height:1.6;overflow:auto}
/* 二进制 hex 兜底 */
.wdv-hex-dump{margin:0;padding:12px 14px;font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre;tab-size:2;color:var(--dsw-alias-label-secondary,#bbb)}

/* footer 左侧完整路径 */
.wdv-foot-path{flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
/* footer 下载链接（对齐 fe-download-link 的胶囊小钮） */
.wdv-foot-link{flex:none;display:inline-flex;align-items:center;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:14px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary,#eee);font-size:12px;line-height:18px;text-decoration:none}
.wdv-foot-link:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}

/* 玻璃质感：去实色底，避免「模糊之上蒙厚纱」（同 file-explorer 做法） */
html[data-dsh-glass] .wdv-view{background-color:transparent}
html[data-dsh-glass] .wdv-image-stage{background:none;background-color:rgba(255,255,255,.05)}
html[data-dsh-glass] body[data-ds-dark-theme] .wdv-image-stage{background-color:rgba(255,255,255,.04)}

/* 移动端：卡片加高、左栏收窄 */
@media (max-width: 767.98px) {
  .wdv-split{height:min(72vh,640px)}
  .wdv-list{width:170px}
}

@media (prefers-reduced-motion: reduce) {
  .fe-modal-dialog,.fe-pop-closing .fe-modal-dialog,.fe-pop-mask,.fe-pop-closing .fe-pop-mask{animation:none!important}
}
`

/** 注入样式表（幂等；loader 卸载插件时会移除其 style 标签）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
