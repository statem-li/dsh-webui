/**
 * BrowserAllowSetting — 「设置 → 基础设置」页的浏览器设置条目：
 *   1. 允许 AI 使用浏览器（allow）。
 *   2. 无头模式（headless）：开启 = 后台运行、画面内嵌对话面板（可交互，默认）；关闭 = 弹独立 Edge/Chrome 窗口。
 *
 * 槽位：settings.general.item。形态对齐 zh-thinking 的「中文思考」标准开关行：
 * 左侧标题+描述，右侧圆钮 switch（button[role=switch]）。
 */
import { useEffect, useState } from 'react'

// ── 样式（Setting-Cell 行式布局，主题 token，与 zh-thinking 一致）──
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const copyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }
const titleStyle: React.CSSProperties = { fontSize: 14, color: 'var(--dsw-alias-label-primary)' }
const descStyle: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
const switchStyle: React.CSSProperties = {
  position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
  flex: 'none', background: 'var(--dsw-alias-border-l2)', transition: 'background .15s', padding: 0,
}
// 开启态用品牌蓝（浅色 deepseek-500 / 深色 deepseek-400），knob 白底可见；
// 不能用 --dsw-alias-brand-primary——它在浅色下是黑、深色下是白（反色设计）。
const switchOnStyle: React.CSSProperties = { ...switchStyle, background: 'var(--dsw-alias-state-business-primary)' }
const knobStyle: React.CSSProperties = {
  position: 'absolute', top: 2, left: 2, width: 18, height: 18, borderRadius: '50%',
  background: 'var(--dsw-alias-label-tertiary)',
  transition: 'left .15s, background .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
}
const knobOnStyle: React.CSSProperties = { ...knobStyle, left: 20, background: '#fff' }

function fetchJson(url: string): Promise<any> {
  return fetch(url, { cache: 'no-store' }).then((r) => r.json())
}

function postJson(url: string, body: unknown): Promise<any> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())
}

/** 一行标准开关（标题 + 描述 + 圆钮 switch）。 */
function SwitchRow({ title, desc, checked, disabled, onToggle }: {
  title: string
  desc: string
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const btnStyle = checked ? switchOnStyle : switchStyle
  const knob = checked ? knobOnStyle : knobStyle
  return (
    <div style={rowStyle}>
      <div style={copyStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={descStyle}>{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        style={btnStyle}
        onClick={onToggle}
        disabled={disabled}
      >
        <span style={knob} />
      </button>
    </div>
  )
}

export function BrowserAllowSetting(_props: unknown): React.ReactElement {
  const [allow, setAllow] = useState<boolean | null>(null) // null = 加载中
  const [headless, setHeadless] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    fetchJson('/api/dsh-browser/allow').then((r: any) => {
      if (alive && r && typeof r.allow === 'boolean') setAllow(r.allow)
    }).catch(() => {})
    fetchJson('/api/dsh-browser/headless').then((r: any) => {
      if (alive && r && typeof r.headless === 'boolean') setHeadless(r.headless)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const toggleAllow = (): void => {
    const next = !(allow === true)
    setAllow(next)
    postJson('/api/dsh-browser/allow', { allow: next }).catch(() => {})
  }

  const toggleHeadless = (): void => {
    const next = !(headless === true)
    setHeadless(next)
    postJson('/api/dsh-browser/headless', { headless: next }).catch(() => {})
  }

  return (
    <>
      <SwitchRow
        title="允许 AI 使用浏览器"
        desc="关闭后 AI 将无法调用浏览器工具（browser_*），默认开启。"
        checked={allow === true}
        disabled={allow === null}
        onToggle={toggleAllow}
      />
      <SwitchRow
        title="无头模式"
        desc="开启后浏览器后台运行、画面内嵌到对话面板（可直接操作，不弹窗口）；关闭则弹出独立的 Edge/Chrome 窗口。"
        checked={headless === true}
        disabled={headless === null}
        onToggle={toggleHeadless}
      />
    </>
  )
}
