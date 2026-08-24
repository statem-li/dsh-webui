/**
 * webui — client 半身「网络代理」设置卡（自 dsh-proxy 合并）。
 *
 * 布局对齐官方 ModelsSection 规格：主行=标题+描述+状态标签+总开关（默认收起，
 * 不再把地址框/分段/厂商 chips 全部平铺在设置页里）；展开后是填充面编辑器——
 * 代理地址、代理范围分段、厂商多选、额外域名、连通性自检与状态提示。
 *
 * 数据通道：GET /api/dsh-proxy/state | providers、POST /api/dsh-proxy/set、
 * GET /api/dsh-proxy/test（真实经代理探活）。保存即运行时生效，无需重启。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

// ── 样式（官方控件规格：行卡片 12px 圆角、输入框 32px、小按钮胶囊 28px）──

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  padding: '12px 14px',
  margin: '10px 0',
}
const headRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 }
const copyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }
const titleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }
const descStyle: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' }
const tagStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 4, padding: '1px 6px',
  fontSize: 11, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap', flex: 'none',
}

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

const editorStyle: React.CSSProperties = {
  background: 'var(--dsw-alias-bg-module-platform)',
  borderRadius: 12,
  padding: '14px 16px',
  marginTop: 10,
  display: 'flex', flexDirection: 'column', gap: 14,
}
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }
const fieldLabel: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

const inputStyle: React.CSSProperties = {
  height: 32, padding: '0 10px', fontSize: 14, lineHeight: '22px', minWidth: 0, flex: 1,
  borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
}
const smallBtn: React.CSSProperties = {
  borderRadius: 14, height: 28, padding: '0 12px', fontSize: 12, cursor: 'pointer', flex: 'none',
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

// 分段控件：两个 28px 胶囊拼成一条，选中态用 ghost 选中填充。
const segBase: React.CSSProperties = {
  height: 28, padding: '0 12px', fontSize: 12, cursor: 'pointer', flex: 'none',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'transparent', border: '1px solid var(--dsw-alias-border-l2)',
}
const segLeft: React.CSSProperties = { ...segBase, borderRadius: '14px 0 0 14px' }
const segRight: React.CSSProperties = { ...segBase, borderRadius: '0 14px 14px 0', marginLeft: -1 }
const segOn: React.CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-alias-button-ghost-active-fill)',
  position: 'relative',
}

// 厂商多选：等宽两列网格，避免长域名把 chips 撑成参差不齐的瀑布流。
const providerGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 6,
  maxHeight: 168, overflowY: 'auto',
}
const providerItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, textAlign: 'left',
  height: 32, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
  color: 'var(--dsw-alias-label-primary)', fontSize: 13,
}
const providerItemOnStyle: React.CSSProperties = {
  ...providerItemStyle,
  borderColor: 'var(--dsw-alias-state-business-primary)',
  background: 'var(--dsw-alias-state-business-tertiary)',
  color: 'var(--dsw-alias-state-business-primary)',
}
const providerNameStyle: React.CSSProperties = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 'none', maxWidth: '55%',
}
const providerHostStyle: React.CSSProperties = {
  fontSize: 11, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
}
const checkStyle: React.CSSProperties = {
  width: 14, height: 14, flex: 'none', borderRadius: 4, display: 'grid', placeItems: 'center',
  border: '1px solid var(--dsw-alias-border-l2)', fontSize: 10, lineHeight: 1,
}
const checkOnStyle: React.CSSProperties = {
  ...checkStyle,
  border: '1px solid var(--dsw-alias-state-business-primary)',
  background: 'var(--dsw-alias-state-business-primary)',
  color: '#fff',
}
const noteStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' }
const okNoteStyle: React.CSSProperties = { ...noteStyle, color: 'var(--dsw-alias-state-success-primary)' }
const warnNoteStyle: React.CSSProperties = { ...noteStyle, color: 'var(--dsw-alias-state-warn-primary)' }
const errNoteStyle: React.CSSProperties = { ...noteStyle, color: 'var(--dsw-alias-state-error-primary)' }

const BASE = '/api/dsh-proxy'

interface ProviderEntry { key: string; name: string; baseURL: string; host: string | null }

interface ProxyView {
  loading: boolean
  enabled: boolean
  url: string
  active: boolean
  mode: 'all' | 'selected'
  providers: string[]
  extraHosts: string[]
  hosts: string[]
  stale: string[]
}

type NoteKind = 'info' | 'ok' | 'warn' | 'error'
interface Note { kind: NoteKind; text: string }

const EMPTY: ProxyView = {
  loading: true, enabled: false, url: '', active: false,
  mode: 'all', providers: [], extraHosts: [], hosts: [], stale: [],
}

/** 把服务端返回投影成视图状态（字段缺失时给安全默认）。 */
function toView(payload: any): ProxyView {
  const s = payload && typeof payload === 'object' ? payload : {}
  return {
    loading: false,
    enabled: s.enabled === true,
    url: typeof s.url === 'string' ? s.url : '',
    active: s.active === true,
    mode: s.mode === 'selected' ? 'selected' : 'all',
    providers: Array.isArray(s.providers) ? s.providers.filter((p: unknown) => typeof p === 'string') : [],
    extraHosts: Array.isArray(s.extraHosts) ? s.extraHosts.filter((p: unknown) => typeof p === 'string') : [],
    hosts: Array.isArray(s.hosts) ? s.hosts.filter((p: unknown) => typeof p === 'string') : [],
    stale: Array.isArray(s.stale) ? s.stale.filter((p: unknown) => typeof p === 'string') : [],
  }
}

