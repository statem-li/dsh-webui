/**
 * team — 对话流悬浮执行 HUD（docs §6.6）。
 *
 * 本会话存在活跃 Run（queued/running）时，在对话区顶部浮出：
 *  - 折叠态一行：团队名 · 链名 + 步骤圆点 + n/总数 + 总耗时
 *  - 展开态：任务、TODO 进度条、**每角色一张运行卡**（状态/模型来源/单步计时/
 *    流式摘要）、产物入口、取消运行
 * 运行结束后停留 15s 显示汇总，再收起为一枚小胶囊（点开＝回看本次运行详情）。
 * 多团队并发时按 Run 分段渲染。
 *
 * 数据：轮询 /api/webui-team/runs/active?sessionId=（运行中 1.2s、空闲 5s）。
 * 定位：跟随对话滚动容器的可视宽度居中，fixed 浮层（HUD 自身可加 backdrop-filter，
 * 不给布局列容器加 filter/transform——遵守 dsh-ui-style 铁律）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import * as api from './api.ts'
import { ensureTeamStyles } from './styles.ts'
import { RoleRunCard } from './RoleRunCard.tsx'
import type { Run, RunStep } from './types.ts'
import { elapsedOf, formatDuration, runStatusText } from './util.ts'

/** 轮询间隔。 */
const POLL_ACTIVE_MS = 1200
const POLL_IDLE_MS = 5000
/** 运行结束后 HUD 停留时长。 */
const LINGER_MS = 15_000
/** 展开态持久化键。 */
const EXPAND_KEY = 'dsh-webui.team.hud.expanded'

/** 对话滚动容器候选选择器（取第一个命中的可见元素）。 */
const CONVERSATION_SELECTORS = [
  '[data-slot="conversation.chat"]',
  '[class*="conversationScroll"]',
  '[class*="chatScroll"]',
  '[class*="messageList"]',
  'main',
]

function readExpanded(): boolean {
  try { return window.localStorage.getItem(EXPAND_KEY) !== '0' } catch { return true }
}

function writeExpanded(value: boolean): void {
  try { window.localStorage.setItem(EXPAND_KEY, value ? '1' : '0') } catch { /* ignore */ }
}

/** 找对话区可视矩形（用于 HUD 水平居中与宽度）。 */
function conversationRect(): { left: number, width: number, top: number } | null {
  for (const selector of CONVERSATION_SELECTORS) {
    const element = document.querySelector(selector)
    if (element === null) continue
    const rect = element.getBoundingClientRect()
    if (rect.width < 200 || rect.height < 100) continue
    return { left: rect.left, width: rect.width, top: rect.top }
  }
  return null
}

/** 当前会话 id（sessions.currentProvideInfo 快照，与 automation/models.ts 同源）。 */
function useSessionId(ctx: ClientContext): string {
  const [sessionId, setSessionId] = useState('')
  useEffect(() => {
    let dispose: (() => void) | null = null
    try {
      ctx.inject(['sessions'], (scope) => {
        const sessions = scope.sessions as {
          currentProvideInfo: { getSnapshot: () => unknown, subscribe: (fn: () => void) => () => void }
        }
        const read = (): void => {
          const info = sessions.currentProvideInfo.getSnapshot() as { sessionId?: unknown } | undefined
          const id = typeof info?.sessionId === 'string' ? info.sessionId : ''
          setSessionId(previous => (previous === id ? previous : id))
        }
        read()
        dispose = sessions.currentProvideInfo.subscribe(read)
      })
    } catch {
      dispose = null
    }
    return () => { dispose?.() }
  }, [ctx])
  return sessionId
}

