/**
 * team — host 半身装配（HTTP 路由 + 工具 + 设置命名空间 + 提示词注入）。
 *
 * 路由（loopback-only，前缀 /api/webui-team）：
 *   GET  /teams                     → { ok, teams, activeTeamId }
 *   POST /teams                     → { action: create|generate|duplicate|remove|rename|activate|reset }
 *   GET  /teams/<id>                → { ok, team }
 *   POST /teams/<id>                → 保存该团队编制（body = team 对象）
 *   GET/POST /globals               → 全局默认读写
 *   GET  /providers                 → 模型枚举（provider 分组）
 *   GET  /capabilities              → 能力目录（可装配的工具 / 技能 / 技能包）
 *   GET/POST /chat-mode?sessionId=  → 对话框团队开关
 *   POST /runs                      → 启动运行
 *   GET  /runs?teamId=&limit=       → 运行清单
 *   GET  /runs/active?sessionId=    → 本会话活跃运行快照（HUD 轮询）
 *   GET  /runs/<id>                 → 运行快照
 *   GET  /runs/<id>/output?name=    → 单步完整产出（name=steps 文件名，或 final）
 *   POST /runs/<id>/cancel          → 取消运行
 *   POST /runs/<id>/resume          → 一键接续（同一个 run 上重跑未完成步骤）
 *   POST /runs/<id>/remove          → 删除运行记录
 */
/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any;
export declare const TEAM_ROUTE_PREFIX = "/api/webui-team";
export declare const TEAM_SETTINGS_NAMESPACE = "webui-team";
/** 挂载 team 模块（host 半身）。 */
export declare function applyTeamHost(ctx: AnyContext): void;
export {};
