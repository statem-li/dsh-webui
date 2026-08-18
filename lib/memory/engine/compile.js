/**
 * dsh-memory 编译引擎：把 entries 渲染成分层 md 产物并组装注入文本。
 * - 项目层：memory.md（短期时间线 + 长期沉淀）、facts.md、pinned.md
 * - 全局层：identity.md（身份/偏好）、facts.md、pinned.md
 * - 每日：daily/<date>.md（openhanako 同款格式，跨项目）
 * - 注入：identity + memory + pinned + facts 组装为带来源的 user message 文本
 */
import { isInjectionEligible, injectionRank, shouldPromote } from './scoring.js';
import { localDate, projectHashOf } from './store.js';
/** 身份/偏好类标签。 */
const IDENTITY_TAGS = ['身份', 'identity', '偏好', 'preference', '风格', 'style', '人格', 'persona', '习惯', 'habit'];
/** 事实类标签。 */
const FACT_TAGS = ['事实', 'fact', '信息', 'info', '要点', 'key', '背景', 'context'];
/** 按时间把条目分组。 */
export function groupEntries(entries, now = new Date()) {
    const groups = {
        today: [],
        week: [],
        earlier: [],
        longterm: [],
    };
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (const entry of entries) {
        if (entry.layer === 'long') {
            groups.longterm.push(entry);
            continue;
        }
        const time = Date.parse(entry.updatedAt);
        if (Number.isNaN(time)) {
            groups.earlier.push(entry);
            continue;
        }
        const days = Math.floor((startOfDay - time) / 86_400_000);
        if (days <= 0)
            groups.today.push(entry);
        else if (days < 7)
            groups.week.push(entry);
        else
            groups.earlier.push(entry);
    }
    return groups;
}
/** 单条 md 行。 */
function entryLine(entry) {
    const tagText = entry.tags.length > 0 ? ` \`${entry.tags.join('` `')}\`` : '';
    // 置顶由所在区块标题（# 置顶）标识，行内不再重复加 📌（避免"两个置顶图标"的视觉冗余）。
    const score = entry.importance >= 10 ? '' : ` [${entry.importance}]`;
    return `- ${entry.content.replace(/\n/g, ' ')}${score}${tagText}`;
}
/** 渲染 timeline（短期分组 + 长期沉淀）。 */
export function renderTimeline(entries) {
    const groups = groupEntries(entries);
    const lines = ['# 记忆时间线'];
    const pushGroup = (title, list) => {
        if (list.length === 0)
            return;
        lines.push(`\n## ${title}`);
        for (const entry of list)
            lines.push(entryLine(entry));
    };
    pushGroup('今天', groups.today);
    pushGroup('本周', groups.week);
    pushGroup('更早', groups.earlier);
    pushGroup('长期沉淀', groups.longterm);
    return lines.join('\n');
}
/** 渲染 identity（全局层身份/偏好条目）。 */
export function renderIdentity(entries) {
    const lines = ['# 用户身份与偏好'];
    for (const entry of entries) {
        lines.push(entryLine(entry));
    }
    return lines.join('\n');
}
/** 渲染 facts。 */
export function renderFacts(entries) {
    if (entries.length === 0)
        return '';
    const lines = ['# 事实'];
    for (const entry of entries)
        lines.push(entryLine(entry));
    return lines.join('\n');
}
/** 渲染 pinned。 */
export function renderPinned(entries) {
    if (entries.length === 0)
        return '';
    const lines = ['# 置顶'];
    for (const entry of entries)
        lines.push(entryLine(entry));
    return lines.join('\n');
}
/** 身份/偏好判定。 */
export function isIdentityEntry(entry) {
    return entry.scope === 'global' && entry.tags.some(tag => IDENTITY_TAGS.includes(tag.toLowerCase()));
}
/** 事实判定（非 identity、非 pinned 且带事实标签或高重要性）。 */
export function isFactEntry(entry) {
    if (entry.pinned)
        return false;
    if (entry.tags.some(tag => FACT_TAGS.includes(tag.toLowerCase())))
        return true;
    return entry.importance >= 8;
}
/** 全局层编译产物。 */
export function compileGlobalArtifacts(entries) {
    const identity = entries.filter(isIdentityEntry);
    const facts = entries.filter(entry => entry.scope === 'global' && !isIdentityEntry(entry) && isFactEntry(entry));
    const pinned = entries.filter(entry => entry.scope === 'global' && entry.pinned);
    return {
        identity: renderIdentity(identity),
        facts: renderFacts(facts),
        pinned: renderPinned(pinned),
    };
}
/** 项目层编译产物。 */
export function compileProjectArtifacts(entries) {
    const facts = entries.filter(entry => isFactEntry(entry) && !entry.pinned);
    const pinned = entries.filter(entry => entry.pinned);
    return {
        memory: renderTimeline(entries),
        facts: renderFacts(facts),
        pinned: renderPinned(pinned),
    };
}
/** 每日日志（跨项目全局；openhanako 同款格式）。 */
export function renderDaily(date, changes) {
    const lines = [`# ${date} 记忆日志`, ''];
    if (changes.length === 0) {
        lines.push('（无新记忆）');
    }
    else {
        for (const change of changes) {
            const badge = change.action === 'add' ? '新增' : change.action === 'promote' ? '沉淀' : '更新';
            const scope = change.scope === 'global' ? '全局' : '项目';
            lines.push(`- [${badge}][${scope}] ${change.summary}`);
        }
    }
    return lines.join('\n');
}
/**
 * 组装注入文本与 sections。
 * @param entries - 注入可见条目（已按重要性排序）。
 * @param config - 注入预算。
 */
