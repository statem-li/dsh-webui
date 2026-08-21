/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
/** 设置项默认值：开启（固定侧边栏 = 原生行为，保持原有体验）。 */
export declare const SIDEBAR_FLOAT_DEFAULT_FIXED = true;
/**
 * 注册「固定侧边栏」开关：settings 持久化 + HTTP API。
 * @param ctx - host 上下文。
 */
export declare function applySidebarFloat(ctx: PluginContext): void;
export {};
