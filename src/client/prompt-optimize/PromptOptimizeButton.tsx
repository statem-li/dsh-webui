/**
 * PromptOptimizeButton — 对话框「自动优化提示词」图标按钮。
 *
 * 注册在 `conversation.input.right`（order 5，位于供应商标签 order 10 的左侧）。
 * 点击后用当前会话选中的模型（ModelDirectory store 的 `current`）优化输入框
 * 草稿：草稿与选中模型 → POST /api/webui-prompt-optimize（SSE 流式）→ 边收
 * text 增量边写回草稿，图标上方 popover 展示优化链路与实时进度。
 *
 * 草稿读取走 owner 共享（InputZone.input，随 skeleton 重渲染实时更新），
 * 写回走标准 kit 的 `inputActions.setDraft`（唯一公开写入路径），不碰 DOM。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import type { SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { IconLoadingOutline16, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { css, ensureStyles } from './styles'

/** 优化入口的注入面（inject 返回）。 */
export interface PromptOptimizeInjected {
  /** 本会话是否支持模型选择（addressed subagent 会话为 false）。 */
  available: boolean
  /** 会话共享的模型目录 store（读当前选中 provider/model）。 */
  directory: SnapshotStore<ModelDirectoryState>
  /** 所属会话 id：POST 时回传，供 host 端「显式停止」定位本次优化。 */
  sessionId: SessionId
}

/** 组件完整 props：注入面 + owner（草稿）+ 标准 kit（写回）。 */
export interface PromptOptimizeProps extends PromptOptimizeInjected {
  /** 输入区 owner 共享（InputZone.input 的结构子集：只读草稿）。 */
  input: { draft: string }
  /** 输入动作面（结构子集：写回优化后的草稿）。 */
  inputActions: { setDraft: (text: string) => void }
}

/** popover 生命周期阶段。 */
type Phase = 'idle' | 'optimizing' | 'done' | 'error'

/** SSE 帧负载（host 端发送）。 */
interface StreamFrame {
  type?: 'delta' | 'done' | 'error'
  text?: string
  elapsedMs?: number
  message?: string
}

/** 把毫秒格式化为可读耗时。 */
function formatMs(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '已完成'
  if (ms < 1000) return `已完成 · ${String(Math.round(ms))}ms`
  return `已完成 · ${(ms / 1000).toFixed(1)}s`
}

/** 「设定目标提示词」开关的 localStorage 键。 */
const TARGET_KEY = 'dsh-webui:prompt-optimize:set-target'
/** 「使用 AI 浏览器验证」开关的 localStorage 键。 */
const VERIFY_KEY = 'dsh-webui:prompt-optimize:verify-browser'

/** 从 localStorage 读开关状态；缺省值在首次（从未点过）时生效。 */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : raw !== '0'
  } catch {
    return fallback
  }
}

/** 把开关状态写入 localStorage（选择过即持久化）。 */
function writeFlag(key: string, value: boolean): void {
  try { window.localStorage.setItem(key, value ? '1' : '0') } catch { /* ignore */ }
}

/**
 * 渲染「自动优化提示词」图标按钮。
 * @param props - injected face + owner + standard kit。
 * @returns 图标按钮，或 null（subagent 会话不渲染）。
 */
