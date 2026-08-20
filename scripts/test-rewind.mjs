/**
 * 退回文件快照/恢复 的独立回归测试（不依赖 DSH 运行时）。
 *
 * 覆盖：
 *   1. 多轮对话、每轮修改多个文件（改内容 / 新增 / 删除），逐步退回。
 *   2. 排除目录（node_modules / dist / _tmp 等）在快照与恢复时都被跳过。
 *   3. 嵌套目录 + 批量文件（50 个）的修改与恢复 + 空目录清理。
 * 运行：node scripts/test-rewind.mjs
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureSnapshotSync, restoreSnapshot } from '../lib/rewind.js'

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

function snap(root, seq) {
  const captured = captureSnapshotSync(root)
  if (captured === null) throw new Error('captureSnapshotSync returned null')
  return {
    version: 1, sessionId: 'test', seq, cwd: root,
    createdAt: Date.now(), fileCount: Object.keys(captured.files).length,
    files: captured.files,
  }
}

function dumpOf(snapshot) {
  const out = {}
  for (const [rel, f] of Object.entries(snapshot.files)) {
    out[rel] = f.content === null ? `[skip:${f.size}]` : Buffer.from(f.content, 'base64').toString('utf8')
  }
  return out
}

function dump(root) {
  return dumpOf(snap(root, -1))
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

async function testMultiRound() {
  console.log('\n[1] 多轮改/增/删：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-multi-'))
  writeFileSync(join(root, 'a.txt'), 'A-v0')
  writeFileSync(join(root, 'keep.txt'), 'keep')
  const S0 = snap(root, 0)

  writeFileSync(join(root, 'a.txt'), 'A-v1')
  writeFileSync(join(root, 'b.txt'), 'B-v1')
  const S1 = snap(root, 1)

  writeFileSync(join(root, 'b.txt'), 'B-v2')
  writeFileSync(join(root, 'c.txt'), 'C-v2')
  const S2 = snap(root, 2)

  writeFileSync(join(root, 'a.txt'), 'A-v3')
  writeFileSync(join(root, 'b.txt'), 'B-v3')
  rmSync(join(root, 'c.txt'))
  writeFileSync(join(root, 'd.txt'), 'D-v3')
  snap(root, 3)

  await restoreSnapshot(S2)
  assertSame(dump(root), dumpOf(S2), '退回轮3 → 恢复 S2')
  await restoreSnapshot(S1)
  assertSame(dump(root), dumpOf(S1), '退回轮2 → 恢复 S1')
  await restoreSnapshot(S0)
  assertSame(dump(root), dumpOf(S0), '退回轮1 → 恢复 S0')
  await restoreSnapshot(S0)
  assertSame(dump(root), dumpOf(S0), '幂等：再次恢复 S0 不变')
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

  const S0 = snap(root, 0)
  const s0Keys = Object.keys(S0.files)
  if (s0Keys.some(k => k.startsWith('node_modules/') || k.startsWith('dist/') || k.startsWith('_tmp_scratch/'))) {
    fail('排除目录不应被快照', `keys=${s0Keys.join(', ')}`)
  } else {
    ok('排除目录未进入快照')
  }

  writeFileSync(join(root, 'src.txt'), 'src-v1')
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'nm-v1')
  writeFileSync(join(root, 'dist', 'bundle.js'), 'dist-v1')
  writeFileSync(join(root, '_tmp_scratch', 'x.txt'), 'tmp-v1')
  snap(root, 1)

  await restoreSnapshot(S0)
  const d = dump(root)
  if (d['src.txt'] !== 'src-v0') {
    fail('src.txt 应恢复到 src-v0', `got=${d['src.txt']}`)
  } else {
    ok('src.txt 恢复为 v0')
  }
  const { readFileSync } = await import('node:fs')
  const nmNow = readFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'utf8')
  const distNow = readFileSync(join(root, 'dist', 'bundle.js'), 'utf8')
  const tmpNow = readFileSync(join(root, '_tmp_scratch', 'x.txt'), 'utf8')
  if (nmNow === 'nm-v1' && distNow === 'dist-v1' && tmpNow === 'tmp-v1') {
    ok('排除目录内容保持未被回退')
  } else {
    fail('排除目录内容应保持 v1', `nm=${nmNow} dist=${distNow} tmp=${tmpNow}`)
  }
  rmSync(root, { recursive: true, force: true })
}

async function testNestedAndBatch() {
  console.log('\n[3] 嵌套目录 + 批量文件 + 空目录清理：')
  const root = mkdtempSync(join(tmpdir(), 'rewind-batch-'))
  mkdirSync(join(root, 'src', 'deep', 'nested'), { recursive: true })
  const S0 = snap(root, 0)

  writeFileSync(join(root, 'src', 'deep', 'nested', 'n.txt'), 'nested')
  for (let i = 0; i < 50; i++) writeFileSync(join(root, `f${String(i).padStart(2, '0')}.txt`), `v1-${i}`)
  const S1 = snap(root, 1)

  for (let i = 0; i < 20; i++) writeFileSync(join(root, `f${String(i).padStart(2, '0')}.txt`), `v2-${i}`)
  for (let i = 40; i < 50; i++) rmSync(join(root, `f${String(i).padStart(2, '0')}.txt`))
  snap(root, 2)

  await restoreSnapshot(S1)
  assertSame(dump(root), dumpOf(S1), '批量修改后 → 恢复 S1（50 文件全部还原）')
  await restoreSnapshot(S0)
  assertSame(dump(root), dumpOf(S0), '嵌套+批量全部清除 → 恢复 S0')
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

  // 快照：cwd + 工作区外文件
  const captured = captureSnapshotSync(root, [outsideFile])
  if (captured === null) throw new Error('captureSnapshotSync returned null')
  const S0 = {
    version: 1, sessionId: 'test', seq: 0, cwd: root,
    createdAt: Date.now(), fileCount: Object.keys(captured.files).length,
    files: captured.files,
  }
  const absKey = outsideFile.split(/[\\/]/).join('/')
  if (S0.files[absKey] === undefined) {
    fail('工作区外文件未进入快照', `keys=${Object.keys(S0.files).join(', ')}`)
  } else {
    ok('工作区外文件进入快照（绝对路径 key）')
  }

  // 修改工作区外已有文件 + 新增一个工作区外文件 + 修改工作区内文件
  writeFileSync(outsideFile, 'A-v1')
  writeFileSync(outsideNew, 'NEW')
  writeFileSync(join(root, 'keep.txt'), 'keep-v1')

  await restoreSnapshot(S0, [outsideFile, outsideNew])
  const { readFileSync, existsSync } = await import('node:fs')
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

async function main() {
  await testMultiRound()
  await testExcludedDirs()
  await testNestedAndBatch()
  await testOutsideFiles()
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error('测试异常：', error)
  process.exit(1)
})
