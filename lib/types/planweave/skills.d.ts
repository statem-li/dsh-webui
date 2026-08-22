import type { Context } from '@deepseek-ai/cordis';
/**
 * 注册 planweave_install_skills 工具。由 applyPlanweaveHost 调用；
 * ctx.effect 生命周期由调用方统一包裹（本函数只做注册、返回 disposer）。
 */
export declare function registerPlanweaveSkillsTool(ctx: Context): () => void;
