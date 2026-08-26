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
 *  3. **总结播报**：回合结束后播一句「做完了什么 / 什么原因 / 解决了什么」，
 *     默认 digest（本地结论提取，零 token），可切 llm（模型生成结论，费 token）。
 *     两种方式都不限制字数，只留 600 字安全网兜底。
 *
 * 队列语义：朗读进程一次只念一条，stdin 管道本身就是队列（先到先念）；
 * 「停止播报」= 杀掉进程（唯一能打断已在播的方式）并清空待播队列。
 * 进程按需拉起，空闲 ${IDLE_EXIT_MS} 后自动退出——不播报时零进程零开销。
 *
 * 多会话仲裁（一台机器只有一个音响）：每条播报都带 sessionId。正在出声的会话
 * 是「持话筒者」，其它会话的实时句直接丢弃（不交叉念），总结则加会话名前缀排队；
 * 持话筒者播完（队列空）即释放话筒。同一会话在多个标签页打开时按文本去重，
 * 避免同一句念两遍。
 *
 * 随时闭嘴：静音（muted）是运行期硬开关，一次调用即刻掐断所有会话的播报，
 * 不改配置、不需要逐个会话关开关；恢复也是一次调用。
 *
 * HTTP（全部 loopback-only：播报会在宿主机出声，不对局域网开放）：
 *   GET  ${VOICE_API}            → { config, voices, models, speaking, muted, owner }
 *   POST ${VOICE_API}            → 部分覆盖配置，回读最新状态
 *   POST ${VOICE_API}/speak     → { text, kind, sessionId, turn, force, label } 入队朗读
 *   POST ${VOICE_API}/summary   → { text, sessionId, force, label } 生成并朗读总结
 *   POST ${VOICE_API}/stop      → { sessionId?, mute? } 打断并清空（可只清某会话 / 顺便静音）
 *   POST ${VOICE_API}/mute      → { muted } 静音 / 解除静音
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import z from '@deepseek-ai/schemastery'
import { clampSpeech, outcomeSummary, sanitizeForSpeech, SPEECH_MAX_CHARS } from './voice-text.js'

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

/** 持话筒者播完后多久释放话筒（防止两句之间的空隙被别的会话抢走）。 */
const OWNER_IDLE_MS = 4_000

/** 同一句文本的去重窗口（同一会话在多标签页打开时会重复上报）。 */
const DEDUPE_MS = 8_000

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
  // 默认只播总结：实时逐句朗读长回复就是「长篇论述」，价值远低于一句结论。
  live: z.boolean().default(false),
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
  /** 来源会话（多会话仲裁用；test / 无会话上下文为空串）。 */
  sessionId: string
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
 * 本地总结：提取「做完了什么 / 什么原因 / 解决了什么」（零 token、零延迟）。
 *
 * 保留导出名 digestSummary 以兼容既有调用；实现委托给
 * {@link outcomeSummary}——不再是「取开头几句」，而是按结论线索打分挑句。
 * @param text - 已清洗的回复正文。
 * @returns 一句话总结（可能为空串）。
 */
