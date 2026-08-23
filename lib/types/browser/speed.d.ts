/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
/** 注册「浏览器提速模式」：settings 持久化 + 系统提示词注入 + HTTP API。 */
export declare function applyBrowserSpeed(ctx: PluginContext): void;
export {};
