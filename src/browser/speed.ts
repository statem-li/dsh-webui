/**
 * webui — AI 浏览器提速策略（host 半身，自 dsh-browser 提速优化拆出）。
 *
 * 背景（2026-09 埋点实测）：浏览器工具每一步动作之间是一整轮 LLM 推理
 * （Max 推理档实测单轮 20~26s），页面执行本身 <0.5s——推理轮数是唯一主
 * 导成本。同一 150 动作表单任务：逐 click/type ≈115 分钟；browser_batch
 * （15 次调用）≈9 分钟；browser_evaluate 一段 JS ≈25s（JS 本身仅 1ms）。
 *
 * 本模块把实测有效的提速策略作为系统提示词常驻注入，让模型在浏览器任
 * 务中默认走批量路径，不依赖用户记得在指令里点名 batch/evaluate：
 *
 * - settings 命名空间 `browser-speed` 持久化开关（enabled，默认 true）
 * - systemPrompt section `browser-speed`：按开关注入策略文本（关闭时空串，
 *   renderPrompt 自动丢弃，零 token 占用）
 * - HTTP API：GET /api/dsh-browser/speed → { ok, enabled }；POST { enabled }
 *
 * 由 src/index.ts 在 modules.browser 开启时装配（浏览器未装配则本模块无意义）。
 */
import z from '@deepseek-ai/schemastery'

/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any

/** 注入的系统提示词片段（命令式、条件化措辞，避免误导非浏览器场景）。 */
const SPEED_INSTRUCTION = [
  '【网页操作提速策略】浏览器每一步动作之间是一整轮 LLM 推理（常达数十秒），而页面执行本身不到 0.5 秒——推理轮数是唯一主导成本。执行网页任务时遵守：',
  '1) 批量 DOM 操作（填多个输入框、批量勾选/下拉选择、读取或核对页面数据）优先用一次 browser_evaluate 写一段 JS 完成，不要逐个 click/type；',
  '2) 需要真实事件语义的连续操作用 browser_batch 合并执行（每次最多 10 个动作），中间动作一律 returnSnapshot:false，只在任务关键节点查看快照；',
  '3) 能拼出最终 URL 就直接 browser_navigate 打开目标页，不做「首页→搜索→点结果」式逐跳导航；',
  '4) 获取页面信息只用 snapshot/evaluate 返回的文本，尽量不截图；确需看画面细节时（视觉核对/图表/验证码/样式确认），browser_screenshot 传 selector 参数只截目标元素区域再 vision_describe 该路径，不要整页截图；',
  '5) 仅当下一步确实取决于上一步的页面反馈、或单次独立操作时才逐步调用。',
].join('\n')

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

/** 注册「浏览器提速模式」：settings 持久化 + 系统提示词注入 + HTTP API。 */
export function applyBrowserSpeed(ctx: PluginContext): void {
  // 命名空间注册在 host 层，settings.yaml 持久化；重复注册会抛错，先探测。
  let scope: any
  try {
    scope = ctx.settings.register('browser-speed', z.object({ enabled: z.boolean().default(true) }))
  } catch (error: any) {
    // 已注册（例如插件被加载两次）——读取现有值继续工作。
    console.log('[browser-speed] settings namespace already registered:', error?.message ?? error)
  }
  const readEnabled = (): boolean => {
    if (scope !== undefined) {
      try { return scope.get().enabled !== false } catch { /* fallthrough */ }
    }
    return true
  }

  // 系统提示词注入：关闭时返回空串，renderPrompt 自动丢弃（零占用）。
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'browser-speed',
    order: -40,
    text: () => (readEnabled() ? SPEED_INSTRUCTION : ''),
  }))

  // HTTP API：设置页开关行通过 fetch 读写。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-browser/speed',
    handler: async (req: any, res: any) => {
      const respond = (status: number, payload: any) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload))
      }
      try {
        if (req.method === 'POST') {
          const body = await readBody(req)
          if (body && typeof body.enabled === 'boolean' && scope !== undefined) {
            await scope.update({ enabled: body.enabled })
          }
          return respond(200, { ok: true, enabled: readEnabled() })
        }
        respond(200, { ok: true, enabled: readEnabled() })
      } catch (error: any) {
        respond(500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), '@dsh-external/dsh-browser: speed route')
}
