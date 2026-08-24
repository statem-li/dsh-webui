/**
 * dsh-memory — 样式（运行时注入 <style>，卸载时由 loader 清理）。
 * 类名前缀 dsh-memory-；规格对齐官方 ui-settings-models 的 ModelsSection.module.css。
 *
 * 布局：主从式（master-detail）——
 *  - 左列 listPane：紧凑条目行（标题 + 摘要 + 时间），选中态 ghost 填充 + 品牌色左条；
 *  - 右侧 detailPane：完整 Markdown 详情（标题 17/600、meta 行、正文、标签行），
 *    编辑/移动/新建以表单态占据同一区域；
 *  - 变更 tab 为全宽列表（描边卡 + rowTag 式徽章 + 前后对比双列）。
 */

export const css = {
  modal: 'dsh-memory-modal',
  modalBody: 'dsh-memory-modal-body',
  panel: 'dsh-memory-panel',
  tabs: 'dsh-memory-tabs',
  tab: 'dsh-memory-tab',
  tabActive: 'dsh-memory-tab-active',
  topRow: 'dsh-memory-top-row',
  projectChips: 'dsh-memory-project-chips',
  projectChip: 'dsh-memory-project-chip',
  projectChipActive: 'dsh-memory-project-chip-active',
  searchRow: 'dsh-memory-search-row',
  searchInput: 'dsh-memory-search-input',
  tagSelect: 'dsh-memory-tag-select',
  sectionTitle: 'dsh-memory-section-title',
  cardList: 'dsh-memory-card-list',
  cardContent: 'dsh-memory-card-content',
  cardMeta: 'dsh-memory-card-meta',
  chip: 'dsh-memory-chip',
  chipActive: 'dsh-memory-chip-active',
  cardActions: 'dsh-memory-card-actions',
  iconAction: 'dsh-memory-icon-action',
  iconActionDanger: 'dsh-memory-icon-action-danger',
  pinMark: 'dsh-memory-pin-mark',
  empty: 'dsh-memory-empty',
  changeRow: 'dsh-memory-change-row',
  changeMain: 'dsh-memory-change-main',
  changeBadge: 'dsh-memory-change-badge',
  changeBadgeDelete: 'dsh-memory-change-badge-delete',
  changeOld: 'dsh-memory-change-old',
  changeNew: 'dsh-memory-change-new',
  changeDiff: 'dsh-memory-change-diff',
  changeDiffCol: 'dsh-memory-change-diff-col',
  changeDiffDivider: 'dsh-memory-change-diff-divider',
  inlineForm: 'dsh-memory-inline-form',
  inlineInput: 'dsh-memory-inline-input',
  inlineTextarea: 'dsh-memory-inline-textarea',
  editButtons: 'dsh-memory-edit-buttons',
  addMeta: 'dsh-memory-add-meta',
  check: 'dsh-memory-check',
  switch: 'dsh-memory-switch',
  switchText: 'dsh-memory-switch-text',
  switchLine: 'dsh-memory-switch-line',
  batchCount: 'dsh-memory-batch-count',
  toggle: 'dsh-memory-toggle',
  toggleOn: 'dsh-memory-toggle-on',
  toggleOff: 'dsh-memory-toggle-off',
  error: 'dsh-memory-error',
  visuallyHidden: 'dsh-memory-visually-hidden',
  // 主从布局
  split: 'dsh-memory-split',
  listPane: 'dsh-memory-list-pane',
  listSection: 'dsh-memory-list-section',
  item: 'dsh-memory-item',
  itemSelected: 'dsh-memory-item-selected',
  itemBody: 'dsh-memory-item-body',
  itemCheck: 'dsh-memory-item-check',
  itemTitle: 'dsh-memory-item-title',
  itemTitleText: 'dsh-memory-item-title-text',
  itemSnippet: 'dsh-memory-item-snippet',
  itemTime: 'dsh-memory-item-time',
  detailPane: 'dsh-memory-detail-pane',
  detailHead: 'dsh-memory-detail-head',
  detailTitle: 'dsh-memory-detail-title',
  detailMeta: 'dsh-memory-detail-meta',
  metaBadge: 'dsh-memory-meta-badge',
  metaBadgeAccent: 'dsh-memory-meta-badge-accent',
  metaBadgeWarn: 'dsh-memory-meta-badge-warn',
  metaTime: 'dsh-memory-meta-time',
  importanceRow: 'dsh-memory-importance-row',
  importanceLabel: 'dsh-memory-importance-label',
  importanceBar: 'dsh-memory-importance-bar',
  importanceValue: 'dsh-memory-importance-value',
  detailBody: 'dsh-memory-detail-body',
  detailTags: 'dsh-memory-detail-tags',
  detailForm: 'dsh-memory-detail-form',
  revActions: 'dsh-memory-rev-actions',
  // 条目启用开关（行内迷你开关 + 禁用态弱化）
  itemRow: 'dsh-memory-item-row',
  miniSwitch: 'dsh-memory-mini-switch',
  miniSwitchOn: 'dsh-memory-mini-switch-on',
  itemDisabled: 'dsh-memory-item-disabled',
  disabledMark: 'dsh-memory-disabled-mark',
  scopeBadge: 'dsh-memory-scope-badge',
} as const

