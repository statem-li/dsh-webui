/**
 * team — 单角色运行卡（HUD 内，docs §6.6）。
 *
 * 布局铁律：**固定槽位**。卡片始终按同样的 5 个槽位渲染，状态只改内容不改结构 ——
 * 旧版把 running 态渲染成「只有一行正在思考」、done 态渲染成「tagline+模型+进度条」，
 * 于是同一波次里的卡片高度参差不齐、每步状态切换时整个网格跳一次，这是「布局乱」
 * 的主因。现在无论什么状态都是：
 *
 *   ① head    状态点 + 角色名 + 并行/备用徽标 + 步序
 *   ② meta    模型 · 来源 · 通道（缺省显示 —）
 *   ③ phase   当前在干什么（running=阶段+说明；done=完成时刻+产出量；error=归类徽标）
 *   ④ bar     进度条（有 todo 用完成比例，否则 running 时用不确定态流光）
 *   ⑤ focus   当前任务 / 输出尾巴 / 失败原因（定高两行，不撑卡）
 *
 * 点击卡片 → 打开该步执行详情卡。
 */

import { SOURCE_LABEL, type RunStep } from './types.ts'
import {
  elapsedOf, errorKindText, formatClock, formatDuration, phaseIcon, phaseText,
  shortModel, stepStatusText,
} from './util.ts'

export interface RoleRunCardProps {
  step: RunStep
  now: number
  /** 同波次是否有并行伙伴。 */
  parallel?: boolean
  onOpen: (step: RunStep) => void
}

/** 千分位化的产出字符数（“1.2k 字”比 “1234 字符” 更好扫读）。 */
function formatChars(count: number): string {
  if (count <= 0) return ''
  if (count < 1000) return `${count} 字`
  return `${(count / 1000).toFixed(1)}k 字`
}

