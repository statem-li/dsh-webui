/**
 * webui — 会话 Web UI 插件（host 半身）。
 *
 * 三块能力：
 *  1. client bundle 发现/装配（dsh.client 声明）。
 *  2. `webui_sync_reasoning` 工具：内置「供应商级推理等级模板」，为
 *     `llm-pi-ai` 中缺失 `reasoningEfforts` 的模型自动补全（参考 OpenHanako
 *     的 known-models 词典做法）。
 *  3. AnySearch 网页搜索 provider（原 dsh-web-search-anysearch 插件）：注册
 *     到 `ctx.web`，替换内置 DeepSeek 搜索为 https://api.anysearch.com。
 *
 * 功能模块开关：settings 命名空间 `webui-modules`（见 modules-host.ts），
 * applyModulesHost 返回本次启动的全量布尔表，为 false 的模块完全不装配。
 */
import type { Context } from 'cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-web'
import { applyZhThinking } from './zh-thinking.js'
import { applyMessageWidth } from './message-width.js'
import { applyTaskDoneSound } from './task-done-sound.js'
import { applyDonePill } from './done-pill.js'
import { applyUpdater } from './updater.js'
import { applyProxy } from './proxy.js'
import { applyBrowser } from './browser/index.js'
import { applyBrowserSpeed } from './browser/speed.js'
import { applyMemory } from './memory/index.js'
import { applyFileExplorer } from './file-explorer.js'
import { applyWorkspaceDirPicker } from './workspace-dir-picker.js'
import { applyUsageHost } from './usage-host.js'
import { applyVisionHelper } from './vision-helper.js'
import { applyMail } from './mail.js'
import { applyRewind } from './rewind.js'
import { applyScreenshot } from './screenshot.js'
import { applyDeliverables } from './deliverables.js'
import { apply as applySkillToggles } from './skill-toggles.js'
import { applyPromptOptimize } from './prompt-optimize.js'
import { applySidebarFloat } from './sidebar-float.js'
import { applyAppearance } from './appearance.js'
import { applyAutomationHost } from './automation/index.js'
import { applyPlanweaveHost } from './planweave/host.js'
import { applyPerfBench } from './perf-bench.js'
import { applyDevRoleProbe } from './devrole-probe.js'
import { applyModulesHost } from './modules-host.js'
import {
  AnySearchSearchProvider,
  ANYSEARCH_DEFAULT_BASE_URL,
} from './provider.js'
import type { AnySearchSearchProviderOptions } from './provider.js'

export const name = 'dsh-webui'
export const inject = ['settings', 'tools', 'web', 'systemPrompt', 'webServer', 'sandboxPolicy', 'fs', 'workspaceRegistry', 'credentials', 'sessions', 'sessionPersistence', 'llm', 'shell']

// ── 推理等级补全 ────────────────────────────────────────────────────────────

/** 供应商级推理等级模板：等级名 → 发送给该供应商的线值（string 或 null）。 */
const PROVIDER_REASONING_TEMPLATES: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  // anthropic-messages：思考用 thinking 块 + effort 字符串
  sensenova: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
  agnes: { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
  // openai-completions：reasoning_effort 参数；off 省略参数
  rhythm: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  bai: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  pl: { off: null, low: 'low', high: 'high', xhigh: 'max' },
}

/** 一个供应商配置的松散形状（只读最小字段，其余原样透传）。 */
interface ProviderDraft {
  models?: Array<Record<string, unknown>>
  [key: string]: unknown
}

interface LlmPiAiConfig {
  providers?: Record<string, ProviderDraft>
}

// ── AnySearch 网页搜索 ───────────────────────────────────────────────────────

/** AnySearch API key 默认环境变量。 */
const DEFAULT_API_KEY_ENV = 'ANYSEARCH_API_KEY'

/** AnySearch 插件配置（全部可选，apply 填环境变量与常量默认值）。 */
export interface AnySearchConfig {
  /** 字面 API key；优先用 apiKeyEnv，避免密钥进配置文件。 */
  apiKey?: string
  /** 每次搜索解析的凭据引用；默认 ANYSEARCH_API_KEY。 */
  apiKeyEnv?: string
  /** API 端点基址；自动拼接 /v1/search。默认公共 API。 */
  baseURL?: string
  /** 请求未带 maxResults 时的默认结果数。 */
  maxResults?: number
  /** 可选子域能力标签，如 code.doc。 */
  tag?: string
  /** 可选区域：cn 或 intl。 */
  zone?: string
  /** 可选首选语言，如 zh-CN 或 en。 */
  language?: string
}

const AnySearchConfigSchema: z<AnySearchConfig> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  maxResults: z.number().step(1).min(1),
  tag: z.string(),
  zone: z.string(),
  language: z.string(),
})

/** 设置命名空间承载 provider 的 key 引用与选项。 */
const WEB_SEARCH_ANYSEARCH_SETTINGS_NAMESPACE = settingsNamespace('web-search-anysearch')

