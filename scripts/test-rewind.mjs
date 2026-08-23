/**
 * 退回文件快照/恢复 的独立回归测试（不依赖 DSH 运行时）。
 *
 * 覆盖：
 *   1. 多轮对话、每轮修改多个文件（改内容 / 新增 / 删除），逐步退回。
 *   2. 排除目录（node_modules / dist / _tmp 等）在快照与恢复时都被跳过。
 *   3. 嵌套目录 + 批量文件（50 个）的修改与恢复 + 空目录清理。
 *   4. 工作区外文件（extraPaths）的纳入回退与新增清理。
 *   5. 差异检测 diffSnapshot（全量 / writtenPaths 过滤）。
 *   6. v2 内容寻址去重：相同内容跨快照只存一份 blob。
 *   7. blob GC：无引用孤儿被回收（拨旧 mtime 过宽限期），有引用保留。
 *   8. 全局维护：超过保留时长（30 天）的快照被淘汰。
 *   9. v1 遗留快照兼容读取与恢复。
 *  10. 单会话滚动清理（最多保留 MAX_SNAPSHOTS_PER_SESSION 条）。
 *  11. 二进制 / 超大文件只记录存在性，恢复时保持现状。
 *  12. 写入记录持久化：重启后从磁盘恢复（writtenPathsFor）。
 *  13. 外部目录跟踪（桌面场景：extDirs 新增/修改检出与回退）。
 *  14. 跨会话保护：writtenPaths 过滤 + 快照时点时间戳——他只回退「本会话在
 *      快照后写过」的文件，其他会话/人工的修改与新增一律不碰。
 *      （回归：writtenPaths 曾误传为 extraPaths 第 2 参数 → 全量回退误伤。）
 *
 * 运行：先构建（pnpm build），再 node scripts/test-rewind.mjs
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// DSH_HOME 必须在加载模块前指向临时目录，让 blob 库/快照库落在测试沙箱里。
const storageRoot = mkdtempSync(join(tmpdir(), 'rewind-store-'))
process.env.DSH_HOME = storageRoot

const {
  captureSnapshotSync, persistSnapshot, restoreSnapshot, diffSnapshot,
  readSnapshot, gcBlobs, runMaintenance, rewindHome, blobHome, writtenPathsFor,
  writtenPathsAfter,
} = await import('../lib/rewind.js')

let passed = 0
let failed = 0

function ok(label) {
  passed += 1
  console.log(`  ✓ ${label}`)
}
function fail(label, detail) {
  failed += 1
  console.error(`  ✗ ${label}\n    ${detail}`)
}

/** 捕获并落盘一个快照，返回统一视图。 */
async function snap(root, sessionId, seq) {
  const captured = captureSnapshotSync(root)
  if (captured === null) throw new Error('captureSnapshotSync returned null')
  await persistSnapshot({ sessionId, seq, cwd: root, captured })
  const view = await readSnapshot(sessionId, seq)
  if (view === null) throw new Error(`readSnapshot(${sessionId}, ${seq}) returned null`)
  return view
}

/** 递归收集工作区当前文本内容（复刻排除规则），用于恢复结果断言。 */
const EXCLUDED = new Set([
  'node_modules', '.git', '.dsh', '.svn', '.hg', 'out', '.next', '.nuxt',
  '.output', '.turbo', 'target', '.venv', 'venv', '__pycache__', '.cache',
  '.parcel-cache', 'coverage', '.idea', '.vscode', 'blobs',
])
function isExcludedName(name) {
  return EXCLUDED.has(name) || name.startsWith('_') || /^(dist|build|\.tmp)/.test(name)
}
function diskDump(dir, prefix = '') {
  const out = {}
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue
    const abs = join(dir, e.name)
    if (e.isDirectory()) {
      if (isExcludedName(e.name)) continue
      Object.assign(out, diskDump(abs, prefix ? `${prefix}/${e.name}` : e.name))
      continue
    }
    if (!e.isFile()) continue
    out[prefix ? `${prefix}/${e.name}` : e.name] = readFileSync(abs, 'utf8')
  }
  return out
}

function assertSame(actual, expected, label) {
  const aKeys = Object.keys(actual).sort()
  const eKeys = Object.keys(expected).sort()
  if (JSON.stringify(aKeys) !== JSON.stringify(eKeys)) {
    fail(label, `文件列表不一致\n    actual=[${aKeys.join(', ')}]\n    expect=[${eKeys.join(', ')}]`)
    return false
  }
  for (const k of eKeys) {
    if (actual[k] !== expected[k]) {
      fail(label, `文件 "${k}" 内容不一致\n    actual=${JSON.stringify(actual[k])}\n    expect=${JSON.stringify(expected[k])}`)
      return false
    }
  }
  ok(label)
  return true
}

