import type { Context } from 'cordis';
import z from '@deepseek-ai/schemastery';
/** 注入服务均为运行时动态注册，类型上放宽为 any */
type PluginContext = Context & Record<string, any>;
export interface Config {
    /** model-router.json 路径（空 = 工作区 .dsh/model-router.json） */
    modelRouterPath: string;
    /** 覆盖视觉模型列表：["provider/model", ...]；空 = 读 model-router.json */
    visionModels: string[];
    /** 单次请求超时（ms），视觉模型带推理链较慢 */
    timeoutMs: number;
    maxTokens: number;
    defaultPrompt: string;
    /**
     * 非多模态主模型图片降级：聊天中用户发图（或历史含图）时，若当前
     * provider/model 未声明 image 输入，自动用辅助视觉模型把图片转成文本
     * 描述再交给主模型（通过 llm/stream waterfall 短路，不改动会话历史，
     * 聊天界面仍正常显示图片缩略图）。
     */
    textModelImageFallback: boolean;
    /** 图片降级时发往辅助视觉模型的描述提示词 */
    fallbackDescribePrompt: string;
    /** 图片描述结果缓存上限（按附件 id；历史图片只描述一次） */
    fallbackCacheSize: number;
}
export declare const Config: z<Schemastery.ObjectS<{
    modelRouterPath: z<string, string>;
    visionModels: z<string[], string[]>;
    timeoutMs: z<number, number>;
    maxTokens: z<number, number>;
    defaultPrompt: z<string, string>;
    textModelImageFallback: z<boolean, boolean>;
    fallbackDescribePrompt: z<string, string>;
    fallbackCacheSize: z<number, number>;
}>, Schemastery.ObjectT<{
    modelRouterPath: z<string, string>;
    visionModels: z<string[], string[]>;
    timeoutMs: z<number, number>;
    maxTokens: z<number, number>;
    defaultPrompt: z<string, string>;
    textModelImageFallback: z<boolean, boolean>;
    fallbackDescribePrompt: z<string, string>;
    fallbackCacheSize: z<number, number>;
}>>;
export declare function applyVisionHelper(ctx: PluginContext, config: Config): void;
export {};
