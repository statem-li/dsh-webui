/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
/** settings.yaml 命名空间。 */
export declare const VOICE_NAMESPACE = "webui-voice";
/** HTTP 路由前缀。 */
export declare const VOICE_API = "/api/webui-voice";
/** 语音引擎。 */
export type VoiceEngine = 'system' | 'model';
/** 总结方式：digest = 本地摘要（零 token）；llm = 模型生成一句话。 */
export type SummaryStyle = 'digest' | 'llm';
/** 命名空间形状。 */
export interface VoiceConfig {
    /** 总开关：关闭时任何播报请求直接丢弃。 */
    enabled: boolean;
    /** 实时播报（边生成边念）。 */
    live: boolean;
    /** 对话完成后的总结播报。 */
    summary: boolean;
    engine: VoiceEngine;
    /** 系统引擎音色名（System.Speech 的 VoiceInfo.Name）。 */
    systemVoice: string;
    /** 语速：-10 ~ 10（System.Speech.Rate 口径；模型引擎映射为 speed）。 */
    rate: number;
    /** 音量：0 ~ 100。 */
    volume: number;
    /** 模型引擎使用的模型 key（provider/model）。 */
    modelKey: string;
    /** 模型引擎的音色参数（各家自定；OpenAI 系为 alloy/nova…）。 */
    modelVoice: string;
    summaryStyle: SummaryStyle;
}
/** 一个可选音色（系统引擎）。 */
export interface VoiceOption {
    id: string;
    name: string;
    culture: string;
    gender: string;
}
/**
 * 本地总结：提取「做完了什么 / 什么原因 / 解决了什么」（零 token、零延迟）。
 *
 * 保留导出名 digestSummary 以兼容既有调用；实现委托给
 * {@link outcomeSummary}——不再是「取开头几句」，而是按结论线索打分挑句。
 * @param text - 已清洗的回复正文。
 * @returns 一句话总结（可能为空串）。
 */
export declare function digestSummary(text: string): string;
/**
 * 注册语音播报：settings 持久化 + 朗读进程 + HTTP 路由。
 * @param ctx - host 上下文（需要 settings / webServer / llm / credentials）。
 */
export declare function applyVoice(ctx: PluginContext): void;
export {};
