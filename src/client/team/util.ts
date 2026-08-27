/**
 * team — client 共享小工具（时间格式化、模型下拉选项、状态文案）。
 */

import type { ModelBinding, ProviderView, RunStatus, StepErrorKind, StepPhase, StepStatus } from './types.ts'

/** 毫秒 → mm:ss（超过一小时给 h:mm:ss）。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--:--'
  const total = Math.floor(ms / 1000)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 计算一段区间的耗时（未结束时用 now）。 */
export function elapsedOf(startedAt: string | undefined, finishedAt: string | undefined, now: number): number {
  if (startedAt === undefined || startedAt === '') return 0
  const start = Date.parse(startedAt)
  if (!Number.isFinite(start)) return 0
  const end = finishedAt !== undefined && finishedAt !== '' ? Date.parse(finishedAt) : now
  return Math.max(0, (Number.isFinite(end) ? end : now) - start)
}

/** 本地时间串。 */
export function formatTime(iso: string | undefined): string {
  if (iso === undefined || iso === '') return ''
  const value = Date.parse(iso)
  if (!Number.isFinite(value)) return ''
  return new Date(value).toLocaleString(undefined, { hour12: false })
}

/** 本地时钟串 HH:mm:ss（完成时间戳用）。 */
export function formatClock(iso: string | undefined): string {
  if (iso === undefined || iso === '') return ''
  const value = Date.parse(iso)
  if (!Number.isFinite(value)) return ''
  const d = new Date(value)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 模型绑定 → "provider/model"。 */
export function bindingValue(binding: ModelBinding | null): string {
  if (binding === null || binding.provider === '' || binding.model === '') return ''
  return `${binding.provider}/${binding.model}`
}

/** "provider/model" → 绑定；空串返回 null。 */
export function bindingFromValue(value: string): ModelBinding | null {
  if (value === '') return null
  const slash = value.indexOf('/')
  if (slash <= 0 || slash >= value.length - 1) return null
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
}

/** 模型短名（去掉 provider 前缀，用于窄卡片显示）。 */
export function shortModel(binding: ModelBinding | null): string {
  if (binding === null || binding.model === '') return ''
  return binding.model
}

/** 把 providers 枚举渲染成 <optgroup> 需要的结构。 */
export function providerOptions(providers: readonly ProviderView[]): Array<{
  label: string
  options: Array<{ value: string, label: string }>
}> {
  return providers
    .filter(group => group.models.length > 0)
    .map(group => ({
      label: group.displayName,
      options: group.models.map(model => ({
        value: `${group.id}/${model.id}`,
        label: model.name !== '' ? model.name : model.id,
      })),
    }))
}

/** 步骤状态 → 图标字符。 */
export function stepIcon(status: StepStatus): string {
  switch (status) {
    case 'done': return '✅'
    case 'running': return '🔄'
    case 'error': return '❌'
    case 'skipped': return '⏭'
    default: return '⏳'
  }
}

/** 运行状态中文。 */
export function runStatusText(status: RunStatus): string {
  switch (status) {
    case 'queued': return '排队中'
    case 'running': return '运行中'
    case 'done': return '已完成'
    case 'error': return '失败'
    case 'cancelled': return '已取消'
    case 'interrupted': return '被中断'
    default: return status
  }
}

/** 步骤状态中文。 */
export function stepStatusText(status: StepStatus): string {
  switch (status) {
    case 'pending': return '待办'
    case 'running': return '进行中'
    case 'done': return '完成'
    case 'error': return '失败'
    case 'skipped': return '跳过'
    default: return status
  }
}

/** 阶段文案（卡片正文一行，直接回答「现在在干什么」）。 */
export function phaseText(phase: StepPhase | undefined): string {
  switch (phase) {
    case 'resolving': return '准备中'
    case 'dispatch': return '已下发，等待响应'
    case 'thinking': return '正在思考'
    case 'writing': return '正在输出'
    case 'tooling': return '正在调用工具'
    case 'retrying': return '失败退避重试'
    case 'saving': return '收尾落盘'
    default: return '进行中'
  }
}

/** 阶段图标（卡片状态点旁的小符号）。 */
export function phaseIcon(phase: StepPhase | undefined): string {
  switch (phase) {
    case 'resolving': return '⚙'
    case 'dispatch': return '📡'
    case 'thinking': return '🧠'
    case 'writing': return '✍'
    case 'tooling': return '🔧'
    case 'retrying': return '↻'
    case 'saving': return '💾'
    default: return '●'
  }
}

/** 失败归类中文短标签（与 host failure.ts 保持一致）。 */
export function errorKindText(kind: StepErrorKind | undefined): string {
  switch (kind) {
    case 'rate_limit': return '限流'
    case 'timeout': return '超时'
    case 'auth': return '鉴权失败'
    case 'quota': return '额度不足'
    case 'network': return '网络异常'
    case 'server': return '上游错误'
    case 'model_missing': return '模型不可用'
    case 'content': return '请求被拒'
    case 'cancelled': return '已取消'
    case 'unknown': return '未知错误'
    default: return ''
  }
}

/** 失败归类的处置建议（详情卡展示）。 */
export function errorKindAdvice(kind: StepErrorKind | undefined): string {
  switch (kind) {
    case 'rate_limit': return '供应商限流：已自动退避重试；持续失败可降低并行数或换备用模型后一键接续。'
    case 'timeout': return '本步超时：可提高单步超时秒数，或把任务拆细后一键接续。'
    case 'auth': return '鉴权失败：检查该供应商的 API key 是否有效，修好后一键接续。'
    case 'quota': return '额度不足：充值或换一个供应商（角色/团队备用模型），再一键接续。'
    case 'network': return '网络异常：检查网络与代理，恢复后一键接续。'
    case 'server': return '上游服务异常：通常是临时故障，稍后一键接续即可。'
    case 'model_missing': return '模型不可用：到团队设置重选模型（或配置备用模型），再一键接续。'
    case 'content': return '请求被上游拒绝（内容策略/参数/上下文超长）：调整任务描述或缩小上下文预算后重跑。'
    case 'cancelled': return '运行被取消：可一键接续从未完成的步骤继续。'
    default: return ''
  }
}
