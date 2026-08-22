/**
 * webui — 对话「单条消息截图渲染」（host 半身）。
 *
 * 对齐 openhanako 的「单条消息截图」，但视觉按用户要求：白底、16:10 横向
 * 卡片、干净排版（无 AI 画风装饰），底部固定品牌栏（左 DeepSeek 鲸鱼 logo，
 * 右 "DeepSeek Harness"）。用独立无头 Edge/Chrome 固定 1280×800 视口截图。
 *
 * 数据流：消息上的截图按钮 → POST /api/webui-screenshot {role, text} →
 * host 渲染单条消息 HTML → 无头浏览器固定视口截图 → 保存 JPG → 返回路径/imageUrl。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  CdpConnection, captureScreenshot, createPageSession, evaluateJson,
  fetchBrowserWsUrl, navigateAndWait, setViewport,
} from './browser/cdp.js'
import {
  DEFAULT_CHROME_CANDIDATES, findFreePort, killChrome, launchChrome, resolveChromePath,
} from './browser/chrome.js'

interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

interface WebServerService {
  register(route: WebServerRoute): () => void
}

interface SessionStoreLike {
  get(id: string): { events?: readonly { type: string; data?: { title?: string } }[] } | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServerService
  }
}

// ── 常量 ────────────────────────────────────────────────────────────────────

const ROUTE_PATH = '/api/webui-screenshot'
/** 截图卡片尺寸（16:10）。 */
const PAGE_WIDTH = 1280
const PAGE_HEIGHT = 800
/** 单条消息文本过长时截断。 */
const MAX_TEXT_LEN = 80000

/** 截图输出目录。 */
function screenshotHome(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'storages', 'webui-screenshot')
}

/** 从会话事件日志折叠最新标题（last-wins session/title）。 */
function readTitle(sessionId: string, sessions: SessionStoreLike | undefined): string {
  const events = sessions?.get(sessionId)?.events ?? []
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type === 'session/title' && typeof event.data?.title === 'string') return event.data.title
  }
  return ''
}

// ── 轻量 Markdown 渲染（白底深字排版）───────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function inline(text: string): string {
  // 输入应为「已 HTML 转义」的文本；这里只做 markdown 语法 → HTML 标签转换。
  let out = text.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${code}</code>`)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
    `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return out
}

