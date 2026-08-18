/**
 * dsh-memory 评分引擎：importance 每天乘衰减、命中加分、分层判断。
 * 参考 openhanako 的评分衰减思路：被引用刷新衰减起点，低分条目不进入注入产物。
 */
import type { MemoryEntry } from '../types.js';
/** 衰减后的 importance（每天乘 (1 - λ)）。 */
export declare function decayImportance(importance: number, days: number, lambda: number): number;
/** 注入命中：加分并刷新 lastHitAt（衰减起点重置）。 */
export declare function applyHit(entry: MemoryEntry, bonus: number): MemoryEntry;
/** 距离某时间的天数（不足 1 天按 0）。 */
export declare function daysSince(iso: string | null, from?: Date): number;
/** 是否进入注入产物：pinned 无条件；否则 importance 达到阈值（仅短期层；长期层天然已沉淀）。 */
export declare function isInjectionEligible(entry: MemoryEntry, threshold: number): boolean;
/** 短期 → 长期沉淀判断：高价值或经时间检验。 */
export declare function shouldPromote(entry: MemoryEntry, threshold: number): boolean;
/** 滚出窗口：超 60 天且 importance 低于阈值一半的短期条目直接删除。 */
export declare function shouldEvict(entry: MemoryEntry, threshold: number): boolean;
/** 注入排序分：pinned 最高，其次 importance 降序。 */
export declare function injectionRank(entry: MemoryEntry): number;
