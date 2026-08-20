/**
 * dsh-memory — 样式（运行时注入 <style>，卸载时由 loader 清理）。
 * 类名前缀 dsh-memory-；颜色走 DSH 主题令牌（--dsw-alias-*）。
 */

export const css = {
  entry: 'dsh-memory-entry',
  entryBadge: 'dsh-memory-entry-badge',
  label: 'dsh-memory-label',
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
  card: 'dsh-memory-card',
  cardPinned: 'dsh-memory-card-pinned',
  cardMain: 'dsh-memory-card-main',
  cardHead: 'dsh-memory-card-head',
  cardContent: 'dsh-memory-card-content',
  cardFoot: 'dsh-memory-card-foot',
  cardMeta: 'dsh-memory-card-meta',
  chips: 'dsh-memory-chips',
  chip: 'dsh-memory-chip',
  chipActive: 'dsh-memory-chip-active',
  cardActions: 'dsh-memory-card-actions',
  iconAction: 'dsh-memory-icon-action',
  pinMark: 'dsh-memory-pin-mark',
  empty: 'dsh-memory-empty',
  changeRow: 'dsh-memory-change-row',
  changeBadge: 'dsh-memory-change-badge',
  changeBadgeDelete: 'dsh-memory-change-badge-delete',
  changeSummary: 'dsh-memory-change-summary',
  changeActions: 'dsh-memory-change-actions',
  changeOld: 'dsh-memory-change-old',
  changeNew: 'dsh-memory-change-new',
  changeDiff: 'dsh-memory-change-diff',
  changeDiffCol: 'dsh-memory-change-diff-col',
  changeDiffDivider: 'dsh-memory-change-diff-divider',
  inlineForm: 'dsh-memory-inline-form',
  inlineInput: 'dsh-memory-inline-input',
  inlineTextarea: 'dsh-memory-inline-textarea',
  editButtons: 'dsh-memory-edit-buttons',
  addRow: 'dsh-memory-add-row',
  addButton: 'dsh-memory-add-button',
  addForm: 'dsh-memory-add-form',
  addMeta: 'dsh-memory-add-meta',
  check: 'dsh-memory-check',
  toggle: 'dsh-memory-toggle',
  toggleOn: 'dsh-memory-toggle-on',
  toggleOff: 'dsh-memory-toggle-off',
  error: 'dsh-memory-error',
  visuallyHidden: 'dsh-memory-visually-hidden',
} as const

const STYLE_ID = 'dsh-memory-styles'

