/**
 * team — 样式（运行时注入 <style>，类名前缀 team-）。
 *
 * 控件规格对齐 DSH 官方 ModelsSection（dsh-ui-style 技能）：
 *  - 输入框/下拉 32px 高、8px 圆角、border-l2、bg-layer-1；下拉自绘 chevron；
 *  - 行卡片 border-l2 + 12px 圆角、无底色；编辑面 bg-module-platform + 12px 圆角；
 *  - 大按钮胶囊 18px/36px、行内小按钮 14px/28px；
 *  - 开启态/选中态一律用 --dsw-alias-state-business-primary（绝不用 brand-primary）。
 *
 * 布局：团队面板是**右侧全高抽屉**（占满右边可视区，宽度自适应），内部编制页为
 * 「左画布 + 右检视栏」双列，窄屏退化为上下单列。
 * HUD 与抽屉都是浮层本体（可加 backdrop-filter）；布局列容器不加 filter/transform。
 */

const STYLE_ID = 'dsh-webui-team-styles'

const SHEET = `
/* ══ 全屏右侧抽屉（占满右边可视区，自适应）══ */
@keyframes team-drawer-in{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:translateX(0)}}
@keyframes team-drawer-out{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(28px)}}
.team-mask{position:fixed;inset:0;z-index:960;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45))}
.team-mask[data-anim='in']{animation:dsh-modal-mask-in 240ms ease both}
.team-mask[data-anim='out']{animation:dsh-modal-mask-out 240ms ease both}
.team-drawer{position:fixed;top:0;bottom:0;right:0;z-index:961;display:flex;flex-direction:column;box-sizing:border-box;border-left:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden}
.team-drawer[data-anim='in']{animation:team-drawer-in 260ms cubic-bezier(.2,.8,.2,1)}
.team-drawer[data-anim='out']{animation:team-drawer-out 220ms cubic-bezier(.4,0,.2,1) both}
.team-drawer-head{flex:none;display:flex;align-items:center;gap:10px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-drawer-title{flex:none;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}

/* ══ 面板主体 ══ */
.team-panel{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}

/* 团队切换器行 */
.team-switch{flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-switch-row{display:flex;align-items:center;gap:6px;min-width:0}
.team-model-row{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-model-row>span{flex:none}

/* Tab 栏 */
.team-tabs{flex:none;display:flex;align-items:center;gap:4px;padding:8px 16px 0}
.team-tab{appearance:none;border:none;background:transparent;border-radius:8px;height:32px;padding:0 14px;font-size:13px;line-height:22px;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;font-family:inherit;transition:background .22s cubic-bezier(.2,.8,.2,1),color .22s cubic-bezier(.2,.8,.2,1)}
.team-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.team-tab[data-active='true'],.team-tab[data-active='true']:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);font-weight:600}

/* ══ 双列工作区（左画布 / 右检视栏）══ */
.team-work{flex:1;min-height:0;display:flex}
.team-work-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px}
.team-work-side{flex:none;width:360px;min-height:0;display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-side-scroll{flex:1;min-height:0;overflow-y:auto;padding:10px 14px 16px;display:flex;flex-direction:column;gap:8px}
.team-work[data-narrow='true']{flex-direction:column}
.team-work[data-narrow='true'] .team-work-side{width:auto;border-left:none;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));max-height:46%}
.team-work[data-narrow='true'] .team-work-main{min-height:280px}

/* 单列滚动区（运行/历史/设置页） */
.team-scroll{flex:1;min-height:0;overflow-y:auto;padding:10px 16px 16px;display:flex;flex-direction:column;gap:10px}
.team-scroll-narrow{max-width:760px}
.team-empty{margin:20px 4px;padding:18px 12px;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);text-align:center;border:1px dashed var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:10px}
.team-error{margin:0;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary,#e0434b);color:var(--dsw-alias-state-error-primary,#e0434b);font-size:12px;line-height:18px;word-break:break-word}
.team-section-title{flex:none;margin:2px 2px 0;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}

/* ══ 控件（官方规格）══ */
.team-input,.team-textarea{width:100%;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.team-textarea{height:auto;min-height:76px;padding:8px 10px;resize:vertical;line-height:20px}
.team-input::placeholder,.team-textarea::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
.team-select{appearance:none;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 32px 0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background-color:var(--dsw-alias-bg-layer-1,#1c1f26);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px;cursor:pointer;max-width:240px}
.team-select-grow{max-width:none;flex:1;min-width:0}
.team-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.team-field>span{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-inline{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
.team-inline .team-field{flex:1;min-width:130px}

.team-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;height:28px;padding:0 14px;font-size:12px;line-height:26px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:transparent;cursor:pointer;white-space:nowrap}
.team-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.team-btn:disabled{opacity:.45;cursor:default}
.team-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4176e6));color:var(--dsw-alias-label-primary-foreground,#fff)}
.team-btn-primary:hover:not(:disabled){filter:brightness(1.06)}
.team-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary,#e0434b);color:var(--dsw-alias-state-error-primary,#e0434b)}
.team-btn-lg{height:36px;border-radius:18px;padding:0 18px;font-size:14px;line-height:34px}
.team-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.team-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.team-icon-btn:disabled{opacity:.45;cursor:default}
.team-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.team-chip{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;height:26px;padding:0 12px;font-size:12px;line-height:24px;font-family:inherit;color:var(--dsw-alias-label-secondary,#bbb);background:transparent;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.team-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.team-chip:disabled{opacity:.5;cursor:default}

/* 徽标 / 标签 */
.team-tag{flex:none;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);white-space:nowrap}
.team-tag[data-tone='team']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-tag[data-tone='role']{border-color:color-mix(in srgb,#3fb96b 60%,transparent);color:#3fb96b}
.team-tag[data-tone='run']{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 60%,transparent);color:var(--dsw-alias-state-warn-primary,#e8a33d)}
.team-tag[data-tone='global']{opacity:.8}

/* ══ 可交互编制图 ══ */
.team-graph-host{position:relative;flex:1;min-height:220px;min-width:0;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.02));overflow:hidden}
.team-graph{display:block;touch-action:none;user-select:none}
.team-node{cursor:grab}
.team-node[data-dragging='true']{cursor:grabbing}
.team-node[data-linking='true']{cursor:crosshair}
.team-node-circle{transition:filter .18s ease,stroke-width .18s ease}
.team-node:hover .team-node-circle{filter:brightness(1.18)}
.team-node-label{font-weight:600;fill:var(--dsw-alias-label-primary,#eee);pointer-events:none}
.team-node-sub{fill:var(--dsw-alias-label-tertiary,#999);pointer-events:none}
.team-node-handle{fill:var(--dsw-alias-bg-layer-1,#1c1f26);stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:1.4;opacity:0;cursor:crosshair;transition:opacity .15s ease}
.team-node:hover .team-node-handle{opacity:1}
.team-edge{stroke:var(--dsw-alias-border-l2,rgba(255,255,255,.16));stroke-width:1;fill:none}
.team-edge[data-chain='true']{stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:2}
.team-edge[data-direct='true']{stroke-dasharray:4 3;opacity:.75;stroke:var(--dsw-alias-label-tertiary,#888)}
.team-edge[data-direct='true'][data-selected='true']{opacity:1;stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:2}
.team-edge[data-preview='true']{stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:1.6;stroke-dasharray:5 4}
.team-edge-label{font-size:10px;fill:var(--dsw-alias-state-business-primary,#4176e6);pointer-events:none}
.team-graph-linkbar{position:absolute;left:12px;bottom:12px;display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv2,0 6px 24px rgba(0,0,0,.35));font-size:12px;color:var(--dsw-alias-label-primary,#eee)}
.team-graph-tip{position:absolute;left:50%;top:10px;transform:translateX(-50%);padding:4px 10px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 50%,transparent);font-size:11px;color:var(--dsw-alias-state-business-primary,#4176e6);pointer-events:none}
.team-graph-bar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.team-legend{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#888);padding:0 2px}
.team-legend-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}

/* ══ 角色行卡片 ══ */
.team-role-card{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:transparent}
.team-role-card[data-selected='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent)}
.team-role-row{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:11px 12px;border:none;border-radius:12px;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer}
.team-role-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.team-role-dot{flex:none;width:8px;height:8px;border-radius:50%}
.team-role-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.team-role-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.team-role-sub{display:flex;align-items:center;gap:8px;overflow:hidden;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.team-role-editor{margin:0 8px 8px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.03));border-radius:12px}
.team-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary,#888);transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.team-chevron[data-open='true']{transform:rotate(180deg)}

/* ══ 编制页：关系图画板（占满右侧）══ */
.team-roster{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:10px;padding:10px 16px 16px}
.team-roster-bar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.team-link-tip{display:flex;align-items:center;gap:8px;padding:4px 10px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 16%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 50%,transparent);font-size:12px;color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-roster-chains{flex:none;max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}

/* ══ 关系图画板 ══ */
.team-board{flex:1;min-height:0;min-width:0;position:relative;overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.02))}
.team-board-canvas{position:relative}
.team-board-svg{position:absolute;inset:0;pointer-events:none}
.team-board-edge{stroke:var(--dsw-alias-border-l2,rgba(255,255,255,.16));stroke-width:1.4;fill:none}
.team-board-edge[data-direct='true']{stroke-dasharray:5 4;opacity:.8;stroke:var(--dsw-alias-label-tertiary,#888)}
.team-board-edge[data-chain='true']{stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:2.2}
.team-board-node{position:absolute}
.team-board-node .team-avatar[data-drag-handle]{cursor:grab}
.team-board-node .team-avatar[data-drag-handle]:active{cursor:grabbing}

.team-role-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;align-items:start}

/* 角色网格卡片 */
.team-role-card-grid{display:flex;flex-direction:column;gap:0;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:transparent;overflow:hidden}
.team-role-card-grid[data-selected='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent)}
.team-role-card-grid[data-linking='true']{border-color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 35%,transparent)}
.team-role-card-grid[data-link-mode='true']{cursor:crosshair}
.team-role-card-grid[data-link-mode='true']:not([data-linking='true']):hover{border-color:var(--dsw-alias-state-business-primary,#4176e6)}

.team-grid-head{display:flex;align-items:center;gap:10px;padding:11px 12px;cursor:pointer}
.team-grid-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.team-avatar{flex:none;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;font-size:17px;font-weight:600;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.35);overflow:hidden;white-space:nowrap}
.team-grid-title{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.team-grid-step{flex:none;margin-left:6px;padding:0 5px;border-radius:8px;background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff;font-size:10px;line-height:15px;font-weight:600;vertical-align:1px}
.team-grid-actions{flex:none;display:flex;align-items:center;gap:2px;opacity:.55;transition:opacity .18s ease}
.team-role-card-grid:hover .team-grid-actions{opacity:1}
.team-icon-btn-on{border-color:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent)}

.team-grid-tagline{padding:0 12px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);word-break:break-word}

.team-grid-model{display:flex;align-items:center;gap:6px;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);min-width:0}
.team-grid-model-label{flex:none;color:var(--dsw-alias-label-secondary,#bbb)}
.team-grid-model-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,monospace;color:var(--dsw-alias-label-primary,#eee)}
.team-grid-model-channel{flex:none;margin-left:auto;padding:0 5px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:3px;font-size:10px;line-height:14px}

.team-grid-caps{display:flex;flex-direction:column;padding:0}
.team-grid-caps-plain{padding:7px 12px;font-size:11px;color:var(--dsw-alias-label-tertiary,#888);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-grid-caps-toggle{display:flex;align-items:center;gap:6px;width:100%;padding:7px 12px;border:none;background:transparent;font-family:inherit;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer;text-align:left}
.team-grid-caps-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.team-grid-caps-toggle>span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-grid-caps-body{display:flex;flex-direction:column;gap:4px;padding:2px 12px 9px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-grid-caps-row{display:flex;align-items:flex-start;gap:8px;font-size:11px;line-height:16px}
.team-grid-caps-key{flex:none;color:var(--dsw-alias-label-tertiary,#888)}
.team-grid-caps-val{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,#bbb);word-break:break-word}

.team-grid-links{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-chip-link{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:11px;font-size:11px;line-height:20px}
.team-chip-link button{border:none;background:transparent;color:inherit;cursor:pointer;font-size:13px;line-height:1;padding:0;opacity:.6}
.team-chip-link button:hover{opacity:1;color:var(--dsw-alias-state-error-primary,#e0434b)}


/* ══ 能力装配（工具 + 技能）══ */
.team-caps-toggle{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.team-caps{display:flex;flex-direction:column;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px}
.team-caps-block{display:flex;flex-direction:column;gap:6px}
.team-caps-block+.team-caps-block{border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));padding-top:10px}
.team-caps-head{display:flex;align-items:center;gap:8px}
.team-caps-title{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-caps-count{flex:none;font-size:11px;color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-caps-bar{display:flex;align-items:center;gap:6px}
.team-caps-sub{display:flex;flex-direction:column;gap:6px}
.team-caps-subtitle{font-size:11px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-caps-list{display:flex;flex-direction:column;gap:2px;overflow-y:auto;padding:2px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px}
.team-caps-item{display:flex;align-items:flex-start;gap:7px;padding:5px 7px;border-radius:6px;cursor:pointer;min-width:0}
.team-caps-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}
.team-caps-item input{flex:none;margin-top:2px;accent-color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-caps-name{flex:none;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:var(--dsw-alias-label-primary,#eee)}
.team-caps-desc{flex:1;min-width:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-caps-chips{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.team-chip[data-on='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}

/* ══ 运行视图 ══ */
.team-run-form{display:flex;flex-direction:column;gap:10px;padding:0 0 4px}
.team-step-list{display:flex;flex-direction:column;gap:6px}
.team-step{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px}
.team-step[data-status='running']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent)}
.team-step[data-status='done']{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb96b) 45%,transparent)}
.team-step[data-status='error']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 55%,transparent)}
.team-step-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.team-step-head{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary,#eee)}
.team-step-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}
.team-step-out{font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap;word-break:break-word;max-height:66px;overflow:hidden}

/* 状态灯 */
.team-dot{flex:none;width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-label-dimmed,#666);margin-top:4px}
.team-dot[data-status='running']{background:var(--dsw-alias-state-business-primary,#4176e6);animation:team-breathe 1.4s ease-in-out infinite}
.team-dot[data-status='done']{background:var(--dsw-alias-state-success-primary,#3fb96b)}
.team-dot[data-status='error']{background:var(--dsw-alias-state-error-primary,#e0434b)}
.team-dot[data-status='skipped']{background:var(--dsw-alias-label-tertiary,#888);opacity:.6}
@keyframes team-breathe{0%,100%{opacity:.45;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}

/* 进度条 */
.team-progress{position:relative;height:6px;border-radius:3px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.1));overflow:hidden}
.team-progress-fill{position:absolute;inset:0 auto 0 0;background:var(--dsw-alias-state-business-primary,#4176e6);border-radius:3px;transition:width .3s cubic-bezier(.2,.8,.2,1)}
.team-progress-fail{position:absolute;top:0;bottom:0;background:var(--dsw-alias-state-error-primary,#e0434b)}
.team-progress-text{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}

/* 历史行 */
.team-hist{display:flex;flex-direction:column;gap:3px;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;cursor:pointer}
.team-hist:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.team-hist-head{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}
.team-hist-task{font-size:13px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-status-text{flex:none;font-weight:600}
.team-status-text[data-status='done']{color:var(--dsw-alias-state-success-primary,#3fb96b)}
.team-status-text[data-status='error']{color:var(--dsw-alias-state-error-primary,#e0434b)}
.team-status-text[data-status='running']{color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-status-text[data-status='cancelled'],.team-status-text[data-status='interrupted'],.team-status-text[data-status='queued']{color:var(--dsw-alias-label-tertiary,#888)}

/* 全文查看覆盖层 */
.team-viewer{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d))}
.team-viewer-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-viewer-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-viewer-body{flex:1;min-height:0;margin:0;overflow:auto;padding:14px 16px;font-size:13px;line-height:21px;font-family:inherit;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#eee)}

/* toast */
.team-toast{position:fixed;z-index:1100;top:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:min(480px,90vw);padding:9px 16px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee);cursor:pointer;animation:dsh-modal-slide-in .24s cubic-bezier(.2,.8,.2,1)}

/* ══ 一句话生成团队弹窗 ══ */
.team-gen-mask{position:fixed;inset:0;z-index:1005;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.5));animation:dsh-modal-mask-in 200ms ease}
.team-gen-card{position:fixed;z-index:1006;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);max-height:86vh;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden}
.team-gen-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-gen-title{flex:1;min-width:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-gen-body{flex:1;min-height:0;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.team-gen-examples{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.team-gen-foot{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-gen-progress{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-state-business-primary,#4176e6)}

/* ══ 对话框团队开关 ══ */
.team-toggle-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#999);font-size:12px;font-family:inherit;cursor:pointer;transition:background .18s ease,color .18s ease}
.team-toggle-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.team-toggle-btn[data-on='true']{color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent)}
.team-toggle-name{max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-pop{position:fixed;z-index:1000;width:288px;display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));animation:dsh-modal-slide-in .2s cubic-bezier(.2,.8,.2,1)}
.team-pop-head{display:flex;align-items:center;gap:8px}
.team-pop-title{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-pop-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.team-pop-divider{height:1px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-switch-ctl{position:relative;flex:none;width:36px;height:20px;border:none;border-radius:10px;padding:0;background:var(--dsw-alias-border-l2,rgba(255,255,255,.14));cursor:pointer;transition:background .22s ease;box-sizing:border-box}
.team-switch-ctl::after{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#999);transition:transform .22s cubic-bezier(.2,.8,.2,1),background .22s ease}
.team-switch-ctl[aria-checked='true']{background:var(--dsw-alias-state-business-primary,#4176e6)}
.team-switch-ctl[aria-checked='true']::after{transform:translateX(16px);background:#fff}
.team-switch-ctl:disabled{opacity:.5;cursor:default}
.team-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer}
.team-check input{accent-color:var(--dsw-alias-state-business-primary,#4176e6)}

/* ══ 对话流执行 HUD ══ */
.team-hud{position:fixed;z-index:900;display:flex;flex-direction:column;gap:0;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:color-mix(in srgb,var(--dsw-specific-menu,#16181d) 88%,transparent);backdrop-filter:blur(10px);box-shadow:var(--dsw-shadow-lv2,0 6px 24px rgba(0,0,0,.35));overflow:hidden;animation:dsh-modal-slide-in .24s cubic-bezier(.2,.8,.2,1)}
.team-hud[data-state='done']{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb96b) 50%,transparent)}
.team-hud[data-state='error']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 55%,transparent)}
.team-hud-bar{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;min-height:40px;box-sizing:border-box}
.team-hud-bar:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.team-hud-title{flex:none;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-hud-chain{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-hud-pips{flex:none;display:flex;align-items:center;gap:3px}
.team-hud-pip{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-border-l2,rgba(255,255,255,.2))}
.team-hud-pip[data-status='done']{background:var(--dsw-alias-state-success-primary,#3fb96b)}
.team-hud-pip[data-status='running']{background:var(--dsw-alias-state-business-primary,#4176e6);animation:team-breathe 1.4s ease-in-out infinite}
.team-hud-pip[data-status='error']{background:var(--dsw-alias-state-error-primary,#e0434b)}
.team-hud-count{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);font-family:ui-monospace,SFMono-Regular,monospace}
.team-hud-time{flex:none;margin-left:auto;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);font-family:ui-monospace,SFMono-Regular,monospace}
.team-hud-body{display:flex;flex-direction:column;gap:9px;padding:2px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));max-height:min(52vh,460px);overflow-y:auto}
.team-hud-task{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);word-break:break-word;display:flex;align-items:flex-start;gap:8px}
.team-hud-task-text{flex:1;min-width:0;max-height:54px;overflow:hidden}
.team-hud-seg{display:flex;flex-direction:column;gap:8px;padding-top:8px}
.team-hud-seg+.team-hud-seg{border-top:1px dashed var(--dsw-alias-border-l1,rgba(255,255,255,.1))}
.team-hud-seg-head{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb)}

/* 角色运行卡网格 */
.team-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px}
.team-card{display:flex;flex-direction:column;gap:5px;padding:9px 10px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.03));cursor:pointer;transition:border-color .2s ease,background .2s ease}
.team-card:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.team-card[data-status='running']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 22%,transparent)}
.team-card[data-status='done']{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb96b) 45%,transparent)}
.team-card[data-status='error']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 55%,transparent)}
.team-card[data-status='skipped']{opacity:.6}
.team-card-head{display:flex;align-items:center;gap:6px}
.team-card-icon{flex:none;display:inline-flex;width:14px;justify-content:center;font-size:11px;line-height:14px}
.team-card-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-card-idx{flex:none;font-size:10px;color:var(--dsw-alias-label-dimmed,#777);font-family:ui-monospace,SFMono-Regular,monospace}
.team-card-tag{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-card-model{display:flex;align-items:center;gap:4px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#888);min-width:0}
.team-card-model-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,monospace}
.team-card-src{flex:none;padding:0 4px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:3px;font-size:9.5px;line-height:13px}
.team-card-src[data-src='team']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-card-src[data-src='role']{border-color:color-mix(in srgb,#3fb96b 55%,transparent);color:#3fb96b}
.team-card-src[data-src='run']{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 55%,transparent);color:var(--dsw-alias-state-warn-primary,#e8a33d)}
.team-card-inherit{font-style:italic;opacity:.75}
.team-card-time{font-size:10px;line-height:14px;color:var(--dsw-alias-label-dimmed,#777);font-family:ui-monospace,SFMono-Regular,monospace}
.team-card-out{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-secondary,#aaa);white-space:pre-wrap;word-break:break-word;max-height:45px;overflow:hidden;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));padding-top:4px}
.team-card-err{font-size:10.5px;line-height:15px;color:var(--dsw-alias-state-error-primary,#e0434b);word-break:break-word;max-height:45px;overflow:hidden}
.team-hud-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}

/* HUD 收起后的小胶囊 */
.team-pill{position:fixed;z-index:900;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:13px;background:color-mix(in srgb,var(--dsw-specific-menu,#16181d) 88%,transparent);backdrop-filter:blur(8px);font-size:11px;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer;animation:dsh-modal-slide-in .2s cubic-bezier(.2,.8,.2,1)}
.team-pill:hover{color:var(--dsw-alias-label-primary,#eee)}

@media (prefers-reduced-motion:reduce){
  .team-toast,.team-hud,.team-pop,.team-pill,.team-drawer,.team-mask,.team-gen-card,.team-gen-mask{animation:none}
  .team-dot[data-status='running'],.team-hud-pip[data-status='running']{animation:none}
  .team-switch-ctl,.team-switch-ctl::after,.team-chevron,.team-progress-fill{transition:none!important}
}
`

/** 注入团队样式（幂等 + 热更新原位替换）。 */
export function ensureTeamStyles(): void {
  if (typeof document === 'undefined') return
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag !== null) {
    if (tag.textContent !== SHEET) tag.textContent = SHEET
    return
  }
  tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.pluginCss = 'webui/team'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 移除样式（插件卸载时调用）。 */
export function removeTeamStyles(): void {
  document.getElementById(STYLE_ID)?.remove()
}
