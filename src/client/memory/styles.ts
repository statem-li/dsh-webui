/**
 * dsh-memory — 样式（运行时注入 <style>，卸载时由 loader 清理）。
 * 类名前缀 dsh-memory-；规格对齐官方 ui-settings-models 的 ModelsSection.module.css：
 * 32px 输入件 / h28 r14 密集胶囊 / h36 r18 大胶囊 / border-l2 细线 / 14-22 正文 / 12-18 caption。
 *
 * 结构（卡片由 PopoverShell solid 模式提供不透明实底，玻璃质感对其豁免）：
 *  ┌ head：下划线式 Tab（选中=品牌蓝指示条）+ 右贴统计（窄屏折叠）
 *  ├ toolbar（全部）：搜索 · 作用域下拉 · 标签下拉 | 刷新 / 整理 + 添加 / 多选
 *  ├ toolbar（变更）：作用域下拉 | 今天/全部 段控 + 计数 + 刷新
 *  ├ 上下文条（选中具体项目时）：项目名 + 别名 / 自动记忆开关 / 清空
 *  └ split：左 listPane（紧凑条目行 + 时间分组小节 + 行内启用开关）
 *           右 detailPane（标题 · 徽章行 · 指标带（重要度/置信度）· 正文 · 标签 · 脚注）
 *           表单态（添加/编辑/移动）占据同一右区，用 bg-module-platform 填充面区分
 * 「修订」「设置」Tab 为全宽列表；设置分组为行卡片式（label + hint + 控件右对齐）。
 */

