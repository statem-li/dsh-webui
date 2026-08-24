/** dsh-memory 面板文案（zh/en 双语，zh 为 key 源）。 */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  entry: '记忆',
  panelTitle: '记忆',
  tabAll: '全部',
  tabChanges: '变更',
  tabPinned: '置顶',
  searchPlaceholder: '搜索记忆…',
  tagFilterPlaceholder: '全部标签',
  scopeGlobal: '全局',
  projectLabel: '{name}',
  groupToday: '今天',
  groupWeek: '本周',
  groupEarlier: '更早',
  groupLongterm: '长期沉淀',
  empty: '会话中的要点会自动沉淀到这里',
  changesEmpty: '今天还没有新的记忆变更',
  pinnedEmpty: '还没有置顶记忆',
  pin: '置顶',
  unpin: '取消置顶',
  edit: '编辑',
  delete: '删除',
  move: '移项目',
  deleteConfirm: '删除这条记忆？',
  tagEditPlaceholder: '逗号分隔标签',
  save: '保存',
  cancel: '取消',
  keep: '保留',
  moveToGlobal: '移到全局',
  moveToProject: '移到项目',
  projectPlaceholder: '项目路径或 hash',
  loading: '读取中…',
  error: '读取失败',
  retry: '重试',
  noProjects: '还没有项目记忆',
  importanceLabel: '{n}',
  updatedAgo: '{time}',
  changesBadge: '{n} 条新记忆',
  unreadChanges: '{n} 条新变更',
  close: '关闭',
  todayChanges: '今日变更',
  sourceExtract: '自动',
  sourceManual: '手动',
  add: '添加',
  addMemory: '添加记忆',
  addContentPlaceholder: '要记住的内容…',
  addTagsPlaceholder: '逗号分隔标签',
  addPinned: '置顶',
  addScopeGlobal: '全局',
  addScopeProject: '项目',
  selectProject: '请选择项目',
  sensitiveConfirm: '内容包含疑似敏感信息（token/密钥等）。仍要保存吗？保存后注入上下文可能被模型读取，风险自担。',
  injectOn: '记忆注入：开',
  injectOff: '记忆注入：关',
  diffOld: '旧',
  diffNew: '新',
  clearProject: '清空该项目全部记忆',
  clearProjectConfirm: '确定清空项目「{name}」的 {count} 条记忆？此操作不可恢复。置顶记忆会保留，不会被删除。',
  addSaved: '已添加记忆',
  autoMemory: '自动记忆',
  expand: '展开',
  collapse: '收起',
  multiSelect: '多选',
  selectAll: '全选',
  selectedCount: '已选 {n} 项',
  deleteSelectedConfirm: '确定删除选中的 {n} 条记忆？此操作不可恢复。',
  tabRevisions: '修订',
  consolidate: '整理',
  consolidateHint: '用模型合并重复、精炼重写、删除低价值、提升长期（Memory Dream）',
  consolidating: '整理中…',
  revisionsEmpty: '还没有整理快照；每天自动整理或手动整理后生成',
  revManual: '手动',
  revDaily: '每日',
  revEntries: '{n} 条',
  rollback: '回滚',
  rollbackConfirm: '回滚到该快照（{time}，{id}）？当前全部记忆将被替换为该快照内容，不可撤销。',
  enable: '启用记忆（恢复参与注入）',
  disable: '禁用记忆（保留但不参与注入）',
  enabledAria: '启用开关，当前开启',
  disabledAria: '启用开关，当前禁用',
  disabledTag: '已禁用',
} satisfies Record<string, string>

/** dsh-memory locale key union. */
export type MemoryLocaleKey = keyof typeof zh

/** Locale namespace owned by this plugin. */
export const NS = 'dshMemory'

