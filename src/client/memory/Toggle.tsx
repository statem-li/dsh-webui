/**
 * dsh-memory 注入开关（composer 输入框工具行左端）：
 * 按会话控制是否把记忆注入上下文。开启 = 记忆随 pre-step 注入；关闭 = 本会话不注入。
 * 状态持久化在 host（state.json），重启保留。
 */

import { useEffect, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryApi } from './api.js'
import { BrainIcon } from './Panel.tsx'
import { css, ensureStyles } from './styles.js'

/** 完整 props：composer 插槽 standardProps 的 sessionId + 注入 API 面 + locale。 */
export type MemoryToggleProps =
  { sessionId: string }
  & InjectFace<MemoryApi>
  & PropsLocale<'dshMemory'>

/** 渲染注入开关按钮。 */
export function MemoryToggle({ sessionId, t, ...api }: MemoryToggleProps): JSX.Element {
  ensureStyles()
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    void api.getInjectState(sessionId)
      .then(state => { if (alive) setEnabled(state.enabled) })
      .catch(() => { if (alive) setEnabled(true) })
    return () => { alive = false }
  }, [sessionId, api])

  const toggle = (): void => {
    const next = !(enabled ?? true)
    setEnabled(next)
    void api.setInjectState(sessionId, next)
      .then(state => setEnabled(state.enabled))
      .catch(() => setEnabled(!next))
  }

  const isOn = enabled ?? true
  return (
    <Tooltip label={isOn ? t('injectOn') : t('injectOff')} side="top" delayMs={500}>
      <button
        type="button"
        className={isOn ? `${css.toggle} ${css.toggleOn}` : `${css.toggle} ${css.toggleOff}`}
        aria-label={isOn ? t('injectOn') : t('injectOff')}
        aria-pressed={isOn}
        onClick={toggle}
      >
        <BrainIcon size={14} />
      </button>
    </Tooltip>
  )
}
