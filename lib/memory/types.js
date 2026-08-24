/**
 * dsh-memory 共享类型：记忆条目、变更记录、ticker 状态与插件配置。
 * 全部为纯 JSON 可序列化结构（schema v1）。
 */
/** 默认配置。 */
export const DEFAULT_CONFIG = {
    extractEveryTurns: 1,
    compileEveryTurns: 10,
    compileThreshold: 4.5,
    decayLambda: 0.02,
    hitBonus: 2,
    injectTokenBudget: 6000,
    injectRefreshSteps: 8,
    dailyCompileEnabled: true,
    extractMaxChars: 6000,
    minImportance: 6,
    consolidateEnabled: true,
    consolidateMaxEntries: 200,
    consolidateTimeoutMs: 60_000,
    logApiRequests: false,
    injectTopK: 8,
    entryLimit: 500,
};
// ── 配置覆盖与公开视图（cordis.patch.yml 与 config.json 共用） ────────
/** 数值字段的取值域（面板输入越界时钳制而非丢弃；integer 字段四舍五入取整）。 */
export const CONFIG_NUMBER_BOUNDS = {
    extractEveryTurns: { min: 1, max: 100, int: true, step: 1 },
    compileEveryTurns: { min: 1, max: 500, int: true, step: 1 },
    compileThreshold: { min: 0, max: 20, int: false, step: 0.5 },
    decayLambda: { min: 0, max: 0.5, int: false, step: 0.01 },
    hitBonus: { min: 0, max: 10, int: false, step: 0.5 },
    injectTokenBudget: { min: 1000, max: 60_000, int: true, step: 500 },
    injectRefreshSteps: { min: 1, max: 200, int: true, step: 1 },
    extractMaxChars: { min: 500, max: 60_000, int: true, step: 500 },
    minImportance: { min: 1, max: 10, int: false, step: 0.5 },
    consolidateMaxEntries: { min: 10, max: 2000, int: true, step: 10 },
    consolidateTimeoutMs: { min: 5000, max: 600_000, int: true, step: 5000 },
    injectTopK: { min: 1, max: 50, int: true, step: 1 },
    entryLimit: { min: 50, max: 100_000, int: true, step: 50 },
};
const CONFIG_NUMBER_KEYS = Object.keys(CONFIG_NUMBER_BOUNDS);
const CONFIG_BOOLEAN_KEYS = ['dailyCompileEnabled', 'consolidateEnabled', 'logApiRequests'];
/**
 * 应用配置覆盖（原地更新 config；返回实际应用的字段子集，供持久化）。
 * 数值按 CONFIG_NUMBER_BOUNDS 钳制到合法域（越界钳制而非静默丢弃——
 * 旧实现要求 value > 0，导致 decayLambda=0 / compileThreshold=0 等
 * 合法的"关闭衰减/不设阈值"写不进去，面板上看似保存成功实则被丢弃）。
 */
export function applyConfigOverrides(config, candidate) {
    const applied = {};
    if (candidate === null || typeof candidate !== 'object')
        return applied;
    const raw = candidate;
    for (const key of CONFIG_NUMBER_KEYS) {
        const value = raw[key];
        if (typeof value !== 'number' || !Number.isFinite(value))
            continue;
        const bounds = CONFIG_NUMBER_BOUNDS[key];
        let next = Math.min(bounds.max, Math.max(bounds.min, value));
        if (bounds.int)
            next = Math.round(next);
        else
            next = Math.round(next * 100) / 100;
        config[key] = next;
        applied[key] = next;
    }
    for (const key of CONFIG_BOOLEAN_KEYS) {
        const value = raw[key];
        if (typeof value === 'boolean') {
            ;
            config[key] = value;
            applied[key] = value;
        }
    }
    return applied;
}
/** 面板可展示的公开配置视图（只暴露可调字段）。 */
export function publicConfig(config) {
    const out = {};
    for (const key of CONFIG_NUMBER_KEYS)
        out[key] = config[key];
    for (const key of CONFIG_BOOLEAN_KEYS)
        out[key] = config[key];
    return out;
}
//# sourceMappingURL=types.js.map