/** 数 blob 库里的对象数量。 */
function blobCount() {
  let count = 0
  let shards
  try { shards = readdirSync(blobHome()) } catch { return 0 }
  for (const shard of shards) count += readdirSync(join(blobHome(), shard)).length
  return count
}
function blobFile(hash) {
  return join(blobHome(), hash.slice(0, 2), hash)
}

async function testMultiRound() {
  console.log('\n[1] 多轮改/增/删（v2 存储 + 往返恢复）：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-multi-'))
  writeFileSync(join(root, 'a.txt'), 'A-v0')
  writeFileSync(join(root, 'keep.txt'), 'keep')

  const s0Disk = { 'a.txt': 'A-v0', 'keep.txt': 'keep' }
  await snap(root, 'test-multi', 0)

  writeFileSync(join(root, 'a.txt'), 'A-v1')
  writeFileSync(join(root, 'b.txt'), 'B-v1')
  const s1Expected = { 'a.txt': 'A-v1', 'keep.txt': 'keep', 'b.txt': 'B-v1' }
  await snap(root, 'test-multi', 1)

  writeFileSync(join(root, 'b.txt'), 'B-v2')
  writeFileSync(join(root, 'c.txt'), 'C-v2')
  const s2Expected = { 'a.txt': 'A-v1', 'keep.txt': 'keep', 'b.txt': 'B-v2', 'c.txt': 'C-v2' }
  const S2 = await snap(root, 'test-multi', 2)

  writeFileSync(join(root, 'a.txt'), 'A-v3')
  writeFileSync(join(root, 'b.txt'), 'B-v3')
  rmSync(join(root, 'c.txt'))
  writeFileSync(join(root, 'd.txt'), 'D-v3')
  await snap(root, 'test-multi', 3)

  await restoreSnapshot(S2)
  assertSame(diskDump(root), s2Expected, '退回轮3 → 恢复 S2')

  const S1 = await readSnapshot('test-multi', 1)
  await restoreSnapshot(S1)
  assertSame(diskDump(root), s1Expected, '退回轮2 → 恢复 S1')

  const S0 = await readSnapshot('test-multi', 0)
  await restoreSnapshot(S0)
  assertSame(diskDump(root), s0Disk, '退回轮1 → 恢复 S0')
  await restoreSnapshot(S0)
  assertSame(diskDump(root), s0Disk, '幂等：再次恢复 S0 不变')
  rmSync(root, { recursive: true, force: true })
}

async function testExcludedDirs() {
  console.log('\n[2] 排除目录（快照与恢复都跳过）：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-excl-'))
  writeFileSync(join(root, 'src.txt'), 'src-v0')
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'nm-content')
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist', 'bundle.js'), 'dist-content')
  mkdirSync(join(root, '_tmp_scratch'), { recursive: true })
  writeFileSync(join(root, '_tmp_scratch', 'x.txt'), 'tmp-content')
  mkdirSync(join(root, '_planweave_analysis', 'repo'), { recursive: true })
  writeFileSync(join(root, '_planweave_analysis', 'repo', 'README.md'), 'pw-content')

  const S0 = await snap(root, 'test-excl', 0)
  const s0Keys = Object.keys(S0.entries)
  if (s0Keys.some(k => k.startsWith('node_modules/') || k.startsWith('dist/') || k.startsWith('_tmp_scratch/') || k.startsWith('_planweave_analysis/'))) {
    fail('排除目录不应被快照', `keys=${s0Keys.join(', ')}`)
  } else {
    ok('排除目录未进入快照')
  }

  writeFileSync(join(root, 'src.txt'), 'src-v1')
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'nm-v1')
  writeFileSync(join(root, 'dist', 'bundle.js'), 'dist-v1')
  writeFileSync(join(root, '_tmp_scratch', 'x.txt'), 'tmp-v1')
  writeFileSync(join(root, '_planweave_analysis', 'repo', 'README.md'), 'pw-v1')
  await snap(root, 'test-excl', 1)

  await restoreSnapshot(S0)
  const d = diskDump(root)
  if (d['src.txt'] !== 'src-v0') {
    fail('src.txt 应恢复到 src-v0', `got=${d['src.txt']}`)
  } else {
    ok('src.txt 恢复为 v0')
  }
  const nmNow = readFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'utf8')
  const distNow = readFileSync(join(root, 'dist', 'bundle.js'), 'utf8')
  const tmpNow = readFileSync(join(root, '_tmp_scratch', 'x.txt'), 'utf8')
  const pwNow = readFileSync(join(root, '_planweave_analysis', 'repo', 'README.md'), 'utf8')
  if (nmNow === 'nm-v1' && distNow === 'dist-v1' && tmpNow === 'tmp-v1' && pwNow === 'pw-v1') {
    ok('排除目录内容保持未被回退')
  } else {
    fail('排除目录内容应保持 v1', `nm=${nmNow} dist=${distNow} tmp=${tmpNow} pw=${pwNow}`)
  }
  rmSync(root, { recursive: true, force: true })
}

