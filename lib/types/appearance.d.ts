/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
/** 设置项默认值：关闭（默认保持原生不透明外观）。 */
export declare const APPEARANCE_DEFAULT_GLASS = false;
/** 玻璃表面不透明度默认值（百分比；40–95，越大越不透）。 */
export declare const APPEARANCE_DEFAULT_OPACITY = 75;
export declare const APPEARANCE_MIN_OPACITY = 40;
export declare const APPEARANCE_MAX_OPACITY = 95;
/**
 * 注册「玻璃质感」开关 + 不透明度：settings 持久化 + HTTP API。
 * @param ctx - host 上下文。
 */
export declare function applyAppearance(ctx: PluginContext): void;
export {};
