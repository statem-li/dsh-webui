/**
 * dsh-memory 检索引擎（本地 hybrid，零外部依赖）。
 *
 * 背景：DSH 的 llm 服务当前只暴露 stream()（chat completion），无 embedding 接口，
 * 因此「embedding 语义检索」暂缓（`semantic` 模式预留，未来接 embedding 时替换
 * `hybridScore` 的实现即可）。当前用纯本地方案：
 *  - keyword：query 各词全部子串命中（AND，精确）。
 *  - hybrid（默认）：字符 n-gram Jaccard 相似度 + 精确命中加成 + 元数据加权
 *    （verified / confidence / importance）。
 *  - semantic：预留，当前回退 hybrid。
 */
import type { MemoryEntry } from '../types.js';
export type RetrievalMode = 'hybrid' | 'keyword' | 'semantic';
export interface RetrievalMatch {
    entry: MemoryEntry;
    score: number;
}
/** 关键词精确命中：query 每个非空词都是 content/tags 的子串。 */
export declare function keywordHit(query: string, entry: MemoryEntry): boolean;
/** 检索主入口：返回按 score 降序的匹配列表。 */
export declare function searchEntries(query: string, entries: MemoryEntry[], mode: RetrievalMode): RetrievalMatch[];
/** 两段文本的 n-gram 相似度（提取语义去重用）。 */
export declare function semanticSimilarity(a: string, b: string): number;