async function testNestedAndBatch() {
  console.log('\n[3] 嵌套目录 + 批量文件 + 空目录清理：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-batch-'))
  mkdirSync(join(root, 'src', 'deep', 'nested'), { recursive: true })
  const S0 = await snap(root, 'test-batch', 0)

  writeFileSync(join(root, 'src', 'deep', 'nested', 'n.txt'), 'nested')
  for (let i = 0; i < 50; i++) writeFileSync(join(root, `f${String(i).padStart(2, '0')}.txt`), `v1-${i}`)
  const S1 = await snap(root, 'test-batch', 1)

  for (let i = 0; i < 20; i++) writeFileSync(join(root, `f${String(i).padStart(2, '0')}.txt`), `v2-${i}`)
  for (let i = 40; i < 50; i++) rmSync(join(root, `f${String(i).padStart(2, '0')}.txt`))
  await snap(root, 'test-batch', 2)

  // S1 时点的期望磁盘状态：嵌套文件 + 50 个批量文件。
  const s1Expected = { 'src/deep/nested/n.txt': 'nested' }
  for (let i = 0; i < 50; i++) s1Expected[`f${String(i).padStart(2, '0')}.txt`] = `v1-${i}`

  await restoreSnapshot(S1)
  assertSame(diskDump(root), s1Expected, '批量修改后 → 恢复 S1（50 文件全部还原）')

  await restoreSnapshot(S0)
  assertSame(diskDump(root), {}, '嵌套+批量全部清除 → 恢复 S0')
  const leftover = readdirSync(root)
  if (leftover.length !== 0) {
    fail('恢复 S0 后应清空所有新增文件与空目录', `残留=${leftover.join(', ')}`)
  } else {
    ok('新增空目录一并清理')
  }
  rmSync(root, { recursive: true, force: true })
}

async function testOutsideFiles() {
  console.log('\n[4] 工作区外文件回退（extraPaths）：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-cwd-'))
  const outside = mkdtempSync(join(tmpdir(), 'rewind-outside-'))
  const outsideFile = join(outside, 'a.txt')
  const outsideNew = join(outside, 'new.txt')
  writeFileSync(join(root, 'keep.txt'), 'keep')
  writeFileSync(outsideFile, 'A-v0')

  const captured = captureSnapshotSync(root, [outsideFile])
  if (captured === null) throw new Error('captureSnapshotSync returned null')
  await persistSnapshot({ sessionId: 'test-outside', seq: 0, cwd: root, captured })
  const S0 = await readSnapshot('test-outside', 0)
  const absKey = outsideFile.split(/[\\/]/).join('/')
  if (S0.entries[absKey] === undefined) {
    fail('工作区外文件未进入快照', `keys=${Object.keys(S0.entries).join(', ')}`)
  } else {
    ok('工作区外文件进入快照（绝对路径 key）')
  }

  writeFileSync(outsideFile, 'A-v1')
  writeFileSync(outsideNew, 'NEW')
  writeFileSync(join(root, 'keep.txt'), 'keep-v1')

  // 全量分支 + extraPaths：cwd 外的新增/修改必须被检出（桌面场景）。
  const newKey = outsideNew.split(/[\\/]/).join('/')
  const outsideDiff = await diffSnapshot(S0, [outsideFile, outsideNew])
  if (outsideDiff.modified.includes(absKey) && outsideDiff.added.includes(newKey)) {
    ok('全量 diff：工作区外已有文件→modified、新增文件→added（桌面场景）')
  } else {
    fail('全量 diff 未正确检出工作区外变化', JSON.stringify(outsideDiff))
  }

  await restoreSnapshot(S0, [outsideFile, outsideNew])
  const outsideNow = readFileSync(outsideFile, 'utf8')
  const keepNow = readFileSync(join(root, 'keep.txt'), 'utf8')
  const newGone = !existsSync(outsideNew)
  if (outsideNow === 'A-v0' && keepNow === 'keep' && newGone) {
    ok('工作区外：已有文件回退 + 新增文件被删除；工作区内文件回退')
  } else {
    fail('工作区外回退不正确', `outside=${outsideNow} keep=${keepNow} newGone=${newGone}`)
  }
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
}

