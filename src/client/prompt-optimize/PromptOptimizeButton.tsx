/**
 * PromptOptimizeButton — 对话框「优化提示词」入口（v2 重做）。
 *
 * 注册在 `conversation.input.right`（order 5，位于供应商标签 order 10 左侧）。
 *
 * 交互（旧版三宗罪的针对性修复）：
 *  1. **点击开面板，不再 hover 抖动**：hover 面板会在鼠标经过输入区时乱弹，
 *     且开关点不中；现在点击图标开/关面板，Esc 与点击外部关闭。
 *  2. **结果先预览、点「应用」才写回草稿**：旧版流式直接改草稿，用户既看不清
 *     改了什么，中途失败还得靠代码回滚原文；现在原文始终留在输入框，面板里
 *     并列展示原文与优化结果。
 *  3. **风格三档取代「多轮候选」**：均衡 / 精简 / 详尽，换档即重试（自动中止
 *     上一次），不再一次并行烧 3~5 倍 token。
 *
 * 结果正文由 host 用共享的 `cleanOptimized` 清洗（去围栏 / 去「优化后的提示词」
 * 小标题 / 去结尾「主要改动」段落），client 收到的 done 帧即可直接写回。
 *
 * 草稿读取走 owner 共享（InputZone.input，随 skeleton 重渲染实时更新），
 * 写回走标准 kit 的 `inputActions.setDraft`（唯一公开写入路径），不碰 DOM。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import {
  IconCloseOutline16, IconLoadingOutline16, IconRefreshOutline14, IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { cleanOptimized, collapseToLine, previewOptimized } from '../../prompt-optimize-clean.js'
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

/** 优化风格（与 host 的 STYLE_RULES 对应）。 */
type Style = 'balanced' | 'concise' | 'detailed'

/** 风格 chips 文案。 */
const STYLES: ReadonlyArray<{ id: Style; label: string; hint: string }> = [
  { id: 'balanced', label: '均衡', hint: '补齐目标、约束与输出格式，长度大致不变' },
  { id: 'concise', label: '精简', hint: '压到最短，只保留必要要求' },
  { id: 'detailed', label: '详尽', hint: '补充上下文、输入输出格式与验收标准' },
]

/** SSE 帧负载（host 端发送）。 */
interface StreamFrame {
  type?: 'delta' | 'done' | 'error'
  text?: string
  elapsedMs?: number
  partial?: boolean
  message?: string
}

/** localStorage 键：上次选择的风格 / 「设为目标」开关。 */
const STYLE_KEY = 'dsh-webui:prompt-optimize:style'
const TARGET_KEY = 'dsh-webui:prompt-optimize:set-target'

/** 面板与图标之间的间距（px）。 */
const PANEL_GAP = 10

/** 读上次选择的风格（默认均衡）。 */
function readStyle(): Style {
  try {
    const raw = window.localStorage.getItem(STYLE_KEY)
    return raw === 'concise' || raw === 'detailed' ? raw : 'balanced'
  } catch {
    return 'balanced'
  }
}

/** 读「设为目标」开关（默认关：/goal 会创建长任务目标，不该是默认行为）。 */
function readTarget(): boolean {
  try { return window.localStorage.getItem(TARGET_KEY) === '1' } catch { return false }
}

/** 写 localStorage（失败静默：隐私模式下仍按内存值工作）。 */
function store(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* ignore */ }
}

