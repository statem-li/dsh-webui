/**
 * dsh-memory 记忆巩固引擎（Memory Dream，openhanako 同款）：
 * 每天（或手动触发）用 LLM 对某一 scope 的记忆做「语义化整理」——
 * 合并近重复/强相关条目、精炼重写、删除过时/低价值、提升长期。
 * 与现有每日「规则化」衰减/折叠/滚出（ticker.runDailyCompile）正交叠加：
 * 规则处理「分数」，本引擎处理「语义」。
 *
 * 安全设计：
 * - 输入排除 pinned（保护用户明确标记的条目），apply 时再按 id 锚定防误删；
 * - 整理前写入 revisions 快照，支持一键回滚；
 * - LLM 失败/超时/解析失败一律空结果，绝不阻塞每日编译。
 */

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ChangeRecord,
  ConsolidateOp,
  ConsolidateResult,
  MemoryConfig,
  MemoryEntry,
} from '../types.js'
import { compileAll, writeDailyLog } from './compile.js'
import { isSensitiveContent, resolveRoute, type MinimalAgent } from './extract.js'
import { entryIdOf, nowIso, summarize, type MemoryStore } from './store.js'

/** 整理用伪 agent：无显式 provider/model，resolveRoute 回退默认模型。 */
const CONSOLIDATE_AGENT: MinimalAgent = {
  id: 'dsh-memory-consolidate',
  options: {},
  session: { id: '', header: undefined },
}

/** 整理范围：global 层，或某个 project。 */
export type ConsolidateScope = 'global' | { projectHash: string }

/** 范围显示标签（revision / 结果用）。 */
function scopeLabel(scope: ConsolidateScope): string {
  return scope === 'global' ? 'global' : `project:${scope.projectHash}`
}

/** 整理统计（内部）。 */
interface ConsolidateStats {
  merged: number
  rewritten: number
  dropped: number
  promoted: number
}

/**
 * 单个 scope 的整理：读 → 选集合 → LLM 决策 → 备份 → 应用 → 重编译。
 * @returns 统计结果；无变更/失败时 changed=0。
 */
export async function consolidateScope(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
  scope: ConsolidateScope,
  trigger: 'daily' | 'manual',
): Promise<ConsolidateResult> {
  const label = scopeLabel(scope)
  const empty: ConsolidateResult = { scope: label, merged: 0, rewritten: 0, dropped: 0, promoted: 0, changed: 0 }
  if (!config.consolidateEnabled) return empty

  const all = await store.readEntries()
  let owned = all.filter(entry => scope === 'global'
    ? entry.scope === 'global'
    : entry.scope === 'project' && entry.projectHash === scope.projectHash)
  // 排除 pinned 与 disabled：用户明确标记的条目绝不被自动合并/删除/重写；
  // 禁用条目处于「冻结」状态（不注入、不编译、不参与整理），同样跳过。
  owned = owned.filter(entry => !entry.pinned && entry.disabled !== true)
  owned = selectConsolidationSet(owned, config.consolidateMaxEntries)
  // 至少 2 条才有语义整理空间（单条重写/提升由规则层处理）。
  if (owned.length < 2) return empty

  const llm = ctx.get('llm')
  if (llm === undefined) return empty
  const route = await resolveRoute(ctx, CONSOLIDATE_AGENT)
  if (route === undefined) return empty

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.consolidateTimeoutMs)
  try {
    const options = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: consolidateUserPrompt(owned) }],
        source: { kind: 'plugin', plugin: 'dsh-memory' },
      })],
      system: consolidateSystemPrompt(),
      maxTokens: 4096,
      signal: controller.signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk)
    }
    const finish = assembler.finish
    if (finish.kind !== 'stop') return empty
    const text = assembler.blocks()
      .filter(block => block.type === 'text' || block.type === 'reasoning')
      .map(block => (block as { text?: string }).text ?? '')
      .join(' ')
    const ops = parseConsolidateOutput(text)
    if (ops.length === 0) return empty

    // 整理前备份（回滚锚点）。
    await store.writeRevision({ entries: all, scope: label, trigger })

    // 按 id 锚定应用（走 store 写串行队列，防并发覆盖）。
    let stats: ConsolidateStats = { merged: 0, rewritten: 0, dropped: 0, promoted: 0 }
    let events: Array<Omit<ChangeRecord, 'id' | 'at'>> = []
    await store.replaceEntries(current => {
      const result = applyOps(current, ops)
      stats = result.stats
      events = result.events
      return result.next
    })

    // 变更流（驱动面板「变更」tab 与 daily 日志）。
    for (const event of events) await store.appendChange(event)
    await compileAll(store, config)
    await writeDailyLog(store)

    const changed = stats.merged + stats.rewritten + stats.dropped + stats.promoted
    ctx.logger?.debug?.(`[dsh-memory] consolidate ${label} done (merged=${stats.merged}, rewritten=${stats.rewritten}, dropped=${stats.dropped}, promoted=${stats.promoted})`)
    return { scope: label, ...stats, changed }
  } catch (error) {
    ctx.logger?.debug?.(`[dsh-memory] consolidate ${label} failed: ${error instanceof Error ? error.message : String(error)}`)
    return empty
  } finally {
    clearTimeout(timer)
  }
}

