/**
 * dsh-memory 提取引擎：turn/end 捕获的本轮对话增量窗口 → LLM 结构化提取候选。
 * 输入是「增量窗口」（本 turn 的 user/assistant 文本），不重读整会话。
 * LLM 失败/超时一律跳过本轮，绝不阻塞对话。
 */
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { summarize } from './store.js';
/** 提取超时（毫秒）。 */
const EXTRACT_TIMEOUT_MS = 30_000;
/**
 * 解析 LLM 输出为候选列表（容错：剥 fence / 去 BOM / 找最外层对象；失败返回 []）。
 */
export function parseExtractOutput(raw) {
    let text = raw.trim();
    // 剥 markdown code fence。
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    if (fence !== null)
        text = fence[1].trim();
    // 去 BOM / 多余空白。
    text = text.replace(/^\uFEFF/, '').trim();
    // 找最外层 JSON 对象。
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    }
    catch {
        return [];
    }
    if (typeof parsed !== 'object' || parsed === null)
        return [];
    const memories = parsed.memories;
    if (!Array.isArray(memories))
        return [];
    const out = [];
    for (const item of memories) {
        if (typeof item !== 'object' || item === null)
            continue;
        const record = item;
        const content = typeof record.content === 'string' ? record.content.trim() : '';
        if (content === '')
            continue;
        const scope = record.scope === 'global' ? 'global' : 'project';
        const tags = Array.isArray(record.tags)
            ? record.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '')
                .map(tag => tag.trim())
                .slice(0, 8)
            : [];
        const importance = typeof record.importance === 'number' && Number.isFinite(record.importance)
            ? Math.max(1, Math.min(10, Math.round(record.importance)))
            : 5;
        out.push({ content, scope, tags, importance });
    }
    return out;
}
/** 提取 prompt：把「闲聊」与「值得记忆」分开，输出结构化 JSON。 */
export function extractSystemPrompt() {
    return [
        'You are a memory extractor for an AI assistant. Read the conversation transcript and extract information worth remembering across sessions.',
        'Return ONLY a JSON object in this exact shape (no markdown, no commentary):',
        '{"memories":[{"content":"...","scope":"global"|"project","tags":["..."],"importance":1}]}',
        'Rules:',
        '- Extract only durable facts, decisions, preferences, gotchas, project context, architecture notes, API details, and user identity that would help future sessions.',
        '- Skip small talk, greetings, chit-chat, and content with no lasting value.',
        '- scope: "global" for user identity/preferences/working style; "project" for workspace/project-specific content.',
        '- tags: 1-4 short category tags in the same language as the content (e.g. 技术, 踩坑, 架构, 偏好).',
        '- importance: integer 1-10; higher = more valuable to remember. Use 6+ for real facts, 8+ for critical decisions.',
        '- content: write in the original language of the conversation, one complete concise sentence or bullet.',
        '- NEVER extract project instruction files (AGENTS.md, CLAUDE.md), the skill catalog (available skills list), or any skill content: those are auto-injected by the harness and must NOT be stored as memory.',
        '- If nothing is worth remembering, return {"memories":[]}.',
    ].join('\n');
}
/** 组装提取请求的 user 消息（JSON 包裹转录文本，防结构性破坏）。 */
export function extractUserPrompt(transcript) {
    return `Extract memories from this conversation transcript (JSON string):\n${JSON.stringify(transcript)}`;
}
/**
 * 通过 DSH 现有模型通道提取候选。
 * @returns 候选列表；任何失败返回 []（尽力而为的副产物）。
 */