/** English dictionary checked against the Chinese key set. */
export const en = {
  entry: 'Memory',
  panelTitle: 'Memory',
  tabAll: 'All',
  tabChanges: 'Changes',
  tabPinned: 'Pinned',
  searchPlaceholder: 'Search memories…',
  tagFilterPlaceholder: 'All tags',
  scopeGlobal: 'Global',
  projectLabel: '{name}',
  groupToday: 'Today',
  groupWeek: 'This week',
  groupEarlier: 'Earlier',
  groupLongterm: 'Long-term',
  empty: 'Key points from conversations will settle here automatically',
  changesEmpty: 'No memory changes today yet',
  pinnedEmpty: 'No pinned memories yet',
  pin: 'Pin',
  unpin: 'Unpin',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  deleteConfirm: 'Delete this memory?',
  tagEditPlaceholder: 'Comma-separated tags',
  save: 'Save',
  cancel: 'Cancel',
  keep: 'Keep',
  moveToGlobal: 'Move to global',
  moveToProject: 'Move to project',
  projectPlaceholder: 'Project path or hash',
  loading: 'Loading…',
  error: 'Failed to load',
  retry: 'Retry',
  noProjects: 'No project memories yet',
  importanceLabel: '{n}',
  updatedAgo: '{time}',
  changesBadge: '{n} new memories',
  unreadChanges: '{n} new changes',
  close: 'Close',
  todayChanges: "Today's changes",
  sourceExtract: 'Auto',
  sourceManual: 'Manual',
  add: 'Add',
  addMemory: 'Add memory',
  addContentPlaceholder: 'What to remember…',
  addTagsPlaceholder: 'Comma-separated tags',
  addPinned: 'Pin',
  addScopeGlobal: 'Global',
  addScopeProject: 'Project',
  selectProject: 'Select a project',
  sensitiveConfirm: 'This content looks like sensitive credentials (token/key). Save anyway? Injected memories may be read by the model — you take the risk.',
  injectOn: 'Memory injection: on',
  injectOff: 'Memory injection: off',
  diffOld: 'Old',
  diffNew: 'New',
  clearProject: 'Clear all memories in this project',
  clearProjectConfirm: 'Clear {count} memories in project "{name}"? This cannot be undone. Pinned memories are kept.',
  addSaved: 'Memory added',
  autoMemory: 'Auto-memory',
  expand: 'Expand',
  collapse: 'Collapse',
  multiSelect: 'Select',
  selectAll: 'All',
  selectedCount: '{n} selected',
  deleteSelectedConfirm: 'Delete {n} selected memories? This cannot be undone.',
  tabRevisions: 'Revisions',
  consolidate: 'Consolidate',
  consolidateHint: 'Merge duplicates, rewrite, prune low-value, promote long-term with the model (Memory Dream)',
  consolidating: 'Consolidating…',
  revisionsEmpty: 'No snapshots yet; created after daily or manual consolidation',
  revManual: 'Manual',
  revDaily: 'Daily',
  revEntries: '{n} entries',
  rollback: 'Rollback',
  rollbackConfirm: 'Roll back to this snapshot ({time}, {id})? All memories will be replaced by that snapshot — this cannot be undone.',
  enable: 'Enable memory (resume injection)',
  disable: 'Disable memory (kept, not injected)',
  enabledAria: 'Enable switch, currently on',
  disabledAria: 'Enable switch, currently off',
  disabledTag: 'Off',
} satisfies Record<MemoryLocaleKey, string>

/** 轻量翻译函数类型（面板/入口组件共用）。 */
export type MemoryT = (key: MemoryLocaleKey, vars?: Record<string, string | number>) => string

const DICTS: Record<'zh' | 'en', Record<MemoryLocaleKey, string>> = { zh, en }

/** 当前语言：跟随 DSH 同步到 <html lang> 的主子标签（缺省 zh）。 */
function currentLang(): 'zh' | 'en' {
  try {
    const lang = document.documentElement.lang.toLowerCase().split('-')[0]
    if (lang === 'en') return 'en'
  } catch { /* 非 DOM 环境 */ }
  return 'zh'
}

/** 轻量翻译：{n} 占位插值（与 automation locales.makeT 同款实现）。 */
export function makeT(): MemoryT {
  return (key, vars) => {
    let text: string = DICTS[currentLang()][key] ?? zh[key]
    if (vars !== undefined) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}
