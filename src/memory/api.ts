/**
 * dsh-memory HTTP API（loopback-only）：/api/dsh-memory/*。
 * 面板数据 + 裁决操作（保留/删除/改标签/移项目/置顶/手动归属）。
 * 与 skill-manager 同款 webServer 路由模式；前缀 /api/dsh-memory 不与其它插件冲突。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { applyConfigOverrides, DEFAULT_CONFIG, publicConfig, type ConsolidateResult, type MemoryConfig, type MemoryEntry, type MemoryKind } from './types.js'
import { compileAll } from './engine/compile.js'
import { consolidateAll, consolidateScope } from './engine/consolidate.js'
import { searchEntries } from './engine/retrieval.js'
import { localDate, mergeTags, nowIso, projectHashOf, entryIdOf, summarize, type MemoryStore } from './engine/store.js'

/** Minimal service-shaped view of the webserver route register. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: {
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => void
      }): () => void
    }
  }
}

const ROUTE_PREFIX = '/api/dsh-memory'

/** 面板条目视图（含 schema v2 元数据：版本 / 置信度 / 确认态 / 类型 / 命中时间）。 */
interface EntryView {
  id: string
  content: string
  scope: 'global' | 'project'
  projectHash: string | null
  tags: string[]
  pinned: boolean
  /** true = 已禁用（保留但不参与注入/编译）。 */
  disabled: boolean
  /** true = 已软废弃（retire / revise）。 */
  deprecated: boolean
  importance: number
  layer: 'short' | 'long'
  source: 'extract' | 'manual'
  createdAt: string
  updatedAt: string
  /** 条目级版本号（每次内容变更 +1）。 */
  version: number
  /** 置信度 0-1（手动记忆=1）。 */
  confidence: number
  /** 用户是否已显式确认。 */
  verified: boolean
  /** 记忆类型。 */
  kind: MemoryKind
  /** 上次注入命中时间（null=从未命中）。 */
  lastHitAt: string | null
}

/** MemoryKind 取值校验（/update 的 kind 字段）。 */
function isMemoryKindValue(value: unknown): value is MemoryKind {
  return value === 'identity' || value === 'preference' || value === 'fact'
    || value === 'decision' || value === 'gotcha' || value === 'session-summary'
}

function toView(entry: MemoryEntry): EntryView {
  return {
    id: entry.id,
    content: entry.content,
    scope: entry.scope,
    projectHash: entry.projectHash,
    tags: entry.tags,
    pinned: entry.pinned,
    disabled: entry.disabled === true,
    deprecated: entry.deprecated === true,
    importance: entry.importance,
    layer: entry.layer,
    source: entry.source,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    version: entry.version,
    confidence: entry.confidence,
    verified: entry.verified,
    kind: entry.kind,
    lastHitAt: entry.lastHitAt,
  }
}

/** 挂载全部路由。 */
export function mountMemoryRoutes(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      void handle(ctx, store, config, req, res)
    },
  })
}

