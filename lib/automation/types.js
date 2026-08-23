/**
 * automation — 类型定义（参考 openhanako automation v4 契约，单 Agent 形态）。
 *
 * 一个自动化任务（job）= 触发器（at / every / cron）+ 一段让 Agent 执行的
 * prompt（可选指定模型）。到期时由调度器在服务进程内真实执行一次模型调用，
 * 并把每次运行落一条 jsonl 运行记录。
 *
 * 与 openhanako 的字段差异（功能等价的前提下按 DSH 单 Agent 形态裁剪）：
 * 无 studioId / actorAgentId / executionContext / executor（DSH 只有一种
 * 执行者——本进程 Agent；执行方式固定为 agent run）。
 */
/** 存储契约版本：读取到更高版本的 job 时跳过执行（前向兼容）。 */
export const AUTOMATION_SCHEMA_VERSION = 1;
/** 带 code/status 的可识别错误（路由层转 HTTP 状态码）。 */
export class CodedError extends Error {
    code;
    status;
    constructor(message, code, status = 409) {
        super(message);
        this.name = 'CodedError';
        this.code = code;
        this.status = status;
    }
}
/** 归一化模型引用：'' 或 {id[,provider]}。 */
export function normalizeModelRef(model) {
    if (model === null || model === undefined || model === '')
        return '';
    if (typeof model === 'string') {
        const value = model.trim();
        if (value === '')
            return '';
        const slash = value.indexOf('/');
        if (slash > 0 && slash < value.length - 1) {
            return { id: value.slice(slash + 1), provider: value.slice(0, slash) };
        }
        return { id: value };
    }
    if (typeof model === 'object') {
        const raw = model;
        const id = typeof raw.id === 'string' ? raw.id.trim() : '';
        if (id === '')
            return '';
        const provider = typeof raw.provider === 'string' ? raw.provider.trim() : '';
        return provider !== '' ? { id, provider } : { id };
    }
    return '';
}
/** job 归一化：补默认值、规范 model、钳制 every 最小间隔。 */
export function normalizeJob(job) {
    return {
        ...job,
        schedule: job.type === 'every'
            ? Math.max(MIN_EVERY_INTERVAL_MS, typeof job.schedule === 'number' ? job.schedule : Number.parseInt(String(job.schedule), 10) || MIN_EVERY_INTERVAL_MS)
            : job.schedule,
        model: normalizeModelRef(job.model),
        schemaVersion: Number.isInteger(job.schemaVersion) && job.schemaVersion > AUTOMATION_SCHEMA_VERSION
            ? job.schemaVersion
            : AUTOMATION_SCHEMA_VERSION,
        configRevision: Number.isSafeInteger(job.configRevision) && job.configRevision > 0 ? job.configRevision : 1,
        consecutiveErrors: Number.isFinite(job.consecutiveErrors) ? job.consecutiveErrors : 0,
    };
}
/** every 类型的最小间隔（毫秒）。 */
export const MIN_EVERY_INTERVAL_MS = 60_000;
/** 从 label / prompt 推导显示名。 */
export function deriveJobLabel({ label, prompt }) {
    if (typeof label === 'string' && label.trim() !== '')
        return label.trim();
    if (typeof prompt === 'string' && prompt.trim() !== '')
        return prompt.slice(0, 30);
    return '';
}
//# sourceMappingURL=types.js.map