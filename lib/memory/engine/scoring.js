/**
 * dsh-memory 评分引擎：importance 每天乘衰减、命中加分、分层判断。
 * 参考 openhanako 的评分衰减思路：被引用刷新衰减起点，低分条目不进入注入产物。
 */
import { nowIso } from './store.js';
/** 衰减后的 importance（每天乘 (1 - λ)）。 */
export function decayImportance(importance, days, lambda) {
    if (days <= 0)
        return importance;
    const decayed = importance * Math.pow(1 - lambda, days);
    return Math.round(decayed * 100) / 100;
}
/** 注入命中：加分并刷新 lastHitAt（衰减起点重置）。 */
export function applyHit(entry, bonus) {
    return {
        ...entry,
        importance: Math.min(20, Math.round((entry.importance + bonus) * 100) / 100),
        lastHitAt: nowIso(),
    };
}
/** 距离某时间的天数（不足 1 天按 0）。 */
export function daysSince(iso, from = new Date()) {
    if (iso === null)
        return 0;
    const time = Date.parse(iso);
    if (Number.isNaN(time))
        return 0;
    return Math.max(0, Math.floor((from.getTime() - time) / 86_400_000));
}
/** 是否进入注入产物：pinned 无条件；否则 importance 达到阈值（仅短期层；长期层天然已沉淀）。 */
export function isInjectionEligible(entry, threshold) {
    if (entry.pinned)
        return true;
    if (entry.layer === 'long')
        return true;
    return entry.importance >= threshold;
}
/** 短期 → 长期沉淀判断：高价值或经时间检验。 */
export function shouldPromote(entry, threshold) {
    if (entry.layer !== 'short')
        return false;
    if (entry.importance >= threshold * 2)
        return true;
    const age = daysSince(entry.updatedAt);
    if (age >= 14 && entry.importance >= threshold)
        return true;
    return false;
}
/** 滚出窗口：超 60 天且 importance 低于阈值一半的短期条目直接删除。 */
export function shouldEvict(entry, threshold) {
    if (entry.layer !== 'short' || entry.pinned)
        return false;
    const age = daysSince(entry.updatedAt);
    return age >= 60 && entry.importance < threshold / 2;
}
/** 注入排序分：pinned 最高，其次 importance 降序。 */
export function injectionRank(entry) {
    return entry.pinned ? Number.POSITIVE_INFINITY : entry.importance;
}
//# sourceMappingURL=scoring.js.map