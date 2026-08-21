/**
 * automation — 文案（zh/en）。
 *
 * 本模块的菜单项经 DOM 注入挂进侧边栏（sidebar.workspaces 是 single 插槽，
 * 无法再注册条目），拿不到 slots 体系的 t seat；因此自带轻量字典，
 * 语言跟随 DSH locale 服务同步到 <html lang> 的值（zh / en）。
 */

/** 简体中文词典（key 源）。 */
export const zh = {
  entry: '自动化',
  entryAria: '打开自动化设置',
  cardTitle: '自动化',
  close: '关闭',
  // TAB
  tabSchedule: '定时',
  tabTasks: '执行任务',
  tabLogs: '执行日志',
  // 定时页
  dateLabel: '执行日期设定',
  dateHint: '到达设定日期后自动执行全部任务',
  dailyLabel: '是否每天定时执行',
  dailyHint: '开启后每天都会定时执行，忽略具体日期',
  cancel: '取消',
  // 执行任务页
  newTask: '新建任务',
  editTask: '编辑任务',
  taskNamePlaceholder: '任务名称，如：生成用量日报',
  categoryLabel: '所属分类',
  modelLabel: '模型',
  effortLabel: '推理强度',
  effortDefault: '模型默认',
  modelPlaceholder: '选择模型（可选）',
  modelsLoading: '模型目录加载中…',
  modelsEmpty: '暂无可用模型，可稍后再编辑任务',
  confirmAdd: '添加',
  save: '保存',
  delete: '删除',
  emptyTasks: '还没有任务，点击上方「+ 新建任务」创建',
  // 执行日志页
  filterAll: '全部任务',
  filterLabel: '按任务筛选',
  statusSuccess: '已执行',
  statusFailed: '失败',
  logEmpty: '暂无执行记录',
  logEmptyHint: '开启定时后，每天首次触发会自动生成当天的执行记录',
  clearLogs: '清空记录',
  clearLogsConfirm: '确定清空全部执行记录？',
  dayToday: '今天',
  dayYesterday: '昨天',
} as const

/** 自动化模块词典 key 集合。 */
export type AutomationLocaleKey = keyof typeof zh

/** 英文词典（与中文 key 一一对应）。 */
export const en: Record<AutomationLocaleKey, string> = {
  entry: 'Automation',
  entryAria: 'Open automation settings',
  cardTitle: 'Automation',
  close: 'Close',
  tabSchedule: 'Schedule',
  tabTasks: 'Tasks',
  tabLogs: 'Logs',
  dateLabel: 'Execution date',
  dateHint: 'Runs all tasks on the set date',
  dailyLabel: 'Run daily on schedule',
  dailyHint: 'When on, runs every day and ignores the specific date',
  cancel: 'Cancel',
  newTask: 'New task',
  editTask: 'Edit task',
  taskNamePlaceholder: 'Task name, e.g. daily usage report',
  categoryLabel: 'Category',
  modelLabel: 'Model',
  effortLabel: 'Reasoning',
  effortDefault: 'Model default',
  modelPlaceholder: 'Pick a model (optional)',
  modelsLoading: 'Loading model catalog…',
  modelsEmpty: 'No models available — edit the task later',
  confirmAdd: 'Add',
  save: 'Save',
  delete: 'Delete',
  emptyTasks: 'No tasks yet — tap "+ New task" to create one',
  filterAll: 'All tasks',
  filterLabel: 'Filter by task',
  statusSuccess: 'Ran',
  statusFailed: 'Failed',
  logEmpty: 'No run records yet',
  logEmptyHint: 'With the schedule on, the first trigger of each day writes that day\'s record',
  clearLogs: 'Clear records',
  clearLogsConfirm: 'Clear all run records?',
  dayToday: 'Today',
  dayYesterday: 'Yesterday',
}

/** 轻量翻译函数类型（面板组件共用）。 */
export type T = (key: AutomationLocaleKey, vars?: Record<string, string | number>) => string

const DICTS: Record<'zh' | 'en', Record<AutomationLocaleKey, string>> = { zh, en }

/** 当前语言：跟随 DSH 同步到 <html lang> 的主子标签（缺省 zh）。 */
function currentLang(): 'zh' | 'en' {
  try {
    const lang = document.documentElement.lang.toLowerCase().split('-')[0]
    if (lang === 'en') return 'en'
  } catch { /* 非 DOM 环境 */ }
  return 'zh'
}

/** 轻量翻译：{n} 占位插值。 */
export function makeT(): (key: AutomationLocaleKey, vars?: Record<string, string | number>) => string {
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
