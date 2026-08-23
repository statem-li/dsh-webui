/**
 * webui — 供应商 Developer Role 兼容性一键检测 + 自动修复。
 *
 * 背景：pi-ai 对不认识的 https 域名网关默认按 OpenAI 本尊对待——推理模型的
 * system prompt 以新式 `"developer"` 角色发送。大量中转/聚合网关不认这个角色，
 * 表现为该供应商所有推理模型一直 HTTP 400 连不通，而普通测试一切正常。
 *
 * 本模块提供「一键兼容检测」：对每个 openai-completions 供应商真实发一条
 * developer 角色的最小请求，再用 system 角色对照——developer 失败而 system
 * 成功即判定「不支持」，随后自动把该供应商的路由级 `compat.supportsDeveloperRole:
 * false` 写入 settings（热重载即时生效），全程无需手动编辑配置。
 *
 * HTTP API：
 *   POST /api/webui-devrole/probe  启动批量检测（409 = 已有检测进行中）
 *   GET  /api/webui-devrole/probe  轮询检测状态（items 逐项点亮）
 *
 * 判定语义：
 *   supported   developer 请求成功——保持现状（不动配置）
 *   unsupported developer 失败但 system 成功——已自动写入 supportsDeveloperRole: false
 *   unknown     两者都失败（密钥/网络/模型问题）——不动配置，note 带原因
 */

/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any

const PROBE_API = '/api/webui-devrole/probe'
const PROBE_TIMEOUT_MS = 15_000

/** 一家供应商的检测结果。 */
interface ProbeItem {
  /** route key（settings providers 字典键）。 */
  key: string
  /** 显示名。 */
  label: string
  /** pending / running / done。 */
  status: 'pending' | 'running' | 'done'
  /** true=supported，false=unsupported（已修复），null=unknown。 */
  ok: boolean | null
  /** 测试用的模型 id。 */
  model: string
  /** 结论说明（失败原因摘要等）。 */
  note: string
}

interface ProbeState {
  running: boolean
  startedAt: number | null
  finishedAt: number | null
  error: string
  /** 是否有修复被写入 settings。 */
  saved: boolean
  saveError: string
  items: ProbeItem[]
}

let probe: ProbeState | null = null

function snapshot(): ProbeState | null {
  return probe === null ? null : { ...probe, items: probe.items.map(i => ({ ...i })) }
}

async function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk: any) => { data += chunk })
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })
}

function reply(res: any, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

/** 从 credentials 服务解析 apiKeyEnv 命名的密钥；解析不到返回 null。 */
async function resolveApiKey(ctx: PluginContext, apiKeyEnv: unknown): Promise<string | null> {
  if (typeof apiKeyEnv !== 'string' || apiKeyEnv.length === 0) return null
  const credentials = ctx.get('credentials')
  if (!credentials) return null
  try {
    const resolved = await credentials.resolve(apiKeyEnv)
    return resolved && typeof resolved.value === 'string' && resolved.value.length > 0
      ? resolved.value
      : null
  } catch {
    return null
  }
}

/** 发一条最小 chat completion 探测；返回 HTTP 状态与截断后的错误体。 */
async function probeRole(
  baseURL: string,
  apiKey: string,
  model: string,
  role: 'developer' | 'system',
): Promise<{ httpOk: boolean; status: number; error: string }> {
  const base = baseURL.replace(/[\\/]+$/, '')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role, content: 'ping' }],
        max_tokens: 16,
        stream: false,
      }),
      signal: ctrl.signal,
    })
    const text = await res.text().catch(() => '')
    return {
      httpOk: res.ok,
      status: res.status,
      error: res.ok ? '' : `${res.status} ${text.slice(0, 200)}`.trim(),
    }
  } catch (error: any) {
    return { httpOk: false, status: 0, error: String(error?.message ?? error).slice(0, 200) }
  } finally {
    clearTimeout(timer)
  }
}

/** 一个供应商 profile 里挑测试模型：优先声明了推理等级（off 外）的，否则第一个。 */
function pickModel(profile: any): string {
  const models = Array.isArray(profile?.models) ? profile.models : []
  for (const m of models) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || m.id.length === 0) continue
    const efforts = m.reasoningEfforts
    if (efforts !== undefined && efforts !== false && efforts !== null
      && typeof efforts === 'object'
      && Object.keys(efforts).some(k => k !== 'off')) {
      return m.id
    }
  }
  for (const m of models) {
    if (m && typeof m === 'object' && typeof m.id === 'string' && m.id.length > 0) return m.id
  }
  return ''
}

/**
 * 该端点是否命中 pi-ai 的自动豁免规则（detectCompat 镜像）：命中者无论探测
 * 结果如何都使用传统 system 角色，永远不需要 developer-role 修复。名单与
 * 适配器一致：sensenova.cn、opencode.ai、openrouter.ai、http:/localhost/IPv4
 * 私有网关。
 */
