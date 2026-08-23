/**
 * automation — 文案（zh/en）。
 *
 * 菜单项经 DOM 注入挂进侧边栏，拿不到 slots 体系的 t seat；因此自带轻量
 * 字典，语言跟随 DSH locale 服务同步到 <html lang> 的值（zh / en）。
 * 键语义对齐 openhanako 的 automation.* / cron.* 词条。
 */

/** 简体中文词典（key 源）。 */
export const zh = {
  entry: '自动化',
  entryAria: '打开自动化面板',
  title: '任务计划',
  close: '关闭',
  add: '添加自动化',
  empty: '暂无任务计划',
  emptyHint: '点击右上角 + 新建，或让助手在对话中为你创建',

  // 卡片
  enable: '启用',
  disable: '停用',
  on: '开',
  off: '关',
  delete: '删除',
  confirm: '确认',
  cancel: '取消',
  runNow: '立即运行',
  newAutomation: '新的自动化',
  promptRequired: '先写下想让助手做什么，再启用这条自动化',
  executorLabel: '助手执行',
  historyTitle: '运行记录',
  historyEmpty: '暂无运行记录',
  statusSuccess: '成功',
  statusError: '失败',
  statusSkipped: '跳过',
  consecutiveErrors: '连续失败 {n} 次',
  nextRun: '下次 {time}',
  // Tab（任务计划 / 运行记录）
  tabJobs: '任务计划',
  tabRuns: '运行记录',
  runsEmpty: '还没有运行记录',
  runsEmptyHint: '任务到点执行后，每次的完整产出都会保存在这里，可回看全文',
  fieldLabel: '名称',
  fieldSchedule: '时间',
  fieldPrompt: '执行内容',
  promptPlaceholder: '写下你想让助手做什么',
  modelLabel: '模型',
  defaultModel: '默认模型',
  modelsLoading: '模型目录加载中…',
  saveFailed: '保存失败',
  loadFailed: '加载失败',
  createFailed: '创建自动化失败',

  // ScheduleEditor
  scheduleMode: '模式',
  'mode.interval': '每隔多久',
  'mode.daily': '每天',
  'mode.weekly': '每周',
  'mode.monthly': '每月',
  'mode.once': '指定一次',
  'mode.advanced': '高级 Cron',
  every: '每隔',
  unit: '单位',
  'unit.minutes': '分钟',
  'unit.hours': '小时',
  'unit.days': '天',
  time: '时间',
  hour: '小时',
  minute: '分钟',
  weekday: '星期',
  monthDay: '日期',
  dateTime: '日期时间',
  cronExpression: 'Cron 表达式',
  'schedule.onceAt': '一次：{date}',
  'schedule.advancedCron': '高级 Cron：{cron}',

  // 预览与文案
  everyMinutes: '每 {n} 分钟',
  everyHours: '每 {n} 小时',
  everyDays: '每 {n} 天',
  hourly: '每小时',
  hourlyAt: '每小时第 {min} 分',
  dailyAt: '每天 {hour}:{min}',
  weeklyAt: '{days} {hour}:{min}',
  monthlyAt: '每月 {day} 日 {hour}:{min}',
  weekPrefix: '周',
  dayNames: '日,一,二,三,四,五,六',

  // AI 建议
  suggestTitle: '助手的建议',
  suggestCreate: '建议新建',
  suggestUpdate: '建议修改',
  suggestView: '查看建议',
  suggestConfirmCreate: '确认添加',
  suggestConfirmUpdate: '确认修改',
  suggestReject: '取消',
  suggestApplied: '已创建「{label}」',
  suggestRejected: '已取消该建议',
  suggestApplyFailed: '应用建议失败',
  suggestExpireSoon: '即将过期',

  // 通知
  notifyDone: '定时任务执行完毕：「{label}」',
  notifyFailed: '定时任务执行失败：「{label}」',
} as const

export type DictKey = keyof typeof zh

