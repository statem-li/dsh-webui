/**
 * webui — 语音播报（host 半身）。
 *
 * 三种能力，一个常驻朗读进程：
 *
 *  1. **系统语音引擎**（默认）：PowerShell + System.Speech 朗读。本机装的
 *     「Microsoft * Online」神经音色（晓晓/云希/云扬/晓北-辽宁/晓妮-陕西…）
 *     即微软在线语音，男女与方言音色都在这里选；离线音色（Huihui 等）同表。
 *  2. **大模型语音引擎**：任何 OpenAI 兼容的 /audio/speech 端点（在「供应商 →
 *     模型」里给模型打开「语音」开关即成为候选），合成 mp3 后由同一个朗读
 *     进程播放。
 *  3. **总结播报**：回合结束后播一句总结。默认 digest（本地摘要，零 token），
 *     可切 llm（用所选模型压成一句话，费 token）。
 *
 * 队列语义：朗读进程一次只念一条，stdin 管道本身就是队列（先到先念）；
 * 「停止播报」= 杀掉进程（唯一能打断已在播的方式）并清空待播队列。
 * 进程按需拉起，空闲 ${IDLE_EXIT_MS} 后自动退出——不播报时零进程零开销。
 *
 * HTTP（全部 loopback-only：播报会在宿主机出声，不对局域网开放）：
 *   GET  ${VOICE_API}            → { config, voices, models, speaking }
 *   POST ${VOICE_API}            → 部分覆盖配置，回读最新状态
 *   POST ${VOICE_API}/speak     → { text, kind } 入队朗读
 *   POST ${VOICE_API}/summary   → { text } 生成并朗读总结
 *   POST ${VOICE_API}/stop      → 打断当前朗读并清空队列
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import z from '@deepseek-ai/schemastery'
import { clampSpeech, sanitizeForSpeech, SPEECH_MAX_CHARS } from './voice-text.js'

/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any

/** settings.yaml 命名空间。 */
export const VOICE_NAMESPACE = 'webui-voice'

/** HTTP 路由前缀。 */
export const VOICE_API = '/api/webui-voice'

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url))
const WORKER_SCRIPT = join(PKG_DIR, 'scripts', 'voice-speaker.ps1')

/** 朗读进程空闲多久自动退出（不播报时不占进程）。 */
const IDLE_EXIT_MS = 120_000

/** 待播队列上限：超出丢最旧的（实时播报追不上就该丢历史，不该越积越多）。 */
const MAX_QUEUE = 12

/** 单条朗读超时（含合成 + 播放）。 */
const SPEAK_TIMEOUT_MS = 120_000

/** 模型语音合成超时。 */
const SYNTH_TIMEOUT_MS = 60_000

/** 总结播报的目标长度（digest 与 llm 共用）。 */
const SUMMARY_TARGET_CHARS = 120

/** 语音引擎。 */
export type VoiceEngine = 'system' | 'model'

/** 总结方式：digest = 本地摘要（零 token）；llm = 模型生成一句话。 */
export type SummaryStyle = 'digest' | 'llm'

/** 命名空间形状。 */
export interface VoiceConfig {
  /** 总开关：关闭时任何播报请求直接丢弃。 */
  enabled: boolean
  /** 实时播报（边生成边念）。 */
  live: boolean
  /** 对话完成后的总结播报。 */
  summary: boolean
  engine: VoiceEngine
  /** 系统引擎音色名（System.Speech 的 VoiceInfo.Name）。 */
  systemVoice: string
  /** 语速：-10 ~ 10（System.Speech.Rate 口径；模型引擎映射为 speed）。 */
  rate: number
  /** 音量：0 ~ 100。 */
  volume: number
  /** 模型引擎使用的模型 key（provider/model）。 */
  modelKey: string
  /** 模型引擎的音色参数（各家自定；OpenAI 系为 alloy/nova…）。 */
  modelVoice: string
  summaryStyle: SummaryStyle
}

const ConfigSchema = z.object({
  enabled: z.boolean().default(false),
  live: z.boolean().default(true),
  summary: z.boolean().default(true),
  engine: z.union(['system', 'model'] as const).default('system'),
  systemVoice: z.string().default(''),
  rate: z.number().step(1).min(-10).max(10).default(1),
  volume: z.number().step(1).min(0).max(100).default(100),
  modelKey: z.string().default(''),
  modelVoice: z.string().default(''),
  summaryStyle: z.union(['digest', 'llm'] as const).default('digest'),
})

