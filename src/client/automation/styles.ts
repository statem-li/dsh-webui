/**
 * automation — 样式（运行时注入 <style>，类名前缀 auto-）。
 *
 * 控件规格对齐 DSH 官方 ModelsSection（dsh-ui-style）：输入框 32px/8px 圆角、
 * 行卡片 border-l2 + 12px 圆角、开启态用 state-business-primary。面板外壳
 * 复用 popover-shell；此处只含面板内部布局与控件。
 */

const STYLE_ID = 'dsh-webui-automation-styles'

const SHEET = `
/* ── 面板主体 ── */
.auto-panel{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}
.auto-tabs{flex:none;display:flex;align-items:center;gap:4px;padding:10px 14px 0}
.auto-tab{appearance:none;border:none;background:transparent;border-radius:8px;height:32px;padding:0 14px;font-size:13px;line-height:22px;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;font-family:inherit;transition:background .22s cubic-bezier(.2,.8,.2,1),color .22s cubic-bezier(.2,.8,.2,1)}
.auto-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.auto-tab[data-active='true'],.auto-tab[data-active='true']:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4a9eff);font-weight:600}
.auto-toolbar{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:10px 14px 6px}
.auto-add{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.auto-add:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.auto-add:disabled{opacity:.5;cursor:default}

/* ── 列表区 ── */
.auto-scroll{flex:1;min-height:0;overflow-y:auto;padding:4px 14px 14px;display:flex;flex-direction:column;gap:8px}
.auto-empty{margin:24px 4px;padding:18px 12px;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);text-align:center;border:1px dashed var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:10px}
.auto-error{margin:0 0 8px;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary,#e0434b);color:var(--dsw-alias-state-error-primary,#e0434b);font-size:12px;line-height:18px}

/* ── 分组标题（AI 建议 / 任务列表）── */
.auto-section-title{flex:none;margin:2px 2px 0;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}

/* ── 任务行卡片 ── */
.auto-card{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:transparent}
.auto-row{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:11px 12px;border:none;border-radius:12px;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer}
.auto-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.auto-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.auto-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.auto-sub{display:flex;align-items:center;gap:8px;overflow:hidden;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-meta{flex:none;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.auto-badge{flex:none;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb)}
.auto-state{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary,#888);transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.auto-chevron[data-open='true']{transform:rotate(180deg)}

/* 开关（官方规格：开=business-primary 底白钮；关=border-l2 底灰钮） */
.auto-switch{position:relative;flex:none;width:36px;height:20px;border:none;border-radius:10px;padding:0;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.14));cursor:pointer;transition:background .22s ease;box-sizing:border-box}
.auto-switch::after{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4a9eff);transition:transform .22s cubic-bezier(.2,.8,.2,1),background .22s ease}
.auto-switch[aria-checked='true']{background:var(--dsw-alias-state-business-primary,#4a9eff)}
.auto-switch[aria-checked='true']::after{transform:translateX(16px);background:#fff}
.auto-switch:disabled{opacity:.5;cursor:default}

/* 展开编辑面 */
.auto-editor{margin:0 8px 8px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.03));border-radius:12px}
.auto-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.auto-field>span{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#bbb)}
.auto-input,.auto-textarea{width:100%;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.auto-input::placeholder,.auto-textarea::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
.auto-textarea{height:auto;min-height:72px;padding:8px 10px;resize:vertical;line-height:20px}
.auto-select{appearance:none;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 32px 0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background-color:var(--dsw-alias-bg-layer-1,#1c1f26);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px;cursor:pointer;max-width:240px}
.auto-inline{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
.auto-inline .auto-field{flex:1;min-width:120px}
.auto-inline .auto-field-narrow{flex:0 0 auto;min-width:0}

/* 操作行 */
.auto-actions{display:flex;align-items:center;gap:8px;margin-top:2px}
.auto-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;height:28px;padding:0 14px;font-size:12px;line-height:26px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:transparent;cursor:pointer}
.auto-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.auto-btn:disabled{opacity:.45;cursor:default}
.auto-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4a9eff));color:var(--dsw-alias-label-primary-foreground,#fff)}
.auto-btn-primary:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4a9eff))}
.auto-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary,#e0434b);color:var(--dsw-alias-state-error-primary,#e0434b)}

/* 运行记录小列表 */
.auto-runs{display:flex;flex-direction:column;gap:6px}
.auto-run{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;font-size:11px;line-height:16px}
.auto-run-head{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-run-status{flex:none;font-weight:600}
.auto-run-status[data-status='success']{color:var(--dsw-alias-state-success-primary,#3fb96b)}
.auto-run-status[data-status='error']{color:var(--dsw-alias-state-error-primary,#e0434b)}
.auto-run-status[data-status='skipped']{color:var(--dsw-alias-label-tertiary,#888)}
.auto-run-detail{word-break:break-word;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap}

/* ── AI 建议卡 ── */
.auto-suggest{border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 55%,transparent);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.auto-suggest-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#eee)}
.auto-suggest-kind{flex:none;padding:1px 6px;border:1px solid var(--dsw-alias-state-warn-primary,#e8a33d);border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-primary,#e8a33d)}
.auto-suggest-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);word-break:break-word}
.auto-suggest-actions{display:flex;align-items:center;gap:8px}

/* ── TimePicker 弹层 ── */
.auto-time{position:relative;display:inline-block}
.auto-time-btn{display:inline-flex;align-items:center;gap:8px;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26);cursor:pointer}
.auto-time-pop{position:absolute;z-index:20;top:calc(100% + 4px);left:0;display:flex;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));padding:4px;max-height:220px}
.auto-time-col{display:flex;flex-direction:column;overflow-y:auto;scrollbar-width:thin}
.auto-time-opt{appearance:none;border:none;border-radius:6px;padding:3px 12px;font-size:12px;line-height:18px;font-family:inherit;color:var(--dsw-alias-label-secondary,#bbb);background:transparent;cursor:pointer;text-align:center}
.auto-time-opt:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.auto-time-opt[data-selected='true'],.auto-time-opt[data-selected='true']:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 14%,transparent);color:var(--dsw-alias-state-business-primary,#4a9eff);font-weight:600}
.auto-time-div{flex:none;width:1px;margin:4px 2px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.08))}

/* ── 全局 toast（完成通知）── */
.auto-toast{position:fixed;z-index:1100;top:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:min(480px,90vw);padding:9px 16px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee);cursor:pointer;animation:dsh-modal-slide-in .24s cubic-bezier(.2,.8,.2,1)}

/* ── 运行记录 tab ── */
.auto-run-job{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--dsw-alias-label-primary,#eee)}
.auto-run-actions{display:flex;justify-content:flex-end;margin-top:2px}
.auto-run .auto-btn{height:24px;padding:0 10px;font-size:11px;line-height:22px;border-radius:12px}

/* ── 全文查看覆盖层（面板内 absolute 覆盖）── */
.auto-viewer{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d))}
.auto-viewer-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.auto-viewer-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.auto-viewer-body{flex:1;min-height:0;margin:0;overflow:auto;padding:14px 16px;font-size:13px;line-height:21px;font-family:inherit;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#eee)}

@media (prefers-reduced-motion:reduce){
  .auto-toast{animation:none}
  .auto-switch,.auto-switch::after,.auto-chevron{transition:none!important}
}
`

/** 注入自动化样式（幂等）。 */
export function ensureAutomationStyles(): void {
  if (typeof document === 'undefined') return
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag !== null) {
    // 热更新：内容变化时原位替换。
    if (tag.textContent !== SHEET) tag.textContent = SHEET
    return
  }
  tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.pluginCss = 'webui/automation'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 移除样式（插件卸载时调用）。 */
export function removeAutomationStyles(): void {
  document.getElementById(STYLE_ID)?.remove()
}
