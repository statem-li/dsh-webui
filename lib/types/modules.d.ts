/**
 * webui — 功能模块清单与开关解析（host / client 两端共用）。
 *
 * dsh-webui 是全家桶插件，但并非所有用户都需要全部能力。本模块定义一份
 * 统一的功能模块 key 清单，两端按同一份语义裁剪：
 *
 *  - host 半身（src/index.ts）：为 false 的模块不装配（工具 / provider /
 *    HTTP API / settings 命名空间都不注册）。
 *  - client 半身（src/client/index.ts）：为 false 的模块不注册 UI 槽位
 *    （设置卡、面板入口、shadow、样式注入等）。
 *
 * 配置通道：
 *  - host：settings 命名空间 `webui-modules`（settings.yaml 持久化），
 *    经 GET/POST `/api/webui-modules` 暴露给浏览器端。改动后**重启 DSH 生效**
 *    （host 模块在插件加载时一次性装配，不做运行时卸载）。
 *  - client：启动时同步读 localStorage 缓存（`dsh-webui.modules`）立即生效；
 *    后台 fetch `/api/webui-modules` 校正缓存，下次刷新对齐服务端配置。
 *
 * 语义：**缺省 = 启用**；只有显式 `false` 才关闭（`isModuleEnabled`）。
 * 这样 localStorage / settings 里只需要存「被关掉的那几项」，升级新增模块时
 * 老配置自动保持启用。
 */
/** 全部可开关的功能模块 key（与 README「功能总览」分组对应）。 */
export declare const WEBUI_MODULE_KEYS: readonly ["messageWidth", "doneSound", "donePill", "approvalNotify", "ctrlEnter", "sessionMotion", "sessionPin", "rewind", "screenshot", "promptOptimize", "zhThinking", "peakValley", "chatStats", "toolSummary", "reasoningSync", "modelSeats", "providerHub", "vision", "webSearch", "mail", "skills", "browser", "automation", "planweave", "memory", "usage", "fileExplorer", "dirPicker", "appearance", "sidebarFloat", "updater", "proxy"];
/** 单个功能模块的 key。 */
export type WebuiModuleKey = (typeof WEBUI_MODULE_KEYS)[number];
/** 部分覆盖表：只包含被显式配置的模块（缺省 = 启用）。 */
export type WebuiModuleOverrides = Partial<Record<WebuiModuleKey, boolean>>;
/**
 * 从任意来源（settings 值 / localStorage JSON / API body）提取合法的部分
 * 覆盖表：丢弃未知 key 与非布尔值，绝不抛错。
 */
export declare function normalizeModules(input: unknown): WebuiModuleOverrides;
/**
 * 判定某模块是否启用：缺省 = 启用，只有显式 false 关闭。
 */
export declare function isModuleEnabled(modules: WebuiModuleOverrides, key: WebuiModuleKey): boolean;
