/**
 * dsh-file-explorer — 样式(运行时注入 <style>,卸载时由 loader 清理)。
 * 类名前缀 fe-;颜色走 DSH 主题令牌(--dsw-alias-*,定义在 body 上)。
 */

export const css = {
  entryIcon: 'fe-entry-icon',
  backdrop: 'fe-backdrop',
  backdropClosing: 'fe-backdrop-closing',
  drawer: 'fe-drawer',
  drawerClosing: 'fe-drawer-closing',
  // ⚠ 结构类避开 "modal"/"panel"/"drawer" 子串：玻璃主题的浮层总选择器按
  // 子串匹配，误伤的结构层会被各加一道模糊+高光投影叠出「多层卡片」；
  // 抽屉/弹窗本体虽保留关键词，但声明了 data-solid 实底豁免（本模块全程
  // 无玻璃/模糊，见文件末尾「全程禁用玻璃」段），不会被总选择器命中。
  drawerHeader: 'fe-cap',
  drawerTitle: 'fe-cap-title',
  drawerClose: 'fe-cap-x',
  workspaceRow: 'fe-workspace-row',
  workspaceSelect: 'fe-workspace-select',
  drawerBody: 'fe-body',
  tree: 'fe-tree',
  treeRow: 'fe-tree-row',
  treeChevron: 'fe-tree-chevron',
  treeIcon: 'fe-tree-icon',
  treeName: 'fe-tree-name',
  treeChildren: 'fe-tree-children',
  status: 'fe-status',
  statusError: 'fe-status-error',
  retryButton: 'fe-retry',
  editorModal: 'fe-editor-modal',
  editorHost: 'fe-editor-host',
  markdownBody: 'fe-md-body',
  editorFooter: 'fe-editor-footer',
  editorStatus: 'fe-editor-status',
  editorError: 'fe-editor-error',
  binaryCard: 'fe-binary-card',
  binaryHint: 'fe-binary-hint',
  hexDump: 'fe-hex-dump',
  downloadLink: 'fe-download-link',
  viewerModal: 'fe-viewer-modal',
  viewerStage: 'fe-viewer-stage',
  viewerImg: 'fe-viewer-img',
  viewerToolbar: 'fe-viewer-toolbar',
  viewerButton: 'fe-viewer-button',
  viewerZoomLabel: 'fe-viewer-zoom-label',
  // ── 修改历史对比视图（⚠ 类名避开 modal/panel/drawer 子串）────────────
  histView: 'fe-hist-view',
  histTimeline: 'fe-hist-timeline',
  histTlTitle: 'fe-hist-tl-title',
  histTlList: 'fe-hist-tl-list',
  histTlItem: 'fe-hist-tl-item',
  histTlCurrent: 'fe-hist-tl-current',
  histTlTime: 'fe-hist-tl-time',
  histTlMeta: 'fe-hist-tl-meta',
  histTlChips: 'fe-hist-tl-chips',
  histTlChipAdd: 'fe-hist-tl-chip-add',
  histTlChipDel: 'fe-hist-tl-chip-del',
  histTlMore: 'fe-hist-tl-more',
  histDiff: 'fe-hist-diffcol',
  histSame: 'fe-hist-same',
  histHead: 'fe-hist-head',
  histHeadSide: 'fe-hist-head-side',
  histHeadStats: 'fe-hist-head-stats',
  histStatAdd: 'fe-hist-stat-add',
  histStatDel: 'fe-hist-stat-del',
  histStatNote: 'fe-hist-stat-note',
  histScroll: 'fe-hist-scroll',
  histGrid: 'fe-hist-grid',
  histRow: 'fe-hist-row',
  histRowCtx: 'fe-hist-row-ctx',
  histRowAdd: 'fe-hist-row-add',
  histRowDel: 'fe-hist-row-del',
  histRowMod: 'fe-hist-row-mod',
  histCell: 'fe-hist-cell',
  histNo: 'fe-hist-no',
  histText: 'fe-hist-text',
  histMoreRows: 'fe-hist-more-rows',
  histEditor: 'fe-hist-editor',
} as const

