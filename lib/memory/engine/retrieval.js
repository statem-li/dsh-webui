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
/** 归一化：小写 + 折叠空白。 */
function normalize(text) {
    return text.toLowerCase().replace(/\s+/g, ' ');
}
/** 字符 n-gram（2/3-gram），语言无关、无需分词器。 */
function ngrams(text) {
    const s = normalize(text).replace(/\s+/g, '');
    const out = new Set();
    for (let n = 2; n <= 3; n += 1) {
        for (let i = 0; i + n <= s.length; i += 1) {
            out.add(s.slice(i, i + n));
        }
    }
    return out;
}
/** Jaccard 相似度（0-1）。 */
function jaccard(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter += 1;
    return inter / (a.size + b.size - inter);
}
/** 关键词精确命中：query 每个非空词都是 content/tags 的子串。 */
export function keywordHit(query, entry) {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0)
        return true;
    const hay = normalize(`${entry.content} ${entry.tags.join(' ')}`);
    return terms.every(term => hay.includes(term));
}
/** 元数据加权系数（verified 优先；confidence/importance 缩放）。 */
function metaWeight(entry) {
    let w = 1;
    if (entry.verified)
        w *= 1.15;
    w *= 0.5 + entry.confidence * 0.5;
    w *= 0.5 + entry.importance / 20;
    return w;
}
/** 综合评分：n-gram 相似度 + 精确命中强加成 + 元数据加权。 */
function hybridScore(query, entry) {
    const q = normalize(query);
    if (q.trim() === '')
        return metaWeight(entry);
    const qGrams = ngrams(q);
    const hay = normalize(`${entry.content} ${entry.tags.join(' ')}`);
    const hGrams = ngrams(hay);
    let score = jaccard(qGrams, hGrams);
    if (keywordHit(query, entry))
        score = Math.max(score, 0.5) + 0.3;
    return score * metaWeight(entry);
}
/** 检索主入口：返回按 score 降序的匹配列表。 */
export function searchEntries(query, entries, mode) {
    const matches = [];
    for (const entry of entries) {
        if (mode === 'keyword' && !keywordHit(query, entry))
            continue;
        // semantic 预留：无 embedding 时等价 hybrid。
        matches.push({ entry, score: hybridScore(query, entry) });
    }
    return matches.sort((a, b) => b.score - a.score);
}
/** 两段文本的 n-gram 相似度（提取语义去重用）。 */
export function semanticSimilarity(a, b) {
    return jaccard(ngrams(a), ngrams(b));
}
//# sourceMappingURL=retrieval.js.map