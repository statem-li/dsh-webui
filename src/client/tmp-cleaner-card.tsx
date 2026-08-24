/**
 * webui — client 半身「工作区临时垃圾清理」设置卡（模块 key：tmpCleaner）。
 *
 * 设置页通用分区里的一张可展开行卡片（对齐官方 ModelsSection 的行卡片 +
 * 行内编辑器规格）：主行为标题 + 描述 + 启用开关；展开后是自动清理计划
 * （每天 HH:mm / 每 N 小时）、最小文件年龄、追加规则、空目录与提示词注入
 * 开关，以及「保存设置 / 预览待清理 / 立即清理」操作和最近运行状态。
 *
 * 数据通道：GET/POST /api/webui-tmp-cleaner（host 半身 src/tmp-cleaner.ts），
 * 配置落 settings 命名空间 webui-tmp-cleaner，服务端持久化。
 */
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

// ── 样式（对齐官方控件规格：输入框 32px/8px 圆角、小按钮胶囊 28px、编辑器填充面）──

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  padding: '12px 14px',
  margin: '10px 0',
}
const headRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
}
const copyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }
const titleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }
const descStyle: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' }
const tagStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 4, padding: '1px 6px',
  fontSize: 11, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap', flex: 'none',
}

const switchBase: React.CSSProperties = {
  position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
  flex: 'none', background: 'var(--dsw-alias-border-l2)', transition: 'background .15s', padding: 0,
}
const switchOn: React.CSSProperties = { ...switchBase, background: 'var(--dsw-alias-state-business-primary)' }
const knobBase: React.CSSProperties = {
  position: 'absolute', top: 2, left: 2, width: 18, height: 18, borderRadius: '50%',
  background: 'var(--dsw-alias-label-tertiary)',
  transition: 'left .15s, background .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
}
const knobOn: React.CSSProperties = { ...knobBase, left: 20, background: '#fff' }

const editorStyle: React.CSSProperties = {
  background: 'var(--dsw-alias-bg-module-platform)',
  borderRadius: 12,
  padding: '14px 16px',
  marginTop: 10,
  display: 'flex', flexDirection: 'column', gap: 12,
}
const fieldLabel: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

