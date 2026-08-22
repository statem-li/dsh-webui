/**
 * dsh-memory 模型工具：AI 在对话中可主动调用的记忆操作。
 * memory_search / memory_remember / memory_pin / memory_tag / memory_forget。
 * 全部经 @deepseek-ai/dsh-tools 的 defineTool 注册，输出为模型可见文本。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferArgs, ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { ConsolidateResult, MemoryConfig } from './types.js'
import { projectHashOf, summarize, type MemoryStore } from './engine/store.js'
import { workspaceHashOf } from './engine/compile.js'
import { consolidateAll, consolidateScope } from './engine/consolidate.js'

/** 当前会话项目 hash（exec.agent 缺失时回退 null → global 或全部）。 */
interface AgentLike {
  readonly id: string
  readonly session: { readonly id: string; readonly header?: { cwd?: string } }
}

/** 搜索可见条目视图。 */
interface EntryView {
  id: string
  content: string
  scope: 'global' | 'project'
  projectHash: string | null
  tags: string[]
  pinned: boolean
  importance: number
  layer: 'short' | 'long'
  updatedAt: string
}

function toView(entry: import('./types.ts').MemoryEntry): EntryView {
  return {
    id: entry.id,
    content: entry.content,
    scope: entry.scope,
    projectHash: entry.projectHash,
    tags: entry.tags,
    pinned: entry.pinned,
    importance: entry.importance,
    layer: entry.layer,
    updatedAt: entry.updatedAt,
  }
}

/** 文本匹配：query 的每个非空词都命中 content 或 tags。 */
function matchesQuery(entry: EntryView, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = `${entry.content} ${entry.tags.join(' ')}`.toLowerCase()
  return terms.every(term => haystack.includes(term))
}

/** 排序：pinned 优先，importance 降序，updatedAt 降序。 */
function rank(a: EntryView, b: EntryView): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.importance !== b.importance) return b.importance - a.importance
  return b.updatedAt.localeCompare(a.updatedAt)
}