/** HUD 主体。 */
export function RunHud({ ctx }: { ctx: ClientContext }): JSX.Element | null {
  ensureTeamStyles()
  const sessionId = useSessionId(ctx)
  const [runs, setRuns] = useState<Run[]>([])
  const [finished, setFinished] = useState<Run | null>(null)
  const [expanded, setExpanded] = useState<boolean>(() => readExpanded())
  const [now, setNow] = useState(() => Date.now())
  const [layout, setLayout] = useState<{ left: number, width: number, top: number } | null>(null)
  const [viewing, setViewing] = useState<{ title: string, content: string } | null>(null)
  const [collapsedPill, setCollapsedPill] = useState(false)
  const lingerTimer = useRef(0)

  const active = runs.length > 0
  const shown = active ? runs : (finished !== null ? [finished] : [])

  // 轮询活跃运行。
  useEffect(() => {
    if (sessionId === '') { setRuns([]); return }
    let alive = true
    let timer = 0
    const tick = async (): Promise<void> => {
      try {
        const data = await api.getActiveRuns(sessionId)
        if (!alive) return
        setRuns(data.runs)
        if (data.runs.length > 0) {
          setFinished(null)
          setCollapsedPill(false)
          window.clearTimeout(lingerTimer.current)
        } else if (data.lastFinished !== undefined) {
          // 刚结束的运行：停留 LINGER_MS 后收成胶囊。
          setFinished((previous) => {
            const next = data.lastFinished as Run
            if (previous !== null && previous.id === next.id) return previous
            window.clearTimeout(lingerTimer.current)
            lingerTimer.current = window.setTimeout(() => { setCollapsedPill(true) }, LINGER_MS)
            return next
          })
        }
      } catch { /* 忽略轮询错误 */ }
      if (!alive) return
      timer = window.setTimeout(() => { void tick() }, runs.length > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS)
    }
    void tick()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [sessionId, runs.length])

  // 秒级 tick（仅运行中）。
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [active])

  // 位置跟随（resize / 滚动容器变化）。
  useEffect(() => {
    if (shown.length === 0) return
    const measure = (): void => { setLayout(conversationRect()) }
    measure()
    const timer = window.setInterval(measure, 1200)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
    }
  }, [shown.length])

  useEffect(() => () => { window.clearTimeout(lingerTimer.current) }, [])

  const toggle = useCallback((): void => {
    setExpanded((previous) => {
      writeExpanded(!previous)
      return !previous
    })
  }, [])

  const openStep = useCallback(async (run: Run, step: RunStep): Promise<void> => {
    if (step.outputFile === undefined || step.outputFile === '') {
      if (step.output !== '') setViewing({ title: `${step.roleName} · 进行中`, content: step.output })
      return
    }
    try {
      const data = await api.getRunOutput(run.id, step.outputFile)
      setViewing({ title: `${step.roleName} · 第 ${step.index + 1} 步`, content: data.content })
    } catch { /* ignore */ }
  }, [])

  const openFinal = useCallback(async (run: Run): Promise<void> => {
    try {
      const data = await api.getRunOutput(run.id, 'final')
      setViewing({ title: `最终交付物 · ${run.teamName}`, content: data.content })
    } catch { /* ignore */ }
  }, [])

  if (shown.length === 0) return null

  const style: React.CSSProperties = layout !== null
    ? {
        left: Math.round(layout.left + 12),
        width: Math.round(Math.min(layout.width - 24, 720)),
        top: Math.round(Math.max(8, layout.top + 8)),
      }
    : { left: '50%', transform: 'translateX(-50%)', width: 'min(720px, 92vw)', top: 10 }

  // 收起为胶囊（运行已结束且停留期已过）。
  if (collapsedPill && !active) {
    const run = shown[0]
    return createPortal(
      <div
        className="team-pill"
        style={{ left: style.left, top: style.top, ...(style.transform !== undefined ? { transform: style.transform } : {}) }}
        role="button"
        onClick={() => { setCollapsedPill(false); setExpanded(true) }}
      >
        <span>👥 {run.teamName}</span>
        <span data-status={run.status}>{runStatusText(run.status)}</span>
      </div>,
      document.body,
    )
  }

  const primary = shown[0]
  const totalDone = shown.reduce((sum, run) => sum + run.steps.filter(s => s.status === 'done').length, 0)
  const totalSteps = shown.reduce((sum, run) => sum + run.steps.length, 0)
  const state = active ? 'running' : primary.status

  return createPortal(
    <>
      <div className="team-hud" data-state={state} style={style}>
        <div className="team-hud-bar" role="button" onClick={toggle} aria-expanded={expanded}>
          <span className="team-hud-title">
            👥 {shown.length > 1 ? `${shown.length} 个团队运行中` : primary.teamName}
          </span>
          {shown.length === 1 ? <span className="team-hud-chain">{primary.chainName}</span> : null}
          <span className="team-hud-pips">
            {(shown.length === 1 ? primary.steps : []).map(step => (
              <span key={step.index} className="team-hud-pip" data-status={step.status} />
            ))}
          </span>
          <span className="team-hud-count">{totalDone}/{totalSteps} 步</span>
          <span className="team-hud-time">
            ⏱ {formatDuration(elapsedOf(primary.startedAt, active ? undefined : primary.finishedAt, now))}
          </span>
          <span className="team-chevron" data-open={expanded} style={{ marginLeft: 4 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>

        {expanded ? (
          <div className="team-hud-body">
            {shown.map(run => (
              <RunSegment
                key={run.id}
                run={run}
                now={now}
                multi={shown.length > 1}
                onOpenStep={step => void openStep(run, step)}
                onOpenFinal={() => void openFinal(run)}
                onCancel={() => { void api.cancelRun(run.id).catch(() => {}) }}
              />
            ))}
          </div>
        ) : null}
      </div>

      {viewing !== null ? (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,.45))',
          }}
          onClick={() => setViewing(null)}
        >
          <div
            className="team-hud"
            style={{ position: 'relative', left: 'auto', top: 'auto', width: 'min(720px, 92vw)', maxHeight: '80vh' }}
            onClick={event => event.stopPropagation()}
          >
            <div className="team-viewer-head">
              <span className="team-viewer-title" title={viewing.title}>{viewing.title}</span>
              <button type="button" className="psh-close" aria-label="关闭" onClick={() => setViewing(null)}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <pre className="team-viewer-body" style={{ maxHeight: 'calc(80vh - 48px)' }}>{viewing.content}</pre>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  )
}