const inputStyle: React.CSSProperties = {
  height: 32, padding: '0 10px', fontSize: 14, lineHeight: '22px',
  borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
}
// 下拉：输入框规格 + 无原生箭头 + 自定义 chevron（data-URI）。
const chevronSvg = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="#81858C" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  paddingRight: 32,
  backgroundImage: `url("data:image/svg+xml,${chevronSvg}")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
}

const smallBtn: React.CSSProperties = {
  borderRadius: 14, height: 28, padding: '0 12px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
}
const smallBtnPrimary: React.CSSProperties = {
  ...smallBtn,
  border: '1px solid transparent',
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
}
const btnDisabled: React.CSSProperties = { opacity: 0.45, cursor: 'default' }

const resultStyle: React.CSSProperties = {
  margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)',
  wordBreak: 'break-all',
}
const errorStyle: React.CSSProperties = { ...resultStyle, color: 'var(--dsw-alias-state-error-primary, #e5484d)' }

// ── 数据 ───────────────────────────────────────────────────────────────────

interface CleanerConfigDraft {
  enabled: boolean
  scheduleKind: 'daily' | 'interval'
  dailyTime: string
  intervalHours: number
  minAgeHours: number
  cleanOnStart: boolean
  injectPrompt: boolean
  extraPatterns: string[]
  cleanEmptyDirs: boolean
}

interface StatusPayload {
  ok?: boolean
  config?: CleanerConfigDraft
  lastRunAt?: string | null
  nextDue?: string | null
  recent?: Array<{ ts?: string; deleted?: number; freedBytes?: number; dryRun?: boolean; errors?: number }>
}

async function apiGet(): Promise<StatusPayload> {
  return fetch('/api/webui-tmp-cleaner', { cache: 'no-store' }).then(r => r.json())
}

function humanBytes(bytes: unknown): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u += 1
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

// ── 组件 ───────────────────────────────────────────────────────────────────

function TmpCleanerCard(): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CleanerConfigDraft | null>(null)
  const [status, setStatus] = useState<StatusPayload>({})
  const [busy, setBusy] = useState<'' | 'save' | 'preview' | 'run'>('')
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    apiGet().then((r) => {
      if (!alive || !r?.config) return
      setStatus(r)
      setDraft({ ...r.config! })
      setLoaded(true)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!loaded || draft === null) {
    return (
      <div style={cardStyle}>
        <div style={headRowStyle}>
          <div style={copyStyle}>
            <div style={titleStyle}>工作区临时垃圾清理</div>
            <div style={descStyle}>加载中…</div>
          </div>
        </div>
      </div>
    )
  }

  const patch = (partial: Partial<CleanerConfigDraft>): void => {
    setDraft({ ...draft, ...partial })
  }

  // override：开关等「改完立即保存」的场景需要传最新草稿，避开 setState 异步竞态。
  const save = async (override?: CleanerConfigDraft): Promise<void> => {
    const payload = override ?? draft
    setBusy('save')
    setMessage(null)
    try {
      const r = await fetch('/api/webui-tmp-cleaner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'config', patch: payload }),
      }).then(x => x.json())
      if (r?.ok && r.config) {
        setDraft({ ...r.config })
        setStatus((s) => ({ ...s, config: r.config }))
        setMessage({ text: '设置已保存。' })
      } else {
        setMessage({ text: `保存失败：${r?.error ?? '未知错误'}`, error: true })
      }
    } catch (error: any) {
      setMessage({ text: `保存失败：${String(error?.message ?? error)}`, error: true })
    } finally {
      setBusy('')
    }
  }

  const doAction = async (kind: 'preview' | 'run'): Promise<void> => {
    if (kind === 'run' && !window.confirm('确定立即清理各工作区的临时垃圾吗？（受最小文件年龄保护，刚生成的文件不会被动）')) return
    setBusy(kind)
    setMessage(null)
    try {
      const r = await fetch('/api/webui-tmp-cleaner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: kind }),
      }).then(x => x.json())
      if (r?.ok && r.result) {
        const res = r.result as { items: Array<{ path: string; reason: string }>; errors: string[]; truncated: boolean; workspaces: string[] }
        const sample = res.items.slice(0, 6).map(i => i.path).join('\n')
        const head = kind === 'preview'
          ? `预览：共 ${r.totalItems ?? res.items.length} 个待清理条目${res.truncated ? '（已达单轮上限截断）' : ''}`
          : `已清理 ${r.totalItems ?? res.items.length} 个条目`
        setMessage({
          text: `${head}${res.errors.length > 0 ? `，${res.errors.length} 个失败` : ''}\n涉及工作区：${res.workspaces.length} 个${sample !== '' ? `\n${sample}${res.items.length > 6 ? '\n…' : ''}` : ''}`,
        })
        if (kind === 'run') void apiGet().then((s) => { setStatus(s) })
      } else {
        setMessage({ text: `执行失败：${r?.error ?? '未知错误'}`, error: true })
      }
    } catch (error: any) {
      setMessage({ text: `执行失败：${String(error?.message ?? error)}`, error: true })
    } finally {
      setBusy('')
    }
  }

  const last = status.recent?.find(item => item.dryRun !== true)

  return (
    <div style={cardStyle}>
      <div style={headRowStyle}>
        <button
          type="button"
          style={{ ...copyStyle, border: 'none', background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer', padding: 0 }}
          onClick={() => { setOpen(!open) }}
          aria-expanded={open}
        >
          <span style={titleStyle}>工作区临时垃圾清理</span>
          <span style={descStyle}>
            定时清空各工作区 _tmp/ 内的 AI 临时脚本与常见垃圾文件（*.tmp/*.log 等），带最小年龄保护
          </span>
        </button>
        <span style={tagStyle}>{draft.enabled ? '自动清理开' : '仅手动'}</span>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label="自动清理开关"
          style={(draft.enabled ? switchOn : switchBase)}
          onClick={() => {
            const next = { ...draft, enabled: !draft.enabled }
            setDraft(next)
            void save(next)
          }}
        >
          <span style={draft.enabled ? knobOn : knobBase} />
        </button>
      </div>

      {open
        ? (
            <div style={editorStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={fieldLabel}>自动清理计划</span>
                <div style={fieldRow}>
                  <select
                    style={selectStyle}
                    value={draft.scheduleKind}
                    onChange={e => patch({ scheduleKind: e.target.value === 'interval' ? 'interval' : 'daily' })}
                  >
                    <option value="daily">每天定时</option>
                    <option value="interval">固定间隔</option>
                  </select>
                  {draft.scheduleKind === 'daily'
                    ? (
                        <input
                          type="time"
                          style={inputStyle}
                          value={draft.dailyTime}
                          onChange={e => patch({ dailyTime: e.target.value })}
                        />
                      )
                    : (
                        <>
                          <input
                            type="number"
                            min={1}
                            max={720}
                            style={{ ...inputStyle, width: 80 }}
                            value={draft.intervalHours}
                            onChange={e => patch({ intervalHours: Number(e.target.value) })}
                          />
                          <span style={fieldLabel}>小时</span>
                        </>
                      )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={fieldLabel}>最小文件年龄（小时，到龄才清；0 = 不限）</span>
                <input
                  type="number"
                  min={0}
                  max={8760}
                  style={{ ...inputStyle, width: 120 }}
                  value={draft.minAgeHours}
                  onChange={e => patch({ minAgeHours: Number(e.target.value) })}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={fieldLabel}>追加垃圾规则（* ? 通配，逗号分隔；内置 *.tmp *.bak *.swp *.log .DS_Store Thumbs.db 等）</span>
                <input
                  type="text"
                  style={inputStyle}
                  placeholder="例如：*.temp, npm-debug.log*"
                  value={draft.extraPatterns.join(', ')}
                  onChange={e => patch({
                    extraPatterns: e.target.value.split(/[,，]/).map(s => s.trim()).filter(s => s.length > 0),
                  })}
                />
              </div>

              <div style={fieldRow}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={draft.cleanEmptyDirs}
                    onChange={e => patch({ cleanEmptyDirs: e.target.checked })}
                  />
                  同时清理空目录
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={draft.injectPrompt}
                    onChange={e => patch({ injectPrompt: e.target.checked })}
                  />
                  维护「_tmp/ 约定」置顶记忆
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={draft.cleanOnStart}
                    onChange={e => patch({ cleanOnStart: e.target.checked })}
                  />
                  服务启动时补跑一轮
                </label>
              </div>

              <div style={fieldRow}>
                <button
                  type="button"
                  style={busy === 'save' ? { ...smallBtnPrimary, ...btnDisabled } : smallBtnPrimary}
                  disabled={busy !== ''}
                  onClick={() => { void save() }}
                >
                  {busy === 'save' ? '保存中…' : '保存设置'}
                </button>
                <button
                  type="button"
                  style={busy !== '' ? { ...smallBtn, ...btnDisabled } : smallBtn}
                  disabled={busy !== ''}
                  onClick={() => { void doAction('preview') }}
                >
                  {busy === 'preview' ? '扫描中…' : '预览待清理'}
                </button>
                <button
                  type="button"
                  style={busy !== '' ? { ...smallBtn, ...btnDisabled } : smallBtn}
                  disabled={busy !== ''}
                  onClick={() => { void doAction('run') }}
                >
                  {busy === 'run' ? '清理中…' : '立即清理'}
                </button>
              </div>

              <p style={resultStyle}>
                上次清理：{fmtTime(last?.ts ?? status.lastRunAt)}
                {last ? `，清理 ${last.deleted ?? 0} 个条目（释放 ${humanBytes(last.freedBytes)}）` : ''}；
                下次计划触发：{fmtTime(status.nextDue)}
              </p>
              {message !== null
                ? <p style={message.error === true ? errorStyle : resultStyle} role="status">{message.text}</p>
                : null}
            </div>
          )
          : null}
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'tmp-cleaner',
      order: 46,
    }, TmpCleanerCard))
}
