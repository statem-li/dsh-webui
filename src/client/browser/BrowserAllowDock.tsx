/**
 * BrowserAllowSetting — 「设置 → 基础设置」页的浏览器开关条目。
 *
 * 槽位：settings.general.item。形态完全对齐 zh-thinking 的「中文思考」
 * 标准开关行：左侧标题+描述，右侧圆钮 switch（button[role=switch]）。
 */
import { useEffect, useState } from 'react'

// ── 样式（Setting-Cell 行式布局，主题 token，与 zh-thinking 一致）──
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 0',
  // 条目自绘分隔线（与 PermissionRow/LanguageRow 等标准条目一致；容器会去掉最后一条）
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

function fetchState(): Promise<any> {
  return fetch('/api/dsh-browser/allow', { cache: 'no-store' }).then((r) => r.json())
}

function postState(allow: boolean): Promise<any> {
  return fetch('/api/dsh-browser/allow', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allow }),
  }).then((r) => r.json())
}

export function BrowserAllowSetting(_props: unknown): React.ReactElement {
  const [allow, setAllow] = useState<boolean | null>(null) // null = 加载中

  useEffect(() => {
    let alive = true
    fetchState()
      .then((r: any) => { if (alive && r && typeof r.allow === 'boolean') setAllow(r.allow) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const toggle = (): void => {
    const next = !(allow === true)
    setAllow(next)
    postState(next).catch(() => {})
  }

  const btnStyle = allow === true ? switchOnStyle : switchStyle
  const knob = allow === true ? knobOnStyle : knobStyle

  return (
    <div style={rowStyle}>
      <div style={copyStyle}>
        <div style={titleStyle}>允许 AI 使用浏览器</div>
        <div style={descStyle}>关闭后 AI 将无法调用浏览器工具（browser_*），默认开启。</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={allow === true}
        aria-label="允许 AI 使用浏览器开关"
        style={btnStyle}
        onClick={toggle}
        disabled={allow === null}
      >
        <span style={knob} />
      </button>
    </div>
  )
}
