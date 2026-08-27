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
import { MarkstreamMarkdown } from '../markdown/renderer.tsx'
import { SOURCE_LABEL, type Run, type RunStep } from './types.ts'
import {
  elapsedOf, errorKindAdvice, errorKindText, formatClock, formatDuration, phaseIcon, phaseText,
  runStatusText, shortModel, stepIcon, stepStatusText,
} from './util.ts'

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

/** 左侧导航/会话栏候选（面板必须避开它，不能压在导航上）。 */
const SIDEBAR_SELECTORS = [
  '[data-slot="sidebar"]',
  '[class*="sidebar"]',
  'aside',
]

/** 底部输入区候选（面板停在它上方，不遮挡输入）。 */
const COMPOSER_SELECTORS = [
  '[data-slot="composer"]',
  '[class*="composer"]',
  '[class*="inputArea"]',
  'form',
]

/** 面板占视口高度的比例（可切档：紧凑=底部三分之一，放大=三分之二）。 */
const DOCK_RATIO_COMPACT = 1 / 3
const DOCK_RATIO_TALL = 2 / 3
/** 面板与各边的安全间距。 */
const DOCK_GAP = 12
/** 面板最小可用高度（低于此值就不值得展开了）。 */
const DOCK_MIN_HEIGHT = 190
/** 高度档位持久化键。 */
const TALL_KEY = 'dsh-webui.team.hud.tall'

function readExpanded(): boolean {
  try { return window.localStorage.getItem(EXPAND_KEY) !== '0' } catch { return true }
}

function writeExpanded(value: boolean): void {
  try { window.localStorage.setItem(EXPAND_KEY, value ? '1' : '0') } catch { /* ignore */ }
}

function readTall(): boolean {
  try { return window.localStorage.getItem(TALL_KEY) === '1' } catch { return false }
}

function writeTall(value: boolean): void {
  try { window.localStorage.setItem(TALL_KEY, value ? '1' : '0') } catch { /* ignore */ }
}

/** 取第一个"够大"的命中元素矩形。 */
function firstRect(selectors: readonly string[], minW: number, minH: number): DOMRect | null {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect()
      if (rect.width < minW || rect.height < minH) continue
      return rect
    }
  }
  return null
}

/** 面板停靠区域。 */
interface DockLayout {
  left: number
  width: number
  /** 展开态面板的顶边（= 底部三分之一的起点）。 */
  top: number
  /** 可用高度（top → 输入区上沿）。 */
  height: number
  /** 折叠条/胶囊底边所在的 y（= 输入区上沿，留出间距）。 */
  bottomAnchor: number
  /** 对话框内容列（折叠条/胶囊在该列内居中，与输入框对齐）。 */
  colLeft: number
  colRight: number
}

/**
 * 探测对话框的「内容列」：composer 内真正承载输入的元素（textarea /
 * contenteditable）所在的竖列 —— 面板宽度跟随它，和对话框严丝合缝上下对齐。
 * 找不到内部元素时退化为 composer 自身，再退化为对话区、视口中央安全列。
 */
function contentColumn(): { left: number, right: number } | null {
  const composer = firstRect(COMPOSER_SELECTORS, 200, 24)
  if (composer !== null) {
    const container = document.querySelector(COMPOSER_SELECTORS.join(','))
    const inner = container?.querySelector('textarea, [contenteditable="true"], [class*="input"]')
    if (inner !== null && inner !== undefined) {
      const rect = inner.getBoundingClientRect()
      if (rect.width >= 260) return { left: rect.left, right: rect.right }
    }
    if (composer.width >= 260) return { left: composer.left, right: composer.right }
  }
  const conversation = firstRect(CONVERSATION_SELECTORS, 200, 100)
  if (conversation !== null) return { left: conversation.left, right: conversation.right }
  return null
}

/**
 * 计算停靠矩形：
 * **横向**严格跟随对话框内容列（textarea 所在竖列），左右边缘与对话框对齐；
 * **纵向**取「对话区自身」的下 1/3（紧凑）或下 2/3（放大档），并停在输入框上方 ——
 * 波次多的时候紧凑档只能看到一两波，放大档一屏看全，档位由用户切换并持久化。
 */
