/**
 * team — 对话框团队开关（host 半身，docs §6.5）。
 *
 * 生效机制（零 DSH 源码改动）：
 *  1. 会话级开关持久化在 ${DSH_HOME}/team/chat-mode.json（sessionId → 状态）。
 *  2. 注册 systemPrompt section `team-mode`：**仅当渲染所属的那个会话开启**时，注入
 *     该会话所选团队的编制说明与调用约定。会话身份取自 DSH 传给 text() 的
 *     AssembleContext —— `assembleContextFor()` 会带上 `agent`，而 `agent.id`
 *     就是 SessionId。
 *  3. 模型据此在需要多角色协作时调用 team_run 工具；工具触发天然带 agent 上下文，
 *     角色可走 subagent 通道（有完整工具能力）。
 *  4. 关闭（或拿不到会话身份）时 text 返回空串 → renderPrompt 自动丢弃，零 token 占用。
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
