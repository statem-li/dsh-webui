/**
 * 邮箱验证码设置卡（settings.plugin.item，key = `webui-mail`）。
 *
 * 视觉沿用内置插件卡（复用 AnySearchCard 注入的 `ase-*` 卡片样式），保存按钮
 * 用内置 `.ase-save` 反色模式（label-primary 底 + bg 层文字），深浅色都高对比。
 * 邮箱写 settings；安全码走凭据域（MAIL_IMAP_AUTH_CODE）；「测试连接」与
 * 「查看邮箱」走 host 的 /api/webui-mail 路由。日期在展示层格式化为相对/绝对时间。
 */
import { useEffect, useRef, useState } from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionHandle, IApiClient } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: 拉入 settings 槽位契约（ctx.settingsScope）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ensureCardStyles } from '../AnySearchCard'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 插件配置区里的一张插件卡，按 settings 命名空间做 key。 */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root' }
  }
}

/** 卡片编辑的命名空间；与 host 端 settingsNamespace('webui-mail') 保持一致。 */
export const NS = 'webui-mail'
/** 安全码凭据引用名；与 host 端保持一致。 */
export const DEFAULT_AUTH_CODE_REF = 'MAIL_IMAP_AUTH_CODE'

interface MailSettings {
  email?: string
}

interface MailMessage {
  uid: string | null
  from: string
  subject: string
  date: string
  text: string
  codes: string[]
}

// ── 弹窗样式（卡片 chrome 复用 ase-*，这里只补邮件弹窗/验证码徽章）──────────

const POPUP_STYLES = `
.mail-popup-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;}
.mail-popup-modal{width:min(760px,94vw);max-height:82vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;}
.mail-popup-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.mail-popup-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);}
.mail-popup-actions{display:flex;gap:8px;}
.mail-popup-body{overflow:auto;padding:12px 16px;}
.mail-mail{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-1);}
.mail-mail-head{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);}
.mail-from{font-weight:600;color:var(--dsw-alias-label-primary);}
.mail-subject{margin-top:4px;font-size:13px;color:var(--dsw-alias-label-primary);}
.mail-codes{margin-top:6px;font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.mail-code{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);border-radius:5px;padding:2px 8px;font-weight:700;font-size:14px;letter-spacing:1px;}
.mail-text{margin-top:6px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:120px;overflow:auto;}
.mail-note{color:var(--dsw-alias-label-tertiary);font-size:12px;}
.mail-empty{padding:20px 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;}
`

let popupStylesInjected = false

function ensurePopupStyles(): void {
  if (typeof document === 'undefined' || popupStylesInjected) return
  const style = document.createElement('style')
  style.id = 'dsh-webui-mail-styles'
  style.textContent = POPUP_STYLES
  document.head.appendChild(style)
  popupStylesInjected = true
}

function clsx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ── 时间格式化 ──────────────────────────────────────────────────────────────