function dockRect(ratio: number): DockLayout | null {
  const conversation = firstRect(CONVERSATION_SELECTORS, 200, 100)
  const sidebar = firstRect(SIDEBAR_SELECTORS, 80, 200)
  const composer = firstRect(COMPOSER_SELECTORS, 200, 24)

  // 横向：以对话框内容列为基准；仍确保不越出侧栏右侧。
  const column = contentColumn()
  const sidebarRight = sidebar !== null && sidebar.left <= 1 ? sidebar.right : 0
  const leftRaw = Math.max(column?.left ?? 0, sidebarRight) + DOCK_GAP
  const rightRaw = Math.min(column?.right ?? window.innerWidth, window.innerWidth) - DOCK_GAP
  const width = rightRaw - leftRaw
  if (width < 260) return null

  // 纵向不变：下边界绝不越过输入区上沿，上边界取对话区的 (1-ratio) 处。
  const composerTop = composer !== null ? composer.top : window.innerHeight
  const bottom = Math.min(conversation?.bottom ?? window.innerHeight, composerTop) - DOCK_GAP

  const areaTop = conversation?.top ?? 0
  const areaHeight = bottom - areaTop
  const top = areaHeight > 0
    ? Math.max(DOCK_GAP, Math.round(areaTop + areaHeight * (1 - ratio)))
    : Math.max(DOCK_GAP, Math.round(window.innerHeight * (1 - ratio)))

  const height = bottom - top
  if (height < DOCK_MIN_HEIGHT) return null

  return {
    left: Math.round(leftRaw),
    width: Math.round(width),
    top: Math.round(top),
    height: Math.round(height),
    bottomAnchor: Math.round(bottom),
    colLeft: Math.round(leftRaw),
    colRight: Math.round(rightRaw),
  }
}