/** 整理全部 scope（global + 每个 project）。返回有变更的 scope 结果。 */
export async function consolidateAll(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
  trigger: 'daily' | 'manual',
): Promise<ConsolidateResult[]> {
  if (!config.consolidateEnabled) return []
  const entries = await store.readEntries()
  const hashes = new Set<string>()
  for (const entry of entries) {
    if (entry.scope === 'project' && entry.projectHash !== null) hashes.add(entry.projectHash)
  }
  const results: ConsolidateResult[] = []
  const globalResult = await consolidateScope(ctx, store, config, 'global', trigger)
  if (globalResult.changed > 0) results.push(globalResult)
  for (const hash of hashes) {
    const result = await consolidateScope(ctx, store, config, { projectHash: hash }, trigger)
    if (result.changed > 0) results.push(result)
  }
  return results
}

/**
 * 应用 LLM 决策。fn 内收到的 current 是「最新」条目快照；
 * 按 id 锚定：LLM 期间新增的条目不在 ops 中，天然不受影响。
 */
function applyOps(
  entries: MemoryEntry[],
  ops: ConsolidateOp[],
): { next: MemoryEntry[]; stats: ConsolidateStats; events: Array<Omit<ChangeRecord, 'id' | 'at'>> } {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const stats: ConsolidateStats = { merged: 0, rewritten: 0, dropped: 0, promoted: 0 }
  const events: Array<Omit<ChangeRecord, 'id' | 'at'>> = []
  const removeIds = new Set<string>()
  /** 待删条目的对象身份（配合 removeIds 兜住 rewrite 换 id 的情况）。 */
  const removeObjects = new Set<MemoryEntry>()
  const additions: MemoryEntry[] = []

  for (const op of ops) {
    switch (op.type) {
      case 'merge': {
        const sources = op.ids
          .map(id => byId.get(id))
          .filter((entry): entry is MemoryEntry => entry !== undefined)
        if (sources.length < 2) break
        const content = sanitizeContent(op.content)
        if (content === '' || isSensitiveContent(content)) break
        const scope = sources[0].scope
        const projectHash = sources[0].projectHash
        const merged: MemoryEntry = {
          id: entryIdOf(content, scope, projectHash),
          content,
          scope,
          projectHash: scope === 'project' ? projectHash : null,
          tags: sanitizeTags(op.tags),
          pinned: false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          importance: Math.max(...sources.map(source => source.importance)),
          lastHitAt: null,
          layer: sources.some(source => source.layer === 'long') ? 'long' : 'short',
          source: sources[0].source,
          version: 1,
          confidence: Math.max(...sources.map(source => source.confidence)),
          verified: false,
          kind: sources[0].kind,
          provenance: undefined,
          embedding: undefined,
        }
        // 合并结果与库中既有条目撞 id 时不再新增（否则出现重复 id 条目），
        // 仍然删除源条目——目标内容已经在库里。
        if (!byId.has(merged.id) || removeIds.has(merged.id)) additions.push(merged)
        for (const source of sources) {
          removeIds.add(source.id)
          removeObjects.add(source)
          events.push({
            action: 'delete',
            entryId: source.id,
            scope: source.scope,
            projectHash: source.projectHash,
            summary: `合并：${summarize(source.content)}`,
            before: source.content,
          })
        }
        events.push({
          action: 'add',
          entryId: merged.id,
          scope: merged.scope,
          projectHash: merged.projectHash,
          summary: `合并为：${summarize(merged.content)}`,
          after: merged.content,
        })
        stats.merged += sources.length
        break
      }
      case 'rewrite': {
        const entry = byId.get(op.ids[0])
        if (entry === undefined || entry.pinned) break
        const content = sanitizeContent(op.content)
        if (content === '' || isSensitiveContent(content) || content === entry.content) break
        // id 由 content+scope+projectHash 派生：改内容必须换 id，否则 id 与内容脱钩，
        // 后续 upsertEntry 会把同一条记忆再插一遍。撞上已有同内容条目则跳过本次改写
        // （目标内容已经存在，改写没有信息增量）。
        const nextId = entryIdOf(content, entry.scope, entry.projectHash)
        if (nextId !== entry.id && byId.has(nextId)) break
        const before = entry.content
        entry.id = nextId
        entry.content = content
        entry.tags = sanitizeTags(op.tags)
        entry.updatedAt = nowIso()
        entry.version += 1
        byId.delete(op.ids[0])
        byId.set(nextId, entry)
        events.push({
          action: 'update',
          entryId: entry.id,
          scope: entry.scope,
          projectHash: entry.projectHash,
          summary: `整理改写：${summarize(content)}`,
          before,
          after: content,
        })
        stats.rewritten += 1
        break
      }
      case 'drop': {
        for (const id of op.ids) {
          const entry = byId.get(id)
          if (entry === undefined || entry.pinned) continue
          if (removeIds.has(id) || removeObjects.has(entry)) continue
          removeIds.add(id)
          removeObjects.add(entry)
          events.push({
            action: 'delete',
            entryId: entry.id,
            scope: entry.scope,
            projectHash: entry.projectHash,
            summary: `整理删除：${summarize(entry.content)}`,
            before: entry.content,
          })
          stats.dropped += 1
        }
        break
      }
      case 'promote': {
        for (const id of op.ids) {
          const entry = byId.get(id)
          if (entry === undefined || entry.layer === 'long') continue
          entry.layer = 'long'
          entry.updatedAt = nowIso()
          events.push({
            action: 'promote',
            entryId: entry.id,
            scope: entry.scope,
            projectHash: entry.projectHash,
            summary: summarize(entry.content),
          })
          stats.promoted += 1
        }
        break
      }
    }
  }

  // 删除按对象身份判定，而不是按 id：rewrite 会就地换 id，若后续 drop 引用旧 id，
  // 按 id 过滤会漏删（条目已改名）或误删（新 id 撞上别人）。additions 之间也要去重
  // （两次 merge 可能产出相同内容）。
  const next = entries.filter(entry => !removeIds.has(entry.id) && !removeObjects.has(entry))
  const seen = new Set(next.map(entry => entry.id))
  for (const addition of additions) {
    if (seen.has(addition.id)) continue
    seen.add(addition.id)
    next.push(addition)
  }
  return { next, stats, events }
}

