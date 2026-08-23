// 针对「回退对话 fork 后子会话丢失写入记录」修复的端到端验证。
// 场景复现用户问题 2：
//   父会话 parent 在 seq=7 消息后写文件 a.txt（记入 parent 的 .written.jsonl），
//   之后 fork 出 child（child 无自己的写入记录）。在 child 里退回 seq=7 消息，
//   必须沿 lineage 合并 parent 的写入记录，否则 diff 恒为空、文件不回退。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const storageRoot = mkdtempSync(join(tmpdir(), 'rewind-lineage-'))
process.env.DSH_HOME = storageRoot

const {
  captureSnapshotSync, persistSnapshot, restoreSnapshot, diffSnapshot,
  readSnapshot, rewindHome, writtenPathsAfterLineage,
} = await import('../lib/rewind.js')

const parentId = 'session-parent'
const childId = 'session-child'
let passed = 0
let failed = 0
const ok = (l) => { passed += 1; console.log(`  ✓ ${l}`) }
const fail = (l, d) => { failed += 1; console.error(`  ✗ ${l}\n    ${d}`) }

const root = mkdtempSync(join(tmpdir(), 'rewind-lineage-ws-'))
const aPath = join(root, 'a.txt')
writeFileSync(aPath, 'A-v0') // 消息发送前已存在

// 1) 父会话 seq=7 快照。
const captured = captureSnapshotSync(root)
await persistSnapshot({ sessionId: parentId, seq: 7, cwd: root, captured })
const S7 = await readSnapshot(parentId, 7)
const tSnap = S7.createdAt

// 2) 父会话在消息后写入 a.txt（模拟 agent write；记入 parent 的 .written.jsonl）。
writeFileSync(aPath, 'A-v1')
const dir = join(rewindHome(), encodeURIComponent(parentId))
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, '.written.jsonl'), `${JSON.stringify({ t: tSnap + 1000, p: aPath })}\n`)

// 3) mock ctx：child 的 parent 是 parentId（child 自己没有 written 记录）。
const sessions = {
  get: (id) => id === childId ? { header: { parentSession: parentId } } : id === parentId ? { header: {} } : undefined,
}
const ctx = { get: (name) => name === 'sessions' ? sessions : undefined }

// 4) 在 child 里退回 seq=7：written 集合必须沿 lineage 拿到 parent 的 a.txt。
const lineageWritten = writtenPathsAfterLineage(ctx, childId, tSnap)
if (lineageWritten.length === 1 && lineageWritten[0] === aPath) {
  ok('lineage 合并：child 继承 parent 的写入记录（a.txt）')
} else {
  fail('lineage 合并失败', JSON.stringify(lineageWritten))
}

const diff = await diffSnapshot(S7, undefined, lineageWritten)
if (diff.modified.length === 1 && diff.modified[0] === 'a.txt') {
  ok('child 退回 diff 检出 a.txt 修改')
} else {
  fail('child 退回 diff 未检出', JSON.stringify(diff))
}

await restoreSnapshot(S7, undefined, lineageWritten)
const after = readFileSync(aPath, 'utf8')
if (after === 'A-v0') {
  ok('child 退回 restore 把 a.txt 恢复到 A-v0')
} else {
  fail('restore 未恢复', `a=${after}`)
}

// 5) 反向：单会话（无 fork）行为不变。
const single = writtenPathsAfterLineage(ctx, parentId, tSnap)
if (single.length === 1 && single[0] === aPath) {
  ok('单会话（parent 自身）行为不变')
} else {
  fail('单会话回归', JSON.stringify(single))
}

// 6) lineage 断链（sessions 查不到 parent）时降级为仅自身，不抛错。
const noParentCtx = { get: (name) => name === 'sessions' ? { get: () => undefined } : undefined }
const orphan = writtenPathsAfterLineage(noParentCtx, childId, tSnap)
if (Array.isArray(orphan) && orphan.length === 0) {
  ok('lineage 断链降级为空，不抛错')
} else {
  fail('断链降级异常', JSON.stringify(orphan))
}

rmSync(root, { recursive: true, force: true })
rmSync(storageRoot, { recursive: true, force: true })
console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
