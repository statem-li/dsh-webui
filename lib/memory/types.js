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
};
//# sourceMappingURL=types.js.map