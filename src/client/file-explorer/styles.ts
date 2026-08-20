/**
 * dsh-file-explorer — 样式(运行时注入 <style>,卸载时由 loader 清理)。
 * 类名前缀 fe-;颜色走 DSH 主题令牌(--dsw-alias-*,定义在 body 上)。
 */

export const css = {
  entryIcon: 'fe-entry-icon',
  backdrop: 'fe-backdrop',
  drawer: 'fe-drawer',
  drawerHeader: 'fe-drawer-header',
  drawerTitle: 'fe-drawer-title',
  drawerClose: 'fe-drawer-close',
  workspaceRow: 'fe-workspace-row',
  workspaceSelect: 'fe-workspace-select',
  drawerBody: 'fe-drawer-body',
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
  editorFooter: 'fe-editor-footer',
  editorStatus: 'fe-editor-status',
  editorError: 'fe-editor-error',
} as const

const STYLE_ID = 'dsh-file-explorer-styles'

const SHEET = `
.fe-entry-icon{position:absolute;top:112px;right:14px;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;border-radius:50%;padding:0;background:var(--dsw-alias-bg-layer-1,#1c1f26);cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb);pointer-events:auto}
.fe-entry-icon:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.fe-entry-icon[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}

.fe-backdrop{position:fixed;inset:0;z-index:900;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.4))}
.fe-drawer{position:fixed;top:0;right:0;bottom:0;z-index:901;width:340px;max-width:90vw;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#1c1f26);border-left:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));box-shadow:var(--dsw-shadow-lv3);animation:fe-drawer-in 180ms ease-out}
@keyframes fe-drawer-in{from{transform:translateX(100%)}to{transform:translateX(0)}}
.fe-drawer-header{flex:none;display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.fe-drawer-title{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fe-drawer-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.fe-drawer-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.fe-workspace-row{flex:none;padding:10px 12px 4px}
.fe-workspace-select{width:100%;height:34px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;padding:0 8px;font-size:13px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-base,#0e1116)}
.fe-drawer-body{flex:1;min-height:0;overflow-y:auto;padding:6px 8px 12px}

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

.fe-editor-modal{width:min(920px,92vw)}
.fe-editor-host{width:100%;height:min(60vh,640px);box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base,#0e1116)}
.fe-editor-host .cm-editor{height:100%}
.fe-editor-host .cm-scroller{font-family:ui-monospace,'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace;font-size:13px;line-height:1.6;overflow:auto}
/* 让 oneDark 的编辑器内 chrome 融入 DSH 主题背景 */
.fe-editor-host .cm-editor,.fe-editor-host .cm-gutters{background:transparent}
.fe-editor-footer{display:flex;align-items:center;gap:8px;width:100%}
.fe-editor-status{flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fe-editor-error{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e0434b)}

/* ── 移动端：抽屉全宽、编辑器加高 ─────────────────────────────── */
@media (max-width: 767.98px) {
  .fe-drawer{width:100vw;max-width:100vw;border-left:none}
  .fe-editor-host{height:min(72vh,640px)}
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
