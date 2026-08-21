/**
 * webui — client 半身「我发送的对话宽度」（本人消息气泡宽度）设置行。
 *
 * - 基础设置页（settings.section id='basic'，由 updater 持有）里的一行：
 *   数字输入 + px/% 分段按钮 + 「默认」按钮。
 * - 宽度通过 CSS 变量 `--webui-user-bubble-width` 应用到本人消息气泡
 *   （[data-chat-flow-kind="user" | "steering"] 下的 .userStack），
 *   仅影响本人消息，不影响对方/系统消息。
 * - 读 /api/webui-message-width；输入即 POST 持久化（debounce 400ms，
 *   不依赖失焦），刷新/重启后由 bootstrap 恢复。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

const BASE = '/api/webui-message-width'
const STYLE_ID = 'dsh-webui-user-bubble-width'
const CSS_VAR = '--webui-user-bubble-width'

const DEFAULT = { value: 525, unit: 'px' } as const
const RANGE = {
  '%': { min: 10, max: 100 },
  px: { min: 120, max: 1600 },
} as const

type Unit = 'px' | '%'

/** 静态规则：本人消息气泡列宽 = min(用户值, 100%)，100% 兜底防溢出容器。 */
const SHEET = `
[data-chat-flow-kind="user"] [class*="userStack"],
[data-chat-flow-kind="steering"] [class*="userStack"] {
  max-width: min(var(${CSS_VAR}, ${DEFAULT.value}px), 100%) !important;
}
`

function ensureStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.dataset.pluginCss = 'webui/message-width'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

function removeStyle(): void {
  if (typeof document === 'undefined') return
  document.getElementById(STYLE_ID)?.remove()
}

/** 把数值 + 单位写到 CSS 变量上（即时生效，无需刷新）。 */
function applyWidth(value: number, unit: Unit): void {
  if (typeof document === 'undefined') return
  ensureStyle()
  document.documentElement.style.setProperty(CSS_VAR, `${value}${unit}`)
}

function clampValue(value: number, unit: Unit): number {
  const range = RANGE[unit]
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

function fetchState(): Promise<{ value?: number; unit?: string }> {
  return fetch(BASE, { cache: 'no-store' }).then(r => r.json())
}

function postState(value: number, unit: Unit): Promise<unknown> {
  return fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value, unit }),
  }).then(r => r.json())
}

// ---- 样式（与「基础设置」页 Setting-Cell 行式布局一致）----
const cellRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const cellText: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }
const cellTitle: React.CSSProperties = { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const cellCaption: React.CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }
const numberStyle: React.CSSProperties = {
  width: 92, height: 36, boxSizing: 'border-box', padding: '0 10px',
  fontSize: 14, borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
}
// 分段按钮（px / %）：选中态用品牌蓝，避免 --dsw-alias-brand-primary 反色坑。
const segBase: React.CSSProperties = {
  height: 36, padding: '0 14px', fontSize: 12, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  boxSizing: 'border-box', background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  border: '1px solid var(--dsw-alias-border-l1)',
  transition: 'color .12s, background .12s, border-color .12s',
}
const segOn: React.CSSProperties = {
  color: 'var(--dsw-alias-state-business-primary)',
  background: 'var(--dsw-alias-state-business-tertiary)',
  borderColor: 'var(--dsw-alias-state-business-primary)',
  position: 'relative', zIndex: 1,
}

