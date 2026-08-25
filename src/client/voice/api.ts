/**
 * webui — 语音播报数据面（client 半身）。
 *
 * host 侧 /api/webui-voice（+ /speak /summary /stop /mute）的浏览器客户端。
 * 所有写操作都会回读最新状态，调用方直接拿返回值渲染。
 *
 * 播报请求都带 sessionId（host 侧据此做多会话仲裁：一台机器只有一个音响，
 * 谁先出声谁持话筒，其它会话的实时句丢弃、总结加会话名排队）与 force
 * （该会话在对话框里明确开了播报时越过全局开关）。
 */

/** 与 host 的 VoiceConfig 对齐（引擎字段等）。 */
export interface VoiceConfig {
  enabled: boolean
  live: boolean
  summary: boolean
  engine: 'system' | 'model'
  systemVoice: string
  rate: number
  volume: number
  modelKey: string
  modelVoice: string
  summaryStyle: 'digest' | 'llm'
}

/** 一个系统音色选项。 */
export interface VoiceOption {
  id: string
  name: string
  culture: string
  gender: string
}

/** GET 状态（含全部可选项）。 */
export interface VoiceState {
  config: VoiceConfig
  voices: VoiceOption[]
  models: string[]
  speaking: boolean
  queued: number
  /** 运行期静音（host 权威值）。 */
  muted: boolean
  /** 当前持话筒的会话 id（null = 空闲）。 */
  owner: string | null
}

/** 一条播报请求的会话上下文。 */
export interface SpeakContext {
  /** 来源会话 id（用于仲裁与按会话打断）。 */
  sessionId?: string
  /** 该会话已明确开启播报：越过 host 端全局开关。 */
  force?: boolean
  /** 会话显示名（别的会话占着话筒时给总结加前缀）。 */
  label?: string
}

const API = '/api/webui-voice'

/** 把任意响应投影成 VoiceState；失败返回 null。 */
function project(data: any): VoiceState | null {
  if (data?.ok !== true || typeof data.config !== 'object' || data.config === null) return null
  return {
    config: data.config as VoiceConfig,
    voices: Array.isArray(data.voices) ? data.voices : [],
    models: Array.isArray(data.models) ? data.models : [],
    speaking: data.speaking === true,
    queued: Number.isFinite(Number(data.queued)) ? Number(data.queued) : 0,
    muted: data.muted === true,
    owner: typeof data.owner === 'string' ? data.owner : null,
  }
}

/** 读当前状态（失败返回 null，调用方显示占位而非报错阻塞）。 */
export async function fetchVoice(): Promise<VoiceState | null> {
  try {
    const res = await fetch(API, { cache: 'no-store' })
    if (!res.ok) return null
    return project(await res.json())
  } catch {
    return null
  }
}

/** 部分覆盖写入，回读最新状态。 */
export async function saveVoice(patch: Partial<VoiceConfig>): Promise<VoiceState | null> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return null
    return project(await res.json())
  } catch {
    return null
  }
}

/**
 * 试听 / 实时 / 总结播报入队。
 * @param text - 待播文本。
 * @param kind - live=实时句，summary=总结，test=试听（不受全局开关约束）。
 * @param context - 会话上下文（sessionId / force / label）。
 * @returns 是否已入队。
 */
export async function speakText(
  text: string,
  kind: 'live' | 'summary' | 'test' = 'test',
  context: SpeakContext = {},
): Promise<boolean> {
  try {
    const res = await fetch(`${API}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, kind, ...context }),
    })
    if (!res.ok) return false
    const data = await res.json()
    return data?.ok === true
  } catch {
    return false
  }
}

/**
 * 生成并朗读对话总结（host 端按 digest/llm 压成一句结论）。
 * @param text - 该回合的助手全文。
 * @param context - 会话上下文。
 * @returns 是否已入队。
 */
export async function speakSummary(text: string, context: SpeakContext = {}): Promise<boolean> {
  try {
    const res = await fetch(`${API}/summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...context }),
    })
    if (!res.ok) return false
    const data = await res.json()
    return data?.ok === true
  } catch {
    return false
  }
}

/**
 * 停止播报（打断正在播的并清空队列）。
 * @param options - sessionId 只停该会话；mute=true 顺便进入静音。
 * @returns host 返回的静音状态（失败返回 null）。
 */
export async function stopSpeak(options: { sessionId?: string, mute?: boolean } = {}): Promise<boolean | null> {
  try {
    const res = await fetch(`${API}/stop`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.muted === true
  } catch {
    return null
  }
}

/**
 * 设置静音（运行期硬开关，立刻掐断所有会话的播报）。
 * @param muted - 目标状态；省略则切换。
 * @returns host 返回的最终静音状态（失败返回 null）。
 */
export async function setMuted(muted?: boolean): Promise<boolean | null> {
  try {
    const res = await fetch(`${API}/mute`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(muted === undefined ? {} : { muted }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.muted === true
  } catch {
    return null
  }
}
