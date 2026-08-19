/**
 * webui — client 半身「网络代理」设置行（自 dsh-proxy 合并）。
 *
 * settings.general.item 行：开关 + 代理地址 + 全部/仅选定厂商分段 + 厂商 chips，
 * 保存即运行时生效；状态轮询 /api/dsh-proxy/state。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

// ---- 样式（Setting-Cell 行式布局）----
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '12px 0' }
const copyStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }
const titleStyle: React.CSSProperties = { fontSize: 14, color: 'var(--dsw-alias-label-primary)' }
const descStyle: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 }
const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 8 }
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '4px 8px', fontSize: 12, marginTop: 2,
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-alias-bg-base)',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 6,
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
const segBase: React.CSSProperties = {
  padding: '3px 10px', fontSize: 12, cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'transparent', border: '1px solid var(--dsw-alias-border-l1)',
}
const segBaseR: React.CSSProperties = { ...segBase, borderTopLeftRadius: 6, borderBottomLeftRadius: 6 }
const segBaseL: React.CSSProperties = { ...segBase, borderTopRightRadius: 6, borderBottomRightRadius: 6 }
// 选中分段：ghost 按钮选中填充（浅色 bluish-100 / 深色 bluish-750）。
const segOn: React.CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-alias-button-ghost-active-fill)',
  borderColor: 'var(--dsw-alias-border-l2)',
}
const chipBase: React.CSSProperties = {
  padding: '3px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 6,
  color: 'var(--dsw-alias-label-secondary)',
  background: 'transparent', border: '1px solid var(--dsw-alias-border-l1)', maxWidth: '100%',
}
// 选中厂商 chip：品牌蓝浅底 + 蓝边框 + 蓝字（business 系变量两主题都有定义）。
const chipOn: React.CSSProperties = {
  color: 'var(--dsw-alias-state-business-primary)',
  background: 'var(--dsw-alias-state-business-tertiary)',
  borderColor: 'var(--dsw-alias-state-business-primary)',
}
const chipText: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const chipHost: React.CSSProperties = { fontSize: 11, opacity: 0.7, marginLeft: 4, fontWeight: 400 }

const BASE = '/api/dsh-proxy'

interface ProxyView {
  loading: boolean
  enabled: boolean
  url: string
  active: boolean
  mode: 'all' | 'selected'
  providers: string[]
}

function ProxyRow(): JSX.Element {
  const [st, setSt] = useState<ProxyView>({ loading: true, enabled: false, url: '', active: false, mode: 'all', providers: [] })
  const [avail, setAvail] = useState<Array<{ key: string; name: string; baseURL: string; host: string | null }>>([])
  const [urlInput, setUrlInput] = useState('')
  const [msg, setMsg] = useState('')

  // 拉取状态 + 厂商列表
  const refresh = useCallback(() => {
    Promise.all([
      fetch(BASE + '/state', { cache: 'no-store' }).then(r => r.json()),
      fetch(BASE + '/providers', { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
    ]).then((res) => {
      const s = res[0] || {}
      const prov = Array.isArray(res[1] && res[1].providers) ? res[1].providers : []
      setSt({
        loading: false,
        enabled: Boolean(s.enabled),
        url: s.url || '',
        active: Boolean(s.active),
        mode: s.mode === 'selected' ? 'selected' : 'all',
        providers: Array.isArray(s.providers) ? s.providers : [],
      })
      setAvail(prov)
      if (s.active) setMsg('当前已生效：选中厂商走代理，其余直连')
      else if (s.enabled) setMsg('已启用，等待代理连接…')
      else setMsg('')
    }).catch(() => setSt(prev => ({ ...prev, loading: false })))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // 回填地址：加载完成后若有已存 url 且输入框为空则填入
  useEffect(() => {
    if (!st.loading && st.url && urlInput === '') setUrlInput(st.url)
  }, [st]) // eslint-disable-line react-hooks/exhaustive-deps

  // 统一提交（开关/模式/厂商/地址都走这里），立即生效
  function applyNext(patch?: Partial<ProxyView>): void {
    setMsg('应用代理…')
    const body = {
      enabled: st.enabled === true,
      url: urlInput,
      mode: st.mode,
      providers: st.providers,
      ...(patch || {}),
    }
    fetch(BASE + '/set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()).then((r) => {
      if (!r.ok) { setMsg(r.message || r.error || '设置失败'); return }
      setSt({
        loading: false,
        enabled: Boolean(r.enabled),
        url: r.url || '',
        active: Boolean(r.active),
        mode: r.mode === 'selected' ? 'selected' : 'all',
        providers: Array.isArray(r.providers) ? r.providers : [],
      })
      setMsg(r.active
        ? (r.mode === 'selected'
          ? '代理已生效：' + ((r.hosts || []).length === 0 ? '未选中任何厂商' : (r.hosts || []).join('、')) + ' 走代理，其余直连'
          : '代理已启用，全部请求走代理')
        : '代理已关闭')
    }).catch(() => setMsg('请求失败'))
  }

  const onToggle = (): void => { applyNext({ enabled: !(st.enabled === true) }) }
  const onSave = (): void => { applyNext() }
  const onMode = (mode: 'all' | 'selected'): void => { applyNext({ mode }) }
  function onToggleProvider(key: string): void {
    const has = st.providers.indexOf(key) >= 0
    const next = has
      ? st.providers.filter(k => k !== key)
      : st.providers.concat([key])
    applyNext({ providers: next })
  }

  const enabled = st.enabled === true
  const selectedMode = st.mode === 'selected'
  const btnStyle = enabled ? switchOnStyle : switchStyle
  const knob = enabled ? knobOnStyle : knobStyle
  const desc = '让 DSH 的 API 请求走本地代理（B.AI 等海外服务需要）。可只选需要代理的厂商，或全部走代理。保存即生效，无需重启。'

  return (
    <div style={rowStyle}>
      <div style={copyStyle}>
        <div style={titleStyle}>网络代理</div>
        <div style={descStyle}>{desc}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="http://127.0.0.1:10808"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={onSave}
            disabled={st.loading}
            style={{
              flex: 'none', padding: '4px 12px', fontSize: 12, cursor: 'pointer',
              color: 'var(--dsw-alias-label-primary)',
              background: 'var(--dsw-alias-button-ghost-active-fill)',
              border: '1px solid var(--dsw-alias-border-l2)',
              borderRadius: 6,
            }}
          >
            应用
          </button>
        </div>
        <div style={labelStyle}>代理范围</div>
        <div style={{ display: 'flex', gap: 0, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => onMode('all')}
            disabled={st.loading}
            style={{ ...segBaseR, ...(enabled ? {} : { opacity: 0.6 }), ...(selectedMode ? {} : segOn) }}
          >
            全部走代理
          </button>
          <button
            type="button"
            onClick={() => onMode('selected')}
            disabled={st.loading}
            style={{ ...segBaseL, ...(enabled ? {} : { opacity: 0.6 }), ...(selectedMode ? segOn : {}) }}
          >
            仅选定厂商
          </button>
        </div>
        {selectedMode && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {avail.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)', padding: '2px 0' }}>
                未读取到厂商列表（需重启 DSH 后生效，或在下方直接填域名微调）
              </div>
            ) : avail.map((p) => {
              const active = st.providers.indexOf(p.key) >= 0
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onToggleProvider(p.key)}
                  disabled={st.loading || !enabled}
                  title={(p.baseURL || p.key) + (p.host ? '\n走代理域名：' + p.host : '')}
                  style={{ ...chipBase, ...(active ? chipOn : {}), ...(enabled ? {} : { opacity: 0.6 }) }}
                >
                  <span style={chipText}>
                    {(active ? '✓ ' : '') + p.name}
                    {p.host ? <span style={chipHost}>{p.host}</span> : null}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {msg ? (
          <div style={{
            fontSize: 12, marginTop: 6,
            color: st.active ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)',
          }}
          >
            {msg}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        style={btnStyle}
        onClick={onToggle}
        disabled={st.loading}
        aria-label="网络代理开关"
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
      id: 'network-proxy',
      order: 45,
    }, ProxyRow))
}
