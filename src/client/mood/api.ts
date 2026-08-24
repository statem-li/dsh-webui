/**
 * webui — MOOD 设置页数据面（client 半身）。
 *
 * 只有一个 host 路由 `/api/webui-mood`：GET 一次拿齐「总开关 + 默认人设 +
 * 各 Agent 覆盖 + preset 名单」，POST 部分合并写入。设置页不额外走 wire 的
 * agentPreset.list——名单已经随 GET 一起回来了。
 */

/** preset 名单行（host 从 ctx.agentPresets.list() 投影而来）。 */
export interface MoodPresetRow {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly isDefault: boolean
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

/** 单个 Agent 的覆盖配置。 */
export interface MoodEntry {
  readonly enabled: boolean
  readonly persona: string
}

/** GET 响应。 */
export interface MoodState {
  readonly enabled: boolean
  readonly defaultPersona: string
  readonly presets: Readonly<Record<string, MoodEntry>>
  readonly roster: readonly MoodPresetRow[]
  /** 出厂人设模板（「恢复默认」用）。 */
  readonly template: string
}

/** POST 载荷：只带要改的字段；presets 里给 null 表示删除该 Agent 的覆盖。 */
export interface MoodPatch {
  readonly enabled?: boolean
  readonly defaultPersona?: string
  readonly presets?: Readonly<Record<string, MoodEntry | null>>
}

const API = '/api/webui-mood'

/** 把响应体投影成 MoodState（字段缺失一律补安全默认）。 */
function project(data: any): MoodState | null {
  if (data?.ok !== true) return null
  return {
    enabled: data.enabled !== false,
    defaultPersona: typeof data.defaultPersona === 'string' ? data.defaultPersona : '',
    presets: (data.presets ?? {}) as Readonly<Record<string, MoodEntry>>,
    roster: Array.isArray(data.roster) ? data.roster : [],
    template: typeof data.template === 'string' ? data.template : '',
  }
}

/** 读当前状态（失败返回 null，调用方显示占位而非报错阻塞）。 */
export async function fetchMood(): Promise<MoodState | null> {
  try {
    const res = await fetch(API, { cache: 'no-store' })
    if (!res.ok) return null
    return project(await res.json())
  } catch {
    return null
  }
}

/** 写入部分字段，回读写入后的状态。 */
export async function saveMood(patch: MoodPatch): Promise<MoodState | null> {
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
