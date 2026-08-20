/**
 * 工作区目录选择器弹窗样式（运行时注入 <style>，卸载时移除）。
 * 类名前缀 wdp-；颜色走 DSH 主题令牌（--dsw-alias-*），对齐官方控件规格
 * （输入 32px / 8px 圆角、大按钮 36px 胶囊、行内小按钮 28px 胶囊、行卡片 12px）。
 */

export const css = {
  dialog: 'wdp-dialog',
  scope: 'wdp-scope',
  header: 'wdp-header',
  title: 'wdp-title',
  crumbBar: 'wdp-crumb-bar',
  crumbTrail: 'wdp-crumb-trail',
  crumbSeat: 'wdp-crumb-seat',
  crumbChevron: 'wdp-crumb-chevron',
  crumb: 'wdp-crumb',
  crumbEdit: 'wdp-crumb-edit',
  pathInput: 'wdp-path-input',
  list: 'wdp-list',
  row: 'wdp-row',
  rowSelected: 'wdp-row-selected',
  rowIcon: 'wdp-row-icon',
  rowName: 'wdp-row-name',
  status: 'wdp-status',
  error: 'wdp-error',
  footer: 'wdp-footer',
  footerGap: 'wdp-footer-gap',
  hiddenToggle: 'wdp-hidden-toggle',
  hiddenToggleActive: 'wdp-hidden-toggle-active',
  createDialog: 'wdp-create-dialog',
  createBody: 'wdp-create-body',
  createTitle: 'wdp-create-title',
  createIn: 'wdp-create-in',
  createInput: 'wdp-create-input',
  createActions: 'wdp-create-actions',
  drivesSeat: 'wdp-drives-seat',
  drivesBtn: 'wdp-drives-btn',
  drivesIcon: 'wdp-drives-icon',
  drivesLabel: 'wdp-drives-label',
  drivesChevron: 'wdp-drives-chevron',
  drivesMenu: 'wdp-drives-menu',
  drivesItem: 'wdp-drives-item',
  drivesDismiss: 'wdp-drives-dismiss',
} as const

const STYLE_ID = 'dsh-workspace-dir-picker-styles'

const SHEET = `
/* 弹窗卡片：覆盖官方 Modal 默认 380px 宽度，扩展为 680×500 目录浏览布局 */
.wdp-dialog.wdp-dialog{
  width:min(680px,100%);
  height:min(500px,calc(100dvh - 32px));
  padding:0;
  gap:0
}
.wdp-scope{display:contents}
.wdp-header{flex:none;display:flex;flex-direction:column;gap:8px;padding:16px 14px 8px 24px;border-bottom:1px solid var(--dsw-alias-border-l3)}
.wdp-title{display:flex;align-items:flex-end;min-height:28px;margin:0;font-size:16px;line-height:24px;font-weight:510;color:var(--dsw-alias-label-primary)}
.wdp-crumb-bar{display:flex;align-items:center;gap:4px;box-sizing:border-box;min-height:24px;margin-left:-9px;padding:0 8px;border:1px solid transparent;border-radius:8px}
.wdp-crumb-bar:has(.wdp-crumb-edit:hover),
.wdp-crumb-bar:has(.wdp-crumb-edit:focus-visible),
.wdp-crumb-bar:has(.wdp-path-input){border-color:var(--dsw-alias-border-l2)}
.wdp-crumb-trail{display:flex;align-items:center;gap:4px;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}
.wdp-crumb-trail::-webkit-scrollbar{display:none}
.wdp-crumb-seat{display:flex;align-items:center;gap:4px;flex:none}
.wdp-crumb-chevron{display:inline-flex;color:var(--dsw-alias-label-tertiary)}
.wdp-crumb{display:inline-flex;align-items:center;height:22px;padding:0 4px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap}
.wdp-crumb:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary)}
.wdp-crumb[aria-current="true"]{color:var(--dsw-alias-label-primary);font-weight:500}
.wdp-crumb:disabled{opacity:.5;cursor:default}
.wdp-crumb-edit{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.wdp-crumb-edit:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary)}
.wdp-crumb-edit:disabled{opacity:.5;cursor:default}
.wdp-path-input{flex:1 1 auto;min-width:0;height:24px;box-sizing:border-box;padding:0 4px;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:20px;outline:none}
.wdp-list{flex:1 1 0;min-height:0;overflow-y:auto;overflow-x:hidden;padding:8px 8px 12px 24px;display:flex;flex-direction:column;gap:2px}
.wdp-list::-webkit-scrollbar{width:8px}
.wdp-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:4px}
.wdp-row{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:34px;padding:5px 10px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:left;cursor:pointer;font-family:inherit}
.wdp-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.wdp-row-selected{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 12%,transparent)}
.wdp-row:disabled{opacity:.5;cursor:default}
.wdp-row-icon{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-state-business-primary,#4a9eff)}
.wdp-row-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wdp-status{margin:4px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.wdp-error{margin:4px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-danger-primary,#f56c6c)}
.wdp-footer{flex:none;display:flex;align-items:center;gap:8px;padding:12px 14px 16px 24px;border-top:1px solid var(--dsw-alias-border-l3)}
.wdp-footer-gap{flex:1 1 auto}
.wdp-hidden-toggle{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;cursor:pointer}
.wdp-hidden-toggle:hover{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-label-primary)}
.wdp-hidden-toggle-active{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff)}
.wdp-hidden-toggle:disabled{opacity:.5;cursor:default}
/* 新建文件夹嵌套弹窗 */
.wdp-create-dialog{width:min(380px,100%)}
.wdp-create-body{display:flex;flex-direction:column;gap:10px;padding:4px 0 0}
.wdp-create-title{margin:0;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.wdp-create-in{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.wdp-create-input{height:32px;box-sizing:border-box;padding:0 10px;font-size:14px;line-height:22px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);outline:none}
.wdp-create-input:focus{border-color:var(--dsw-alias-state-business-primary,#4a9eff)}
.wdp-create-actions{display:flex;justify-content:flex-end;gap:8px}
/* 盘符/根切换（面包屑栏最左，Windows 盘符入口） */
.wdp-drives-seat{position:relative;flex:none;display:inline-flex;align-items:center}
.wdp-drives-btn{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 4px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap}
.wdp-drives-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary)}
.wdp-drives-btn[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary)}
.wdp-drives-btn:disabled{opacity:.5;cursor:default}
.wdp-drives-icon{display:inline-flex;color:var(--dsw-alias-state-business-primary,#4a9eff)}
.wdp-drives-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wdp-drives-chevron{display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform 120ms}
.wdp-drives-btn[aria-expanded="true"] .wdp-drives-chevron{transform:rotate(180deg)}
.wdp-drives-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:20;min-width:160px;max-height:280px;overflow-y:auto;padding:4px;display:flex;flex-direction:column;gap:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 32px rgba(0,0,0,.45))}
.wdp-drives-item{display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:20px;text-align:left;cursor:pointer;font-family:inherit}
.wdp-drives-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.wdp-drives-item[aria-selected="true"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4a9eff)}
.wdp-drives-dismiss{position:fixed;inset:0;z-index:10}
`

let injected = false

/** 注入弹窗样式（幂等）；返回移除函数。 */
export function injectDirPickerStyles(): () => void {
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/workspace-dir-picker'
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
