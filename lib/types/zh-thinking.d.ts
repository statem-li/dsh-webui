/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
/** 注册「中文思考」开关：settings 持久化 + 提示词注入 + HTTP API。 */
export declare function applyZhThinking(ctx: PluginContext): void;
export {};
