/**
 * dsh-memory 编译引擎：把 entries 渲染成分层 md 产物并组装注入文本。
 * - 项目层：memory.md（短期时间线 + 长期沉淀）、facts.md、pinned.md
 * - 全局层：identity.md（身份/偏好）、facts.md、pinned.md
 * - 每日：daily/<date>.md（openhanako 同款格式，跨项目）
 * - 注入：identity + memory + pinned + facts 组装为带来源的 user message 文本
 */

import type { MemoryConfig, MemoryEntry } from '../types.js'
import { isInjectionEligible, injectionRank, shouldPromote } from './scoring.js'
import { localDate, projectHashOf, type MemoryStore } from './store.js'

/** 身份/偏好类标签。 */
const IDENTITY_TAGS = ['身份', 'identity', '偏好', 'preference', '风格', 'style', '人格', 'persona', '习惯', 'habit']

/** 事实类标签。 */
const FACT_TAGS = ['事实', 'fact', '信息', 'info', '要点', 'key', '背景', 'context']

/** 分组标题（时间线）。 */
export type TimeGroup = 'today' | 'week' | 'earlier' | 'longterm'

/** 按时间把条目分组。 */
export function groupEntries(entries: MemoryEntry[], now = new Date()): Record<TimeGroup, MemoryEntry[]> {
  const groups: Record<TimeGroup, MemoryEntry[]> = {
    today: [],
    week: [],
    earlier: [],
    longterm: [],
  }
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  for (const entry of entries) {
    if (entry.layer === 'long') {
      groups.longterm.push(entry)
      continue
    }
    const time = Date.parse(entry.updatedAt)
    if (Number.isNaN(time)) {
      groups.earlier.push(entry)
      continue
    }
    const days = Math.floor((startOfDay - time) / 86_400_000)
    if (days <= 0) groups.today.push(entry)
    else if (days < 7) groups.week.push(entry)
    else groups.earlier.push(entry)
  }
  return groups
}

/** 单条 md 行。 */
function entryLine(entry: MemoryEntry): string {
  const tagText = entry.tags.length > 0 ? ` \`${entry.tags.join('` `')}\`` : ''
  const score = entry.importance >= 10 ? '' : ` [${entry.importance}]`
  return `- ${entry.content.replace(/\n/g, ' ')}${score}${tagText}`
}

/** 渲染 timeline（短期分组 + 长期沉淀）。 */
export function renderTimeline(entries: MemoryEntry[]): string {
  const groups = groupEntries(entries)
  const lines: string[] = ['# 记忆时间线']
  const pushGroup = (title: string, list: MemoryEntry[]): void => {
    if (list.length === 0) return
    lines.push(`\n## ${title}`)
    for (const entry of list) lines.push(entryLine(entry))
  }
  pushGroup('今天', groups.today)
  pushGroup('本周', groups.week)
  pushGroup('更早', groups.earlier)
  pushGroup('长期沉淀', groups.longterm)
  return lines.join('\n')
}

/** 渲染 identity（全局层身份/偏好条目）。 */
export function renderIdentity(entries: MemoryEntry[]): string {
  const lines: string[] = ['# 用户身份与偏好']
  for (const entry of entries) {
    lines.push(entryLine(entry))
  }
  return lines.join('\n')
}

/** 渲染 facts。 */
export function renderFacts(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const lines: string[] = ['# 事实']
  for (const entry of entries) lines.push(entryLine(entry))
  return lines.join('\n')
}

/** 渲染 pinned。 */
export function renderPinned(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const lines: string[] = ['# 置顶']
  for (const entry of entries) lines.push(entryLine(entry))
  return lines.join('\n')
}

/** 身份/偏好判定（显式 kind 优先，回退标签匹配）。 */
export function isIdentityEntry(entry: MemoryEntry): boolean {
  if (entry.scope !== 'global') return false
  if (entry.kind === 'identity' || entry.kind === 'preference') return true
  return entry.tags.some(tag => IDENTITY_TAGS.includes(tag.toLowerCase()))
}