/** 当前会话 id（sessions.currentProvideInfo 快照，与 automation/models.ts 同源）。 */
export function useSessionId(ctx: ClientContext): string {
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
  /** 高度档位：false=底部 1/3（紧凑），true=底部 2/3（放大，波次多时一屏看全）。 */
  const [tall, setTall] = useState<boolean>(() => readTall())
  const [now, setNow] = useState(() => Date.now())
  const [layout, setLayout] = useState<DockLayout | null>(null)
  /** 打开的详情卡：step=角色执行详情（跟随轮询实时刷新），final=最终交付物全文。 */
  const [viewing, setViewing] = useState<{ kind: 'step', runId: string, index: number } | { kind: 'final', runId: string } | null>(null)
  const [collapsedPill, setCollapsedPill] = useState(false)
  /** 正在请求接续的 run id（禁用按钮 + 转圈）。 */
  const [resuming, setResuming] = useState('')
  /** 接续失败的提示（轮询不会自己清，点一下横幅或再次点击才消失）。 */
  const [resumeError, setResumeError] = useState('')
  const lingerTimer = useRef(0)

  const active = runs.length > 0
  const shown = active ? runs : (finished !== null ? [finished] : [])

  // 切换会话：立刻清空上一个会话的残留（HUD 是"本会话"视图，
  // 旧会话的 runs/finished/胶囊都必须消失，否则会挂在新会话上误导用户）。
  useEffect(() => {
    window.clearTimeout(lingerTimer.current)
    setRuns([])
    setFinished(null)
    setCollapsedPill(false)
    setViewing(null)
  }, [sessionId])

  // 轮询活跃运行：服务端已按会话严格隔离（本会话无运行就返回空）。
  // 二次校验会话归属：轮询响应可能是切会话前发出的（in-flight），不校验会把
  // 上一个会话的运行回填到新会话的 HUD 上。
  useEffect(() => {
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
          const next = data.lastFinished as Run
          if (next.sessionId !== undefined && next.sessionId !== sessionId) return
          setFinished((previous) => {
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

  // 新运行开始（无→有）：自动展开面板，任务清单/实时输出直接可见。
  // 不写 localStorage：保留用户手动折叠的偏好，运行中折叠不会被反复弹开。
  const wasActive = useRef(false)
  useEffect(() => {
    const isActive = runs.length > 0
    if (isActive && !wasActive.current) setExpanded(true)
    wasActive.current = isActive
  }, [runs.length > 0])

  // 秒级 tick（仅运行中）。
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [active])

  // 位置跟随：窗口 resize 立即重测；仅对话框列变化（如收起/展开侧栏）不触发
  // window resize，由 1200ms 轮询兜底 —— 面板宽度始终跟随对话框列自适应。
  // 布局值没变时保留旧引用跳过 setState，避免每秒无意义的重渲染。
  useEffect(() => {
    if (shown.length === 0) return
    const measure = (): void => {
      setLayout((previous) => {
        const next = dockRect(tall ? DOCK_RATIO_TALL : DOCK_RATIO_COMPACT)
        if (previous !== null && next !== null &&
            previous.left === next.left && previous.width === next.width &&
            previous.top === next.top && previous.height === next.height &&
            previous.bottomAnchor === next.bottomAnchor &&
            previous.colLeft === next.colLeft && previous.colRight === next.colRight) {
          return previous
        }
        return next
      })
    }
    measure()
    const timer = window.setInterval(measure, 1200)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
    }
  }, [shown.length, tall])

  useEffect(() => () => { window.clearTimeout(lingerTimer.current) }, [])

  const toggle = useCallback((): void => {
    setExpanded((previous) => {
      writeExpanded(!previous)
      return !previous
    })
  }, [])

  // 点卡片 → 弹出执行详情卡（内容从 shown 实时取，流式过程自动跟随）。
  const openStep = useCallback((run: Run, step: RunStep): void => {
    setViewing({ kind: 'step', runId: run.id, index: step.index })
  }, [])

  const openFinal = useCallback((run: Run): void => {
    setViewing({ kind: 'final', runId: run.id })
  }, [])

  /**
   * 一键接续：在同一个 run 上重跑未完成步骤。
   * 成功后立刻把返回的 run 塞进 runs（不等下一次轮询），HUD 马上回到运行态；
   * 失败把原因显示在失败横幅下方，不静默吞掉。
   */
  const resume = useCallback(async (run: Run): Promise<void> => {
    if (resuming !== '') return
    setResuming(run.id)
    setResumeError('')
    try {
      const data = await api.resumeRun(run.id, sessionId)
      setFinished(null)
      setCollapsedPill(false)
      setExpanded(true)
      setRuns([data.run])
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : String(error))
    } finally {
      setResuming('')
    }
  }, [resuming, sessionId])

  if (shown.length === 0) return null

  // 展开态铺满停靠区（对话区下三分之一）；
  // 折叠态收成一条**居中悬浮在对话框上方**的窄条。
  // 居中一律用 left/right 对撑 + margin-inline:auto + width:fit-content，
  // 绝不用 translateX(-50%) —— 入场动画 dsh-modal-slide-in 的 keyframes 会在
  // 播放期间整体接管 transform，把内联的 translateX 覆盖掉造成位置闪跳。
  const style: React.CSSProperties = layout !== null
    ? (expanded
        ? { left: layout.left, width: layout.width, top: layout.top, height: layout.height }
        : {
            // 在对话框内容列内居中（与输入框同轴），不是视口居中
            left: layout.colLeft,
            right: Math.max(0, window.innerWidth - layout.colRight),
            marginInline: 'auto',
            width: 'fit-content',
            maxWidth: layout.width,
            height: 44,
            top: 'auto',
            bottom: Math.max(8, window.innerHeight - layout.bottomAnchor),
          })
    : { left: 0, right: 0, marginInline: 'auto', width: 'fit-content', maxWidth: 'min(720px, 92vw)', bottom: 16, top: 'auto' }

  // 收起为胶囊：同样**在对话框列内居中**、悬浮在对话框上方，与折叠条位置一致。
  if (collapsedPill && !active) {
    const run = shown[0]
    const canResume = run.resumable ?? run.steps.some(step => step.status !== 'done')
    const pillStyle: React.CSSProperties = layout !== null
      ? {
          left: layout.colLeft,
          right: Math.max(0, window.innerWidth - layout.colRight),
          marginInline: 'auto',
          width: 'fit-content',
          top: 'auto',
          bottom: Math.max(8, window.innerHeight - layout.bottomAnchor),
        }
      : { left: 0, right: 0, marginInline: 'auto', width: 'fit-content', bottom: 16, top: 'auto' }
    return createPortal(
      <div
        className="team-pill team-surface"
        style={pillStyle}
        role="button"
        title={`${run.teamName} · ${runStatusText(run.status)}（点击展开本次运行详情）`}
        onClick={() => { setCollapsedPill(false); setExpanded(true) }}
      >
        <span>👥 {run.teamName}</span>
        <span className="team-status-text" data-status={run.status}>{runStatusText(run.status)}</span>
        {/* 失败/中断收起后也能直接接续，不用先展开面板 */}
        {canResume && run.status !== 'done' ? (
          <button
            type="button"
            className="team-resume-btn"
            style={{ height: 20, padding: '0 9px', fontSize: 11 }}
            disabled={resuming === run.id}
            title="只重跑未完成的步骤"
            onClick={(event) => { event.stopPropagation(); void resume(run) }}
          >
            {resuming === run.id ? <span className="team-resume-spin" aria-hidden="true" /> : '↻'} 接续
          </button>
        ) : null}
      </div>,
      document.body,
    )
  }

  const primary = shown[0]
  const totalDone = shown.reduce((sum, run) => sum + run.steps.filter(s => s.status === 'done').length, 0)
  const totalSteps = shown.reduce((sum, run) => sum + run.steps.length, 0)
  const state = active ? 'running' : primary.status
  /** 折叠态也要能看到「现在谁在干什么」：取运行中的步骤做一行摘要。 */
  const liveSteps = shown.flatMap(run => run.steps).filter(step => step.status === 'running')
  const liveSummary = liveSteps.length === 0
    ? ''
    : liveSteps.length === 1
      ? `${liveSteps[0].roleName} · ${phaseIcon(liveSteps[0].phase)} ${phaseText(liveSteps[0].phase)}`
      : `${liveSteps.length} 个角色并行：${liveSteps.map(step => step.roleName).join('、')}`

  return createPortal(
    <>
      <div className="team-hud" data-collapsed={!expanded} style={style}>
        <div className="team-hud-bar team-surface" data-state={state} role="button" onClick={toggle} aria-expanded={expanded}>
          <span className="team-hud-title">
            👥 {shown.length > 1 ? `${shown.length} 个团队运行中` : primary.teamName}
          </span>
          {/* 折叠态优先显示实时摘要（谁在干什么），空闲时才退回链名 */}
          {liveSummary !== '' ? (
            <span className="team-hud-live">
              <span className="team-card-live-dot" aria-hidden="true" />
              <span className="team-hud-live-text">{liveSummary}</span>
            </span>
          ) : shown.length === 1 ? <span className="team-hud-chain">{primary.chainName}</span> : null}
          <span className="team-hud-pips">
            {(shown.length === 1 ? primary.steps : []).map(step => (
              <span key={step.index} className="team-hud-pip" data-status={step.status} />
            ))}
          </span>
          <span className="team-hud-count">{totalDone}/{totalSteps} 步</span>
          <span className="team-hud-time">
            ⏱ {formatDuration(elapsedOf(primary.startedAt, active ? undefined : primary.finishedAt, now))}
          </span>
          {/* 高度档位：波次多时切「放大」一屏看全（点击不触发折叠，需阻止冒泡） */}
          {expanded ? (
            <button
              type="button"
              className="team-hud-sizebtn"
              data-on={tall ? 'true' : 'false'}
              title={tall ? '收窄面板（占对话区下 1/3）' : '放大面板（占对话区下 2/3）'}
              aria-label={tall ? '收窄面板' : '放大面板'}
              onClick={(event) => {
                event.stopPropagation()
                setTall((value) => { writeTall(!value); return !value })
              }}
            >{tall ? '⇱' : '⇲'}</button>
          ) : null}
          <span className="team-chevron" data-open={expanded} style={{ marginLeft: 4 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>

        {expanded ? (
          <div className="team-hud-body">
            {resumeError !== '' ? (
              <div className="team-fail" data-kind="unknown" role="alert" onClick={() => setResumeError('')}>
                <div className="team-fail-head">接续失败</div>
                <div className="team-fail-msg">{resumeError}</div>
                <div className="team-fail-advice">点此关闭；修正后可再次点「一键接续」。</div>
              </div>
            ) : null}
            {shown.map(run => (
              <RunSegment
                key={run.id}
                run={run}
                now={now}
                multi={shown.length > 1}
                busy={resuming === run.id}
                onOpenStep={step => void openStep(run, step)}
                onOpenFinal={() => void openFinal(run)}
                onCancel={() => { void api.cancelRun(run.id, sessionId).catch(() => {}) }}
                onResume={() => { void resume(run) }}
              />
            ))}
          </div>
        ) : null}
      </div>

      {viewing !== null ? (
        <StepDetailCard viewing={viewing} shown={shown} now={now} onClose={() => setViewing(null)} />
      ) : null}
    </>,
    document.body,
  )
}

/** 详情卡打开目标。 */
type StepViewing = { kind: 'step', runId: string, index: number } | { kind: 'final', runId: string }

/**
 * 把步骤按波次分组（同一波次 = 并行执行）。
 * 旧快照没有 wave 字段时按 index 兜底，等价于每步独占一波（全串行）。
 */
function groupStepsByWave(steps: readonly RunStep[]): RunStep[][] {
  const buckets = new Map<number, RunStep[]>()
  for (const step of steps) {
    const wave = typeof step.wave === 'number' ? step.wave : step.index
    const list = buckets.get(wave)
    if (list === undefined) buckets.set(wave, [step])
    else list.push(step)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group.sort((a, b) => a.index - b.index))
}

/**
 * 执行详情卡：点角色卡弹出，展示该角色的完整执行过程。
 *
 * 布局：**左过程 / 右输出**双栏（窄屏自动堆叠）。左栏回答「这一步经历了什么」——
 * 当前阶段、任务清单、每次尝试的轨迹（含失败归类与降级模型）、上游输入；右栏是
 * 产出正文。旧版把这些全部竖着堆在输出上方，运行中要滚很久才能看到输出。
 *
 * 内容从 shown（轮询实时数据）取 —— 运行中的输出快照会随 1.2s 轮询自动刷新；
 * 步骤完成（有产物文件）或查看最终交付物时，额外拉取全文。
 */
function StepDetailCard({ viewing, shown, now, onClose }: {
  viewing: StepViewing
  shown: readonly Run[]
  now: number
  onClose: () => void
}): JSX.Element | null {
  const run = shown.find(item => item.id === viewing.runId) ?? null
  const step = viewing.kind === 'step' && run !== null
    ? run.steps.find(item => item.index === viewing.index) ?? null
    : null

  // 全文加载：final 或 已完成的步骤（有产物文件）才拉；失败降级显示快照。
  const file = viewing.kind === 'final'
    ? 'final'
    : (step !== null && step.status === 'done' && step.outputFile !== undefined ? step.outputFile : null)
  const [full, setFull] = useState<{ text: string, failed: boolean } | null>(null)
  /** 输出显示方式：false=Markdown 渲染（默认），true=纯文本原文。 */
  const [rawMode, setRawMode] = useState(false)
  useEffect(() => {
    setFull(null)
    if (run === null || file === null || file === '') return
    let alive = true
    api.getRunOutput(run.id, file)
      .then(data => { if (alive) setFull({ text: data.content, failed: false }) })
      .catch(() => { if (alive) setFull({ text: '', failed: true }) })
    return () => { alive = false }
  }, [run?.id, file])

  // Esc 关闭。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  if (run === null) return null

  const title = viewing.kind === 'final'
    ? `最终交付物 · ${run.teamName}`
    : `${step?.roleName ?? '角色'} · 第 ${(step?.wave ?? step?.index ?? 0) + 1} 波`
  const todos = step?.todos ?? []
  const attempts = step?.attempts ?? []

  return (
    <div className="team-step-mask" onClick={onClose}>
      <div
        className="team-step-card"
        data-view={viewing.kind}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={event => event.stopPropagation()}
      >
        <div className="team-step-head">
          {step !== null ? (
            <span className="team-card-icon" aria-hidden="true">{stepIcon(step.status)}</span>
          ) : (
            <span className="team-card-icon" aria-hidden="true">📦</span>
          )}
          <span className="team-step-title" title={title}>{title}</span>
          {step !== null && step.tagline !== '' ? <span className="team-step-tagline">{step.tagline}</span> : null}
          <button type="button" className="psh-close" aria-label="关闭" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {step !== null ? (
          /* 元信息徽标行：状态 · 阶段 · 模型（含备用标记）· 通道 · 计时 */
          <div className="team-step-meta">
            <span className="team-step-badge" data-status={step.status}>{stepStatusText(step.status)}</span>
            {step.status === 'running' ? (
              <span className="team-step-badge" data-status="running">
                {phaseIcon(step.phase)} {phaseText(step.phase)}
                {step.phaseSince !== undefined && step.phaseSince !== ''
                  ? ` · ${formatDuration(elapsedOf(step.phaseSince, undefined, now))}`
                  : ''}
              </span>
            ) : null}
            {step.status === 'error' && errorKindText(step.errorKind) !== '' ? (
              <span className="team-card-kind" data-kind={step.errorKind}>{errorKindText(step.errorKind)}</span>
            ) : null}
            {shortModel(step.modelUsed) !== '' ? (
              <span className="team-step-badge team-step-badge-model" title={`${step.modelUsed.provider}/${step.modelUsed.model}`}>
                {shortModel(step.modelUsed)}
                <em className="team-card-src" data-src={step.modelSource}>{SOURCE_LABEL[step.modelSource]}</em>
                {step.fallbackUsed === true ? <em className="team-fb-badge">备用</em> : null}
              </span>
            ) : null}
            {step.channel !== undefined ? (
              <span className="team-step-badge">{step.channel === 'subagent' ? 'subagent · 继承会话模型' : 'llm 直跑'}</span>
            ) : null}
            <span className="team-step-badge team-step-time" data-state={step.status}>
              {step.status === 'running'
                ? `⏱ ${step.startedAt !== undefined ? formatDuration(elapsedOf(step.startedAt, step.finishedAt, now)) : '--:--'}`
                : step.status === 'done'
                  ? `✓ ${formatClock(step.finishedAt) || formatClock(new Date(now).toISOString())} 完成`
                  : step.status === 'error'
                    ? `✕ ${formatClock(step.finishedAt) || formatClock(new Date(now).toISOString())}`
                    : step.status === 'skipped'
                      ? '已跳过'
                      : '待办'}
            </span>
          </div>
        ) : null}

        {/* 失败横幅：归类 + 建议（接续入口在 HUD 主面板上，这里只解释怎么办） */}
        {step !== null && step.status === 'error' && step.error !== undefined && step.error !== '' ? (
          <div className="team-fail" data-kind={step.errorKind ?? 'unknown'}>
            <div className="team-fail-head">
              <span>本步失败</span>
              {errorKindText(step.errorKind) !== '' ? (
                <span className="team-card-kind" data-kind={step.errorKind}>{errorKindText(step.errorKind)}</span>
              ) : null}
              {step.retries !== undefined && step.retries > 0 ? (
                <span style={{ fontWeight: 400, color: 'var(--dsw-alias-label-tertiary,#888)' }}>已重试 {step.retries} 次</span>
              ) : null}
            </div>
            <div className="team-fail-msg">{step.error}</div>
            {errorKindAdvice(step.errorKind) !== '' ? (
              <div className="team-fail-advice">{errorKindAdvice(step.errorKind)}</div>
            ) : null}
          </div>
        ) : null}

        {/* 双栏主体：左=过程，右=输出。
            最终交付物视图没有 step（无过程栏）→ 必须切成单栏，否则输出会被挤进
            左侧 320px 轨道、右边空一大片（grid 轨道即使无子元素也占宽）。 */}
        <div className="team-step-cols" data-cols={step !== null ? 'two' : 'one'}>
          {step !== null ? (
            <div className="team-step-side">
              {/* 任务清单 */}
              {todos.length > 0 ? (
                <div className="team-step-todos">
                  <div className="team-step-todos-head">
                    📋 任务清单 · {todos.filter(t => t.status === 'completed').length}/{todos.length} 完成
                  </div>
                  <ul className="team-step-todos-list">
                    {todos.map((todo, i) => (
                      <li key={i} data-status={todo.status}>
                        <span className="team-step-todos-box" aria-hidden="true">
                          {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '●' : ''}
                        </span>
                        <span className="team-step-todos-text">{todo.content}</span>
                        <span className="team-step-todos-tag">
                          {todo.status === 'completed' ? '已完成' : todo.status === 'in_progress' ? '进行中' : '未开始'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* 尝试轨迹：每次调用用了哪个模型、失败归类、退避多久 */}
              {attempts.length > 0 ? (
                <div className="team-step-todos">
                  <div className="team-step-todos-head">🧪 尝试轨迹 · {attempts.length} 次</div>
                  <ul className="team-attempts">
                    {attempts.map(item => (
                      <li key={item.attempt} data-status={item.status}>
                        <span className="team-attempt-no">#{item.attempt}</span>
                        <span className="team-attempt-model" title={`${item.model.provider}/${item.model.model}`}>
                          {item.model.model}
                        </span>
                        {item.fallback ? <span className="team-fb-badge">备用</span> : null}
                        {item.status === 'error' && errorKindText(item.errorKind) !== '' ? (
                          <span className="team-card-kind" data-kind={item.errorKind}>{errorKindText(item.errorKind)}</span>
                        ) : (
                          <span className="team-attempt-ok">成功</span>
                        )}
                        <span className="team-attempt-dur">
                          {formatDuration(elapsedOf(item.startedAt, item.finishedAt, now))}
                          {item.backoffMs !== undefined ? ` · 退避 ${Math.round(item.backoffMs / 1000)}s` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* 装配与警告 */}
              {(step.warning !== undefined && step.warning !== '') || step.capabilities !== undefined ? (
                <div className="team-step-notes">
                  {step.capabilities !== undefined ? (
                    <span>装配：{step.capabilities.toolMode === 'inherit' ? '工具继承' : `工具 ${step.capabilities.tools.length} 项`}
                      {step.capabilities.skillMode !== 'inherit' ? ` · 技能 ${step.capabilities.skills.length} 项` : ''}</span>
                  ) : null}
                  {step.warning !== undefined && step.warning !== '' ? <span>{step.warning}</span> : null}
                </div>
              ) : null}

              {/* 上游输入快照 */}
              {step.inputSnapshot !== '' ? (
                <details className="team-step-section">
                  <summary>收到的任务（上游输入摘要）</summary>
                  <pre className="team-step-pre">{step.inputSnapshot}</pre>
                </details>
              ) : null}
            </div>
          ) : null}

          {/* 输出区：默认 Markdown 渲染（角色产出即 markdown，流式实时长出来），
              可切「原文」看纯文本便于复制。全文拉取失败降级快照并注明。 */}
          <div className="team-step-output-wrap">
            <div className="team-step-output-label">
              <span>输出{step?.outputChars !== undefined && step.outputChars > 0 ? ` · ${step.outputChars} 字` : ''}</span>
              <span className="team-step-viewtoggle" role="group" aria-label="输出显示方式">
                <button type="button" data-on={!rawMode} onClick={() => setRawMode(false)}>渲染</button>
                <button type="button" data-on={rawMode} onClick={() => setRawMode(true)}>原文</button>
              </span>
            </div>
            {(() => {
              const text = full !== null && !full.failed && full.text !== '' ? full.text : (step?.output ?? '')
              const streaming = step?.status === 'running'
              if (text === '') {
                const waiting = step !== null && step.status === 'running'
                return (
                  <div className="team-step-empty">
                    {step === null
                      ? (full === null && file !== null ? '正在加载全文…' : '暂无内容')
                      : step.status === 'pending'
                        ? '尚未开始执行'
                        : step.status === 'skipped'
                          ? '本步被跳过（上游失败或运行取消）'
                          : waiting
                            ? `${phaseText(step.phase)}${step.phaseNote !== undefined && step.phaseNote !== '' ? ` · ${step.phaseNote}` : ''}…`
                            : (full === null && file !== null ? '正在加载全文…' : '本步没有产出文本')}
                  </div>
                )
              }
              if (rawMode) {
                return (
                  <>
                    <pre className="team-step-pre team-step-pre-full">{text}</pre>
                    {file !== null && full?.failed === true ? <div className="team-step-note">全文加载失败，以上为尾部快照。</div> : null}
                  </>
                )
              }
              return (
                <>
                  <div className="team-step-md">
                    <MarkstreamMarkdown text={text} streaming={streaming === true} />
                  </div>
                  {step !== null && step.status === 'running' ? (
                    <div className="team-step-streaming">
                      <span className="team-dot" data-status="running" />
                      {phaseText(step.phase)}，内容实时刷新…
                    </div>
                  ) : null}
                  {file !== null && full?.failed === true ? <div className="team-step-note">全文加载失败，以上为尾部快照。</div> : null}
                </>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 单个 Run 的分段（任务 + 进度条 + 波次时间轴 + 失败横幅 + 产物/取消）。 */
function RunSegment({ run, now, multi, busy, onOpenStep, onOpenFinal, onCancel, onResume }: {
  run: Run
  now: number
  multi: boolean
  /** 接续请求进行中（禁用按钮 + 转圈）。 */
  busy: boolean
  onOpenStep: (step: RunStep) => void
  onOpenFinal: () => void
  onCancel: () => void
  onResume: () => void
}): JSX.Element {
  const done = run.steps.filter(s => s.status === 'done').length
  const running = run.steps.filter(s => s.status === 'running').length
  const pending = run.steps.filter(s => s.status === 'pending').length
  const failed = run.steps.filter(s => s.status === 'error' || s.status === 'skipped').length
  const total = Math.max(1, run.steps.length)
  const live = run.status === 'running' || run.status === 'queued'
  const files = run.steps.filter(step => step.outputFile !== undefined).length
  /** 按波次分组（同波次即并行执行）；旧快照无 wave 时退化为每步一波。 */
  const waveGroups = useMemo(() => groupStepsByWave(run.steps), [run.steps])
  const layered = waveGroups.length > 1 || waveGroups.some(group => group.length > 1)
  /** 任务全文展开（长任务默认折叠三行，点「全文」展开）。 */
  const [taskOpen, setTaskOpen] = useState(false)
  const taskLong = run.task.length > 150

  /** 能否一键接续：服务端给的 resumable 优先，缺省时本地按同一规则兜底。 */
  const resumable = run.resumable ?? (!live && run.steps.some(step => step.status !== 'done'))
  const failKind = run.errorKind ?? run.steps.find(step => step.errorKind !== undefined)?.errorKind
  const showFail = !live && (run.status === 'error' || run.status === 'cancelled'
    || run.status === 'interrupted' || failed > 0)

  return (
    <div className="team-hud-seg">
      {multi ? (
        <div className="team-hud-seg-head">
          <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary, #eee)' }}>{run.teamName}</span>
          <span>{run.chainName}</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace' }}>
            {formatDuration(elapsedOf(run.startedAt, live ? undefined : run.finishedAt, now))}
          </span>
        </div>
      ) : null}

      {/* 任务 + 进度：一张独立卡片 */}
      <div className="team-hud-meta team-surface">
        <div className="team-hud-task" data-open={taskOpen ? 'true' : 'false'}>
          <span className="team-hud-tasklabel">任务</span>
          <span className="team-hud-task-text">{run.task}</span>
          {taskLong ? (
            <button type="button" className="team-hud-taskmore" onClick={() => setTaskOpen(value => !value)}>
              {taskOpen ? '收起' : '全文'}
            </button>
          ) : null}
          {live ? (
            <button type="button" className="team-btn team-btn-danger" style={{ flex: 'none' }} onClick={onCancel}>取消运行</button>
          ) : null}
        </div>
        {run.planNote !== undefined && run.planNote !== '' ? (
          <div className="team-progress-text" style={{ alignItems: 'flex-start' }}>
            <span>🧩 分工：{run.planNote}</span>
          </div>
        ) : null}

        <div className="team-progress">
          <div className="team-progress-fill" style={{ width: `${(done / total) * 100}%` }} />
          {failed > 0 ? (
            <div className="team-progress-fail" style={{ left: `${(done / total) * 100}%`, width: `${(failed / total) * 100}%` }} />
          ) : null}
        </div>
        <div className="team-progress-text">
          <span>{done}/{run.steps.length} 完成</span>
          {running > 1 ? <span>{running} 个并行进行中</span> : running === 1 ? <span>1 进行中</span> : null}
          {pending > 0 ? <span>{pending} 待办</span> : null}
          {failed > 0 ? <span style={{ color: 'var(--dsw-alias-state-error-primary, #e0434b)' }}>{failed} 异常</span> : null}
          {layered ? <span>{waveGroups.length} 波次</span> : null}
          {run.resumeCount !== undefined && run.resumeCount > 0 ? <span>已接续 {run.resumeCount} 次</span> : null}
          <span style={{ marginLeft: 'auto' }} className="team-status-text" data-status={run.status}>{runStatusText(run.status)}</span>
        </div>
      </div>

      {/* 失败横幅：归类 + 原因 + 处置建议 + 一键接续（只重跑未完成步骤） */}
      {showFail ? (
        <div className="team-fail" data-kind={failKind ?? 'unknown'}>
          <div className="team-fail-head">
            <span>{run.status === 'cancelled' ? '运行已取消' : run.status === 'interrupted' ? '运行被中断' : '运行未完成'}</span>
            {errorKindText(failKind) !== '' ? <span className="team-card-kind" data-kind={failKind}>{errorKindText(failKind)}</span> : null}
            <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--dsw-alias-label-tertiary,#888)' }}>
              {done}/{run.steps.length} 已完成，{run.steps.length - done} 步待补
            </span>
          </div>
          {run.error !== undefined && run.error !== '' ? <div className="team-fail-msg">{run.error}</div> : null}
          {errorKindAdvice(failKind) !== '' ? <div className="team-fail-advice">{errorKindAdvice(failKind)}</div> : null}
          <div className="team-fail-actions">
            {resumable ? (
              <button type="button" className="team-resume-btn" disabled={busy} onClick={onResume}>
                {busy ? <span className="team-resume-spin" aria-hidden="true" /> : <span aria-hidden="true">↻</span>}
                {busy ? '接续中…' : '一键接续（只重跑未完成步骤）'}
              </button>
            ) : null}
            <span className="team-fail-advice">已完成步骤的产物会保留，不会重复消耗。</span>
          </div>
        </div>
      ) : null}

      {/* 波次时间轴：一波一行（左轴标 + 右等宽卡片网格）。
          顺序自上而下 = 执行先后；同一行里的多张卡 = 并行同时跑。 */}
      <div className="team-cards-wrap team-surface">
        <div className="team-cards">
          {waveGroups.map((group, i) => {
            const waveLive = group.some(step => step.status === 'running')
            const waveDone = group.every(step => step.status === 'done')
            const waveFailed = group.some(step => step.status === 'error')
            const state = waveLive ? 'running' : waveFailed ? 'error' : waveDone ? 'done' : 'pending'
            return (
              <div
                key={`wave-${i}`}
                className="team-wave-row"
                data-live={waveLive ? 'true' : 'false'}
                data-state={state}
              >
                <div className="team-wave-axis">
                  <span className="team-wave-tag">第 {i + 1} 波</span>
                  {group.length > 1 ? <span className="team-wave-par">‖ {group.length} 并行</span> : null}
                  <span className="team-wave-count">
                    {group.filter(step => step.status === 'done').length}/{group.length}
                  </span>
                </div>
                <div className="team-wave-cards">
                  {group.map(step => (
                    <RoleRunCard
                      key={step.index}
                      step={step}
                      now={now}
                      parallel={group.length > 1}
                      onOpen={onOpenStep}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {files > 0 || run.finalFile !== undefined ? (
        <div className="team-hud-foot team-surface">
          {files > 0 ? <span>产物 {files} 个步骤文件</span> : null}
          {run.finalFile !== undefined ? (
            <button type="button" className="team-btn team-btn-primary" onClick={onOpenFinal}>打开最终交付物</button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