function autoUsesSystem(providerKey: string, baseURL: string): boolean {
  if (providerKey === 'opencode' || baseURL.includes('opencode.ai')) return true
  if (baseURL.includes('sensenova.cn')) return true
  if (baseURL.includes('openrouter.ai')) return true
  try {
    const url = new URL(baseURL)
    if (url.protocol === 'http:') return true
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3})$/i.test(url.hostname)) return true
  } catch { /* 非法 URL 按未豁免处理 */ }
  return false
}

/** 批量探测全部 openai-completions 供应商；结束后自动写入修复。 */
async function runProbeAsync(ctx: PluginContext): Promise<void> {
  const st = probe!
  const finish = (): void => {
    st.running = false
    st.finishedAt = Date.now()
  }
  try {
    const ns = 'llm-pi-ai'
    const section: any = ctx.settings.get(ns)
    const providers = section?.providers ?? {}

    // 待测清单：openai-completions 且配了 baseURL 的路由。
    const targets = Object.entries(providers as Record<string, any>)
      .filter(([, p]) => p
        && typeof p === 'object'
        && (p.api === undefined || p.api === 'openai-completions')
        && typeof p.baseURL === 'string'
        && p.baseURL.length > 0)

    // 先登记全部待测项（pending）：前端轮询立刻看到完整清单，随后逐项点亮。
    st.items = targets.map(([key, p]) => ({
      key,
      label: typeof p.displayName === 'string' && p.displayName.trim().length > 0
        ? p.displayName.trim()
        : key,
      status: 'pending',
      ok: null,
      model: pickModel(p),
      note: '',
    }))

    for (const [index, [key, p]] of targets.entries()) {
      const item = st.items[index]!
      item.status = 'running'
      if (item.model === '') {
        item.status = 'done'
        item.ok = null
        item.note = '没有可测试的模型（models 为空）'
        continue
      }

      const apiKey = await resolveApiKey(ctx, p.apiKeyEnv)
      if (apiKey === null) {
        item.status = 'done'
        item.ok = null
        item.note = `未找到 API 密钥（${p.apiKeyEnv || '未命名引用'}），跳过`
        continue
      }

      const dev = await probeRole(p.baseURL, apiKey, item.model, 'developer')
      if (dev.httpOk) {
        item.status = 'done'
        item.ok = true
        item.note = '接受 developer 角色'
        continue
      }
      const sys = await probeRole(p.baseURL, apiKey, item.model, 'system')
      if (sys.httpOk) {
        item.status = 'done'
        item.ok = false
        item.note = `拒绝 developer 角色（${dev.error || 'HTTP 错误'}）；已自动改用 system`
        continue
      }
      item.status = 'done'
      item.ok = null
      item.note = autoUsesSystem(key, p.baseURL)
        ? `两种角色均失败（system: ${sys.error || 'HTTP 错误'}）。该端点命中内置豁免规则，本就使用 system 角色，无需处理`
        : `两种角色均失败（system: ${sys.error || 'HTTP 错误'}）——请检查密钥/模型/网络`
    }

    // 自动落盘：对 unsupported 的供应商写路由级 compat.supportsDeveloperRole=false
    //（保留既有 compat 键；模型级显式声明优先级更高、一律不碰）。
    const fixKeys = st.items.filter(i => i.ok === false).map(i => i.key)
    if (fixKeys.length > 0) {
      try {
        const nextProviders: Record<string, any> = {}
        for (const key of fixKeys) {
          const p = providers[key]
          const compat = p && typeof p.compat === 'object' && p.compat !== null
            ? { ...p.compat, supportsDeveloperRole: false }
            : { supportsDeveloperRole: false }
          nextProviders[key] = { compat }
        }
        await ctx.settings.update(ns, { providers: nextProviders })
        st.saved = true
      } catch (error: any) {
        st.saveError = String(error?.message ?? error).slice(0, 300)
      }
    }
    finish()
  } catch (error: any) {
    st.error = String(error?.message ?? error).slice(0, 300)
    finish()
  }
}

/** 注册 HTTP 接口。 */
export function applyDevRoleProbe(ctx: PluginContext): void {
  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: PROBE_API,
      handler: async (req: any, res: any) => {
        try {
          if (req.method === 'POST') {
            await readBody(req)
            if (probe !== null && probe.running) {
              return reply(res, 409, { ok: false, error: '已有兼容性检测进行中，请稍候' })
            }
            probe = {
              running: true,
              startedAt: Date.now(),
              finishedAt: null,
              error: '',
              saved: false,
              saveError: '',
              items: [],
            }
            void runProbeAsync(ctx)
            return reply(res, 200, { ok: true, state: snapshot() })
          }
          return reply(res, 200, { ok: true, state: snapshot() })
        } catch (error: any) {
          return reply(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })
  }, 'webui: devrole probe')
}