/** 把毫秒格式化为可读耗时。 */
function formatMs(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  return ms < 1000 ? `${String(Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** 面板定位样式（贴图标上方、右对齐，夹在视口内）。 */
function panelStyle(anchor: DOMRect | null): { left: number; bottom: number } | undefined {
  if (anchor === null) return undefined
  const width = Math.min(560, window.innerWidth - 24)
  const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))
  return { left, bottom: Math.max(12, window.innerHeight - anchor.top + PANEL_GAP) }
}

/**
 * 渲染「优化提示词」入口（图标 + 面板）。
 * @param props - injected face + owner + standard kit。
 * @returns 图标按钮，或 null（subagent 会话不渲染）。
 */
export function PromptOptimizeButton({ available, directory, input, inputActions, sessionId }: PromptOptimizeProps) {
  ensureStyles()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [style, setStyle] = useState<Style>(readStyle)
  const [setTarget, setSetTarget] = useState<boolean>(readTarget)
  /** 本次优化的原文（打开面板时快照，重试期间保持不变）。 */
  const [source, setSource] = useState('')
  /** 流式累积的原始输出（仅用于预览；最终以 done 帧的清洗文本为准）。 */
  const [streamed, setStreamed] = useState('')
  /** 清洗后的最终结果（可应用）。 */
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState('')
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const closeTimer = useRef<number | null>(null)
  /** 本次流式的原始累积输出（停止 / done 缺 text 时用于就地清洗）。 */
  const accRef = useRef('')
  /** 最新草稿（供异步回调读取，避免闭包陈旧）。 */
  const draftRef = useRef(input.draft)
  draftRef.current = input.draft

  /** 中止进行中的优化，并显式通知 host 停止模型调用。 */
  const stop = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null
    void fetch('/api/webui-prompt-optimize/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => { /* 停止通知失败不影响本地中止 */ })
  }, [sessionId])

  /** 发起一次优化（换风格重试走同一入口）。 */
  const run = useCallback(async (text: string, nextStyle: Style): Promise<void> => {
    const provider = directory.getSnapshot().current?.provider
    const model = directory.getSnapshot().current?.model
    if (provider === undefined || model === undefined) {
      setError('请先在右侧选择模型')
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError('')
    setElapsed('')
    setStreamed('')
    setResult('')

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    try {
      const response = await fetch('/api/webui-prompt-optimize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, model, text, style: nextStyle, sessionId }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`优化请求失败（HTTP ${String(response.status)}）`)
      if (response.body === null) throw new Error('无响应流')
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let terminal = false
      accRef.current = ''

      const onFrame = (frame: StreamFrame): void => {
        if (frame.type === 'delta' && typeof frame.text === 'string') {
          accRef.current += frame.text
          setStreamed(prev => prev + frame.text)
          return
        }
        if (frame.type === 'done') {
          terminal = true
          // host 已用共享清洗器处理过；缺 text（旧 host / 空帧）时本地兜底清洗，
          // 保证「装了新 client 但 host 还没重启」也能正常出结果。
          const done = typeof frame.text === 'string' && frame.text !== ''
            ? frame.text
            : cleanOptimized(accRef.current)
          setResult(done)
          setElapsed(formatMs(frame.elapsedMs))
          if (frame.partial === true) setError('生成被中断，下面是已完成的部分')
          return
        }
        if (frame.type === 'error') {
          terminal = true
          throw new Error(frame.message ?? '优化失败')
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index: number
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '') continue
            let payload: unknown
            try { payload = JSON.parse(data) } catch { continue }
            onFrame(payload as StreamFrame)
          }
        }
      }
      if (!terminal) throw new Error(controller.signal.aborted ? 'stopped' : '响应流意外结束')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      if (controller.signal.aborted || message === 'stopped') {
        // 用户停止（本地已 abort，收不到 host 的 partial done 帧）：把已生成的
        // 部分就地清洗后交付，仍然可「应用」，不白烧 token。
        const partial = cleanOptimized(accRef.current)
        if (partial === '') setError('已停止优化')
        else {
          setResult(partial)
          setError('已停止 · 下面是已完成的部分')
        }
      } else setError(message)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      if (reader !== null) void reader.cancel().catch(() => {})
      setBusy(false)
    }
  }, [directory, sessionId])

  /** 打开面板：快照草稿并立即开始优化。 */
  const openPanel = useCallback((): void => {
    const draft = draftRef.current.trim()
    const rect = rootRef.current?.getBoundingClientRect() ?? null
    setAnchor(rect)
    setSource(draft)
    setStreamed('')
    setResult('')
    setElapsed('')
    setError(draft === '' ? '输入框是空的，先写点什么再优化' : '')
    setOpen(true)
    if (draft !== '') void run(draft, style)
  }, [run, style])

  /** 关闭面板（播完收起动画再卸载）。 */
  const closePanel = useCallback((): void => {
    if (busy) stop()
    setClosing(true)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setClosing(false)
      setOpen(false)
    }, 140)
  }, [busy, stop])

  // Esc 关闭 + 点击面板外关闭 + 视口变化时重算锚点。
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (panelRef.current?.contains(target) === true) return
      if (rootRef.current?.contains(target) === true) return
      closePanel()
    }
    const onViewport = (): void => { setAnchor(rootRef.current?.getBoundingClientRect() ?? null) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onViewport)
    window.addEventListener('scroll', onViewport, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onViewport)
      window.removeEventListener('scroll', onViewport, true)
    }
  }, [open, closePanel])

  // 卸载：中止请求与定时器（会话切换时组件会被卸载）。
  useEffect(() => () => {
    abortRef.current?.abort()
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  // 面板挂载后按锚点定位（内容高度变化不影响 bottom 定位）。
  useLayoutEffect(() => {
    if (!open) return
    if (anchor === null) setAnchor(rootRef.current?.getBoundingClientRect() ?? null)
  }, [open, anchor])

  if (!available) return null

  /** 切换风格：立即用新风格重跑（原文不变）。 */
  const pickStyle = (next: Style): void => {
    setStyle(next)
    store(STYLE_KEY, next)
    if (source !== '') void run(source, next)
  }

  /** 应用结果：写回草稿（可选包成 /goal 命令）并关闭面板。 */
  const apply = (): void => {
    if (result === '') return
    inputActions.setDraft(setTarget ? `/goal ${collapseToLine(result)}` : result)
    closePanel()
  }

  const toggleTarget = (): void => {
    setSetTarget(prev => {
      const next = !prev
      store(TARGET_KEY, next ? '1' : '0')
      return next
    })
  }

  const snapshot = directory.getSnapshot()
  const current = snapshot.current
  const modelName = snapshot.groups.flatMap(group => group.models).find(model => model.id === current?.model)?.name
    ?? current?.model
    ?? '未选模型'
  // 生成中按「流式预览」规则清洗（半截围栏也能剥掉开场白），最终以 result 为准。
  const preview = result !== '' ? result : (streamed === '' ? '' : (previewOptimized(streamed) || streamed))
  const position = panelStyle(anchor)

  return (
    <div className={css.root} ref={rootRef}>
      <button
        type="button"
        className={clsx(css.trigger, open && css.triggerActive)}
        aria-label="优化提示词"
        aria-expanded={open}
        title="优化提示词"
        onClick={() => { if (open) closePanel(); else openPanel() }}
      >
        {busy ? <IconLoadingOutline16 className={css.spin} /> : <IconSparkle16 />}
      </button>

      {open && createPortal(
        <div
          className={css.panel}
          data-closing={closing ? '1' : undefined}
          style={position}
          ref={panelRef}
          role="dialog"
          aria-label="优化提示词"
        >
          <div className={css.head}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={css.title}>优化提示词</div>
              <div className={css.sub}>{`用 ${modelName} 改写当前草稿`}</div>
            </div>
            <button type="button" className={css.close} aria-label="关闭" onClick={closePanel}>
              <IconCloseOutline16 />
            </button>
          </div>

          <div className={css.section}>
            <div className={css.chips} role="group" aria-label="优化风格">
              {STYLES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={clsx(css.chip, style === item.id && css.chipOn)}
                  aria-pressed={style === item.id}
                  title={item.hint}
                  disabled={source === ''}
                  onClick={() => { pickStyle(item.id) }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {source !== '' && (
            <div className={css.section}>
              <div className={css.sectionLabel}>原文</div>
              <div className={css.source}>{source}</div>
            </div>
          )}

          <div className={css.section}>
            <div className={css.sectionLabel}>优化结果</div>
            <div className={clsx(css.result, preview === '' && css.empty)}>
              {preview === ''
                ? (busy ? '正在生成…' : '暂无结果')
                : <>{preview}{busy && <span className={css.caret} />}</>}
            </div>
          </div>

          <div className={clsx(css.status, busy && css.statusBusy, error !== '' && css.statusError)}>
            {busy && <IconLoadingOutline16 className={css.spin} />}
            <span>
              {error !== ''
                ? error
                : busy
                  ? '正在优化…'
                  : result !== ''
                    ? `已生成 ${String(result.length)} 字${elapsed === '' ? '' : ` · ${elapsed}`}`
                    : '选择风格后点「重新优化」'}
            </span>
          </div>

          <div className={css.optionRow}>
            <span className={css.optionLabel}>应用时设为长任务目标（/goal）</span>
            <button
              type="button"
              role="switch"
              aria-checked={setTarget}
              aria-label="应用时设为长任务目标"
              className={clsx(css.switch, setTarget && css.switchOn)}
              onClick={toggleTarget}
            >
              <span className={clsx(css.knob, setTarget && css.knobOn)} />
            </button>
          </div>

          <div className={css.actions}>
            {busy ? (
              <button type="button" className={clsx(css.btn, css.btnDanger)} onClick={stop}>
                停止
              </button>
            ) : (
              <button
                type="button"
                className={clsx(css.btn, css.btnGhost)}
                disabled={source === ''}
                onClick={() => { void run(source, style) }}
              >
                <IconRefreshOutline14 />
                重新优化
              </button>
            )}
            <button
              type="button"
              className={clsx(css.btn, css.btnPrimary)}
              disabled={result === '' || busy}
              onClick={apply}
            >
              应用到输入框
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
