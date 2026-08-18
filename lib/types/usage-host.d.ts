/**
 * webui — 用量统计 + 技能管理服务端（自 dsh-usage-skill 融合）。
 *
 * host 半身复用 dsh-usage-skill 的 lib 产物（JS 无类型声明）：
 * - /api/usage-stats/*（usage/providers/balance/subscriptions/account/credentials）
 * - /api/skill-manager/*（技能包管理）
 * 由 webui 的 apply 统一装载，usage-skill 插件本身退役。
 */
/** 装载 usage-stats + skill-manager 的全部 host 行为。 */
export declare function applyUsageHost(ctx: any, config: any): Promise<void>;
