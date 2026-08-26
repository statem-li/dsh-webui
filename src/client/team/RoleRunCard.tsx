/**
 * team — 单角色运行卡（HUD 内，docs §6.6）。
 *
 * 字段：状态图标 + 角色名 + 步序；tagline；实际模型 + 来源徽标（subagent 通道
 * 标「继承会话」）；单步计时（运行中实时走秒）；输出摘要 / 失败原因。
 * 点击卡片 → 请求打开该步全文。
 * `parallel` = 本步与同波次伙伴同时执行（卡片外圈加脉冲光 + ‖ 徽标）。
 *
 * 聚焦态（status=running）：正文只显示「正在思考…」+ 当前任务（执行中的 todo，
 * 无则第一个待办），右上角仅执行时间走秒 —— 不再堆 tagline/模型/进度条/思考
 * 输出摘要；完成后右上角改为完成时刻（不再显示耗时），其余信息随产出恢复。
 */

import { SOURCE_LABEL, type RunStep } from './types.ts'
import { elapsedOf, formatClock, formatDuration, shortModel, stepIcon, stepStatusText } from './util.ts'

export interface RoleRunCardProps {
  step: RunStep
  now: number
  /** 同波次是否有并行伙伴。 */
  parallel?: boolean
  onOpen: (step: RunStep) => void
}

/** 渲染一张角色运行卡。 */
export function RoleRunCard({ step, now, parallel = false, onOpen }: RoleRunCardProps): JSX.Element {
  const running = step.status === 'running'
  const done = step.status === 'done'
  const failed = step.status === 'error'
  const finished = done || failed
  const model = shortModel(step.modelUsed)
  const inherited = step.channel === 'subagent'
  /** 当前任务：优先执行中的 todo，其次第一个待办；无 todo 时为 null。 */
  const currentTodo = step.todos !== undefined && step.todos.length > 0
    ? (step.todos.find(t => t.status === 'in_progress') ?? step.todos.find(t => t.status === 'pending') ?? null)
    : null

  // 右上角计时：执行中 = 执行时间走秒；完成/失败 = 完成时刻（不再显示耗时）。
  // 完成时刻兜底：服务端缺 finishedAt 时退回网页当前时刻。
  const doneClock = formatClock(step.finishedAt) || formatClock(new Date(now).toISOString())
  const timeNode = running
    ? <span className="team-card-time" data-live="true" title="本次执行用时">{formatDuration(elapsedOf(step.startedAt, step.finishedAt, now))}</span>
    : finished
      ? <span className="team-card-time" data-state={step.status} title="完成时刻">{done ? '✓' : '✕'} {doneClock}</span>
      : step.status === 'skipped'
        ? <span className="team-card-time">⏭ 跳过</span>
        : <span className="team-card-time">{stepStatusText(step.status)}</span>

  return (
    <div
      className="team-card team-surface"
      data-status={step.status}
      data-parallel={parallel ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-label={`${step.roleName} ${stepStatusText(step.status)}${parallel ? '（并行执行）' : ''}`}
      onClick={() => onOpen(step)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen(step) }}
    >
      <div className="team-card-head">
        <span className="team-card-icon" aria-hidden="true">{stepIcon(step.status)}</span>
        <span className="team-card-name">{step.roleName}</span>
        {parallel ? <span className="team-par-badge" title="与同波次角色并行执行">‖</span> : null}
        <span className="team-card-idx">#{step.index + 1}</span>
      </div>

      {running ? (
        /* 执行中聚焦态：这一行是「正在思考…」，当前任务另起一行，
           不渲染 tagline/模型/进度条/输出摘要 —— 只留过程焦点。 */
        <div className="team-card-live">
          <span className="team-card-live-dot" aria-hidden="true" />
          <span className="team-card-live-text">正在思考…</span>
        </div>
      ) : (
        <>
          {step.tagline !== '' ? <div className="team-card-tag">{step.tagline}</div> : null}
          <div className="team-card-model">
            {model !== '' ? (
              <>
                <span className="team-card-model-name" title={`${step.modelUsed.provider}/${step.modelUsed.model}`}>{model}</span>
                <span className="team-card-src" data-src={step.modelSource}>{SOURCE_LABEL[step.modelSource]}</span>
              </>
            ) : (
              <span className="team-card-model-name">—</span>
            )}
          </div>
          {step.todos !== undefined && step.todos.length > 0 ? (
            <div className="team-card-todos" title={`任务清单：${step.todos.filter(t => t.status === 'completed').length}/${step.todos.length} 完成`}>
              <span className="team-card-todos-fill" style={{
                width: `${(step.todos.filter(t => t.status === 'completed').length / step.todos.length) * 100}%`,
              }} />
              <span className="team-card-todos-text">
                {step.todos.filter(t => t.status === 'completed').length}/{step.todos.length} 任务
              </span>
            </div>
          ) : null}
          {inherited ? <div className="team-card-inherit team-card-time">继承会话模型</div> : null}
        </>
      )}

      {running && currentTodo !== null ? (
        <div className="team-card-todo-now" title="当前任务">{currentTodo.content}</div>
      ) : null}

      {timeNode}

      {step.status === 'error' && step.error !== undefined ? (
        <div className="team-card-err">
          {step.error}
          {step.retries !== undefined && step.retries > 0 ? `（重试 ${step.retries} 次后仍失败）` : ''}
        </div>
      ) : step.output !== '' ? (
        <div className="team-card-out">{step.output}</div>
      ) : null}
    </div>
  )
}
