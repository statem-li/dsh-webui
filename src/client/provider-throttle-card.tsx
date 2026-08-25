/**
 * webui — client 半身「供应商限流」设置卡。
 *
 * 布局对齐官方 ModelsSection 规格：主行 = 标题 + 描述 + 状态标签 + 总开关
 * （默认收起）；展开后是填充面编辑器——规则列表（域名 / 每分钟上限 /
 * 并发上限）+ 添加规则 + 保存，并实时显示每 host 的排队/执行/放行/429 计数。
 * 用于对并发与短窗口 RPM 双重限流的供应商（如 B.AI）在请求发出前抹平节奏，
 * 从源头避免 429。
 *
 * 数据通道：GET/POST /api/webui-provider-throttle/state|set。保存即运行时
 * 生效，无需重启；默认关闭时全部请求原样发出。
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
// 开启态用品牌蓝（state-business-primary），不能用 brand-primary——浅色下是黑色（反色设计）。
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
  display: 'flex', flexDirection: 'column', gap: 12,
}
const ruleCardStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  padding: '10px 12px',
  display: 'flex', flexDirection: 'column', gap: 8,
}
const fieldLabel: React.CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

const inputStyle: React.CSSProperties = {
  height: 32, padding: '0 10px', fontSize: 14, lineHeight: '22px', minWidth: 0, flex: 1,
  borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
}
const numStyle: React.CSSProperties = { ...inputStyle, flex: 'none', width: 96, textAlign: 'right' }
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
const smallBtnDanger: React.CSSProperties = {
  ...smallBtn,
  color: 'var(--dsw-alias-state-error-primary)',
}
const btnDisabled: React.CSSProperties = { opacity: 0.45, cursor: 'default' }
const noteStyle: React.CSSProperties = { fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)', margin: 0 }
const okNoteStyle: React.CSSProperties = { ...noteStyle, color: 'var(--dsw-alias-state-success-primary)' }
const errNoteStyle: React.CSSProperties = { ...noteStyle, color: 'var(--dsw-alias-state-error-primary)' }
const statsRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  fontSize: 12, color: 'var(--dsw-alias-label-secondary)', padding: '2px 0 0 2px',
}

interface RuleDraft {
  host: string
  maxRpm: string
  maxConcurrency: string
}

interface StatsView {
  waiting: number
  active: number
  passed: number
  throttled: number
}

interface StateView {
  loading: boolean
  enabled: boolean
  rules: RuleDraft[]
  active: boolean
  stats: Record<string, StatsView>
}

type NoteKind = 'ok' | 'error'
interface Note { kind: NoteKind; text: string }

const EMPTY: StateView = { loading: true, enabled: false, rules: [], active: false, stats: {} }

function toView(payload: any): StateView {
  const s = payload && typeof payload === 'object' ? payload : {}
  return {
    loading: false,
    enabled: s.enabled === true,
    active: s.active === true,
    rules: Array.isArray(s.rules)
      ? s.rules.map((r: any) => ({
          host: typeof r?.host === 'string' ? r.host : '',
          maxRpm: typeof r?.maxRpm === 'number' ? String(r.maxRpm) : '',
          maxConcurrency: typeof r?.maxConcurrency === 'number' ? String(r.maxConcurrency) : '',
        })).filter((r: RuleDraft) => r.host !== '')
      : [],
    stats: typeof s.stats === 'object' && s.stats !== null
      ? Object.fromEntries(Object.entries(s.stats).map(([host, v]: [string, any]) => [
          host,
          {
            waiting: Number(v?.waiting ?? 0),
            active: Number(v?.active ?? 0),
            passed: Number(v?.passed ?? 0),
            throttled: Number(v?.throttled ?? 0),
          },
        ]))
      : {},
  }
}

/** 草稿与服务端状态的差异判定（顺序无关的规范化对比）。 */
function sameRules(a: readonly RuleDraft[], b: readonly RuleDraft[]): boolean {
  const norm = (list: readonly RuleDraft[]) => list
    .map(r => [r.host.trim().toLowerCase(), r.maxRpm.trim(), r.maxConcurrency.trim()].join('|'))
    .filter(s => !s.startsWith('|'))
    .sort()
    .join('\n')
  return norm(a) === norm(b)
}

