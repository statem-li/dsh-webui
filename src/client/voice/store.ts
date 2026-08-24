/**
 * webui — 语音播报会话级状态（client 半身）。
 *
 * 全局配置在 host settings（/api/webui-voice）；本模块只管理「按会话」的
 * 覆盖（对话框内的播报开关）。每会话一份 localStorage：
 *
 *   dsh-webui.voice.session.<id> = { live: boolean, summary: boolean } | null
 *
 * null = 跟随全局配置；写入了就是本会话覆盖（重启后仍在）。全局配置缓存
 * 一份内存副本，避免 announcer 每次增量都要 fetch。
 */

export interface SessionVoicePrefs {
  live: boolean
  summary: boolean
}

const KEY = (sessionId: string): string => `dsh-webui.voice.session.${sessionId}`

/** 读某会话的覆盖；无覆盖返回 null（跟随全局）。 */
export function readSessionPrefs(sessionId: string): SessionVoicePrefs | null {
  try {
    const raw = window.localStorage.getItem(KEY(sessionId))
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    return {
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
}

/** 内存里的全局配置缓存（announcer 高频读，不每次 fetch）。 */
let cachedGlobal: { enabled: boolean, live: boolean, summary: boolean } | null = null

/** 更新全局缓存（设置页保存 / 初始拉取时调用）。 */
export function cacheGlobal(global: { enabled: boolean, live: boolean, summary: boolean } | null): void {
  cachedGlobal = global
}

/** 读全局缓存；没缓存时返回保守默认（全部关闭，announcer 零动作）。 */
export function globalPrefs(): { enabled: boolean, live: boolean, summary: boolean } {
  return cachedGlobal ?? { enabled: false, live: false, summary: false }
}