/**
 * 把已解析的 section 投影为 provider 下一次搜索的选项；环境变量回退放在这
 * 里而非 provider 内，provider 读到的每个值都已完全默认化。
 */
function resolveAnySearchOptions(ctx: Context, config: AnySearchConfig): AnySearchSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? ANYSEARCH_DEFAULT_BASE_URL,
    ...config.maxResults !== undefined ? { maxResults: config.maxResults } : {},
    ...config.tag !== undefined && config.tag.length > 0 ? { tag: config.tag } : {},
    ...config.zone !== undefined && config.zone.length > 0 ? { zone: config.zone } : {},
    ...config.language !== undefined && config.language.length > 0 ? { language: config.language } : {},
  }
}

// ── 插件体 ──────────────────────────────────────────────────────────────────

/** webui 组合配置：anysearch 字段直接读取（兼容旧配置），其余能力子配置可选覆盖默认。 */
export interface WebuiConfig extends AnySearchConfig {
  updater?: import('./updater.js').UpdaterConfig
  browser?: Partial<import('./browser/index.js').Config>
  memory?: Partial<import('./memory/types.js').MemoryConfig>
  /** 用量统计 + 技能管理配置（透传给 dsh-usage-skill 的 host）。 */
  usage?: any
  /** 辅助视觉 + 生图配置（自 dsh-vision-helper 合并）。 */
  visionHelper?: Partial<import('./vision-helper.js').Config>
  /** 邮箱验证码配置（自 dsh-mail 合并）。 */
  mail?: Partial<import('./mail.js').MailConfig>
}

/**
 * 注册 `webui_sync_reasoning` 工具 + AnySearch 搜索 provider + 中文思考开关
 * + 任务完成提示音 + 辅助视觉/生图。
 * @param ctx - host 上下文。
 * @param config - 组合配置（默认空对象，各能力自带默认值）。
 */
