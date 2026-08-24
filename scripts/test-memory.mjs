/**
 * dsh-memory 记忆引擎与 HTTP API 的独立回归测试（不依赖 DSH 运行时、不碰用户数据）。
 *
 * 覆盖：
 *   1. 配置覆盖：0 值可写入（合法的「关闭衰减/不设阈值」）、越界钳制、垃圾值忽略。
 *   2. 注入文本组装：分组累积全部条目（不是每段一条）、四段顺序、预算内截断且置顶必留。
 *   3. 记忆分类：显式 kind 优先于「importance >= 8 即事实」的旧启发式。
 *   4. store.patchEntry：内容/归属变更后重算稳定 id；撞 id 时合并而非产生重复条目。
 *   5. HTTP 路由：/remember 视图带 schema v2 元数据、/update 可改重要度/置顶/类型、
 *      /summary 统计计数、/config 合并写 + 钳制 + reset、/delete-batch 批量删除、
 *      /changes?date=all 全量倒序、/move 由路径派生项目 hash、/meta 清空别名、
 *      /list?q 走 hybrid 检索、未知路由 404 与非法载荷 400。
 *
 * 运行：先构建（pnpm build 或 npx tsc -p tsconfig.json），再 node scripts/test-memory.mjs
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { applyConfigOverrides, DEFAULT_CONFIG, publicConfig } = await import('../lib/memory/types.js')
const { buildInjectionText, isFactEntry, isIdentityEntry } = await import('../lib/memory/engine/compile.js')
const { MemoryStore, entryIdOf } = await import('../lib/memory/engine/store.js')
const { mountMemoryRoutes } = await import('../lib/memory/api.js')

console.log('memory engine')
let pass = 0
const check = (name, fn) => { fn(); pass += 1; console.log('  \u2713', name) }
const ok = (name) => { pass += 1; console.log('  \u2713', name) }

// ── 1. 配置钳制：0 值可写入（旧实现要求 >0 被静默丢弃）──────────────
check('applyConfigOverrides keeps zero decayLambda', () => {
  const config = { ...DEFAULT_CONFIG }
  const applied = applyConfigOverrides(config, { decayLambda: 0, compileThreshold: 0 })
  assert.equal(config.decayLambda, 0)
  assert.equal(config.compileThreshold, 0)
  assert.equal(applied.decayLambda, 0)
})

check('applyConfigOverrides clamps out-of-range', () => {
  const config = { ...DEFAULT_CONFIG }
  applyConfigOverrides(config, { injectTopK: 9999, entryLimit: 1, extractEveryTurns: 2.6 })
  assert.equal(config.injectTopK, 50)
  assert.equal(config.entryLimit, 50)
  assert.equal(config.extractEveryTurns, 3)
})

check('applyConfigOverrides ignores garbage', () => {
  const config = { ...DEFAULT_CONFIG }
  applyConfigOverrides(config, { injectTopK: 'x', entryLimit: NaN, nope: 1 })
  assert.equal(config.injectTopK, DEFAULT_CONFIG.injectTopK)
  assert.equal(config.entryLimit, DEFAULT_CONFIG.entryLimit)
  assert.equal('nope' in publicConfig(config), false)
})

// ── 2. 注入文本：分组累积 + 预算 ────────────────────────────────────
const entry = (over) => ({
  id: over.id ?? 'x', content: over.content ?? 'c', scope: over.scope ?? 'project',
  projectHash: over.scope === 'global' ? null : (over.projectHash ?? 'h1'),
  tags: over.tags ?? [], pinned: over.pinned ?? false, createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', importance: over.importance ?? 10, lastHitAt: null,
  layer: over.layer ?? 'short', source: over.source ?? 'extract', version: 1,
  confidence: 1, verified: true, kind: over.kind ?? 'fact',
})

check('buildInjectionText accumulates all entries per section', () => {
  const entries = [
    entry({ id: 'a', content: 'project one', scope: 'project' }),
    entry({ id: 'b', content: 'project two', scope: 'project' }),
    entry({ id: 'c', content: 'project three', scope: 'project' }),
  ]
  const { text, sections } = buildInjectionText(entries, { ...DEFAULT_CONFIG })
  assert.equal(sections.length, 1)
  // 旧实现每段只放一条 → 只会出现 'project one'
  for (const needle of ['project one', 'project two', 'project three']) {
    assert.ok(text.includes(needle), 'missing ' + needle)
  }
  assert.ok(text.startsWith('[记忆·项目]'), text.slice(0, 40))
})

check('buildInjectionText separates identity / facts / memory / pinned', () => {
  const entries = [
    entry({ id: 'i', content: '用户偏好中文', scope: 'global', kind: 'preference' }),
    entry({ id: 'f', content: '全局事实', scope: 'global', kind: 'fact' }),
    entry({ id: 'm', content: '项目记忆', scope: 'project' }),
    entry({ id: 'p', content: '置顶项', scope: 'project', pinned: true }),
  ]
  const { sections } = buildInjectionText(entries, { ...DEFAULT_CONFIG })
  const names = sections.map(s => s.name)
  assert.deepEqual(names, ['记忆·身份偏好', '记忆·项目', '记忆·置顶', '记忆·事实'])
})

check('buildInjectionText respects the budget but always keeps pinned', () => {
  const long = 'x'.repeat(400)
  const entries = []
  for (let i = 0; i < 50; i += 1) entries.push(entry({ id: 'e' + i, content: long + i, importance: 10 - i / 100 }))
  entries.push(entry({ id: 'pin', content: 'PINNED-ITEM', pinned: true }))
  const { text } = buildInjectionText(entries, { ...DEFAULT_CONFIG, injectTokenBudget: 2000 })
  assert.ok(text.includes('PINNED-ITEM'))
  assert.ok(text.length < 3200, 'budget overflow: ' + text.length)
  assert.ok(text.length > 1200, 'suspiciously small: ' + text.length)
})

check('classification prefers explicit kind', () => {
  assert.equal(isIdentityEntry(entry({ scope: 'global', kind: 'identity' })), true)
  assert.equal(isFactEntry(entry({ scope: 'global', kind: 'identity', importance: 20 })), false)
  assert.equal(isFactEntry(entry({ kind: 'gotcha', importance: 1 })), true)
})

// ── 3. store.patchEntry：内容变更后 id 重算 + 撞车合并 ──────────────
const root = mkdtempSync(join(tmpdir(), 'dsh-mem-test-'))
try {
  const store = new MemoryStore(root)
  const created = await store.upsertEntry({ content: '原始内容', scope: 'global', projectHash: null, tags: ['a'] })
  const patched = await store.patchEntry(created.entry.id, { content: '改写后的内容' })
  assert.ok(patched !== undefined)
  assert.equal(patched.id, entryIdOf('改写后的内容', 'global', null))
  assert.notEqual(patched.id, created.entry.id)
  console.log('  \u2713 patchEntry re-derives id on content change')
  pass += 1

  // upsert 同内容不应再插一条（旧实现 id 脱钩 → 会重复）
  const again = await store.upsertEntry({ content: '改写后的内容', scope: 'global', projectHash: null })
  assert.equal(again.created, false)
  assert.equal((await store.readEntries()).length, 1)
  console.log('  \u2713 upsert after edit merges instead of duplicating')
  pass += 1

  // 撞车合并：把 B 改成与 A 相同内容 → 合并为一条
  const a = await store.upsertEntry({ content: 'AAA', scope: 'global', projectHash: null, tags: ['ta'], importance: 12 })
  const b = await store.upsertEntry({ content: 'BBB', scope: 'global', projectHash: null, tags: ['tb'], importance: 9 })
  assert.equal((await store.readEntries()).length, 3)
  const mergedEntry = await store.patchEntry(b.entry.id, { content: 'AAA' })
  const all = await store.readEntries()
  assert.equal(all.length, 2, 'expected merge, got ' + all.length)
  assert.equal(mergedEntry.id, a.entry.id)
  assert.equal(mergedEntry.importance, 12)
  assert.deepEqual(mergedEntry.tags.sort(), ['ta', 'tb'])
  console.log('  \u2713 patchEntry merges on id collision')
  pass += 1

  // 移到项目层：projectHash 生效且 id 跟着变
  const moved = await store.patchEntry(a.entry.id, { scope: 'project', projectHash: 'hash1234abcd' })
  assert.equal(moved.scope, 'project')
  assert.equal(moved.id, entryIdOf('AAA', 'project', 'hash1234abcd'))
  console.log('  \u2713 patchEntry keeps id in sync when moving scope')
  pass += 1

  await store.flush()
} finally {
  rmSync(root, { recursive: true, force: true })
}


console.log('memory http api')
const apiRoot = mkdtempSync(join(tmpdir(), 'dsh-mem-api-'))
try {
  const store = new MemoryStore(apiRoot)
  const config = { ...DEFAULT_CONFIG }
  let handler
  const ctx = {
    webServer: { register: (route) => { handler = route.handler; return () => {} } },
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
    get: () => undefined,
  }
  mountMemoryRoutes(ctx, store, config)
  assert.equal(typeof handler, 'function')

  /** 伪请求：loopback + host 头满足鉴权。 */
  const call = (method, path, body) => new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = method
    req.url = '/api/dsh-memory' + path
    req.headers = { host: '127.0.0.1:3080' }
    req.socket = { remoteAddress: '127.0.0.1' }
    req.destroy = () => {}
    const res = {
      statusCode: 0,
      chunks: '',
      writeHead(status) { this.statusCode = status },
      end(payload) {
        this.chunks = payload ?? ''
        resolve({ status: this.statusCode, json: JSON.parse(this.chunks) })
      },
    }
    handler(req, res)
    process.nextTick(() => {
      if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    })
  })

  // 1) 手动添加 → 列表可见、视图带 schema v2 元数据
  const added = await call('POST', '/remember', { content: '测试记忆一号', scope: 'global', tags: ['t1'] })
  assert.equal(added.status, 200)
  assert.equal(added.json.created, true)
  assert.equal(added.json.entry.kind, 'fact')
  assert.equal(added.json.entry.verified, true)
  assert.equal(added.json.entry.version, 1)
  assert.equal(added.json.entry.lastHitAt, null)
  ok('POST /remember returns schema-v2 view fields')

  // 2) /update 可改 importance / pinned / kind（旧实现只认 content+tags）
  const updated = await call('POST', '/update', {
    entryId: added.json.entry.id,
    content: '测试记忆一号（改）',
    tags: ['t1', 't2'],
    importance: 15,
    pinned: true,
    kind: 'gotcha',
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.json.entry.importance, 15)
  assert.equal(updated.json.entry.pinned, true)
  assert.equal(updated.json.entry.kind, 'gotcha')
  assert.notEqual(updated.json.entry.id, added.json.entry.id, 'id must be re-derived on content change')
  ok('POST /update accepts importance / pinned / kind and re-derives id')

  // 3) /summary 带面板统计条需要的计数
  const summary = await call('GET', '/summary')
  assert.equal(summary.json.entryCount, 1)
  assert.equal(summary.json.pinnedCount, 1)
  assert.equal(summary.json.disabledCount, 0)
  assert.equal(typeof summary.json.longtermCount, 'number')
  assert.equal(typeof summary.json.globalCount, 'number')
  ok('GET /summary exposes pinned / disabled / longterm / global counts')

  // 4) /config 合并写：改第二个字段不冲掉第一个（旧实现只写本次补丁）
  await call('POST', '/config', { injectTopK: 12 })
  await call('POST', '/config', { entryLimit: 250 })
  const persisted = JSON.parse(readFileSync(join(apiRoot, 'store', 'config.json'), 'utf8'))
  assert.equal(persisted.injectTopK, 12)
  assert.equal(persisted.entryLimit, 250, 'second write must not drop the first')
  ok('POST /config merges overrides instead of replacing')

  // 5) /config 越界钳制 + reset
  const clamped = await call('POST', '/config', { injectTopK: 9999 })
  assert.equal(clamped.json.config.injectTopK, 50)
  const reset = await call('POST', '/config', { reset: true })
  assert.equal(reset.json.config.injectTopK, DEFAULT_CONFIG.injectTopK)
  assert.deepEqual(JSON.parse(readFileSync(join(apiRoot, 'store', 'config.json'), 'utf8')), {})
  ok('POST /config clamps and resets')

  // 6) 批量删除：一次调用删多条 + 缺失计数
  const a = await call('POST', '/remember', { content: '批量一', scope: 'global' })
  const b = await call('POST', '/remember', { content: '批量二', scope: 'global' })
  const batch = await call('POST', '/delete-batch', { entryIds: [a.json.entry.id, b.json.entry.id, 'mem_ghost'] })
  assert.equal(batch.json.deleted, 2)
  assert.equal(batch.json.missing, 1)
  ok('POST /delete-batch deletes in one transaction and reports missing')

  // 7) /changes?date=all 返回历史全量且按时间倒序
  const all = await call('GET', '/changes?date=all')
  assert.equal(all.json.changes.length >= 4, true)
  const times = all.json.changes.map(c => c.at)
  assert.deepEqual(times, [...times].sort((x, y) => y.localeCompare(x)), 'changes must be newest-first')
  ok('GET /changes?date=all returns full history newest-first')

  // 8) /move 用路径也能落到正确的项目 hash（旧实现把路径当 hash 直存）
  const movable = await call('POST', '/remember', { content: '待移动条目', scope: 'global' })
  const moved = await call('POST', '/move', { entryId: movable.json.entry.id, scope: 'project', path: 'D:/AI/Demo' })
  assert.equal(moved.status, 200)
  assert.equal(moved.json.entry.scope, 'project')
  assert.match(moved.json.entry.projectHash, /^[0-9a-f]{12}$/)
  const projects = await call('GET', '/projects')
  const target = projects.json.projects.find(p => p.hash === moved.json.entry.projectHash)
  assert.ok(target, 'moved project must appear in /projects')
  assert.equal(target.path, 'D:/AI/Demo')
  ok('POST /move derives project hash from a path')

  // 9) 项目别名可清空（传空串 → null）
  const named = await call('POST', '/meta', { projectHash: moved.json.entry.projectHash, alias: '演示项目' })
  assert.equal(named.json.meta.alias, '演示项目')
  const cleared = await call('POST', '/meta', { projectHash: moved.json.entry.projectHash, alias: '  ' })
  assert.equal(cleared.json.meta.alias, null)
  ok('POST /meta clears an alias when given an empty string')

  // 10) 面板搜索走 hybrid 检索：换个说法 / 少打一字也能命中
  await call('POST', '/remember', { content: '玻璃质感主题的 backdrop-filter 会创建包含块', scope: 'global', tags: ['CSS'] })
  const exact = await call('GET', '/list?q=' + encodeURIComponent('backdrop-filter'))
  assert.equal(exact.json.entries.length >= 1, true)
  const fuzzy = await call('GET', '/list?q=' + encodeURIComponent('玻璃质感 包含块'))
  assert.equal(fuzzy.json.entries.length >= 1, true, 'multi-term query must still match')
  const nonsense = await call('GET', '/list?q=' + encodeURIComponent('zzzzz-not-present-anywhere'))
  assert.equal(nonsense.json.entries.length, 0, 'irrelevant query must return nothing')
  ok('GET /list?q uses hybrid retrieval with a relevance floor')

  // 11) 未知路由 404、非法 body 400
  const missing = await call('GET', '/nope')
  assert.equal(missing.status, 404)
  const bad = await call('POST', '/pin', {})
  assert.equal(bad.status, 400)
  ok('unknown route 404s and invalid payload 400s')

  await store.flush()
} finally {
  rmSync(apiRoot, { recursive: true, force: true })
}


if (pass === 0) {
  console.error('no checks ran — build artifacts missing?')
  process.exit(1)
}
console.log(`\n${pass} checks passed`)