export function buildInjectionText(entries, config) {
    const budget = Math.max(1000, config.injectTokenBudget);
    const sections = { identity: '', memory: '', pinned: '', facts: '' };
    const pinned = entries.filter(entry => entry.pinned);
    const rest = entries.filter(entry => !entry.pinned);
    // 预算内逐条累积：pinned 无条件先放，其余按 importance 降序。
    let used = 0;
    const consume = (section, text) => {
        if (text === '')
            return;
        const header = `[${sectionHeader(section)}]`;
        const block = `${header}\n${text}`;
        if (used + block.length > budget && section !== 'pinned')
            return;
        if (section !== 'pinned')
            used += block.length + 1;
        sections[section] = text;
    };
    if (pinned.length > 0)
        consume('pinned', renderPinned(pinned));
    for (const entry of rest) {
        if (entry.scope === 'global') {
            if (isIdentityEntry(entry)) {
                if (sections.identity === '')
                    consume('identity', `- ${entry.content}`);
            }
            else {
                if (sections.facts === '')
                    consume('facts', `- ${entry.content}`);
            }
        }
        else {
            if (sections.memory === '')
                consume('memory', `- ${entry.content}`);
        }
    }
    const text = [
        sections.identity,
        sections.memory,
        sections.pinned,
        sections.facts,
    ].filter(Boolean).join('\n\n');
    const outSections = [
        sections.identity ? { name: 'identity', text: sections.identity } : null,
        sections.memory ? { name: 'memory', text: sections.memory } : null,
        sections.pinned ? { name: 'pinned', text: sections.pinned } : null,
        sections.facts ? { name: 'facts', text: sections.facts } : null,
    ].filter((section) => section !== null);
    return { text, sections: outSections };
}
function sectionHeader(section) {
    switch (section) {
        case 'identity': return '记忆·身份偏好';
        case 'memory': return '记忆·项目';
        case 'pinned': return '记忆·置顶';
        case 'facts': return '记忆·事实';
    }
}
/** 全量编译入口：写项目层 + 全局层产物（ticker 调用）。 */
export async function compileAll(store, config) {
    const entries = await store.readEntries();
    const byProject = new Map();
    for (const entry of entries) {
        if (entry.scope !== 'project' || entry.projectHash === null)
            continue;
        const list = byProject.get(entry.projectHash) ?? [];
        list.push(entry);
        byProject.set(entry.projectHash, list);
    }
    for (const [hash, owned] of byProject) {
        await store.writeProjectArtifacts(hash, compileProjectArtifacts(owned));
    }
    const global = entries.filter(entry => entry.scope === 'global');
    await store.writeGlobalArtifacts(compileGlobalArtifacts(global));
}
/** 从 entries 中选注入可见条目（short 层按阈值过滤 + 排序）。 */
export function selectInjectionEntries(entries, threshold) {
    return entries
        .filter(entry => isInjectionEligible(entry, threshold))
        .sort((a, b) => injectionRank(b) - injectionRank(a));
}
/** 项目记忆文本（面板/注入用）。 */
export function projectMemoryText(entries) {
    return renderTimeline(entries);
}
/** 当前工作区项目 hash（会话 cwd 判定；取不到返回 null → 调用方回退 global）。 */
export function workspaceHashOf(header) {
    const cwd = header?.cwd;
    if (typeof cwd !== 'string' || cwd.trim() === '')
        return null;
    return projectHashOf(cwd);
}
/** 今日变更的 md 日志文本（写 daily）。 */
export async function writeDailyLog(store, date = localDate()) {
    const changes = await store.readChanges(date);
    const summary = changes.map(change => ({
        action: change.action,
        summary: change.summary,
        scope: change.scope,
    }));
    await store.writeArtifact(`daily/${date}.md`, renderDaily(date, summary));
}
/** 促进短期条目到长期层（每日编译时调用）。 */
export function promoteEntries(entries, threshold) {
    const promoted = [];
    const remaining = [];
    for (const entry of entries) {
        if (shouldPromote(entry, threshold)) {
            promoted.push({ ...entry, layer: 'long' });
        }
        else {
            remaining.push(entry);
        }
    }
    return { promoted, remaining };
}
//# sourceMappingURL=compile.js.map