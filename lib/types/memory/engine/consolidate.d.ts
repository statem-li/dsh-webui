/**
 * dsh-memory 记忆巩固引擎（Memory Dream，openhanako 同款）：
 * 每天（或手动触发）用 LLM 对某一 scope 的记忆做「语义化整理」——
 * 合并近重复/强相关条目、精炼重写、删除过时/低价值、提升长期。
 * 与现有每日「规则化」衰减/折叠/滚出（ticker.runDailyCompile）正交叠加：
 * 规则处理「分数」，本引擎处理「语义」。
 *
 * 安全设计：
 * - 输入排除 pinned（保护用户明确标记的条目），apply 时再按 id 锚定防误删；
 * - 整理前写入 revisions 快照，支持一键回滚；
 * - LLM 失败/超时/解析失败一律空结果，绝不阻塞每日编译。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ConsolidateOp, ConsolidateResult, MemoryConfig } from '../types.js';
import { type MemoryStore } from './store.js';
/** 整理范围：global 层，或某个 project。 */
export type ConsolidateScope = 'global' | {
    projectHash: string;
};
/**
 * 单个 scope 的整理：读 → 选集合 → LLM 决策 → 备份 → 应用 → 重编译。
 * @returns 统计结果；无变更/失败时 changed=0。
 */
export declare function consolidateScope(ctx: Context, store: MemoryStore, config: MemoryConfig, scope: ConsolidateScope, trigger: 'daily' | 'manual'): Promise<ConsolidateResult>;
/** 整理全部 scope（global + 每个 project）。返回有变更的 scope 结果。 */
export declare function consolidateAll(ctx: Context, store: MemoryStore, config: MemoryConfig, trigger: 'daily' | 'manual'): Promise<ConsolidateResult[]>;
/** 解析 LLM 输出为 ops（容错：剥 fence / 找最外层对象 / 逐条校验）。 */
export declare function parseConsolidateOutput(raw: string): ConsolidateOp[];
