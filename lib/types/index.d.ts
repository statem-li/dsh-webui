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
import type { Context } from 'cordis';
export declare const name = "dsh-webui";
export declare const inject: string[];
/** AnySearch 插件配置（全部可选，apply 填环境变量与常量默认值）。 */
export interface AnySearchConfig {
    /** 字面 API key；优先用 apiKeyEnv，避免密钥进配置文件。 */
    apiKey?: string;
    /** 每次搜索解析的凭据引用；默认 ANYSEARCH_API_KEY。 */
    apiKeyEnv?: string;
    /** API 端点基址；自动拼接 /v1/search。默认公共 API。 */
    baseURL?: string;
    /** 请求未带 maxResults 时的默认结果数。 */
    maxResults?: number;
    /** 可选子域能力标签，如 code.doc。 */
    tag?: string;
    /** 可选区域：cn 或 intl。 */
    zone?: string;
    /** 可选首选语言，如 zh-CN 或 en。 */
    language?: string;
}
/** webui 组合配置：anysearch 字段直接读取（兼容旧配置），其余能力子配置可选覆盖默认。 */
export interface WebuiConfig extends AnySearchConfig {
    updater?: import('./updater.js').UpdaterConfig;
    browser?: Partial<import('./browser/index.js').Config>;
    memory?: Partial<import('./memory/types.js').MemoryConfig>;
    /** 用量统计 + 技能管理配置（透传给 dsh-usage-skill 的 host）。 */
    usage?: any;
    /** 辅助视觉 + 生图配置（自 dsh-vision-helper 合并）。 */
    visionHelper?: Partial<import('./vision-helper.js').Config>;
    /** 邮箱验证码配置（自 dsh-mail 合并）。 */
    mail?: Partial<import('./mail.js').MailConfig>;
}
/**
 * 注册 `webui_sync_reasoning` 工具 + AnySearch 搜索 provider + 中文思考开关
 * + 任务完成提示音 + 辅助视觉/生图。
 * @param ctx - host 上下文。
 * @param config - 组合配置（默认空对象，各能力自带默认值）。
 */
export declare function apply(ctx: Context, config?: WebuiConfig): Promise<void>;
