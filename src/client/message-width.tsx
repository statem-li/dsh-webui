/**
 * webui — client 半身「我发送的对话宽度」（本人消息气泡宽度）设置行。
 *
 * - 基础设置页（settings.section id='basic'，由 updater 持有）里的一行：
 *   数字输入（px / %）+ 单位下拉 + 「默认」按钮。
 * - 宽度通过 CSS 变量 `--webui-user-bubble-width` 应用到本人消息气泡
 *   （[data-chat-flow-kind="user" | "steering"] 下的 .userStack），
 *   仅影响本人消息，不影响对方/系统消息。
 * - 读 /api/webui-message-width；改动即 POST 持久化（settings.yaml），
 *   重启/刷新后由 bootstrap 恢复。
 */
import { useCallback, useEffect, useState } from 'react'
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
  width: 88, height: 32, boxSizing: 'border-box', padding: '0 10px',
  fontSize: 14, lineHeight: '22px', borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
}
const selectStyle: React.CSSProperties = {
  ...numberStyle, width: 72, appearance: 'none', paddingRight: 28, cursor: 'pointer',
  backgroundImage: "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' fill='none' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
}

/** 基础设置页里的一行：「我发送的对话宽度」。 */
export function MessageWidthRow(): JSX.Element {
  const [value, setValue] = useState<number | null>(null) // null = 加载中
  const [unit, setUnit] = useState<Unit>('px')
  const [input, setInput] = useState('') // 输入框草稿（不夹紧，避免打断输入）

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

  /** 提交（夹紧 + 应用 + 持久化）：blur / Enter / 单位切换 / 「默认」时调用。 */
  const commit = useCallback((raw: number, nextUnit: Unit): void => {
    const clamped = clampValue(raw, nextUnit)
    setValue(clamped)
    setUnit(nextUnit)
    setInput(String(clamped))
    applyWidth(clamped, nextUnit)
    postState(clamped, nextUnit).catch(() => {})
  }, [])

  // 输入过程中即时预览（夹紧到安全范围，但不覆盖输入框草稿、不立即写盘）。
  const onNumberChange = (raw: string): void => {
    setInput(raw)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n)) applyWidth(clampValue(n, unit), unit)
  }

  const onNumberBlur = (): void => {
    const n = Number(input)
    if (input.trim() !== '' && Number.isFinite(n)) commit(n, unit)
    else setInput(String(value ?? DEFAULT.value))
  }

  const onNumberKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  const onUnitChange = (nextUnit: Unit): void => {
    const n = Number(input)
    const base = input.trim() !== '' && Number.isFinite(n) ? n : (value ?? DEFAULT.value)
    commit(base, nextUnit)
  }

  const reset = (): void => { commit(DEFAULT.value, DEFAULT.unit) }

  const disabled = value === null

  return (
    <div style={cellRow}>
      <div style={cellText}>
        <div style={cellTitle}>我发送的对话宽度</div>
        <div style={cellCaption}>控制你本人发送消息气泡的宽度，仅影响自己的消息（默认 {DEFAULT.value}px）</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        <input
          type="number"
          min={RANGE[unit].min}
          max={RANGE[unit].max}
          step={1}
          value={input}
          disabled={disabled}
          onChange={e => onNumberChange(e.target.value)}
          onBlur={onNumberBlur}
          onKeyDown={onNumberKeyDown}
          style={numberStyle}
          aria-label="我发送的对话宽度数值"
        />
        <select
          value={unit}
          disabled={disabled}
          onChange={e => onUnitChange(e.target.value === '%' ? '%' : 'px')}
          style={selectStyle}
          aria-label="我发送的对话宽度单位"
        >
          <option value="px">px</option>
          <option value="%">%</option>
        </select>
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
