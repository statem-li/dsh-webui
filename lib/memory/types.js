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
const CONFIG_NUMBER_KEYS = [
    'extractEveryTurns', 'compileEveryTurns', 'compileThreshold', 'decayLambda',
    'hitBonus', 'injectTokenBudget', 'injectRefreshSteps', 'extractMaxChars',
    'minImportance', 'consolidateMaxEntries', 'consolidateTimeoutMs', 'injectTopK', 'entryLimit',
];
const CONFIG_BOOLEAN_KEYS = ['dailyCompileEnabled', 'consolidateEnabled', 'logApiRequests'];
/** 应用配置覆盖（原地更新 config；返回实际应用的字段子集，供持久化）。 */
export function applyConfigOverrides(config, candidate) {
    const applied = {};
    if (candidate === null || typeof candidate !== 'object')
        return applied;
    const raw = candidate;
    for (const key of CONFIG_NUMBER_KEYS) {
        const value = raw[key];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            ;
            config[key] = value;
            applied[key] = value;
        }
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