export function digestSummary(text: string): string {
  return outcomeSummary(text)
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

  // ── 运行期开关与多会话仲裁 ──────────────────────────────────────────────
  /**
   * 静音：运行期硬开关（不写 settings）。开着时任何播报（含试听）直接丢弃，
   * 并立刻掐断正在播的那句——「突然不想听了」一次点击即生效，恢复亦然。
   */
  let muted = false
  /** 当前持话筒的会话（正在出声/待播的那个）；null = 话筒空闲。 */
  let owner: string | null = null
  /** 持话筒者最后一次活动时间（用于空闲释放）。 */
  let ownerTouchedAt = 0
  /** 正在播的那条属于哪个会话（stop 按会话精确打断用）。 */
  let speakingSession = ''
  /** 最近播过的文本指纹 → 时间戳（同一会话多标签页打开时去重）。 */
  const recent = new Map<string, number>()

  /** 话筒是否已空置（无人在播且过了静默窗口）。 */
  const ownerFree = (): boolean => {
    if (owner === null) return true
    if (busy || queue.length > 0) return false
    return Date.now() - ownerTouchedAt > OWNER_IDLE_MS
  }

  /**
   * 多会话仲裁：决定某会话的这条播报能不能出声。
   *
   * 一台机器只有一个音响，多个会话同时播会互相盖住。规则：先出声的会话持话筒，
   * 其它会话的**实时句直接丢**（交叉朗读毫无可读性），**总结允许排队**（结论值得
   * 听，且量很小），持话筒者播完并静默 ${OWNER_IDLE_MS}ms 后释放。
   * @param sessionId - 来源会话 id（空串视为无会话上下文，直接放行）。
   * @param kind - 播报类型。
   * @returns 放行时返回 true。
   */
  function claimFloor(sessionId: string, kind: QueueItem['kind']): boolean {
    if (sessionId === '' || kind === 'test') return true
    if (ownerFree()) {
      owner = sessionId
      ownerTouchedAt = Date.now()
      return true
    }
    if (owner === sessionId) {
      ownerTouchedAt = Date.now()
      return true
    }
    // 别的会话在播：实时句丢弃，总结让它排队（后面会带会话名前缀）。
    return kind === 'summary'
  }

  /** 同文本去重（多标签页会把同一句上报多次）。 */
  function seenRecently(sessionId: string, text: string): boolean {
    const now = Date.now()
    for (const [key, at] of recent) if (now - at > DEDUPE_MS) recent.delete(key)
    const fingerprint = `${sessionId}\u0000${text}`
    if (recent.has(fingerprint)) return true
    recent.set(fingerprint, now)
    return false
  }

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
    if (muted) { queue.length = 0; armIdle(); return }
    const item = queue.shift()
    if (item === undefined) {
      // 队列空 = 持话筒者说完了；记一次活动时间，静默窗口过后自动释放话筒。
      ownerTouchedAt = Date.now()
      armIdle()
      return
    }
    const child = ensureWorker()
    if (child === null) return
    if (!ready) { queue.unshift(item); return }
    const config = readConfig()
    busy = true
    speakingSession = item.sessionId
    if (item.sessionId !== '') { owner = item.sessionId; ownerTouchedAt = Date.now() }
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

  /**
   * 入队一条播报（已按引擎无关的方式清洗过）。
   * @param kind - 播报类型。
   * @param text - 待播文本。
   * @param sessionId - 来源会话（多会话仲裁与按会话打断用）。
   * @returns 是否真的入队（被静音/被仲裁丢弃/重复/空文本都返回 false）。
   */
  function enqueue(kind: QueueItem['kind'], text: string, sessionId = ''): boolean {
    if (muted) return false
    const body = clampSpeech(sanitizeForSpeech(text), SPEECH_MAX_CHARS)
    if (body === '') return false
    if (!claimFloor(sessionId, kind)) return false
    if (seenRecently(sessionId, body)) return false
    queue.push({ id: nextId++, kind, text: body, sessionId })
    // 队列过长说明播报追不上生成：丢最旧的实时句，保住最新内容与总结。
    while (queue.length > MAX_QUEUE) {
      const dropIndex = queue.findIndex(item => item.kind === 'live')
      queue.splice(dropIndex === -1 ? 0 : dropIndex, 1)
    }
    pump()
    return true
  }

  /**
   * 打断播报并清队。
   * @param sessionId - 只停这个会话（空串 = 全停）。
   * @returns 是否杀掉了正在播的那一句。
   */
  function stopSpeaking(sessionId = ''): boolean {
    if (sessionId === '') {
      queue.length = 0
      owner = null
      speakingSession = ''
      stopWorker('stop')
      return true
    }
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index]?.sessionId === sessionId) queue.splice(index, 1)
    }
    if (owner === sessionId) owner = null
    // 正在播的那句属于该会话才需要杀进程（Speak 阻塞，只能这样打断）。
    if (busy && speakingSession === sessionId) {
      speakingSession = ''
      stopWorker('stop-session')
      pump()
      return true
    }
    return false
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

  /**
   * 用所选模型把回复压成结论播报（summaryStyle=llm 时）。
   *
   * 提示词刻意只要三件事：做完了什么、原因、解决了什么问题——不要过程复述、
   * 不要罗列步骤。不限制字数，只留 {@link SPEECH_MAX_CHARS} 安全网兜底。
   * @param text - 已清洗的回复正文。
   * @param config - 当前配置（取 modelKey）。
   * @returns 结论文本；失败返回空串（调用方回落本地提取）。
   */
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
          content: [{ type: 'text', text: `把下面这段助手回复总结成完整结论口播：做完了什么／为什么／解决了什么问题，直接说出来。不要复述过程、不要列步骤、不要客套、不要 Markdown。\n\n${text.slice(0, 4000)}` }],
        }],
        system: '你为语音播报写结论口播：只讲结果、原因、解决的问题，说完整、说清楚，不要 Markdown、不要引号、不要罗列步骤、不要客套。',
        maxTokens: 300,
      })) {
        if (chunk.type === 'text-delta') out += chunk.text
      }
      return clampSpeech(sanitizeForSpeech(out.trim()))
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
    muted,
    /** 当前持话筒的会话（多会话仲裁的可观测状态；null = 空闲）。 */
    owner,
  })

  /** 从请求体读会话 id（缺省空串 = 无会话上下文）。 */
  const sessionOf = (body: any): string => typeof body?.sessionId === 'string' ? body.sessionId : ''

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
              if (patch.enabled === false) stopSpeaking()
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
            // force = 该会话在对话框里明确开了这一项：越过全局开关，只受静音约束。
            // 没有它的话「对话框开关」在全局关闭时永远是个摆设（本次修复的核心）。
            const force = body?.force === true
            if (muted) { json(res, 200, { ok: true, skipped: 'muted' }); return }
            // 试听不看总开关（用户正在设置页调音色）；实时/总结受开关约束。
            if (kind !== 'test' && !force) {
              if (!config.enabled) { json(res, 200, { ok: true, skipped: 'disabled' }); return }
              if (kind === 'live' && !config.live) { json(res, 200, { ok: true, skipped: 'live-off' }); return }
              if (kind === 'summary' && !config.summary) { json(res, 200, { ok: true, skipped: 'summary-off' }); return }
            }
            const spoken = enqueue(kind, typeof body?.text === 'string' ? body.text : '', sessionOf(body))
            json(res, 200, { ok: true, queued: spoken, pending: queue.length, owner })
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
            const force = body?.force === true
            if (muted) { json(res, 200, { ok: true, skipped: 'muted' }); return }
            if (!force && (!config.enabled || !config.summary)) { json(res, 200, { ok: true, skipped: 'summary-off' }); return }
            const sessionId = sessionOf(body)
            const clean = sanitizeForSpeech(typeof body?.text === 'string' ? body.text : '')
            if (clean === '') { json(res, 200, { ok: true, skipped: 'empty' }); return }
            let text = config.summaryStyle === 'llm' ? await llmSummary(clean, config) : ''
            if (text === '') text = digestSummary(clean)
            // 别的会话正在占着话筒时，总结前面加一句会话名，听者才知道是谁在说。
            const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 24) : ''
            const prefixed = label !== '' && owner !== null && owner !== sessionId
              ? `${label}：${text}`
              : text
            const spoken = enqueue('summary', prefixed, sessionId)
            json(res, 200, { ok: true, queued: spoken, text: prefixed })
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
          const body = await readBody(req)
          // mute=true：顺手进入静音（"我突然不想听了" 一次点击既闭嘴又不再开口）。
          if (body?.mute === true) muted = true
          const killed = stopSpeaking(sessionOf(body))
          json(res, 200, { ok: true, killed, muted })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${VOICE_API}/mute`,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (!loopbackAllowed(req)) { json(res, 403, { ok: false, error: 'loopback-only' }); return }
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method not allowed' }); return }
          const body = await readBody(req)
          // 缺省视为「切换」，显式传 muted 则按传入值。
          muted = typeof body?.muted === 'boolean' ? body.muted : !muted
          if (muted) stopSpeaking()
          json(res, 200, { ok: true, muted })
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

  console.log(`[webui-voice] mounted: ${VOICE_API} (+/speak, /summary, /stop, /mute)`)
}