/** 一个可选音色（系统引擎）。 */
export interface VoiceOption {
  id: string
  name: string
  culture: string
  gender: string
}

/** 待播条目。 */
interface QueueItem {
  id: number
  kind: 'live' | 'summary' | 'test'
  text: string
}

// ── HTTP plumbing（与 prompt-optimize 同款 loopback 判定）──────────────────

function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const value = address.toLowerCase()
  if (value === '::1') return true
  const ipv4 = value.startsWith('::ffff:') ? value.slice(7) : value
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function loopbackAllowed(req: IncomingMessage): boolean {
  return isLoopbackAddress(req.socket.remoteAddress)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => { data += String(chunk) })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

/** 供应商 profile（baseURL / apiKeyEnv），与 vision-helper 同一读取路径。 */
function providerConfig(ctx: PluginContext, providerId: string): any {
  try {
    const entries = ctx.llm.listConfigurableProviders()
    const entry = entries.find((item: any) => item.provider === providerId)
    if (!entry || !entry.settingsNs) return null
    const section = ctx.settings.get(entry.settingsNs)
    if (!section || typeof section !== 'object') return null
    let node: any = section
    for (const key of Array.isArray(entry.settingsPath) ? entry.settingsPath : []) {
      if (node && typeof node === 'object' && key in node) node = node[key]
      else return null
    }
    return node && typeof node === 'object' ? node : null
  } catch {
    return null
  }
}

async function resolveApiKey(ctx: PluginContext, profile: any): Promise<string | null> {
  if (!profile || typeof profile.apiKeyEnv !== 'string' || profile.apiKeyEnv === '') return null
  try {
    const credentials = ctx.get('credentials')
    if (!credentials) return null
    const resolved = await credentials.resolve(profile.apiKeyEnv)
    return resolved ? String(resolved.value) : null
  } catch {
    return null
  }
}

/** provider/model → 两段；非法返回 null。 */
function splitKey(key: string): { provider: string, model: string } | null {
  if (typeof key !== 'string') return null
  const index = key.indexOf('/')
  if (index <= 0 || index === key.length - 1) return null
  return { provider: key.slice(0, index), model: key.slice(index + 1) }
}

/**
 * 本地摘要：取开头若干完整句拼到目标长度（零 token、零延迟）。
 * @param text - 已清洗的回复正文。
 * @returns 一句话总结（可能为空串）。
 */
export function digestSummary(text: string): string {
  const body = text.trim()
  if (body === '') return ''
  const pieces = body.split(/(?<=[。！？!?…])\s*/).map(piece => piece.trim()).filter(piece => piece !== '')
  if (pieces.length === 0) return clampSpeech(body, SUMMARY_TARGET_CHARS)
  let out = ''
  for (const piece of pieces) {
    if (out !== '' && out.length + piece.length > SUMMARY_TARGET_CHARS) break
    out += piece
    if (out.length >= SUMMARY_TARGET_CHARS) break
  }
  return out === '' ? clampSpeech(pieces[0] ?? body, SUMMARY_TARGET_CHARS) : out
}

/**
 * 注册语音播报：settings 持久化 + 朗读进程 + HTTP 路由。
 * @param ctx - host 上下文（需要 settings / webServer / llm / credentials）。
 */
