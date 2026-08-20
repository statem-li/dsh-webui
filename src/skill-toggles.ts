/**
 * 技能开关(skill-toggles):挂 /api/skill-toggles 路由,读写技能 SKILL.md 的
 * frontmatter 开关字段,实现「每个技能禁用/开启 + 每个技能包一键开关」。
 *
 * 开关真正生效的机制:DSH 内核 skill-filesystem 解析每个技能目录 SKILL.md 的
 * frontmatter —— `user-invocable: false` 使技能对用户侧(/ 菜单、/name 手势)
 * 不可调用,`disable-model-invocation: true` 使技能对模型侧(模型目录、skill
 * 工具)不可调用。修改文件后内核 watcher 会自动重扫,无需重启。
 *
 * 本模块只读写技能文件本身,不动 DSH 源码;数据面与技能管理面板
 * (/api/skill-manager)同一批技能目录(managedRoot + dshRoot)。
 *
 * Routes (all under /api/skill-toggles):
 *   PUT  /skills/:name      { enabled } → 开/关单个技能
 *   PUT  /bundles/:id       { enabled } → 开/关一个技能包(内全部技能)
 *   GET  /status            → { skills: {name: enabled}, bundles: {id: enabled} }
 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { URL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name fragment (merged into webui host apply). */
export const name = 'skill-toggles'

/** Minimal webServer service view (same contract as skill-manager). */
declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: {
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => void
      }): () => void
    }
  }
}

/** Services required before this plugin activates. */
export const inject = ['webServer']

const SKILL_FILE = 'SKILL.md'
const BUNDLES_FILE = '.bundles.json'
const ROUTE_PREFIX = '/api/skill-toggles'
const MAX_BODY_BYTES = 256 * 1024

/** The writable user-agents skill root (honors $DSH_AGENTS_HOME). */
function managedRoot(): string {
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
  return join(agentsHome, 'skills')
}

/** The user-dsh skill root (honors $DSH_HOME). */
function dshRoot(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'skills')
}

/** Serialized bundle ledger (mirrors skill-manager's shape). */
interface BundlesFile {
  version: 1
  bundles: BundleRecord[]
}

interface BundleRecord {
  id: string
  name: string
  skills: string[]
}

/** Read the bundle ledger; missing/corrupt files start empty. */
async function readBundles(root: string): Promise<BundlesFile> {
  try {
    const parsed = JSON.parse(await readFile(join(root, BUNDLES_FILE), 'utf8')) as unknown
    if (
      typeof parsed === 'object' && parsed !== null
      && (parsed as Record<string, unknown>).version === 1
      && Array.isArray((parsed as Record<string, unknown>).bundles)
    ) {
      return parsed as BundlesFile
    }
  } catch {
    // Missing or unreadable ledger: treat as empty.
  }
  return { version: 1, bundles: [] }
}

/** Locate a skill directory under a root; undefined when absent. */
async function skillDirUnder(root: string, skillName: string): Promise<string | undefined> {
  try {
    const info = await import('node:fs/promises').then(fs => fs.stat(join(root, skillName)))
    if (info.isDirectory()) return join(root, skillName)
  } catch {
    // fallthrough
  }
  return undefined
}

/** Locate a skill directory across both roots (managed first, then dsh). */
async function locateSkillDir(skillName: string): Promise<string | undefined> {
  return await skillDirUnder(managedRoot(), skillName)
    ?? await skillDirUnder(dshRoot(), skillName)
}

/** Read a skill's SKILL.md raw text; undefined when missing. */
async function readSkillFile(skillName: string): Promise<{ dir: string; raw: string } | undefined> {
  const dir = await locateSkillDir(skillName)
  if (dir === undefined) return undefined
  try {
    return { dir, raw: await readFile(join(dir, SKILL_FILE), 'utf8') }
  } catch {
    return undefined
  }
}

/**
 * 解析 frontmatter 块,返回 { block: 原始块文本(含 --- 围栏,无则 undefined),
 * body: 去掉 frontmatter 后的正文, fields: {key: value} }。
 * 仅解析顶层 `key: value` 行;块外内容原样保留。
 */
function splitFrontmatter(raw: string): {
  hasFence: boolean
  fields: Array<{ key: string; value: string }>
  body: string
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (match === null) {
    return { hasFence: false, fields: [], body: raw }
  }
  const block = match[1]!
  const fields: Array<{ key: string; value: string }> = []
  for (const line of block.split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (pair !== null) fields.push({ key: pair[1]!, value: pair[2]!.trim() })
  }
  return { hasFence: true, fields, body: raw.slice(match[0].length) }
}

/**
 * 更新 SKILL.md:设置/移除开关字段,保留其它 frontmatter 字段与正文原样。
 * 禁用 = user-invocable: false + disable-model-invocation: true;
 * 启用 = 两者移除(缺省即允许)。
 */
