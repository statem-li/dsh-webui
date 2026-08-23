/**
 * automation — AI 建议存储（参考 openhanako AutomationSuggestionStore）。
 *
 * Agent 通过 automation 工具 create/update 时默认不直接落盘，而是生成一条
 * 「待确认建议」：UI 弹出确认卡片（用户可编辑字段），应用后经 receipt 校验
 * 写入 CronStore；15 分钟未处理自动过期。autoApprove 模式下工具直接提交。
 */
import { CodedError } from './types.js';
/** 建议默认存活时长。 */
const DEFAULT_SUGGESTION_TTL_MS = 15 * 60 * 1000;
/** 应用建议时允许改写的字段（与 openhanako applyConfirmedAutomationDraft 对齐）。 */
const CONFIRMABLE_FIELDS = new Set(['type', 'schedule', 'prompt', 'label', 'model']);
export class AutomationSuggestionStore {
    entries = new Map();
    sequence = 0;
    ttlMs;
    constructor(ttlMs = DEFAULT_SUGGESTION_TTL_MS) {
        if (!Number.isFinite(ttlMs) || ttlMs <= 0)
            throw new Error('automation suggestion ttlMs must be positive');
        this.ttlMs = ttlMs;
    }
    /**
     * 登记一条建议。apply 闭包在用户确认时执行（把可能被用户编辑过的 jobData
     * 合并进建议并写入 CronStore）。
     */
    create(entry) {
        this.pruneExpired();
        const suggestionId = `automation_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
        const createdAt = Date.now();
        const stored = {
            suggestionId,
            shortCode: String(Math.floor(1000 + Math.random() * 9000)),
            operation: entry.operation === 'update' ? 'update' : 'create',
            jobId: typeof entry.jobId === 'string' && entry.jobId.trim() !== '' ? entry.jobId : null,
            baseConfigRevision: Number.isSafeInteger(entry.baseConfigRevision) && Number(entry.baseConfigRevision) > 0
                ? Number(entry.baseConfigRevision)
                : null,
            jobData: JSON.parse(JSON.stringify(entry.jobData)),
            apply: entry.apply,
            applying: false,
            createdAt,
            expiresAt: createdAt + this.ttlMs,
        };
        if (stored.operation === 'update' && (stored.jobId === null || stored.baseConfigRevision === null)) {
            throw new Error('update automation suggestion requires jobId and baseConfigRevision');
        }
        this.entries.set(suggestionId, stored);
        return publicEntry(stored);
    }
    get(ref) {
        this.pruneExpired();
        const found = [...this.entries.values()].find(entry => entry.suggestionId === ref || entry.shortCode === ref);
        return found !== undefined ? publicEntry(found) : null;
    }
    list() {
        this.pruneExpired();
        return [...this.entries.values()].sort((a, b) => a.createdAt - b.createdAt).map(publicEntry);
    }
    /**
     * 应用建议：合并用户编辑 → 签发 receipt → 执行 apply（写 CronStore）。
     * 不存在 / 过期 / 正在应用分别返回对应失败原因。
     */
    async apply({ ref, value } = {}) {
        this.pruneExpired();
        const candidates = [...this.entries.values()].sort((a, b) => b.createdAt - a.createdAt);
        const entry = ref != null && ref !== ''
            ? candidates.find(candidate => candidate.suggestionId === ref || candidate.shortCode === ref)
            : candidates[0];
        if (entry === undefined)
            return { ok: false, reason: 'not-found' };
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(entry.suggestionId);
            return { ok: false, reason: 'expired' };
        }
        if (entry.applying)
            return { ok: false, reason: 'already-applying' };
        entry.applying = true;
        try {
            const merged = mergeConfirmedDraft(entry.jobData, value);
            const receipt = Object.freeze({
                suggestionId: entry.suggestionId,
                confirmedAt: new Date().toISOString(),
                expiresAt: entry.expiresAt,
                operation: entry.operation,
                jobId: entry.jobId,
                baseConfigRevision: entry.baseConfigRevision,
            });
            assertReceiptUsable(receipt);
            const result = await Promise.resolve(entry.apply({ jobData: merged, receipt }));
            this.entries.delete(entry.suggestionId);
            return { ok: true, suggestion: publicEntry(entry), result };
        }
        finally {
            entry.applying = false;
        }
    }
    /** 用户显式拒绝一条建议：立即移除（不存在返回 false）。 */
    dismiss(ref) {
        this.pruneExpired();
        const entry = [...this.entries.values()].find(candidate => candidate.suggestionId === ref || candidate.shortCode === ref);
        if (entry === undefined)
            return false;
        this.entries.delete(entry.suggestionId);
        return true;
    }
    pruneExpired() {
        const now = Date.now();
        for (const [id, entry] of this.entries) {
            if (entry.expiresAt <= now && entry.applying !== true)
                this.entries.delete(id);
        }
    }
}
/** 把用户在确认卡上做过的修改合并进建议草稿（仅白名单字段）。 */
function mergeConfirmedDraft(base, value) {
    if (!isPlainObject(value))
        return base;
    const draft = isPlainObject(value.jobData) ? value.jobData : value;
    const next = JSON.parse(JSON.stringify(base));
    for (const key of Object.keys(draft)) {
        if (!CONFIRMABLE_FIELDS.has(key))
            continue;
        if (draft[key] === undefined)
            continue;
        next[key] = draft[key];
    }
    return next;
}
function assertReceiptUsable(receipt) {
    if (receipt.expiresAt <= Date.now()) {
        throw new CodedError('自动化建议已过期', 'automation_suggestion_receipt_expired', 410);
    }
}
function publicEntry(entry) {
    return {
        suggestionId: entry.suggestionId,
        shortCode: entry.shortCode,
        operation: entry.operation,
        jobId: entry.jobId,
        baseConfigRevision: entry.baseConfigRevision,
        jobData: JSON.parse(JSON.stringify(entry.jobData)),
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
    };
}
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
//# sourceMappingURL=suggestions.js.map