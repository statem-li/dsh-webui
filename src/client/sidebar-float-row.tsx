/**
 * webui — 侧边栏模式设置行（client 半身）。
 *
 * 在设置「通用」分区（settings.general.item）注册一行开关：
 * 「固定侧边栏」。
 *  - 开启（默认）：原生固定侧边栏（常驻占位，无悬浮热区）。
 *  - 关闭：悬浮侧边栏（左侧热区悬停展开/折叠）。
 *
 * 读 /api/sidebar-float（GET），点击后 POST 持久化（settings.yaml）；同时写一份
 * localStorage 缓存，供 sidebar-float.ts 启动时同步读取初始模式，并广播
 * SIDEBAR_FLOAT_MODE_EVENT 让悬浮模块同标签页即时切换。
 */
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  SIDEBAR_FLOAT_API, SIDEBAR_FLOAT_STORAGE_KEY, SIDEBAR_FLOAT_MODE_EVENT,
  readCachedFixed,
} from './sidebar-float'

// ---- 开关行样式（与 General 分区条目一致的 Setting-Cell 布局 + 主题 token）----
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const textStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 48,
}
const titleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const descStyle: React.CSSProperties = { fontSize: 12, fontWeight: 400, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }

function switchStyle(on: boolean): React.CSSProperties {
  return {
    position: 'relative', flex: 'none', width: 40, height: 22, padding: 0,
    border: 'none', borderRadius: 11, cursor: 'pointer',
    // 开启态用品牌蓝（浅色 deepseek-500 / 深色 deepseek-400），knob 白底可见；
    // 不能用 --dsw-alias-brand-primary——浅色下是黑、深色下是白（反色设计）。
    background: on ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-bg-module-platform)',
    transition: 'background .15s',
  }
}
function knobStyle(on: boolean): React.CSSProperties {
  return {
    position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18,
    borderRadius: '50%', background: on ? '#ffffff' : 'var(--dsw-alias-label-tertiary)',
    transition: 'left .15s, background .15s',
  }
}

function fetchState(): Promise<{ fixed?: boolean }> {
  return fetch(SIDEBAR_FLOAT_API, { cache: 'no-store' }).then(r => r.json())
}

function postState(fixed: boolean): Promise<unknown> {
  return fetch(SIDEBAR_FLOAT_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fixed }),
  }).then(r => r.json())
}

function SidebarFloatRow(): JSX.Element {
  const [on, setOn] = useState<boolean | null>(null) // null = 加载中；true = 固定

  useEffect(() => {
    let alive = true
    fetchState().then((r) => {
      if (alive && r && typeof r.fixed === 'boolean') setOn(r.fixed)
      else if (alive) setOn(readCachedFixed()) // 服务端字段不符（host 未更新）→ 回退本地缓存
    }).catch(() => {
      // 服务端未就绪（如 host 尚未重启）：回退到本地缓存，与 client 半身启动态保持一致。
      if (alive) setOn(readCachedFixed())
    })
    return () => { alive = false }
  }, [])

  function toggle(): void {
    const next = !(on === true)
    setOn(next)
    // 同步本地缓存 + 广播模式事件：同标签页即时切换（无需刷新）。
    try { localStorage.setItem(SIDEBAR_FLOAT_STORAGE_KEY, next ? '1' : '0') } catch { /* 忽略 */ }
    window.dispatchEvent(new CustomEvent(SIDEBAR_FLOAT_MODE_EVENT, { detail: { fixed: next } }))
    postState(next).catch(() => {})
  }

  return (
    <div style={rowStyle}>
      <div style={textStyle}>
        <div style={titleStyle}>固定侧边栏</div>
        <div style={descStyle}>开启后使用原生固定侧边栏（常驻占位）；关闭后侧边栏悬浮，鼠标移入左侧热区展开、移出自动折叠</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-label="固定侧边栏"
        onClick={toggle}
        disabled={on === null}
        style={switchStyle(on === true)}
      >
        <span style={knobStyle(on === true)} />
      </button>
    </div>
  )
}

export function applySidebarFloatSetting(ctx: ClientContext): void {
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'sidebar-float',
      order: 35,
      label: '固定侧边栏',
    }, SidebarFloatRow))
}
