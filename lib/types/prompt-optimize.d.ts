import type { Context } from '@deepseek-ai/cordis';
/** 优化风格 key（与客户端 chips 一致）。 */
export type OptimizeStyle = 'balanced' | 'concise' | 'detailed';
/**
 * 挂载 /api/webui-prompt-optimize 与 /stop 路由（disposer 随插件生命周期清理）。
 * @param ctx - host 上下文（需要 llm + webServer 服务）。
 */
export declare function applyPromptOptimize(ctx: Context): void;
