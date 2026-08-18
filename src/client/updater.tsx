/**
 * webui — client 半身「基础设置」页签（自 dsh-updater 合并）。
 *
 * settings.section 页签：对话宽度 / 开机自启 / 当前版本 / 远程版本 / 更新操作 + 状态区。
 * 轮询 /api/dsh-updater/state（busy 1s / 空闲 3s）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

const BASE = '/api/dsh-updater'
const POLL_MS = 3000
const POLL_MS_BUSY = 1000

// Setting-Cell 行（与 GeneralSection 条目一致）
const cellRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const cellText: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }
const cellTitle: React.CSSProperties = { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const cellCaption: React.CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' }
const cellValue: React.CSSProperties = {
  flex: 'none', maxWidth: '55%', textAlign: 'right',
  fontSize: 14, lineHeight: '22px',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  wordBreak: 'break-all',
}
const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 680 }
const statusStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0 24px',
  fontSize: 13, lineHeight: 1.6,
}
const progressTrack: React.CSSProperties = {
  width: '100%', height: 8, borderRadius: 4,
  background: 'var(--dsw-alias-border-l2)',
  overflow: 'hidden',
}
const progressFill: React.CSSProperties = {
  height: '100%', borderRadius: 4,
  background: 'var(--dsw-alias-brand-primary, #4f8cff)',
  transition: 'width .5s ease',
}
const logStyle: React.CSSProperties = {
  padding: '8px 12px', maxHeight: 180, overflow: 'auto',
  fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'var(--dsw-alias-bg-base)',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8,
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
}

// —— 对话宽度（客户端本地设置）——
const WIDTH_DEFAULT = 748
const WIDTH_MIN = 560
const WIDTH_MAX = 1920
const WIDTH_STEP = 4
const WIDTH_STYLE_ID = 'dsh-updater-conversation-width'

function readSavedWidth(): number {
  try {
    const n = Number(localStorage.getItem('dsh.conversationWidth'))
    if (isFinite(n) && n > 0) return n
  } catch { /* 忽略 */ }
  return WIDTH_DEFAULT
}

// 一个常驻 <style> 元素：宽度覆盖在设置面板关闭后依然生效。
function applyWidthStyle(value: number): void {
  try {
    let el = document.getElementById(WIDTH_STYLE_ID)
    if (!el) {
      el = document.createElement('style')
      el.id = WIDTH_STYLE_ID
      document.head.appendChild(el)
    }
    el.textContent = `div[data-phase]{--dsh-chat-content-width:${value}px}`
  } catch { /* 忽略 */ }
}

function fetchState(): Promise<any> {
  return fetch(BASE + '/state', { cache: 'no-store' }).then(r => r.json())
}

interface UpdaterState {
  s: any
  busy: boolean
  setBusy: (b: boolean) => void
  error: string | null
  setError: (e: string | null) => void
  notice: string | null
  setNotice: (n: string | null) => void
  tick: () => void
}

