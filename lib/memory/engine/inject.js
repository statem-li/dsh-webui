/**
 * dsh-memory 注入引擎：agent/pre-step 把「全局 identity + 当前项目 memory +
 * pinned + facts」组装为一条带来源的 user message 注入（source: { kind: 'plugin' }）。
 * 绝不写 system prompt（DSH persona complete:true 会静默丢弃）；
 * 只注入当前工作区项目 + 全局层；token 超预算按重要性截断，最低保留置顶。
 * 命中刷新：被注入的条目距上次命中 ≥1 天时刷新 lastHitAt 并加分。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { buildInjectionText, selectInjectionEntries, workspaceHashOf } from './compile.js';
import { searchEntries } from './retrieval.js';
import { daysSince } from './scoring.js';
/** 每次注入最多刷新的命中条目数。 */
const MAX_HITS_PER_INJECTION = 5;
/** ContentBlock[] 或字符串 → 纯文本。 */
function textOf(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    return content
        .map(part => {
        if (typeof part !== 'object' || part === null)
            return '';
        const record = part;
        return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
        .join(' ');
}
/** 从 pre-step 消息里提取当前用户输入文本（作检索 query；跳过插件/指令注入源）。 */
function extractQuery(messages) {
    const texts = [];
    for (const message of messages) {
        if (typeof message !== 'object' || message === null)
            continue;
        const msg = message;
        if (typeof msg.source?.kind === 'string' && msg.source.kind !== 'user')
            continue;
        if (msg.role !== 'user' && msg.role !== undefined)
            continue;
        texts.push(textOf(msg.content));
    }
    return texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}
/**
 * 内置安全规范（每次注入都携带）：敏感凭据严禁提交/更新到 GitHub。
 * 与提取敏感过滤、面板风险提示共同构成凭据防线。
 */
const SAFETY_RULE = [
    '【安全规范】所有 GitHub/OpenAI/AWS/Slack token、私钥、password 等敏感凭据',
    '严禁提交或更新到 GitHub 仓库；代码中一律用环境变量引用，',
    '并确保 .gitignore 排除含凭据的文件。',
].join('');
/** 创建注入器。 */
export function createMemoryInjector(store, config, logger) {
    /** 每会话 step 计数（仅内存）。 */
    const stepCounters = new Map();
    async function buildMemoryBlock(agent, query) {
        const entries = await store.readEntries();
        const hash = workspaceHashOf(agent.session.header);
        // disabled 条目保留在库与检索中，但绝不参与注入；
        // deprecated 条目（软废弃）同样不参与注入。
        const visible = entries.filter(entry => entry.disabled !== true && entry.deprecated !== true &&
            (entry.scope === 'global' || (entry.scope === 'project' && entry.projectHash === hash)));
        if (visible.length === 0)
            return null;
        // 常驻：pinned（无条件）+ 全局身份/偏好 + 长期沉淀；其余按当前任务检索 top-k。
        const pinned = visible.filter(entry => entry.pinned);
        const identity = visible.filter(entry => entry.scope === 'global' && !entry.pinned && (entry.kind === 'identity' || entry.kind === 'preference'));
        const longterm = visible.filter(entry => entry.layer === 'long' && !entry.pinned && !identity.includes(entry));
        const rest = visible.filter(entry => !pinned.includes(entry) && !identity.includes(entry) && !longterm.includes(entry));
        const topK = query.trim() === ''
            ? selectInjectionEntries(rest, config.compileThreshold).slice(0, config.injectTopK)
            : searchEntries(query, rest, 'hybrid').slice(0, config.injectTopK).map(match => match.entry);
        const selected = [...pinned, ...identity, ...longterm, ...topK];
        if (selected.length === 0)
            return null;
        // 命中刷新：从未命中或距上次命中 ≥1 天的条目加分并重置衰减起点（最多 MAX_HITS 条）。
        const hitCandidates = selected
            .filter(entry => entry.lastHitAt === null || daysSince(entry.lastHitAt) >= 1)
            .slice(0, MAX_HITS_PER_INJECTION);
        if (hitCandidates.length > 0) {
            const hitIds = new Set(hitCandidates.map(entry => entry.id));
            const refreshed = await store.applyHits(hitIds, config.hitBonus);
            logger?.debug?.(`[dsh-memory] hit refresh: ${refreshed} entries`);
        }
        return buildInjectionText(selected, config);
    }
    const preStepListener = async (payload, next) => {
        let decision;
        try {
            // next() 抛错（下游 listener 失败）绝不能扩散：DSH 会把 pre-step
            // 失败上报为 turn 错误，但我们要保证本插件永远不成为崩溃源。
            decision = await next();
        }
        catch (error) {
            logger?.warn?.(`[dsh-memory] pre-step next() failed: ${error instanceof Error ? error.message : String(error)}`);
            return { kind: 'reject' };
        }
        if (decision.kind !== 'enter' || payload.signal.aborted)
            return decision;
        const sessionId = payload.agent.session.id;
        // 该会话的记忆注入开关（对话框旁开关控制）：关闭则本会话不注入。
        if (!(await store.isInjectEnabled(sessionId)))
            return decision;
        // 每个会话只在首步注入一次：后续轮次不再重复注入，
        // 避免置顶/记忆内容在多轮里反复出现（用户明确要求仅首轮注入）。
        if (stepCounters.has(sessionId))
            return decision;
        stepCounters.set(sessionId, 1);
        try {
            const query = extractQuery(payload.messages);
            const block = await buildMemoryBlock(payload.agent, query);
            if (block === null || block.text === '')
                return decision;
            // 注入引导：明确记忆属于用户指令/参考，模型应"该执行就执行"；
            // 同时声明优先级——与 AGENTS.md/项目指令/系统提示冲突时，以项目指令为准，
            // 记忆不覆盖项目级规范（避免与项目指令打架）。
            const wrapped = [
                SAFETY_RULE,
                '【长期记忆 · 用户要求按需执行或参考】',
                '（若与当前项目的 AGENTS.md / 项目指令或系统提示冲突，一律以项目指令为准；记忆仅作参考与用户偏好补充）',
                block.text,
            ].join('\n');
            const memoryMessage = createUserMessage({
                content: [{ type: 'text', text: wrapped }],
                source: {
                    kind: 'plugin',
                    plugin: 'dsh-memory',
                    form: 'snapshot',
                    sections: [{ name: '安全规范', text: SAFETY_RULE }, ...block.sections],
                },
            });
            return { kind: 'enter', messages: [...decision.messages, memoryMessage] };
        }
        catch (error) {
            // 注入失败绝不阻塞对话。
            logger?.warn?.(`[dsh-memory] injection failed: ${error instanceof Error ? error.message : String(error)}`);
            return decision;
        }
    };
    return {
        preStepListener,
        disposeSession: (sessionId) => {
            stepCounters.delete(sessionId);
        },
    };
}
//# sourceMappingURL=inject.js.map