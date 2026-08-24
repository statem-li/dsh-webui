/**
 * session-pin 折叠置顶补行的独立回归测试（jsdom，不依赖 DSH 运行时 / 不碰用户数据）。
 *
 * 覆盖「折叠工作区时置顶补行闪一下」的三个成因：
 *   1. 多分组：任一分组命中幂等分支后仍继续处理后续分组（旧代码 return 会漏组，
 *      漏掉的组要等 1.5s 兜底轮询才补行 = 闪）。
 *   2. 同步补齐：会话行被移出 DOM 后，补行在同一微任务内出现（不等 50ms 去抖）。
 *   3. 位置漂移只搬不重建：容器被 React 重渲染挤走时用 header.after 移动同一节点，
 *      不销毁重建（重建会「消失一帧再出现」）。
 *
 * 运行：node scripts/test-session-pin.mjs（需 DSH_CHECKOUT 指向 dsh 源码 checkout，
 * 借其 esbuild 打包被测模块、jsdom 提供 DOM）。
 */
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 在 checkout 的 pnpm store 里定位一个包的入口（root node_modules 只软链部分包）。 */
function fromCheckout(pkg, entry) {
  const direct = join(CHECKOUT, 'node_modules', pkg, entry)
  const store = join(CHECKOUT, 'node_modules/.pnpm')
  const dir = readdirSync(store).find(name => name.startsWith(pkg + '@'))
  const candidates = [direct]
  if (dir !== undefined) candidates.push(join(store, dir, 'node_modules', pkg, entry))
  const hit = candidates.find(path => existsSync(path))
  if (hit === undefined) throw new Error('cannot locate ' + pkg + ' under ' + CHECKOUT)
  return pathToFileURL(hit).href
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECKOUT = process.env.DSH_CHECKOUT ?? 'D:/AI/deepseek-harness'
const TMP = join(ROOT, '_tmp', 'session-pin-test')

// ── 1. 打包被测模块（context-menu 用桩替换，避免拖进 React）────────────────
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
for (const file of ['maintainer.ts', 'store.ts']) {
  cpSync(join(ROOT, 'src/client/session-pin', file), join(TMP, file))
}
writeFileSync(join(TMP, 'context-menu.ts'), [
  'export function openSessionPinMenu(): void {}',
  'export function setSessionPinServices(): void {}',
].join('\n'))

const BUNDLE = join(TMP, 'bundle.mjs')
const esbuild = await import(fromCheckout('esbuild', 'lib/main.js'))
await esbuild.build({
  entryPoints: [join(TMP, 'maintainer.ts')],
  outfile: BUNDLE,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  logLevel: 'warning',
})

// ── 2. jsdom 环境 ─────────────────────────────────────────────────────────
const { JSDOM } = await import(fromCheckout('jsdom', 'lib/api.js'))
// url 必填：jsdom 默认 about:blank 是 opaque origin，localStorage 会抛 SecurityError。
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
const { window } = dom
// jsdom 无 WAAPI：置顶动画路径只需存在即可（本测试走无动画路径）。
window.Element.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve() })
window.Element.prototype.getAnimations = () => []
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
for (const key of ['window', 'document', 'MutationObserver', 'Element', 'Node', 'HTMLElement', 'localStorage', 'StorageEvent']) {
  globalThis[key] = window[key]
}

// ── 3. 假侧边栏 DOM + 假服务 ───────────────────────────────────────────────
/** 会话表：两个工作区各 2 个会话，各自第一个置顶。 */
const SESSIONS = {
  's-a1': { displayTitle: 'A1 置顶', ws: 'ws-a' },
  's-a2': { displayTitle: 'A2', ws: 'ws-a' },
  's-b1': { displayTitle: 'B1 置顶', ws: 'ws-b' },
  's-b2': { displayTitle: 'B2', ws: 'ws-b' },
}
const PINNED = ['s-a1', 's-b1']
// 必须先播种：store 在模块加载时就从 localStorage 读一次置顶列表。
window.localStorage.setItem('dsh-webui.pinned.sessions', JSON.stringify(PINNED))

const { startSessionPin } = await import(pathToFileURL(BUNDLE).href)