/** 基础设置页里的一行：「我发送的对话宽度」。 */
export function MessageWidthRow(): JSX.Element {
  const [value, setValue] = useState<number | null>(null) // null = 加载中
  const [unit, setUnit] = useState<Unit>('px')
  const [input, setInput] = useState('') // 输入框草稿（不夹紧，避免打断输入）
  const debounceRef = useRef<number>(0)

  useEffect(() => {
    let alive = true
    fetchState().then((r) => {
      if (!alive) return
      const v = typeof r?.value === 'number' ? r.value : DEFAULT.value
      const u: Unit = r?.unit === '%' ? '%' : 'px'
      setValue(v)
      setUnit(u)
      setInput(String(v))
      applyWidth(v, u)
    }).catch(() => {
      if (!alive) return
      setValue(DEFAULT.value)
      setUnit(DEFAULT.unit)
      setInput(String(DEFAULT.value))
      applyWidth(DEFAULT.value, DEFAULT.unit)
    })
    return () => { alive = false }
  }, [])

  /** 立即应用视觉；persist 为 true 时 debounce 持久化。 */
  const applyNow = useCallback((clamped: number, nextUnit: Unit, persist: boolean): void => {
    setValue(clamped)
    setUnit(nextUnit)
    applyWidth(clamped, nextUnit)
    if (!persist) return
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => { postState(clamped, nextUnit).catch(() => {}) }, 400)
  }, [])

  /** 立即落盘（不 debounce）：blur / 单位切换 / 「默认」。 */
  const commitNow = useCallback((clamped: number, nextUnit: Unit): void => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    applyNow(clamped, nextUnit, false)
    postState(clamped, nextUnit).catch(() => {})
  }, [applyNow])

  // 输入过程：即时预览 + debounce 持久化（不依赖失焦，避免「输入后直接关面板丢值」）。
  const onNumberChange = (raw: string): void => {
    setInput(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n)) applyNow(clampValue(n, unit), unit, true)
  }

  const onNumberBlur = (): void => {
    const n = Number(input)
    if (input.trim() !== '' && Number.isFinite(n)) {
      const clamped = clampValue(n, unit)
      setInput(String(clamped))
      commitNow(clamped, unit)
    } else {
      setInput(String(value ?? DEFAULT.value))
    }
  }

  const onNumberKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  const onUnitChange = (nextUnit: Unit): void => {
    if (nextUnit === unit) return
    const n = Number(input)
    const base = input.trim() !== '' && Number.isFinite(n) ? n : (value ?? DEFAULT.value)
    const clamped = clampValue(base, nextUnit)
    setInput(String(clamped))
    commitNow(clamped, nextUnit)
  }

  const reset = (): void => {
    setInput(String(DEFAULT.value))
    commitNow(DEFAULT.value, DEFAULT.unit)
  }

  const disabled = value === null
  const range = RANGE[unit]

  return (
    <div style={cellRow}>
      <div style={cellText}>
        <div style={cellTitle}>我发送的对话宽度</div>
        <div style={cellCaption}>调整你本人消息气泡的宽度（默认 {DEFAULT.value}px）</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        <input
          type="number"
          min={range.min}
          max={range.max}
          step={1}
          value={input}
          disabled={disabled}
          onChange={e => onNumberChange(e.target.value)}
          onBlur={onNumberBlur}
          onKeyDown={onNumberKeyDown}
          style={numberStyle}
          aria-label="我发送的对话宽度数值"
        />
        <div style={{ display: 'flex', flex: 'none' }}>
          <button
            type="button"
            onClick={() => onUnitChange('px')}
            disabled={disabled}
            style={{ ...segBase, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, ...(unit === 'px' ? segOn : {}) }}
            aria-pressed={unit === 'px'}
          >
            px
          </button>
          <button
            type="button"
            onClick={() => onUnitChange('%')}
            disabled={disabled}
            style={{ ...segBase, borderTopRightRadius: 8, borderBottomRightRadius: 8, marginLeft: -1, ...(unit === '%' ? segOn : {}) }}
            aria-pressed={unit === '%'}
          >
            %
          </button>
        </div>
        <Button variant="outline" onClick={reset} disabled={disabled}>默认</Button>
      </div>
    </div>
  )
}

/**
 * 启动引导：注入覆盖样式并在页面加载时恢复上次保存的宽度，
 * 无需先打开设置面板（满足「刷新后生效」）。
 */
export function applyMessageWidthClient(ctx: ClientContext): void {
  ctx.effect(() => {
    ensureStyle()
    fetchState().then((r) => {
      const v = typeof r?.value === 'number' ? r.value : DEFAULT.value
      const u: Unit = r?.unit === '%' ? '%' : 'px'
      applyWidth(v, u)
    }).catch(() => applyWidth(DEFAULT.value, DEFAULT.unit))
    return () => { removeStyle() }
  }, 'webui: message width')
}
