import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { applyVoice } from './voice.js';
import { applyZhThinking } from './zh-thinking.js';
import { applyMood } from './mood.js';
import { applyMessageWidth } from './message-width.js';
import { applyTaskDoneSound } from './task-done-sound.js';
import { applyDonePill } from './done-pill.js';
import { applyUpdater } from './updater.js';
import { applyPluginUpdate } from './plugin-update.js';
import { applyProxy } from './proxy.js';
import { applyGatewayRewrite } from './gateway-rewrite.js';
import { applyProviderThrottle } from './provider-throttle.js';
import { applyBrowser } from './browser/index.js';
import { applyBrowserSpeed } from './browser/speed.js';
import { applyDiagram } from './diagram.js';
import { applyMemory } from './memory/index.js';
import { applyFileExplorer } from './file-explorer.js';
import { applyWorkspaceDirPicker } from './workspace-dir-picker.js';
import { applyTmpCleaner } from './tmp-cleaner.js';
import { applyUsageHost } from './usage-host.js';
import { applyVisionHelper } from './vision-helper.js';
import { applyMail } from './mail.js';
import { applyRewind } from './rewind.js';
import { applyScreenshot } from './screenshot/index.js';
import { applyDeliverables } from './deliverables.js';
import { apply as applySkillToggles } from './skill-toggles.js';
import { applyPromptOptimize } from './prompt-optimize.js';
import { applySidebarFloat } from './sidebar-float.js';
import { applyAppearance } from './appearance.js';
import { applyAutomationHost } from './automation/index.js';
import { applyTeamHost } from './team/host.js';
import { applyPerfBench } from './perf-bench.js';
import { applyDevRoleProbe } from './devrole-probe.js';
import { applyModulesHost } from './modules-host.js';
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
    // 0) 功能模块开关：settings 命名空间 webui-modules + GET/POST /api/webui-modules。
    //    为 false 的模块下方完全不装配（client 半身经同一份 key 表对齐裁剪）。
    const modules = applyModulesHost(ctx);
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
    }
    // 2) AnySearch 搜索 provider。
    if (modules.webSearch) {
        let current = () => config;
        installSettingsSection(ctx, WEB_SEARCH_ANYSEARCH_SETTINGS_NAMESPACE, AnySearchConfigSchema, config, {
            setSource: (source) => {
                current = source;
            },
            onChange: () => { },
        });
        ctx.web.registerSearchProvider(new AnySearchSearchProvider(() => resolveAnySearchOptions(ctx, current())));
    }
    // 3) 中文思考开关（自 dsh-zh-thinking 合并）。
    if (modules.zhThinking)
        applyZhThinking(ctx);
    // 3.2) MOOD 自述：按 Agent 预设的开关 + 人设，提示词段按当次 agent 渲染
    //      （settings 命名空间 webui-mood + /api/webui-mood）。
    if (modules.mood)
        applyMood(ctx);
    // 3.5) 发送对话宽度（本人消息气泡宽度）：settings 持久化 + /api/webui-message-width。
    if (modules.messageWidth)
        applyMessageWidth(ctx);
    // 3.7) 语音播报：实时播报 + 对话完成总结播报（Windows 系统语音 / 模型语音）。
    if (modules.voice)
        applyVoice(ctx);
    // 4) 任务完成提示音 + 对话完成桌面卡片（自 dsh-task-done-sound 合并）。
    // cardEnabled:false —— 桌面右下角完成卡片已按用户要求禁用（2026-08），
    // 回合结束只播提示音（仍受设置页「插件任务完成提示音」开关控制）。
    if (modules.doneSound)
        applyTaskDoneSound(ctx, { cardEnabled: false });
    // 4.5) 对话完成胶囊：全局监听 turn/end，/api/webui-done-pill 供顶部胶囊轮询。
    if (modules.donePill)
        applyDonePill(ctx);
    // 5) DSH 壳管理 + 一键更新（自 dsh-updater 合并；config.updater 可选覆盖）。
    if (modules.updater)
        applyUpdater(ctx, config.updater);
    // 5.5) 插件自更新：检测 GitHub 上游新版本 + 一键就地更新（/api/webui-plugin-update）。
    if (modules.pluginUpdate)
        applyPluginUpdate(ctx);
    // 6) 网络代理（自 dsh-proxy 合并）。
    if (modules.proxy)
        applyProxy(ctx);
    // 6.5) 网关伪装接入：按域名改写 User-Agent / 可选强制代理（接 UA 白名单网关）。
    //      必须晚于 applyProxy 装配，让本模块的 fetch 包装叠在 network-proxy 之上。
    if (modules.gatewayRewrite)
        applyGatewayRewrite(ctx);
    // 6.8) 供应商限流：按域名 RPM 令牌桶 + 并发信号量（从源头避免 429）。
    //      与 gateway-rewrite 同为 fetch 包装，二者互不冲突（各自幂等安装）。
    if (modules.providerThrottle)
        applyProviderThrottle(ctx);
    // 7) AI 浏览器操作（自 dsh-browser 合并；config.browser 可选覆盖）。
    // 固定有头：本机真实窗口启动即最大化（≈电脑分辨率），画面经 screencast
    // 同步到 Web GUI 右侧滑出的预览抽屉（只读观看）。
    if (modules.browser) {
        applyBrowser(ctx, {
            chromePath: '', port: 0, screenshotDir: '', loginGroup: 'shared',
            ...config.browser,
        });
        // 浏览器提速策略：系统提示词注入 + /api/dsh-browser/speed 开关（随浏览器模块联动）。
        applyBrowserSpeed(ctx);
    }
    // 8) 本地记忆引擎（自 dsh-memory 合并；config.memory 可选覆盖）。
    if (modules.memory)
        applyMemory(ctx, config.memory);
    // 9) 工作区文件浏览器（自 dsh-file-explorer 合并）。
    if (modules.fileExplorer)
        applyFileExplorer(ctx);
    // 9.5) 工作区目录选择器：应用内弹窗浏览目录（/api/webui-dir-picker），
    // 供「添加工作区」选择文件夹（shadow 官方 native surface）。
    if (modules.dirPicker)
        applyWorkspaceDirPicker(ctx);
    // 9.6) 工作区临时垃圾清理器：_tmp 约定目录 + 规则扫描 + 定时调度 +
    //      webui_tmp_clean 工具（/api/webui-tmp-cleaner；设置页自定触发时间）。
    if (modules.tmpCleaner)
        await applyTmpCleaner(ctx);
    // 10) 用量统计 + 技能管理（自 dsh-usage-skill 融合；host 复用其 lib 产物）。
    if (modules.usage)
        await applyUsageHost(ctx, config.usage);
    // 11) 辅助视觉 + 生图（自 dsh-vision-helper 合并）：vision_describe / generate_image / 图片降级 / HTTP 接口。
    if (modules.vision)
        applyVisionHelper(ctx, config.visionHelper ?? {});
    // 12) 邮箱验证码（自 dsh-mail 合并）：mail_get_code 工具 + /api/webui-mail 路由。
    if (modules.mail)
        applyMail(ctx, config.mail ?? {});
    // 13) 对话「退回」（自 dsh-rewind）：user 消息文件快照 + /api/webui-rewind 回退路由。
    if (modules.rewind)
        applyRewind(ctx);
    // 14) 对话截图：常驻无头浏览器渲染卡片（/api/webui-screenshot 的 render/save/reveal/image）。
    if (modules.screenshot)
        applyScreenshot(ctx);
    // 15) 技能开关（/api/skill-toggles）：每个技能禁用/开启 + 技能包一键开关。
    if (modules.skills)
        await applySkillToggles(ctx);
    // 16) 提示词优化（/api/webui-prompt-optimize）：对话框内用选中模型改写草稿，
    //     结果经 prompt-optimize-clean 清洗后回传，由客户端确认后再写回输入框。
    if (modules.promptOptimize)
        applyPromptOptimize(ctx);
    // 17) 左侧悬浮侧边栏：设置项「启动服务时默认折叠」持久化 + /api/sidebar-float。
    if (modules.sidebarFloat)
        applySidebarFloat(ctx);
    // 18) 外观设置：玻璃质感（Glassmorphism）开关持久化 + /api/webui-appearance。
    if (modules.appearance)
        applyAppearance(ctx);
    // 19) 定时自动化（openhanako 式）：CronStore + 服务端调度器 + automation 工具
    //     （/api/webui-automation：任务 CRUD / 建议确认 / 运行历史 / 完成事件）。
    if (modules.automation)
        applyAutomationHost(ctx);
    // 20) 团队 Agent 编排器：多团队编制（一团队一文件）+ 接力运行引擎（llm/subagent 双通道）
    //       + team_run/team_status/team_list 工具 + 对话框团队模式提示词注入
    //       （/api/webui-team：teams / globals / providers / chat-mode / runs）。
    if (modules.team)
        applyTeamHost(ctx);
    // 20.5) 图表渲染支撑：mermaid 引擎按需下发（/dyn-assets/vendor/mermaid.min.js）
    //       + 极短作图提示词（可关）；无图表会话零下载零开销。
    if (modules.diagram)
        applyDiagram(ctx);
    // 21) 推理性能基准测试（/api/perf-bench）：TTFT / TPS / E2E / RPS / 预填充速度。
    applyPerfBench(ctx);
    // 22) 供应商 Developer Role 兼容性一键检测 + 自动修复（/api/webui-devrole/probe）。
    applyDevRoleProbe(ctx);
    // 23) 会话产物清单（/api/webui-deliverables）：fs 写入事件按会话持久化
    //     （跨重启存活），供消息操作栏「产物」大卡片回看（官方产物行重启即逝）。
    applyDeliverables(ctx);
}
//# sourceMappingURL=index.js.map