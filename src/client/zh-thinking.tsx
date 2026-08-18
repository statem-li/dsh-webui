/**
 * webui — client 半身「中文思考」开关（自 dsh-zh-thinking 合并）。
 *
 * 设置页基础设置里的一行开关：读 /api/zh-thinking（GET），点击后 POST 持久化。
 * 样式沿用原插件（Setting-Cell 行式布局 + 主题 token）。
 */
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

// ---- 样式（Setting-Cell 行式布局，主题 token）----
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0' }
const copyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }
const titleStyle: React.CSSProperties = { fontSize: 14, color: 'var(--dsw-alias-label-primary)' }
const descStyle: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
const switchStyle: React.CSSProperties = {
  position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
  flex: 'none', background: 'var(--dsw-alias-border-l2)', transition: 'background .15s', padding: 0,
}
const switchOnStyle: React.CSSProperties = { ...switchStyle, background: 'var(--dsw-alias-brand-primary)' }
const knobStyle: React.CSSProperties = {
  position: 'absolute', top: 2, left: 2, width: 18, height: 18, borderRadius: '50%', background: '#fff',
  transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
}
const knobOnStyle: React.CSSProperties = { ...knobStyle, left: 20 }

function fetchState(): Promise<{ enabled?: boolean }> {
  return fetch('/api/zh-thinking', { cache: 'no-store' }).then(r => r.json())
}

function postState(enabled: boolean): Promise<unknown> {
  return fetch('/api/zh-thinking', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }).then(r => r.json())
}

function ThinkingRow(): JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null) // null = 加载中

  useEffect(() => {
    let alive = true
    fetchState().then((r) => {
      if (alive && r && typeof r.enabled === 'boolean') setEnabled(r.enabled)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  function toggle(): void {
    const next = !(enabled === true)
    setEnabled(next)
    postState(next).catch(() => {})
  }

  const btnStyle = enabled === true ? switchOnStyle : switchStyle
  const knob = enabled === true ? knobOnStyle : knobStyle

  return (
    <div style={rowStyle}>
      <div style={copyStyle}>
        <div style={titleStyle}>中文思考</div>
        <div style={descStyle}>让内部推理使用中文（下一轮生效）</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled === true}
        style={btnStyle}
        onClick={toggle}
        disabled={enabled === null}
        aria-label="中文思考开关"
      >
        <span style={knob} />
      </button>
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'zh-thinking',
      order: 40,
    }, ThinkingRow))
}
