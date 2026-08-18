/**
 * dsh-memory 提取引擎：turn/end 捕获的本轮对话增量窗口 → LLM 结构化提取候选。
 * 输入是「增量窗口」（本 turn 的 user/assistant 文本），不重读整会话。
 * LLM 失败/超时一律跳过本轮，绝不阻塞对话。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ExtractCandidate, MemoryConfig } from '../types.js';
/** 插件用最小 agent 面（避免深层类型依赖）。 */
export interface MinimalAgent {
    readonly id: string;
    readonly options: {
        provider?: string;
        model?: string;
    };
    readonly session: {
        readonly id: string;
        readonly header?: {
            cwd?: string;
        };
    };
}
/**
 * 解析 LLM 输出为候选列表（容错：剥 fence / 去 BOM / 找最外层对象；失败返回 []）。
 */
export declare function parseExtractOutput(raw: string): ExtractCandidate[];
/** 提取 prompt：把「闲聊」与「值得记忆」分开，输出结构化 JSON。 */
export declare function extractSystemPrompt(): string;
/** 组装提取请求的 user 消息（JSON 包裹转录文本，防结构性破坏）。 */
export declare function extractUserPrompt(transcript: string): string;
/**
 * 通过 DSH 现有模型通道提取候选。
 * @returns 候选列表；任何失败返回 []（尽力而为的副产物）。
 */
export declare function extractCandidates(ctx: Context, agent: MinimalAgent, transcript: string, config: MemoryConfig): Promise<ExtractCandidate[]>;
/** 检测内容是否包含敏感凭据。 */
export declare function isSensitiveContent(text: string): boolean;
/** 从事件流维护的 turn 缓冲里取文本（extract 输入）。 */
export declare function transcriptFromEvents(events: Array<{
    type: string;
    data: unknown;
}>): string;
/** 把 ContentBlock[] 或字符串平铺为文本。 */
export declare function textOfContent(content: unknown): string;
/** 变更流摘要（供 change 记录）。 */
export declare function candidateSummary(candidate: ExtractCandidate): string;