export async function extractCandidates(ctx, agent, transcript, config) {
    if (transcript.trim() === '')
        return [];
    const llm = ctx.get('llm');
    if (llm === undefined)
        return [];
    const route = await resolveRoute(ctx, agent);
    if (route === undefined)
        return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
    try {
        const options = {
            provider: route.provider,
            model: route.model,
            messages: [createUserMessage({
                    content: [{ type: 'text', text: extractUserPrompt(transcript.slice(0, config.extractMaxChars)) }],
                    source: { kind: 'plugin', plugin: 'dsh-memory' },
                })],
            system: extractSystemPrompt(),
            // 推理模型需要空间输出 JSON：text + reasoning 都会产生，上限调高。
            maxTokens: 2048,
            signal: controller.signal,
        };
        const assembler = new BlockAssembler();
        for await (const chunk of llm.stream(options)) {
            assembler.push(chunk);
        }
        const finish = assembler.finish;
        if (finish.kind !== 'stop')
            return [];
        // 同时聚合 text 与 reasoning 块：部分推理模型（route=bai 等）在低 token
        // 预算下可能只产出 reasoning 而 text 为空，导致解析出 0 候选。
        const text = assembler.blocks()
            .filter(block => block.type === 'text' || block.type === 'reasoning')
            .map(block => block.text ?? '')
            .join(' ');
        const candidates = parseExtractOutput(text);
        // 应用 importance 下限 + 敏感凭据过滤（token/密钥/私钥绝不入库）。
        return candidates.filter(candidate => candidate.importance >= config.minImportance && !isSensitiveContent(candidate.content));
    }
    catch (error) {
        ctx.logger?.debug?.(`[dsh-memory] extract failed: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
    finally {
        clearTimeout(timer);
    }
}
/** 敏感凭据模式（自动提取时命中即丢弃，防止密钥/token 入库）。 */
const SENSITIVE_PATTERNS = [
    /gh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
    /sk-[A-Za-z0-9_-]{20,}/i, // OpenAI 等
    /AKIA[0-9A-Z]{16}/, // AWS access key
    /xox[baprs]-[A-Za-z0-9-]{20,}/i, // Slack tokens
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i, // 私钥块
    /(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[=:]\s*[^\s,，。；;]{8,}/i,
];
/** 检测内容是否包含敏感凭据。 */
export function isSensitiveContent(text) {
    return SENSITIVE_PATTERNS.some(pattern => pattern.test(text));
}
/** 解析 LLM 路由：agent 显式配置优先，回退默认模型选择（consolidate 复用）。 */
export async function resolveRoute(ctx, agent) {
    if (agent.options.provider !== undefined && agent.options.model !== undefined
        && agent.options.provider !== '' && agent.options.model !== '') {
        return { provider: agent.options.provider, model: agent.options.model };
    }
    const defaultModel = ctx.get('agentDefaultModel');
    if (defaultModel !== undefined) {
        try {
            const selection = defaultModel.currentSelection();
            if (selection.provider !== undefined && selection.model !== undefined) {
                return { provider: selection.provider, model: selection.model };
            }
        }
        catch {
            // fall through
        }
    }
    return undefined;
}
/** 从事件流维护的 turn 缓冲里取文本（extract 输入）。 */
export function transcriptFromEvents(events) {
    const lines = [];
    for (const event of events) {
        if (event.type === 'user/message') {
            const message = event.data;
            // 跳过注入类上下文消息（这些由 DSH/插件自动注入，重复提取成记忆只会造成噪音与冲突）：
            // - plugin：本插件记忆、openviking recall 等插件注入
            // - agent-instructions：AGENTS.md / 项目指令文件自动注入
            // - skill-catalog：DSH 技能目录（可用技能列表）自动注入
            // - skill-invocation：用户触发加载的技能内容
            const injectedKinds = ['plugin', 'agent-instructions', 'skill-catalog', 'skill-invocation'];
            if (typeof message.source?.kind === 'string' && injectedKinds.includes(message.source.kind))
                continue;
            lines.push(`User: ${textOfContent(message.content)}`);
        }
        else if (event.type === 'assistant/message') {
            const data = event.data;
            lines.push(`Assistant: ${textOfContent(data.message?.content)}`);
        }
    }
    return lines.join('\n');
}
/** 把 ContentBlock[] 或字符串平铺为文本。 */
export function textOfContent(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const block of content) {
        if (typeof block !== 'object' || block === null)
            continue;
        const record = block;
        if (record.type === 'text' && typeof record.text === 'string')
            parts.push(record.text);
    }
    return parts.join('\n').trim();
}
/** 变更流摘要（供 change 记录）。 */
export function candidateSummary(candidate) {
    return summarize(candidate.content);
}
//# sourceMappingURL=extract.js.map