export const css = {
  modalBody: 'dsh-memory-modal-body',
  panel: 'dsh-memory-panel',
  head: 'dsh-memory-head',
  tabs: 'dsh-memory-tabs',
  tab: 'dsh-memory-tab',
  tabActive: 'dsh-memory-tab-active',
  tabCount: 'dsh-memory-tab-count',
  statBar: 'dsh-memory-stat-bar',
  stat: 'dsh-memory-stat',
  statLong: 'dsh-memory-stat-long',
  statValue: 'dsh-memory-stat-value',
  statDot: 'dsh-memory-stat-dot',
  topRow: 'dsh-memory-top-row',
  projectName: 'dsh-memory-project-name',
  projectTools: 'dsh-memory-project-tools',
  searchRow: 'dsh-memory-search-row',
  searchBox: 'dsh-memory-search-box',
  searchIcon: 'dsh-memory-search-icon',
  searchInput: 'dsh-memory-search-input',
  searchClear: 'dsh-memory-search-clear',
  tagSelect: 'dsh-memory-tag-select',
  scopeSelect: 'dsh-memory-scope-select',
  barSep: 'dsh-memory-bar-sep',
  segment: 'dsh-memory-segment',
  segmentItem: 'dsh-memory-segment-item',
  segmentItemActive: 'dsh-memory-segment-item-active',
  spacer: 'dsh-memory-spacer',
  cardList: 'dsh-memory-card-list',
  cardContent: 'dsh-memory-card-content',
  cardMeta: 'dsh-memory-card-meta',
  chip: 'dsh-memory-chip',
  chipActive: 'dsh-memory-chip-active',
  cardActions: 'dsh-memory-card-actions',
  iconAction: 'dsh-memory-icon-action',
  iconActionDanger: 'dsh-memory-icon-action-danger',
  iconActionBusy: 'dsh-memory-icon-action-busy',
  pinMark: 'dsh-memory-pin-mark',
  empty: 'dsh-memory-empty',
  emptyIcon: 'dsh-memory-empty-icon',
  emptyText: 'dsh-memory-empty-text',
  emptyHint: 'dsh-memory-empty-hint',
  changeRow: 'dsh-memory-change-row',
  changeMain: 'dsh-memory-change-main',
  changeBadge: 'dsh-memory-change-badge',
  changeBadgeAdd: 'dsh-memory-change-badge-add',
  changeBadgeDelete: 'dsh-memory-change-badge-delete',
  changeBadgePromote: 'dsh-memory-change-badge-promote',
  changeBadgeRevise: 'dsh-memory-change-badge-revise',
  changeBadgeRetire: 'dsh-memory-change-badge-retire',
  changeOld: 'dsh-memory-change-old',
  changeNew: 'dsh-memory-change-new',
  changeDiff: 'dsh-memory-change-diff',
  changeDiffCol: 'dsh-memory-change-diff-col',
  changeDiffDivider: 'dsh-memory-change-diff-divider',
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
  notice: 'dsh-memory-notice',
  split: 'dsh-memory-split',
  listPane: 'dsh-memory-list-pane',
  listSection: 'dsh-memory-list-section',
  listSectionCount: 'dsh-memory-list-section-count',
  item: 'dsh-memory-item',
  itemSelected: 'dsh-memory-item-selected',
  itemBody: 'dsh-memory-item-body',
  itemCheck: 'dsh-memory-item-check',
  itemTitle: 'dsh-memory-item-title',
  itemTitleText: 'dsh-memory-item-title-text',
  itemSnippet: 'dsh-memory-item-snippet',
  itemFoot: 'dsh-memory-item-foot',
  itemTime: 'dsh-memory-item-time',
  itemScore: 'dsh-memory-item-score',
  detailPane: 'dsh-memory-detail-pane',
  detailHead: 'dsh-memory-detail-head',
  detailTitle: 'dsh-memory-detail-title',
  detailMeta: 'dsh-memory-detail-meta',
  metaBadge: 'dsh-memory-meta-badge',
  metaBadgeAccent: 'dsh-memory-meta-badge-accent',
  metaBadgeWarn: 'dsh-memory-meta-badge-warn',
  metaBadgeMuted: 'dsh-memory-meta-badge-muted',
  metaTime: 'dsh-memory-meta-time',
  importanceRow: 'dsh-memory-importance-row',
  importanceLabel: 'dsh-memory-importance-label',
  importanceBar: 'dsh-memory-importance-bar',
  importanceValue: 'dsh-memory-importance-value',
  detailBody: 'dsh-memory-detail-body',
  detailTags: 'dsh-memory-detail-tags',
  detailFoot: 'dsh-memory-detail-foot',
  detailForm: 'dsh-memory-detail-form',
  formTitle: 'dsh-memory-form-title',
  field: 'dsh-memory-field',
  fieldLabel: 'dsh-memory-field-label',
  fieldRow: 'dsh-memory-field-row',
  revActions: 'dsh-memory-rev-actions',
  itemRow: 'dsh-memory-item-row',
  miniSwitch: 'dsh-memory-mini-switch',
  miniSwitchOn: 'dsh-memory-mini-switch-on',
  itemDisabled: 'dsh-memory-item-disabled',
  itemRetired: 'dsh-memory-item-retired',
  disabledMark: 'dsh-memory-disabled-mark',
  retiredMark: 'dsh-memory-retired-mark',
  scopeBadge: 'dsh-memory-scope-badge',
  settingsBody: 'dsh-memory-settings-body',
  settingsGroup: 'dsh-memory-settings-group',
  settingsGroupTitle: 'dsh-memory-settings-group-title',
  settingsRow: 'dsh-memory-settings-row',
  settingsMain: 'dsh-memory-settings-main',
  settingsLabel: 'dsh-memory-settings-label',
  settingsHint: 'dsh-memory-settings-hint',
  settingsControl: 'dsh-memory-settings-control',
  numberInput: 'dsh-memory-number-input',
  settingsFoot: 'dsh-memory-settings-foot',
  skeleton: 'dsh-memory-skeleton',
  skeletonRow: 'dsh-memory-skeleton-row',
} as const

const STYLE_ID = 'dsh-memory-styles'

