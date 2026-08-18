/**
 * webui — 用量统计 + 技能管理服务端（自 dsh-usage-skill 融合）。
 *
 * host 半身复用 dsh-usage-skill 的 lib 产物（JS 无类型声明）：
 * - /api/usage-stats/*（usage/providers/balance/subscriptions/account/credentials）
 * - /api/skill-manager/*（技能包管理）
 * 由 webui 的 apply 统一装载，usage-skill 插件本身退役。
 */

/** 装载 usage-stats + skill-manager 的全部 host 行为。 */
export async function applyUsageHost(ctx: any, config: any): Promise<void> {
  try {
    // @ts-expect-error — dsh-usage-skill 是 JS 产物（lib 无类型声明），运行时动态解析
    const usage = await import('dsh-usage-skill')
    if (typeof usage.apply === 'function') {
      await usage.apply(ctx, config ?? {})
    } else {
      console.error('[webui] applyUsageHost: dsh-usage-skill has no apply export')
    }
  } catch (error: any) {
    console.error('[webui] applyUsageHost failed:', error?.message ?? error)
  }
}