async function handle(
  ctx: Context,
  store: MemoryStore,
  config: MemoryConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!loopbackAllowed(req)) {
    json(res, 403, { error: 'loopback-only' })
    return
  }
  let url: URL
  let rest: string
  let method: string
  try {
    url = new URL(req.url ?? '/', 'http://localhost')
    rest = url.pathname.slice(ROUTE_PREFIX.length)
    method = req.method ?? 'GET'
  } catch {
    json(res, 400, { error: 'invalid request url' })
    return
  }
  // API 诊断日志（仅 logApiRequests 开启时记录，默认关闭防日志膨胀）。
  const apiStarted = Date.now()
  if (config.logApiRequests) void store.appendApiLog(`${method} ${rest} start`).catch(() => undefined)
  try {
    // ── 查询 ──────────────────────────────────────────────────────────
    if (method === 'GET' && rest === '/list') {
      json(res, 200, await listView(store, url.searchParams))
      return
    }
    if (method === 'GET' && rest === '/projects') {
      const entries = await store.readEntries()
      json(res, 200, { projects: await mergeWorkspaces(store, await store.listProjects(entries)) })
      return
    }
    if (method === 'GET' && rest === '/tags') {
      const entries = await store.readEntries()
      const counts = new Map<string, number>()
      for (const entry of entries) {
        for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
      json(res, 200, { tags: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })) })
      return
    }
    if (method === 'GET' && rest === '/changes') {
      // date=all → 全部历史变更（面板「变更」Tab 的「全部」筛选）；缺省=当日。
      const raw = url.searchParams.get('date')
      const changes = raw === 'all' ? await store.readChanges() : await store.readChanges(raw ?? localDate())
      json(res, 200, {
        date: raw ?? localDate(),
        changes: changes.sort((a, b) => b.at.localeCompare(a.at)),
      })
      return
    }
    if (method === 'GET' && rest === '/summary') {
      const entries = await store.readEntries()
      const today = localDate()
      json(res, 200, {
        today,
        entryCount: entries.filter(entry => entry.deprecated !== true).length,
        projectCount: (await store.listProjects(entries)).length,
        todayChanges: (await store.readChanges(today)).length,
        pinnedCount: entries.filter(entry => entry.pinned).length,
        disabledCount: entries.filter(entry => entry.disabled === true).length,
        deprecatedCount: entries.filter(entry => entry.deprecated === true).length,
        longtermCount: entries.filter(entry => entry.layer === 'long' && entry.deprecated !== true).length,
        globalCount: entries.filter(entry => entry.scope === 'global' && entry.deprecated !== true).length,
      })
      return
    }

    // ── 运行时配置（面板设置；改动即时生效并持久化到 config.json） ─────
    if (method === 'GET' && rest === '/config') {
      json(res, 200, { config: publicConfig(config) })
      return
    }
    if (method === 'POST' && rest === '/config') {
      const body = await readBody(req) as Record<string, unknown>
      if (body.reset === true) {
        // 恢复默认：清空 config.json 覆盖层并把运行时配置写回默认值。
        applyConfigOverrides(config, DEFAULT_CONFIG)
        await store.writeConfig({})
        json(res, 200, { ok: true, config: publicConfig(config) })
        return
      }
      // 合并写：与已持久化的覆盖层合并后整体落盘。旧实现只写本次补丁，
      // 改第二个字段会冲掉第一个字段的覆盖，重启后回退默认值。
      const applied = applyConfigOverrides(config, body)
      await store.writeConfig({ ...store.readConfigSync(), ...applied })
      json(res, 200, { ok: true, config: publicConfig(config) })
      return
    }

    // ── 记忆注入开关（按会话） ────────────────────────────────────────
    if (method === 'GET' && rest === '/inject-state') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      json(res, 200, { enabled: await store.isInjectEnabled(sessionId) })
      return
    }
    if (method === 'POST' && rest === '/inject-state') {
      const body = await readBody(req) as Record<string, unknown>
      const sessionId = requireString(body.sessionId, 'sessionId')
      const enabled = body.enabled !== false
      await store.setInjectEnabled(sessionId, enabled)
      json(res, 200, { ok: true, enabled })
      return
    }

    // ── 裁决操作 ──────────────────────────────────────────────────────
    if (method === 'POST' && rest === '/pin') {
      const body = await readBody(req) as Record<string, unknown>
      const entryId = requireString(body.entryId, 'entryId')
      const pinned = body.pinned !== false
      const entry = await store.patchEntry(entryId, { pinned })
      if (entry === undefined) throw new Error(`记忆不存在：${entryId}`)
      // 不写变更流：变更流驱动入口未读 badge，用户自己点置顶不该给自己刷未读。
      // 但产物要跟上（pinned.md / 注入常驻集合按 pinned 取）。
      await compileAll(store, config)
      json(res, 200, { ok: true, entry: toView(entry) })
      return
    }
    if (method === 'POST' && rest === '/enable') {
      const body = await readBody(req) as Record<string, unknown>
      const entryId = requireString(body.entryId, 'entryId')
      const enabled = body.enabled !== false
      const existing = await store.getEntry(entryId)
      if (existing === undefined) throw new Error(`记忆不存在：${entryId}`)
      const entry = await store.patchEntry(entryId, { disabled: !enabled })
      if (entry === undefined) throw new Error(`记忆不存在：${entryId}`)
      await store.appendChange({
        action: 'update',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `${enabled ? '启用' : '禁用'}：${summarize(entry.content)}`,
      })
      await compileAll(store, config)
      json(res, 200, { ok: true, entry: toView(entry) })
      return
    }
    if (method === 'POST' && rest === '/update') {
      const body = await readBody(req) as Record<string, unknown>
      const entryId = requireString(body.entryId, 'entryId')
      const patch: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>> = {}
      if (typeof body.content === 'string' && body.content.trim() !== '') {
        patch.content = body.content.trim()
      }
      if (Array.isArray(body.tags)) {
        patch.tags = body.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
      }
      // 重要度 / 置顶 / 类型 / 层：面板编辑区可直接改（此前只能改内容与标签）。
      if (typeof body.importance === 'number' && Number.isFinite(body.importance)) {
        patch.importance = Math.max(1, Math.min(20, Math.round(body.importance * 10) / 10))
      }
      if (typeof body.pinned === 'boolean') patch.pinned = body.pinned
      if (isMemoryKindValue(body.kind)) patch.kind = body.kind
      if (body.layer === 'short' || body.layer === 'long') patch.layer = body.layer
      const before = await store.getEntry(entryId)
      const entry = await store.patchEntry(entryId, patch)
      if (entry === undefined) throw new Error(`记忆不存在：${entryId}`)
      await store.appendChange({
        action: 'update',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: summarize(entry.content),
        before: before?.content,
        after: entry.content,
      })
      await compileAll(store, config)
      json(res, 200, { ok: true, entry: toView(entry) })
      return
    }
    if (method === 'POST' && rest === '/move') {
      const body = await readBody(req) as Record<string, unknown>
      const entryId = requireString(body.entryId, 'entryId')
      const existing = await store.getEntry(entryId)
      if (existing === undefined) throw new Error(`记忆不存在：${entryId}`)
      let scope: 'global' | 'project' = existing.scope
      let projectHash: string | null = existing.projectHash
      if (body.scope === 'global') {
        scope = 'global'
        projectHash = null
      } else if (body.scope === 'project') {
        scope = 'project'
        const rawHash = typeof body.projectHash === 'string' ? body.projectHash.trim() : ''
        const rawPath = typeof body.path === 'string' ? body.path.trim() : ''
        // 12 位 hex 视为项目 hash；否则当作 workspace 路径派生 hash
        // （旧实现把路径原样当 hash 存，会造出以路径为目录名的伪项目）。
        projectHash = /^[0-9a-f]{12}$/i.test(rawHash)
          ? rawHash.toLowerCase()
          : rawHash !== ''
            ? projectHashOf(rawHash)
            : rawPath !== ''
              ? projectHashOf(rawPath)
              : existing.projectHash
        if (projectHash === null) throw new Error('移入项目需要 projectHash 或 path')
        // 目标项目无 meta 时自动创建占位（手动归属）。
        const meta = await store.readProjectMeta(projectHash)
        if (meta === undefined) {
          const rawPath = typeof body.path === 'string' ? body.path.trim() : ''
          const rawHash = typeof body.projectHash === 'string' ? body.projectHash.trim() : ''
          const path = rawPath !== '' ? rawPath : (/^[0-9a-f]{12}$/i.test(rawHash) ? '手动归属' : rawHash)
          await store.writeProjectMeta(projectHash, {
            path: path === '' ? '手动归属' : path,
            alias: null,
            locked: true,
          })
        }
      }
      const entry = await store.patchEntry(entryId, { scope, projectHash })
      if (entry === undefined) throw new Error(`记忆不存在：${entryId}`)
      await store.appendChange({
        action: 'update',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `移项目：${summarize(entry.content)}`,
        before: existing.content,
        after: entry.content,
      })
      await compileAll(store, config)
      json(res, 200, { ok: true, entry: toView(entry) })
      return
    }
    if (method === 'POST' && rest === '/delete') {
      const body = await readBody(req) as Record<string, unknown>
      const entryId = requireString(body.entryId, 'entryId')
      const existing = await store.getEntry(entryId)
      // 幂等删除：条目已不存在时也返回 ok（面板旧数据/幽灵条目删除不再报错）。
      if (existing === undefined) {
        json(res, 200, { ok: true, alreadyGone: true })
        return
      }
      const ok = await store.removeEntry(entryId)
      if (!ok) {
        json(res, 200, { ok: true, alreadyGone: true })
        return
      }
      await store.appendChange({
        action: 'delete',
        entryId,
        scope: existing.scope,
        projectHash: existing.projectHash,
        summary: `删除：${summarize(existing.content)}`,
      })
      await compileAll(store, config)
      json(res, 200, { ok: true })
      return
    }
    if (method === 'POST' && rest === '/delete-batch') {
      // 批量删除（面板多选）：一次事务删完再编译一次产物。
      const body = await readBody(req) as Record<string, unknown>
      const ids = Array.isArray(body.entryIds)
        ? body.entryIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map(id => id.trim())
        : []
      if (ids.length === 0) throw new Error('entryIds 不能为空')
      const wanted = new Set(ids)
      const removed = await store.mutateEntries(entries => {
        const targets = entries.filter(entry => wanted.has(entry.id))
        for (const target of targets) entries.splice(entries.indexOf(target), 1)
        return targets
      })
      for (const entry of removed) {
        await store.appendChange({
          action: 'delete',
          entryId: entry.id,
          scope: entry.scope,
          projectHash: entry.projectHash,
          summary: `删除：${summarize(entry.content)}`,
          before: entry.content,
        })
      }
      await compileAll(store, config)
      json(res, 200, { ok: true, deleted: removed.length, missing: ids.length - removed.length })
      return
    }
    if (method === 'POST' && rest === '/revise') {
      // 修订：软废弃旧条目 + 写入后继条目（opencontext oc_memory_revise 语义）。
      const body = await readBody(req) as Record<string, unknown>
      const entryId = requireString(body.entryId, 'entryId')
      const content = typeof body.content === 'string' ? body.content.trim() : ''
      if (content === '') throw new Error('content 不能为空')
      const target = await store.getEntry(entryId)
      if (target === undefined) throw new Error(`记忆不存在：${entryId}`)
      const result = await store.reviseEntry({
        id: entryId,
        content,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        tags: Array.isArray(body.tags)
          ? body.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
          : undefined,
        importance: typeof body.importance === 'number' && Number.isFinite(body.importance)
          ? Math.max(1, Math.min(10, Math.round(body.importance)))
          : undefined,
      })
      if (result === undefined) throw new Error(`记忆不存在或已废弃：${entryId}`)
      await store.appendChange({
        action: 'revise',
        entryId: result.deprecatedId,
        scope: target.scope,
        projectHash: target.projectHash,
        summary: `修订为：${summarize(result.entry.content)}`,
        before: target.content,
        after: result.entry.content,
      })
      await compileAll(store, config)
      json(res, 200, {
        ok: true,
        deprecatedId: result.deprecatedId,
        newId: result.newId,
        entry: toView(result.entry),
      })
      return
    }
    if (method === 'POST' && rest === '/retire') {
      // 软废弃：数据保留但退出检索/注入/编译。
      const body = await readBody(req) as Record<string, unknown>
      const entryId = requireString(body.entryId, 'entryId')
      const entry = await store.retireEntry(entryId, typeof body.reason === 'string' ? body.reason : undefined)
      if (entry === undefined) throw new Error(`记忆不存在：${entryId}`)
      await store.appendChange({
        action: 'retire',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `废弃：${summarize(entry.content)}`,
        before: entry.content,
      })
      await compileAll(store, config)
      json(res, 200, { ok: true, entry: toView(entry) })
      return
    }
    if (method === 'POST' && rest === '/restore') {
      // 复活已废弃条目（undo retire / undo revise 后继侧）。
      const body = await readBody(req) as Record<string, unknown>
      const entryId = requireString(body.entryId, 'entryId')
      const entry = await store.restoreEntry(entryId)
      if (entry === undefined) throw new Error(`记忆不存在：${entryId}`)
      await store.appendChange({
        action: 'update',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: `恢复：${summarize(entry.content)}`,
        after: entry.content,
      })
      await compileAll(store, config)
      json(res, 200, { ok: true, entry: toView(entry) })
      return
    }
    if (method === 'POST' && rest === '/meta') {
      const body = await readBody(req) as Record<string, unknown>
      const hash = requireString(body.projectHash, 'projectHash')
      const meta = await store.readProjectMeta(hash)
      const next = {
        path: meta?.path ?? (typeof body.path === 'string' && body.path !== '' ? body.path : '手动归属'),
        alias: typeof body.alias === 'string'
          ? (body.alias.trim() === '' ? null : body.alias.trim().slice(0, 64))
          : (meta?.alias ?? null),
        locked: typeof body.locked === 'boolean' ? body.locked : (meta?.locked ?? true),
        autoMemory: typeof body.autoMemory === 'boolean' ? body.autoMemory : (meta?.autoMemory ?? true),
      }
      await store.writeProjectMeta(hash, next)
      json(res, 200, { ok: true, meta: { ...next, hash } })
      return
    }
    if (method === 'POST' && rest === '/delete-project') {
      // 按项目清空全部记忆（仅项目层；全局层不动）。
      // 置顶记忆是用户明确标记的重要条目，批量清空时跳过，避免误删。
      const body = await readBody(req) as Record<string, unknown>
      const projectHash = requireString(body.projectHash, 'projectHash')
      const removed = await store.mutateEntries(entries => {
        const targets = entries.filter(entry =>
          entry.scope === 'project' && entry.projectHash === projectHash && !entry.pinned)
        for (const target of targets) {
          entries.splice(entries.indexOf(target), 1)
        }
        return targets
      })
      for (const entry of removed) {
        await store.appendChange({
          action: 'delete',
          entryId: entry.id,
          scope: entry.scope,
          projectHash: entry.projectHash,
          summary: `清空项目：${summarize(entry.content)}`,
        })
      }
      await compileAll(store, config)
      json(res, 200, { ok: true, deleted: removed.length })
      return
    }
    if (method === 'POST' && rest === '/remember') {
      // 手动添加记忆（面板「添加」）：内容/范围/标签/置顶/重要性。
      const body = await readBody(req) as Record<string, unknown>
      const content = typeof body.content === 'string' ? body.content.trim() : ''
      if (content === '') throw new Error('content 不能为空')
      const scope = body.scope === 'global' ? 'global' as const : 'project' as const
      const projectHash = scope === 'project'
        ? (typeof body.projectHash === 'string' && body.projectHash !== '' ? body.projectHash : null)
        : null
      if (scope === 'project' && projectHash === null) {
        throw new Error('项目层记忆需要 projectHash（当前无工作区，请用全局或指定项目）')
      }
      const tags = Array.isArray(body.tags)
        ? body.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()).slice(0, 8)
        : []
      const importance = typeof body.importance === 'number' && Number.isFinite(body.importance)
        ? Math.max(1, Math.min(10, Math.round(body.importance))) : 8
      const pinned = body.pinned === true
      // 项目层首次落盘时确保 meta 存在。
      if (scope === 'project' && projectHash !== null) {
        const meta = await store.readProjectMeta(projectHash)
        if (meta === undefined) {
          await store.writeProjectMeta(projectHash, {
            path: typeof body.path === 'string' && body.path !== '' ? body.path : '手动归属',
            alias: null,
            locked: false,
          })
        }
      }
      const beforeEntry = await store.getEntry(entryIdOf(content, scope, scope === 'project' ? projectHash : null))
      const { created, entry } = await store.upsertEntry({
        content,
        scope,
        projectHash: scope === 'project' ? projectHash : null,
        tags,
        importance,
        pinned,
        source: 'manual',
      })
      await store.appendChange({
        action: created ? 'add' : 'update',
        entryId: entry.id,
        scope: entry.scope,
        projectHash: entry.projectHash,
        summary: summarize(entry.content),
        before: beforeEntry?.content,
        after: entry.content,
      })
      await compileAll(store, config)
      json(res, 200, { ok: true, created, entry: toView(entry) })
      return
    }

    // ── 记忆整理（Memory Dream）与修订回滚 ─────────────────────────────
    if (method === 'POST' && rest === '/consolidate') {
      const body = await readBody(req) as Record<string, unknown>
      const scopeRaw = typeof body.scope === 'string' ? body.scope : 'all'
      let results: ConsolidateResult[]
      if (scopeRaw === 'global') {
        results = [await consolidateScope(ctx, store, config, 'global', 'manual')]
      } else if (scopeRaw === 'project') {
        const projectHash = requireString(body.projectHash, 'projectHash')
        results = [await consolidateScope(ctx, store, config, { projectHash }, 'manual')]
      } else {
        results = await consolidateAll(ctx, store, config, 'manual')
      }
      json(res, 200, { ok: true, results })
      return
    }
    if (method === 'GET' && rest === '/revisions') {
      json(res, 200, { revisions: await store.listRevisions() })
      return
    }
    if (method === 'POST' && rest === '/rollback') {
      const body = await readBody(req) as Record<string, unknown>
      const revisionId = requireString(body.revisionId, 'revisionId')
      const ok = await store.restoreRevision(revisionId)
      if (!ok) throw new Error(`修订不存在：${revisionId}`)
      await compileAll(store, config)
      ctx.logger?.info?.(`[dsh-memory] rolled back to revision ${revisionId}`)
      json(res, 200, { ok: true })
      return
    }

    json(res, 404, { error: `no route for ${method} ${rest}` })
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) })
  } finally {
    if (config.logApiRequests) void store.appendApiLog(`${method} ${rest} done ${Date.now() - apiStarted}ms`).catch(() => undefined)
  }
}

