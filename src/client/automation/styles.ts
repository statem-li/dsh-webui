/**
 * automation — 样式（运行时注入 <style>，类名前缀 auto-）。
 *
 * 规格对齐 DSH 官方 ModelsSection（dsh-ui-style）：
 *  - 输入件 32px 高 / 8px 圆角 / 14px 字号 / border-l2 细线 / bg-layer-1 底；
 *  - 行内胶囊 h28 r14 12px 字，大胶囊 h36 r18 14px 字；
 *  - 行卡片 border-l2 + 12px 圆角 + 无底色，展开编辑面用 bg-module-platform；
 *  - 强调 / 选中 / 开启一律 state-business-primary（绝不用 brand-primary）。
 *
 * 面板外壳复用 popover-shell；此处只含面板内部布局与控件。
 */

const STYLE_ID = 'dsh-webui-automation-styles'

const SHEET = `
/* ── 面板主体 ── */
.auto-panel{flex:1;min-height:0;display:flex;flex-direction:column;position:relative;color:var(--dsw-alias-label-primary,#eee)}

/* ── 头部：分段 Tab + 统计条 ── */
.auto-head{flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px 0}
.auto-tabs{display:flex;align-items:center;gap:2px;padding:2px;border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04))}
.auto-tab{appearance:none;border:none;background:transparent;border-radius:8px;height:28px;padding:0 12px;display:inline-flex;align-items:center;gap:5px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;font-family:inherit;transition:background .16s cubic-bezier(.2,.8,.2,1),color .16s cubic-bezier(.2,.8,.2,1)}
.auto-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.auto-tab[data-active='true'],.auto-tab[data-active='true']:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.1));color:var(--dsw-alias-state-business-primary,#4176e6);font-weight:600}
.auto-tab-count{flex:none;min-width:16px;padding:0 4px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 16%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);font-size:11px;line-height:16px;text-align:center}
.auto-stats{margin-left:auto;display:flex;align-items:center;gap:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-stat{display:inline-flex;align-items:center;gap:5px}
.auto-stat-value{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee);font-variant-numeric:tabular-nums}
.auto-stat-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-stat-dot[data-kind='running']{background:var(--dsw-alias-state-warn-primary,#e8a33d)}

/* ── 工具栏：搜索 + 筛选 + 新建 ── */
.auto-toolbar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px 6px}
.auto-search{position:relative;flex:1;min-width:150px;display:flex;align-items:center}
.auto-search-icon{position:absolute;left:10px;display:inline-flex;pointer-events:none;color:var(--dsw-alias-label-tertiary,#888)}
.auto-search-input{width:100%;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 30px 0 32px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.auto-search-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-search-input::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
.auto-search-clear{position:absolute;right:6px;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:6px;padding:0;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer}
.auto-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.auto-chips{display:flex;align-items:center;gap:4px}
.auto-chip{appearance:none;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:transparent;font-size:12px;line-height:26px;font-family:inherit;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer;transition:background .16s ease,color .16s ease,border-color .16s ease}
.auto-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.auto-chip[data-active='true'],.auto-chip[data-active='true']:hover{border-color:transparent;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 16%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);font-weight:600}
.auto-icon-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.auto-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.auto-icon-btn:disabled{opacity:.45;cursor:default}
.auto-icon-btn[data-spin='true'] svg{animation:auto-spin 1s linear infinite}
.auto-add{flex:none;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 12px 0 10px;border:none;border-radius:14px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4176e6));color:var(--dsw-alias-label-primary-foreground,#fff);font-size:12px;line-height:26px;font-family:inherit;cursor:pointer;transition:filter .16s ease}
.auto-add:hover:not(:disabled){filter:brightness(1.08)}
.auto-add:disabled{opacity:.5;cursor:default}

/* ── 列表区 ── */
.auto-scroll{flex:1;min-height:0;overflow-y:auto;padding:4px 16px 16px;display:flex;flex-direction:column;gap:8px}
.auto-empty{margin:20px 2px;padding:22px 14px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;border:1px dashed var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:12px}
.auto-empty-icon{display:inline-flex;color:var(--dsw-alias-label-dimmed,#666);margin-bottom:2px}
.auto-empty-text{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#bbb)}
.auto-empty-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-error{margin:0 0 4px;padding:9px 12px;display:flex;align-items:center;gap:8px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 10%,transparent);color:var(--dsw-alias-state-error-primary,#e0434b);font-size:12px;line-height:18px}

/* ── 分组标题 ── */
.auto-section-title{flex:none;display:flex;align-items:center;gap:6px;margin:2px 2px 0;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}

/* ── 任务行卡片 ── */
.auto-card{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:transparent;transition:border-color .16s ease}
.auto-card[data-open='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 45%,var(--dsw-alias-border-l2,rgba(255,255,255,.14)))}
.auto-card[data-draft='true']{border-style:dashed}
.auto-row{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:12px}
.auto-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.auto-row-main{flex:1;min-width:0;display:flex;align-items:center;gap:10px;border:none;background:transparent;padding:0;color:inherit;font-family:inherit;text-align:left;cursor:pointer}
.auto-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.auto-name-line{display:flex;align-items:center;gap:6px;min-width:0}
.auto-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.auto-sub{display:flex;align-items:center;gap:8px;overflow:hidden;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-meta{flex:none;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.auto-meta[data-tone='error']{color:var(--dsw-alias-state-error-primary,#e0434b)}
.auto-badge{flex:none;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb)}
.auto-badge[data-tone='accent']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-badge[data-tone='warn']{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 60%,transparent);color:var(--dsw-alias-state-warn-primary,#e8a33d)}
.auto-badge[data-tone='error']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 60%,transparent);color:var(--dsw-alias-state-error-primary,#e0434b)}
.auto-badge[data-tone='muted']{border-style:dashed;color:var(--dsw-alias-label-tertiary,#888)}
.auto-running{flex:none;display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-state-warn-primary,#e8a33d);font-size:11px;line-height:16px}
.auto-running svg{animation:auto-spin 1s linear infinite}
.auto-state{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary,#888);transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.auto-chevron[data-open='true']{transform:rotate(180deg)}

/* 开关（官方规格：开=business-primary 底白钮；关=border-l2 底灰钮） */
.auto-switch{position:relative;flex:none;width:36px;height:20px;border:none;border-radius:10px;padding:0;background:var(--dsw-alias-border-l2,rgba(255,255,255,.14));cursor:pointer;transition:background .22s ease;box-sizing:border-box}
.auto-switch::after{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#888);transition:transform .22s cubic-bezier(.2,.8,.2,1),background .22s ease}
.auto-switch[aria-checked='true']{background:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-switch[aria-checked='true']::after{transform:translateX(16px);background:#fff}
.auto-switch:disabled{opacity:.5;cursor:default}

/* 展开编辑面 */
.auto-editor{margin:0 8px 8px;padding:12px 14px;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.03));border-radius:12px}
.auto-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.auto-field>span,.auto-field-label{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#bbb)}
.auto-input,.auto-textarea{width:100%;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.auto-input:focus,.auto-textarea:focus,.auto-select:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-input::placeholder,.auto-textarea::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
.auto-textarea{height:auto;min-height:88px;padding:8px 10px;resize:vertical;line-height:21px}
.auto-select{appearance:none;width:100%;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 32px 0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background-color:var(--dsw-alias-bg-layer-1,#1c1f26);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px;cursor:pointer;max-width:240px}
.auto-inline{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
.auto-inline .auto-field{flex:1;min-width:120px}
.auto-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-hint[data-tone='error']{color:var(--dsw-alias-state-error-primary,#e0434b)}
.auto-hint[data-tone='accent']{color:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-schedule{display:flex;flex-direction:column;gap:8px}
.auto-count{align-self:flex-end;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums}

/* 操作行 */
.auto-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}
.auto-btn{appearance:none;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;height:28px;padding:0 14px;font-size:12px;line-height:26px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:transparent;cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease}
.auto-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.auto-btn:disabled{opacity:.45;cursor:default}
.auto-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4176e6));color:var(--dsw-alias-label-primary-foreground,#fff)}
.auto-btn-primary:hover:not(:disabled){filter:brightness(1.08);background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4176e6))}
.auto-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary,#e0434b);color:var(--dsw-alias-state-error-primary,#e0434b);background:var(--dsw-alias-interactive-bg-hover-danger,color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 10%,transparent))}
.auto-btn-danger[data-armed='true']{border-color:var(--dsw-alias-state-error-primary,#e0434b);color:var(--dsw-alias-state-error-primary,#e0434b)}
.auto-spacer{margin-left:auto}

/* 运行记录列表 */
.auto-runs{display:flex;flex-direction:column;gap:6px}
.auto-runs-head{display:flex;align-items:center;gap:8px}
.auto-run{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;font-size:11px;line-height:16px}
.auto-run-head{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-run-status{flex:none;display:inline-flex;align-items:center;gap:4px;font-weight:600}
.auto-run-status::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.auto-run-status[data-status='success']{color:var(--dsw-alias-state-success-primary,#3fb96b)}
.auto-run-status[data-status='error']{color:var(--dsw-alias-state-error-primary,#e0434b)}
.auto-run-status[data-status='skipped']{color:var(--dsw-alias-label-tertiary,#888)}
.auto-run-job{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--dsw-alias-label-primary,#eee)}
.auto-run-time{margin-left:auto;flex:none;font-variant-numeric:tabular-nums}
.auto-run-detail{word-break:break-word;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.auto-run-detail[data-tone='error']{color:var(--dsw-alias-state-error-primary,#e0434b)}
.auto-run-foot{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-run-foot .auto-btn{margin-left:auto;height:24px;padding:0 10px;font-size:11px;line-height:22px;border-radius:12px}

/* ── AI 建议卡 ── */
.auto-suggest{border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 55%,transparent);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 6%,transparent)}
.auto-suggest-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#eee)}
.auto-suggest-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.auto-suggest-kind{flex:none;padding:1px 6px;border:1px solid var(--dsw-alias-state-warn-primary,#e8a33d);border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-primary,#e8a33d)}
.auto-suggest-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);word-break:break-word}
.auto-suggest-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* ── TimePicker 弹层 ── */
.auto-time{position:relative;display:inline-block}
.auto-time-btn{display:inline-flex;align-items:center;gap:8px;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26);cursor:pointer;font-variant-numeric:tabular-nums}
.auto-time-btn[aria-expanded='true']{border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-time-pop{position:absolute;z-index:20;top:calc(100% + 4px);left:0;display:flex;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));padding:4px;max-height:220px}
.auto-time-col{display:flex;flex-direction:column;overflow-y:auto;scrollbar-width:thin}
.auto-time-opt{appearance:none;border:none;border-radius:6px;padding:3px 12px;font-size:12px;line-height:18px;font-family:inherit;color:var(--dsw-alias-label-secondary,#bbb);background:transparent;cursor:pointer;text-align:center;font-variant-numeric:tabular-nums}
.auto-time-opt:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.auto-time-opt[data-selected='true'],.auto-time-opt[data-selected='true']:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 16%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);font-weight:600}
.auto-time-div{flex:none;width:1px;margin:4px 2px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.08))}

/* ── 底部设置条（AI 免确认）── */
.auto-foot{flex:none;display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.auto-foot-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.auto-foot-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.auto-foot-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}

/* ── 全局 toast（完成通知）── */
.auto-toast{position:fixed;z-index:1100;top:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:min(480px,90vw);padding:9px 16px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee);cursor:pointer;animation:dsh-modal-slide-in .24s cubic-bezier(.2,.8,.2,1)}
.auto-toast-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#3fb96b)}
.auto-toast[data-tone='error'] .auto-toast-dot{background:var(--dsw-alias-state-error-primary,#e0434b)}

/* ── 全文查看覆盖层（面板内 absolute 覆盖）── */
.auto-viewer{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d))}
.auto-viewer-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.auto-viewer-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.auto-viewer-body{flex:1;min-height:0;margin:0;overflow:auto;padding:14px 16px;font-size:13px;line-height:21px;font-family:inherit;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#eee)}

@keyframes auto-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}

@media (prefers-reduced-motion:reduce){
  .auto-toast{animation:none}
  .auto-switch,.auto-switch::after,.auto-chevron,.auto-chip,.auto-btn{transition:none!important}
  .auto-running svg,.auto-icon-btn[data-spin='true'] svg{animation:none!important}
}
`

/** 注入自动化样式（幂等；内容变化时原位替换，支持热更新）。 */
export function ensureAutomationStyles(): void {
  if (typeof document === 'undefined') return
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag !== null) {
    if (tag.textContent !== SHEET) tag.textContent = SHEET
    return
  }
  tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.dataset.pluginCss = 'webui/automation'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 移除样式（插件卸载时调用）。 */
export function removeAutomationStyles(): void {
  document.getElementById(STYLE_ID)?.remove()
}