function renderMarkdown(md: string): string {
  const source = md.length > MAX_TEXT_LEN ? `${md.slice(0, MAX_TEXT_LEN)}\n\n…（内容过长已截断）` : md
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  let listStack: 'ul' | 'ol' | null = null
  let inTable = false
  let tableRows: string[][] = []

  const closeList = (): void => {
    if (listStack !== null) { html.push(`</${listStack}>`); listStack = null }
  }
  const closeTable = (): void => {
    if (inTable) {
      html.push('<div class="md-table"><table>')
      for (const [ri, row] of tableRows.entries()) {
        const tag = ri === 0 ? 'th' : 'td'
        html.push(`<tr>${row.map(cell => `<${tag}>${inline(cell.trim())}</${tag}>`).join('')}</tr>`)
      }
      html.push('</table></div>')
      inTable = false
      tableRows = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (trimmed.startsWith('|')) {
      const cells = trimmed.replace(/^\||\|$/g, '').split('|')
      const isSep = cells.every(c => /^:?-{2,}:?$/.test(c.trim()))
      if (isSep && tableRows.length === 1) { i += 1; continue }
      closeList()
      if (!inTable) { inTable = true; tableRows = [] }
      tableRows.push(cells.map(escapeHtml))
      i += 1
      continue
    }
    closeTable()

    if (trimmed.startsWith('```')) {
      closeList()
      const lang = trimmed.slice(3).trim()
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) { buf.push(lines[i]!); i += 1 }
      i += 1
      html.push(`<pre>${lang !== '' ? `<div class="code-lang">${escapeHtml(lang)}</div>` : ''}<code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading !== null) {
      closeList()
      const level = heading[1]!.length
      html.push(`<h${level}>${inline(escapeHtml(heading[2]!))}</h${level}>`)
      i += 1
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList()
      html.push('<hr>')
      i += 1
      continue
    }

    if (trimmed.startsWith('&gt;') || trimmed.startsWith('>')) {
      closeList()
      html.push(`<blockquote>${inline(escapeHtml(trimmed.replace(/^&?gt;?\s*/, '')))}</blockquote>`)
      i += 1
      continue
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      closeTable()
      if (listStack !== 'ul') { closeList(); html.push('<ul>'); listStack = 'ul' }
      html.push(`<li>${inline(escapeHtml(trimmed.replace(/^[-*+]\s+/, '')))}</li>`)
      i += 1
      continue
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (ol !== null) {
      closeTable()
      if (listStack !== 'ol') { closeList(); html.push('<ol>'); listStack = 'ol' }
      html.push(`<li>${inline(escapeHtml(ol[1]!))}</li>`)
      i += 1
      continue
    }

    if (trimmed === '') { closeList(); i += 1; continue }

    closeList()
    html.push(`<p>${inline(escapeHtml(trimmed))}</p>`)
    i += 1
  }
  closeList()
  closeTable()
  return html.join('\n')
}

// ── DeepSeek 鲸鱼 logo（FishLogo 的 path，供底部品牌栏）─────────────────────

const FISH_LOGO_PATH = 'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z'

// ── 白底 16:10 卡片主题 ──────────────────────────────────────────────────────

const THEME_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html{font-size:16px}
body{background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,sans-serif;color:#24292f;-webkit-font-smoothing:antialiased}
.card{width:${PAGE_WIDTH}px;min-height:${PAGE_HEIGHT}px;background:#ffffff;display:flex;flex-direction:column}
.head{display:flex;flex-direction:column;gap:12px;padding:36px 72px 0}
.head-top{display:flex;align-items:center;justify-content:space-between}
.head-brand{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:#111}
.head-date{font-size:13px;color:#9aa0a6}
.head-title{font-size:24px;font-weight:700;color:#111;line-height:1.35}
.content{flex:1;padding:30px 72px 24px;font-size:20px;line-height:1.85;color:#24292f}
.content p{margin:0 0 .95em}
.content p:last-child{margin-bottom:0}
.content h1,.content h2,.content h3,.content h4,.content h5,.content h6{color:#111;font-weight:650;margin:1.15em 0 .55em;line-height:1.4}
.content h1{font-size:1.7em;border-bottom:1px solid #eaecef;padding-bottom:.3em;margin-top:0}
.content h2{font-size:1.4em}.content h3{font-size:1.2em}.content h4{font-size:1.08em}
.content a{color:#2563eb;text-decoration:none;border-bottom:1px solid rgba(37,99,235,.3)}
.content code{font-family:"SF Mono","JetBrains Mono",Consolas,monospace;font-size:.85em;background:#f3f4f6;padding:.14em .4em;border-radius:4px;color:#c7254e}
.content pre{background:#f6f8fa;border:1px solid #eaecef;border-radius:8px;padding:14px 18px;overflow:hidden;margin:1em 0;line-height:1.6}
.content pre code{background:none;padding:0;color:#24292f;font-size:.8em}
.code-lang{font-size:.68rem;color:#8b949e;margin-bottom:.5em;text-transform:uppercase;letter-spacing:.06em}
.content blockquote{border-left:4px solid #d0d7de;margin:1em 0;padding:.5em 1.2em;color:#57606a;background:#f6f8fa;border-radius:0 6px 6px 0}
.content blockquote p:last-child{margin-bottom:0}
.content ul,.content ol{margin:.6em 0 .95em;padding-left:1.9em}
.content li{margin:.3em 0}
.content li>ul,.content li>ol{margin-top:.3em;margin-bottom:0}
.md-table{max-width:100%;margin:1em 0;overflow:hidden}
.content table{border-collapse:collapse;width:100%;font-size:.9em}
.content th,.content td{border:1px solid #d0d7de;padding:.55em .9em;text-align:left;overflow-wrap:anywhere}
.content th{background:#f6f8fa;font-weight:600}
.content hr{border:none;border-top:1px solid #eaecef;margin:1.4em 0}
.content strong{font-weight:650}
.foot{display:flex;align-items:center;justify-content:center;gap:8px;padding:20px 72px 24px;border-top:1px solid #eef0f2}
.foot .brand-left{display:flex;align-items:center;color:#111}
.foot .brand-right{font-size:14px;color:#8b949e;letter-spacing:.02em;font-weight:500}
`

function renderMessageHtml(role: 'user' | 'assistant', text: string, title: string): string {
  const isUser = role === 'user'
  const body = isUser
    ? escapeHtml(text).replace(/\n/g, '<br>')
    : renderMarkdown(text)
  const roleLabel = isUser ? '我' : 'AI 回复'
  const heading = title.trim() !== '' ? escapeHtml(title.trim()) : roleLabel
  const now = new Date()
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const logo22 = `<svg width="22" height="16" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path d="${FISH_LOGO_PATH}" fill="currentColor"/></svg>`
  const logo26 = `<svg width="26" height="19" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path d="${FISH_LOGO_PATH}" fill="currentColor"/></svg>`
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=${PAGE_WIDTH}"><style>${THEME_CSS}</style></head>
<body><div class="card">
<header class="head">
  <div class="head-top"><span class="head-brand">${logo22} DeepSeek Harness</span><span class="head-date">${stamp}</span></div>
  <div class="head-title">${heading}</div>
</header>
<main class="content">${body}</main>
<footer class="foot"><span class="brand-left">${logo26}</span><span class="brand-right">DeepSeek Harness</span></footer>
</div></body></html>`
}

// ── 无头浏览器固定视口截图 ──────────────────────────────────────────────────

/** 用独立无头浏览器把 HTML 渲染为截图（2x DPR + PNG 无损，文字清晰）。短内容保持 16:10，长内容自动扩展为长图截全。 */
async function captureHtml(html: string): Promise<string> {
  const chromePath = resolveChromePath(DEFAULT_CHROME_CANDIDATES)
  const port = await findFreePort(9222)
  const tmpDir = join(screenshotHome(), '.tmp', `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(tmpDir, { recursive: true })
  const runtime = launchChrome(chromePath, tmpDir, port, ['--headless=new', '--disable-gpu'])
  let conn: CdpConnection | null = null
  try {
    const wsUrl = await fetchBrowserWsUrl(port, 15000)
    conn = new CdpConnection(wsUrl)
    await conn.connect(10000)
    const session = await createPageSession(conn, 'about:blank')
    const htmlFile = join(tmpDir, 'shot.html')
    await writeFile(htmlFile, html, 'utf8')
    await navigateAndWait(session, `file:///${htmlFile.replaceAll('\\', '/')}`, 15000)
    // 先按 16:10 视口排版（2x DPR）。
    await setViewport(session, PAGE_WIDTH, PAGE_HEIGHT, 2)
    // 测量内容实际高度；超过 16:10 时扩展视口（长图截全），二次测量修正重排。
    let cssHeight = PAGE_HEIGHT
    for (let round = 0; round < 2; round += 1) {
      const measured = await evaluateJson(
        session,
        'Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)',
        false,
      )
      const next = Math.min(Math.max(Math.round(Number(measured)) || PAGE_HEIGHT, PAGE_HEIGHT), 24000)
      if (next === cssHeight) break
      cssHeight = next
      await setViewport(session, PAGE_WIDTH, cssHeight, 2)
    }
    const base64 = await captureScreenshot(session, 92, 'png')
    return base64
  } finally {
    if (conn !== null) { try { conn.close() } catch { /* 忽略 */ } }
    killChrome(runtime, true)
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ── HTTP 管线 ────────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolvePromise({}); return }
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

async function handle(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: '仅支持 POST' })
    return
  }
  let body: Record<string, unknown>
  try {
    body = await readBody(req)
  } catch (error) {
    json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    return
  }
  const role = body.role === 'user' || body.role === 'assistant' ? body.role : ''
  const text = typeof body.text === 'string' ? body.text : ''
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (role === '' || text.trim() === '') {
    json(res, 400, { ok: false, error: 'role 或 text 无效' })
    return
  }
  try {
    // 标题权威取自会话事件日志（session/title 最后一条），避免 client 端 projection 不一致。
    const sessions = ctx.get('sessions') as SessionStoreLike | undefined
    const title = readTitle(sessionId, sessions)
    const html = renderMessageHtml(role, text, title)
    const base64 = await captureHtml(html)
    const outDir = screenshotHome()
    await mkdir(outDir, { recursive: true })
    const file = join(outDir, `message-${Date.now()}.png`)
    await writeFile(file, Buffer.from(base64, 'base64'))
    json(res, 200, {
      ok: true,
      path: file,
      imageUrl: `/api/webui-screenshot/image?file=${encodeURIComponent(basename(file))}`,
    })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

// ── 插件体 ──────────────────────────────────────────────────────────────────

/** 挂载单条消息截图路由（POST /api/webui-screenshot + GET 图片回读）。 */
export function applyScreenshot(ctx: Context): void {
  const webServer = ctx.get('webServer') as WebServerService | undefined
  if (webServer === undefined) return
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req, res) => { void handle(ctx, req, res) },
  }), 'webui: screenshot route')
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: `${ROUTE_PATH}/image`,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const file = url.searchParams.get('file') ?? ''
        const base = basename(file)
        if (base !== file || base === '') { json(res, 400, { ok: false, error: 'invalid file' }); return }
        const filePath = join(screenshotHome(), base)
        if (!existsSync(filePath)) { json(res, 404, { ok: false, error: 'no such screenshot' }); return }
        const data = await readFile(filePath)
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
        res.end(data)
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'webui: screenshot image route')
}