export async function apply(ctx: Context, config: WebuiConfig = {}): Promise<void> {
  // 0) 功能模块开关：settings 命名空间 webui-modules + GET/POST /api/webui-modules。
  //    为 false 的模块下方完全不装配（client 半身经同一份 key 表对齐裁剪）。
  const modules = applyModulesHost(ctx as any)

  // 1) 推理等级自动补全工具。
  if (modules.reasoningSync) {
    ctx.tools.register(defineTool({
      name: 'webui_sync_reasoning',
      description: '为 settings 里 llm-pi-ai 各供应商中缺失 reasoningEfforts（推理等级）的模型，按内置供应商级模板自动补全，免去手工编辑 settings.yaml。已有配置或未收录供应商不受影响。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            patched: { type: 'array', required: true, items: { type: 'string' } },
            skipped: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `已补全 ${value.patched.length} 个模型的推理等级：${value.patched.join(', ') || '(无)'}。` +
            `跳过 ${value.skipped.length} 个：${value.skipped.join(', ') || '(无)'}。`,
        }],
      },
      async execute() {
        const ns = settingsNamespace('llm-pi-ai')
        const raw = ctx.settings.get(ns) as LlmPiAiConfig | undefined
        const providers = raw?.providers
        const patched: string[] = []
        const skipped: string[] = []
        if (providers === undefined) return { patched, skipped }

        let changed = false
        const nextProviders: Record<string, ProviderDraft> = {}
        for (const [providerId, provider] of Object.entries(providers)) {
          const template = PROVIDER_REASONING_TEMPLATES[providerId]
          const models = Array.isArray(provider?.models) ? provider.models : []
          if (template === undefined || models.length === 0) {
            nextProviders[providerId] = provider
            continue
          }
          const nextModels = models.map((model) => {
            const id = typeof model.id === 'string' ? model.id : ''
            if (model.reasoningEfforts !== undefined) return model
            if (id === '') {
              skipped.push(`${providerId}/<无 id>`)
              return model
            }
            patched.push(`${providerId}/${id}`)
            changed = true
            return { ...model, reasoningEfforts: { ...template } }
          })
          nextProviders[providerId] = { ...provider, models: nextModels }
        }

        if (changed) {
          await ctx.settings.update(ns, { providers: nextProviders })
        }
        return { patched, skipped }
      },
      presentCall: () => ({ card: 'generic', title: '同步模型推理等级', kind: 'other', rawInput: null }),
    }))
  }

  // 2) AnySearch 搜索 provider。
  if (modules.webSearch) {
    let current: () => AnySearchConfig = () => config
    installSettingsSection(ctx, WEB_SEARCH_ANYSEARCH_SETTINGS_NAMESPACE, AnySearchConfigSchema, config, {
      setSource: (source) => {
        current = source
      },
      onChange: () => {},
    })
    ctx.web.registerSearchProvider(new AnySearchSearchProvider(() => resolveAnySearchOptions(ctx, current())))
  }

  // 3) 中文思考开关（自 dsh-zh-thinking 合并）。
  if (modules.zhThinking) applyZhThinking(ctx)

  // 3.5) 发送对话宽度（本人消息气泡宽度）：settings 持久化 + /api/webui-message-width。
  if (modules.messageWidth) applyMessageWidth(ctx)

  // 4) 任务完成提示音 + 对话完成桌面卡片（自 dsh-task-done-sound 合并）。
  // cardEnabled:false —— 桌面右下角完成卡片已按用户要求禁用（2026-08），
  // 回合结束只播提示音（仍受设置页「插件任务完成提示音」开关控制）。
  if (modules.doneSound) applyTaskDoneSound(ctx, { cardEnabled: false })

  // 4.5) 对话完成胶囊：全局监听 turn/end，/api/webui-done-pill 供顶部胶囊轮询。
  if (modules.donePill) applyDonePill(ctx)

  // 5) DSH 壳管理 + 一键更新（自 dsh-updater 合并；config.updater 可选覆盖）。
  if (modules.updater) applyUpdater(ctx, config.updater)

  // 6) 网络代理（自 dsh-proxy 合并）。
  if (modules.proxy) applyProxy(ctx)

  // 7) AI 浏览器操作（自 dsh-browser 合并；config.browser 可选覆盖）。
  // 固定有头：本机真实窗口启动即最大化（≈电脑分辨率），画面经 screencast
  // 同步到 Web GUI 右侧滑出的预览抽屉（只读观看）。
  if (modules.browser) {
    applyBrowser(ctx, {
      chromePath: '', port: 0, screenshotDir: '',
      ...config.browser,
    })
    // 浏览器提速策略：系统提示词注入 + /api/dsh-browser/speed 开关（随浏览器模块联动）。
    applyBrowserSpeed(ctx)
  }

  // 8) 本地记忆引擎（自 dsh-memory 合并；config.memory 可选覆盖）。
  if (modules.memory) applyMemory(ctx, config.memory)

  // 9) 工作区文件浏览器（自 dsh-file-explorer 合并）。
  if (modules.fileExplorer) applyFileExplorer(ctx)

  // 9.5) 工作区目录选择器：应用内弹窗浏览目录（/api/webui-dir-picker），
  // 供「添加工作区」选择文件夹（shadow 官方 native surface）。
  if (modules.dirPicker) applyWorkspaceDirPicker(ctx)

  // 10) 用量统计 + 技能管理（自 dsh-usage-skill 融合；host 复用其 lib 产物）。
  if (modules.usage) await applyUsageHost(ctx, config.usage)

  // 11) 辅助视觉 + 生图（自 dsh-vision-helper 合并）：vision_describe / generate_image / 图片降级 / HTTP 接口。
  if (modules.vision) applyVisionHelper(ctx, config.visionHelper ?? {})

  // 12) 邮箱验证码（自 dsh-mail 合并）：mail_get_code 工具 + /api/webui-mail 路由。
  if (modules.mail) applyMail(ctx, config.mail ?? {})

  // 13) 对话「退回」（自 dsh-rewind）：user 消息文件快照 + /api/webui-rewind 回退路由。
  if (modules.rewind) applyRewind(ctx)

  // 14) 对话「截图渲染」：渲染会话长图（/api/webui-screenshot）。
  if (modules.screenshot) applyScreenshot(ctx)

  // 15) 技能开关（/api/skill-toggles）：每个技能禁用/开启 + 技能包一键开关。
  if (modules.skills) await applySkillToggles(ctx)

  // 16) 提示词优化（/api/webui-prompt-optimize）：对话框内用选中模型优化提示词。
  if (modules.promptOptimize) applyPromptOptimize(ctx)

  // 17) 左侧悬浮侧边栏：设置项「启动服务时默认折叠」持久化 + /api/sidebar-float。
  if (modules.sidebarFloat) applySidebarFloat(ctx)

  // 18) 外观设置：玻璃质感（Glassmorphism）开关持久化 + /api/webui-appearance。
  if (modules.appearance) applyAppearance(ctx)

  // 19) 定时自动化（openhanako 式）：CronStore + 服务端调度器 + automation 工具
  //     （/api/webui-automation：任务 CRUD / 建议确认 / 运行历史 / 完成事件）。
  if (modules.automation) applyAutomationHost(ctx)

  // 20) PlanWeave：本地计划任务图 + 认领/执行/评审/反馈循环（@planweave-ai/runtime 内核 + ctx.llm 执行器）。
  if (modules.planweave) applyPlanweaveHost(ctx)

  // 21) 推理性能基准测试（/api/perf-bench）：TTFT / TPS / E2E / RPS / 预填充速度。
  applyPerfBench(ctx)

  // 22) 供应商 Developer Role 兼容性一键检测 + 自动修复（/api/webui-devrole/probe）。
  applyDevRoleProbe(ctx)

  // 23) 会话产物清单（/api/webui-deliverables）：fs 写入事件按会话持久化
  //     （跨重启存活），供消息操作栏「产物」大卡片回看（官方产物行重启即逝）。
  applyDeliverables(ctx)
}
