/**
 * webui — 对话完成胶囊（host 半身）。
 *
 * 全局监听 `session/event`（含后台会话）：任一会话 turn/end 时提取
 *   - 会话标题（session/title 事件 > cwd basename > session id）
 *   - 触发回合的用户问题（回合内最后一条真人 user/message 的文本）
 *   - 助手回复全文（本回合 assistant/message 的 text 块按序拼接）
 * 存入内存完成列表（最近 MAX_ITEMS 条，seq 单调递增）。
 * GET /api/webui-done-pill?since=N 供前端轮询增量（items = seq > N，升序）。
 *
 * 设计约束：
 *  - 只报非 subagent 会话（header.origin === 'subagent' 跳过）；
 *  - aborted 回合不算完成（用户主动停止）；
 *  - 最小服务契约（与 rewind.ts 同款做法），不引入 dsh-session 类型依赖。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
interface WebServerRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void;
}
interface WebServerService {
    register(route: WebServerRoute): () => void;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        webServer: WebServerService;
    }
}
export interface DonePillEntry {
    /** 单调递增序号（也是增量拉取水位）。 */
    seq: number;
    /** 稳定 id（seq 字符串化，供前端去重/已读标记）。 */
    id: string;
    sessionId: string;
    /** 会话显示标题（title 事件 > cwd basename > id）。 */
    title: string;
    /** 触发回合的用户问题文本（找不到真人消息时为空串）。 */
    question: string;
    /** 本回合助手回复全文（text 块拼接）。 */
    answer: string;
    /** 回合结束时间戳。 */
    endedAt: number;
    turn: number;
    /** 结束原因 kind（error 时前端标注「出错结束」）。 */
    reasonKind: string;
}
export declare function applyDonePill(ctx: Context): void;
export {};
