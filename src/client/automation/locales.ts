/**
 * automation — 文案（zh/en）。
 *
 * 菜单项经 DOM 注入挂进侧边栏，拿不到 slots 体系的 t seat；因此自带轻量
 * 字典，语言跟随 DSH locale 服务同步到 <html lang> 的值（zh / en）。
 */

/** 简体中文词典（key 源）。 */
export const zh = {
  entry: '自动化',
  entryAria: '打开自动化面板',
  title: '任务计划',
  close: '关闭',
  add: '新建',
  addAria: '新建自动化任务',
  refresh: '刷新',
  empty: '暂无任务计划',
  emptyHint: '点击「新建」，或让助手在对话中为你创建',
  emptyFiltered: '没有符合条件的任务',
  emptyFilteredHint: '换个筛选条件或清空搜索词试试',

  // 概览统计
  statTotal: '任务',
  statEnabled: '启用中',
  statRunning: '执行中',

  // 筛选
  filterAll: '全部',
  filterEnabled: '启用',
  filterDisabled: '停用',
  searchPlaceholder: '搜索名称或执行内容',
  searchClear: '清空搜索',

  // 卡片
  enable: '启用',
  disable: '停用',
  on: '开',
  off: '关',
  running: '执行中',
  delete: '删除',
  deleteConfirm: '确认删除？',
  duplicate: '复制',
  confirm: '保存',
  cancel: '取消',
  revert: '放弃改动',
  runNow: '立即运行',
  runningNow: '执行中…',
  cancelRun: '中止',
  newAutomation: '新的自动化',
  promptRequired: '先写下想让助手做什么，再启用这条自动化',
  draftHint: '草稿：填好执行内容后打开左侧开关即生效',
  executorLabel: '助手执行',
  historyTitle: '最近运行',
  historyEmpty: '暂无运行记录',
  historyClear: '清空记录',
  statusSuccess: '成功',
  statusError: '失败',
  statusSkipped: '跳过',
  consecutiveErrors: '连续失败 {n} 次',
  nextRun: '下次 {time}',
  lastRun: '上次 {time}',
  neverRun: '尚未运行',
  triggerManual: '手动',
  triggerSchedule: '定时',

  // 相对时间
  relNow: '就在此刻',
  relInMinutes: '{n} 分钟后',
  relInHours: '{n} 小时后',
  relInDays: '{n} 天后',
  relAgoMinutes: '{n} 分钟前',
  relAgoHours: '{n} 小时前',
  relAgoDays: '{n} 天前',

  // Tab（任务计划 / 运行记录）
  tabJobs: '任务',
  tabRuns: '记录',
  runsEmpty: '还没有运行记录',
  runsEmptyHint: '任务到点执行后，每次的完整产出都会保存在这里，可回看全文',
  runsFilterAll: '全部',
  viewFull: '查看全文',
  outputClose: '关闭全文',
  copy: '复制',
  copied: '已复制',

  fieldLabel: '名称',
  fieldSchedule: '计划',
  fieldPrompt: '执行内容',
  promptPlaceholder: '写下你想让助手做什么',
  labelPlaceholder: '给这条自动化起个名字',
  modelLabel: '模型',
  defaultModel: '默认模型',
  modelsLoading: '模型目录加载中…',
  saveFailed: '保存失败',
  loadFailed: '加载失败',
  createFailed: '创建自动化失败',
  runFailed: '执行失败',
  runStarted: '已开始执行，完成后会通知你',
  runCancelled: '已中止本次执行',
  saved: '已保存',
  deleted: '已删除',
  duplicated: '已复制为草稿',
  historyCleared: '已清空运行记录',

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
  cronHint: '格式「分 时 日 月 周」，例如 0 9 * * 1-5 = 工作日 9:00',
  cronInvalid: '这个 Cron 表达式无法解析',
  onceInvalid: '请选择一个未来的时间点',
  intervalMin: '最小间隔 1 分钟',
  schedulePreview: '预计：{text}',
  'schedule.onceAt': '一次：{date}',
  'schedule.advancedCron': 'Cron：{cron}',

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
  suggestReject: '忽略',
  suggestApplied: '已创建「{label}」',
  suggestRejected: '已忽略该建议',
  suggestApplyFailed: '应用建议失败',
  suggestExpireSoon: '即将过期',
  suggestExpiresIn: '{n} 分钟后过期',

  // 设置
  autoApprove: '助手创建的任务免确认',
  autoApproveHint: '开启后助手可直接创建/修改自动化，不再弹待确认卡',

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
  add: 'New',
  addAria: 'Create automation',
  refresh: 'Refresh',
  empty: 'No scheduled tasks yet',
  emptyHint: 'Click "New", or ask your assistant in chat',
  emptyFiltered: 'No tasks match the filter',
  emptyFilteredHint: 'Try another filter or clear the search box',
  statTotal: 'Tasks',
  statEnabled: 'Enabled',
  statRunning: 'Running',
  filterAll: 'All',
  filterEnabled: 'Enabled',
  filterDisabled: 'Disabled',
  searchPlaceholder: 'Search name or instructions',
  searchClear: 'Clear search',
  enable: 'Enable',
  disable: 'Disable',
  on: 'On',
  off: 'Off',
  running: 'Running',
  delete: 'Delete',
  deleteConfirm: 'Delete?',
  duplicate: 'Duplicate',
  confirm: 'Save',
  cancel: 'Cancel',
  revert: 'Discard',
  runNow: 'Run now',
  runningNow: 'Running…',
  cancelRun: 'Stop',
  newAutomation: 'New automation',
  promptRequired: 'Write what the assistant should do before enabling this automation',
  draftHint: 'Draft: fill in the instructions, then flip the switch',
  executorLabel: 'Agent run',
  historyTitle: 'Recent runs',
  historyEmpty: 'No runs yet',
  historyClear: 'Clear history',
  statusSuccess: 'Success',
  statusError: 'Failed',
  statusSkipped: 'Skipped',
  consecutiveErrors: '{n} consecutive failures',
  nextRun: 'Next {time}',
  lastRun: 'Last {time}',
  neverRun: 'Never run',
  triggerManual: 'Manual',
  triggerSchedule: 'Scheduled',
  relNow: 'just now',
  relInMinutes: 'in {n} min',
  relInHours: 'in {n} h',
  relInDays: 'in {n} d',
  relAgoMinutes: '{n} min ago',
  relAgoHours: '{n} h ago',
  relAgoDays: '{n} d ago',
  tabJobs: 'Tasks',
  tabRuns: 'Runs',
  runsEmpty: 'No runs yet',
  runsEmptyHint: 'Once a task fires, its full output is saved here for review',
  runsFilterAll: 'All',
  viewFull: 'View output',
  outputClose: 'Close output',
  copy: 'Copy',
  copied: 'Copied',
  fieldLabel: 'Name',
  fieldSchedule: 'Schedule',
  fieldPrompt: 'Instructions',
  promptPlaceholder: 'Describe what the assistant should do',
  labelPlaceholder: 'Name this automation',
  modelLabel: 'Model',
  defaultModel: 'Default model',
  modelsLoading: 'Loading models…',
  saveFailed: 'Save failed',
  loadFailed: 'Load failed',
  createFailed: 'Failed to create automation',
  runFailed: 'Run failed',
  runStarted: 'Started — you will be notified when it finishes',
  runCancelled: 'Run stopped',
  saved: 'Saved',
  deleted: 'Deleted',
  duplicated: 'Duplicated as draft',
  historyCleared: 'Run history cleared',
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
  cronHint: 'Format "min hour day month weekday", e.g. 0 9 * * 1-5 = weekdays at 9:00',
  cronInvalid: 'This cron expression cannot be parsed',
  onceInvalid: 'Pick a point in the future',
  intervalMin: 'Minimum interval is 1 minute',
  schedulePreview: 'Preview: {text}',
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
  suggestView: 'Review',
  suggestConfirmCreate: 'Confirm & add',
  suggestConfirmUpdate: 'Confirm & update',
  suggestReject: 'Dismiss',
  suggestApplied: 'Created "{label}"',
  suggestRejected: 'Suggestion dismissed',
  suggestApplyFailed: 'Failed to apply suggestion',
  suggestExpireSoon: 'Expiring soon',
  suggestExpiresIn: 'expires in {n} min',
  autoApprove: 'Apply assistant changes without confirmation',
  autoApproveHint: 'When on, the assistant can create/update automations directly',
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

/** 绝对时间（本地化，24 小时制）。 */
export function formatAbsolute(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { hour12: false })
}

/**
 * 相对时间（「3 分钟后」「2 小时前」）：卡片副行读起来比绝对时间戳直观得多，
 * 绝对时间放在 title 里备查。
 */
export function formatRelative(value: string | number | Date, now = Date.now()): string {
  const date = value instanceof Date ? value : new Date(value)
  const ms = date.getTime()
  if (Number.isNaN(ms)) return ''
  const diff = ms - now
  const abs = Math.abs(diff)
  const minutes = Math.round(abs / 60_000)
  if (minutes < 1) return t('relNow')
  const future = diff > 0
  if (minutes < 60) return t(future ? 'relInMinutes' : 'relAgoMinutes', { n: minutes })
  const hours = Math.round(abs / 3_600_000)
  if (hours < 24) return t(future ? 'relInHours' : 'relAgoHours', { n: hours })
  const days = Math.round(abs / 86_400_000)
  return t(future ? 'relInDays' : 'relAgoDays', { n: days })
}
