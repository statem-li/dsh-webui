import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { applyZhThinking } from './zh-thinking.js';
import { applyTaskDoneSound } from './task-done-sound.js';
import { applyUpdater } from './updater.js';
import { applyProxy } from './proxy.js';
import { applyBrowser } from './browser/index.js';
import { applyMemory } from './memory/index.js';
import { applyFileExplorer } from './file-explorer.js';
import { applyUsageHost } from './usage-host.js';
import { applyVisionHelper } from './vision-helper.js';
import { applyMail } from './mail.js';
import { AnySearchSearchProvider, ANYSEARCH_DEFAULT_BASE_URL, } from './provider.js';
export const name = 'dsh-webui';
export const inject = ['settings', 'tools', 'web', 'systemPrompt', 'webServer', 'sandboxPolicy', 'fs', 'workspaceRegistry', 'credentials', 'sessions', 'sessionPersistence', 'llm', 'shell'];
// ── 推理等级补全 ────────────────────────────────────────────────────────────
/** 供应商级推理等级模板：等级名 → 发送给该供应商的线值（string 或 null）。 */
const PROVIDER_REASONING_TEMPLATES = {
    // anthropic-messages：思考用 thinking 块 + effort 字符串
    sensenova: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    agnes: { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
    // openai-completions：reasoning_effort 参数；off 省略参数
    rhythm: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    bai: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    pl: { off: null, low: 'low', high: 'high', xhigh: 'max' },
};
// ── AnySearch 网页搜索 ───────────────────────────────────────────────────────
/** AnySearch API key 默认环境变量。 */
const DEFAULT_API_KEY_ENV = 'ANYSEARCH_API_KEY';
const AnySearchConfigSchema = z.object({
    apiKey: z.string().role('secret'),
    apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
    baseURL: z.string(),
    maxResults: z.number().step(1).min(1),
    tag: z.string(),
    zone: z.string(),
    language: z.string(),
});
/** 设置命名空间承载 provider 的 key 引用与选项。 */
const WEB_SEARCH_ANYSEARCH_SETTINGS_NAMESPACE = settingsNamespace('web-search-anysearch');
/**
 * 把已解析的 section 投影为 provider 下一次搜索的选项；环境变量回退放在这
 * 里而非 provider 内，provider 读到的每个值都已完全默认化。
 */
function resolveAnySearchOptions(ctx, config) {
    const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
    const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
        ? config.apiKey
        : undefined;
    return {
        ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
        resolveApiKey: async () => {
            const credentials = ctx.get('credentials');
            if (credentials !== undefined)
                return (await credentials.resolve(apiKeyEnv))?.value;
            const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
            return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
        },
        apiKeyEnv,
        baseURL: config.baseURL ?? ANYSEARCH_DEFAULT_BASE_URL,
        ...config.maxResults !== undefined ? { maxResults: config.maxResults } : {},
        ...config.tag !== undefined && config.tag.length > 0 ? { tag: config.tag } : {},
        ...config.zone !== undefined && config.zone.length > 0 ? { zone: config.zone } : {},
        ...config.language !== undefined && config.language.length > 0 ? { language: config.language } : {},
    };
}
/**
 * 注册 `webui_sync_reasoning` 工具 + AnySearch 搜索 provider + 中文思考开关
 * + 任务完成提示音 + 辅助视觉/生图。
 * @param ctx - host 上下文。
 * @param config - 组合配置（默认空对象，各能力自带默认值）。
 */
export async function apply(ctx, config = {}) {
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
            const ns = settingsNamespace('llm-pi-ai');
            const raw = ctx.settings.get(ns);
            const providers = raw?.providers;
            const patched = [];
            const skipped = [];
            if (providers === undefined)
                return { patched, skipped };
            let changed = false;
            const nextProviders = {};
            for (const [providerId, provider] of Object.entries(providers)) {
                const template = PROVIDER_REASONING_TEMPLATES[providerId];
                const models = Array.isArray(provider?.models) ? provider.models : [];
                if (template === undefined || models.length === 0) {
                    nextProviders[providerId] = provider;
                    continue;
                }
                const nextModels = models.map((model) => {
                    const id = typeof model.id === 'string' ? model.id : '';
                    if (model.reasoningEfforts !== undefined)
                        return model;
                    if (id === '') {
                        skipped.push(`${providerId}/<无 id>`);
                        return model;
                    }
                    patched.push(`${providerId}/${id}`);
                    changed = true;
                    return { ...model, reasoningEfforts: { ...template } };
                });
                nextProviders[providerId] = { ...provider, models: nextModels };
            }
            if (changed) {
                await ctx.settings.update(ns, { providers: nextProviders });
            }
            return { patched, skipped };
        },
        presentCall: () => ({ card: 'generic', title: '同步模型推理等级', kind: 'other', rawInput: null }),
    }));
    // 2) AnySearch 搜索 provider。
    let current = () => config;
    installSettingsSection(ctx, WEB_SEARCH_ANYSEARCH_SETTINGS_NAMESPACE, AnySearchConfigSchema, config, {
        setSource: (source) => {
            current = source;
        },
        onChange: () => { },
    });
    ctx.web.registerSearchProvider(new AnySearchSearchProvider(() => resolveAnySearchOptions(ctx, current())));
    // 3) 中文思考开关（自 dsh-zh-thinking 合并）。
    applyZhThinking(ctx);
    // 4) 任务完成提示音 + 对话完成桌面卡片（自 dsh-task-done-sound 合并）。
    applyTaskDoneSound(ctx);
    // 5) DSH 壳管理 + 一键更新（自 dsh-updater 合并；config.updater 可选覆盖）。
    applyUpdater(ctx, config.updater);
    // 6) 网络代理（自 dsh-proxy 合并）。
    applyProxy(ctx);
    // 7) AI 浏览器操作（自 dsh-browser 合并；config.browser 可选覆盖）。
    applyBrowser(ctx, {
        chromePath: '', port: 0, headless: false, screenshotDir: '',
        ...config.browser,
    });
    // 8) 本地记忆引擎（自 dsh-memory 合并；config.memory 可选覆盖）。
    applyMemory(ctx, config.memory);
    // 9) 工作区文件浏览器（自 dsh-file-explorer 合并）。
    applyFileExplorer(ctx);
    // 10) 用量统计 + 技能管理（自 dsh-usage-skill 融合；host 复用其 lib 产物）。
    await applyUsageHost(ctx, config.usage);
    // 11) 辅助视觉 + 生图（自 dsh-vision-helper 合并）：vision_describe / generate_image / 图片降级 / HTTP 接口。
    applyVisionHelper(ctx, config.visionHelper ?? {});
    // 12) 邮箱验证码（自 dsh-mail 合并）：mail_get_code 工具 + /api/webui-mail 路由。
    applyMail(ctx, config.mail ?? {});
}
//# sourceMappingURL=index.js.map