/**
 * 事实判定：优先看显式 kind（schema v2），其次事实标签，最后才回退重要性。
 * 旧实现只看 `importance >= 8`——初始 importance 就是 10，等于「几乎所有条目
 * 都是事实」，facts.md 与 memory.md 内容重复。
 */
export function isFactEntry(entry: MemoryEntry): boolean {
  if (entry.pinned) return false
  if (entry.kind === 'identity' || entry.kind === 'preference') return false
  if (entry.kind === 'fact' || entry.kind === 'decision' || entry.kind === 'gotcha') return true
  if (entry.tags.some(tag => FACT_TAGS.includes(tag.toLowerCase()))) return true
  return entry.importance >= 8
}

/** 全局层编译产物。 */
export function compileGlobalArtifacts(entries: MemoryEntry[]): { identity: string; facts: string; pinned: string } {
  const identity = entries.filter(isIdentityEntry)
  const facts = entries.filter(entry => entry.scope === 'global' && !isIdentityEntry(entry) && isFactEntry(entry))
  const pinned = entries.filter(entry => entry.scope === 'global' && entry.pinned)
  return {
    identity: renderIdentity(identity),
    facts: renderFacts(facts),
    pinned: renderPinned(pinned),
  }
}

/** 项目层编译产物。 */
export function compileProjectArtifacts(entries: MemoryEntry[]): { memory: string; facts: string; pinned: string } {
  const facts = entries.filter(entry => isFactEntry(entry) && !entry.pinned)
  const pinned = entries.filter(entry => entry.pinned)
  return {
    memory: renderTimeline(entries),
    facts: renderFacts(facts),
    pinned: renderPinned(pinned),
  }
}

/** 每日日志（跨项目全局；openhanako 同款格式）。 */
export function renderDaily(date: string, changes: Array<{ action: string; summary: string; scope: string }>): string {
  const lines: string[] = [`# ${date} 记忆日志`, '']
  if (changes.length === 0) {
    lines.push('（无新记忆）')
  } else {
    for (const change of changes) {
      const badge = change.action === 'add' ? '新增' : change.action === 'promote' ? '沉淀' : '更新'
      const scope = change.scope === 'global' ? '全局' : '项目'
      lines.push(`- [${badge}][${scope}] ${change.summary}`)
    }
  }
  return lines.join('\n')
}

/** 注入产物组装（design §5.4：全局 identity + 项目 memory + pinned + facts，带 token 截断）。 */
export interface InjectionSections {
  identity: string
  memory: string
  pinned: string
  facts: string
}

/**
 * 组装注入文本与 sections。
 *
 * 分组累积（不是"每段只取一条"）：pinned 无条件全量进入且不占预算；其余按
 * 归属分入 identity / memory / facts 三段，按重要性降序逐条累积直到 token
 * 预算耗尽。段头（[记忆·xxx]）本身也计入预算。
 *
 * @param entries - 注入可见条目（pinned + 检索命中）。
 * @param config - 注入预算。
 */