const sessions = {
  list: {
    getSnapshot: () => ({
      ids: Object.keys(SESSIONS),
      byId: Object.fromEntries(Object.entries(SESSIONS).map(([id, s]) => [id, { displayTitle: s.displayTitle }])),
      current: 's-a2',
    }),
    subscribe: () => () => {},
  },
  open: () => {},
}
const workspaces = {
  list: {
    getSnapshot: () => ({
      items: [
        { workspaceId: 'ws-a', sessionIds: ['s-a1', 's-a2'] },
        { workspaceId: 'ws-b', sessionIds: ['s-b1', 's-b2'] },
      ],
      archivedSessionIds: [],
    }),
  },
  archiveSession: async () => {},
}
const ctx = { get: (name) => (name === 'sessions' ? sessions : name === 'workspaces' ? workspaces : undefined) }

/** 建一个分组（header + 会话行）；header 上挂假 fiber 供 groupKeyOf 解析。 */
function buildGroup(tree, key, sessionIds) {
  const group = window.document.createElement('div')
  group.className = 'ws_groupSection_abc'
  const header = window.document.createElement('div')
  header.className = 'ws_projectRow_abc'
  header['__reactFiber$test'] = { memoizedProps: { group: { key } }, return: null }
  group.appendChild(header)
  tree.appendChild(group)
  for (const id of sessionIds) addRow(group, id)
  return group
}

/** 往分组里加一行会话（HoverCard wrapper + sessionRow + rowActions + 假 fiber）。 */
function addRow(group, id) {
  const wrapper = window.document.createElement('div')
  const row = window.document.createElement('div')
  row.className = 'rows_sessionRow_abc'
  row['__reactFiber$test'] = { memoizedProps: { node: { id } }, return: null }
  const title = window.document.createElement('span')
  title.className = 'rows_title_abc'
  title.textContent = SESSIONS[id].displayTitle
  const actions = window.document.createElement('div')
  actions.className = 'rows_rowActions_abc'
  row.append(title, actions)
  wrapper.appendChild(row)
  group.appendChild(wrapper)
  return wrapper
}

const tree = window.document.createElement('div')
tree.setAttribute('role', 'tree')
window.document.body.appendChild(tree)
const groupA = buildGroup(tree, 'ws-a', ['s-a1', 's-a2'])
const groupB = buildGroup(tree, 'ws-b', ['s-b1', 's-b2'])

/** 补行标题序列（断言用）。 */
const surrogateTitles = (group) => Array.from(
  group.querySelectorAll('.dsp-pin-surrogate [data-role="title"]'),
).map(el => el.textContent)

/** 让 MutationObserver 回调（微任务）跑完，但不推进任何定时器。 */
const microtasks = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

let pass = 0
const ok = (name) => { pass += 1; console.log('  \u2713', name) }

console.log('session-pin 折叠置顶补行')
const stop = startSessionPin(ctx)

// 展开态：会话行都在 DOM 里 → 没有补行。
assert.deepEqual(surrogateTitles(groupA), [])
assert.deepEqual(surrogateTitles(groupB), [])
ok('展开态不注入补行')

// 折叠两个工作区：官方把组内会话行整批移出 DOM。
for (const wrapper of [...groupA.children, ...groupB.children]) {
  if (wrapper.querySelector('[class*="sessionRow"]') !== null) wrapper.remove()
}
await microtasks()

// 关键断言 1+2：两个分组都补上了，且没等 50ms 去抖（本处只跑了微任务）。
assert.deepEqual(surrogateTitles(groupA), ['A1 置顶'])
assert.deepEqual(surrogateTitles(groupB), ['B1 置顶'])
ok('折叠后两个分组在同一微任务内各自补行（无去抖空窗、不漏组）')

// 关键断言 3：位置被挤走时只搬不重建（同一节点实例，且回到 header 之后）。
const listA = groupA.querySelector('.dsp-pin-surrogates')
const rowA = listA.firstElementChild
groupA.appendChild(listA)
addRow(groupB, 's-b2')
await microtasks()
assert.equal(groupA.querySelector('.dsp-pin-surrogates'), listA, '容器被重建了（会闪）')
assert.equal(listA.firstElementChild, rowA, '补行被重建了（会闪）')
assert.equal(listA.previousElementSibling, groupA.querySelector('[class*="projectRow"]'), '容器未搬回 header 之后')
ok('位置漂移时原地搬回容器，不销毁重建')

// 展开回来：补行随之撤掉。
addRow(groupA, 's-a1')
addRow(groupA, 's-a2')
await microtasks()
assert.deepEqual(surrogateTitles(groupA), [])
ok('展开后撤掉补行')

// 停止：注入物清理干净。
stop()
assert.equal(window.document.querySelectorAll('.dsp-pin-surrogates, .dsp-pin-badge, .dsp-archive-btn').length, 0)
ok('停止后清理全部注入节点')

rmSync(TMP, { recursive: true, force: true })
console.log('\n' + pass + ' passed')
