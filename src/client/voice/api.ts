/**
 * webui — 语音播报数据面（client 半身）。
 *
 * host 侧 /api/webui-voice（+ /speak /summary /stop）的浏览器客户端。
 * 所有写操作都会回读最新状态，调用方直接拿返回值渲染。
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

/** 试听 / 手动播报（kind=test 不受总开关约束；live/summary 受对应开关约束）。 */
export async function speakText(text: string, kind: 'live' | 'summary' | 'test' = 'test'): Promise<boolean> {
  try {
    const res = await fetch(`${API}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, kind }),
    })
    if (!res.ok) return false
    const data = await res.json()
    return data?.ok === true
  } catch {
    return false
  }
}

/** 生成并朗读对话总结。返回是否已入队。 */
export async function speakSummary(text: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) return false
    const data = await res.json()
    return data?.ok === true
  } catch {
    return false
  }
}

/** 停止播报（打断正在播的并清空队列）。 */
export async function stopSpeak(): Promise<void> {
  try {
    await fetch(`${API}/stop`, { method: 'POST', cache: 'no-store' })
  } catch { /* 停止失败不影响本地 */ }
}