/** 面板列表视图（scope/项目/搜索/标签过滤）。 */
async function listView(store: MemoryStore, params: URLSearchParams): Promise<{ entries: EntryView[]; projects: ProjectView[] }> {
  const entries = await store.readEntries()
  const scope = params.get('scope')
  const project = params.get('project')
  const q = params.get('q')?.trim().toLowerCase() ?? ''
  const tag = params.get('tag')
  const includeDeprecated = params.get('includeDeprecated') === '1'

  // 硬过滤：scope / project / tag；deprecated 条目默认不显示（软废弃 = 退出活跃列表）。
  const scoped = entries.filter(entry => {
    if (scope === 'global' && entry.scope !== 'global') return false
    if (scope === 'project' && entry.scope !== 'project') return false
    if (project !== null && project !== '' && entry.projectHash !== project) return false
    if (tag !== null && tag !== '' && !entry.tags.includes(tag)) return false
    if (!includeDeprecated && entry.deprecated === true) return false
    return true
  })
  // 搜索：走同一套 hybrid 检索（n-gram 相似 + 精确命中加成），
  // 让"打错一个字/换个说法"也能命中——旧实现是逐词子串 AND，
  // 与工具 memory_search 的行为不一致，面板搜不到工具能搜到的条目。
  const matched = q === ''
    ? scoped
    : searchEntries(q, scoped, 'hybrid').filter(match => match.score >= 0.2).map(match => match.entry)
  const views = (q === ''
    ? [...matched].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    // 有查询词时按相关度排序，但置顶条目仍优先（用户明确标记的重要条目）。
    : [...matched].sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1)))
    .map(toView)

  return { entries: views, projects: await mergeWorkspaces(store, await store.listProjects(entries)) }
}

