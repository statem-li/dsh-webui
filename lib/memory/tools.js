/**
 * dsh-memory 模型工具：AI 在对话中可主动调用的记忆操作。
 * memory_search / memory_remember / memory_pin / memory_tag / memory_forget
 * / memory_revise / memory_retire / memory_consolidate。
 * 全部经 @deepseek-ai/dsh-tools 的 defineTool 注册，输出为模型可见文本。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { projectHashOf, summarize } from './engine/store.js';
import { compileAll, workspaceHashOf } from './engine/compile.js';
import { consolidateAll, consolidateScope } from './engine/consolidate.js';
import { searchEntries, searchEntriesSemantic } from './engine/retrieval.js';
import { resolveEmbeddingProvider } from './engine/embedding.js';
/** 注册全部记忆工具，返回合并 disposer。 */
export function registerMemoryTools(ctx, store, config) {
    const disposers = [];
    // ── memory_search ────────────────────────────────────────────────────
    disposers.push(ctx.tools.register(textTool({
        name: 'memory_search',
        description: '搜索本地长期记忆（语义相似度 + 关键词，支持按内容/标签/项目/范围过滤）。用之前记住的决定、偏好、踩坑、项目上下文，或回答"我记得/之前说过"类问题时。',
        parameters: {
            query: { type: 'string', description: '搜索关键词（空格分隔多个词）。留空列出全部。' },
            scope: { type: 'string', enum: ['global', 'project'], description: 'global=全局层（身份/偏好）；project=项目层。默认全部。' },
            project: { type: 'string', description: '项目标识（workspace 路径或 hash）。默认当前工作区项目。' },
            tag: { type: 'string', description: '按标签筛选。' },
            mode: { type: 'string', enum: ['hybrid', 'keyword', 'semantic'], description: '检索模式：hybrid=相似度+精确命中（默认）；keyword=仅精确子串；semantic=向量语义（需配置 embedding，未配置时回退 hybrid）。' },
            includeDeprecated: { type: 'boolean', description: '是否包含已软废弃（retire/revise 旧条目）的记忆。默认 false。' },
            limit: { type: 'integer', description: '返回条数上限（默认 10，最大 30）。' },
        },
        async execute(args, exec) {
            const entries = await store.readEntries();
            const agent = exec.agent;
            const currentHash = agent !== undefined ? workspaceHashOf(agent.session.header) : null;
            const projectFilter = typeof args.project === 'string' && args.project !== ''
                ? resolveProjectFilter(args.project)
                : currentHash;
            const query = typeof args.query === 'string' ? args.query : '';
            const mode = args.mode === 'keyword' || args.mode === 'semantic' ? args.mode : 'hybrid';
            // 先做 scope/project/tag 硬过滤，再做检索排序。
            const visible = entries.filter(entry => {
                if (entry.scope === 'project' && projectFilter !== null && entry.projectHash !== projectFilter)
                    return false;
                if (typeof args.scope === 'string' && entry.scope !== args.scope)
                    return false;
                if (typeof args.tag === 'string' && args.tag !== '' && !entry.tags.includes(args.tag))
                    return false;
                return true;
            });
            const options = { includeDeprecated: args.includeDeprecated === true };
            const embeddingProvider = mode === 'semantic' ? await getEmbeddingProvider(config) : null;
            const matches = mode === 'semantic'
                ? await searchEntriesSemantic(query, visible, embeddingProvider, options)
                : searchEntries(query, visible, mode, options);
            // semantic 检索会补算条目 embedding 缓存（原地写入内存态对象），一次节流刷盘。
            if (embeddingProvider !== null)
                await store.flush();
            const limit = Math.max(1, Math.min(30, typeof args.limit === 'number' ? args.limit : 10));
            const picked = matches.slice(0, limit);
            if (picked.length === 0)
                return '没有找到匹配的记忆。';
            const lines = picked.map(({ entry, score }) => {
                const head = entry.pinned ? '📌' : '';
                const scope = entry.scope === 'global' ? '全局' : '项目';
                const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
                const layer = entry.layer === 'long' ? '（长期）' : '';
                const verified = entry.verified ? '' : '〔待确认〕';
                // 禁用条目仍可被搜索到（避免「记忆凭空消失」），但明确标注不参与注入。
                const disabledMark = entry.disabled === true ? '〔已禁用·不参与注入〕' : '';
                // 软废弃条目（includeDeprecated 时才出现）：标注废弃状态。
                const deprecatedMark = entry.deprecated === true ? '〔已废弃·retire/revise 标记〕' : '';
                const rel = query.trim() !== '' ? `·相关${Math.round(score * 100)}%` : '';
                // id 必须输出：memory_pin / memory_tag / memory_forget 都以 entryId 为入参，
                // 而它们的唯一来源就是本工具的结果。
                return `${entry.id} ${head}[${entry.importance}] ${scope}${layer}: ${entry.content}${disabledMark}${deprecatedMark}${verified}${rel}${tags}`;
            });
            return `${lines.join('\n')}\n（首列为 entryId，可用于 memory_pin / memory_tag / memory_forget / memory_revise / memory_retire）`;
        },
    })));
    // ── memory_remember ──────────────────────────────────────────────────
    disposers.push(ctx.tools.register(textTool({
        name: 'memory_remember',
        description: '手动写入一条长期记忆（用户明确要求记住，或你判断值得跨会话保留的重要事实/决定）。',
        parameters: {
            content: { type: 'string', required: true, description: '要记住的内容。' },
            scope: { type: 'string', enum: ['global', 'project'], description: 'global=全局层（身份/偏好）；project=当前项目层。默认 project。' },
            tags: { type: 'array', items: { type: 'string' }, description: '分类标签（如 技术、踩坑、架构、偏好）。' },
            importance: { type: 'integer', description: '重要性 1-10（默认 8）。' },
        },
        async execute(args, exec) {
            const content = String(args.content ?? '').trim();
            if (content === '')
                throw new Error('content 不能为空');
            const agent = exec.agent;
            const hash = agent !== undefined ? workspaceHashOf(agent.session.header) : null;
            const scope = args.scope === 'global' ? 'global' : 'project';
            if (scope === 'project' && hash === null) {
                throw new Error('无法判定当前工作区项目（无 cwd），请用 scope: "global" 或稍后重试');
            }
            // 项目层写入受「自动记忆」开关约束：该项目关闭自动记忆时拒绝写入（global 层不受影响）。
            if (scope === 'project' && (hash === null || !(await store.isAutoMemoryEnabled(hash)))) {
                throw new Error('当前项目的自动记忆已关闭，已跳过记录；如需记录请先在记忆面板开启该项目开关');
            }
            const importance = typeof args.importance === 'number' ? Math.max(1, Math.min(10, args.importance)) : 8;
            const tags = Array.isArray(args.tags)
                ? args.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
                : [];
            const { created, entry } = await store.upsertEntry({
                content,
                scope,
                projectHash: scope === 'project' ? hash : null,
                tags,
                importance,
                source: 'manual',
            });
            // 项目层落盘时确保 meta.json 存在（面板项目列表可见）。
            if (scope === 'project' && hash !== null) {
                const meta = await store.readProjectMeta(hash);
                if (meta === undefined) {
                    await store.writeProjectMeta(hash, {
                        path: agent?.session.header?.cwd ?? '手动记忆',
                        alias: null,
                        locked: false,
                    });
                }
            }
            await store.appendChange({
                action: created ? 'add' : 'update',
                entryId: entry.id,
                scope: entry.scope,
                projectHash: entry.projectHash,
                summary: summarize(entry.content),
            });
            return created
                ? `已记住：${entry.content}（${scope === 'global' ? '全局' : '项目'}${tags.length > 0 ? `，标签：${tags.join(', ')}` : ''}）`
                : `已更新记忆：${entry.content}`;
        },
    })));
    // ── memory_pin ───────────────────────────────────────────────────────
    disposers.push(ctx.tools.register(textTool({
        name: 'memory_pin',
        description: '置顶/取消置顶一条记忆（置顶的记忆始终进入上下文注入并显示在置顶区）。',
        parameters: {
            entryId: { type: 'string', required: true, description: '记忆条目 id（用 memory_search 获取）。' },
            pinned: { type: 'boolean', description: 'true=置顶，false=取消。默认 true。' },
        },
        async execute(args) {
            const id = String(args.entryId ?? '');
            if (id === '')
                throw new Error('entryId 不能为空');
            const entry = await store.patchEntry(id, { pinned: args.pinned !== false });
            if (entry === undefined)
                throw new Error(`记忆不存在：${id}`);
            return entry.pinned ? `已置顶：${summarize(entry.content)}` : `已取消置顶：${summarize(entry.content)}`;
        },
    })));
    // ── memory_tag ───────────────────────────────────────────────────────
    disposers.push(ctx.tools.register(textTool({
        name: 'memory_tag',
        description: '修改一条记忆的标签（覆盖式更新标签列表）。',
        parameters: {
            entryId: { type: 'string', required: true, description: '记忆条目 id。' },
            tags: { type: 'array', items: { type: 'string' }, required: true, description: '新的标签列表（覆盖旧的）。' },
        },
        async execute(args) {
            const id = String(args.entryId ?? '');
            const tags = Array.isArray(args.tags)
                ? args.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
                : [];
            const entry = await store.patchEntry(id, { tags });
            if (entry === undefined)
                throw new Error(`记忆不存在：${id}`);
            await store.appendChange({
                action: 'update',
                entryId: entry.id,
                scope: entry.scope,
                projectHash: entry.projectHash,
                summary: `改标签：${summarize(entry.content)}`,
            });
            return `标签已更新：${entry.tags.length > 0 ? entry.tags.join(', ') : '（无）'}`;
        },
    })));
    // ── memory_forget ────────────────────────────────────────────────────
    disposers.push(ctx.tools.register(textTool({
        name: 'memory_forget',
        description: '删除一条记忆（仅当用户明确要求删除/遗忘某条记忆时使用）。',
        parameters: {
            entryId: { type: 'string', required: true, description: '记忆条目 id（用 memory_search 获取）。' },
        },
        async execute(args) {
            const id = String(args.entryId ?? '');
            if (id === '')
                throw new Error('entryId 不能为空');
            const entry = await store.getEntry(id);
            if (entry === undefined)
                throw new Error(`记忆不存在：${id}`);
            const ok = await store.removeEntry(id);
            if (!ok)
                throw new Error(`记忆不存在：${id}`);
            await store.appendChange({
                action: 'delete',
                entryId: id,
                scope: entry.scope,
                projectHash: entry.projectHash,
                summary: `删除：${summarize(entry.content)}`,
            });
            return `已删除记忆：${summarize(entry.content)}`;
        },
    })));
    // ── memory_revise ───────────────────────────────────────────────────
    disposers.push(ctx.tools.register(textTool({
        name: 'memory_revise',
        description: '修订一条记忆：软废弃旧条目（保留数据但不再检索/注入），写入新内容作为后继条目。用于记忆过时/错误/需要重写时。返回新旧两个 id。',
        parameters: {
            entryId: { type: 'string', required: true, description: '要修订的旧条目 id（用 memory_search 获取）。' },
            content: { type: 'string', required: true, description: '新的记忆内容（作为后继条目）。' },
            reason: { type: 'string', description: '修订原因（记录在旧条目的废弃原因中）。' },
            tags: { type: 'array', items: { type: 'string' }, description: '后继条目的标签（缺省继承旧条目标签）。' },
            importance: { type: 'integer', description: '后继条目的重要度 1-10（缺省继承旧条目）。' },
        },
        async execute(args, exec) {
            const entryId = String(args.entryId ?? '');
            if (entryId === '')
                throw new Error('entryId 不能为空');
            const content = String(args.content ?? '').trim();
            if (content === '')
                throw new Error('content 不能为空');
            const agent = exec.agent;
            const hash = agent !== undefined ? workspaceHashOf(agent.session.header) : null;
            // 项目层受自动记忆开关约束（与 remember 一致）。
            const target = await store.getEntry(entryId);
            if (target === undefined)
                throw new Error(`记忆不存在：${entryId}`);
            if (target.scope === 'project' && (hash === null || !(await store.isAutoMemoryEnabled(target.projectHash ?? hash)))) {
                throw new Error('该项目的自动记忆已关闭，已跳过修订；如需记录请先在记忆面板开启该项目开关');
            }
            const result = await store.reviseEntry({
                id: entryId,
                content,
                reason: typeof args.reason === 'string' ? args.reason : undefined,
                tags: Array.isArray(args.tags)
                    ? args.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
                    : undefined,
                importance: typeof args.importance === 'number' ? Math.max(1, Math.min(10, args.importance)) : undefined,
            });
            if (result === undefined) {
                // 旧条目不存在/已废弃 → 无法修订；内容未变化 → 无修订空间。
                const current = await store.getEntry(entryId);
                if (current !== undefined && current.deprecated !== true
                    && current.content.trim() === content) {
                    throw new Error('新内容与旧条目相同，无需修订；如需调整请用 memory_tag / memory_pin 或修改元数据');
                }
                throw new Error(`记忆不存在或已废弃：${entryId}`);
            }
            await store.appendChange({
                action: 'revise',
                entryId: result.deprecatedId,
                scope: target.scope,
                projectHash: target.projectHash,
                summary: `修订为：${summarize(result.entry.content)}`,
                before: target.content,
                after: result.entry.content,
            });
            await compileAll(store, config);
            return `已修订记忆：旧条目 ${result.deprecatedId} 已软废弃，新条目 ${result.newId} 已记录：${summarize(result.entry.content)}`;
        },
    })));
    // ── memory_retire ───────────────────────────────────────────────────
    disposers.push(ctx.tools.register(textTool({
        name: 'memory_retire',
        description: '软废弃一条记忆（retire）：数据保留但不再参与检索/注入/编译。用于「这条记忆过时了但不想彻底删除」的场景。彻底删除请用 memory_forget。',
        parameters: {
            entryId: { type: 'string', required: true, description: '要废弃的条目 id（用 memory_search 获取）。' },
            reason: { type: 'string', description: '废弃原因。' },
        },
        async execute(args) {
            const id = String(args.entryId ?? '');
            if (id === '')
                throw new Error('entryId 不能为空');
            const entry = await store.retireEntry(id, typeof args.reason === 'string' ? args.reason : undefined);
            if (entry === undefined)
                throw new Error(`记忆不存在：${id}`);
            await store.appendChange({
                action: 'retire',
                entryId: entry.id,
                scope: entry.scope,
                projectHash: entry.projectHash,
                summary: `废弃：${summarize(entry.content)}`,
                before: entry.content,
            });
            await compileAll(store, config);
            return `已软废弃记忆：${summarize(entry.content)}（数据保留，不再注入；可用 memory_search includeDeprecated 查看）`;
        },
    })));
    // ── memory_consolidate ───────────────────────────────────────────────
    disposers.push(ctx.tools.register(textTool({
        name: 'memory_consolidate',
        description: '整理本地记忆（合并重复/去重/精炼重写/删除低价值/提升长期）——即 openhanako 的 Memory Dream。每天会自动运行一次，也可手动触发。',
        parameters: {
            scope: { type: 'string', enum: ['all', 'global', 'project'], description: 'all=全局+全部项目；global=仅全局层；project=当前工作区项目。默认 all。' },
        },
        async execute(args, exec) {
            let results;
            if (args.scope === 'global') {
                results = [await consolidateScope(ctx, store, config, 'global', 'manual')];
            }
            else if (args.scope === 'project') {
                const agent = exec.agent;
                const hash = agent !== undefined ? workspaceHashOf(agent.session.header) : null;
                if (hash === null)
                    throw new Error('无法判定当前工作区项目（无 cwd），请用 scope: "all" 或 "global"');
                results = [await consolidateScope(ctx, store, config, { projectHash: hash }, 'manual')];
            }
            else {
                results = await consolidateAll(ctx, store, config, 'manual');
            }
            const changed = results.reduce((sum, result) => sum + result.changed, 0);
            if (changed === 0)
                return '记忆已是最佳状态，本次整理无变动。';
            const lines = results.map(result => `- ${result.scope}：合并 ${result.merged}、改写 ${result.rewritten}、删除 ${result.dropped}、提升长期 ${result.promoted}`);
            return `已整理记忆（${changed} 处变动）：\n${lines.join('\n')}`;
        },
    })));
    return () => {
        for (const dispose of disposers)
            dispose();
    };
}
/** 按路径或 hash 解析项目筛选；解析失败返回 null（不筛）。 */
function resolveProjectFilter(project) {
    const trimmed = project.trim();
    if (trimmed === '')
        return null;
    // 直接 hash。
    if (/^[0-9a-f]{12}$/.test(trimmed))
        return trimmed;
    // 路径 → hash。
    return projectHashOf(trimmed);
}
/** 模块级 embedding provider 缓存（按 config 惰性创建，避免每次检索都重建）。 */
let cachedProvider;
let cachedProviderKey = '';
async function getEmbeddingProvider(config) {
    const key = `${config.embeddingProvider}|${config.embeddingBaseUrl}|${config.embeddingModel}`;
    if (cachedProviderKey === key)
        return cachedProvider ?? null;
    cachedProviderKey = key;
    cachedProvider = resolveEmbeddingProvider(config);
    return cachedProvider;
}
/** 工具展示身份。 */
const TOOL_PRESENTATION = {
    memory_search: { kind: 'read', title: args => `记忆搜索：${String(args.query ?? '')}` },
    memory_remember: { kind: 'other', title: () => '记录记忆' },
    memory_pin: { kind: 'other', title: args => `置顶：${String(args.entryId ?? '')}` },
    memory_tag: { kind: 'other', title: args => `改标签：${String(args.entryId ?? '')}` },
    memory_forget: { kind: 'other', title: args => `删除：${String(args.entryId ?? '')}` },
    memory_revise: { kind: 'other', title: args => `修订：${String(args.entryId ?? '')}` },
    memory_retire: { kind: 'other', title: args => `废弃：${String(args.entryId ?? '')}` },
    memory_consolidate: { kind: 'other', title: () => '整理记忆' },
};
/** 文本工具包装（openviking 同款模式，泛型保留参数推断）。 */
function textTool(definition) {
    const presentation = TOOL_PRESENTATION[definition.name];
    return defineTool({
        ...definition,
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: args => ({
            card: 'generic',
            kind: presentation.kind,
            title: presentation.title(args),
            rawInput: args,
        }),
    });
}
//# sourceMappingURL=tools.js.map