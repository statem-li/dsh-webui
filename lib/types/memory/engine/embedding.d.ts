/**
 * dsh-memory embedding 引擎：把「语义检索」从预留变成可用。
 *
 * 背景：DSH 的 llm 服务只暴露 stream()（chat completion），无 embedding 接口，
 * 因此语义检索需要自带 embedding 提供方。参考 opencontext（@melandlabs）的做法，
 * 提供两种模式：
 *  - http：OpenAI 兼容 /v1/embeddings（兼容任意 OpenAI 兼容网关，含 ollama
 *    `openai` 兼容端点、one-api、new-api 等）。零额外依赖，用全局 fetch。
 *  - local：@xenova/transformers 本地 ONNX（默认 Xenova/all-MiniLM-L6-v2，
 *    384 维）。依赖体积大且首次加载慢，做成动态 import + 懒加载：未安装该依赖时
 *    优雅降级到 hybrid，不崩溃。
 *
 * 安全：http 模式的 apiKey 优先读环境变量 DSH_MEMORY_EMBEDDING_API_KEY，
 * 其次读配置；绝不写日志。
 *
 * 性能护栏：embedding 只在「显式 semantic 检索」时按需计算并缓存到条目
 * （entry.embedding，schema v2 已预留），不做全量预热——插件性能红线不破。
 */
export type EmbeddingBackend = 'http' | 'local';
export interface EmbeddingProvider {
    readonly backend: EmbeddingBackend;
    readonly model: string;
    readonly dimensions: number;
    /** 批量计算文本向量。返回与输入等长的数组。 */
    embed(texts: string[]): Promise<number[][]>;
}
/** 计算配置所需的 provider 是否可用（http 需 baseUrl；local 需依赖可加载）。 */
export declare function resolveEmbeddingProvider(config: {
    embeddingProvider: 'off' | 'http' | 'local';
    embeddingBaseUrl: string;
    embeddingModel: string;
    embeddingApiKey: string;
    embeddingDimensions: number;
}): EmbeddingProvider | null;
interface HttpOptions {
    baseUrl: string;
    model: string;
    apiKey: string;
    dimensions: number;
    timeoutMs?: number;
}
export declare class HttpEmbeddingProvider implements EmbeddingProvider {
    readonly backend: "http";
    readonly model: string;
    readonly dimensions: number;
    private readonly baseUrl;
    private readonly apiKey;
    private readonly timeoutMs;
    /** 单次请求最大输入条数（OpenAI 上限 2048，保守 256）。 */
    private static readonly BATCH_SIZE;
    constructor(options: HttpOptions);
    embed(texts: string[]): Promise<number[][]>;
    private embedChunk;
}
export declare class LocalEmbeddingProvider implements EmbeddingProvider {
    readonly backend: "local";
    readonly model: string;
    dimensions: number;
    private pipeline;
    private failure;
    constructor(model: string);
    private ensurePipeline;
    embed(texts: string[]): Promise<number[][]>;
}
export declare function cosineSimilarity(a: number[], b: number[]): number;
/** 归一化到 0-1：cosine ∈ [-1, 1] → (cos + 1) / 2。 */
export declare function normalizedCosine(a: number[], b: number[]): number;
export {};