/** 单个 Run 的分段（任务 + 进度条 + 角色卡网格 + 产物/取消）。 */
function RunSegment({ run, now, multi, onOpenStep, onOpenFinal, onCancel }: {
  run: Run
  now: number
  multi: boolean
  onOpenStep: (step: RunStep) => void
  onOpenFinal: () => void
  onCancel: () => void
}): JSX.Element {
  const done = run.steps.filter(s => s.status === 'done').length
  const running = run.steps.filter(s => s.status === 'running').length
  const pending = run.steps.filter(s => s.status === 'pending').length
  const failed = run.steps.filter(s => s.status === 'error' || s.status === 'skipped').length
  const total = Math.max(1, run.steps.length)
  const live = run.status === 'running' || run.status === 'queued'
  const files = run.steps.filter(step => step.outputFile !== undefined).length

  return (
    <div className={multi ? 'team-hud-seg' : 'team-hud-seg'} style={multi ? undefined : { paddingTop: 8 }}>
      {multi ? (
        <div className="team-hud-seg-head">
          <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary, #eee)' }}>{run.teamName}</span>
          <span>{run.chainName}</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace' }}>
            {formatDuration(elapsedOf(run.startedAt, live ? undefined : run.finishedAt, now))}
          </span>
        </div>
      ) : null}

      <div className="team-hud-task">
        <span className="team-hud-task-text">任务：{run.task}</span>
        {live ? (
          <button type="button" className="team-btn team-btn-danger" style={{ flex: 'none' }} onClick={onCancel}>取消运行</button>
        ) : null}
      </div>

      <div className="team-progress">
        <div className="team-progress-fill" style={{ width: `${(done / total) * 100}%` }} />
        {failed > 0 ? (
          <div className="team-progress-fail" style={{ left: `${(done / total) * 100}%`, width: `${(failed / total) * 100}%` }} />
        ) : null}
      </div>
      <div className="team-progress-text">
        <span>{done}/{run.steps.length} 完成</span>
        {running > 0 ? <span>{running} 进行中</span> : null}
        {pending > 0 ? <span>{pending} 待办</span> : null}
        {failed > 0 ? <span style={{ color: 'var(--dsw-alias-state-error-primary, #e0434b)' }}>{failed} 异常</span> : null}
        <span style={{ marginLeft: 'auto' }} data-status={run.status}>{runStatusText(run.status)}</span>
      </div>

      <div className="team-cards">
        {run.steps.map(step => (
          <RoleRunCard key={step.index} step={step} now={now} onOpen={onOpenStep} />
        ))}
      </div>

      <div className="team-hud-foot">
        {files > 0 ? <span>产物 {files} 个步骤文件</span> : null}
        {run.finalFile !== undefined ? (
          <button type="button" className="team-btn team-btn-primary" onClick={onOpenFinal}>打开最终交付物</button>
        ) : null}
        {run.error !== undefined ? <span style={{ color: 'var(--dsw-alias-state-error-primary, #e0434b)' }}>{run.error}</span> : null}
      </div>
    </div>
  )
}
