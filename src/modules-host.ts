/**
 * webui — 功能模块开关（host 半身）。
 *
 * settings 命名空间 `webui-modules`（settings.yaml 持久化）+ HTTP API：
 *
 *   GET  /api/webui-modules → { ok, modules }（全量布尔表，client 校正缓存用）
 *   POST { modules: { <key>: boolean, ... } } → 部分覆盖合并写入
 *
 * applyModulesHost 返回**本次启动解析出的全量布尔表**，src/index.ts 据此
 * 跳过对应模块的装配（工具 / provider / HTTP API / settings 命名空间都不
 * 注册）。改动持久化后需重启 DSH 生效——host 模块在插件加载时一次性装配，
 * 不做运行时卸载。
 */
import z from '@deepseek-ai/schemastery'
import {
  WEBUI_MODULE_KEYS,
  normalizeModules,
  type WebuiModuleKey,
  type WebuiModuleOverrides,
} from './modules.js'

/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any

/** settings.yaml 命名空间。 */
export const WEBUI_MODULES_NAMESPACE = 'webui-modules'

/** HTTP 路由。 */
export const WEBUI_MODULES_API = '/api/webui-modules'

/** 全量布尔表（每个 key 都有确定值）。 */
export type ResolvedModules = Record<WebuiModuleKey, boolean>

/** settings schema：每个模块一个布尔字段，默认 true。 */
const MODULES_SCHEMA: z<Record<WebuiModuleKey, boolean>> = z.object(
  Object.fromEntries(WEBUI_MODULE_KEYS.map((key) => [key, z.boolean().default(true)])),
) as z<Record<WebuiModuleKey, boolean>>

function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk: any) => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

/**
 * 注册模块开关命名空间 + API，返回本次启动生效的全量模块布尔表。
 * settings 命名空间重复注册（插件加载两次）时降级为只读默认值。
 */
export function applyModulesHost(ctx: PluginContext): ResolvedModules {
  let scope: any
  try {
    scope = ctx.settings.register(WEBUI_MODULES_NAMESPACE, MODULES_SCHEMA)
  } catch (error: any) {
    console.log('[webui-modules] settings namespace already registered:', error?.message ?? error)
  }

  const readOverrides = (): WebuiModuleOverrides => {
    if (scope === undefined) return {}
    try {
      return normalizeModules(scope.get())
    } catch {
      return {}
    }
  }

  const resolveAll = (overrides: WebuiModuleOverrides): ResolvedModules => {
    const out = {} as ResolvedModules
    for (const key of WEBUI_MODULE_KEYS) out[key] = overrides[key] !== false
    return out
  }

  // HTTP API：client 启动后校正 localStorage 缓存；也可脚本化批量开关。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: WEBUI_MODULES_API,
    handler: async (req: any, res: any) => {
      try {
        if (req.method === 'POST' && scope !== undefined) {
          const body = await readBody(req)
          const patch = normalizeModules(body?.modules)
          if (Object.keys(patch).length > 0) {
            const merged = { ...readOverrides(), ...patch }
            await scope.update(MODULES_SCHEMA(merged as Record<WebuiModuleKey, boolean>))
          }
        }
        const payload = JSON.stringify({ ok: true, modules: resolveAll(readOverrides()) })
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(payload)
      } catch (error: any) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
      }
    },
  }))

  return resolveAll(readOverrides())
}