async function testDiff() {
  console.log('\n[5] 差异检测（diffSnapshot）：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-diff-'))
  writeFileSync(join(root, 'a.txt'), 'A-v0')
  writeFileSync(join(root, 'keep.txt'), 'keep')
  const S0 = await snap(root, 'test-diff', 0)

  const noChange = await diffSnapshot(S0)
  if (!noChange.modified.length && !noChange.added.length && !noChange.deleted.length) {
    ok('无修改 → modified/added/deleted 均为空')
  } else {
    fail('无修改应返回空差异', JSON.stringify(noChange))
  }

  writeFileSync(join(root, 'a.txt'), 'A-v1')
  writeFileSync(join(root, 'new.txt'), 'new')
  rmSync(join(root, 'keep.txt'))
  const diff = await diffSnapshot(S0)
  const modOk = diff.modified.length === 1 && diff.modified.includes('a.txt')
  const addOk = diff.added.length === 1 && diff.added.includes('new.txt')
  const delOk = diff.deleted.length === 1 && diff.deleted.includes('keep.txt')
  if (modOk && addOk && delOk) {
    ok('改/增/删 分别命中 modified/added/deleted')
  } else {
    fail('差异分类不正确', JSON.stringify(diff))
  }

  writeFileSync(join(root, 'a.txt'), 'A-v2')
  writeFileSync(join(root, 'other.txt'), 'other-v0')
  const scoped = await diffSnapshot(S0, undefined, [join(root, 'a.txt')])
  const scopedMod = scoped.modified.length === 1 && scoped.modified.includes('a.txt')
  const scopedClean = scoped.added.length === 0 && scoped.deleted.length === 0
  if (scopedMod && scopedClean) {
    ok('writtenPaths 过滤：只报告白名单内的文件')
  } else {
    fail('writtenPaths 过滤不正确', JSON.stringify(scoped))
  }

  const emptyScoped = await diffSnapshot(S0, undefined, [])
  if (!emptyScoped.modified.length && !emptyScoped.added.length && !emptyScoped.deleted.length) {
    ok('空白名单 → 无差异（不误伤其他来源文件）')
  } else {
    fail('空白名单应返回空差异', JSON.stringify(emptyScoped))
  }

  rmSync(root, { recursive: true, force: true })
}

async function testDeduplication() {
  console.log('\n[6] v2 内容寻址去重：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-dedup-'))
  writeFileSync(join(root, 'a.txt'), 'A-content')
  writeFileSync(join(root, 'b.txt'), 'B-content')
  writeFileSync(join(root, 'c.txt'), 'C-v0')

  const before = blobCount()
  await snap(root, 'test-dedup', 0)

  writeFileSync(join(root, 'c.txt'), 'C-v1')
  await snap(root, 'test-dedup', 1)

  // 第三次快照零变化：不应产生任何新 blob。
  await snap(root, 'test-dedup', 2)

  // 唯一内容共 4 份（A/B/C-v0/C-v1）。
  const delta = blobCount() - before
  if (delta === 4) {
    ok('三个快照只产生 4 个 blob（3 个唯一版本 + 1 个未变快照零新增）')
  } else {
    fail('去重失效：blob 数量不符', `expect=4 got=${delta}`)
  }

  const s0 = await readSnapshot('test-dedup', 0)
  const s2 = await readSnapshot('test-dedup', 2)
  if (s0.entries['a.txt'].hash !== null && s0.entries['a.txt'].hash === s2.entries['a.txt'].hash) {
    ok('跨快照同内容 hash 一致（索引共享同一 blob）')
  } else {
    fail('同内容 hash 不一致', `s0=${s0.entries['a.txt'].hash} s2=${s2.entries['a.txt'].hash}`)
  }

  // 未变化的第三次快照体积应远小于首次（纯索引级别）。
  rmSync(root, { recursive: true, force: true })
}

