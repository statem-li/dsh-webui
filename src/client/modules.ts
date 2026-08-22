/**
 * modules — 功能模块开关（client 半身）。
 *
 * client bundle 加载后 apply() 是同步执行的，槽位注册必须当场决定，因此
 * 采用「localStorage 同步读 + 服务端异步校正」双通道（与 sidebar-float
 * 同一模式）：
 *
 *  1. 启动：同步读 localStorage `dsh-webui.modules`，立即按它裁剪注册；
 *  2. 校正：后台 fetch `/api/webui-modules`（host 按 settings.yaml 返回
 *     全量布尔表），写回 localStorage——下次刷新对齐服务端配置。
 *
 * 语义与 host 一致：缺省 = 启用，只有显式 false 关闭；只存被显式关闭的
 * 模块即可，升级新增模块时老配置自动保持启用。
 */
import {
  WEBUI_MODULE_KEYS,
  normalizeModules,
  isModuleEnabled,
  type WebuiModuleKey,
  type WebuiModuleOverrides,
} from '../modules.js'

export { isModuleEnabled }
export type { WebuiModuleKey, WebuiModuleOverrides }

/** localStorage 缓存 key。 */
export const MODULES_STORAGE_KEY = 'dsh-webui.modules'

/** host API 路径（公开路由，远程访问也可达）。 */
const MODULES_API = '/api/webui-modules'

/** 同步读本地缓存的部分覆盖表；损坏/缺失时返回空表（全启用）。 */
export function readStoredModules(): WebuiModuleOverrides {
  try {
    const raw = localStorage.getItem(MODULES_STORAGE_KEY)
    if (raw === null) return {}
    return normalizeModules(JSON.parse(raw))
  } catch {
    return {}
  }
}

/** 写本地缓存（部分覆盖表）。 */
function storeModules(modules: WebuiModuleOverrides): void {
  try {
    localStorage.setItem(MODULES_STORAGE_KEY, JSON.stringify(modules))
  } catch { /* 隐私模式等场景写入失败——忽略，本次仍按内存值工作 */ }
}

/**
 * 后台拉取服务端模块表并校正本地缓存（fire-and-forget，绝不阻塞启动、
 * 绝不抛错）。服务端不可达（如旧版本 host / 网络异常）时保持现状。
 */
export function syncServerModules(): void {
  void (async () => {
    try {
      const res = await fetch(MODULES_API, { method: 'GET' })
      if (!res.ok) return
      const data = await res.json() as { ok?: boolean; modules?: unknown }
      if (!data?.ok || typeof data.modules !== 'object' || data.modules === null) return
      // 只持久化「显式关闭」的项，缓存最小化且语义稳定。
      const all = data.modules as Record<string, unknown>
      const disabled: WebuiModuleOverrides = {}
      for (const key of WEBUI_MODULE_KEYS) {
        if (all[key] === false) (disabled as Record<string, boolean>)[key] = false
      }
      const current = readStoredModules()
      const before = JSON.stringify(current)
      const after = JSON.stringify(disabled)
      if (before !== after) storeModules(disabled)
    } catch { /* 静默：离线/旧 host 下沿用上次缓存 */ }
  })()
}