const SHEET = `
/* ── 面板骨架 ───────────────────────────────────────────────────────── */
.dsh-memory-modal-body{overflow:hidden;display:flex;flex-direction:column}
/* 面板自身不留内距：分区（工具栏 / 主从区）各自持有 16px 边距，
   保证任何一行的右端元素都不会贴到卡片边缘被裁掉。 */
.dsh-memory-panel{flex:1;min-height:0;display:flex;flex-direction:column;gap:0;overflow:hidden;padding:0;box-sizing:border-box;color:var(--dsw-alias-label-primary,#eee)}

/* ── 头部：Tab 组（左）+ 统计条（右），下沉一条分隔线 ──────────────── */
.dsh-memory-head{flex:none;display:flex;align-items:center;gap:16px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}
.dsh-memory-tabs{display:flex;align-items:center;gap:4px;min-width:0}
/* 下划线式 Tab（卡片标题下的二级导航）：选中=品牌蓝文字 + 2px 底部指示条。
   比胶囊段控更贴合「标题→分区」的层级关系，也不会在头部堆两层容器底色。 */
.dsh-memory-tab{position:relative;appearance:none;border:none;background:transparent;border-radius:6px 6px 0 0;height:32px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;font-family:inherit;transition:color .16s cubic-bezier(.2,.8,.2,1),background .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-tab-active,.dsh-memory-tab-active:hover{background:transparent;color:var(--dsw-alias-state-business-primary,#4176e6);font-weight:600}
/* 指示条压在 head 的分隔线上（bottom:-11px = head 的 10px 内距 + 1px 线） */
.dsh-memory-tab-active::after{content:'';position:absolute;left:8px;right:8px;bottom:-11px;height:2px;border-radius:1px;background:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-memory-tab-count{flex:none;min-width:16px;padding:0 5px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 16%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);font-size:10px;font-weight:600;line-height:15px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-memory-tab:not(.dsh-memory-tab-active) .dsh-memory-tab-count{background:var(--dsw-alias-border-l2,rgba(255,255,255,.12));color:var(--dsw-alias-label-tertiary,#888)}

/* 统计条：右贴的 caption 数值组（记忆数 · 项目 · 置顶 · 长期） */
.dsh-memory-stat-bar{display:flex;align-items:center;gap:10px;margin-left:auto;min-width:0}
.dsh-memory-stat{display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}
.dsh-memory-stat-value{font-variant-numeric:tabular-nums;font-weight:600;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-memory-stat-dot{flex:none;width:4px;height:4px;border-radius:50%;background:var(--dsw-alias-border-l3,rgba(255,255,255,.2))}

/* ── 项目上下文条：仅在筛选到具体项目时出现（别名 / 自动记忆 / 清空）── */
.dsh-memory-top-row{flex:none;display:flex;align-items:center;gap:10px;padding:8px 16px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04));border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}
/* 项目名（上下文条左端标题）+ 右端工具组 */
.dsh-memory-project-name{flex:none;display:inline-flex;align-items:center;gap:6px;max-width:280px;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,#eee);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-memory-project-tools{display:flex;align-items:center;gap:10px;margin-left:auto}

/* ── 工具栏：搜索（弹性）+ 作用域/标签下拉 + 图标动作 + 主按钮 ────── */
.dsh-memory-search-row{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}
.dsh-memory-search-box{position:relative;flex:1;min-width:160px;max-width:420px;display:flex;align-items:center}
.dsh-memory-search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);display:inline-flex;color:var(--dsw-alias-label-tertiary,#888);pointer-events:none}
.dsh-memory-search-input{flex:1;min-width:0;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:0 30px 0 32px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-search-input::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
.dsh-memory-search-clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:5px;padding:0;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer}
.dsh-memory-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-tag-select{height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:0 32px 0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background-color:var(--dsw-alias-bg-layer-1,#1c1f26);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px;appearance:none;max-width:240px;cursor:pointer}
/* 作用域下拉（全部 / 全局 / 各项目）：与标签下拉同规格，宽度更紧凑 */
.dsh-memory-scope-select{flex:none;max-width:180px}
/* 工具栏分隔竖线（筛选区 ↔ 动作区） */
.dsh-memory-bar-sep{flex:none;width:1px;height:20px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
/* 段控（今天 / 全部）：h32 与同行输入件等高，选中=实底 + 品牌蓝字 */
.dsh-memory-segment{flex:none;display:inline-flex;align-items:center;gap:2px;padding:2px;height:32px;box-sizing:border-box;border-radius:8px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04))}
.dsh-memory-segment-item{appearance:none;border:none;background:transparent;border-radius:6px;height:28px;padding:0 14px;font-size:13px;line-height:20px;font-family:inherit;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;transition:background .16s cubic-bezier(.2,.8,.2,1),color .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-segment-item:hover{color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-segment-item-active,.dsh-memory-segment-item-active:hover{background:var(--dsw-alias-button-elevated-fill,#fff);color:var(--dsw-alias-state-business-primary,#4176e6);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.dsh-memory-segment-item:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3,rgba(255,255,255,.16))}
.dsh-memory-spacer{flex:1 1 auto;min-width:0}

/* ── 主从布局：卡片内留 16px 边距，圆角描边容器 ─────────────────────── */
.dsh-memory-split{flex:1;min-height:0;margin:16px;display:flex;align-items:stretch;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;overflow:hidden}

/* 左列：紧凑条目列表 */
.dsh-memory-list-pane{flex:none;width:320px;box-sizing:border-box;margin:0;padding:8px;list-style:none;overflow-y:auto;border-right:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));display:flex;flex-direction:column;gap:2px}
.dsh-memory-list-section{display:flex;align-items:center;gap:6px;padding:12px 10px 6px;font-size:11px;font-weight:600;line-height:16px;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#888);text-transform:none}
.dsh-memory-list-section-count{font-variant-numeric:tabular-nums;font-weight:400;color:var(--dsw-alias-label-dimmed,#666)}
/* 行：静默描边式（无底色），选中=品牌蓝浅底 + 左侧 3px 强调条（::before，
   不用 border-left——描边会与 8px 圆角割出一截直角）。 */
.dsh-memory-item{position:relative;display:flex;align-items:flex-start;gap:8px;width:100%;box-sizing:border-box;padding:9px 10px 9px 12px;border:none;border-radius:8px;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer;transition:background .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-memory-item-selected,.dsh-memory-item-selected:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 10%,transparent)}
.dsh-memory-item-selected::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 2px 2px 0;background:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-memory-item-selected .dsh-memory-item-title-text{font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
/* 多选勾选框（自绘，选中=品牌蓝底白勾） */
.dsh-memory-item-check{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-top:2px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;color:#fff}
.dsh-memory-item-selected .dsh-memory-item-check{border-color:var(--dsw-alias-state-business-primary,#4176e6);background:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-memory-item-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dsh-memory-item-title{display:flex;align-items:center;gap:4px;min-width:0}
.dsh-memory-item-title-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-item-snippet{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-memory-item-foot{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-memory-item-time{white-space:nowrap}
/* 行内重要度：3px 迷你条，跟随重要度宽度（--pct 由内联样式给） */
.dsh-memory-item-score{position:relative;flex:none;width:34px;height:3px;border-radius:2px;background:var(--dsw-alias-border-l3,rgba(255,255,255,.16));overflow:hidden}
.dsh-memory-item-score::after{content:'';position:absolute;inset:0 auto 0 0;width:var(--pct,0%);border-radius:2px;background:var(--dsw-alias-state-business-primary,#4176e6)}

/* 右侧：详情。头部 meta 与脚注为 sticky 层次的静态区，正文区自由滚动 */
.dsh-memory-detail-pane{flex:1;min-width:0;overflow-y:auto;padding:20px 24px 20px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box}
.dsh-memory-detail-head{display:flex;align-items:flex-start;gap:8px}
.dsh-memory-detail-title{flex:1;min-width:0;margin:0;font-size:17px;line-height:26px;font-weight:600;color:var(--dsw-alias-label-primary,#eee);word-break:break-word}
/* meta 徽章行：rowTag 规格 + 图标；语义色调（手动=品牌蓝 / 长期&置顶=暖金），时间右推 */
.dsh-memory-detail-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-memory-meta-badge{display:inline-flex;align-items:center;gap:4px;max-width:220px;padding:1px 7px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);background:transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-memory-meta-badge svg{flex:none}
.dsh-memory-meta-badge-accent{color:var(--dsw-alias-state-business-primary,#4176e6);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 10%,transparent)}
.dsh-memory-meta-badge-warn{color:var(--dsw-alias-state-warn-primary,#e8a33d);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 10%,transparent)}
.dsh-memory-meta-badge-muted{color:var(--dsw-alias-label-tertiary,#888);border-style:dashed}
.dsh-memory-meta-time{margin-left:auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}

/* 指标带：重要度 / 置信度（bg-module-platform 填充面，与正文区分层） */
.dsh-memory-importance-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04))}
.dsh-memory-importance-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-memory-importance-bar{position:relative;flex:none;width:96px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l3,rgba(255,255,255,.16));overflow:hidden}
.dsh-memory-importance-bar i{position:absolute;top:0;bottom:0;left:0;display:block;border-radius:2px;background:var(--dsw-alias-state-business-primary,#4176e6);transition:width .3s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-importance-value{font-variant-numeric:tabular-nums;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
/* 指标之间的分隔（第二组指标前推一段距离） */
.dsh-memory-importance-row .dsh-memory-stat-dot{margin:0 2px}

.dsh-memory-detail-body{min-width:0;flex:1;padding-top:2px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#eee);word-break:break-word}
.dsh-memory-detail-body .dsh-better-markdown__markdown p{margin:0 0 8px}
.dsh-memory-detail-body .dsh-better-markdown__markdown p:last-child{margin-bottom:0}
.dsh-memory-detail-tags{display:flex;flex-wrap:wrap;gap:4px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}
/* 详情脚注：版本 / 创建时间 / 命中时间（caption，弱化） */
.dsh-memory-detail-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
/* 标签块紧跟脚注时不重复画线（避免两条相邻细线） */
.dsh-memory-detail-tags+.dsh-memory-detail-foot{padding-top:0;border-top:none}

/* ── 标签 chip：rowTag 规格（1px 6px、border-l3、r4、11/16）── */
.dsh-memory-chip{flex:none;display:inline-flex;align-items:center;padding:1px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;background:transparent;cursor:pointer;font-family:inherit}
.dsh-memory-chip:hover{color:var(--dsw-alias-label-primary,#eee);border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
.dsh-memory-chip-active,.dsh-memory-chip-active:hover{color:var(--dsw-alias-state-business-primary,#4176e6);border-color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 10%,transparent)}

/* ── 图标钮：常显 iconButton（28×28 r6）── */
.dsh-memory-card-actions{flex:none;display:flex;align-items:center;gap:4px;margin-left:auto}
.dsh-memory-icon-action{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888);box-sizing:border-box;transition:background .16s ease,color .16s ease}
.dsh-memory-icon-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-icon-action:disabled{opacity:.4;cursor:default}
.dsh-memory-icon-action-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(224,67,75,.12));color:var(--dsw-alias-state-error-primary,#e0434b)}
.dsh-memory-icon-action-busy svg{animation:dsh-memory-spin 900ms linear infinite}
@keyframes dsh-memory-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.dsh-memory-pin-mark{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-state-warn-primary,#e8a33d)}

/* ── 空态：dashed 占位盒（图标 + 主文案 + 提示）── */
.dsh-memory-empty{flex:1;min-height:120px;margin:16px;padding:24px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888);text-align:center;border:1px dashed var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:12px;box-sizing:border-box}
.dsh-memory-empty-icon{display:inline-flex;color:var(--dsw-alias-label-dimmed,#666);opacity:.7}
.dsh-memory-empty-text{color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-memory-empty-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-dimmed,#666);max-width:420px}
/* 左列空态：占满列宽、去外边距（列本身已有 8px 内距） */
.dsh-memory-list-pane .dsh-memory-empty{margin:0;min-height:0}
/* 右列空态：详情区已有 20px 内距，不再叠外边距 */
.dsh-memory-detail-pane .dsh-memory-empty{margin:0}

/* ── 变更列表（全宽）：描边卡 + rowTag 式状态徽章 + 前后对比 ── */
.dsh-memory-card-list{flex:1;min-height:0;list-style:none;margin:0;padding:16px;display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.dsh-memory-change-row{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;padding:12px 14px}
.dsh-memory-change-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.dsh-memory-change-badge{flex:none;margin-top:2px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);white-space:nowrap}
.dsh-memory-change-badge-add{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3aa675) 45%,transparent);color:var(--dsw-alias-state-success-primary,#3aa675);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3aa675) 10%,transparent)}
.dsh-memory-change-badge-promote{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 45%,transparent);color:var(--dsw-alias-state-warn-primary,#e8a33d);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 10%,transparent)}
.dsh-memory-change-badge-delete{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 45%,transparent);color:var(--dsw-alias-state-error-primary,#e0434b);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 10%,transparent)}
/* 修订（revise）：中性描边 + 弱紫蓝强调，表示「重写而非移除」 */
.dsh-memory-change-badge-revise{border-color:color-mix(in srgb,var(--dsw-alias-state-info-primary,#5b9dff) 45%,transparent);color:var(--dsw-alias-state-info-primary,#5b9dff);background:color-mix(in srgb,var(--dsw-alias-state-info-primary,#5b9dff) 10%,transparent)}
/* 软废弃（retire）：暖橙描边，表示「淡出而非消失」 */
.dsh-memory-change-badge-retire{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 45%,transparent);color:var(--dsw-alias-state-warn-primary,#e8a33d);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 10%,transparent)}
.dsh-memory-change-old{color:var(--dsw-alias-label-tertiary,#888);text-decoration:line-through;opacity:.8}
.dsh-memory-change-new{color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-change-diff{flex:1;min-width:0;display:flex;align-items:stretch;gap:10px}
.dsh-memory-change-diff-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dsh-memory-change-diff-divider{flex:none;width:1px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
.dsh-memory-card-content{min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee);white-space:pre-wrap;word-break:break-word}
.dsh-memory-card-meta{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);flex-wrap:wrap}

/* ── 表单件：编辑面 = 官方 .editor（bg-module-platform 填充 + r12 + 14/16 内距）── */
.dsh-memory-detail-form{display:flex;flex-direction:column;gap:14px;border-radius:12px;background:var(--dsw-alias-bg-module-platform,#22262e);padding:16px;box-sizing:border-box}
.dsh-memory-form-title{font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-memory-field-label{display:inline-flex;align-items:center;gap:8px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-memory-field-row{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}
.dsh-memory-detail-form textarea,.dsh-memory-detail-form .dsh-memory-inline-input{box-sizing:border-box}
.dsh-memory-inline-input{height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-inline-input::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
.dsh-memory-inline-textarea{min-height:64px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:8px 10px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26);resize:vertical;font-family:inherit;width:100%}
.dsh-memory-inline-textarea::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
.dsh-memory-add-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-memory-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer}
.dsh-memory-check input{accent-color:var(--dsw-alias-state-business-primary,#4176e6);margin:0}

/* ── 开关（DSH 规格：开=state-business-primary 底白钮；关=border-l2 底灰钮）── */
.dsh-memory-switch-line{display:inline-flex;align-items:center;gap:8px}
.dsh-memory-switch{position:relative;flex:none;width:40px;height:22px;border:none;border-radius:11px;padding:0;background:var(--dsw-alias-border-l2,rgba(255,255,255,.14));cursor:pointer;transition:background .16s cubic-bezier(.2,.8,.2,1);box-sizing:border-box}
.dsh-memory-switch::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#81858c);box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform .16s cubic-bezier(.2,.8,.2,1),background .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-switch[aria-checked='true']{background:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-memory-switch[aria-checked='true']::after{transform:translateX(18px);background:#fff}
.dsh-memory-switch:disabled{opacity:.5;cursor:default}
.dsh-memory-switch-text{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}

/* ── 多选操作栏 ── */
.dsh-memory-batch-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#eee);font-variant-numeric:tabular-nums}
.dsh-memory-edit-buttons{display:flex;align-items:center;justify-content:flex-end;gap:8px}

/* ── 注入开关（composer 工具行）：iconButton 规格 ── */
.dsh-memory-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888);box-sizing:border-box}
.dsh-memory-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-memory-toggle-on,.dsh-memory-toggle-on:hover{color:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-memory-toggle-off{color:var(--dsw-alias-label-tertiary,#888);opacity:.55}

.dsh-memory-error{flex:none;margin:12px 16px 0;padding:8px 12px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 8%,transparent);font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e0434b)}
.dsh-memory-notice{flex:none;margin:12px 16px 0;padding:8px 12px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#3aa675) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3aa675) 8%,transparent);font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary,#3aa675)}

/* ── 修订版本（回滚按钮行）── */
.dsh-memory-rev-actions{display:flex;align-items:center;gap:8px}

/* ── 设置 Tab：分组 + 行卡片（label/hint 左，控件右）───────────────── */
.dsh-memory-settings-body{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:20px}
.dsh-memory-settings-group{display:flex;flex-direction:column;gap:2px}
.dsh-memory-settings-group-title{padding:0 2px 6px;font-size:14px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-settings-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;box-sizing:border-box}
.dsh-memory-settings-row+.dsh-memory-settings-row{margin-top:6px}
.dsh-memory-settings-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-memory-settings-label{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-settings-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-memory-settings-control{flex:none;display:flex;align-items:center;gap:8px}
.dsh-memory-number-input{width:96px;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-settings-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:4px}

/* ── 骨架屏（首次加载，替代「读取中…」文字）─────────────────────── */
.dsh-memory-skeleton{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:16px}
.dsh-memory-skeleton-row{height:48px;border-radius:10px;background:var(--dsw-alias-bg-skeleton,rgba(255,255,255,.06));animation:dsh-memory-pulse 1.4s ease-in-out infinite}
.dsh-memory-skeleton-row:nth-child(2){animation-delay:.12s}
.dsh-memory-skeleton-row:nth-child(3){animation-delay:.24s}
.dsh-memory-skeleton-row:nth-child(4){animation-delay:.36s}
@keyframes dsh-memory-pulse{0%,100%{opacity:.45}50%{opacity:.9}}

/* ── focus 规范（品牌蓝描边，绝不用反色 brand-primary）───────────── */
.dsh-memory-search-input:focus,.dsh-memory-search-input:focus-visible,
.dsh-memory-inline-input:focus,.dsh-memory-inline-input:focus-visible,
.dsh-memory-inline-textarea:focus,.dsh-memory-inline-textarea:focus-visible,
.dsh-memory-number-input:focus,.dsh-memory-number-input:focus-visible,
.dsh-memory-tag-select:focus,.dsh-memory-tag-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-memory-tab:focus-visible,.dsh-memory-chip:focus-visible,
.dsh-memory-icon-action:focus-visible,.dsh-memory-toggle:focus-visible,.dsh-memory-item:focus-visible,
.dsh-memory-switch:focus-visible,.dsh-memory-search-clear:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3,rgba(255,255,255,.16))}

/* ── 条目启用开关：行内迷你开关（span role=switch，避免 button 嵌套）+ 禁用弱化 ── */
.dsh-memory-item-row{position:relative}
.dsh-memory-item-row .dsh-memory-item{padding-right:52px}
.dsh-memory-mini-switch{position:absolute;top:11px;right:10px;z-index:1;width:28px;height:16px;border-radius:8px;background:var(--dsw-alias-border-l3,rgba(255,255,255,.16));cursor:pointer;transition:background .16s cubic-bezier(.2,.8,.2,1);box-sizing:border-box}
.dsh-memory-mini-switch::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#81858c);box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .16s cubic-bezier(.2,.8,.2,1),background .16s cubic-bezier(.2,.8,.2,1)}
.dsh-memory-mini-switch:hover{background:var(--dsw-alias-border-l4,rgba(255,255,255,.2))}
.dsh-memory-mini-switch-on,.dsh-memory-mini-switch-on:hover{background:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-memory-mini-switch-on::after{transform:translateX(12px);background:#fff}
.dsh-memory-mini-switch:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3,rgba(255,255,255,.16))}
.dsh-memory-item-disabled{opacity:.55}
/* 软废弃条目：整体淡化 + 删除线过渡（禁用=冻结，废弃=淡出；hover 微反馈） */
.dsh-memory-item-retired{opacity:.6;transition:opacity .2s ease}
.dsh-memory-item-retired:hover{opacity:.85}
.dsh-memory-item-retired .dsh-memory-item-title-text{text-decoration:line-through;text-decoration-color:var(--dsw-alias-state-warn-primary,#e8a33d);text-decoration-thickness:1px}
.dsh-memory-disabled-mark{flex:none;margin-left:2px;padding:0 5px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.18));border-radius:4px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap}
/* 软废弃徽标（retired）：与禁用同款几何，暖橙描边区分「已淡出」状态 */
.dsh-memory-retired-mark{flex:none;margin-left:2px;padding:0 5px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 45%,transparent);border-radius:4px;font-size:10px;line-height:14px;color:var(--dsw-alias-state-warn-primary,#e8a33d);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 10%,transparent);white-space:nowrap}
/* 行内作用域徽章（全局/项目名）：中性色紧凑版，图标+短名，超长省略 */
.dsh-memory-scope-badge{flex:none;display:inline-flex;align-items:center;gap:3px;max-width:88px;padding:0 5px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-memory-scope-badge svg{flex:none}

/* ── 窄屏：收窄左列 / 主从改上下堆叠 ── */
@media (max-width: 1100px) {
  .dsh-memory-list-pane{width:280px}
  .dsh-memory-stat-bar .dsh-memory-stat-long{display:none}
}
@media (max-width: 900px) {
  .dsh-memory-list-pane{width:250px}
  .dsh-memory-stat-bar{display:none}
}
@media (max-width: 767.98px) {
  .dsh-memory-split{flex-direction:column;margin:12px}
  .dsh-memory-list-pane{width:100%;max-height:40%;border-right:none;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))}
  .dsh-memory-search-row{flex-wrap:wrap}
  .dsh-memory-search-box{max-width:none}
  .dsh-memory-settings-row{align-items:flex-start;flex-direction:column;gap:8px}
  .dsh-memory-settings-control{width:100%;justify-content:flex-start}
}
@media (prefers-reduced-motion: reduce) {
  .dsh-memory-skeleton-row,.dsh-memory-icon-action-busy svg{animation:none}
  .dsh-memory-importance-bar i{transition:none}
}
`

/** 注入样式表（幂等；loader 卸载插件时会移除其 style 标签）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
