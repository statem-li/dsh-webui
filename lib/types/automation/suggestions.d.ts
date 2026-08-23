/**
 * automation — AI 建议存储（参考 openhanako AutomationSuggestionStore）。
 *
 * Agent 通过 automation 工具 create/update 时默认不直接落盘，而是生成一条
 * 「待确认建议」：UI 弹出确认卡片（用户可编辑字段），应用后经 receipt 校验
 * 写入 CronStore；15 分钟未处理自动过期。autoApprove 模式下工具直接提交。
 */
import { type CronJob } from './types.js';
/** 建议草稿数据（创建/更新共用）。 */
export type SuggestionJobData = Partial<CronJob> & {
    type: CronJob['type'];
    schedule: string | number;
};
/** 待确认建议（对外视图，不含 apply 闭包）。 */
export interface SuggestionView {
    suggestionId: string;
    /** 4 位数字短码，供人工引用。 */
    shortCode: string;
    operation: 'create' | 'update';
    jobId: string | null;
    baseConfigRevision: number | null;
    jobData: SuggestionJobData;
    createdAt: number;
    expiresAt: number;
}
/** 建议 receipt：apply 时签发、写入前校验，防过期重放。 */
export interface SuggestionReceipt {
    readonly suggestionId: string;
    readonly confirmedAt: string;
    readonly expiresAt: number;
    readonly operation: 'create' | 'update';
    readonly jobId: string | null;
    readonly baseConfigRevision: number | null;
}
export declare class AutomationSuggestionStore {
    private entries;
    private sequence;
    private readonly ttlMs;
    constructor(ttlMs?: number);
    /**
     * 登记一条建议。apply 闭包在用户确认时执行（把可能被用户编辑过的 jobData
     * 合并进建议并写入 CronStore）。
     */
    create(entry: {
        operation: 'create' | 'update';
        jobId?: string | null;
        baseConfigRevision?: number | null;
        jobData: SuggestionJobData;
        apply: (payload: {
            jobData: SuggestionJobData;
            receipt: SuggestionReceipt;
        }) => CronJob | null;
    }): SuggestionView;
    get(ref: string): SuggestionView | null;
    list(): SuggestionView[];
    /**
     * 应用建议：合并用户编辑 → 签发 receipt → 执行 apply（写 CronStore）。
     * 不存在 / 过期 / 正在应用分别返回对应失败原因。
     */
    apply({ ref, value }?: {
        ref?: string | null;
        value?: unknown;
    }): Promise<{
        ok: true;
        suggestion: SuggestionView;
        result: CronJob | null;
    } | {
        ok: false;
        reason: 'not-found' | 'expired' | 'already-applying';
    }>;
    /** 用户显式拒绝一条建议：立即移除（不存在返回 false）。 */
    dismiss(ref: string): boolean;
    private pruneExpired;
}