/** 把 IMAP Date 头格式化成相对时间（24h 内）或 `YYYY-MM-DD HH:mm`。 */
function formatDate(raw: string): string {
  if (raw === '') return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const diff = Date.now() - d.getTime()
  if (diff >= 0 && diff < 60_000) return '刚刚'
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${ymd} ${hm}`
}

// ── host API ────────────────────────────────────────────────────────────────

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/webui-mail${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `请求失败 (${String(response.status)})`)
  return data
}

// ── 卡片视图 ────────────────────────────────────────────────────────────────

interface MailCardViewProps {
  scope: SettingsScope<MailSettings>
  api: Pick<IApiClient, 'credentials'>
}

function MailCardView(props: MailCardViewProps): React.ReactElement | null {
  const { scope, api } = props
  const [open, setOpen] = useState(false)
  const [emailDraft, setEmailDraft] = useState('')
  const [codeDraft, setCodeDraft] = useState('')
  const [codeConfigured, setCodeConfigured] = useState(false)
  const [available, setAvailable] = useState(false)
  const [writable, setWritable] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState('')
  const [popup, setPopup] = useState(false)
  const [mails, setMails] = useState<MailMessage[]>([])

  const seededEmail = useRef(false)
  const [snap, setSnap] = useState(() => scope.getSnapshot())

  useEffect(() => scope.subscribe(() => { setSnap(scope.getSnapshot()) }), [scope])

  useEffect(() => {
    setAvailable(snap.status === 'ready')
    setWritable(snap.writable)
    // 就绪后只回填一次已保存邮箱；之后用户的编辑不被快照覆盖。
    if (!seededEmail.current && snap.status === 'ready') {
      seededEmail.current = true
      setEmailDraft((snap.value as MailSettings | undefined)?.email ?? '')
    }
  }, [snap])

  useEffect(() => {
    void api.credentials.describe({ refs: [DEFAULT_AUTH_CODE_REF] }).then((r) => {
      if (r.result.ok) setCodeConfigured(r.result.value.credentials[DEFAULT_AUTH_CODE_REF]?.configured ?? false)
    }).catch(() => { /* ignore */ })
  }, [api])

  async function save(): Promise<void> {
    setBusy(true); setNote(''); setError('')
    try {
      const email = emailDraft.trim()
      if (email === '') throw new Error('邮箱账号不能为空')
      const code = codeDraft.trim()
      if (code === '' && !codeConfigured) throw new Error('请填写安全码（尚未配置过）')
      if (code !== '') {
        await api.credentials.set({ ref: DEFAULT_AUTH_CODE_REF, value: code })
        // 重新 describe 验证写入真的落库，避免静默失败却提示成功。
        const check = await api.credentials.describe({ refs: [DEFAULT_AUTH_CODE_REF] })
        const configured = check.result.ok
          && check.result.value.credentials[DEFAULT_AUTH_CODE_REF]?.configured === true
        if (!configured) throw new Error('安全码保存失败：凭据域未接受写入')
        setCodeConfigured(true)
      }
      await scope.set('email', email)
      setCodeDraft('')
      setNote('已保存绑定')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function testConn(): Promise<void> {
    setBusy(true); setNote(''); setError(''); setTestResult('')
    try {
      // 输入框为空时 host 端自动回退到已保存的邮箱 + 凭据域安全码。
      const r = await postJson<{ ok: boolean; exists: number | null; uidNext: number | null }>('/test', { email: emailDraft.trim(), authCode: codeDraft.trim() })
      setTestResult(`连接成功：收件箱共 ${r.exists ?? '?'} 封邮件（UIDNEXT ${r.uidNext ?? '?'}）`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function fetchMails(): Promise<void> {
    setBusy(true); setError('')
    try {
      // 输入框为空时 host 端自动回退到已保存的邮箱 + 凭据域安全码。
      const r = await postJson<{ ok: boolean; messages: MailMessage[] }>('/fetch', { email: emailDraft.trim(), authCode: codeDraft.trim(), limit: 10 })
      setMails(r.messages ?? [])
      setPopup(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!available) return null

  const title = '邮箱验证码'
  return (
    <li className={clsx('ase-card', open && 'ase-cardOpen')}>
      <button
        type="button"
        className="ase-header"
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className="ase-headText">
          <span className="ase-name">{title}</span>
          <span className="ase-description">用 QQ 邮箱安全码读信，自动提取验证码/动态码</span>
        </span>
        <IconChevronDownOutline14 className={clsx('ase-chevron', open && 'ase-chevronOpen')} />
      </button>
      {open
        ? (
          <div className="ase-body">
            {!writable ? <p className="ase-readOnly" role="status">当前设置文档为只读</p> : null}
            <div className="ase-field">
              <div className="ase-head">
                <label className="ase-label" htmlFor="plugin-config-mail-email">邮箱账号</label>
              </div>
              <input
                id="plugin-config-mail-email"
                className="ase-input"
                type="text"
                value={emailDraft}
                placeholder="name@qq.com"
                disabled={!writable || busy}
                onChange={(event) => { setEmailDraft(event.target.value) }}
              />
              <p className="ase-hint">QQ 邮箱完整地址</p>
            </div>
            <div className="ase-field">
              <div className="ase-head">
                <label className="ase-label" htmlFor="plugin-config-mail-code">安全码</label>
                <span className="ase-badges">
                  <span className={codeConfigured ? 'ase-badge' : 'ase-badgeMuted'}>
                    {codeConfigured ? '已配置' : '未配置'}
                  </span>
                </span>
              </div>
              <input
                id="plugin-config-mail-code"
                className="ase-input"
                type="password"
                autoComplete="off"
                value={codeDraft}
                disabled={!writable || busy}
                onChange={(event) => { setCodeDraft(event.target.value) }}
              />
              <p className="ase-hint">{codeConfigured ? '已配置，输入新安全码以更换' : 'QQ 邮箱 IMAP 授权码（QQ 邮箱 → 设置 → 账户 → 生成授权码）'}</p>
            </div>
            {error !== '' ? <p className="ase-invalid">{error}</p> : null}
            {note !== '' ? <p className="mail-note">{note}</p> : null}
            {testResult !== '' ? <p className="mail-note">{testResult}</p> : null}
            <div className="ase-footer">
              <button type="button" className="ase-save" disabled={busy || emailDraft.trim() === ''} onClick={() => { void save() }}>
                {busy ? '处理中…' : '保存绑定'}
              </button>
              <button type="button" className="ase-discard" disabled={busy} onClick={() => { void testConn() }}>
                测试连接
              </button>
              <button type="button" className="ase-discard" disabled={busy} onClick={() => { void fetchMails() }}>
                查看邮箱
              </button>
            </div>
          </div>
        )
        : null}

      {popup
        ? (
          <div className="mail-popup-overlay" onClick={() => { setPopup(false) }}>
            <div className="mail-popup-modal" onClick={(event) => { event.stopPropagation() }}>
              <div className="mail-popup-head">
                <span className="mail-popup-title">收件箱（最近 {mails.length} 封）</span>
                <div className="mail-popup-actions">
                  <button type="button" className="ase-discard" disabled={busy} onClick={() => { void fetchMails() }}>刷新</button>
                  <button type="button" className="ase-save" onClick={() => { setPopup(false) }}>关闭</button>
                </div>
              </div>
              <div className="mail-popup-body">
                {mails.length === 0 ? <div className="mail-empty">没有邮件</div> : null}
                {mails.map((m) => (
                  <div className="mail-mail" key={m.uid ?? `${m.date}-${m.subject}`}>
                    <div className="mail-mail-head">
                      <span className="mail-from">{m.from}</span>
                      <span>{formatDate(m.date)}</span>
                    </div>
                    <div className="mail-subject">{m.subject}</div>
                    {m.codes.length > 0
                      ? (
                        <div className="mail-codes">
                          <span>验证码: </span>
                          {m.codes.map((c) => <span className="mail-code" key={c}>{c}</span>)}
                        </div>
                      )
                      : null}
                    <div className="mail-text">{m.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
        : null}
    </li>
  )
}

/** 把邮箱验证码卡注册进插件配置区（webui client 入口调用）。 */
export function registerMailCard(ctx: ClientContext): void {
  ensureCardStyles()
  ensurePopupStyles()
  const handle = ctx.get('connection') as ConnectionHandle | undefined
  if (handle === undefined) return
  const scope = ctx.settingsScope.bind({ namespace: NS }) as SettingsScope<MailSettings>
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    // keyed 槽：key 必须是卡片编辑的 settings 命名空间，配置页才能配对显示。
    key: NS,
  }, () => <MailCardView scope={scope} api={handle.api} /> as never))
}