/** 项目视图类型（面板返回）。 */
type ProjectView = { hash: string; path: string; alias: string | null; locked: boolean; autoMemory: boolean; entryCount: number; pinnedCount: number }

/**
 * 合并 DSH 工作区注册表：尚无记忆的新工作区也出现在项目列表（entryCount 0），
 * 让「刚建的工作区」在记忆面板立即可见（无需等第一条记忆写入）。
 */
async function mergeWorkspaces(store: MemoryStore, projects: ProjectView[]): Promise<ProjectView[]> {
  const known = new Set(projects.map(project => project.hash))
  for (const workspace of await store.listDshWorkspaces()) {
    const hash = projectHashOf(workspace.path)
    if (!known.has(hash)) {
      projects.push({
        hash,
        path: workspace.path,
        alias: workspace.title,
        locked: false,
        autoMemory: true,
        entryCount: 0,
        pinnedCount: 0,
      })
      known.add(hash)
    }
  }
  projects.sort((a, b) => a.path.localeCompare(b.path))
  return projects
}

// ── HTTP plumbing（skill-manager 同款） ────────────────────────────────

function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127'
    && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function hostNameOf(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close <= 1) return null
    const suffix = host.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return host.slice(1, close)
  }
  const firstColon = host.indexOf(':')
  const lastColon = host.lastIndexOf(':')
  if (firstColon !== lastColon) return null
  return firstColon === -1 ? host : host.slice(0, firstColon)
}

function loopbackAllowed(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = hostNameOf(req.headers.host)
  if (host === null) return false
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolvePromise({})
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch (error) {
        reject(error instanceof Error ? error : new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} 不能为空`)
  }
  return value.trim()
}

/** 供其它模块使用的工具函数（变更时间）。 */
export function apiNow(): string {
  return nowIso()
}

/** mergeTags 复用导出（tools.ts 已用本地实现，此处仅为 API 一致性保留）。 */
export { mergeTags }
