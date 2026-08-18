/**
 * dsh-memory 编译引擎：把 entries 渲染成分层 md 产物并组装注入文本。
 * - 项目层：memory.md（短期时间线 + 长期沉淀）、facts.md、pinned.md
 * - 全局层：identity.md（身份/偏好）、facts.md、pinned.md
 * - 每日：daily/<date>.md（openhanako 同款格式，跨项目）
 * - 注入：identity + memory + pinned + facts 组装为带来源的 user message 文本
 */
import type { MemoryConfig, MemoryEntry } from '../types.js';
import { type MemoryStore } from './store.js';
/** 分组标题（时间线）。 */
export type TimeGroup = 'today' | 'week' | 'earlier' | 'longterm';
/** 按时间把条目分组。 */
export declare function groupEntries(entries: MemoryEntry[], now?: Date): Record<TimeGroup, MemoryEntry[]>;
/** 渲染 timeline（短期分组 + 长期沉淀）。 */
export declare function renderTimeline(entries: MemoryEntry[]): string;
/** 渲染 identity（全局层身份/偏好条目）。 */
export declare function renderIdentity(entries: MemoryEntry[]): string;
/** 渲染 facts。 */
export declare function renderFacts(entries: MemoryEntry[]): string;
/** 渲染 pinned。 */
export declare function renderPinned(entries: MemoryEntry[]): string;
/** 身份/偏好判定。 */
export declare function isIdentityEntry(entry: MemoryEntry): boolean;
/** 事实判定（非 identity、非 pinned 且带事实标签或高重要性）。 */
export declare function isFactEntry(entry: MemoryEntry): boolean;
/** 全局层编译产物。 */
export declare function compileGlobalArtifacts(entries: MemoryEntry[]): {
    identity: string;
    facts: string;
    pinned: string;
};
/** 项目层编译产物。 */
export declare function compileProjectArtifacts(entries: MemoryEntry[]): {
    memory: string;
    facts: string;
    pinned: string;
};
/** 每日日志（跨项目全局；openhanako 同款格式）。 */
export declare function renderDaily(date: string, changes: Array<{
    action: string;
    summary: string;
    scope: string;
}>): string;
/** 注入产物组装（design §5.4：全局 identity + 项目 memory + pinned + facts，带 token 截断）。 */
export interface InjectionSections {
    identity: string;
    memory: string;
    pinned: string;
    facts: string;
}
/**
 * 组装注入文本与 sections。
 * @param entries - 注入可见条目（已按重要性排序）。
 * @param config - 注入预算。
 */
export declare function buildInjectionText(entries: MemoryEntry[], config: MemoryConfig): {
    text: string;
    sections: Array<{
        name: string;
        text: string;
    }>;
};
/** 全量编译入口：写项目层 + 全局层产物（ticker 调用）。 */
export declare function compileAll(store: MemoryStore, config: MemoryConfig): Promise<void>;
/** 从 entries 中选注入可见条目（short 层按阈值过滤 + 排序）。 */
export declare function selectInjectionEntries(entries: MemoryEntry[], threshold: number): MemoryEntry[];
/** 项目记忆文本（面板/注入用）。 */
export declare function projectMemoryText(entries: MemoryEntry[]): string;
/** 当前工作区项目 hash（会话 cwd 判定；取不到返回 null → 调用方回退 global）。 */
export declare function workspaceHashOf(header: {
    cwd?: string;
} | undefined): string | null;
/** 今日变更的 md 日志文本（写 daily）。 */
export declare function writeDailyLog(store: MemoryStore, date?: string): Promise<void>;
/** 促进短期条目到长期层（每日编译时调用）。 */
export declare function promoteEntries(entries: MemoryEntry[], threshold: number): {
    promoted: MemoryEntry[];
    remaining: MemoryEntry[];
};
