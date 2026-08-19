/**
 * webui — 邮箱验证码（自 dsh-mail 合并）。
 *
 * 用 QQ 邮箱 IMAP 授权码（安全码）读信：注册 `mail_get_code` 模型工具 + 设置卡
 * 的后端（/api/webui-mail 的 test/fetch 路由）。邮箱存 settings（`webui-mail`
 * 命名空间），安全码走凭据域（`MAIL_IMAP_AUTH_CODE`），都不写死进源码。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { fetchRecentMails, testImapLogin, DEFAULT_IMAP_HOST, DEFAULT_IMAP_PORT } from './mail/imap.js'

export const MAIL_SETTINGS_NAMESPACE = settingsNamespace('webui-mail')
export const DEFAULT_AUTH_CODE_REF = 'MAIL_IMAP_AUTH_CODE'

/** 邮箱验证码插件配置（全部可选）。 */
export interface MailConfig {
  /** 邮箱账号（如 name@qq.com），存 settings。 */
  email?: string
}

const MailConfigSchema: z<MailConfig> = z.object({
  email: z.string(),
})

// ── 最小服务契约（沿用 file-explorer 的做法，避免 dsh 类型依赖链）──────────

interface WebServerRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServerLike {
  register(route: WebServerRouteLike): () => void
}

// ── 凭据解析 ────────────────────────────────────────────────────────────────

async function resolveMailCredentials(ctx: Context, cfg: MailConfig): Promise<{ email: string; authCode: string }> {
  const email = (cfg.email ?? '').trim()
  let authCode = ''
  const credentials = ctx.get('credentials') as CredentialProvider | undefined
  if (credentials !== undefined) {
    const resolved = await credentials.resolve(credentialRef(DEFAULT_AUTH_CODE_REF))
    authCode = resolved?.value ?? ''
  }
  return { email, authCode }
}

// ── HTTP 管线 ───────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(JSON.stringify(value))
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    throw new Error('invalid JSON body')
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function loopbackAllowed(req: IncomingMessage): boolean {
  return isLoopbackAddress(req.socket.remoteAddress)
}

function bodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

function bodyLimit(body: Record<string, unknown>): number {
  const value = body['limit']
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 20) : 8
}

// ── 路由 ────────────────────────────────────────────────────────────────────

async function handle(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { ok: false, error: 'loopback-only' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const rest = url.pathname.slice('/api/webui-mail'.length)
  const method = req.method ?? 'GET'
  try {
    if (method !== 'POST') {
      json(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const body = await readJsonBody(req)
    const email = bodyString(body, 'email')
    const authCode = bodyString(body, 'authCode')
    if (email === '' || authCode === '') {
      json(res, 400, { ok: false, error: '邮箱与安全码不能为空' })
      return
    }
    const opts = { host: DEFAULT_IMAP_HOST, port: DEFAULT_IMAP_PORT, user: email, pass: authCode }
    if (rest === '/test') {
      json(res, 200, await testImapLogin(opts))
      return
    }
    if (rest === '/fetch') {
      const messages = await fetchRecentMails(opts, bodyLimit(body))
      let latestCode: string | null = null
      for (const m of messages) {
        if (m.codes.length > 0) { latestCode = m.codes[0]!; break }
      }
      json(res, 200, { ok: true, count: messages.length, latestCode, messages })
      return
    }
    json(res, 404, { ok: false, error: `no route for ${method} ${rest}` })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

// ── 插件体 ──────────────────────────────────────────────────────────────────

/** 注册 mail_get_code 工具 + /api/webui-mail 路由（webui 组合调用）。 */
export function applyMail(ctx: Context, config: MailConfig = {}): void {
  let current: () => MailConfig = () => config
  installSettingsSection(ctx, MAIL_SETTINGS_NAMESPACE, MailConfigSchema, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
  })

  ctx.tools.register(defineTool({
    name: 'mail_get_code',
    description: '从已绑定的 QQ 邮箱读取最近的邮件并提取验证码/校验码/动态码。当你需要邮箱收到的验证码、一次性密码或登录校验码时调用此工具。',
    parameters: {
      limit: { type: 'integer', description: '读取最近多少封邮件，默认 8，最大 20' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value: { ok: boolean; error?: string; email?: string; count?: number; latestCode?: string | null; messages?: Array<{ date: string; from: string; subject: string; codes: string[] }> }) => {
        if (value.ok !== true) {
          return [{ type: 'text', text: value.error ?? '邮件读取失败' }]
        }
        const lines = [`邮箱 ${value.email ?? ''} 最近 ${value.count ?? 0} 封邮件`]
        if (value.latestCode) lines.push(`最新验证码: ${value.latestCode}`)
        for (const m of value.messages ?? []) {
          lines.push(`- [${m.date}] ${m.from} | ${m.subject} | 验证码: ${m.codes.length > 0 ? m.codes.join(', ') : '无'}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: { limit?: number }) {
      const fail = (error: string) => ({ ok: false, error, email: '', count: 0, latestCode: null, messages: [] })
      try {
        const { email, authCode } = await resolveMailCredentials(ctx, current())
        if (email === '' || authCode === '') {
          return fail('未配置邮箱或安全码：请在 设置 → 插件 → 邮箱验证码 中绑定后再试')
        }
        const n = Math.min(Math.max(1, typeof args.limit === 'number' ? args.limit : 8), 20)
        const messages = await fetchRecentMails({ host: DEFAULT_IMAP_HOST, port: DEFAULT_IMAP_PORT, user: email, pass: authCode }, n)
        let latestCode: string | null = null
        for (const m of messages) {
          if (m.codes.length > 0) { latestCode = m.codes[0]!; break }
        }
        return { ok: true, email, count: messages.length, latestCode, messages }
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }
    },
    presentCall: () => ({ card: 'generic', title: '读取邮箱验证码', kind: 'other', rawInput: null }),
  }))

  const webServer = ctx.get('webServer') as WebServerLike | undefined
  if (webServer === undefined) return
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/api/webui-mail',
    handler: (req, res) => { void handle(ctx, req, res) },
  }), 'webui: mail routes')
}