function ProviderThrottleCard(): JSX.Element {
  const [st, setSt] = useState<StateView>(EMPTY)
  const [rules, setRules] = useState<RuleDraft[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState<Note | null>(null)

  const refresh = useCallback(() => {
    fetch('/api/webui-provider-throttle/state', { cache: 'no-store' })
      .then(r => r.json())
      .then((payload) => {
        const view = toView(payload)
        setSt(view)
        setRules(view.rules)
      })
      .catch(() => { setSt(prev => ({ ...prev, loading: false })) })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const submit = useCallback(async (patch: { enabled?: boolean; rules?: RuleDraft[] }): Promise<void> => {
    setBusy('save')
    setNote(null)
    try {
      const body = {
        enabled: patch.enabled ?? st.enabled,
        rules: (patch.rules ?? rules).map(r => ({
          host: r.host.trim(),
          maxRpm: Number(r.maxRpm.trim()),
          maxConcurrency: Number(r.maxConcurrency.trim()),
        })).filter(r => r.host !== ''),
      }
      if (body.rules.some(r => !Number.isFinite(r.maxRpm) || !Number.isFinite(r.maxConcurrency) || r.maxRpm < 1 || r.maxConcurrency < 1)) {
        setNote({ kind: 'error', text: '每分钟上限与并发上限需为 ≥1 的数字' })
        return
      }
      const r = await fetch('/api/webui-provider-throttle/set', {
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
      setRules(view.rules)
      if (!view.enabled) setNote({ kind: 'ok', text: '已关闭：全部请求原样发出' })
      else if (view.rules.length === 0) setNote({ kind: 'error', text: '已开启但没有任何有效规则——请填写域名与限流参数' })
      else setNote({ kind: 'ok', text: '已生效：' + view.rules.map(x => `${x.host}（${x.maxRpm} 次/分 · 并发 ${x.maxConcurrency}）`).join('；') })
    } catch {
      setNote({ kind: 'error', text: '请求失败，DSH 服务可能未就绪' })
    } finally {
      setBusy('')
    }
  }, [st.enabled, rules])

  const busyAny = busy !== '' || st.loading
  const dirty = !sameRules(rules, st.rules)
  const anyStats = Object.keys(st.stats).length > 0

  const updateRule = (index: number, patch: Partial<RuleDraft>): void => {
    setRules(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  return (
    <div style={cardStyle}>
      <div style={headRowStyle}>
        <button
          type="button"
          style={{ ...copyStyle, border: 'none', background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer', padding: 0 }}
          onClick={() => { setOpen(!open) }}
          aria-expanded={open}
        >
          <span style={titleStyle}>供应商限流</span>
          <span style={descStyle}>
            对并发与短窗口 RPM 双重限流的供应商（如 B.AI），在请求发出前按域名限速 + 限并发，从源头避免 429；保存即生效
          </span>
        </button>
        <span style={tagStyle}>{!st.enabled ? '已关闭' : st.rules.length === 0 ? '无规则' : st.rules.length + ' 条规则'}</span>
        <button
          type="button"
          role="switch"
          aria-checked={st.enabled}
          aria-label="供应商限流开关"
          style={st.enabled ? switchOnStyle : switchStyle}
          onClick={() => { void submit({ enabled: !st.enabled }) }}
          disabled={busyAny}
        >
          <span style={st.enabled ? knobOnStyle : knobStyle} />
        </button>
      </div>

      {open
        ? (
            <div style={editorStyle}>
              {rules.length === 0
                ? <p style={noteStyle}>还没有规则——点「添加规则」填入供应商域名与限流参数</p>
                : null}
              {rules.map((rule, i) => (
                <div key={i} style={ruleCardStyle}>
                  <div style={fieldRow}>
                    <span style={{ ...fieldLabel, flex: 'none', width: 76 }}>域名</span>
                    <input
                      type="text"
                      style={inputStyle}
                      placeholder="api.b.ai 或 *.example.com"
                      value={rule.host}
                      onChange={(e) => { updateRule(i, { host: e.target.value }) }}
                    />
                    <button
                      type="button"
                      style={busyAny ? { ...smallBtnDanger, ...btnDisabled } : smallBtnDanger}
                      disabled={busyAny}
                      onClick={() => { setRules(prev => prev.filter((_, j) => j !== i)) }}
                    >
                      删除
                    </button>
                  </div>
                  <div style={fieldRow}>
                    <span style={{ ...fieldLabel, flex: 'none', width: 76 }}>每分钟上限</span>
                    <input
                      type="number"
                      min={1}
                      style={numStyle}
                      placeholder="20"
                      value={rule.maxRpm}
                      onChange={(e) => { updateRule(i, { maxRpm: e.target.value }) }}
                    />
                    <span style={{ ...fieldLabel, flex: 'none', width: 76 }}>并发上限</span>
                    <input
                      type="number"
                      min={1}
                      style={numStyle}
                      placeholder="2"
                      value={rule.maxConcurrency}
                      onChange={(e) => { updateRule(i, { maxConcurrency: e.target.value }) }}
                    />
                  </div>
                  {st.stats[rule.host.trim().toLowerCase()] !== undefined
                    ? (
                        <div style={statsRowStyle}>
                          实时：
                          <span style={{ color: 'var(--dsw-alias-label-primary)' }}>{st.stats[rule.host.trim().toLowerCase()].active}</span> 执行中 ·
                          <span style={{ color: 'var(--dsw-alias-label-primary)' }}>{st.stats[rule.host.trim().toLowerCase()].waiting}</span> 排队 ·
                          放行 <span style={{ color: 'var(--dsw-alias-label-primary)' }}>{st.stats[rule.host.trim().toLowerCase()].passed}</span> ·
                          限流 <span style={{ color: 'var(--dsw-alias-state-warn-primary)' }}>{st.stats[rule.host.trim().toLowerCase()].throttled}</span>
                        </div>
                      )
                    : null}
                </div>
              ))}

              <div style={fieldRow}>
                <button
                  type="button"
                  style={busyAny ? { ...smallBtn, ...btnDisabled } : smallBtn}
                  disabled={busyAny}
                  onClick={() => { setRules(prev => prev.concat([{ host: '', maxRpm: '20', maxConcurrency: '2' }])) }}
                >
                  添加规则
                </button>
                <button
                  type="button"
                  style={busyAny || (!dirty && st.enabled === st.active) ? { ...smallBtnPrimary, ...btnDisabled } : smallBtnPrimary}
                  disabled={busyAny || (!dirty && st.enabled === st.active)}
                  onClick={() => { void submit({}) }}
                >
                  {busy === 'save' ? '保存中…' : '保存'}
                </button>
              </div>

              {note !== null
                ? <p style={note.kind === 'ok' ? okNoteStyle : errNoteStyle} role="status">{note.text}</p>
                : (
                    <p style={noteStyle}>
                      命中域名的请求会先按「每分钟上限」的令牌桶限速、再按「并发上限」排队（FIFO），
                      排队超过 60 秒才直接返回 429（交给 DSH 的指数退避重试接管）。
                      建议 B.AI 用 20 次/分 · 并发 2（实测 3s 间隔单发 100% 成功）。
                      host 支持 *.example.com 通配子域；关闭时全部请求零开销原样发出。
                    </p>
                  )}
              {!anyStats && st.enabled && st.rules.length > 0
                ? <p style={noteStyle}>启用后将在有请求经过时显示实时计数。</p>
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
      id: 'provider-throttle',
      order: 47,
    }, ProviderThrottleCard))
}