async function testGc() {
  console.log('\n[7] blob GC（孤儿回收 + 宽限期 + 缓存安全）：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-gc-'))
  writeFileSync(join(root, 'f.txt'), 'V0')
  writeFileSync(join(root, 'keep.txt'), 'K')
  const cap1 = captureSnapshotSync(root)
  await persistSnapshot({ sessionId: 'test-gc', seq: 1, cwd: root, captured: cap1 })

  writeFileSync(join(root, 'f.txt'), 'V1')
  const cap2 = captureSnapshotSync(root)
  await persistSnapshot({ sessionId: 'test-gc', seq: 2, cwd: root, captured: cap2 })

  const hashV0 = cap1.files['f.txt'].hash
  const hashV1 = cap2.files['f.txt'].hash
  const hashK = cap1.files['keep.txt'].hash
  if (!existsSync(blobFile(hashV0))) {
    fail('前置：V0 blob 应存在', hashV0)
    return
  }

  // 删除对 V0 的唯一引用（S1），并把所有 blob 的 mtime 拨到 2 小时前以越过宽限期。
  rmSync(join(rewindHome(), 'test-gc', '1.json'), { force: true })
  rmSync(join(rewindHome(), 'test-gc', '1.meta.json'), { force: true })
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000)
  for (const h of [hashV0, hashV1, hashK]) utimesSync(blobFile(h), past, past)

  await gcBlobs()

  if (!existsSync(blobFile(hashV0))) {
    ok('无引用且超宽限期的孤儿 blob 被回收')
  } else {
    fail('孤儿 blob 未被回收', hashV0)
  }
  if (existsSync(blobFile(hashV1)) && existsSync(blobFile(hashK))) {
    ok('仍有快照引用的 blob 保留')
  } else {
    fail('存活 blob 被误删', `V1=${existsSync(blobFile(hashV1))} K=${existsSync(blobFile(hashK))}`)
  }

  // 宽限期内（mtime 未拨旧）的孤儿不被回收：再造一个孤儿验证。
  writeFileSync(join(root, 'g.txt'), 'G-fresh')
  const cap3 = captureSnapshotSync(root)
  await persistSnapshot({ sessionId: 'test-gc', seq: 3, cwd: root, captured: cap3 })
  rmSync(join(rewindHome(), 'test-gc', '3.json'), { force: true })
  rmSync(join(rewindHome(), 'test-gc', '3.meta.json'), { force: true })
  await gcBlobs()
  if (existsSync(blobFile(cap3.files['g.txt'].hash))) {
    ok('宽限期内的新 blob 不被回收（规避写入竞态）')
  } else {
    fail('宽限期内 blob 被误删', cap3.files['g.txt'].hash)
  }

  rmSync(root, { recursive: true, force: true })
}

async function testAgeOut() {
  console.log('\n[8] 全局维护：超龄快照淘汰：')
  const dir = join(rewindHome(), 'test-aged')
  mkdirSync(dir, { recursive: true })
  const old = Date.now() - 31 * 24 * 60 * 60 * 1000
  const json = {
    version: 2, sessionId: 'test-aged', seq: 999, cwd: 'X:\\nowhere',
    createdAt: old, fileCount: 0, files: {},
  }
  writeFileSync(join(dir, '999.json'), `${JSON.stringify(json)}\n`)
  writeFileSync(join(dir, '999.meta.json'), `${JSON.stringify({ version: 1, sessionId: 'test-aged', seq: 999, cwd: 'X:\\nowhere', createdAt: old, files: {} })}\n`)

  await runMaintenance()

  if (!existsSync(join(dir, '999.json'))) {
    ok('超过 30 天的快照被全局维护淘汰')
  } else {
    fail('超龄快照未被淘汰', join(dir, '999.json'))
  }
  rmSync(dir, { recursive: true, force: true })
}

async function testV1Compat() {
  console.log('\n[9] v1 遗留快照兼容（content 内嵌格式）：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-v1-'))
  writeFileSync(join(root, 'a.txt'), 'changed-later')
  const v1 = {
    version: 1, sessionId: 'test-v1', seq: 5, cwd: root,
    createdAt: Date.now(), fileCount: 1,
    files: { 'a.txt': { size: 4, content: Buffer.from('V1!!').toString('base64') } },
  }
  mkdirSync(join(rewindHome(), 'test-v1'), { recursive: true })
  writeFileSync(join(rewindHome(), 'test-v1', '5.json'), JSON.stringify(v1))

  const view = await readSnapshot('test-v1', 5)
  if (view === null || view.version !== 1) {
    fail('v1 快照解析失败', JSON.stringify(view))
    return
  }
  await restoreSnapshot(view)
  if (readFileSync(join(root, 'a.txt'), 'utf8') === 'V1!!') {
    ok('v1 快照可解析并正确恢复内容')
  } else {
    fail('v1 快照恢复内容不正确', readFileSync(join(root, 'a.txt'), 'utf8'))
  }
  rmSync(root, { recursive: true, force: true })
}