const SHEET = `
/* usage-skill 的合并按钮（用量+技能，order 10）默认 flex:none;width:100% 占满整行，
   会把同行的记忆按钮挤成图标；实测固定 150px（用量/技能各 75px 完整显示），
   记忆按钮占剩余空间（约 102px），三者均无文字挤压。rail 收起态恢复 usage 原宽。 */
.usg_layer{flex:none !important;width:150px !important;min-width:0}
.usg_layer.usg_rail{width:36px !important}
.usg_layer .usg_footerButtons{flex-wrap:nowrap}
.usg_layer .usg_footerButtons > *{min-width:0}
.dsh-memory-entry{flex:1 1 auto !important;min-width:0;position:relative;display:inline-flex;align-items:center;gap:8px;height:32px;box-sizing:border-box;border:none;border-radius:10px;padding:0 8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary,#eee);font-family:inherit;font-size:14px;line-height:20px;overflow:hidden}
.dsh-memory-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-memory-entry[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-memory-entry-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;box-sizing:border-box;padding:0 4px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--dsw-alias-state-warn-primary,#e8a33d);color:#0e1116;font-size:10px;font-weight:700;line-height:16px}
.dsh-memory-modal{width:min(1120px,calc(100vw - 48px))}
.dsh-memory-modal-body{overflow:hidden;display:flex;flex-direction:column}
.dsh-memory-change-old{color:var(--dsw-alias-label-tertiary,#888);text-decoration:line-through;opacity:.8}
.dsh-memory-change-new{color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-panel{display:flex;flex-direction:column;gap:10px;max-height:min(720px,calc(100vh - 160px));overflow-y:auto;padding:2px 2px 6px;box-sizing:border-box}
.dsh-memory-tabs{flex:none;display:flex;align-items:center;gap:2px;padding:2px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-tab{flex:1;appearance:none;border:none;background:transparent;border-radius:8px;padding:5px 10px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary,#999);cursor:pointer}
.dsh-memory-tab:hover{color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-tab-active{background:var(--dsw-alias-button-ghost-active-fill,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#eee);font-weight:600}
.dsh-memory-top-row{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.dsh-memory-project-chips{display:flex;flex-wrap:wrap;gap:4px;min-width:0}
.dsh-memory-project-chip{flex:none;display:inline-flex;align-items:center;gap:4px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:999px;padding:3px 10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#999);background:transparent;cursor:pointer}
.dsh-memory-project-chip:hover{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.16));color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-project-chip-active{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-button-ghost-active-fill,rgba(255,255,255,.06))}
.dsh-memory-search-row{flex:none;display:flex;align-items:center;gap:6px}
.dsh-memory-search-input{flex:1;min-width:0;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-search-input::placeholder{color:var(--dsw-alias-label-tertiary,#888)}
.dsh-memory-tag-select{height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:0 32px 0 10px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#eee);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px;appearance:none;max-width:180px;cursor:pointer}
.dsh-memory-section-title{margin:6px 2px 0;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-memory-card-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.dsh-memory-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-card:hover{border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.16));background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-card-pinned{border-color:var(--dsw-alias-state-warn-primary,rgba(232,163,61,.45))}
.dsh-memory-card-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.dsh-memory-card-head{flex:1;min-width:0;display:flex;align-items:flex-start;gap:8px}
.dsh-memory-card-content{flex:1;min-width:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#eee);white-space:pre-wrap;word-break:break-word}
.dsh-memory-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.dsh-memory-card-meta{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);flex-wrap:wrap}
.dsh-memory-chips{display:flex;flex-wrap:wrap;gap:4px}
.dsh-memory-chip{flex:none;display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));cursor:pointer}
.dsh-memory-chip:hover{color:var(--dsw-alias-label-primary,#eee);border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.16))}
.dsh-memory-chip-active{color:var(--dsw-alias-state-business-primary,#4a9eff);border-color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-memory-card-actions{flex:none;display:flex;align-items:center;gap:2px;opacity:0;transition:opacity 120ms}
.dsh-memory-card:hover .dsh-memory-card-actions,.dsh-memory-card:focus-within .dsh-memory-card-actions{opacity:1}
.dsh-memory-icon-action{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:50%;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-memory-icon-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-pin-mark{flex:none;display:inline-flex;align-items:center;margin-right:4px;color:var(--dsw-alias-state-warn-primary,#e8a33d);vertical-align:-2px}
.dsh-memory-empty{margin:4px 2px;padding:12px 4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);text-align:center}
.dsh-memory-change-row{display:flex;align-items:flex-start;gap:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-change-badge{flex:none;margin-top:2px;font-size:10px;line-height:14px;padding:1px 6px;border-radius:999px;color:#0e1116;background:var(--dsw-alias-state-warn-primary,#e8a33d);font-weight:700}
.dsh-memory-change-badge-delete{color:#fff;background:var(--dsw-alias-state-error-primary,#e0434b)}
.dsh-memory-change-diff{flex:1;min-width:0;display:flex;align-items:stretch;gap:10px}
.dsh-memory-change-diff-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dsh-memory-change-diff-divider{flex:none;width:1px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.dsh-memory-add-row{flex:none;display:flex;align-items:center;justify-content:flex-end}
.dsh-memory-add-button{flex:none;display:inline-flex;align-items:center;gap:4px;appearance:none;border:none;border-radius:18px;height:36px;padding:0 14px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary,#999);background:transparent;cursor:pointer}
.dsh-memory-add-button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-memory-add-form{flex:none;display:flex;flex-direction:column;gap:8px;padding:14px 16px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-add-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-memory-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer}
.dsh-memory-change-summary{flex:1;min-width:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#eee);word-break:break-word}
.dsh-memory-change-actions{flex:none;display:flex;align-items:center;gap:4px}
.dsh-memory-inline-form{flex:none;display:flex;flex-direction:column;gap:8px;padding:14px 16px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;background:var(--dsw-alias-bg-module-platform,#1c1f26)}
.dsh-memory-inline-input{height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.dsh-memory-inline-textarea{min-height:64px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:8px 10px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26);resize:vertical;font-family:inherit}
.dsh-memory-edit-buttons{display:flex;align-items:center;gap:6px}
.dsh-memory-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-memory-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-memory-toggle-on{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-memory-toggle-on:hover{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-memory-toggle-off{color:var(--dsw-alias-label-tertiary,#888);opacity:.55}
.dsh-memory-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e0434b)}
.dsh-memory-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ── 移动端：全屏面板、收紧筛选控件 ───────────────────────────── */
@media (max-width: 767.98px) {
  .dsh-memory-panel{max-height:none;padding:2px}
  .dsh-memory-project-chip{max-width:150px}
  .dsh-memory-tag-select{max-width:150px}
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