/** 注册全部记忆工具，返回合并 disposer。 */
export function registerMemoryTools(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
): () => void {
  const disposers: Array<() => void> = []

  // ── memory_search ────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_search',
    description: '搜索本地长期记忆（按内容/标签/项目）。用之前记住的决定、偏好、踩坑、项目上下文，或回答"我记得/之前说过"类问题时。',
    parameters: {
      query: { type: 'string', description: '搜索关键词（空格分隔多个词，全部命中才返回）。留空列出全部。' },
      scope: { type: 'string', enum: ['global', 'project'], description: 'global=全局层（身份/偏好）；project=项目层。默认全部。' },
      project: { type: 'string', description: '项目标识（workspace 路径或 hash）。默认当前工作区项目。' },
      tag: { type: 'string', description: '按标签筛选。' },
      limit: { type: 'integer', description: '返回条数上限（默认 10，最大 30）。' },
    },
    async execute(args, exec) {
      const entries = await store.readEntries()
      const agent = exec.agent as AgentLike | undefined
      const currentHash = agent !== undefined ? workspaceHashOf(agent.session.header) : null
      const projectFilter = typeof args.project === 'string' && args.project !== ''
        ? resolveProjectFilter(args.project)
        : currentHash

      const views = entries
        .map(toView)
        .filter(view => {
          if (view.scope === 'project' && projectFilter !== null && view.projectHash !== projectFilter) return false
          if (typeof args.scope === 'string' && view.scope !== args.scope) return false
          if (typeof args.tag === 'string' && args.tag !== '' && !view.tags.includes(args.tag)) return false
          if (typeof args.query === 'string' && !matchesQuery(view, args.query)) return false
          return true
        })
        .sort(rank)

      const limit = Math.max(1, Math.min(30, typeof args.limit === 'number' ? args.limit : 10))
      const picked = views.slice(0, limit)
      if (picked.length === 0) return '没有找到匹配的记忆。'
      const lines = picked.map(view => {
        const head = view.pinned ? '📌' : ''
        const scope = view.scope === 'global' ? '全局' : '项目'
        const tags = view.tags.length > 0 ? ` [${view.tags.join(', ')}]` : ''
        const layer = view.layer === 'long' ? '（长期）' : ''
        return `${head}[${view.importance}] ${scope}${layer}: ${view.content}${tags}`
      })
      return lines.join('\n')
    },
  })))

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
      const content = String(args.content ?? '').trim()
      if (content === '') throw new Error('content 不能为空')
      const agent = exec.agent as AgentLike | undefined
      const hash = agent !== undefined ? workspaceHashOf(agent.session.header) : null
      const scope = args.scope === 'global' ? 'global' as const : 'project' as const
      if (scope === 'project' && hash === null) {
        throw new Error('无法判定当前工作区项目（无 cwd），请用 scope: "global" 或稍后重试')
      }
      // 项目层写入受「自动记忆」开关约束：该项目关闭自动记忆时拒绝写入（global 层不受影响）。
      if (scope === 'project' && (hash === null || !(await store.isAutoMemoryEnabled(hash)))) {
        throw new Error('当前项目的自动记忆已关闭，已跳过记录；如需记录请先在记忆面板开启该项目开关')
      }
      const importance = typeof args.importance === 'number' ? Math.max(1, Math.min(10, args.importance)) : 8
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
        : []
      const { created, entry } = await store.upsertEntry({
        content,
        scope,
        projectHash: scope === 'project' ? hash : null,
        tags,
        importance,
        source: 'manual',
      })
      // 项目层落盘时确保 meta.json 存在（面板项目列表可见）。
      if (scope === 'project' && hash !== null) {
        const meta = await store.readProjectMeta(hash)
        if (meta === undefined) {
          await store.writeProjectMeta(hash, {
            path: agent?.session.header?.cwd ?? '手动记忆',
            alias: null,
            locked: false,
          })
        }
      }
      await store.appendChange({
        action: created ? 'add' : 'update',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: summarize(entry.content),
      })
      return created
        ? `已记住：${entry.content}（${scope === 'global' ? '全局' : '项目'}${tags.length > 0 ? `，标签：${tags.join(', ')}` : ''}）`
        : `已更新记忆：${entry.content}`
    },
  })))

  // ── memory_pin ───────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_pin',
    description: '置顶/取消置顶一条记忆（置顶的记忆始终进入上下文注入并显示在置顶区）。',
    parameters: {
      entryId: { type: 'string', required: true, description: '记忆条目 id（用 memory_search 获取）。' },
      pinned: { type: 'boolean', description: 'true=置顶，false=取消。默认 true。' },
    },
    async execute(args) {
      const id = String(args.entryId ?? '')
      if (id === '') throw new Error('entryId 不能为空')
      const entry = await store.patchEntry(id, { pinned: args.pinned !== false })
      if (entry === undefined) throw new Error(`记忆不存在：${id}`)
      return entry.pinned ? `已置顶：${summarize(entry.content)}` : `已取消置顶：${summarize(entry.content)}`
    },
  })))

  // ── memory_tag ───────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_tag',
    description: '修改一条记忆的标签（覆盖式更新标签列表）。',
    parameters: {
      entryId: { type: 'string', required: true, description: '记忆条目 id。' },
      tags: { type: 'array', items: { type: 'string' }, required: true, description: '新的标签列表（覆盖旧的）。' },
    },
    async execute(args) {
      const id = String(args.entryId ?? '')
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
        : []
      const entry = await store.patchEntry(id, { tags })
      if (entry === undefined) throw new Error(`记忆不存在：${id}`)
      await store.appendChange({
        action: 'update',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `改标签：${summarize(entry.content)}`,
      })
      return `标签已更新：${entry.tags.length > 0 ? entry.tags.join(', ') : '（无）'}`
    },
  })))

  // ── memory_forget ────────────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_forget',
    description: '删除一条记忆（仅当用户明确要求删除/遗忘某条记忆时使用）。',
    parameters: {
      entryId: { type: 'string', required: true, description: '记忆条目 id（用 memory_search 获取）。' },
    },
    async execute(args) {
      const id = String(args.entryId ?? '')
      if (id === '') throw new Error('entryId 不能为空')
      const entry = await store.getEntry(id)
      if (entry === undefined) throw new Error(`记忆不存在：${id}`)
      const ok = await store.removeEntry(id)
      if (!ok) throw new Error(`记忆不存在：${id}`)
      await store.appendChange({
        action: 'delete',
        entryId: id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `删除：${summarize(entry.content)}`,
      })
      return `已删除记忆：${summarize(entry.content)}`
    },
  })))

  // ── memory_consolidate ───────────────────────────────────────────────
  disposers.push(ctx.tools.register(textTool({
    name: 'memory_consolidate',
    description: '整理本地记忆（合并重复/去重/精炼重写/删除低价值/提升长期）——即 openhanako 的 Memory Dream。每天会自动运行一次，也可手动触发。',
    parameters: {
      scope: { type: 'string', enum: ['all', 'global', 'project'], description: 'all=全局+全部项目；global=仅全局层；project=当前工作区项目。默认 all。' },
    },
    async execute(args, exec) {
      let results: ConsolidateResult[]
      if (args.scope === 'global') {
        results = [await consolidateScope(ctx, store, config, 'global', 'manual')]
      } else if (args.scope === 'project') {
        const agent = exec.agent as AgentLike | undefined
        const hash = agent !== undefined ? workspaceHashOf(agent.session.header) : null
        if (hash === null) throw new Error('无法判定当前工作区项目（无 cwd），请用 scope: "all" 或 "global"')
        results = [await consolidateScope(ctx, store, config, { projectHash: hash }, 'manual')]
      } else {
        results = await consolidateAll(ctx, store, config, 'manual')
      }
      const changed = results.reduce((sum, result) => sum + result.changed, 0)
      if (changed === 0) return '记忆已是最佳状态，本次整理无变动。'
      const lines = results.map(result =>
        `- ${result.scope}：合并 ${result.merged}、改写 ${result.rewritten}、删除 ${result.dropped}、提升长期 ${result.promoted}`)
      return `已整理记忆（${changed} 处变动）：\n${lines.join('\n')}`
    },
  })))

  return () => {
    for (const dispose of disposers) dispose()
  }
}

