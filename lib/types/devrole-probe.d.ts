/**
 * webui — 供应商 Developer Role 兼容性一键检测 + 自动修复。
 *
 * 背景：pi-ai 对不认识的 https 域名网关默认按 OpenAI 本尊对待——推理模型的
 * system prompt 以新式 `"developer"` 角色发送。大量中转/聚合网关不认这个角色，
 * 表现为该供应商所有推理模型一直 HTTP 400 连不通，而普通测试一切正常。
 *
 * 本模块提供「一键兼容检测」：对每个 openai-completions 供应商真实发一条
 * developer 角色的最小请求，再用 system 角色对照——developer 失败而 system
 * 成功即判定「不支持」，随后自动把该供应商的路由级 `compat.supportsDeveloperRole:
 * false` 写入 settings（热重载即时生效），全程无需手动编辑配置。
 *
 * HTTP API：
 *   POST /api/webui-devrole/probe  启动批量检测（409 = 已有检测进行中）
 *   GET  /api/webui-devrole/probe  轮询检测状态（items 逐项点亮）
 *
 * 判定语义：
 *   supported   developer 请求成功——保持现状（不动配置）
 *   unsupported developer 失败但 system 成功——已自动写入 supportsDeveloperRole: false
 *   unknown     两者都失败（密钥/网络/模型问题）——不动配置，note 带原因
 */
/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
/** 注册 HTTP 接口。 */
export declare function applyDevRoleProbe(ctx: PluginContext): void;
export {};