const STYLE_ID = 'dsh-memory-styles'

const SHEET = `
/* ── 面板骨架 ── */
.dsh-memory-modal-body{overflow:hidden;display:flex;flex-direction:column}
.dsh-memory-panel{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;overflow:hidden;padding:2px 2px 2px;box-sizing:border-box}

/* ── Tab：ghost 按钮组（与官方 ghost 控件同款：无辉光，选中=品牌色 12% 底）── */
.dsh-memory-tabs{flex:none;display:flex;align-items:center;gap:4px}
.dsh-memory-tab{appearance:none;border:none;background:transparent;border-radius:8px;height:32px;padding:0 14px;font-size:13px;line-height:22px;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;font-family:inherit;transition:background .16s cubic-bezier(.2,.8,.2,1),color .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-tab-active,.dsh-memory-tab-active:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4a9eff);font-weight:600}

/* ── 区块标题（caption：12/18/500）── */
.dsh-memory-section-title{margin:2px 2px 0;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}

/* ── 项目筛选：密集胶囊（h28 r14，border-l2；无辉光）── */
.dsh-memory-top-row{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.dsh-memory-project-chips{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.dsh-memory-project-chip{flex:none;display:inline-flex;align-items:center;gap:4px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:14px;height:28px;padding:0 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#eee);background:transparent;cursor:pointer;font-family:inherit;box-sizing:border-box;transition:background .16s cubic-bezier(.2,.8,.2,1),color .16s cubic-bezier(.2,.8,.2,1),border-color .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-project-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-memory-project-chip-active,.dsh-memory-project-chip-active:hover{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-state-business-primary,#4a9eff);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 12%,transparent)}

/* ── 搜索行 ── */
.dsh-memory-search-row{flex:none;display:flex;align-items:center;gap:6px}
.dsh-memory-search-input{flex:1;min-width:0;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-search-input::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
.dsh-memory-tag-select{height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:0 32px 0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background-color:var(--dsw-alias-bg-layer-1,#1c1f26);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px;appearance:none;max-width:240px;cursor:pointer}

/* ── 主从布局 ── */
.dsh-memory-split{flex:1;min-height:0;display:flex;align-items:stretch;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;overflow:hidden}

/* 左列：紧凑条目列表 */
.dsh-memory-list-pane{flex:none;width:320px;box-sizing:border-box;margin:0;padding:6px;list-style:none;overflow-y:auto;border-right:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));display:flex;flex-direction:column;gap:2px}
.dsh-memory-list-section{padding:10px 10px 4px;font-size:11px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-memory-item{display:flex;align-items:flex-start;gap:8px;width:100%;box-sizing:border-box;padding:8px 10px;border:none;border-left:2px solid transparent;border-radius:8px;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer;transition:background .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-memory-item-selected,.dsh-memory-item-selected:hover{background:var(--dsw-alias-button-ghost-active-fill,rgba(255,255,255,.08));border-left-color:var(--dsw-alias-state-business-primary,#4a9eff)}
/* 多选勾选框（自绘，选中=品牌蓝底白勾） */
.dsh-memory-item-check{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-top:1px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;color:#fff}
.dsh-memory-item-selected .dsh-memory-item-check{border-color:var(--dsw-alias-state-business-primary,#4a9eff);background:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-memory-item-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dsh-memory-item-title{display:flex;align-items:center;gap:4px;min-width:0}
.dsh-memory-item-title-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-item-snippet{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-memory-item-time{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}

/* 右侧：详情 */
.dsh-memory-detail-pane{flex:1;min-width:0;overflow-y:auto;padding:18px 20px 20px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}
.dsh-memory-detail-head{display:flex;align-items:flex-start;gap:8px}
.dsh-memory-detail-title{flex:1;min-width:0;margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary,#eee);word-break:break-word}
/* meta 徽章行：rowTag 规格 + 图标；语义色调（手动=品牌蓝 / 长期&置顶=暖金），时间右推 */
.dsh-memory-detail-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
.dsh-memory-meta-badge{display:inline-flex;align-items:center;gap:4px;max-width:200px;padding:1px 7px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);background:transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-memory-meta-badge svg{flex:none}
.dsh-memory-meta-badge-accent{color:var(--dsw-alias-state-business-primary,#4a9eff);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 10%,transparent)}
.dsh-memory-meta-badge-warn{color:var(--dsw-alias-state-warn-primary,#e8a33d);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 10%,transparent)}
.dsh-memory-meta-time{margin-left:auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}

/* 重要度可视化：caption 标签 + 4px 分段条（品牌蓝填充）+ 等宽数值 */
.dsh-memory-importance-row{display:flex;align-items:center;gap:8px;margin-top:-4px}
.dsh-memory-importance-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-memory-importance-bar{position:relative;flex:none;width:110px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l3,rgba(255,255,255,.16));overflow:hidden}
.dsh-memory-importance-bar i{position:absolute;top:0;bottom:0;left:0;display:block;border-radius:2px;background:var(--dsw-alias-state-business-primary,#4a9eff);transition:width .3s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-importance-value{font-variant-numeric:tabular-nums;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}

.dsh-memory-detail-body{min-width:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-detail-body .dsh-better-markdown__markdown p{margin:0 0 8px}
.dsh-memory-detail-body .dsh-better-markdown__markdown p:last-child{margin-bottom:0}
.dsh-memory-detail-tags{display:flex;flex-wrap:wrap;gap:4px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))}

/* ── 标签 chip：rowTag 规格（1px 6px、border-l3、r4、11/16）── */
.dsh-memory-chip{flex:none;display:inline-flex;align-items:center;padding:1px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;background:transparent;cursor:pointer;font-family:inherit}
.dsh-memory-chip:hover{color:var(--dsw-alias-label-primary,#eee);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
.dsh-memory-chip-active,.dsh-memory-chip-active:hover{color:var(--dsw-alias-state-business-primary,#4a9eff);border-color:var(--dsw-alias-state-business-primary,#4a9eff)}

/* ── 图标钮：常显 iconButton（28×28 r6）── */
.dsh-memory-card-actions{flex:none;display:flex;align-items:center;gap:4px;margin-left:auto}
.dsh-memory-icon-action{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888);box-sizing:border-box}
.dsh-memory-icon-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-icon-action-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(224,67,75,.12));color:var(--dsw-alias-state-error-primary,#e0434b)}
.dsh-memory-pin-mark{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-state-warn-primary,#e8a33d)}

/* ── 空态：dashed 占位盒 ── */
.dsh-memory-empty{margin:4px 2px;padding:14px 12px;display:flex;flex-direction:column;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);text-align:center;border:1px dashed var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:8px}

/* ── 变更列表（全宽）：描边卡 + rowTag 式状态徽章 + 前后对比 ── */
.dsh-memory-card-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.dsh-memory-change-row{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;padding:12px 14px}
.dsh-memory-change-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.dsh-memory-change-badge{flex:none;margin-top:2px;padding:1px 6px;border:1px solid var(--dsw-alias-state-warn-primary,#e8a33d);border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-primary,#e8a33d)}
.dsh-memory-change-badge-delete{border-color:var(--dsw-alias-state-error-primary,#e0434b);color:var(--dsw-alias-state-error-primary,#e0434b)}
.dsh-memory-change-old{color:var(--dsw-alias-label-tertiary,#888);text-decoration:line-through;opacity:.8}
.dsh-memory-change-new{color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-change-diff{flex:1;min-width:0;display:flex;align-items:stretch;gap:10px}
.dsh-memory-change-diff-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dsh-memory-change-diff-divider{flex:none;width:1px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
.dsh-memory-card-content{min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee);white-space:pre-wrap;word-break:break-word}
.dsh-memory-card-meta{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);flex-wrap:wrap}

/* ── 表单件：编辑面 = 官方 .editor（bg-module-platform 填充 + r12 + 14/16 内距）；输入件官方规格 ── */
.dsh-memory-detail-form{display:flex;flex-direction:column;gap:14px;border-radius:12px;background:var(--dsw-alias-bg-module-platform,#22262e);padding:14px 16px;box-sizing:border-box}
.dsh-memory-inline-form,.dsh-memory-detail-form textarea,.dsh-memory-detail-form .dsh-memory-inline-input{box-sizing:border-box}
.dsh-memory-inline-input{height:32px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-inline-textarea{min-height:64px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:8px 10px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26);resize:vertical;font-family:inherit;width:100%}
.dsh-memory-add-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-memory-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer}
/* ── 开关（DSH 规格：开=state-business-primary 底白钮；关=border-l2 底灰钮——
   关闭态绝不用白钮，浅色主题下会隐形）── */
.dsh-memory-switch-line{display:inline-flex;align-items:center;gap:8px}
.dsh-memory-switch{position:relative;flex:none;width:40px;height:22px;border:none;border-radius:11px;padding:0;background:var(--dsw-alias-border-l2,rgba(255,255,255,.14));cursor:pointer;transition:background .16s cubic-bezier(.2,.8,.2,1);box-sizing:border-box}
.dsh-memory-switch::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#81858c);box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .16s cubic-bezier(.2,.8,.2,1),background .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-switch[aria-checked='true']{background:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-memory-switch[aria-checked='true']::after{transform:translateX(18px);background:#fff}
.dsh-memory-switch:disabled{opacity:.5;cursor:default}
.dsh-memory-switch-text{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}
/* ── 多选操作栏 ── */
.dsh-memory-batch-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-edit-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px}

/* ── 注入开关（composer 工具行）：iconButton 规格 ── */
.dsh-memory-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888);box-sizing:border-box}
.dsh-memory-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-memory-toggle-on,.dsh-memory-toggle-on:hover{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-memory-toggle-off{color:var(--dsw-alias-label-tertiary,#888);opacity:.55}

.dsh-memory-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e0434b)}

/* ── 修订版本（回滚按钮行）── */
.dsh-memory-rev-actions{display:flex;align-items:center;gap:8px}
.dsh-memory-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ── focus 规范 ── */
.dsh-memory-search-input:focus,.dsh-memory-search-input:focus-visible,
.dsh-memory-inline-input:focus,.dsh-memory-inline-input:focus-visible,
.dsh-memory-inline-textarea:focus,.dsh-memory-inline-textarea:focus-visible,
.dsh-memory-tag-select:focus,.dsh-memory-tag-select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dsh-memory-tab:focus-visible,.dsh-memory-project-chip:focus-visible,.dsh-memory-chip:focus-visible,
.dsh-memory-icon-action:focus-visible,.dsh-memory-toggle:focus-visible,.dsh-memory-item:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3,rgba(255,255,255,.16))}

/* ── 条目启用开关：行内迷你开关（span role=switch，避免 button 嵌套）+ 禁用弱化 ── */
.dsh-memory-item-row{position:relative}
.dsh-memory-item-row .dsh-memory-item{padding-right:56px}
.dsh-memory-mini-switch{position:absolute;top:12px;right:12px;z-index:1;width:30px;height:17px;border-radius:9px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.14));cursor:pointer;transition:background .16s cubic-bezier(.2,.8,.2,1);box-sizing:border-box}
.dsh-memory-mini-switch::after{content:'';position:absolute;top:2.5px;left:2.5px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#81858c);box-shadow:0 1px 2px rgba(0,0,0,.35);transition:transform .16s cubic-bezier(.2,.8,.2,1),background .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-mini-switch:hover{background:var(--dsw-alias-label-dimmed,rgba(255,255,255,.28))}
.dsh-memory-mini-switch-on,.dsh-memory-mini-switch-on:hover{background:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-memory-mini-switch-on::after{transform:translateX(13px);background:#fff}
.dsh-memory-mini-switch:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3,rgba(255,255,255,.16))}
.dsh-memory-item-disabled{opacity:.55}
.dsh-memory-disabled-mark{flex:none;margin-left:6px;padding:0 5px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.18));border-radius:4px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap}
/* 行内作用域徽章（全局/项目名）：中性色紧凑版，图标+短名，超长省略 */
.dsh-memory-scope-badge{flex:none;display:inline-flex;align-items:center;gap:3px;max-width:88px;padding:0 5px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-memory-scope-badge svg{flex:none}

/* ── 窄屏：主从改上下堆叠 ── */
@media (max-width: 767.98px) {
  .dsh-memory-split{flex-direction:column}
  .dsh-memory-list-pane{width:100%;max-height:38%;border-right:none;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
  .dsh-memory-project-chip{max-width:150px}
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
