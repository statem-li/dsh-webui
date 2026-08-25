/**
 * team — 单角色运行卡（HUD 内，docs §6.6）。
 *
 * 字段：状态图标 + 角色名 + 步序；tagline；实际模型 + 来源徽标（subagent 通道
 * 标「继承会话」）；单步计时（运行中实时走秒）；输出摘要 / 失败原因。
 * 点击卡片 → 请求打开该步全文。
 */

import { SOURCE_LABEL, type RunStep } from './types.ts'
import { elapsedOf, formatDuration, shortModel, stepIcon, stepStatusText } from './util.ts'

export interface RoleRunCardProps {
  step: RunStep
  now: number
  onOpen: (step: RunStep) => void
}

/** 渲染一张角色运行卡。 */
export function RoleRunCard({ step, now, onOpen }: RoleRunCardProps): JSX.Element {
  const running = step.status === 'running'
  const timeText = step.startedAt !== undefined
    ? `${formatDuration(elapsedOf(step.startedAt, step.finishedAt, now))} ${running ? '进行中' : stepStatusText(step.status)}`
    : stepStatusText(step.status)
  const model = shortModel(step.modelUsed)
  const inherited = step.channel === 'subagent'

  return (
    <div
      className="team-card team-surface"
      data-status={step.status}
      role="button"
      tabIndex={0}
      aria-label={`${step.roleName} ${stepStatusText(step.status)}`}
      onClick={() => onOpen(step)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen(step) }}
    >
      <div className="team-card-head">
        <span className="team-card-icon" aria-hidden="true">{stepIcon(step.status)}</span>
        <span className="team-card-name">{step.roleName}</span>
        <span className="team-card-idx">#{step.index + 1}</span>
      </div>

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
      {/* 子 agent 任务清单进度（有清单时才显示） */}
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

      <div className="team-card-time">{timeText}</div>

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