export function PromptOptimizeButton({ available, directory, input, inputActions, sessionId }: PromptOptimizeProps) {
  ensureStyles()
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [phase, setPhase] = useState<Phase>('idle')
  const [detail, setDetail] = useState('')
  const [hovered, setHovered] = useState(false)
  // 「设定目标提示词」开关：默认 ON，localStorage 持久化（缺省视为开启）。
  const [setTarget, setSetTarget] = useState<boolean>(() => readFlag(TARGET_KEY, true))
  // 「使用 AI 浏览器验证」开关：默认 OFF，localStorage 持久化（缺省视为关闭）。
  const [verifyWithBrowser, setVerifyWithBrowser] = useState<boolean>(() => readFlag(VERIFY_KEY, false))
  const closeTimer = useRef<number | null>(null)
  const hoverLeaveTimer = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const busy = phase === 'optimizing'

  // 卸载时清理「完成后短暂停留」与「hover 延迟关闭」的定时器。
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current)
  }, [])

  if (!available) return null

  const cancelHoverHide = (): void => {
    if (hoverLeaveTimer.current !== null) {
      window.clearTimeout(hoverLeaveTimer.current)
      hoverLeaveTimer.current = null
    }
  }

  // 鼠标进入图标或卡片：立即显示并取消延迟关闭。
  const showPanel = (): void => {
    cancelHoverHide()
    setHovered(true)
  }

  // 鼠标移出：延迟 2 秒再隐藏，给用户时间把鼠标移到卡片上点开关。
  const scheduleHide = (): void => {
    cancelHoverHide()
    hoverLeaveTimer.current = window.setTimeout(() => {
      hoverLeaveTimer.current = null
      setHovered(false)
    }, 2000)
  }

  const finish = (next: Phase, text: string): void => {
    setPhase(next)
    setDetail(text)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      setPhase('idle')
      setDetail('')
    }, next === 'done' ? 2400 : 3800)
  }

  const toggleTarget = (): void => {
    setSetTarget(prev => {
      const next = !prev
      writeFlag(TARGET_KEY, next)
      return next
    })
  }

  const toggleVerify = (): void => {
    setVerifyWithBrowser(prev => {
      const next = !prev
      writeFlag(VERIFY_KEY, next)
      return next
    })
  }

  /** 紧急停止：中止 fetch，并显式通知 host 中止模型调用（不依赖 TCP 断开检测）。 */
  const stop = (): void => {
    abortRef.current?.abort()
    // 显式停止：host 端按会话定位本次优化并 abort 模型，确保真正停止生成。
    void fetch('/api/webui-prompt-optimize/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => { /* 停止通知失败不影响 fetch 中止 */ })
  }

  // 当前选中模型的显示名（用于链路展示；供应商已在图标旁单独展示，此处只显示模型）。
  const current = state.current
  const modelName = state.groups.flatMap(group => group.models).find(model => model.id === current?.model)?.name
    ?? current?.model
    ?? '未选模型'

  const optimize = async (): Promise<void> => {
    if (busy) return
    const draft = input.draft.trim()
    if (draft === '') {
      finish('error', '请先输入要优化的提示词')
      return
    }
    if (current === null || current.provider === undefined || current.model === undefined) {
      finish('error', '请先选择模型')
      return
    }

    const original = input.draft
    setPhase('optimizing')
    setDetail('正在调用模型…')

    const controller = new AbortController()
    abortRef.current = controller
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let wroteDraft = false
    try {
      const response = await fetch('/api/webui-prompt-optimize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: current.provider, model: current.model, text: draft, setTarget, verifyWithBrowser, sessionId }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`优化请求失败（HTTP ${String(response.status)}）`)
      if (response.body === null) throw new Error('无响应流')
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''
      let sawTerminal = false

      const onFrame = (payload: StreamFrame): void => {
        if (payload.type === 'delta' && typeof payload.text === 'string') {
          accumulated += payload.text
          inputActions.setDraft(accumulated)
          wroteDraft = true
          setDetail(`正在优化 · 已生成 ${String(accumulated.length)} 字`)
          return
        }
        if (payload.type === 'done') {
          sawTerminal = true
          // 两个开关都不自动触发任何任务：只决定写回草稿的形式，
          // 全部由用户点发送后才生效（/goal 命令 / 附加验证要求）。
          const objective = accumulated.trim()
          if (objective === '') {
            finish('done', formatMs(payload.elapsedMs))
            return
          }
          if (setTarget) {
            inputActions.setDraft(`/goal ${objective}`)
            finish('done', '已完成 · 已生成 /goal')
          } else if (verifyWithBrowser) {
            inputActions.setDraft(`${objective}\n\n请用 AI 浏览器实际验证上面这条提示词能否正常工作，并简要报告验证结论。`)
            finish('done', '已完成 · 已附加浏览器验证')
          } else {
            finish('done', formatMs(payload.elapsedMs))
          }
          return
        }
        if (payload.type === 'error') {
          sawTerminal = true
          throw new Error(payload.message ?? '优化失败')
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '') continue
            let payload: unknown
            try { payload = JSON.parse(data) } catch { continue }
            onFrame(payload as StreamFrame)
          }
        }
      }
      buffer += decoder.decode()

      // 流结束但未收到 done/error（罕见异常）：按已生成内容兜底。
      // 若此时是用户主动停止（signal 已 abort），交给 catch 显示「已停止优化」，
      // 不要误判为「已完成」。
      if (!sawTerminal) {
        if (controller.signal.aborted) throw new Error('stopped')
        if (wroteDraft) finish('done', '已完成')
        else throw new Error('响应流意外结束')
      }
    } catch (error) {
      // 已开始写入草稿时失败/停止：恢复原文，避免留下残缺的优化中间态。
      if (wroteDraft) inputActions.setDraft(original)
      if (controller.signal.aborted) {
        finish('error', '已停止优化')
      } else {
        finish('error', `失败：${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      if (reader !== null) reader.cancel().catch(() => {})
    }
  }

  const panelVisible = hovered || phase !== 'idle'
  const statusClass = phase === 'optimizing' ? css.statusOptimizing
    : phase === 'done' ? css.statusDone
      : phase === 'error' ? css.statusError
        : undefined

  return (
    <div
      className={css.root}
      onMouseEnter={showPanel}
      onMouseLeave={scheduleHide}
    >
      <button
        type="button"
        className={css.trigger}
        aria-label="自动优化提示词"
        title="自动优化提示词"
        disabled={busy}
        onClick={() => { void optimize() }}
      >
        {busy ? <IconLoadingOutline16 className={css.busy} /> : <IconSparkle16 />}
      </button>

      {panelVisible && (
        <div
          className={`${css.panel} dsh-glass-anim-in`}
          role="group"
          aria-label="提示词优化面板"
          onMouseEnter={showPanel}
          onMouseLeave={scheduleHide}
        >
          <div className={css.panelTitle}>优化提示词</div>
          <div className={css.caption}>用 {modelName} 优化当前草稿</div>
          <div className={css.options}>
            <div className={css.option}>
              <span className={css.optionLabel}>设定目标</span>
              <button
                type="button"
                role="switch"
                aria-checked={setTarget}
                aria-label="设定目标提示词"
                className={clsx(css.switch, setTarget && css.switchOn)}
                onClick={toggleTarget}
              >
                <span className={clsx(css.knob, setTarget && css.knobOn)} />
              </button>
            </div>
            <div className={css.option}>
              <span className={css.optionLabel}>浏览器验证</span>
              <button
                type="button"
                role="switch"
                aria-checked={verifyWithBrowser}
                aria-label="使用 AI 浏览器验证"
                className={clsx(css.switch, verifyWithBrowser && css.switchOn)}
                onClick={toggleVerify}
              >
                <span className={clsx(css.knob, verifyWithBrowser && css.knobOn)} />
              </button>
            </div>
          </div>
          <div className={clsx(css.status, statusClass)}>
            {phase === 'optimizing' && <IconLoadingOutline16 className={css.busy} />}
            <span>{phase === 'idle' ? '点击用当前模型优化' : detail}</span>
          </div>
          {busy && (
            <button type="button" className={css.stop} onClick={stop}>
              停止优化
            </button>
          )}
        </div>
      )}
    </div>
  )
}
