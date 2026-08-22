/**
 * webui — 自动化执行引擎（host 半身）。
 *
 * 把「自动化」从纯前端模拟升级为真实执行：客户端（localStorage 里的任务步骤）
 * 通过 loopback HTTP 把步骤序列 + 模型配置发给这里，host 用 `ctx.llm` 逐步
 * 真实调用模型，按每步的失败分支（stop/skip）与重试次数（retry）推进，可选的
 * 把输出写入工作区文件，最后返回结构化结果（每步成功/失败/跳过 + 输出摘要 +
 * 文件清单），客户端据此落执行日志。
 *
 * Routes (loopback-only):
 *   POST /api/webui-automation/run      { provider, model, retry, steps[] } → 执行结果
 *   GET  /api/webui-automation/download?path=<abs>   → 下载工作区内文件
 *   POST /api/webui-automation/reveal   { path }      → 在文件管理器中打开所在文件夹
 *
 * 安全：仅接受 loopback 请求；download/reveal 的路径必须落在某个已注册工作区内。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 挂载 /api/webui-automation 路由（webui 组合调用）。 */
export declare function applyAutomationHost(ctx: Context): void;