export function buildInjectionText(
  entries: MemoryEntry[],
  config: MemoryConfig,
): { text: string; sections: Array<{ name: string; text: string }> } {
  const budget = Math.max(1000, config.injectTokenBudget)
  const buckets: Record<keyof InjectionSections, string[]> = { identity: [], memory: [], pinned: [], facts: [] }
  const pinned = entries.filter(entry => entry.pinned)
  // 置顶区块不带「# 置顶」二级标题：[记忆·置顶] 分组头已标识归属，
  // 双重标志对模型纯冗余（renderPinned 的带标题版本仅供落盘产物使用）。
  for (const entry of pinned) buckets.pinned.push(entryLine(entry))

  // 其余按重要性降序（pinned 已单独处理），逐条计入预算。
  const rest = entries
    .filter(entry => !entry.pinned)
    .sort((a, b) => injectionRank(b) - injectionRank(a))
  let used = buckets.pinned.reduce((sum, line) => sum + line.length + 1, 0)
  for (const entry of rest) {
    const section: keyof InjectionSections = entry.scope === 'global'
      ? (isIdentityEntry(entry) ? 'identity' : 'facts')
      : 'memory'
    const line = entryLine(entry)
    // 该段首次落内容时，段头也要算进预算。
    const headerCost = buckets[section].length === 0 ? sectionHeader(section).length + 3 : 0
    if (used + line.length + 1 + headerCost > budget) continue
    used += line.length + 1 + headerCost
    buckets[section].push(line)
  }

  const sections: InjectionSections = {
    identity: buckets.identity.join('\n'),
    memory: buckets.memory.join('\n'),
    pinned: buckets.pinned.join('\n'),
    facts: buckets.facts.join('\n'),
  }
  const order: Array<keyof InjectionSections> = ['identity', 'memory', 'pinned', 'facts']
  const outSections = order
    .filter(name => sections[name] !== '')
    .map(name => ({ name: sectionHeader(name), text: sections[name] }))
  const text = outSections.map(section => `[${section.name}]\n${section.text}`).join('\n\n')
  return { text, sections: outSections }
}

function sectionHeader(section: keyof InjectionSections): string {
  switch (section) {
    case 'identity': return '记忆·身份偏好'
    case 'memory': return '记忆·项目'
    case 'pinned': return '记忆·置顶'
    case 'facts': return '记忆·事实'
  }
}

/** 全量编译入口：写项目层 + 全局层产物（ticker 调用）。 */
export async function compileAll(store: MemoryStore, config: MemoryConfig): Promise<void> {
  const all = await store.readEntries()
  // disabled 条目不进任何产物（memory.md / facts.md / pinned.md / identity.md）。
  const entries = all.filter(entry => entry.disabled !== true)
  const byProject = new Map<string, MemoryEntry[]>()
  for (const entry of entries) {
    if (entry.scope !== 'project' || entry.projectHash === null) continue
    const list = byProject.get(entry.projectHash) ?? []
    list.push(entry)
    byProject.set(entry.projectHash, list)
  }
  for (const [hash, owned] of byProject) {
    await store.writeProjectArtifacts(hash, compileProjectArtifacts(owned))
  }
  const global = entries.filter(entry => entry.scope === 'global')
  await store.writeGlobalArtifacts(compileGlobalArtifacts(global))
}

/** 从 entries 中选注入可见条目（short 层按阈值过滤 + 排序）。 */
export function selectInjectionEntries(entries: MemoryEntry[], threshold: number): MemoryEntry[] {
  return entries
    .filter(entry => isInjectionEligible(entry, threshold))
    .sort((a, b) => injectionRank(b) - injectionRank(a))
}

/** 项目记忆文本（面板/注入用）。 */
export function projectMemoryText(entries: MemoryEntry[]): string {
  return renderTimeline(entries)
}

/** 当前工作区项目 hash（会话 cwd 判定；取不到返回 null → 调用方回退 global）。 */
export function workspaceHashOf(header: { cwd?: string } | undefined): string | null {
  const cwd = header?.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') return null
  return projectHashOf(cwd)
}

/** 今日变更的 md 日志文本（写 daily）。 */
export async function writeDailyLog(store: MemoryStore, date = localDate()): Promise<void> {
  const changes = await store.readChanges(date)
  const summary = changes.map(change => ({
    action: change.action,
    summary: change.summary,
    scope: change.scope,
  }))
  await store.writeArtifact(`daily/${date}.md`, renderDaily(date, summary))
}

/** 促进短期条目到长期层（每日编译时调用）。 */
export function promoteEntries(entries: MemoryEntry[], threshold: number): { promoted: MemoryEntry[]; remaining: MemoryEntry[] } {
  const promoted: MemoryEntry[] = []
  const remaining: MemoryEntry[] = []
  for (const entry of entries) {
    if (shouldPromote(entry, threshold)) {
      promoted.push({ ...entry, layer: 'long' })
    } else {
      remaining.push(entry)
    }
  }
  return { promoted, remaining }
}
