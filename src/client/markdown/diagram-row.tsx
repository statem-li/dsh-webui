/**
 * webui — 图表渲染设置行（基础设置）。
 *
 * 只控制**作图提示词**（是否告知模型「可以用 mermaid 围栏作图」）：
 *  - 开（默认）：注入约 100 token 的提示，模型在讲流程/架构时会主动配图；
 *  - 关：完全不注入（零 token）；已经写好的 mermaid 围栏照旧渲染成图。
 *
 * 图表渲染本身的总开关在「功能模块」（webui-modules.diagram），关掉后
 * mermaid 围栏回落成普通代码块，引擎资源也不会被请求。
 */
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0',
}
const copyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }
const titleStyle: React.CSSProperties = { fontSize: 14, color: 'var(--dsw-alias-label-primary)' }
const descStyle: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
const switchStyle: React.CSSProperties = {
  position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
  flex: 'none', background: 'var(--dsw-alias-border-l2)', transition: 'background .15s', padding: 0,
}
// 开启态用品牌蓝；--dsw-alias-brand-primary 是反色设计（浅色=黑/深色=白），不可用。
const switchOnStyle: React.CSSProperties = { ...switchStyle, background: 'var(--dsw-alias-state-business-primary)' }
const knobStyle: React.CSSProperties = {
  position: 'absolute', top: 2, left: 2, width: 18, height: 18, borderRadius: '50%',
  background: 'var(--dsw-alias-label-tertiary)', transition: 'left .15s, background .15s',
  boxShadow: '0 1px 2px rgba(0,0,0,.2)',
}
const knobOnStyle: React.CSSProperties = { ...knobStyle, left: 20, background: '#fff' }

interface DiagramState {
  promptHint?: boolean
  available?: boolean
  version?: string
}

function DiagramRow(): JSX.Element {
  const [state, setState] = useState<DiagramState | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/webui-diagram', { cache: 'no-store' })
      .then(res => res.json())
      .then((payload: DiagramState) => { if (alive) setState(payload) })
      .catch(() => { if (alive) setState({}) })
    return () => { alive = false }
  }, [])

  const on = state?.promptHint !== false
  const ready = state !== null

  function toggle(): void {
    const next = !on
    setState(prev => ({ ...prev, promptHint: next }))
    fetch('/api/webui-diagram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ promptHint: next }),
    }).catch(() => {})
  }

  const desc = state?.available === false
    ? '图表引擎资源缺失（assets/vendor/mermaid.min.js.gz），请重装插件'
    : '让模型在讲流程 / 架构 / 时序时主动画 mermaid 图（约 100 token；关闭则零占用）'

  return (
    <div style={rowStyle}>
      <div style={copyStyle}>
        <div style={titleStyle}>建议模型作图</div>
        <div style={descStyle}>{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="建议模型作图"
        style={on ? switchOnStyle : switchStyle}
        onClick={toggle}
        disabled={!ready}
      >
        <span style={on ? knobOnStyle : knobStyle} />
      </button>
    </div>
  )
}

/** 注册「建议模型作图」设置行（基础设置区）。 */
export function registerDiagramSetting(ctx: ClientContext): void {
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'webui-diagram',
      order: 45,
    }, DiagramRow))
}
