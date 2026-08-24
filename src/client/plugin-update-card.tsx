/**
 * webui — client 半身「插件更新」设置卡（模块 key：pluginUpdate）。
 *
 * 设置「通用」分区的一张行卡片：主行显示当前版本 + 有新版本时的橙色徽章 +
 * 本次走的路径（增量更新 / 整包重装），右侧「检查更新」/「更新到最新」两个
 * 按钮；展开后是安装形态、远端版本/提交、上次更新结果、自动检查开关、
 * 「强制重装最新」兜底入口与执行日志。
 *
 * 默认走**增量更新**：只下载两个版本之间的改动补丁（通常几百 KB，整包是
 * ~4.7 MB），逐文件按 git blob sha 校验后原地替换；校验不过自动回退整包重装。
 *
 * 数据通道：/api/webui-plugin-update（GET 状态、POST /check、POST /apply），
 * host 半身 src/plugin-update.ts。更新完成后需重启 DSH 生效，卡片会明示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

const API = '/api/webui-plugin-update'
/** 空闲不轮询（避免无谓请求）；仅在服务端 busy（更新执行中）时按此间隔轮询。 */
const POLL_BUSY_MS = 1500

// ── 样式（对齐官方 ModelsSection 控件规格：行卡片 12px 圆角、小按钮胶囊 28px）──

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  padding: '12px 14px',
  margin: '10px 0',
}
const headRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 }
const copyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }
const titleRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
const titleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }
const descStyle: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' }
const monoStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  fontVariantNumeric: 'tabular-nums',
}

/** 徽章：有新版本=warn 边框、已最新=success 边框、其余中性。 */
function badgeStyle(tone: 'warn' | 'success' | 'neutral'): React.CSSProperties {
  const color = tone === 'warn'
    ? 'var(--dsw-alias-state-warn-primary)'
    : tone === 'success'
      ? 'var(--dsw-alias-state-success-primary)'
      : 'var(--dsw-alias-label-secondary)'
  return {
    border: `1px solid ${color}`,
    borderRadius: 4,
    padding: '1px 6px',
    fontSize: 11,
    lineHeight: '16px',
    color,
    whiteSpace: 'nowrap',
    flex: 'none',
  }
}

const smallBtn: React.CSSProperties = {
  borderRadius: 14, height: 28, padding: '0 12px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
  color: 'var(--dsw-alias-label-primary)', flex: 'none',
}
const smallBtnPrimary: React.CSSProperties = {
  ...smallBtn,
  border: '1px solid transparent',
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
}
const btnDisabled: React.CSSProperties = { opacity: 0.45, cursor: 'default' }

