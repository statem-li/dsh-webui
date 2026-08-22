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
  tabTasks: '执行任务',
  tabLogs: '执行日志',
  cancel: '取消',
  // 执行任务页
  enabledLabel: '启用',
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
  // 执行计划（借鉴 openhanako：模式 + 动态字段 + 预览）
  schedLabel: '执行计划',
  'schedMode.interval': '间隔执行',
  'schedMode.daily': '每天',
  'schedMode.weekly': '每周',
  'schedMode.monthly': '每月',
  'schedMode.once': '单次',
  schedEvery: '执行间隔',
  schedUnit: '单位',
  'schedUnit.minutes': '分钟',
  'schedUnit.hours': '小时',
  'schedUnit.days': '天',
  schedTime: '执行时间',
  schedWeekday: '星期',
  schedMonthDay: '几号',
  schedDateTime: '具体时间',
  // 执行日志页
  filterAll: '全部任务',
  filterLabel: '按任务筛选',
  statusSuccess: '已执行',
  statusFailed: '失败',
  logEmpty: '暂无执行记录',
  logEmptyHint: '到达执行计划的触发时刻会自动生成执行记录',
  clearLogs: '清空记录',
  clearLogsConfirm: '确定清空全部执行记录？',
  dayToday: '今天',
  dayYesterday: '昨天',
  // 执行 / 重跑
  runNow: '立即执行',
  rerun: '重跑',
  executing: '执行中…',
  noModel: '未绑定模型，请先在任务里选择模型',
  // 失败重试
  retryLabel: '失败重试',
  retryHint: '失败后自动重试的次数（0–3）',
  // 执行步骤
  stepsLabel: '执行步骤',
  addStep: '+ 添加步骤',
  stepName: '步骤名',
  stepNamePlaceholder: '如：生成日报正文',
  stepPrompt: '执行指令',
  stepPromptPlaceholder: '发送给模型的任务指令',
  stepOnError: '本步失败时',
  onErrorStop: '停止整个任务',
  onErrorSkip: '跳过本步继续',
  stepSaveFile: '保存到文件',
  stepFileName: '文件名',
  stepFileNameHint: '支持 {date} / {time} 占位',
  deleteStep: '删除步骤',
  stepNo: '步骤 {n}',
  // 日志详情
  summaryLabel: '输出摘要',
  stepStatusSuccess: '成功',
  stepStatusFailed: '失败',
  stepStatusSkipped: '跳过',
  stepRecords: '{n} 字符',
  noSteps: '无步骤详情',
  fileSection: '生成的文件',
  noFiles: '本次未生成文件',
  copyPath: '复制路径',
  copied: '已复制',
  downloadFile: '下载',
  openFolder: '打开所在文件夹',
  logError: '失败原因',
  filterStatusLabel: '状态',
  filterStatusAll: '全部状态',
  filterStatusSuccess: '仅成功',
  filterStatusFailed: '仅失败',
} as const

/** 自动化模块词典 key 集合。 */
export type AutomationLocaleKey = keyof typeof zh

/** 英文词典（与中文 key 一一对应）。 */
export const en: Record<AutomationLocaleKey, string> = {
  entry: 'Automation',
  entryAria: 'Open automation settings',
  cardTitle: 'Automation',
  close: 'Close',
  tabTasks: 'Tasks',
  tabLogs: 'Logs',
  cancel: 'Cancel',
  enabledLabel: 'Enabled',
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
  schedLabel: 'Schedule',
  'schedMode.interval': 'Interval',
  'schedMode.daily': 'Daily',
  'schedMode.weekly': 'Weekly',
  'schedMode.monthly': 'Monthly',
  'schedMode.once': 'Once',
  schedEvery: 'Every',
  schedUnit: 'Unit',
  'schedUnit.minutes': 'minutes',
  'schedUnit.hours': 'hours',
  'schedUnit.days': 'days',
  schedTime: 'Time',
  schedWeekday: 'Weekday',
  schedMonthDay: 'Day of month',
  schedDateTime: 'Date & time',
  filterAll: 'All tasks',
  filterLabel: 'Filter by task',
  statusSuccess: 'Ran',
  statusFailed: 'Failed',
  logEmpty: 'No run records yet',
  logEmptyHint: 'Reaching a schedule trigger writes a run record automatically',
  clearLogs: 'Clear records',
  clearLogsConfirm: 'Clear all run records?',
  dayToday: 'Today',
  dayYesterday: 'Yesterday',
  runNow: 'Run now',
  rerun: 'Rerun',
  executing: 'Running…',
  noModel: 'No model bound — pick one in the task first',
  retryLabel: 'Retry on failure',
  retryHint: 'Auto-retry count after failure (0–3)',
  stepsLabel: 'Steps',
  addStep: '+ Add step',
  stepName: 'Step name',
  stepNamePlaceholder: 'e.g. generate report body',
  stepPrompt: 'Instruction',
  stepPromptPlaceholder: 'Instruction sent to the model',
  stepOnError: 'On failure',
  onErrorStop: 'Stop the whole task',
  onErrorSkip: 'Skip this step',
  stepSaveFile: 'Save to file',
  stepFileName: 'File name',
  stepFileNameHint: 'Supports {date} / {time} placeholders',
  deleteStep: 'Delete step',
  stepNo: 'Step {n}',
  summaryLabel: 'Output summary',
  stepStatusSuccess: 'Success',
  stepStatusFailed: 'Failed',
  stepStatusSkipped: 'Skipped',
  stepRecords: '{n} chars',
  noSteps: 'No step details',
  fileSection: 'Generated files',
  noFiles: 'No files generated this run',
  copyPath: 'Copy path',
  copied: 'Copied',
  downloadFile: 'Download',
  openFolder: 'Open folder',
  logError: 'Failure reason',
  filterStatusLabel: 'Status',
  filterStatusAll: 'All statuses',
  filterStatusSuccess: 'Success only',
  filterStatusFailed: 'Failed only',
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