function noteStyleOf(kind: NoteKind): React.CSSProperties {
  if (kind === 'ok') return okNoteStyle
  if (kind === 'warn') return warnNoteStyle
  if (kind === 'error') return errNoteStyle
  return noteStyle
}

function ProxyCard(): JSX.Element {
  const [st, setSt] = useState<ProxyView>(EMPTY)
  const [avail, setAvail] = useState<ProviderEntry[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [hostsInput, setHostsInput] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState<Note | null>(null)

  // 拉取状态 + 厂商列表（草稿输入框只在首次/外部变更后回填）。
  const refresh = useCallback(() => {
    Promise.all([
      fetch(BASE + '/state', { cache: 'no-store' }).then(r => r.json()),
      fetch(BASE + '/providers', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
    ]).then((res) => {
      const view = toView(res[0])
      setSt(view)
      setUrlInput(view.url)
      setHostsInput(view.extraHosts.join(', '))
      setAvail(Array.isArray(res[1]?.providers) ? res[1].providers : [])
    }).catch(() => { setSt(prev => ({ ...prev, loading: false })) })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  /** 统一提交：开关/模式/厂商/地址/额外域名都走这里，立即生效。 */
  const submit = useCallback(async (patch: Partial<ProxyView>, tag: string): Promise<void> => {
    setBusy(tag)
    setNote(null)
    try {
      const body = {
        enabled: st.enabled,
        url: urlInput,
        mode: st.mode,
        providers: st.providers,
        extraHosts: hostsInput.split(/[,，\s]+/).filter(s => s.length > 0),
        ...patch,
      }
      const r = await fetch(BASE + '/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(res => res.json())
      if (r?.ok !== true) {
        setNote({ kind: 'error', text: String(r?.message ?? r?.error ?? '设置失败') })
        return
      }
      const view = toView(r)
      setSt(view)
      setUrlInput(view.url)
      setHostsInput(view.extraHosts.join(', '))
      if (!view.enabled) setNote({ kind: 'info', text: '代理已关闭，全部请求直连' })
      else if (view.mode === 'all') setNote({ kind: 'ok', text: '已生效：全部请求走 ' + view.url })
      else if (view.hosts.length === 0) setNote({ kind: 'warn', text: '已启用，但没有任何域名走代理——请勾选厂商或填写额外域名' })
      else setNote({ kind: 'ok', text: '已生效：' + view.hosts.join('、') + ' 走代理，其余直连' })
    } catch {
      setNote({ kind: 'error', text: '请求失败，DSH 服务可能未就绪' })
    } finally {
      setBusy('')
    }
  }, [st.enabled, st.mode, st.providers, urlInput, hostsInput])

  /** 连通性自检：真实经代理请求一次，区分「已挂载」与「真的通」。 */
  const probe = useCallback(async (): Promise<void> => {
    setBusy('test')
    setNote(null)
    try {
      const r = await fetch(BASE + '/test', { cache: 'no-store' }).then(res => res.json())
      if (r?.ok !== true) {
        setNote({ kind: 'error', text: String(r?.message ?? r?.error ?? '自检失败') })
      } else if (r.reachable === true) {
        setNote({ kind: 'ok', text: '代理连通（' + String(r.target) + ' → HTTP ' + String(r.status) + '，' + String(r.elapsedMs) + ' ms）' })
      } else {
        setNote({ kind: 'error', text: '代理不通：' + String(r.message ?? '未知错误') + '——检查本地代理是否在 ' + String(r.url) + ' 监听' })
      }
    } catch {
      setNote({ kind: 'error', text: '自检请求失败' })
    } finally {
      setBusy('')
    }
  }, [])

  const selectedMode = st.mode === 'selected'
  const busyAny = busy !== '' || st.loading
  const dirty = urlInput.trim() !== st.url
    || hostsInput.split(/[,，\s]+/).filter(s => s.length > 0).join(',') !== st.extraHosts.join(',')

  const statusTag = !st.enabled
    ? '已关闭'
    : selectedMode
      ? (st.hosts.length === 0 ? '未选域名' : st.hosts.length + ' 个域名')
      : '全局'

  return (
    <div style={cardStyle}>
      <div style={headRowStyle}>
        <button
          type="button"
          style={{ ...copyStyle, border: 'none', background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer', padding: 0 }}
          onClick={() => { setOpen(!open) }}
          aria-expanded={open}
        >
          <span style={titleStyle}>网络代理</span>
          <span style={descStyle}>
            让 DSH 的 API 请求走本地代理（B.AI 等海外服务需要）；保存即生效，无需重启
          </span>
        </button>
        <span style={tagStyle}>{statusTag}</span>
        <button
          type="button"
          role="switch"
          aria-checked={st.enabled}
          aria-label="网络代理开关"
          style={st.enabled ? switchOnStyle : switchStyle}
          onClick={() => { void submit({ enabled: !st.enabled }, 'toggle') }}
          disabled={busyAny}
        >
          <span style={st.enabled ? knobOnStyle : knobStyle} />
        </button>
      </div>

      {open
        ? (
            <div style={editorStyle}>
              <div style={fieldStyle}>
                <span style={fieldLabel}>代理地址</span>
                <div style={fieldRow}>
                  <input
                    type="text"
                    style={inputStyle}
                    placeholder="http://127.0.0.1:10808"
                    value={urlInput}
                    onChange={(e) => { setUrlInput(e.target.value) }}
                  />
                  <button
                    type="button"
                    style={busyAny || !dirty ? { ...smallBtnPrimary, ...btnDisabled } : smallBtnPrimary}
                    disabled={busyAny || !dirty}
                    onClick={() => { void submit({}, 'save') }}
                  >
                    {busy === 'save' ? '应用中…' : '应用'}
                  </button>
                  <button
                    type="button"
                    style={busyAny ? { ...smallBtn, ...btnDisabled } : smallBtn}
                    disabled={busyAny}
                    onClick={() => { void probe() }}
                  >
                    {busy === 'test' ? '测试中…' : '连通性测试'}
                  </button>
                </div>
              </div>

              <div style={fieldStyle}>
                <span style={fieldLabel}>代理范围</span>
                <div style={{ display: 'flex' }}>
                  <button
                    type="button"
                    style={{ ...segLeft, ...(selectedMode ? {} : segOn) }}
                    disabled={busyAny}
                    onClick={() => { void submit({ mode: 'all' }, 'mode') }}
                  >
                    全部走代理
                  </button>
                  <button
                    type="button"
                    style={{ ...segRight, ...(selectedMode ? segOn : {}) }}
                    disabled={busyAny}
                    onClick={() => { void submit({ mode: 'selected' }, 'mode') }}
                  >
                    仅选定厂商
                  </button>
                </div>
              </div>

              {selectedMode
                ? (
                    <>
                      <div style={fieldStyle}>
                        <span style={fieldLabel}>
                          走代理的厂商（{st.providers.length}/{avail.length} 已选）
                        </span>
                        {avail.length === 0
                          ? <p style={noteStyle}>未读取到厂商列表——可在下方「额外域名」直接填域名</p>
                          : (
                              <div style={providerGridStyle}>
                                {avail.map((p) => {
                                  const on = st.providers.includes(p.key)
                                  return (
                                    <button
                                      key={p.key}
                                      type="button"
                                      role="checkbox"
                                      aria-checked={on}
                                      title={(p.baseURL || p.key) + (p.host ? '\n走代理域名：' + p.host : '\n无法解析域名，勾选无效')}
                                      style={on ? providerItemOnStyle : providerItemStyle}
                                      disabled={busyAny}
                                      onClick={() => {
                                        const next = on
                                          ? st.providers.filter(k => k !== p.key)
                                          : st.providers.concat([p.key])
                                        void submit({ providers: next }, 'provider')
                                      }}
                                    >
                                      <span style={on ? checkOnStyle : checkStyle}>{on ? '✓' : ''}</span>
                                      <span style={providerNameStyle}>{p.name}</span>
                                      <span style={providerHostStyle}>{p.host ?? '域名未知'}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                      </div>

                      <div style={fieldStyle}>
                        <span style={fieldLabel}>额外域名（逗号分隔，支持 *.example.com；厂商目录之外的服务写这里）</span>
                        <div style={fieldRow}>
                          <input
                            type="text"
                            style={inputStyle}
                            placeholder="例如：generativelanguage.googleapis.com, *.openai.com"
                            value={hostsInput}
                            onChange={(e) => { setHostsInput(e.target.value) }}
                          />
                          <button
                            type="button"
                            style={busyAny || !dirty ? { ...smallBtn, ...btnDisabled } : smallBtn}
                            disabled={busyAny || !dirty}
                            onClick={() => { void submit({}, 'save') }}
                          >
                            保存域名
                          </button>
                        </div>
                      </div>
                    </>
                  )
                : null}

              {st.stale.length > 0
                ? (
                    <p style={warnNoteStyle}>
                      已勾选但厂商目录里不存在的项：{st.stale.join('、')}——它们解析不出域名，不会走代理
                      <button
                        type="button"
                        style={{ ...smallBtn, marginLeft: 8 }}
                        disabled={busyAny}
                        onClick={() => {
                          void submit({ providers: st.providers.filter(k => !st.stale.includes(k)) }, 'clean')
                        }}
                      >
                        清理
                      </button>
                    </p>
                  )
                : null}

              {note !== null ? <p style={noteStyleOf(note.kind)} role="status">{note.text}</p> : null}
              {note === null && st.enabled && st.active
                ? (
                    <p style={noteStyle}>
                      {selectedMode
                        ? (st.hosts.length === 0 ? '已启用，但没有域名命中代理' : '走代理：' + st.hosts.join('、'))
                        : '全部请求走 ' + st.url}
                      ；「已挂载」不等于「代理可用」，可点连通性测试确认
                    </p>
                  )
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
      id: 'network-proxy',
      order: 45,
    }, ProxyCard))
}
