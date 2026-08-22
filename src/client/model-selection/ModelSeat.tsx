/**
 * ModelSeat — 纯模型选择器，接管 `conversation.input.model` 座位。
 *
 * 相比 ui-model-selection 自带的 ModelSelect，这里去掉了「模型 / 推理等级」
 * 两级 root 菜单，改为：触发按钮直接弹出模型分组列表。推理等级由独立的
 * EffortSeat 单独弹出。数据与提交仍走同一个 per-session ModelDirectory，
 * 因此两个入口与 `/model` 弹窗状态互通。
 *
 * 选中模型时默认带上该模型支持的最高推理档位（pi-ai 的 `efforts` 按
 * off→max 升序返回，末项即最高档），避免无 defaultEffort 的模型切换后
 * 推理等级回落为「默认/关」；无推理元数据的模型保持不带 effort。
 */
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import clsx from 'clsx'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconWarningOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelSeatInjected } from './types'
import { css, ensureStyles } from './styles'

export type ModelSeatProps = ModelSeatInjected

/**
 * 渲染 composer 模型选择器（仅模型列表，无推理等级）。
 * 注册在 `conversation.input.right`，位于供应商标签与推理等级之间。
 */
export function ModelSeat({ available, directory, load, select }: ModelSeatProps) {
  ensureStyles()
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  // hover 移出后的延迟关闭定时器（悬停交互，与提示词优化/推理等级一致）
  const hoverLeaveTimer = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const id = useId()

  // 平铺所有模型（分组 + 模型），供选中判定与标题回显。
  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({ group, model }))), [state.groups])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.group.id === state.current?.provider && c.model.id === state.current.model)
  const currentChoice = choices[selectedIndex]
  const busy = state.status === 'selecting'

  // 当前展示的供应商：用户显式选中的优先，否则跟随当前模型所在供应商，最后回退第一个。
  const activeGroup = useMemo(() => {
    if (state.groups.length === 0) return undefined
    const pid = providerId ?? state.current?.provider
    return state.groups.find(group => group.id === pid) ?? state.groups[0]
  }, [state.groups, providerId, state.current])

  const reload = (): void => { load() }

  // 挂载即加载（悬停打开不重复刷新，避免频繁请求）。
  useEffect(() => {
    if (available) load()
  }, [available, load])

  // 卸载清理 hover 延迟关闭定时器。
  useEffect(() => () => {
    if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current)
  }, [])

  if (!available) return null

  /** 取消「移出后延迟关闭」的定时器。 */
  const cancelHoverHide = (): void => {
    if (hoverLeaveTimer.current !== null) {
      window.clearTimeout(hoverLeaveTimer.current)
      hoverLeaveTimer.current = null
    }
  }

  /** hover 进入按钮/菜单：立即显示并取消延迟关闭。 */
  const showPanel = (): void => {
    cancelHoverHide()
    setProviderId(null)
    setOpen(true)
  }

  /** hover 移出：延迟 0.08 秒再关闭，给用户时间从按钮移入菜单点选。 */
  const scheduleHide = (): void => {
    cancelHoverHide()
    hoverLeaveTimer.current = window.setTimeout(() => {
      hoverLeaveTimer.current = null
      setOpen(false)
    }, 80)
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      setOpen(false)
      return
    }
    void select(selection).then((accepted) => {
      if (accepted) {
        setOpen(false)
        return
      }
      const message = directory.getSnapshot().error
      if (message !== null) {
        toastSeq.current += 1
        setToast({ seq: toastSeq.current, text: `模型切换失败：${message}` })
      }
    })
  }

  const modelLabel = currentChoice?.model.name ?? '选择模型'

  return (
    <div ref={rootRef} className={css.msRoot}>
      <button
        ref={triggerRef}
        type="button"
        className={css.msTrigger}
        aria-label={`选择模型，当前 ${modelLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={modelLabel}
        onMouseEnter={showPanel}
        onMouseLeave={scheduleHide}
      >
        <span className={css.msTriggerLabel}>{modelLabel}</span>
        <IconChevronDownOutline14 className={clsx(css.msChevron, open && css.msChevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.msMenu}
          role="menu"
          aria-label="选择模型"
          aria-busy={state.status === 'loading' || busy}
          onMouseEnter={showPanel}
          onMouseLeave={scheduleHide}
        >
          {state.status === 'loading' && (
            <div className={css.msStatus}>正在刷新模型列表…</div>
          )}
          {state.error !== null && (
            <div className={css.msError}>
              <span>{state.error}</span>
              <button type="button" className={css.msRetry} onClick={reload}>重试</button>
            </div>
          )}
          {state.failures.map(failure => (
            <div className={css.msWarning} key={failure.id}>
              <span>{failure.name} 加载失败：{failure.message}</span>
              <button type="button" className={css.msRetry} onClick={reload}>重试</button>
            </div>
          ))}
          <div className={css.msBody}>
            <div className={css.msProviders} role="tablist" aria-label="供应商">
              {state.groups.map((group) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeGroup?.id === group.id}
                  className={clsx(css.msProvider, activeGroup?.id === group.id && css.msProviderActive)}
                  key={group.id}
                  title={group.name}
                  onClick={() => { setProviderId(group.id) }}
                >
                  {group.name}
                </button>
              ))}
            </div>
            <div
              className={clsx(css.msModels, 'scrollable')}
              role="tabpanel"
              aria-label={`${activeGroup?.name ?? ''} 的模型`}
            >
              {activeGroup?.models.map((model) => {
                const selected = state.current?.provider === activeGroup.id && state.current.model === model.id
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={clsx(css.msOption, selected && css.msSelected)}
                    key={model.id}
                    title={model.name}
                    disabled={busy}
                    onClick={() => {
                      // 默认推理等级 = 该模型支持的最高档位（efforts 升序末项），
                      // 让选完模型即落在最大档，而不是回到「默认/关」。
                      const efforts = model.reasoning?.efforts
                      const highestEffort = efforts !== undefined && efforts.length > 0
                        ? efforts[efforts.length - 1]!.id
                        : undefined
                      choose({
                        provider: activeGroup.id,
                        model: model.id,
                        ...(highestEffort === undefined ? {} : { reasoningEffort: highestEffort }),
                      })
                    }}
                  >
                    <span className={css.msOptionCopy}>
                      <span className={css.msModelName}>{model.name}</span>
                      {model.description !== undefined && (
                        <span className={css.msDescription}>{model.description}</span>
                      )}
                    </span>
                    <span className={css.msCheck}>
                      {selected ? <IconCheckOutline16 /> : null}
                    </span>
                  </button>
                )
              })}
              {activeGroup !== undefined && activeGroup.models.length === 0 && (
                <div className={css.msEmpty}>该供应商暂无模型。</div>
              )}
            </div>
          </div>
          {state.status === 'ready' && choices.length === 0 && (
            <div className={css.msEmpty}>没有可用的模型。</div>
          )}
        </div>
      )}

      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