/** 选整理集合：短期优先，再按最近更新；截断到 max。 */
function selectConsolidationSet(entries: MemoryEntry[], max: number): MemoryEntry[] {
  return entries
    .sort((a, b) => {
      if (a.layer !== b.layer) return a.layer === 'short' ? -1 : 1
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    .slice(0, max)
}

/** 整理系统 prompt：只输出结构化 ops，绝不虚构、绝不越界。 */
function consolidateSystemPrompt(): string {
  return [
    'You are a memory consolidator for an AI assistant\'s long-term memory. You receive a set of existing memory entries (each with a stable id) and reorganize them into a cleaner, less redundant set — like the brain consolidating memories during sleep.',
    'Return ONLY a JSON object in this exact shape (no markdown, no commentary):',
    '{"ops":[{"type":"merge","ids":["..."],"content":"...","tags":["..."]},{"type":"rewrite","id":"...","content":"...","tags":["..."]},{"type":"drop","ids":["..."]},{"type":"promote","ids":["..."]}]}',
    'Rules:',
    '- "merge": combine 2+ near-duplicate or strongly-related entries into ONE concise entry. content must preserve all non-redundant facts; NEVER invent information not present in the inputs.',
    '- "rewrite": rewrite a single entry to be clearer, better worded, or better tagged. Only when it is genuinely ambiguous/redundant/poorly worded.',
    '- "drop": delete entries that are obsolete, fully superseded by a merge, or have no lasting value.',
    '- "promote": mark durable, frequently-relevant entries as long-term (ids only, no content).',
    '- Only reference ids that appear in the input. Omit untouched entries from ops entirely (they are kept as-is by default).',
    '- Never merge/drop/rewrite across clearly different topics.',
    '- Write content in the original language of the entries.',
    '- If nothing needs reorganizing, return {"ops":[]}.',
  ].join('\n')
}

/** 整理输入：只传决策所需字段，省 token。 */
function consolidateUserPrompt(entries: MemoryEntry[]): string {
  const view = entries.map(entry => ({
    id: entry.id,
    content: entry.content,
    tags: entry.tags,
    importance: entry.importance,
    layer: entry.layer,
  }))
  return `Reorganize these memory entries (JSON array of {id, content, tags, importance, layer}):\n${JSON.stringify(view)}`
}

/** 解析 LLM 输出为 ops（容错：剥 fence / 找最外层对象 / 逐条校验）。 */
export function parseConsolidateOutput(raw: string): ConsolidateOp[] {
  let text = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  if (fence !== null) text = fence[1].trim()
  text = text.replace(/^\uFEFF/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const ops = (parsed as { ops?: unknown }).ops
  if (!Array.isArray(ops)) return []
  const out: ConsolidateOp[] = []
  for (const item of ops) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const type = record.type
    if (type !== 'merge' && type !== 'rewrite' && type !== 'drop' && type !== 'promote') continue
    const ids = Array.isArray(record.ids)
      ? record.ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map(id => id.trim())
      : (typeof record.id === 'string' ? [record.id.trim()] : [])
    if (ids.length === 0) continue
    const op: ConsolidateOp = { type, ids: [...new Set(ids)] }
    if (type === 'merge' || type === 'rewrite') {
      const content = typeof record.content === 'string' ? record.content.trim() : ''
      if (content === '') continue
      op.content = content
      op.tags = sanitizeTags(record.tags)
    }
    out.push(op)
  }
  return out
}

function sanitizeContent(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
    : []
}