const STYLE_ID = 'dsh-file-explorer-styles'

const SHEET = `
.fe-entry-icon{position:absolute;top:112px;right:14px;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;border-radius:50%;padding:0;background:var(--dsw-alias-bg-layer-1,#1c1f26);cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb);pointer-events:auto}
.fe-entry-icon:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.fe-entry-icon[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}

/* ── 抽屉：滑入放慢更顺滑；关闭时反向滑出 + 遮罩淡出 ─────────────────── */
@keyframes fe-fade-in{from{opacity:0}to{opacity:1}}
@keyframes fe-fade-out{from{opacity:1}to{opacity:0}}
@keyframes fe-drawer-in{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes fe-drawer-out{from{transform:translateX(0)}to{transform:translateX(100%)}}
.fe-backdrop{position:fixed;inset:0;z-index:900;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.4));animation:fe-fade-in 280ms ease-out both}
.fe-backdrop-closing{animation:fe-fade-out 260ms ease-in both}
.fe-drawer{position:fixed;top:0;right:0;bottom:0;z-index:901;width:340px;max-width:90vw;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#1c1f26);border-left:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));box-shadow:var(--dsw-shadow-lv3);animation:fe-drawer-in 360ms cubic-bezier(.32,.72,.28,1) both;will-change:transform}
.fe-drawer-closing{animation:fe-drawer-out 280ms cubic-bezier(.5,.06,.7,.4) both}
.fe-cap{flex:none;display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.fe-cap-title{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fe-cap-x{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.fe-cap-x:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.fe-workspace-row{flex:none;padding:10px 12px 4px}
.fe-workspace-select{width:100%;height:34px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;padding:0 8px;font-size:13px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-base,#0e1116)}
.fe-body{flex:1;min-height:0;overflow-y:auto;padding:6px 8px 12px}

/* ── 弹窗：从中心点 scale 蔓延出现 / 缩回中心消失 ────────────────────── */
@keyframes fe-pop-in{from{opacity:0;transform:scale(.86)}to{opacity:1;transform:scale(1)}}
@keyframes fe-pop-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.9)}}
.fe-pop-root{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px}
.fe-pop-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.4));animation:fe-fade-in 260ms ease-out both}
.fe-pop-closing .fe-pop-mask{animation:fe-fade-out 220ms ease-in both}
.fe-modal-dialog{position:relative;z-index:1;display:flex;flex-direction:column;gap:20px;width:min(480px,100%);max-height:min(86vh,900px);padding:0 0 20px;overflow:hidden;border:1px solid var(--dsw-alias-border-inverted,rgba(255,255,255,.14));border-radius:24px;background:var(--dsw-alias-bg-layer-2,#22252c);box-shadow:var(--dsw-shadow-lv3);transform-origin:center center;animation:fe-pop-in 320ms cubic-bezier(.22,1,.36,1) both}
.fe-pop-closing .fe-modal-dialog{animation:fe-pop-out 220ms cubic-bezier(.45,.05,.65,.35) both}
.fe-pop-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 0 24px}
.fe-pop-title{margin:0;min-width:0;flex:1;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fe-pop-head-actions{flex:none;display:inline-flex;align-items:center;gap:2px}
.fe-pop-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.fe-pop-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.fe-pop-body{display:flex;flex-direction:column;min-width:0;min-height:0;margin-top:16px;padding:0 24px;overflow:auto}
.fe-pop-foot{flex:none;display:flex;align-items:center;gap:8px;padding:16px 24px 0}

/* ── 最大化（data-maximized）：铺满近全屏，内容区跟随拉伸 ─────────────
 * 尺寸由 FeModal inline style 提供（98vw × 96vh），这里补 max-height 放开、
 * body 吃满剩余空间、各内容主体跟随拉伸。宽高过渡与入场 scale 动画共存。 */
.fe-modal-dialog{transition:width 200ms cubic-bezier(.22,1,.36,1),height 200ms cubic-bezier(.22,1,.36,1)}
.fe-modal-dialog[data-maximized='true']{max-height:none}
.fe-modal-dialog[data-maximized='true'] .fe-pop-body{flex:1;overflow:hidden}
.fe-modal-dialog[data-maximized='true'] .fe-editor-host,
.fe-modal-dialog[data-maximized='true'] .fe-hist-view,
.fe-modal-dialog[data-maximized='true'] .fe-viewer-stage,
.fe-modal-dialog[data-maximized='true'] .fe-md-body,
.fe-modal-dialog[data-maximized='true'] .wdv-split,
.fe-modal-dialog[data-maximized='true'] .wdv-view-inner{flex:1;height:auto;max-height:none}
.fe-modal-dialog[data-maximized='true'] .fe-hex-dump{height:100%;overflow:auto}

.fe-tree{list-style:none;margin:0;padding:0}
.fe-tree-children{list-style:none;margin:0;padding:0;padding-left:14px}
.fe-tree-row{display:flex;align-items:center;gap:4px;width:100%;box-sizing:border-box;padding:3px 6px;border:none;border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary,#eee);font-size:13px;line-height:20px;text-align:left;font-family:inherit}
.fe-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.fe-tree-chevron{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary,#888);transition:transform 120ms}
.fe-tree-row[data-open='true'] .fe-tree-chevron{transform:rotate(90deg)}
.fe-tree-icon{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-secondary,#bbb)}
.fe-tree-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.fe-status{margin:4px 6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888)}
.fe-status-error{margin:4px 6px;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary,#e0434b)}
.fe-retry{display:inline-flex;align-items:center;gap:4px;margin:2px 6px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb);font-size:12px}
.fe-retry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}

/* ── 文本编辑器 ─────────────────────────────────────────────────────── */
.fe-editor-host{width:100%;height:min(60vh,640px);box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base,#0e1116)}
.fe-editor-host .cm-editor{height:100%}
.fe-editor-host .cm-scroller{font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace;font-size:13px;line-height:1.6;overflow:auto}
/* 让 oneDark 的编辑器内 chrome 融入 DSH 主题背景 */
.fe-editor-host .cm-editor,.fe-editor-host .cm-gutters{background:transparent}
.fe-editor-footer{display:flex;align-items:center;gap:8px;width:100%}
.fe-editor-status{flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fe-editor-error{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e0434b)}

/* ── markdown 渲染视图（.md 文件的卡片预览态）──────────────────────── */
.fe-md-body{width:100%;max-width:none;box-sizing:border-box;max-height:min(64vh,680px);overflow:auto;padding:4px 18px 14px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;background:var(--dsw-alias-bg-base,#0e1116);color:var(--dsw-alias-label-primary,#eee)}
.fe-md-body .dsh-better-markdown__markdown{font-size:14px;line-height:1.7}
/* markstream 代码块在窄卡片里不横向顶破容器 */
.fe-md-body .dsh-better-markdown__markdown pre{max-width:100%;overflow-x:auto}

/* ── 二进制 hex 预览（任意类型兜底打开） ────────────────────────────── */
.fe-binary-card{width:100%;min-width:0}
.fe-binary-hint{margin:0 0 10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888)}
.fe-hex-dump{margin:0;max-height:min(56vh,560px);overflow:auto;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;background:var(--dsw-alias-bg-base,#0e1116);color:var(--dsw-alias-label-secondary,#bbb);font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre;tab-size:2}
.fe-download-link{display:inline-flex;align-items:center;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:14px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary,#eee);font-size:12px;line-height:18px;text-decoration:none}
.fe-download-link:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}

/* ── 图片查看器：棋盘底衬透明区，缩放自由 ───────────────────────────── */
.fe-viewer-modal{width:min(960px,92vw)}
.fe-viewer-stage{display:flex;align-items:center;justify-content:center;width:100%;height:min(64vh,620px);box-sizing:border-box;overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;background:conic-gradient(var(--dsw-alias-bg-layer-1,#1c1f26) 0 25%,var(--dsw-alias-bg-module,#22252c) 0 50%,var(--dsw-alias-bg-layer-1,#1c1f26) 0 75%,var(--dsw-alias-bg-module,#22252c) 0) 0 0/24px 24px}
.fe-viewer-img{max-width:100%;max-height:calc(min(64vh,620px) - 24px);border-radius:4px;transition:width 140ms ease-out}
.fe-viewer-toolbar{display:flex;align-items:center;gap:8px;width:100%}
.fe-viewer-button{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:14px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary,#eee);font-size:13px;line-height:18px;text-decoration:none}
.fe-viewer-button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.fe-viewer-zoom-label{min-width:48px;text-align:center;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}

/* ── 修改历史对比：左时间线 + 右双栏 diff（同一滚动容器天然同步）────── */
.fe-hist-view{display:flex;gap:14px;width:100%;height:min(60vh,640px);min-height:0}
.fe-hist-timeline{flex:none;width:196px;min-height:0;display:flex;flex-direction:column;gap:6px}
.fe-hist-tl-title{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.fe-hist-tl-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding-right:2px}
.fe-hist-tl-item{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;background:transparent;cursor:pointer;text-align:left;font-family:inherit}
.fe-hist-tl-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.fe-hist-tl-item[data-active='true']{border-color:var(--dsw-alias-state-business-primary,#4a9eff);background:rgba(74,158,255,.1)}
/* 「当前内容」恒置顶条目：绿点 = 磁盘上的活文件 */
.fe-hist-tl-current .fe-hist-tl-time::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#34c77b;margin-right:6px;vertical-align:1px}
.fe-hist-tl-time{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary,#eee)}
.fe-hist-tl-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace}
/* 选中时点上的迷你增删色块（数据来自当前对比统计），点击在 diff 里循环跳转 */
.fe-hist-tl-chips{display:inline-flex;gap:4px;margin-top:3px}
.fe-hist-tl-chip-add,.fe-hist-tl-chip-del{display:inline-flex;align-items:center;height:16px;padding:0 7px;border:none;border-radius:8px;padding-top:0;font-size:10px;line-height:16px;font-weight:600;color:#fff;cursor:pointer;font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace}
.fe-hist-tl-chip-add{background:#3d8bff}
.fe-hist-tl-chip-add:hover{background:#5b9dff}
.fe-hist-tl-chip-del{background:#ff5a5f}
.fe-hist-tl-chip-del:hover{background:#ff7076}
.fe-hist-tl-more{padding:4px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.fe-hist-diffcol{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.fe-hist-same{flex:1;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888)}
.fe-hist-head{flex:none;display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}
.fe-hist-head-side{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fe-hist-head-side:last-child{text-align:right}
.fe-hist-head-stats{flex:none;display:inline-flex;align-items:center;gap:8px;font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace}
/* 增删统计 = 可点击实底色块（蓝=新增、红=删除），点击循环跳到下一处对应修改 */
.fe-hist-stat-add,.fe-hist-stat-del{display:inline-flex;align-items:center;height:20px;padding:0 9px;border:none;border-radius:10px;font-size:11px;line-height:20px;font-weight:600;color:#fff;cursor:pointer;font-family:inherit}
.fe-hist-stat-add{background:#3d8bff}
.fe-hist-stat-add:hover{background:#5b9dff}
.fe-hist-stat-del{background:#ff5a5f}
.fe-hist-stat-del:hover{background:#ff7076}
.fe-hist-stat-note{font-style:normal;font-family:inherit;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}
/* 网格：wrapper 宽 = max-content 保证所有行等宽，两半格各 50% 严格对齐，
   纵向/横向滚动都在同一个容器里，左右天然同步。 */
.fe-hist-scroll{flex:1;min-height:0;overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;background:var(--dsw-alias-bg-base,#0e1116)}
.fe-hist-grid{width:max-content;min-width:100%;font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace;font-size:12px;line-height:1.6}
.fe-hist-row{display:flex;width:100%}
.fe-hist-cell{box-sizing:border-box;width:50%;flex:none;display:flex;align-items:baseline;padding:0 8px 0 0;overflow:hidden}
.fe-hist-no{flex:none;width:44px;box-sizing:border-box;padding-right:8px;text-align:right;color:var(--dsw-alias-label-tertiary,#888);user-select:none;opacity:.7}
.fe-hist-text{white-space:pre;min-width:0}
/* 着色：mod/del 左半格红、mod/add 右半格蓝、缺行一侧垫灰底；
   蓝红与统计色块一致（蓝=新增、红=删除）。 */
.fe-hist-row-mod .fe-hist-cell:first-child,.fe-hist-row-del .fe-hist-cell:first-child{background:rgba(255,90,95,.14)}
.fe-hist-row-mod .fe-hist-cell:last-child,.fe-hist-row-add .fe-hist-cell:last-child{background:rgba(74,158,255,.15)}
.fe-hist-row-add .fe-hist-cell:first-child,.fe-hist-row-del .fe-hist-cell:last-child{background:var(--dsw-alias-bg-layer-2,#22252c)}
.fe-hist-row:hover .fe-hist-cell{filter:brightness(1.18)}
/* 色块跳转命中行：描边闪烁一次 */
@keyframes fe-flash-add{from{outline-color:rgba(61,139,255,.95)}to{outline-color:rgba(61,139,255,0)}}
@keyframes fe-flash-del{from{outline-color:rgba(255,90,95,.95)}to{outline-color:rgba(255,90,95,0)}}
.fe-hist-row[data-flash='add']{outline:2px solid rgba(61,139,255,.95);outline-offset:-2px;animation:fe-flash-add 1s ease-out both}
.fe-hist-row[data-flash='del']{outline:2px solid rgba(255,90,95,.95);outline-offset:-2px;animation:fe-flash-del 1s ease-out both}
.fe-hist-more-rows{padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}
/* 历史页内编辑态：右栏整体替换为 CodeMirror 宿主，随弹窗高度自适应 */
.fe-hist-editor{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base,#0e1116)}
.fe-hist-editor .cm-editor{flex:1;min-height:0}
.fe-hist-editor .cm-scroller{font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace;font-size:13px;line-height:1.6;overflow:auto}
.fe-hist-editor .cm-editor,.fe-hist-editor .cm-gutters{background:transparent}

/* ── 全程禁用玻璃/高斯模糊 ───────────────────────────────────────────
 * 抽屉/弹窗本体声明 data-solid，被玻璃主题浮层总选择器排除：不再获得
 * backdrop-filter 毛玻璃、内高光投影与 @supports 降级补差；弹窗遮罩的
 * blur 也已移除（见上方 .fe-pop-mask）。这里再把玻璃 token 覆盖层换成半
 * 透明 rgba 的表面 token（--dsw-alias-bg-layer-*）顶回官方实色——取自
 * design-platform.css 各 layer 的原始定义：浅=#fff；深 layer-1=35,35,36、
 * layer-2=44,44,46。保证玻璃开关与否观感一致：标准实色面板。
 * ⚠ 官方调色后此处需同步更新。 */
html[data-dsh-glass] .fe-drawer{background-color:rgb(35,35,36)}
html[data-dsh-glass] .fe-modal-dialog{background-color:rgb(44,44,46)}
html[data-dsh-glass] body:not([data-ds-dark-theme]) .fe-drawer,
html[data-dsh-glass] body:not([data-ds-dark-theme]) .fe-modal-dialog{background-color:#fff}

/* ── 移动端：抽屉全宽、编辑器/舞台加高 ──────────────────────────────── */
@media (max-width: 767.98px) {
  .fe-drawer{width:100vw;max-width:100vw;border-left:none}
  .fe-editor-host{height:min(72vh,640px)}
  .fe-md-body{max-height:min(72vh,640px)}
  .fe-viewer-stage{height:min(58vh,520px)}
}

/* 减少动态效果偏好：直接呈现终态 */
@media (prefers-reduced-motion: reduce) {
  .fe-drawer,.fe-drawer-closing,.fe-backdrop,.fe-backdrop-closing,.fe-pop-mask,.fe-pop-closing .fe-pop-mask,.fe-modal-dialog,.fe-pop-closing .fe-modal-dialog{animation:none!important}
}
`

/** 注入样式表(幂等;loader 卸载插件时会移除其 style 标签)。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
