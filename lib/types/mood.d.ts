/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
/** settings.yaml 命名空间。 */
export declare const MOOD_NAMESPACE = "webui-mood";
/** HTTP 路由。 */
export declare const MOOD_API = "/api/webui-mood";
/** 单个 Agent 的 MOOD 配置。 */
export interface MoodEntry {
    /** 该 Agent 是否输出 MOOD。 */
    enabled: boolean;
    /** 该 Agent 的人设文本；空串表示沿用 defaultPersona。 */
    persona: string;
}
/** 命名空间整体形状。 */
export interface MoodConfig {
    /** 总开关：关闭时任何 Agent 都不注入。 */
    enabled: boolean;
    /** 默认人设模板：未单独配置的 Agent 用它。 */
    defaultPersona: string;
    /** preset id → 该 Agent 的覆盖配置。 */
    presets: Record<string, MoodEntry>;
}
/**
 * 出厂人设模板。小节名不是硬编码约定——渲染端按「`名字:` 行 + `- ` 条目」自动
 * 分节，用户改成任何小节名都能正常显示。
 */
export declare const MOOD_DEFAULT_PERSONA: string;
/**
 * 注册 MOOD：settings 持久化 + 按 Agent 渲染的提示词段 + HTTP API。
 * @param ctx - host 上下文。
 */
export declare function applyMood(ctx: PluginContext): void;
export {};
