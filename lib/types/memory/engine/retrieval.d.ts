/**
 * dsh-memory 检索引擎（本地 hybrid + 可选 semantic）。
 *
 * 背景：DSH 的 llm 服务当前只暴露 stream()（chat completion），无 embedding 接口，
 * 因此「embedding 语义检索」由本插件的 embedding.ts 提供（http / local 两种模式，
 * 参考 opencontext 的做法）。未配置 embedding 时 semantic 回退 hybrid，行为与旧版
 * 完全一致（零依赖兜底）。
 *
 * 检索模式：
 *  - keyword：query 各词全部子串命中（AND，精确）。
 *  - hybrid（默认）：字符 n-gram Jaccard 相似度 + 精确命中加成 + 元数据加权
 *    （verified / confidence / importance）。
 *  - semantic：query 与条目的向量余弦（embedding 缓存）+ n-gram 加权融合；
 *    embedding 不可用时回退 hybrid。
 *
 * 软废弃（schema v3）：deprecated 条目默认不参与检索（除非 includeDeprecated）。
 */
import type { MemoryEntry } from '../types.js';
import { type EmbeddingProvider } from './embedding.js';
export type RetrievalMode = 'hybrid' | 'keyword' | 'semantic';
export interface RetrievalMatch {
    entry: MemoryEntry;
    score: number;
}
/** 关键词精确命中：query 每个非空词都是 content/tags 的子串。 */
export declare function keywordHit(query: string, entry: MemoryEntry): boolean;
/** 同步检索（无 embedding）：keyword / hybrid；semantic 回退 hybrid。 */
export declare function searchEntries(query: string, entries: MemoryEntry[], mode: RetrievalMode, options?: {
    includeDeprecated?: boolean;
}): RetrievalMatch[];
/**
 * 异步语义检索：semantic 模式真正用向量（embedding 缓存 + 缺失现场补算）。
 * provider 为 null / 调用失败 / 向量缺失时逐项回退 hybrid，绝不抛错。
 * 注意：会原地改写 entry.embedding（补算缓存），调用方需自行决定是否落盘。
 */
export declare function searchEntriesSemantic(query: string, entries: MemoryEntry[], provider: EmbeddingProvider | null, options?: {
    includeDeprecated?: boolean;
}): Promise<RetrievalMatch[]>;
/** 两段文本的 n-gram 相似度（提取语义去重用）。 */
export declare function semanticSimilarity(a: string, b: string): number;