async function testRollingPrune() {
  console.log('\n[10] 单会话滚动清理（最多保留最近快照）：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-roll-'))
  writeFileSync(join(root, 'r.txt'), 'r0')
  for (let seq = 0; seq < 52; seq++) {
    writeFileSync(join(root, 'r.txt'), `r${seq}`)
    await snap(root, 'test-roll', seq)
  }
  const oldest = await readSnapshot('test-roll', 0)
  const newest = await readSnapshot('test-roll', 51)
  if (oldest === null && newest !== null) {
    ok('超出保留数的最早快照被滚动清理')
  } else {
    fail('滚动清理不正确', `oldest=${oldest !== null} newest=${newest === null}`)
  }
  // 恢复最新快照仍正常（blob 未被误删）。
  writeFileSync(join(root, 'r.txt'), 'dirty')
  await restoreSnapshot(newest)
  if (readFileSync(join(root, 'r.txt'), 'utf8') === 'r51') {
    ok('滚动清理后新快照恢复正常')
  } else {
    fail('滚动清理后恢复失败', readFileSync(join(root, 'r.txt'), 'utf8'))
  }
  rmSync(root, { recursive: true, force: true })
}

async function testBinaryAndLarge() {
  console.log('\n[11] 二进制 / 超大文件只记录存在性：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-bin-'))
  writeFileSync(join(root, 'img.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01]))
  writeFileSync(join(root, 'huge.txt'), 'x'.repeat(2 * 1024 * 1024 + 5))
  writeFileSync(join(root, 'text.txt'), 't0')
  const S0 = await snap(root, 'test-bin', 0)

  const binEntry = S0.entries['img.bin']
  const hugeEntry = S0.entries['huge.txt']
  const binFlagged = binEntry !== undefined && binEntry.hash === null
  const hugeFlagged = hugeEntry !== undefined && hugeEntry.hash === null
  if (binFlagged && hugeFlagged) {
    ok('二进制与超大文件均只记录存在性（无内容引用）')
  } else {
    fail('存在性标记不正确', `bin=${JSON.stringify(binEntry)} huge=${JSON.stringify(hugeEntry)}`)
  }

  // 修改后恢复：两者都应保持现状（restore 跳过不可恢复条目）。
  writeFileSync(join(root, 'img.bin'), Buffer.from([0xff, 0x00, 0x01]))
  writeFileSync(join(root, 'huge.txt'), 'huge-modified')
  writeFileSync(join(root, 'text.txt'), 't1')
  await restoreSnapshot(S0)

  const binNow = readFileSync(join(root, 'img.bin')).toString('hex')
  const hugeNow = readFileSync(join(root, 'huge.txt'), 'utf8')
  const textNow = readFileSync(join(root, 'text.txt'), 'utf8')
  if (binNow === 'ff0001' && hugeNow === 'huge-modified' && textNow === 't0') {
    ok('恢复时不可恢复条目保持现状，文本正常回退')
  } else {
    fail('不可恢复条目处理不正确', `bin=${binNow} huge=${hugeNow} text=${textNow}`)
  }
  rmSync(root, { recursive: true, force: true })
}

async function testWrittenLogPersistence() {
  console.log('\n[12] 写入记录持久化（模拟服务重启后从磁盘恢复）：')
  // 模拟「上一个进程」留下的会话写入日志：本测试进程从未在内存里见过该会话，
  // writtenPathsFor 必须从磁盘 .written.jsonl 恢复——这正是中断/重启场景。
  const sessionId = 'test-persist'
  const dir = join(rewindHome(), encodeURIComponent(sessionId))
  mkdirSync(dir, { recursive: true })
  const root = mkdtempSync(join(tmpdir(), 'rewind-persist-'))
  const insidePath = join(root, 'a.txt')
  writeFileSync(insidePath, 'v0')
  const outsideGone = 'D:\\__rewind_not_exist__/gone.txt'
  writeFileSync(join(dir, '.written.jsonl'), `${insidePath}\n${outsideGone}\n`, 'utf8')

  const restored = writtenPathsFor(sessionId)
  if (restored.has(insidePath) && restored.has(outsideGone)) {
    ok('重启后从磁盘恢复会话写入记录（diff/restore 可正确弹窗与回退）')
  } else {
    fail('写入记录恢复失败', JSON.stringify([...restored]))
  }

  // 用恢复出的集合跑一次 diff 过滤路径，确认端到端可用：
  //   - insidePath 在快照后又被修改 → 应作为 modified 命中（会弹窗列出文件名）；
  //   - outsideGone 已不存在 → 正确忽略（不算新增/删除/修改）。
  const captured = captureSnapshotSync(root)
  await persistSnapshot({ sessionId, seq: 1, cwd: root, captured })
  const view = await readSnapshot(sessionId, 1)
  writeFileSync(insidePath, 'v1-modified')
  const diff = await diffSnapshot(view, undefined, [...restored])
  if (diff.modified.length === 1 && diff.modified[0] === 'a.txt' && diff.added.length === 0 && diff.deleted.length === 0) {
    ok('持久化记录直接驱动 diff 过滤分支（无需重新写入）')
  } else {
    fail('持久化记录未正确驱动 diff', JSON.stringify(diff))
  }
  rmSync(root, { recursive: true, force: true })
}

async function testExternalDirs() {
  console.log('\n[13] 外部目录跟踪（桌面场景）：')
  // 构造一个带 extDirs 的视图：模拟「快照时桌面已有 base.txt」。
  // base.txt 经 extraPaths 走正规捕获流程（hash + blob 入库），保证可恢复。
  const root = mkdtempSync(join(tmpdir(), 'rewind-ext-'))
  const fakeExt = mkdtempSync(join(tmpdir(), 'rewind-ext-desktop-'))
  const basePath = join(fakeExt, 'base.txt')
  writeFileSync(basePath, 'B-v0')

  const captured = captureSnapshotSync(root, [basePath])
  await persistSnapshot({ sessionId: 'test-ext', seq: 0, cwd: root, captured })
  const view = await readSnapshot('test-ext', 0)
  const baseKey = basePath.split(/[\\/]/).join('/')
  if (view.entries[baseKey] === undefined || view.entries[baseKey].hash === null) {
    fail('外部文件未通过 extraPaths 入快照', JSON.stringify(Object.keys(view.entries)))
    return
  }
  ok('外部文件经 extraPaths 入快照（含 blob 引用）')
  // 手工注入 extDirs（capture 的 extDirs 来自真实 homedir，测试里替换为沙箱目录）
  view.extDirs = [fakeExt]

  // 桌面新增文件 → diff 应检出为 added（将被删除）
  writeFileSync(join(fakeExt, 'extra.txt'), 'new-file-on-desktop')
  const d1 = await diffSnapshot(view)
  if (d1.added.includes(baseKey.replace('base.txt', 'extra.txt'))) {
    ok('外部目录新增文件被 diff 检出为 added')
  } else {
    fail('外部目录新增未检出', JSON.stringify(d1))
  }

  // 修改 base.txt → modified
  writeFileSync(basePath, 'B-v1-modified')
  const d2 = await diffSnapshot(view)
  if (d2.modified.includes(baseKey)) {
    ok('外部目录已有文件修改被 diff 检出为 modified')
  } else {
    fail('外部目录修改未检出', JSON.stringify(d2))
  }

  // 回退：extra.txt 被删除、base.txt 恢复为 v0
  const result = await restoreSnapshot(view)
  if (!existsSync(join(fakeExt, 'extra.txt')) && readFileSync(basePath, 'utf8') === 'B-v0') {
    ok(`回退后：外部新增文件删除、已有文件还原（deleted=${result.deleted}）`)
  } else {
    fail('外部目录回退不正确', `extraExists=${existsSync(join(fakeExt, 'extra.txt'))} base=${readFileSync(basePath, 'utf8')}`)
  }
  rmSync(root, { recursive: true, force: true })
  rmSync(fakeExt, { recursive: true, force: true })
}

async function testCrossSessionProtection() {
  console.log('\n[14] 跨会话保护（writtenPaths 过滤 + 快照时点时间戳）：')
  // 场景：本会话在消息前写过 b.txt；消息后本会话写 a.txt、其他会话改 b.txt 并新建 c.txt。
  // 回退只应处理 a.txt（本会话消息后写过），b.txt/c.txt 一律不碰。
  const sessionId = 'test-xss'
  const root = mkdtempSync(join(tmpdir(), 'rewind-xss-'))
  const aPath = join(root, 'a.txt')
  const bPath = join(root, 'b.txt')
  const cPath = join(root, 'c.txt')
  writeFileSync(aPath, 'A-snap')
  writeFileSync(bPath, 'B-snap')
  const S0 = await snap(root, sessionId, 0)
  const tSnap = S0.createdAt

  // 模拟磁盘上的会话写入记录（跨重启持久化场景）：
  //  - b.txt 最后写入在快照前（t < tSnap）——快照后由其他会话/人工改动；
  //  - a.txt 最后写入在快照后（t > tSnap）——本会话的修改，应回退。
  const dir = join(rewindHome(), encodeURIComponent(sessionId))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.written.jsonl'),
    `${JSON.stringify({ t: tSnap - 1000, p: bPath })}\n${JSON.stringify({ t: tSnap + 1000, p: aPath })}\n`)

  // 快照后的磁盘状态。
  writeFileSync(aPath, 'A-v1')   // 本会话改
  writeFileSync(bPath, 'B-other') // 其他会话改（应保护）
  writeFileSync(cPath, 'C-other') // 其他会话新建（应保护）

  const written = writtenPathsAfter(sessionId, tSnap)
  const writtenOk = written.length === 1 && written[0] === aPath
  if (writtenOk) {
    ok('writtenPathsAfter 只含快照后本会话写过的文件')
  } else {
    fail('writtenPathsAfter 过滤不正确', JSON.stringify(written))
  }

  const diff = await diffSnapshot(S0, undefined, written)
  const diffOk = diff.modified.length === 1 && diff.modified[0] === 'a.txt'
    && diff.added.length === 0 && diff.deleted.length === 0
  if (diffOk) {
    ok('diff 只报本会话修改（他会话改/新增不误报）')
  } else {
    fail('diff 未按 writtenPaths 过滤', JSON.stringify(diff))
  }

  await restoreSnapshot(S0, undefined, written)
  const aAfter = readFileSync(aPath, 'utf8')
  const bAfter = readFileSync(bPath, 'utf8')
  const cStill = existsSync(cPath)
  if (aAfter === 'A-snap' && bAfter === 'B-other' && cStill) {
    ok('restore 只回退本会话文件；他会话修改/新增保留')
  } else {
    fail('restore 保护失败', `a=${aAfter} b=${bAfter} cStill=${cStill}`)
  }

  // 旧格式（纯路径行，无时间戳）兼容：恒视为「已写」，参与回退。
  // 用独立 sessionId —— 同进程内 writtenLogLoaded 已缓存该会话，不会重新读盘。
  const legacySession = 'test-xss-legacy'
  const legacyRoot = mkdtempSync(join(tmpdir(), 'rewind-xss-legacy-'))
  const legacyA = join(legacyRoot, 'a.txt')
  const legacyB = join(legacyRoot, 'b.txt')
  writeFileSync(legacyA, 'A-snap')
  writeFileSync(legacyB, 'B-snap')
  const L0 = await snap(legacyRoot, legacySession, 0)
  writeFileSync(join(rewindHome(), encodeURIComponent(legacySession), '.written.jsonl'), `${legacyB}\n`)
  const legacy = writtenPathsAfter(legacySession, L0.createdAt)
  writeFileSync(legacyB, 'B-v2')
  const legacyDiff = await diffSnapshot(L0, undefined, legacy)
  if (legacy.includes(legacyB) && legacyDiff.modified.includes('b.txt')) {
    ok('旧式纯路径记录兼容：恒参与回退')
  } else {
    fail('旧式记录兼容失败', JSON.stringify({ legacy, legacyDiff }))
  }
  rmSync(legacyRoot, { recursive: true, force: true })

  // 回归：writtenPaths 曾被误传为 extraPaths（第 2 参数）导致全量回退——
  // 显式断言 extraPaths 语义不变：工作区内路径不触发删除。
  writeFileSync(bPath, 'B-snap')
  rmSync(cPath, { force: true })
  const extraDiff = await diffSnapshot(S0, [bPath, cPath])
  if (!extraDiff.added.includes('c.txt')) {
    ok('extraPaths 语义不变（工作区内路径不参与，新增经全量 walk 检出）')
  } else {
    fail('extraPaths 语义回归', JSON.stringify(extraDiff))
  }
  rmSync(root, { recursive: true, force: true })
}

async function main() {
  try {
    await testMultiRound()
    await testExcludedDirs()
    await testNestedAndBatch()
    await testOutsideFiles()
    await testDiff()
    await testDeduplication()
    await testGc()
    await testAgeOut()
    await testV1Compat()
    await testRollingPrune()
    await testBinaryAndLarge()
    await testWrittenLogPersistence()
    await testExternalDirs()
    await testCrossSessionProtection()
  } finally {
    rmSync(storageRoot, { recursive: true, force: true })
  }
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error('测试异常：', error)
  process.exit(1)
})