/** 按路径或 hash 解析项目筛选；解析失败返回 null（不筛）。 */
function resolveProjectFilter(project: string): string | null {
  const trimmed = project.trim()
  if (trimmed === '') return null
  // 直接 hash。
  if (/^[0-9a-f]{12}$/.test(trimmed)) return trimmed
  // 路径 → hash。
  return projectHashOf(trimmed)
}

/** 工具展示身份。 */
const TOOL_PRESENTATION: Record<string, { kind: 'read' | 'other'; title: (args: Record<string, unknown>) => string }> = {
  memory_search: { kind: 'read', title: args => `记忆搜索：${String(args.query ?? '')}` },
  memory_remember: { kind: 'other', title: () => '记录记忆' },
  memory_pin: { kind: 'other', title: args => `置顶：${String(args.entryId ?? '')}` },
  memory_tag: { kind: 'other', title: args => `改标签：${String(args.entryId ?? '')}` },
  memory_forget: { kind: 'other', title: args => `删除：${String(args.entryId ?? '')}` },
  memory_consolidate: { kind: 'other', title: () => '整理记忆' },
}

/** 文本工具包装（openviking 同款模式，泛型保留参数推断）。 */
function textTool<S extends ParameterSchemaSpec>(definition: {
  name: string
  description: string
  parameters: S
  execute: (args: InferArgs<S>, exec: { agent?: unknown }) => Promise<string>
}): ReturnType<typeof defineTool> {
  const presentation = TOOL_PRESENTATION[definition.name]
  return defineTool({
    ...definition,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    presentCall: args => ({
      card: 'generic' as const,
      kind: presentation.kind,
      title: presentation.title(args as Record<string, unknown>),
      rawInput: args,
    }),
  })
}