function applyToggle(raw: string, enabled: boolean): string {
  const parsed = splitFrontmatter(raw)
  const toggleKeys = new Set(['user-invocable', 'disable-model-invocation'])
  const kept = parsed.fields.filter(field => !toggleKeys.has(field.key))
  const lines = kept.map(field => `${field.key}: ${field.value}`)
  if (!enabled) {
    lines.push('user-invocable: false')
    lines.push('disable-model-invocation: true')
  }
  const block = lines.join('\n')
  if (parsed.hasFence) {
    return `---\n${block}\n---\n${parsed.body}`
  }
  // 无 frontmatter 时创建;正文若以空行开头则保留一个空行分隔。
  const body = parsed.body.startsWith('\n') ? parsed.body.slice(1) : parsed.body
  return `---\n${block}\n---\n${body}`
}

/** 读技能当前开关状态(true = 启用)。 */
function parseEnabled(fields: Array<{ key: string; value: string }>): boolean {
  const userInvocable = fields.find(field => field.key === 'user-invocable')?.value
  const disableModel = fields.find(field => field.key === 'disable-model-invocation')?.value
  const userDisabled = userInvocable?.toLowerCase() === 'false'
  const modelDisabled = disableModel?.toLowerCase() === 'true'
  return !(userDisabled || modelDisabled)
}

/** 设置单个技能开关。 */
async function setSkillEnabled(skillName: string, enabled: boolean): Promise<boolean> {
  const found = await readSkillFile(skillName)
  if (found === undefined) return false
  const updated = applyToggle(found.raw, enabled)
  if (updated === found.raw) return true
  const target = join(found.dir, SKILL_FILE)
  const temp = `${target}.toggle.tmp`
  await mkdir(found.dir, { recursive: true })
  await writeFile(temp, updated, 'utf8')
  await rename(temp, target)
  return true
}

/** 设置一个技能包内全部技能开关;返回处理数。 */
async function setBundleEnabled(bundleId: string, enabled: boolean): Promise<number> {
  const root = managedRoot()
  const ledger = await readBundles(root)
  const record = ledger.bundles.find(bundle => bundle.id === bundleId)
  if (record === undefined) return -1
  let handled = 0
  for (const skillName of record.skills) {
    if (await setSkillEnabled(skillName, enabled)) handled += 1
  }
  return handled
}

/** 全量状态:每个技能与每个技能包的启用状态。 */
async function status(): Promise<{ skills: Record<string, boolean>; bundles: Record<string, boolean> }> {
  const skills: Record<string, boolean> = {}
  const seen = new Set<string>()
  for (const root of [managedRoot(), dshRoot()]) {
    let entries: string[] = []
    try {
      entries = (await readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    } catch {
      continue
    }
    for (const dir of entries) {
      if (seen.has(dir)) continue
      seen.add(dir)
      try {
        const raw = await readFile(join(root, dir, SKILL_FILE), 'utf8')
        const fields = splitFrontmatter(raw).fields
        const nameField = fields.find(field => field.key === 'name')?.value
        const name = nameField !== undefined && nameField !== '' ? nameField : dir
        skills[name] = parseEnabled(fields)
      } catch {
        // 非技能目录或不可读:跳过。
      }
    }
  }
  const bundles: Record<string, boolean> = {}
  const ledger = await readBundles(managedRoot())
  for (const record of ledger.bundles) {
    const states = record.skills.map(skillName => skills[skillName])
    bundles[record.id] = states.length === 0 || states.every(state => state !== false)
  }
  return { skills, bundles }
}

/** ── HTTP plumbing (same contract as skill-manager) ─────────────────────── */

function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function hostNameOf(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close <= 1) return null
    const suffix = host.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return host.slice(1, close)
  }
  const firstColon = host.indexOf(':')
  const lastColon = host.lastIndexOf(':')
  if (firstColon !== lastColon) return null
  return firstColon === -1 ? host : host.slice(0, firstColon)
}

function loopbackAllowed(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = hostNameOf(req.headers.host)
  if (host === null) return false
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolvePromise({})
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** Route dispatch for one /api/skill-toggles request. */
async function handle(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { error: 'loopback-only' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const rest = url.pathname.slice(ROUTE_PREFIX.length)
  const method = req.method ?? 'GET'
  try {
    if (method === 'GET' && (rest === '' || rest === '/status')) {
      json(res, 200, await status())
      return
    }
    const matchSkill = /^\/skills\/([^/]+)$/.exec(rest)
    if (method === 'PUT' && matchSkill !== null) {
      const body = (await readBody(req)) as Record<string, unknown>
      const enabled = body.enabled
      if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
      const name = decodeURIComponent(matchSkill[1]!)
      const ok = await setSkillEnabled(name, enabled)
      if (!ok) throw new Error(`skill ${JSON.stringify(name)} not found`)
      json(res, 200, { ok: true, name, enabled })
      return
    }
    const matchBundle = /^\/bundles\/([^/]+)$/.exec(rest)
    if (method === 'PUT' && matchBundle !== null) {
      const body = (await readBody(req)) as Record<string, unknown>
      const enabled = body.enabled
      if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
      const id = decodeURIComponent(matchBundle[1]!)
      const handled = await setBundleEnabled(id, enabled)
      if (handled < 0) throw new Error(`bundle ${JSON.stringify(id)} not found`)
      json(res, 200, { ok: true, id, enabled, handled })
      return
    }
    json(res, 404, { error: `no route for ${method} ${rest}` })
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

/** Mount the routes. */
export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      void handle(ctx, req, res)
    },
  }), 'webui: skill-toggles routes')
}