export function applyVoice(ctx: PluginContext): void {
  let scope: any
  try {
    scope = ctx.settings.register(VOICE_NAMESPACE, ConfigSchema)
  } catch (error: any) {
    console.log('[webui-voice] settings namespace already registered:', error?.message ?? error)
  }

  const readConfig = (): VoiceConfig => {
    if (scope !== undefined) {
      try { return ConfigSchema(scope.get() ?? {}) as VoiceConfig } catch { /* fallthrough */ }
    }
    return ConfigSchema({}) as VoiceConfig
  }

  // ── 朗读进程（按需拉起 / 空闲自退 / 杀进程即打断）────────────────────────
  let worker: ChildProcessWithoutNullStreams | null = null
  let ready = false
  let busy = false
  let nextId = 1
  const queue: QueueItem[] = []
  let idleTimer: NodeJS.Timeout | null = null
  let speakTimer: NodeJS.Timeout | null = null
  /** 本次播放用的临时 mp3（模型引擎）；播完即删。 */
  let tempFile: string | null = null
  let tempDir: string | null = null

  const clearTempFile = (): void => {
    if (tempFile === null) return
    try { rmSync(tempFile, { force: true }) } catch { /* 清理失败忽略 */ }
    tempFile = null
  }

  const armIdle = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (busy || queue.length > 0) return
      stopWorker('idle')
    }, IDLE_EXIT_MS)
    idleTimer.unref?.()
  }

  function stopWorker(reason: string): void {
    const current = worker
    worker = null
    ready = false
    busy = false
    if (speakTimer !== null) { clearTimeout(speakTimer); speakTimer = null }
    clearTempFile()
    if (current === null) return
    try {
      current.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n')
    } catch { /* 管道已断 */ }
    // 已在播放中的语音只能靠杀进程打断（Speak 是阻塞调用）。
    setTimeout(() => { try { current.kill() } catch { /* 已退出 */ } }, reason === 'idle' ? 800 : 0)
  }

  function ensureWorker(): ChildProcessWithoutNullStreams | null {
    if (worker !== null) return worker
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORKER_SCRIPT,
      ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }) as unknown as ChildProcessWithoutNullStreams
    } catch (error: any) {
      console.error('[webui-voice] spawn speaker failed:', error?.message ?? error)
      return null
    }
    worker = child
    ready = false
    child.stdout.setEncoding('utf8')
    let buffer = ''
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let index: number
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line === '') continue
        onWorkerLine(line)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const text = String(chunk).trim()
      if (text !== '') console.error('[webui-voice] speaker stderr:', text.slice(0, 300))
    })
    child.on('exit', () => {
      if (worker === child) { worker = null; ready = false; busy = false }
      if (speakTimer !== null) { clearTimeout(speakTimer); speakTimer = null }
      clearTempFile()
    })
    child.on('error', (error) => {
      console.error('[webui-voice] speaker process error:', error.message)
      if (worker === child) { worker = null; ready = false; busy = false }
    })
    return child
  }

  function onWorkerLine(line: string): void {
    if (line === 'READY') {
      ready = true
      pump()
      return
    }
    if (line === 'BYE') return
    if (line.startsWith('ERR ')) console.warn('[webui-voice] speaker:', line.slice(4, 300))
    // OK / ERR 都表示这一条播完了：清临时文件，取下一条。
    busy = false
    clearTempFile()
    if (speakTimer !== null) { clearTimeout(speakTimer); speakTimer = null }
    pump()
  }

  /** 取队首播一条；worker 未就绪时等 READY。 */
  function pump(): void {
    if (busy) return
    const item = queue.shift()
    if (item === undefined) { armIdle(); return }
    const child = ensureWorker()
    if (child === null) return
    if (!ready) { queue.unshift(item); return }
    const config = readConfig()
    busy = true
    if (config.engine === 'model') {
      void synthWithModel(item, config).then((file) => {
        if (file === null) { busy = false; pump(); return }
        tempFile = file
        writeCommand(child, { id: item.id, cmd: 'play', file, volume: config.volume })
      }).catch((error) => {
        console.warn('[webui-voice] model synth failed:', String(error?.message ?? error))
        busy = false
        pump()
      })
      return
    }
    writeCommand(child, {
      id: item.id,
      cmd: 'speak',
      text: item.text,
      voice: config.systemVoice,
      rate: config.rate,
      volume: config.volume,
    })
  }

  function writeCommand(child: ChildProcessWithoutNullStreams, payload: Record<string, unknown>): void {
    try {
      child.stdin.write(JSON.stringify(payload) + '\n')
    } catch (error: any) {
      console.warn('[webui-voice] write to speaker failed:', error?.message ?? error)
      busy = false
      stopWorker('write-failed')
      return
    }
    if (speakTimer !== null) clearTimeout(speakTimer)
    speakTimer = setTimeout(() => {
      speakTimer = null
      // 引擎卡死：杀进程重来，避免整条队列永久堵住。
      console.warn('[webui-voice] speak timeout, restarting speaker')
      stopWorker('timeout')
      pump()
    }, SPEAK_TIMEOUT_MS)
    speakTimer.unref?.()
  }

  /** 入队一条播报（已按引擎无关的方式清洗过）。 */
  function enqueue(kind: QueueItem['kind'], text: string): boolean {
    const body = clampSpeech(sanitizeForSpeech(text), SPEECH_MAX_CHARS)
    if (body === '') return false
    queue.push({ id: nextId++, kind, text: body })
    // 队列过长说明播报追不上生成：丢最旧的实时句，保住最新内容与总结。
    while (queue.length > MAX_QUEUE) {
      const dropIndex = queue.findIndex(item => item.kind === 'live')
      queue.splice(dropIndex === -1 ? 0 : dropIndex, 1)
    }
    pump()
    return true
  }

  // ── 模型语音合成（OpenAI 兼容 /audio/speech）────────────────────────────

  async function synthWithModel(item: QueueItem, config: VoiceConfig): Promise<string | null> {
    const parts = splitKey(config.modelKey)
    if (parts === null) {
      console.warn('[webui-voice] 模型引擎未选择模型，跳过本条播报')
      return null
    }
    const profile = providerConfig(ctx, parts.provider)
    if (!profile || typeof profile.baseURL !== 'string' || profile.baseURL === '') {
      console.warn(`[webui-voice] provider "${parts.provider}" 未配置 baseURL`)
      return null
    }
    const apiKey = await resolveApiKey(ctx, profile)
    const base = String(profile.baseURL).replace(/[\\/]+$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SYNTH_TIMEOUT_MS)
    try {
      const response = await fetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...apiKey === null ? {} : { authorization: `Bearer ${apiKey}` },
        },
        body: JSON.stringify({
          model: parts.model,
          input: item.text,
          ...config.modelVoice === '' ? {} : { voice: config.modelVoice },
          response_format: 'mp3',
          // System.Speech 的 -10~10 映射到常见 TTS 的 0.5~2.0 倍速。
          speed: Math.min(2, Math.max(0.5, 1 + config.rate / 10)),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 200)
        console.warn(`[webui-voice] /audio/speech HTTP ${String(response.status)}: ${detail}`)
        return null
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length === 0) return null
      if (tempDir === null) tempDir = mkdtempSync(join(tmpdir(), 'dsh-voice-'))
      const file = join(tempDir, `speech-${String(item.id)}.mp3`)
      writeFileSync(file, bytes)
      return file
    } finally {
      clearTimeout(timer)
    }
  }

  // ── 总结播报 ────────────────────────────────────────────────────────────

  /** 用所选模型把回复压成一句话（summaryStyle=llm 时）。 */
  async function llmSummary(text: string, config: VoiceConfig): Promise<string> {
    const parts = splitKey(config.modelKey)
    const llm = ctx.get('llm')
    if (parts === null || llm === undefined) return ''
    try {
      let out = ''
      for await (const chunk of llm.stream({
        provider: parts.provider,
        model: parts.model,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: `用一句不超过 40 字的中文口语总结下面这段回复，只输出总结本身：\n\n${text.slice(0, 4000)}` }],
        }],
        system: '你把助手的回复压缩成一句可以直接朗读的中文口语总结。只输出总结，不要标点堆砌、不要 Markdown。',
        maxTokens: 200,
      })) {
        if (chunk.type === 'text-delta') out += chunk.text
      }
      return out.trim()
    } catch (error: any) {
      console.warn('[webui-voice] llm summary failed:', String(error?.message ?? error))
      return ''
    }
  }

  // ── 系统音色清单（懒加载 + 内存缓存）────────────────────────────────────

  let voicesCache: VoiceOption[] | null = null
  let voicesPending: Promise<VoiceOption[]> | null = null

  function listVoices(): Promise<VoiceOption[]> {
    if (voicesCache !== null) return Promise.resolve(voicesCache)
    if (voicesPending !== null) return voicesPending
    voicesPending = new Promise<VoiceOption[]>((resolve) => {
      let out = ''
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn('powershell.exe', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORKER_SCRIPT, '-ListVoices',
        ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) as unknown as ChildProcessWithoutNullStreams
      } catch (error: any) {
        console.error('[webui-voice] list voices spawn failed:', error?.message ?? error)
        resolve([])
        return
      }
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { out += chunk })
      child.on('error', () => resolve([]))
      child.on('close', () => {
        try {
          const parsed = JSON.parse(out.trim() || '[]')
          const rows: VoiceOption[] = (Array.isArray(parsed) ? parsed : [parsed])
            .filter((row: any) => row && typeof row.id === 'string' && row.id !== '')
            .map((row: any) => ({
              id: String(row.id),
              name: String(row.name ?? row.id),
              culture: String(row.culture ?? ''),
              gender: String(row.gender ?? ''),
            }))
          voicesCache = rows
          resolve(rows)
        } catch (error: any) {
          console.warn('[webui-voice] parse voices failed:', error?.message ?? error)
          resolve([])
        }
      })
    }).finally(() => { voicesPending = null })
    return voicesPending
  }

  /** 声明了「语音」能力的模型（model-router.json 的 capabilities）。 */
  async function listSpeechModels(): Promise<string[]> {
    try {
      const target = await ctx.fs.resolve('.dsh/model-router.json')
      const parsed = JSON.parse(await ctx.fs.readText(target))
      const caps = parsed?.capabilities
      if (caps === null || typeof caps !== 'object') return []
      const out: string[] = []
      for (const [key, value] of Object.entries(caps as Record<string, unknown>)) {
        if (Array.isArray(value) && value.includes('speech') && splitKey(key) !== null) out.push(key)
      }
      return out.sort()
    } catch {
      return []
    }
  }

  // ── 路由 ────────────────────────────────────────────────────────────────

  const state = async (): Promise<Record<string, unknown>> => ({
    ok: true,
    config: readConfig(),
    voices: await listVoices(),
    models: await listSpeechModels(),
    speaking: busy || queue.length > 0,
    queued: queue.length,
  })

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: VOICE_API,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!loopbackAllowed(req)) { json(res, 403, { ok: false, error: 'loopback-only' }); return }
          try {
            if (req.method === 'POST' && scope !== undefined) {
              const body = await readBody(req)
              const patch: Record<string, unknown> = {}
              const current = readConfig()
              for (const key of ['enabled', 'live', 'summary'] as const) {
                if (typeof body?.[key] === 'boolean') patch[key] = body[key]
              }
              if (body?.engine === 'system' || body?.engine === 'model') patch.engine = body.engine
              if (body?.summaryStyle === 'digest' || body?.summaryStyle === 'llm') patch.summaryStyle = body.summaryStyle
              for (const key of ['systemVoice', 'modelKey', 'modelVoice'] as const) {
                if (typeof body?.[key] === 'string') patch[key] = body[key]
              }
              if (Number.isFinite(Number(body?.rate))) patch.rate = Math.min(10, Math.max(-10, Math.round(Number(body.rate))))
              if (Number.isFinite(Number(body?.volume))) patch.volume = Math.min(100, Math.max(0, Math.round(Number(body.volume))))
              if (Object.keys(patch).length > 0) {
                await scope.update(ConfigSchema({ ...current, ...patch }))
              }
              // 总开关关掉时立刻静音（已在播的也打断）。
              if (patch.enabled === false) { queue.length = 0; stopWorker('disabled') }
            }
            json(res, 200, await state())
          } catch (error: any) {
            json(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${VOICE_API}/speak`,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!loopbackAllowed(req)) { json(res, 403, { ok: false, error: 'loopback-only' }); return }
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
          try {
            const body = await readBody(req)
            const config = readConfig()
            const kind = body?.kind === 'summary' ? 'summary' : body?.kind === 'test' ? 'test' : 'live'
            // 试听不看总开关（用户正在设置页调音色）；实时/总结受开关约束。
            if (kind !== 'test') {
              if (!config.enabled) { json(res, 200, { ok: true, skipped: 'disabled' }); return }
              if (kind === 'live' && !config.live) { json(res, 200, { ok: true, skipped: 'live-off' }); return }
              if (kind === 'summary' && !config.summary) { json(res, 200, { ok: true, skipped: 'summary-off' }); return }
            }
            const spoken = enqueue(kind, typeof body?.text === 'string' ? body.text : '')
            json(res, 200, { ok: true, queued: spoken, pending: queue.length })
          } catch (error: any) {
            json(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${VOICE_API}/summary`,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!loopbackAllowed(req)) { json(res, 403, { ok: false, error: 'loopback-only' }); return }
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
          try {
            const body = await readBody(req)
            const config = readConfig()
            if (!config.enabled || !config.summary) { json(res, 200, { ok: true, skipped: 'summary-off' }); return }
            const clean = sanitizeForSpeech(typeof body?.text === 'string' ? body.text : '')
            if (clean === '') { json(res, 200, { ok: true, skipped: 'empty' }); return }
            let text = config.summaryStyle === 'llm' ? await llmSummary(clean, config) : ''
            if (text === '') text = digestSummary(clean)
            const spoken = enqueue('summary', text)
            json(res, 200, { ok: true, queued: spoken, text })
          } catch (error: any) {
            json(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${VOICE_API}/stop`,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!loopbackAllowed(req)) { json(res, 403, { ok: false, error: 'loopback-only' }); return }
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
          queue.length = 0
          stopWorker('stop')
          json(res, 200, { ok: true })
        },
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
      queue.length = 0
      stopWorker('dispose')
      if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null }
      if (tempDir !== null) {
        try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* 清理失败忽略 */ }
        tempDir = null
      }
    }
  }, 'webui: voice routes')

  console.log(`[webui-voice] mounted: ${VOICE_API} (+/speak, /summary, /stop)`)
}