const editorStyle: React.CSSProperties = {
  background: 'var(--dsw-alias-bg-module-platform)',
  borderRadius: 12,
  padding: '14px 16px',
  marginTop: 10,
  display: 'flex', flexDirection: 'column', gap: 10,
}
const kvRow: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, flexWrap: 'wrap' }
const kvLabel: React.CSSProperties = { flex: 'none', minWidth: 76, color: 'var(--dsw-alias-label-secondary)' }
const kvValue: React.CSSProperties = { ...monoStyle, color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' }
const noteStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' }
const errorStyle: React.CSSProperties = { ...noteStyle, color: 'var(--dsw-alias-state-error-primary)' }
const logStyle: React.CSSProperties = {
  margin: 0, padding: '8px 10px', maxHeight: 160, overflow: 'auto',
  fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8,
  ...monoStyle,
}

// ── 数据 ───────────────────────────────────────────────────────────────────

type UpdateMode = 'incremental' | 'full'

interface Snapshot {
  ok?: boolean
  busy?: 'checking' | 'updating' | null
  stage?: string | null
  /** 本次更新走的路径：增量补丁 / 整包重装。 */
  mode?: UpdateMode | null
  error?: string | null
  log?: string | null
  message?: string
  local?: { name?: string; version?: string; commit?: string | null; dir?: string }
  remote?: { version?: string | null; commit?: string | null; checkedAt?: string } | null
  install?: { kind?: 'pnpm' | 'checkout' | 'unknown'; profileDir?: string | null; spec?: string | null; reason?: string | null }
  hasUpdate?: boolean
  config?: { autoCheck?: boolean; repo?: string; branch?: string }
  lastResult?: { ok?: boolean; at?: string; from?: string; to?: string | null; mode?: UpdateMode | null; error?: string } | null
}

const MODE_LABEL: Record<UpdateMode, string> = {
  incremental: '增量更新',
  full: '整包重装',
}

const INSTALL_LABEL: Record<string, string> = {
  pnpm: 'pnpm 托管（dsh plugin 安装）',
  checkout: '本地源码仓库（git）',
  unknown: '未识别',
}

function fmtTime(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function PluginUpdateCard(): JSX.Element {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'' | 'check' | 'apply'>('')
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const alive = useRef(true)

  const load = useCallback(async (): Promise<Snapshot | null> => {
    try {
      const data = await fetch(API, { cache: 'no-store' }).then(r => r.json())
      if (alive.current) setSnap(data)
      return data
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void load()
    return () => { alive.current = false }
  }, [load])

  // 服务端 busy（更新执行中）时轮询，直到落地。
  useEffect(() => {
    const serverBusy = snap?.busy !== null && snap?.busy !== undefined
    if (!serverBusy) return
    const timer = setInterval(() => { void load() }, POLL_BUSY_MS)
    return () => { clearInterval(timer) }
  }, [snap?.busy, load])

  const post = useCallback(async (path: string, body?: unknown): Promise<Snapshot | null> => {
    try {
      const data = await fetch(API + path, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }).then(r => r.json())
      if (alive.current) setSnap(data)
      return data
    } catch {
      return null
    }
  }, [])

  const doCheck = useCallback(async () => {
    setBusy('check')
    setMessage({ text: '正在检查上游版本…' })
    const data = await post('/check')
    setBusy('')
    if (data === null) { setMessage({ text: '检查请求失败', error: true }); return }
    if (data.ok === false) { setMessage({ text: data.message ?? '检查失败', error: true }); return }
    setMessage(data.hasUpdate === true
      ? { text: `发现新版本 ${data.remote?.version ?? ''}`.trim() }
      : { text: '已是最新版本' })
  }, [post])

  const doApply = useCallback(async (force: boolean) => {
    const kind = snap?.install?.kind
    const canIncremental = kind !== 'checkout'
      && typeof snap?.local?.commit === 'string'
      && typeof snap?.remote?.commit === 'string'
    const hint = kind === 'checkout'
      ? '将在插件源码目录执行 git pull --ff-only（git 自身即增量）。'
      : force
        ? '将重新下载并安装整包（约 4.7 MB）。'
        : canIncremental
          ? '将只下载两个版本之间的改动补丁（通常几百 KB），逐文件校验后就地更新；校验不通过会自动回退整包重装。'
          : '缺少提交信息，本次将整包重装。'
    if (!window.confirm(`确定更新 dsh-webui 插件吗？\n${hint}\n更新完成后需要重启 DSH 才会生效。`)) return
    setBusy('apply')
    setMessage({ text: '正在更新…' })
    const data = await post('/apply', force ? { force: true } : {})
    setBusy('')
    if (data === null) { setMessage({ text: '更新请求失败', error: true }); return }
    if (data.ok === false) { setMessage({ text: data.message ?? '更新失败', error: true }); return }
    setMessage({ text: data.message ?? '更新已启动' })
  }, [post, snap?.install?.kind, snap?.local?.commit, snap?.remote?.commit])

  const toggleAutoCheck = useCallback(async (enabled: boolean) => {
    await post('', { autoCheck: enabled })
  }, [post])

  const localVersion = snap?.local?.version ?? '—'
  const localCommit = snap?.local?.commit
  const remote = snap?.remote ?? null
  const hasUpdate = snap?.hasUpdate === true
  const serverBusy = snap?.busy === 'updating' || snap?.busy === 'checking'
  const blocked = snap?.install?.reason ?? null
  const anyBusy = busy !== '' || serverBusy
  const lastResult = snap?.lastResult ?? null
  const done = snap?.stage === 'done'

  return (
    <div style={cardStyle}>
      <div style={headRowStyle}>
        <div style={copyStyle}>
          <div style={titleRowStyle}>
            <span style={titleStyle}>插件更新</span>
            <span style={badgeStyle('neutral')}>
              <span style={monoStyle}>v{localVersion}</span>
            </span>
            {hasUpdate
              ? <span style={badgeStyle('warn')}>有新版本{remote?.version ? ` v${remote.version}` : ''}</span>
              : remote !== null ? <span style={badgeStyle('success')}>已是最新</span> : null}
            {done
              ? (
                <span style={badgeStyle('success')}>
                  已更新（{snap?.mode ? MODE_LABEL[snap.mode] : '完成'}），重启 DSH 生效
                </span>
              )
              : null}
            {serverBusy && snap?.busy === 'updating' && snap?.mode !== null && snap?.mode !== undefined
              ? <span style={badgeStyle('neutral')}>{MODE_LABEL[snap.mode]}中…</span>
              : null}
          </div>
          <div style={descStyle}>
            检查上游仓库是否有新版本，并一键就地更新：默认只下载版本之间的改动补丁（增量，通常几百 KB），
            逐文件校验后原地替换；校验不通过自动回退整包重装。更新后重启 DSH 生效
          </div>
        </div>
        <button
          type="button"
          style={anyBusy ? { ...smallBtn, ...btnDisabled } : smallBtn}
          disabled={anyBusy}
          onClick={() => { void doCheck() }}
        >
          {busy === 'check' || snap?.busy === 'checking' ? '检查中…' : '检查更新'}
        </button>
        <button
          type="button"
          style={anyBusy || blocked !== null || !hasUpdate ? { ...smallBtnPrimary, ...btnDisabled } : smallBtnPrimary}
          disabled={anyBusy || blocked !== null || !hasUpdate}
          onClick={() => { void doApply(false) }}
        >
          {busy === 'apply' || snap?.busy === 'updating' ? '更新中…' : '更新到最新'}
        </button>
        <button
          type="button"
          style={smallBtn}
          aria-expanded={open}
          onClick={() => { setOpen(v => !v) }}
        >
          {open ? '收起' : '详情'}
        </button>
      </div>

      {open
        ? (
          <div style={editorStyle}>
            <div style={kvRow}>
              <span style={kvLabel}>安装方式</span>
              <span style={kvValue}>{INSTALL_LABEL[snap?.install?.kind ?? 'unknown']}</span>
            </div>
            <div style={kvRow}>
              <span style={kvLabel}>本地版本</span>
              <span style={kvValue}>
                v{localVersion}{localCommit ? ` · ${localCommit.slice(0, 7)}` : ''}
              </span>
            </div>
            <div style={kvRow}>
              <span style={kvLabel}>上游版本</span>
              <span style={kvValue}>
                {remote === null
                  ? '未检查'
                  : `v${remote.version ?? '未知'}${remote.commit ? ` · ${remote.commit.slice(0, 7)}` : ''}（${fmtTime(remote.checkedAt)}）`}
              </span>
            </div>
            <div style={kvRow}>
              <span style={kvLabel}>上游仓库</span>
              <span style={kvValue}>{snap?.config?.repo ?? '—'} · {snap?.config?.branch ?? '—'}</span>
            </div>
            {snap?.install?.spec
              ? (
                <div style={kvRow}>
                  <span style={kvLabel}>依赖来源</span>
                  <span style={kvValue}>{snap.install.spec}</span>
                </div>
              )
              : null}

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={snap?.config?.autoCheck !== false}
                onChange={(e) => { void toggleAutoCheck(e.target.checked) }}
              />
              服务启动后自动检查一次新版本
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                style={anyBusy || blocked !== null ? { ...smallBtn, ...btnDisabled } : smallBtn}
                disabled={anyBusy || blocked !== null}
                onClick={() => { void doApply(true) }}
              >
                强制重装最新
              </button>
              <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
                跳过增量补丁，重新下载安装整包（约 4.7 MB）；本地文件被改动过时用它兜底
              </span>
            </div>

            {blocked !== null ? <p style={errorStyle}>{blocked}</p> : null}
            {snap?.error ? <p style={errorStyle}>{snap.error}</p> : null}
            {lastResult !== null
              ? (
                <p style={noteStyle}>
                  上次更新：{lastResult.ok === true ? '成功' : '失败'}
                  {lastResult.mode ? `（${MODE_LABEL[lastResult.mode]}）` : ''}　{fmtTime(lastResult.at)}
                  {lastResult.ok === true && lastResult.to ? `　${lastResult.from} → ${lastResult.to}` : ''}
                  {lastResult.ok !== true && lastResult.error ? `　${lastResult.error}` : ''}
                </p>
              )
              : null}
            {message !== null
              ? <p style={message.error === true ? errorStyle : noteStyle} role="status">{message.text}</p>
              : null}
            {snap?.log ? <pre style={logStyle}>{snap.log}</pre> : null}
          </div>
        )
        : null}
    </div>
  )
}

/** 注册「插件更新」卡片到设置通用分区（紧邻临时清理卡片之后）。 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'plugin-update',
      order: 47,
    }, PluginUpdateCard))
}