/** 渲染一张角色运行卡。 */
export function RoleRunCard({ step, now, parallel = false, onOpen }: RoleRunCardProps): JSX.Element {
  const running = step.status === 'running'
  const done = step.status === 'done'
  const failed = step.status === 'error'
  const model = shortModel(step.modelUsed)
  const inherited = step.channel === 'subagent'
  const todos = step.todos ?? []
  const todoDone = todos.filter(t => t.status === 'completed').length
  /** 当前任务：优先执行中的 todo，其次第一个待办。 */
  const currentTodo = todos.find(t => t.status === 'in_progress') ?? todos.find(t => t.status === 'pending') ?? null

  // 右上角计时：执行中走秒；完成/失败显示时刻；其余显示状态词。
  const doneClock = formatClock(step.finishedAt) || formatClock(new Date(now).toISOString())
  const timeNode = running
    ? (
        <span className="team-card-time" data-live="true" title="本步已执行时间">
          {formatDuration(elapsedOf(step.startedAt, step.finishedAt, now))}
        </span>
      )
    : done || failed
      ? <span className="team-card-time" data-state={step.status} title="结束时刻">{done ? '✓' : '✕'} {doneClock}</span>
      : step.status === 'skipped'
        ? <span className="team-card-time">⏭ 跳过</span>
        : <span className="team-card-time">{stepStatusText(step.status)}</span>

  /** 槽位③：这一步现在（或最终）处于什么状态，一行讲清。 */
  const phaseLine = running
    ? (
        <span className="team-card-phase" data-phase={step.phase ?? 'dispatch'}>
          <span className="team-card-live-dot" aria-hidden="true" />
          <span className="team-card-phase-name">{phaseIcon(step.phase)} {phaseText(step.phase)}</span>
          {step.phaseNote !== undefined && step.phaseNote !== '' ? (
            <span className="team-card-phase-note" title={step.phaseNote}>{step.phaseNote}</span>
          ) : null}
          {step.phaseSince !== undefined && step.phaseSince !== '' ? (
            <span className="team-card-phase-since">{formatDuration(elapsedOf(step.phaseSince, undefined, now))}</span>
          ) : null}
        </span>
      )
    : failed
      ? (
          <span className="team-card-phase" data-phase="error">
            <span className="team-card-kind" data-kind={step.errorKind ?? 'unknown'}>
              {errorKindText(step.errorKind) !== '' ? errorKindText(step.errorKind) : '失败'}
            </span>
            {step.retries !== undefined && step.retries > 0 ? (
              <span className="team-card-phase-note">已重试 {step.retries} 次</span>
            ) : null}
          </span>
        )
      : done
        ? (
            <span className="team-card-phase" data-phase="done">
              <span className="team-card-phase-name">完成</span>
              {step.outputChars !== undefined && step.outputChars > 0 ? (
                <span className="team-card-phase-note">产出 {formatChars(step.outputChars)}</span>
              ) : null}
              {todos.length > 0 ? <span className="team-card-phase-note">{todoDone}/{todos.length} 任务</span> : null}
            </span>
          )
        : (
            <span className="team-card-phase" data-phase="pending">
              <span className="team-card-phase-name">{step.status === 'skipped' ? '未执行（上游中断）' : '排队等待'}</span>
            </span>
          )

  /** 槽位④：进度条。有 todo 用真实比例；running 无 todo 用不确定态流光；否则细底条。 */
  const ratio = todos.length > 0 ? todoDone / todos.length : done ? 1 : 0
  const indeterminate = running && todos.length === 0

  /** 槽位⑤：焦点文本（当前任务 > 失败原因 > 输出尾巴 > tagline）。 */
  const focusText = running && currentTodo !== null
    ? currentTodo.content
    : failed && step.error !== undefined && step.error !== ''
      ? step.error
      : step.output !== '' ? step.output : step.tagline

  return (
    <div
      className="team-card team-surface"
      data-status={step.status}
      data-parallel={parallel ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-label={`${step.roleName} ${stepStatusText(step.status)}${running ? `，${phaseText(step.phase)}` : ''}${parallel ? '（并行执行）' : ''}`}
      onClick={() => onOpen(step)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen(step) }}
    >
      {/* ① 标题行 */}
      <div className="team-card-head">
        <span className="team-dot" data-status={step.status} aria-hidden="true" />
        <span className="team-card-name">{step.roleName}</span>
        {parallel ? <span className="team-par-badge" title="与同波次角色并行执行">‖</span> : null}
        {step.fallbackUsed === true ? (
          <span className="team-fb-badge" title="主模型失败，已自动降级到备用模型">备用</span>
        ) : null}
        {step.resumeRound !== undefined && step.resumeRound > 0 ? (
          <span className="team-fb-badge" data-kind="resume" title={`由第 ${step.resumeRound} 轮一键接续重跑`}>续</span>
        ) : null}
        {timeNode}
      </div>

      {/* ② 模型行（固定占位，避免状态切换时高度跳变） */}
      <div className="team-card-model">
        {model !== '' ? (
          <>
            <span className="team-card-model-name" title={`${step.modelUsed.provider}/${step.modelUsed.model}`}>{model}</span>
            <span className="team-card-src" data-src={step.modelSource}>{SOURCE_LABEL[step.modelSource]}</span>
          </>
        ) : (
          <span className="team-card-model-name">—</span>
        )}
        {inherited ? <span className="team-card-chan" title="subagent 通道：有工具，模型继承会话">工具</span> : null}
        <span className="team-card-idx">#{step.index + 1}</span>
      </div>

      {/* ③ 阶段行 */}
      {phaseLine}

      {/* ④ 进度条 */}
      <div
        className="team-card-bar"
        data-indeterminate={indeterminate ? 'true' : 'false'}
        title={todos.length > 0 ? `任务清单 ${todoDone}/${todos.length}` : phaseText(step.phase)}
      >
        <span className="team-card-bar-fill" style={indeterminate ? undefined : { width: `${ratio * 100}%` }} />
      </div>

      {/* ⑤ 焦点文本（定高，超出淡出） */}
      <div className="team-card-focus" data-kind={failed ? 'error' : running ? 'live' : 'idle'}>
        {focusText !== '' ? focusText : '—'}
      </div>
    </div>
  )
}