/** 英文词典。 */
export const en: Partial<Record<DictKey, string>> = {
  entry: 'Automations',
  entryAria: 'Open automations panel',
  title: 'Scheduled tasks',
  close: 'Close',
  add: 'Add automation',
  empty: 'No scheduled tasks yet',
  emptyHint: 'Click + to create one, or ask your assistant in chat',
  enable: 'Enable',
  disable: 'Disable',
  on: 'On',
  off: 'Off',
  delete: 'Delete',
  confirm: 'Confirm',
  cancel: 'Cancel',
  runNow: 'Run now',
  newAutomation: 'New automation',
  promptRequired: 'Write what the assistant should do before enabling this automation',
  executorLabel: 'Agent run',
  historyTitle: 'Run history',
  historyEmpty: 'No runs yet',
  tabJobs: 'Scheduled tasks',
  tabRuns: 'Run history',
  runsEmpty: 'No runs yet',
  runsEmptyHint: 'Once a task fires, its full output is saved here for review',
  statusSuccess: 'Success',
  statusError: 'Failed',
  statusSkipped: 'Skipped',
  consecutiveErrors: '{n} consecutive failures',
  nextRun: 'Next {time}',
  fieldLabel: 'Name',
  fieldSchedule: 'Schedule',
  fieldPrompt: 'Instructions',
  promptPlaceholder: 'Describe what the assistant should do',
  modelLabel: 'Model',
  defaultModel: 'Default model',
  modelsLoading: 'Loading models…',
  saveFailed: 'Save failed',
  loadFailed: 'Load failed',
  createFailed: 'Failed to create automation',
  scheduleMode: 'Mode',
  'mode.interval': 'Every interval',
  'mode.daily': 'Daily',
  'mode.weekly': 'Weekly',
  'mode.monthly': 'Monthly',
  'mode.once': 'Once',
  'mode.advanced': 'Advanced cron',
  every: 'Every',
  unit: 'Unit',
  'unit.minutes': 'minutes',
  'unit.hours': 'hours',
  'unit.days': 'days',
  time: 'Time',
  hour: 'Hour',
  minute: 'Minute',
  weekday: 'Weekday',
  monthDay: 'Day of month',
  dateTime: 'Date & time',
  cronExpression: 'Cron expression',
  'schedule.onceAt': 'Once: {date}',
  'schedule.advancedCron': 'Cron: {cron}',
  everyMinutes: 'Every {n} min',
  everyHours: 'Every {n} h',
  everyDays: 'Every {n} d',
  hourly: 'Hourly',
  hourlyAt: 'Hourly at :{min}',
  dailyAt: 'Daily at {hour}:{min}',
  weeklyAt: '{days} {hour}:{min}',
  monthlyAt: 'Monthly on day {day} at {hour}:{min}',
  weekPrefix: '',
  dayNames: 'Sun,Mon,Tue,Wed,Thu,Fri,Sat',
  suggestTitle: "Assistant's suggestion",
  suggestCreate: 'Suggested addition',
  suggestUpdate: 'Suggested change',
  suggestView: 'View suggestion',
  suggestConfirmCreate: 'Confirm & add',
  suggestConfirmUpdate: 'Confirm & update',
  suggestReject: 'Dismiss',
  suggestApplied: 'Created "{label}"',
  suggestRejected: 'Suggestion dismissed',
  suggestApplyFailed: 'Failed to apply suggestion',
  suggestExpireSoon: 'Expiring soon',
  notifyDone: 'Scheduled task finished: "{label}"',
  notifyFailed: 'Scheduled task failed: "{label}"',
}

const DICTS = { zh, en } as const

/** 解析当前语言（跟随 <html lang>）。 */
function locale(): 'zh' | 'en' {
  try {
    return (document.documentElement.lang || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'zh'
  }
}

/** 取词条；缺省回退中文词典原文；支持 {name} 插值。key 放宽为 string 以支持组合键。 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = DICTS[locale()]
  let text: string = (dict as Partial<Record<string, string>>)[key] ?? (zh as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}
