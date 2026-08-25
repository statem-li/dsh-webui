/**
 * team — 自绘输入 / 确认弹窗（替代 window.prompt / window.confirm）。
 *
 * ⚠ 为什么必须自绘：DSH 壳子是 Electron，`window.prompt()` 直接抛
 * "prompt() is not supported."，`confirm()` 在部分壳子版本同样被禁用。
 * 原先「新建团队 / 重命名 / 添加角色 / 添加链条」都走 window.prompt，
 * 异常未捕获 → 按钮点了完全没反应。
 *
 * 用法（promise 式，调用点写起来跟 prompt/confirm 一样）：
 *   const dlg = useDialogs()
 *   const name = await dlg.prompt({ title: '新角色名称', defaultValue: '新角色' })
 *   if (name === null) return            // 用户取消
 *   if (!await dlg.confirm({ title: '删除？', danger: true })) return
 *   ...
 *   return <>{dlg.node}</>               // 把 node 渲染出来（内部走 portal）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** 输入弹窗入参。 */
export interface PromptOptions {
  title: string
  /** 标题下的补充说明。 */
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  /** 多行输入（默认单行）。 */
  multiline?: boolean
  /** 允许提交空串（默认 false：空串等同取消）。 */
  allowEmpty?: boolean
}

/** 确认弹窗入参。 */
export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作（确认按钮变红）。 */
  danger?: boolean
}

type Pending =
  | { kind: 'prompt', options: PromptOptions, resolve: (value: string | null) => void }
  | { kind: 'confirm', options: ConfirmOptions, resolve: (value: boolean) => void }

export interface Dialogs {
  prompt: (options: PromptOptions) => Promise<string | null>
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /** 渲染出口（必须挂进树里，内部走 document.body portal）。 */
  node: JSX.Element | null
}

/** 输入 / 确认弹窗（同一时刻只有一个，后来的排队等前一个关闭）。 */
export function useDialogs(): Dialogs {
  const [pending, setPending] = useState<Pending | null>(null)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  /** 队列：弹窗未关闭时新的请求先排队，避免互相顶掉丢 resolve。 */
  const queueRef = useRef<Pending[]>([])

  const pump = useCallback((): void => {
    setPending((current) => {
      if (current !== null) return current
      const next = queueRef.current.shift() ?? null
      if (next !== null && next.kind === 'prompt') setText(next.options.defaultValue ?? '')
      return next
    })
  }, [])

  const push = useCallback((item: Pending): void => {
    queueRef.current.push(item)
    pump()
  }, [pump])

  const askPrompt = useCallback((options: PromptOptions): Promise<string | null> =>
    new Promise<string | null>((resolve) => { push({ kind: 'prompt', options, resolve }) }), [push])

  const askConfirm = useCallback((options: ConfirmOptions): Promise<boolean> =>
    new Promise<boolean>((resolve) => { push({ kind: 'confirm', options, resolve }) }), [push])

  /** 关闭当前弹窗并回填结果，然后取队列里的下一个。 */
  const settle = useCallback((value: string | null | boolean): void => {
    setPending((current) => {
      if (current === null) return null
      if (current.kind === 'prompt') current.resolve(typeof value === 'string' ? value : null)
      else current.resolve(value === true)
      return null
    })
    // setPending 的更新函数里不能直接再触发 setState，放到下一帧。
    window.setTimeout(pump, 0)
  }, [pump])

  // 打开后聚焦输入框并全选（跟 prompt 的手感一致）。
  useEffect(() => {
    if (pending === null || pending.kind !== 'prompt') return
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 40)
    return () => { window.clearTimeout(timer) }
  }, [pending])

  // Esc 取消 / Enter 确认（多行输入用 Ctrl+Enter 确认）。
  useEffect(() => {
    if (pending === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        settle(pending.kind === 'prompt' ? null : false)
        return
      }
      if (event.key !== 'Enter') return
      if (pending.kind === 'confirm') { event.preventDefault(); settle(true); return }
      if (pending.options.multiline === true && !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      const value = text.trim()
      if (value === '' && pending.options.allowEmpty !== true) return
      settle(pending.options.allowEmpty === true ? text : value)
    }
    // 捕获阶段：抽屉的 Esc 关闭监听在 document 上，必须先被我们截住。
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [pending, text, settle])

  if (pending === null) return { prompt: askPrompt, confirm: askConfirm, node: null }

  const isPrompt = pending.kind === 'prompt'
  const options = pending.options
  const trimmed = text.trim()
  const canSubmit = !isPrompt || trimmed !== '' || (isPrompt && (options as PromptOptions).allowEmpty === true)

  const node = createPortal(
    <>
      <div
        className="team-ask-mask"
        aria-hidden="true"
        onClick={() => settle(isPrompt ? null : false)}
      />
      <div className="team-ask" role="dialog" aria-modal="true" aria-label={options.title}>
        <div className="team-ask-title">{options.title}</div>
        {options.message !== undefined && options.message !== '' ? (
          <div className="team-ask-msg">{options.message}</div>
        ) : null}

        {isPrompt ? (
          (options as PromptOptions).multiline === true ? (
            <textarea
              ref={element => { inputRef.current = element }}
              className="team-textarea"
              value={text}
              placeholder={(options as PromptOptions).placeholder ?? ''}
              onChange={event => setText(event.target.value)}
            />
          ) : (
            <input
              ref={element => { inputRef.current = element }}
              className="team-input"
              value={text}
              placeholder={(options as PromptOptions).placeholder ?? ''}
              onChange={event => setText(event.target.value)}
            />
          )
        ) : null}

        <div className="team-ask-foot">
          <button
            type="button"
            className="team-btn team-btn-lg"
            onClick={() => settle(isPrompt ? null : false)}
          >{isPrompt ? '取消' : ((options as ConfirmOptions).cancelLabel ?? '取消')}</button>
          <button
            type="button"
            className={(!isPrompt && (options as ConfirmOptions).danger === true)
              ? 'team-btn team-btn-lg team-btn-danger-solid'
              : 'team-btn team-btn-primary team-btn-lg'}
            disabled={!canSubmit}
            onClick={() => settle(isPrompt
              ? ((options as PromptOptions).allowEmpty === true ? text : trimmed)
              : true)}
          >{options.confirmLabel ?? (isPrompt ? '确定' : '确定')}</button>
        </div>
      </div>
    </>,
    document.body,
  )

  return { prompt: askPrompt, confirm: askConfirm, node }
}
