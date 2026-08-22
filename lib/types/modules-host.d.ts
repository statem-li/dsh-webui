import { type WebuiModuleKey } from './modules.js';
/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
/** settings.yaml 命名空间。 */
export declare const WEBUI_MODULES_NAMESPACE = "webui-modules";
/** HTTP 路由。 */
export declare const WEBUI_MODULES_API = "/api/webui-modules";
/** 全量布尔表（每个 key 都有确定值）。 */
export type ResolvedModules = Record<WebuiModuleKey, boolean>;
/**
 * 注册模块开关命名空间 + API，返回本次启动生效的全量模块布尔表。
 * settings 命名空间重复注册（插件加载两次）时降级为只读默认值。
 */
export declare function applyModulesHost(ctx: PluginContext): ResolvedModules;
export {};
