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
import { applyMemory } from './memory/index.js'
import { applyFileExplorer } from './file-explorer.js'
import { applyWorkspaceDirPicker } from './workspace-dir-picker.js'
import { applyUsageHost } from './usage-host.js'
import { applyVisionHelper } from './vision-helper.js'
import { applyMail } from './mail.js'
import { applyRewind } from './rewind.js'
import { applyScreenshot } from './screenshot.js'
import { apply as applySkillToggles } from './skill-toggles.js'
import { applyPromptOptimize } from './prompt-optimize.js'
import { applySidebarFloat } from './sidebar-float.js'
import { applyAppearance } from './appearance.js'
import { applyAutomationHost } from './automation-host.js'
import { applyPlanweaveHost } from './planweave/host.js'
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
  // 1) 推理等级自动补全工具。
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

  // 2) AnySearch 搜索 provider。
  let current: () => AnySearchConfig = () => config
  installSettingsSection(ctx, WEB_SEARCH_ANYSEARCH_SETTINGS_NAMESPACE, AnySearchConfigSchema, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new AnySearchSearchProvider(() => resolveAnySearchOptions(ctx, current())))

  // 3) 中文思考开关（自 dsh-zh-thinking 合并）。
  applyZhThinking(ctx)

  // 3.5) 发送对话宽度（本人消息气泡宽度）：settings 持久化 + /api/webui-message-width。
  applyMessageWidth(ctx)

  // 4) 任务完成提示音 + 对话完成桌面卡片（自 dsh-task-done-sound 合并）。
  applyTaskDoneSound(ctx)

  // 4.5) 对话完成胶囊：全局监听 turn/end，/api/webui-done-pill 供顶部胶囊轮询。
  applyDonePill(ctx)

  // 5) DSH 壳管理 + 一键更新（自 dsh-updater 合并；config.updater 可选覆盖）。
  applyUpdater(ctx, config.updater)

  // 6) 网络代理（自 dsh-proxy 合并）。
  applyProxy(ctx)

  // 7) AI 浏览器操作（自 dsh-browser 合并；config.browser 可选覆盖）。
  // 固定有头：本机真实窗口启动即最大化（≈电脑分辨率），画面经 screencast
  // 同步到 Web GUI 右侧滑出的预览抽屉（只读观看）。
  applyBrowser(ctx, {
    chromePath: '', port: 0, screenshotDir: '',
    ...config.browser,
  })

  // 8) 本地记忆引擎（自 dsh-memory 合并；config.memory 可选覆盖）。
  applyMemory(ctx, config.memory)

  // 9) 工作区文件浏览器（自 dsh-file-explorer 合并）。
  applyFileExplorer(ctx)

  // 9.5) 工作区目录选择器：应用内弹窗浏览目录（/api/webui-dir-picker），
  // 供「添加工作区」选择文件夹（shadow 官方 native surface）。
  applyWorkspaceDirPicker(ctx)

  // 10) 用量统计 + 技能管理（自 dsh-usage-skill 融合；host 复用其 lib 产物）。
  await applyUsageHost(ctx, config.usage)

  // 11) 辅助视觉 + 生图（自 dsh-vision-helper 合并）：vision_describe / generate_image / 图片降级 / HTTP 接口。
  applyVisionHelper(ctx, config.visionHelper ?? {})

  // 12) 邮箱验证码（自 dsh-mail 合并）：mail_get_code 工具 + /api/webui-mail 路由。
  applyMail(ctx, config.mail ?? {})

  // 13) 对话「退回」（自 dsh-rewind）：user 消息文件快照 + /api/webui-rewind 回退路由。
  applyRewind(ctx)

  // 14) 对话「截图渲染」：渲染会话长图（/api/webui-screenshot）。
  applyScreenshot(ctx)

  // 15) 技能开关（/api/skill-toggles）：每个技能禁用/开启 + 技能包一键开关。
  await applySkillToggles(ctx)

  // 16) 提示词优化（/api/webui-prompt-optimize）：对话框内用选中模型优化提示词。
  applyPromptOptimize(ctx)

  // 17) 左侧悬浮侧边栏：设置项「启动服务时默认折叠」持久化 + /api/sidebar-float。
  applySidebarFloat(ctx)

  // 18) 外观设置：玻璃质感（Glassmorphism）开关持久化 + /api/webui-appearance。
  applyAppearance(ctx)

  // 19) 自动化执行引擎（/api/webui-automation）：真实执行任务步骤 + 文件下载/打开所在文件夹。
  applyAutomationHost(ctx)

  // 20) PlanWeave：本地计划任务图 + 认领/执行/评审/反馈循环（@planweave-ai/runtime 内核 + ctx.llm 执行器）。
  applyPlanweaveHost(ctx)
}