// 共享状态：一次轮询，各单元格共用
function useUpdaterState(): UpdaterState {
  const [s, setS] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const tick = useCallback(() => {
    fetchState().then((st) => {
      setS(st)
      setBusy(Boolean(st && st.busy))
      if (st && st.error) setError(st.error); else setError(null)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    tick()
    const t = setInterval(() => {
      fetchState().then((st) => {
        setS(st)
        setBusy(Boolean(st && st.busy) || Boolean(st && st.progress && st.progress.percent < 100))
      }).catch(() => {})
    }, busy ? POLL_MS_BUSY : POLL_MS)
    return () => { clearInterval(t) }
  }, [tick, busy])

  return { s, busy, setBusy, error, setError, notice, setNotice, tick }
}

// 行 0（置顶）：对话宽度
function WidthCell(): JSX.Element {
  const [width, setWidth] = useState(readSavedWidth)

  useEffect(() => {
    applyWidthStyle(width)
    try { localStorage.setItem('dsh.conversationWidth', String(width)) } catch { /* 忽略 */ }
  }, [width])

  return (
    <div style={cellRow}>
      <div style={cellText}>
        <div style={cellTitle}>对话宽度</div>
        <div style={cellCaption}>调整对话区域的宽度（默认 {WIDTH_DEFAULT}px，范围 {WIDTH_MIN}–{WIDTH_MAX}px）</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
        <input
          type="range" min={WIDTH_MIN} max={WIDTH_MAX} step={WIDTH_STEP}
          value={String(width)} onChange={e => setWidth(Number(e.target.value))}
          style={{ width: 160, accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' }}
        />
        <div style={cellValue}>{width}px</div>
        <Button variant="outline" onClick={() => setWidth(WIDTH_DEFAULT)}>默认</Button>
      </div>
    </div>
  )
}

// 行 1：开机自动运行
function AutoStartCell({ ctx }: { ctx: UpdaterState }): JSX.Element {
  const s = ctx.s
  const auto = s && s.autoStart ? s.autoStart : null

  function onToggle(e: React.ChangeEvent<HTMLInputElement>): void {
    const enabled = e.target.checked
    ctx.setError(null)
    fetch(BASE + '/autoStart', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).then(r => r.json()).then((res) => {
      if (!res.ok) ctx.setError(res.message || '设置失败')
      ctx.tick()
    }).catch(() => ctx.setError('请求失败'))
  }

  return (
    <div style={cellRow}>
      <div style={cellText}>
        <div style={cellTitle}>开机自动运行</div>
        <div style={cellCaption}>
          {auto && auto.exePath
            ? '登录 Windows 后自动启动：' + auto.exePath
            : '未找到壳子 exe（dist 目录为空），请先打包壳子'}
        </div>
      </div>
      <input
        type="checkbox"
        checked={Boolean(auto && auto.enabled)}
        disabled={!auto}
        onChange={onToggle}
        style={{ width: 16, height: 16, accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' }}
      />
    </div>
  )
}

// 行 2：当前版本
function CurrentVersionCell({ ctx }: { ctx: UpdaterState }): JSX.Element {
  const s = ctx.s
  const text = s && s.current
    ? (s.current.short + ' @ ' + s.current.date + ' · ' + s.current.branch)
    : '未检查'
  const caption = s && s.current && s.current.dirty > 0
    ? ('工作区有 ' + s.current.dirty + ' 处本地改动')
    : null
  return (
    <div style={cellRow}>
      <div style={cellText}>
        <div style={cellTitle}>当前版本</div>
        {caption ? <div style={cellCaption}>{caption}</div> : null}
      </div>
      <div style={cellValue}>{text}</div>
    </div>
  )
}

// 行 3：远程版本
function RemoteVersionCell({ ctx }: { ctx: UpdaterState }): JSX.Element {
  const s = ctx.s
  let text = '未知，点击「检查更新」'
  let color = 'var(--dsw-alias-label-secondary)'
  if (s && s.remote) {
    if (s.remote.hasUpdate) {
      text = s.remote.short + '（落后 ' + s.remote.ahead + ' 个提交）'
      color = 'var(--dsw-alias-state-warn-primary)'
    } else {
      text = s.remote.short + '（已是最新）'
      color = 'var(--dsw-alias-state-success-primary)'
    }
  }
  return (
    <div style={cellRow}>
      <div style={cellText}>
        <div style={cellTitle}>远程版本</div>
      </div>
      <div style={{ ...cellValue, color }}>{text}</div>
    </div>
  )
}

// 行 4（末行，无分隔线）：更新操作
function UpdateCell({ ctx }: { ctx: UpdaterState }): JSX.Element {
  const busy = ctx.busy

  function doCheck(): void {
    ctx.setBusy(true)
    ctx.setError(null)
    ctx.setNotice('正在检查更新（git fetch）…')
    fetch(BASE + '/check', { method: 'POST', cache: 'no-store' })
      .then(r => r.json()).then((res) => {
        ctx.setNotice(null)
        if (!res.ok) { ctx.setError(res.message || '检查更新失败'); ctx.setBusy(false); return }
        ctx.tick()
      }).catch(() => { ctx.setError('检查更新请求失败'); ctx.setBusy(false); ctx.setNotice(null) })
  }

  function doStart(): void {
    if (!window.confirm('确定更新 DSH 源码并重启吗？\n更新期间服务会短暂中断，本地未提交改动会自动暂存（完事后自动恢复）。')) return
    ctx.setBusy(true)
    ctx.setError(null)
    ctx.setNotice(null)
    fetch(BASE + '/start', { method: 'POST', cache: 'no-store' })
      .then(r => r.json()).then((res) => {
        if (!res.ok) { ctx.setError(res.message || '启动更新失败'); ctx.setBusy(false); return }
        ctx.tick()
      }).catch(() => { ctx.setError('启动更新请求失败'); ctx.setBusy(false) })
  }

  const hasUpdate = Boolean(ctx.s && ctx.s.remote && ctx.s.remote.hasUpdate)

  return (
    <div style={{ ...cellRow, borderBottom: 'none' }}>
      <div style={cellText}>
        <div style={cellTitle}>更新</div>
        <div style={cellCaption}>git pull → pnpm install → pnpm build，随后自动重启壳子 exe。</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
        <Button variant="outline" onClick={doCheck} disabled={busy}>检查更新</Button>
        <Button variant="primary" onClick={doStart} disabled={busy || !hasUpdate}>更新并重启</Button>
      </div>
    </div>
  )
}

// 状态区：更新进度 / 提示 / 错误 / 上次结果 / 日志
function StatusBlock({ ctx }: { ctx: UpdaterState }): JSX.Element {
  const s = ctx.s
  const lastResult = s && s.lastResult
  const progress = s && s.progress
  const children: React.ReactNode[] = []
  if (progress) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)))
    children.push(
      <div key="prog" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
        <span>{progress.msg || progress.stage || '更新中…'}</span>
        <span>{pct}%</span>
      </div>,
      <div key="track" style={progressTrack}>
        <div style={{ ...progressFill, width: pct + '%' }} />
      </div>,
    )
  }
  if (ctx.notice) children.push(<div key="notice" style={{ color: 'var(--dsw-alias-state-warn-primary)' }}>{ctx.notice}</div>)
  if (ctx.error) children.push(<div key="error" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>{ctx.error}</div>)
  if (lastResult) {
    children.push(
      <div key="last" style={{ color: lastResult.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>
        上次更新：{lastResult.ok ? '成功' : '失败'}　{lastResult.commit || ''}　{lastResult.at || ''}{lastResult.stashed ? '　（已自动暂存并恢复本地改动）' : ''}
      </div>,
    )
  }
  if (s && s.logTail) children.push(<div key="log" style={logStyle}>{s.logTail}</div>)
  return <div style={statusStyle}>{children}</div>
}

// 设置导航页「基础设置」
function BasicSettingsSection(): JSX.Element {
  const ctx = useUpdaterState()
  return (
    <div style={sectionStyle}>
      <WidthCell />
      <AutoStartCell ctx={ctx} />
      <CurrentVersionCell ctx={ctx} />
      <RemoteVersionCell ctx={ctx} />
      <UpdateCell ctx={ctx} />
      <StatusBlock ctx={ctx} />
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  // 页面加载即恢复上次保存的宽度（无需先打开设置）
  applyWidthStyle(readSavedWidth())
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'basic',
      order: 5,
      label: () => '基础设置',
    }, BasicSettingsSection))
}
