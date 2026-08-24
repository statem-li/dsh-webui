/**
 * team — 对话框团队开关（host 半身，docs §6.5）。
 *
 * 生效机制（零 DSH 源码改动）：
 *  1. 会话级开关持久化在 ${DSH_HOME}/team/chat-mode.json（sessionId → 状态）。
 *  2. 注册 systemPrompt section `team-mode`：**有任一会话开启**时注入团队编制说明与
 *     调用约定（DSH 的 systemPrompt.section 是全局渲染面，拿不到「当前会话 id」，
 *     因此注入内容按「已开启的会话集合」渲染：单会话开启时直接给该团队详情；
 *     多会话开启时给出各会话对应的团队，并要求模型按当前会话取用）。
 *  3. 模型据此在需要多角色协作时调用 team_run 工具；工具触发天然带 agent 上下文，
 *     角色可走 subagent 通道（有完整工具能力）。
 *  4. 关闭时 text 返回空串 → renderPrompt 自动丢弃，零 token 占用。
 */
import type { TeamStore } from './store.js';
/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any;
/**
 * 注册团队模式的系统提示词注入。返回 dispose。
 *
 * 读取开销：每次渲染读一次 chat-mode.json + 已开启会话的团队文件；
 * 用 300ms 缓存避免同一轮多次渲染重复读盘。
 */
export declare function applyTeamChatMode(ctx: AnyContext, store: TeamStore): () => void;
export {};
