/**
 * 端到端 HTTP 测试：在真实运行的 DSH 服务（3080）上验证
 * /api/webui-rewind/diff 与 /restore 的「跨会话保护」行为。
 *
 * 场景（与 test-rewind.mjs 第 14 项对应，但走真实 handler 调用链）：
 *   - 本会话在快照后写过 a.txt（t > 快照时点）→ 应被回退；
 *   - 本会话在快照前最后写过 b.txt，快照后由「其他会话」改为 B-other → 应保护；
 *   - c.txt 由「其他会话」新建 → 应保护。
 *
 * 运行：node scripts/test-rewind-e2e-http.mjs（需服务在线且已加载新 lib）
 * 注：脚本自身不设置 DSH_HOME —— 快照必须落在服务读取的真实 DSH_HOME。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const {
  captureSnapshotSync, persistSnapshot, readSnapshot, rewindHome,
} = await import('../lib/rewind.js')

const BASE = 'http://127.0.0.1:3080'
// 每次运行用独立 sessionId：服务进程会缓存已加载会话的 .written.jsonl
// （writtenLogLoaded 不重读盘），复用会读到旧时间戳导致过滤失真。
const SESSION = `test-e2e-xss-${Date.now()}`
let passed = 0
let failed = 0
function ok(label) { passed += 1; console.log(`  ✓ ${label}`) }
function fail(label, detail) { failed += 1; console.error(`  ✗ ${label}\n    ${detail}`) }

// ── 1. 构造快照 ────────────────────────────────────────────────────────────
const cwd = mkdtempSync(join(tmpdir(), 'rewind-e2e-cwd-'))
const aPath = join(cwd, 'a.txt')
const bPath = join(cwd, 'b.txt')
const cPath = join(cwd, 'c.txt')
writeFileSync(aPath, 'A-snap')
writeFileSync(bPath, 'B-snap')

const captured = captureSnapshotSync(cwd)
if (captured === null) { console.error('captureSnapshotSync returned null'); process.exit(1) }
await persistSnapshot({ sessionId: SESSION, seq: 0, cwd, captured })
const view = await readSnapshot(SESSION, 0)
const tSnap = view.createdAt

// ── 2. 模拟会话写入日志（本会话真实场景：a.txt 快照后写；b.txt 快照前最后写）──
const dir = join(rewindHome(), encodeURIComponent(SESSION))
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, '.written.jsonl'),
  `${JSON.stringify({ t: tSnap - 10_000, p: bPath })}\n${JSON.stringify({ t: tSnap + 10_000, p: aPath })}\n`)

// ── 3. 快照后的磁盘状态（模拟其他会话动过 b.txt、新建 c.txt）──
writeFileSync(aPath, 'A-v1')    // 本会话改 → 应回退
writeFileSync(bPath, 'B-other') // 其他会话改 → 应保护
writeFileSync(cPath, 'C-other') // 其他会话新建 → 应保护

// ── 4. HTTP diff ──────────────────────────────────────────────────────────
console.log('\n[HTTP-1] /diff 只报本会话在快照后写过的文件：')
const diffUrl = `${BASE}/api/webui-rewind/diff?sessionId=${encodeURIComponent(SESSION)}&seq=0`
const diffRes = await fetch(diffUrl)
const diffJson = await diffRes.json()
if (diffJson.ok !== true) {
  fail('diff 请求失败', JSON.stringify(diffJson))
} else {
  const modifiedOk = Array.isArray(diffJson.modified) && diffJson.modified.length === 1
    && diffJson.modified[0] === 'a.txt'
  const cleanOk = Array.isArray(diffJson.added) && diffJson.added.length === 0
    && Array.isArray(diffJson.deleted) && diffJson.deleted.length === 0
  if (modifiedOk && cleanOk && diffJson.summary.modified === 1) {
    ok(`diff 仅报告 a.txt（modified=[${diffJson.modified.join(', ')}]，他会话文件不误报）`)
  } else {
    fail('diff 报告不精确', JSON.stringify(diffJson))
  }
}

// ── 5. HTTP restore ───────────────────────────────────────────────────────
console.log('\n[HTTP-2] /restore 只回退本会话文件，他会话修改/新增保留：')
const restoreRes = await fetch(`${BASE}/api/webui-rewind/restore`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId: SESSION, seq: 0 }),
})
const restoreJson = await restoreRes.json()
if (restoreJson.ok !== true) {
  fail('restore 失败', JSON.stringify(restoreJson))
} else {
  const aNow = readFileSync(aPath, 'utf8')
  const bNow = readFileSync(bPath, 'utf8')
  const cStill = (() => { try { return readFileSync(cPath, 'utf8') === 'C-other' } catch { return false } })()
  if (aNow === 'A-snap' && bNow === 'B-other' && cStill) {
    ok(`restore 后：a.txt=快照值、b.txt 保持其他会话值、c.txt 保留（restored=${restoreJson.restored}）`)
  } else {
    fail('restore 保护失败', `a=${aNow} b=${bNow} cStill=${cStill}`)
  }
}

// ── 6. 清理 ──────────────────────────────────────────────────────────────
rmSync(join(dir, '0.json'), { force: true })
rmSync(join(dir, '0.meta.json'), { force: true })
rmSync(join(dir, '.written.jsonl'), { force: true })
try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
rmSync(cwd, { recursive: true, force: true })

console.log(`\n结果：${passed} 通过，${failed} 失败`)
// Node/Windows 下 fetch 未决句柄会在进程退出时触发 UV_HANDLE_CLOSING 断言；
// 等一拍让底层 handle 收敛（断言不影响结果，仅保证退出码干净）。
await new Promise(r => setTimeout(r, 500))
process.exit(failed > 0 ? 1 : 0)
