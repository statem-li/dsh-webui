/**
 * webui — 中文思考开关（自 dsh-zh-thinking 合并）。
 *
 * - settings 命名空间 `zh-thinking` 持久化开关（enabled，默认 true）
 * - systemPrompt section `zh-thinking`：按开关注入中文思考指令
 * - HTTP API：GET /api/zh-thinking → { enabled }；POST { enabled } → 更新
 */
import z from '@deepseek-ai/schemastery'

/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any

const INSTRUCTION = '重要:你的全部内部思考过程(reasoning/thinking)必须使用中文书写,与用户当前使用的语言保持一致。仅代码、标识符、文件名、专有名词、技术术语可以保留英文。'

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

/** 注册「中文思考」开关：settings 持久化 + 提示词注入 + HTTP API。 */
export function applyZhThinking(ctx: PluginContext): void {
  // 命名空间注册在 host 层，settings.yaml 持久化；重复注册会抛错，先探测。
  let scope: any
  try {
    scope = ctx.settings.register('zh-thinking', z.object({ enabled: z.boolean().default(true) }))
  } catch (error: any) {
    // 已注册（例如插件被加载两次）——读取现有值继续工作。
    console.log('[zh-thinking] settings namespace already registered:', error?.message ?? error)
  }
  const readEnabled = (): boolean => {
    if (scope !== undefined) {
      try { return scope.get().enabled !== false } catch { /* fallthrough */ }
    }
    return true
  }

  // 提示词片段：text 按开关动态返回；关闭时返回空串，renderPrompt 自动丢弃（零占用）。
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'zh-thinking',
    order: -50,
    text: () => (readEnabled() ? INSTRUCTION : ''),
  }))

  // HTTP API：浏览器设置页通过 fetch 读写开关。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/zh-thinking',
    handler: async (req: any, res: any) => {
      try {
        if (req.method === 'POST') {
          const body = await readBody(req)
          if (body && typeof body.enabled === 'boolean' && scope !== undefined) {
            await scope.update({ enabled: body.enabled })
          }
        }
        const payload = JSON.stringify({ ok: true, enabled: readEnabled() })
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(payload)
      } catch (error: any) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
      }
    },
  }))
}
