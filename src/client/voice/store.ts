/**
 * webui — 语音播报会话级状态（client 半身）。
 *
 * 全局配置在 host settings（/api/webui-voice）；本模块管理两件本地状态：
 *
 *  1. **按会话覆盖**（对话框里的播报开关）：
 *     `dsh-webui.voice.session.<id> = { on, live, summary }`，缺省不存在 = 跟随全局。
 *     覆盖是**双向**的：全局关着也能只为某个会话打开（写 on=true，请求带 force），
 *     全局开着也能只把某个会话闭嘴（on=false）。旧版只有 live/summary 两个子开关、
 *     且生效值被 `global.enabled &&` 一票否决——那就是「开关跟没开一样」的原因。
 *  2. **静音**（"我突然不想听了"）：进程级运行开关，host 侧才是权威（见 voice.ts），
 *     这里存一份镜像用于渲染，并通过 storage 事件在多标签页间同步。
 *
 * 所有状态变更都会通知订阅者，ChatToggle 与 announcer 因此能**立即**重渲染并生效，
 * 不必等下一次流式增量（旧版读取时机在渲染期、又没有订阅，改了开关要等下一帧）。
 */

/** 某会话的播报覆盖。 */
export interface SessionVoicePrefs {
  /** 本会话播报总开关（true 会越过全局开关强制播报）。 */
  on: boolean
  /** 实时播报（边生成边念）。 */
  live: boolean
  /** 总结播报（回合结束念结论）。 */
  summary: boolean
}

/** 全局配置里播报驱动关心的部分。 */
export interface GlobalVoicePrefs {
  enabled: boolean
  live: boolean
  summary: boolean
}

/** 一个会话最终生效的播报设置。 */
export interface EffectiveVoicePrefs {
  /** 是否播报（已计入静音、会话覆盖与全局开关）。 */
  on: boolean
  live: boolean
  summary: boolean
  /** 是否为「会话覆盖」——请求需带 force=true，越过 host 端全局开关。 */
  forced: boolean
  /** 是否存在会话覆盖（用于「恢复全局」按钮的显隐）。 */
  overridden: boolean
}

const KEY = (sessionId: string): string => `dsh-webui.voice.session.${sessionId}`
const MUTE_KEY = 'dsh-webui.voice.muted'

/** 变更订阅者（ChatToggle / announcer）。 */
const listeners = new Set<() => void>()

/** 通知所有订阅者重新读状态。 */
function emit(): void {
  for (const listener of [...listeners]) {
    try { listener() } catch { /* 单个订阅者异常不影响其它 */ }
  }
}

/**
 * 订阅播报状态变化（会话覆盖 / 全局缓存 / 静音）。
 * @param listener - 变化回调。
 * @returns 取消订阅。
 */
export function subscribeVoice(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// 跨标签页同步：别的标签页改了覆盖或静音，这里也要跟着重渲染。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    const key = event.key
    if (key === null) { emit(); return }
    if (key === MUTE_KEY || key.startsWith('dsh-webui.voice.session.')) {
      if (key === MUTE_KEY) mutedCache = event.newValue === '1'
      emit()
    }
  })
}

/** 读某会话的覆盖；无覆盖返回 null（跟随全局）。 */
export function readSessionPrefs(sessionId: string): SessionVoicePrefs | null {
  try {
    const raw = window.localStorage.getItem(KEY(sessionId))
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    return {
      // 兼容旧格式（只有 live/summary，没有 on）：视为「本会话开启」。
      on: parsed.on !== false,
      live: parsed.live !== false,
      summary: parsed.summary !== false,
    }
  } catch {
    return null
  }
}

/** 写某会话的覆盖；传 null 清除覆盖（回到跟随全局）。 */
export function writeSessionPrefs(sessionId: string, prefs: SessionVoicePrefs | null): void {
  try {
    if (prefs === null) window.localStorage.removeItem(KEY(sessionId))
    else window.localStorage.setItem(KEY(sessionId), JSON.stringify(prefs))
  } catch { /* 隐私模式写入失败——忽略 */ }
  emit()
}

/** 内存里的全局配置缓存（announcer 高频读，不每次 fetch）。 */
let cachedGlobal: GlobalVoicePrefs | null = null

/** 静音镜像（host 侧才是权威；这里只用于渲染与快速短路）。 */
let mutedCache = (() => {
  try { return window.localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
})()

/** 更新全局缓存（设置页保存 / 初始拉取时调用）。 */
export function cacheGlobal(global: GlobalVoicePrefs | null): void {
  cachedGlobal = global
  emit()
}

/** 读全局缓存；没缓存时返回保守默认（全部关闭，announcer 零动作）。 */
export function globalPrefs(): GlobalVoicePrefs {
  return cachedGlobal ?? { enabled: false, live: false, summary: false }
}

/** 是否已静音（本地镜像）。 */
export function isMuted(): boolean {
  return mutedCache
}

/** 写静音镜像（host 返回的权威值回填此处）。 */
export function cacheMuted(value: boolean): void {
  mutedCache = value
  try { window.localStorage.setItem(MUTE_KEY, value ? '1' : '0') } catch { /* 忽略 */ }
  emit()
}

/**
 * 计算某会话最终生效的播报设置。
 *
 * 优先级：静音 > 会话覆盖 > 全局配置。会话覆盖存在时 forced=true，
 * 请求会带 force 越过 host 的全局开关——这才让「对话框开关」真正有意义。
 * @param sessionId - 会话 id。
 * @returns 生效设置。
 */
export function effectivePrefs(sessionId: string): EffectiveVoicePrefs {
  const session = readSessionPrefs(sessionId)
  const global = globalPrefs()
  if (mutedCache) {
    return { on: false, live: false, summary: false, forced: session !== null, overridden: session !== null }
  }
  if (session !== null) {
    return {
      on: session.on && (session.live || session.summary),
      live: session.on && session.live,
      summary: session.on && session.summary,
      forced: true,
      overridden: true,
    }
  }
  return {
    on: global.enabled && (global.live || global.summary),
    live: global.enabled && global.live,
    summary: global.enabled && global.summary,
    forced: false,
    overridden: false,
  }
}
