/**
 * @dsh-external/dsh-browser — AI 浏览器操作插件（hybrid，合并进 webui）
 *
 * 核心设计（对齐 openhanako browser 工具）：
 * - 文本主感知：snapshot 注入 JS 遍历 DOM，给可交互元素标 data-dsh-ref，
 *   返回文本 ref 树给 LLM；每次操作后自动返回最新 snapshot。
 * - 真实输入：点击/悬停/输入/按键走 CDP Input 域真实事件，命中率高于合成事件。
 * - 操作后 DOM 静默检测（waitForSettle），拿到稳定快照，减少模型反复重试。
 * - 截图兜底：browser_screenshot 存文件返回路径，模型用 vision_describe
 *   （辅助视觉插件）看图。
 * - 会话隔离：每个会话（sessionId）独立 Edge/Chrome 实例 + 独立 user-data-dir，
 *   登录态/Cookie/页面完全隔离，互不干扰；默认无头（后台运行不弹窗口），画面经
 *   CDP screencast 内嵌到 Web GUI（client 侧），用户可直接在面板内操作页面。
 * - 零依赖：Node 24 原生 WebSocket 实现 CDP 客户端。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  CdpConnection,
  createPageSession,
  navigateAndWait,
  navigateHistory,
  waitForPageReady,
  captureScreenshot,
  setViewport,
  fetchBrowserWsUrl,
  evaluateJson,
  dispatchKey,
  dispatchMouseMove,
  dispatchMouseClick,
  insertText,
  startScreencast,
  ackScreencast,
  dispatchMouseWheel,
  dispatchMouseButton,
  type CdpSession,
} from './cdp.js'
import {
  resolveChromePath,
  launchChrome,
  killChrome,
  findFreePort,
  profileDirFor,
  DEFAULT_CHROME_CANDIDATES,
  type ChromeRuntime,
} from './chrome.js'
import {
  getSnapshot,
  clickRef,
  typeRef,
  hoverRef,
  selectRef,
  scrollPage,
  waitForSettle,
} from './snapshot.js'

type PluginContext = Context & Record<string, any>

export const name = '@dsh-external/dsh-browser'
export const inject = ['tools', 'webServer', 'fs', 'sandboxPolicy']

export interface Config {
  /** Chrome/Edge 可执行文件路径（空 = 自动探测常见路径） */
  chromePath: string
  /** CDP 起始端口（0 = 自动从 9222 起找空闲端口；每会话独立端口） */
  port: number
  /** 无头模式（默认开启：后台运行不弹窗口，画面经 screencast 内嵌到对话面板且可交互；关闭则弹独立 Edge/Chrome 窗口） */
  headless: boolean
  /** 截图输出目录（空 = Chrome profile 目录下 screenshots/） */
  screenshotDir: string
}

export const Config = z.object({
  chromePath: z.string().default(''),
  port: z.number().default(0),
  headless: z.boolean().default(true),
  screenshotDir: z.string().default(''),
})

const MAX_LOG = 200
const MAX_STEPS = 50
const NAV_TIMEOUT_MS = 30000
// 无头 Chrome 默认视口过小（约 800×600），网页会以小屏响应式渲染、截图也小；
// 这里统一设成桌面视口，保证网页正常渲染、画面清晰（宽高比 1.6，与面板接近）。
const VIEWPORT_WIDTH = 1440
const VIEWPORT_HEIGHT = 900
// 浏览器任务「engaged」判定：最后一次操作完成后，标识在 UI 上再保持这段时间，
// 覆盖 AI 连续操作之间的 LLM 思考间隔，避免「单次操作结束标识就跳没」的闪烁。
const ENGAGE_TIMEOUT_MS = 90_000
// 操作后 DOM 静默检测参数
const SETTLE_IDLE_MS = 250
const SETTLE_TIMEOUT_MS = 2000
// browser_see 视觉描述的默认提示词（聚焦「可操作」元素，服务网页操作场景）
const DEFAULT_SEE_PROMPT = '描述当前浏览器页面可见区域：整体布局（顶部导航/侧边栏/主内容区）、所有可见的按钮、输入框、链接及它们的文字，以及当前是否有弹窗/对话框。用于辅助网页操作，请具体到可点击/可输入元素，看不清就直说。'

/** 单个会话的浏览器运行态（CDP 连接 + 进程 + 截图目录）。 */
interface SessionBrowserState {
  runtime: ChromeRuntime | null
  conn: CdpConnection | null
  session: CdpSession | null
  screenshotDir: string
  lastScreenshotPath: string | null
  log: Array<{ ts: string; action: string; detail: string }>
  /** screencast 最新帧（内嵌面板实时画面 + 交互回传坐标基准）。rev 为递增帧号，供 client 增量拉取（无新帧返回 304）。 */
  frame: { data: string; width: number; height: number; ts: number; rev: number } | null
  /** screencast 帧事件订阅的取消函数。 */
  offFrame: (() => void) | null
}

/** 一次浏览器操作在时间线上的记录（供 Web GUI 内嵌面板展示）。 */
interface ActivityStep {
  seq: number
  tool: string
  /** 人类可读动作名，如「打开 URL」「点击元素」。 */
  label: string
  /** 指令内容摘要（参数），如 URL / ref=3 / 按键名。 */
  detail: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  finishedAt: number | null
  /** 结果/错误摘要。 */
  result: string
}

/** 每会话的浏览器活动时间线（活跃标记 + 最近操作）。 */
interface SessionActivity {
  active: boolean
  /** 最后一次浏览器操作完成的时间戳（用于「任务期间标识持续显示」的 engaged 判定）。 */
  lastActivityAt: number
  url: string
  title: string
  steps: ActivityStep[]
}

export function applyBrowser(ctx: PluginContext, config: Config): void {
  // 插件数据根目录（prefs/浏览器 profile 共用）
  const dataRoot = path.join(
    process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'),
    'plugin-data', 'dsh-browser',
  )
  const prefsFile = path.join(dataRoot, 'prefs.json')

  // ═══ 「允许 AI 使用浏览器」开关（默认开启，持久化）+ 无头模式（默认开 = 后台不弹窗）═══
  let allowBrowser = true
  let headlessMode = config.headless
  // 目标视口：固定桌面尺寸（不随屏幕分辨率放大，画面直接按此尺寸截图）。
  const viewportWidth = VIEWPORT_WIDTH
  const viewportHeight = VIEWPORT_HEIGHT
  function loadPrefs(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(prefsFile, 'utf8'))
      allowBrowser = parsed?.allowBrowser !== false
      if (typeof parsed?.headless === 'boolean') headlessMode = parsed.headless
    } catch { allowBrowser = true; headlessMode = config.headless }
  }
  function savePrefs(): void {
    try {
      fs.mkdirSync(dataRoot, { recursive: true })
      fs.writeFileSync(prefsFile, JSON.stringify({ allowBrowser, headless: headlessMode }, null, 2) + '\n')
    } catch { /* 持久化失败不影响运行 */ }
  }
  loadPrefs()

  // ═══ 会话隔离：sessionId → 独立浏览器运行态 + 活动时间线 ═══
  const sessions = new Map<string, SessionBrowserState>()
  const activity = new Map<string, SessionActivity>()
  let seqCounter = 0

  function ensureState(sessionId: string): SessionBrowserState {
    let st = sessions.get(sessionId)
    if (!st) {
      st = { runtime: null, conn: null, session: null, screenshotDir: '', lastScreenshotPath: null, log: [], frame: null, offFrame: null }
      sessions.set(sessionId, st)
    }
    return st
  }

  function ensureActivity(sessionId: string): SessionActivity {
    let act = activity.get(sessionId)
    if (!act) {
      act = { active: false, lastActivityAt: 0, url: '', title: '', steps: [] }
      activity.set(sessionId, act)
    }
    return act
  }

  /** 从工具执行上下文解析当前会话 id（agent.id === session.id）。 */
  function sessionIdOf(exec: any): string {
    const id = exec?.agent?.id ?? exec?.agent?.session?.id
    return id != null && String(id) !== '' ? String(id) : 'default'
  }

  /** 记录一次操作开始，返回其 step 句柄。 */
  function beginActivity(sessionId: string, tool: string, label: string, detail: string): ActivityStep {
    const act = ensureActivity(sessionId)
    const step: ActivityStep = {
      seq: ++seqCounter, tool, label, detail,
      status: 'running', startedAt: Date.now(), finishedAt: null, result: '',
    }
    act.steps.push(step)
    if (act.steps.length > MAX_STEPS) act.steps.splice(0, act.steps.length - MAX_STEPS)
    act.active = true
    return step
  }

  /** 记录一次操作结束（done/error），并重算活跃标记。只允许从 running 结束，避免 finally 覆盖 catch 已标记的 error。 */
  function finishActivity(sessionId: string, step: ActivityStep, status: 'done' | 'error', result = ''): void {
    if (step.status !== 'running') return
    step.status = status
    step.finishedAt = Date.now()
    if (result) step.result = String(result).slice(0, 200)
    const act = activity.get(sessionId)
    if (act) {
      act.active = act.steps.some(s => s.status === 'running')
      act.lastActivityAt = Date.now()
    }
  }

  function log(sessionId: string, action: string, detail = ''): void {
    const st = ensureState(sessionId)
    st.log.push({ ts: new Date().toISOString(), action, detail: String(detail).slice(0, 200) })
    if (st.log.length > MAX_LOG) st.log.splice(0, st.log.length - MAX_LOG)
  }

  // ═══ 浏览器工具门禁：开关关闭时拦截全部 browser_* 调用 ═══
  ctx.effect(() => ctx.on('tools/pre-execute', async (exec: any, next: any) => {
    if (typeof exec?.name === 'string' && exec.name.startsWith('browser_') && !allowBrowser) {
      return { kind: 'deny', reason: '浏览器使用已被用户禁用（可在对话面板开关中开启）' }
    }
    return next()
  }), '@dsh-external/dsh-browser: allow gate')

  // ═══ 生命周期：启动 / 停止 / 状态（按会话）═══

  async function startBrowserFor(sessionId: string): Promise<any> {
    const st = ensureState(sessionId)
    if (st.conn?.connected && st.session) {
      return { ok: true, alreadyRunning: true, ...(await statusFieldsFor(sessionId)) }
    }
    // 进程真实存活判定：exitCode === null 表示还在跑（proc.killed 是本地标记，进程可能已被外部关闭）
    const procAlive = !!st.runtime && st.runtime.proc.exitCode === null && !st.runtime.proc.killed
    if (procAlive) {
      // 进程活着但连接断了：重连
      if (st.conn) { try { st.conn.close() } catch {} }
      st.conn = null
    } else {
      const chromePath = config.chromePath || resolveChromePath(DEFAULT_CHROME_CANDIDATES)
      const port = await findFreePort(config.port || 9222)
      const profileDir = profileDirFor(path.join(dataRoot, 'profiles'), sessionId)
      const runtime = launchChrome(chromePath, profileDir, port, headlessMode)
      st.runtime = runtime
      st.screenshotDir = config.screenshotDir || path.join(profileDir, 'screenshots')
      fs.mkdirSync(st.screenshotDir, { recursive: true })
      log(sessionId, 'start', `${chromePath} port=${port} headless=${headlessMode}`)
    }

    // 等待 CDP 就绪并连接
    const wsUrl = await fetchBrowserWsUrl(st.runtime!.port, 15000)
    const conn = new CdpConnection(wsUrl)
    await conn.connect(10000)
    st.conn = conn
    const session = await createPageSession(conn)
    await setViewport(session, viewportWidth, viewportHeight)
    st.session = session
    // 启动 screencast：Chrome 持续推送页面帧（仅变化时），供内嵌面板实时展示 +
    // 交互回传（面板内鼠标/键盘/滚轮直接操作页面）。失败不阻塞浏览器可用性。
    try {
      await startScreencast(session, viewportWidth, viewportHeight, 85)
      st.offFrame = conn.on('Page.screencastFrame', (p: any) => {
        if (!p || typeof p.data !== 'string' || p.sessionId !== session.sessionId) return
        // 逐帧 ack（CDP 要求，否则会暂停推送）
        if (typeof p.screencastSessionId === 'number') {
          ackScreencast(session, p.screencastSessionId).catch(() => {})
        }
        const meta = p.metadata || {}
        st.frame = {
          data: p.data,
          width: Number(meta.deviceWidth) || viewportWidth,
          height: Number(meta.deviceHeight) || viewportHeight,
          ts: Date.now(),
          rev: (st.frame?.rev ?? 0) + 1,
        }
      })
    } catch (e: any) {
      log(sessionId, 'screencast-error', String(e?.message || e))
    }
    log(sessionId, 'ready', wsUrl)
    return { ok: true, ...(await statusFieldsFor(sessionId)) }
  }

  async function stopBrowserFor(sessionId: string): Promise<any> {
    const st = sessions.get(sessionId)
    if (!st) return { ok: true, running: false }
    if (st.offFrame) { try { st.offFrame() } catch {} }
    st.offFrame = null
    st.frame = null
    if (st.conn) { try { st.conn.close() } catch {} }
    st.conn = null
    st.session = null
    killChrome(st.runtime)
    st.runtime = null
    log(sessionId, 'stop', 'browser closed')
    return { ok: true, running: false }
  }

  async function requireSession(sessionId: string): Promise<CdpSession> {
    const st = ensureState(sessionId)
    if (!st.conn?.connected || !st.session) {
      await startBrowserFor(sessionId)
    }
    if (!st.conn?.connected || !st.session) {
      throw new Error('浏览器未就绪，请先调用 browser_start')
    }
    return st.session
  }

  /** 获取快照并把 url/title 回填到该会话活动（供内嵌面板显示）。 */
  async function snapshotFor(session: CdpSession, sessionId: string) {
    const snap = await getSnapshot(session)
    const act = ensureActivity(sessionId)
    act.url = snap.url
    act.title = snap.title
    return snap
  }

  async function statusFieldsFor(sessionId: string): Promise<any> {
    const st = ensureState(sessionId)
    const running = !!st.runtime && !st.runtime.proc.killed && !!st.conn?.connected
    let url = ''
    let title = ''
    let refCount = 0
    if (running && st.session) {
      try {
        const snap = await getSnapshot(st.session)
        url = snap.url
        title = snap.title
        refCount = snap.refCount
        const act = ensureActivity(sessionId)
        act.url = url
        act.title = title
      } catch { /* 页面可能未加载完 */ }
    }
    return {
      running,
      url,
      title,
      refCount,
      port: st.runtime?.port ?? null,
      headless: headlessMode,
    }
  }

  /**
   * 操作后的统一收尾：等 DOM 静默（或等导航后的页面就绪），再返回最新快照。
   * 这是减少「快照陈旧 → 模型反复重试」的关键。
   */
  async function settleAndSnapshot(session: CdpSession, sessionId: string): Promise<{ snapshot: string; url: string; title: string; refCount: number; navigated: boolean }> {
    const st = await waitForSettle(session, SETTLE_IDLE_MS, SETTLE_TIMEOUT_MS)
    if (st.nav) {
      await waitForPageReady(session, NAV_TIMEOUT_MS)
    }
    const snap = await snapshotFor(session, sessionId)
    return {
      snapshot: snap.text,
      url: snap.url,
      title: snap.title,
      refCount: snap.refCount,
      navigated: st.nav,
    }
  }

  // ═══ 工具注册（ctx.effect：fiber dispose 自动注销）═══

  const tools = [
    defineTool({
      name: 'browser_start',
      description: '启动 AI 专用浏览器（每会话独立实例、登录态隔离，默认无头：后台运行，画面内嵌到对话面板且可交互操作）。AI 操作浏览器前第一步调用；重复调用返回当前状态。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(_args: unknown, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_start', '启动浏览器', '')
        try { return await startBrowserFor(sessionId) }
        catch (e: any) { finishActivity(sessionId, step, 'error', String(e?.message || e)); return { ok: false, error: String(e?.message || e) } }
        finally { finishActivity(sessionId, step, 'done') }
      },
    }),
    defineTool({
      name: 'browser_navigate',
      description: '在浏览器打开 URL 并等待加载（load + 网络空闲），返回页面 ref 树。',
      parameters: {
        url: { type: 'string', required: true, description: '要打开的网址（http/https）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { url: string }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const url = String(args.url).trim()
        const step = beginActivity(sessionId, 'browser_navigate', '打开 URL', url)
        try {
          if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http/https 地址')
          const session = await requireSession(sessionId)
          const info = await navigateAndWait(session, url, NAV_TIMEOUT_MS)
          const snap = await snapshotFor(session, sessionId)
          log(sessionId, 'navigate', url)
          return { ok: true, url: info.url, title: info.title, snapshot: snap.text }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_snapshot',
      description: '获取当前页面 ref 树：元素以 [ref] 定位。页面变化后 ref 失效，操作前先获取最新 snapshot。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(_args: unknown, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_snapshot', '读取页面快照', '')
        try {
          const session = await requireSession(sessionId)
          const snap = await snapshotFor(session, sessionId)
          return { ok: true, url: snap.url, title: snap.title, snapshot: snap.text }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_click',
      description: '点击页面元素（ref 来自最新 snapshot），返回操作后最新 snapshot。连续操作已知不变的页面时，可设 returnSnapshot=false 跳过快照以提速。',
      parameters: {
        ref: { type: 'number', required: true, description: 'snapshot 中的 [ref] 编号' },
        returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { ref: number; returnSnapshot?: boolean }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_click', '点击元素', `ref=${args.ref}`)
        try {
          const session = await requireSession(sessionId)
          await clickRef(session, Number(args.ref))
          log(sessionId, 'click', `ref=${args.ref}`)
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session, sessionId)) }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_type',
      description: '向输入框输入文本（ref 来自最新 snapshot）。对下拉框 select 也会按文本/值选择。返回操作后最新 snapshot；可设 returnSnapshot=false 跳过。',
      parameters: {
        ref: { type: 'number', required: true, description: 'snapshot 中的 [ref] 编号' },
        text: { type: 'string', required: true, description: '要输入的文本' },
        pressEnter: { type: 'boolean', description: '输入后按回车（提交表单/搜索），默认 false' },
        returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { ref: number; text: string; pressEnter?: boolean; returnSnapshot?: boolean }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_type', '输入文本', `ref=${args.ref} text=${String(args.text).slice(0, 40)}`)
        try {
          const session = await requireSession(sessionId)
          await typeRef(session, Number(args.ref), String(args.text), args.pressEnter === true)
          log(sessionId, 'type', `ref=${args.ref} enter=${!!args.pressEnter}`)
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session, sessionId)) }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_select',
      description: '在下拉框 select 中选择一个选项（按选项值或可见文本匹配）。ref 来自最新 snapshot。',
      parameters: {
        ref: { type: 'number', required: true, description: 'snapshot 中 select 元素的 [ref] 编号' },
        value: { type: 'string', required: true, description: '要选择的选项值或可见文本' },
        returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { ref: number; value: string; returnSnapshot?: boolean }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_select', '选择下拉项', `ref=${args.ref} value=${args.value}`)
        try {
          const session = await requireSession(sessionId)
          await selectRef(session, Number(args.ref), String(args.value))
          log(sessionId, 'select', `ref=${args.ref} value=${args.value}`)
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session, sessionId)) }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_hover',
      description: '将鼠标悬停到元素上（ref 来自最新 snapshot），用于触发 hover 菜单/下拉/提示。返回操作后最新 snapshot。',
      parameters: {
        ref: { type: 'number', required: true, description: 'snapshot 中的 [ref] 编号' },
        returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { ref: number; returnSnapshot?: boolean }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_hover', '悬停元素', `ref=${args.ref}`)
        try {
          const session = await requireSession(sessionId)
          await hoverRef(session, Number(args.ref))
          log(sessionId, 'hover', `ref=${args.ref}`)
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session, sessionId)) }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_press',
      description: '发送键盘按键（真实按键事件），如 Escape 关闭弹窗、Enter 确认、箭头键、以及 ctrl+a 等组合键。返回操作后最新 snapshot。',
      parameters: {
        key: { type: 'string', required: true, description: '按键名：Enter / Escape / Tab / Backspace / Delete / ArrowUp / ArrowDown / ArrowLeft / ArrowRight / Home / End / PageUp / PageDown，或单字符' },
        modifiers: { type: 'array', items: { type: 'string' }, description: '修饰键数组：ctrl / shift / alt / meta，如 ["ctrl"] 配 key="a" 表示 Ctrl+A' },
        returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { key: string; modifiers?: string[]; returnSnapshot?: boolean }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_press', '按键', `${(args.modifiers ?? []).join('+')}${(args.modifiers ?? []).length ? '+' : ''}${args.key}`)
        try {
          const session = await requireSession(sessionId)
          await dispatchKey(session, String(args.key), Array.isArray(args.modifiers) ? args.modifiers : [])
          log(sessionId, 'press', String(args.key))
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session, sessionId)) }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_scroll',
      description: '滚动当前页面，返回操作后最新 snapshot（滚动可能触发懒加载，会等 DOM 稳定）。',
      parameters: {
        direction: { type: 'string', required: true, description: 'up / down / left / right' },
        amount: { type: 'number', description: '滚动步数（默认 3）' },
        returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { direction: string; amount?: number; returnSnapshot?: boolean }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_scroll', '滚动页面', String(args.direction))
        try {
          const dir = String(args.direction)
          if (!['up', 'down', 'left', 'right'].includes(dir)) throw new Error('direction 须为 up/down/left/right')
          const session = await requireSession(sessionId)
          await scrollPage(session, dir as any, Number(args.amount) || 3)
          log(sessionId, 'scroll', dir)
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session, sessionId)) }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_back',
      description: '浏览器后退一页，返回新页面 snapshot。',
      parameters: {
        returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { returnSnapshot?: boolean }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_back', '后退', '')
        try {
          const session = await requireSession(sessionId)
          const info = await navigateHistory(session, -1)
          log(sessionId, 'back', info.url)
          if (args.returnSnapshot === false) return { ok: true, ...info }
          const snap = await snapshotFor(session, sessionId)
          return { ok: true, ...info, snapshot: snap.text }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_forward',
      description: '浏览器前进一页，返回新页面 snapshot。',
      parameters: {
        returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { returnSnapshot?: boolean }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_forward', '前进', '')
        try {
          const session = await requireSession(sessionId)
          const info = await navigateHistory(session, 1)
          log(sessionId, 'forward', info.url)
          if (args.returnSnapshot === false) return { ok: true, ...info }
          const snap = await snapshotFor(session, sessionId)
          return { ok: true, ...info, snapshot: snap.text }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_evaluate',
      description: '在页面执行 JavaScript 表达式并返回结果（JSON 序列化）。用于处理 ref 树定位不到的元素（弹窗、iframe、自定义控件）。',
      parameters: {
        expression: { type: 'string', required: true, description: '要执行的 JS 表达式，返回 JSON 可序列化的值' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { expression: string }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_evaluate', '执行 JS', String(args.expression).slice(0, 80))
        try {
          const session = await requireSession(sessionId)
          const value = await evaluateJson(session, String(args.expression))
          log(sessionId, 'evaluate', String(args.expression).slice(0, 120))
          return { ok: true, value }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_see',
      description: '截取当前页面并用辅助视觉模型描述画面，同时返回最新 ref 树。当 ref 树定位不到元素（图标按钮、canvas、验证码、复杂布局、无文本控件）或需要理解页面整体画面时使用，一步拿到「视觉描述 + 可操作 ref 树」。',
      parameters: {
        prompt: { type: 'string', description: '可选的视觉描述要求（默认聚焦可操作元素与布局）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { prompt?: string }, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_see', '查看画面', String(args.prompt || '').slice(0, 60))
        try {
          const session = await requireSession(sessionId)
          const st = ensureState(sessionId)
          const base64 = await captureScreenshot(session)
          const file = path.join(st.screenshotDir, `see-${Date.now()}.jpg`)
          fs.writeFileSync(file, Buffer.from(base64, 'base64'))
          st.lastScreenshotPath = file

          // 视觉描述：复用 vision-helper 暴露的 cordis 服务（未装则降级为纯 ref 树）
          let vision = ''
          let visionModel = ''
          let visionError = ''
          const describeFn: any = ctx.get('vision-describe')
          if (typeof describeFn === 'function') {
            try {
              const prompt = String(args.prompt || '').trim() || DEFAULT_SEE_PROMPT
              const res = await describeFn(file, prompt)
              if (res && res.ok && typeof res.text === 'string') {
                vision = res.text
                visionModel = res.model || ''
              } else {
                visionError = res && res.error ? String(res.error) : '视觉描述未返回文本'
              }
            } catch (e: any) {
              visionError = String(e?.message || e)
            }
          } else {
            visionError = '未检测到辅助视觉插件 dsh-vision-helper，仅返回 ref 树'
          }

          const snap = await snapshotFor(session, sessionId)
          log(sessionId, 'see', `vision=${vision ? 'ok' : 'fail'}`)
          const fileName = path.basename(file)
          return {
            ok: true,
            url: snap.url,
            title: snap.title,
            snapshot: snap.text,
            vision,
            visionModel,
            screenshot: file,
            imageUrl: `/api/dsh-browser/screenshot?sessionId=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(fileName)}`,
            ...(visionError ? { visionError } : {}),
          }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_screenshot',
      description: '截图保存为文件并返回路径。需要看页面画面（图表/验证码/布局）时，用 vision_describe 读取该路径。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(_args: unknown, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_screenshot', '截图', '')
        try {
          const session = await requireSession(sessionId)
          const st = ensureState(sessionId)
          const base64 = await captureScreenshot(session)
          const file = path.join(st.screenshotDir, `shot-${Date.now()}.jpg`)
          fs.writeFileSync(file, Buffer.from(base64, 'base64'))
          st.lastScreenshotPath = file
          log(sessionId, 'screenshot', file)
          const fileName = path.basename(file)
          return {
            ok: true,
            path: file,
            imageUrl: `/api/dsh-browser/screenshot?sessionId=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(fileName)}`,
            bytes: fs.statSync(file).size,
            hint: '如需看图内容，调用 vision_describe，image 参数传此路径',
          }
        } catch (e: any) {
          finishActivity(sessionId, step, 'error', String(e?.message || e))
          return { ok: false, error: String(e?.message || e) }
        } finally {
          finishActivity(sessionId, step, 'done')
        }
      },
    }),
    defineTool({
      name: 'browser_stop',
      description: '关闭当前会话的浏览器实例。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(_args: unknown, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        const step = beginActivity(sessionId, 'browser_stop', '关闭浏览器', '')
        try { return await stopBrowserFor(sessionId) }
        catch (e: any) { finishActivity(sessionId, step, 'error', String(e?.message || e)); return { ok: false, error: String(e?.message || e) } }
        finally { finishActivity(sessionId, step, 'done') }
      },
    }),
    defineTool({
      name: 'browser_status',
      description: '查询当前会话浏览器运行状态（运行中/URL/标题/元素数）。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(_args: unknown, exec: any): Promise<any> {
        const sessionId = sessionIdOf(exec)
        try { return { ok: true, ...(await statusFieldsFor(sessionId)) } }
        catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
  ]

  ctx.effect(() => {
    for (const tool of tools) ctx.tools.register(tool)
    return () => {
      // 插件卸载/重载时清理全部会话的浏览器进程
      for (const sessionId of [...sessions.keys()]) {
        const st = sessions.get(sessionId)
        if (!st) continue
        if (st.conn) { try { st.conn.close() } catch {} }
        killChrome(st.runtime)
        st.runtime = null
      }
      sessions.clear()
    }
  }, '@dsh-external/dsh-browser: tools')

  // ═══ UI 路由（供 client 面板）═══

  /** 解析请求 query 参数。 */
  function queryOf(req: any): URLSearchParams {
    try {
      return new URL(String(req.url || '/'), 'http://localhost').searchParams
    } catch { return new URLSearchParams() }
  }

  function json(res: any, status: number, payload: any): void {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: '/api/dsh-browser/active-sessions',
      handler: (_req: any, res: any) => {
        try {
          const now = Date.now()
          const sessionsList: any[] = []
          for (const [sessionId, act] of activity) {
            // 浏览器实例必须还在运行，且「正在操作」或「最近刚操作过」（engaged）。
            const st = sessions.get(sessionId)
            const running = !!st?.runtime && !st.runtime.proc.killed && !!st?.conn?.connected
            if (!running) continue
            const engaged = act.active || (now - act.lastActivityAt < ENGAGE_TIMEOUT_MS)
            if (!engaged) continue
            // 有进行中的操作优先；否则用最后一步（空闲时仍显示「上次在做什么」）。
            const live = act.steps.find(s => s.status === 'running') ?? act.steps[act.steps.length - 1]
            sessionsList.push({
              sessionId,
              active: act.active,
              engaged: true,
              url: act.url,
              title: act.title,
              tool: live?.tool ?? '',
              label: live?.label ?? '',
              detail: live?.detail ?? '',
              startedAt: live?.startedAt ?? null,
            })
          }
          json(res, 200, { ok: true, sessions: sessionsList })
        } catch (e: any) {
          json(res, 500, { ok: false, error: String(e?.message || e) })
        }
      },
    })
  }, '@dsh-external/dsh-browser: active-sessions route')

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: '/api/dsh-browser/session',
      handler: (req: any, res: any) => {
        try {
          const sessionId = queryOf(req).get('sessionId') || 'default'
          const act = activity.get(sessionId)
          const st = sessions.get(sessionId)
          json(res, 200, {
            ok: true,
            sessionId,
            active: act?.active ?? false,
            running: !!st?.runtime && !st.runtime.proc.killed && !!st?.conn?.connected,
            url: act?.url ?? '',
            title: act?.title ?? '',
            steps: act !== undefined ? act.steps.slice(-MAX_STEPS) : [],
          })
        } catch (e: any) {
          json(res, 500, { ok: false, error: String(e?.message || e) })
        }
      },
    })
  }, '@dsh-external/dsh-browser: session route')

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: '/api/dsh-browser/frame',
      handler: async (req: any, res: any) => {
        try {
          const sessionId = queryOf(req).get('sessionId') || 'default'
          const st = sessions.get(sessionId)
          if (!st?.conn?.connected || !st?.session) {
            json(res, 404, { ok: false, error: '浏览器未运行' })
            return
          }
          // 增量拉取：client 带上已收到的帧号 since；无新帧时返回 304 空体，
          // 避免每 150ms 全量下载+解码图片（静止页面的主要卡顿来源）。
          const since = Number(queryOf(req).get('since')) || 0
          if (st.frame !== null && since === st.frame.rev) {
            res.writeHead(304, { 'x-frame-rev': String(st.frame.rev) })
            res.end()
            return
          }
          // 优先返回 screencast 最新帧（实时、零截图开销）；无帧时回退截图。
          let data: Buffer
          let width = viewportWidth
          let height = viewportHeight
          let rev = 0
          if (st.frame !== null) {
            data = Buffer.from(st.frame.data, 'base64')
            width = st.frame.width
            height = st.frame.height
            rev = st.frame.rev
          } else {
            const base64 = await captureScreenshot(st.session)
            data = Buffer.from(base64, 'base64')
          }
          res.writeHead(200, {
            'content-type': 'image/jpeg',
            'cache-control': 'no-store',
            'x-frame-width': String(width),
            'x-frame-height': String(height),
            'x-frame-rev': String(rev),
          })
          res.end(data)
        } catch (e: any) {
          json(res, 500, { ok: false, error: String(e?.message || e) })
        }
      },
    })
  }, '@dsh-external/dsh-browser: frame route')

  // 交互回传：内嵌面板把用户鼠标/键盘/滚轮事件转发到 CDP Input 域，
  // 让无头浏览器也能在面板内「像真实浏览器一样」被直接操作。
  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: '/api/dsh-browser/input',
      handler: async (req: any, res: any) => {
        const respond = (status: number, payload: any) => {
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify(payload))
        }
        if (req.method !== 'POST') return respond(405, { ok: false, error: '仅支持 POST' })
        try {
          const body = await new Promise<any>((resolve) => {
            let raw = ''
            req.on('data', (chunk: any) => { raw += chunk })
            req.on('end', () => {
              try { resolve(JSON.parse(raw || '{}')) } catch { resolve(null) }
            })
            req.on('error', () => resolve(null))
          })
          if (!body || typeof body.sessionId !== 'string' || body.sessionId === '') {
            return respond(400, { ok: false, error: 'sessionId 缺失' })
          }
          const st = sessions.get(body.sessionId)
          if (!st?.conn?.connected || !st?.session) return respond(404, { ok: false, error: '浏览器未运行' })
          const session = st.session
          const x = Number(body.x)
          const y = Number(body.y)
          switch (body.type) {
            case 'mouse': {
              if (!Number.isFinite(x) || !Number.isFinite(y)) return respond(400, { ok: false, error: '坐标无效' })
              const button = body.button === 'right' ? 'right' : body.button === 'middle' ? 'middle' : 'left'
              if (body.event === 'move') await dispatchMouseMove(session, x, y)
              else if (body.event === 'down') await dispatchMouseButton(session, 'mousePressed', x, y, button)
              else if (body.event === 'up') await dispatchMouseButton(session, 'mouseReleased', x, y, button)
              else await dispatchMouseClick(session, x, y)
              break
            }
            case 'wheel':
              if (!Number.isFinite(x) || !Number.isFinite(y)) return respond(400, { ok: false, error: '坐标无效' })
              await dispatchMouseWheel(session, x, y, Number(body.deltaX) || 0, Number(body.deltaY) || 0)
              break
            case 'key':
              await dispatchKey(session, String(body.key || ''), Array.isArray(body.modifiers) ? body.modifiers.map(String) : [])
              break
            case 'text':
              await insertText(session, String(body.text || ''))
              break
            default:
              return respond(400, { ok: false, error: '未知输入类型' })
          }
          respond(200, { ok: true })
        } catch (e: any) {
          respond(500, { ok: false, error: String(e?.message || e) })
        }
      },
    })
  }, '@dsh-external/dsh-browser: input route')

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: '/api/dsh-browser/status',
      handler: async (req: any, res: any) => {
        try {
          const sessionId = queryOf(req).get('sessionId')
          if (sessionId) {
            const st = sessions.get(sessionId)
            if (!st) {
              json(res, 200, { ok: true, sessionId, running: false, url: '', title: '', refCount: 0, port: null, headless: headlessMode, log: [] })
              return
            }
            const body = JSON.stringify({ ok: true, sessionId, ...(await statusFieldsFor(sessionId)), log: st.log.slice(-10) })
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            res.end(body)
            return
          }
          // 无 sessionId：返回所有会话的汇总状态
          const all: any[] = []
          for (const id of sessions.keys()) {
            const st = sessions.get(id)
            if (!st) continue
            all.push({ sessionId: id, ...(await statusFieldsFor(id)), log: st.log.slice(-10) })
          }
          json(res, 200, { ok: true, sessions: all })
        } catch (e: any) {
          json(res, 500, { ok: false, error: String(e?.message || e) })
        }
      },
    })
  }, '@dsh-external/dsh-browser: status route')

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: '/api/dsh-browser/screenshot',
      handler: async (req: any, res: any) => {
        try {
          const sessionId = queryOf(req).get('sessionId') || 'default'
          const fileName = queryOf(req).get('file')
          const st = sessions.get(sessionId)
          let filePath: string | null = null
          if (fileName !== null && st !== undefined) {
            // 只接受纯 basename（防路径穿越），从该会话的截图目录读取指定文件。
            const base = path.basename(fileName)
            if (base === fileName) filePath = path.join(st.screenshotDir, base)
          } else if (st?.lastScreenshotPath) {
            filePath = st.lastScreenshotPath
          }
          if (!filePath || !fs.existsSync(filePath)) {
            json(res, 404, { ok: false, error: 'no screenshot yet' })
            return
          }
          const data = fs.readFileSync(filePath)
          res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' })
          res.end(data)
        } catch (e: any) {
          json(res, 500, { ok: false, error: String(e?.message || e) })
        }
      },
    })
  }, '@dsh-external/dsh-browser: screenshot route')

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: '/api/dsh-browser/allow',
      handler: async (req: any, res: any) => {
        const respond = (status: number, payload: any) => {
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify(payload))
        }
        try {
          if (req.method === 'POST') {
            // 读 body
            const body = await new Promise<any>((resolve) => {
              let data = ''
              req.on('data', (chunk: any) => { data += chunk })
              req.on('end', () => {
                try { resolve(JSON.parse(data || '{}')) } catch { resolve(null) }
              })
              req.on('error', () => resolve(null))
            })
            if (!body || typeof body.allow !== 'boolean') return respond(400, { ok: false, error: 'allow 须为布尔值' })
            allowBrowser = body.allow
            savePrefs()
            return respond(200, { ok: true, allow: allowBrowser })
          }
          respond(200, { ok: true, allow: allowBrowser })
        } catch (e: any) {
          respond(500, { ok: false, error: String(e?.message || e) })
        }
      },
    })
  }, '@dsh-external/dsh-browser: allow route')

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: '/api/dsh-browser/headless',
      handler: async (req: any, res: any) => {
        const respond = (status: number, payload: any) => {
          res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify(payload))
        }
        try {
          if (req.method === 'POST') {
            const body = await new Promise<any>((resolve) => {
              let data = ''
              req.on('data', (chunk: any) => { data += chunk })
              req.on('end', () => {
                try { resolve(JSON.parse(data || '{}')) } catch { resolve(null) }
              })
              req.on('error', () => resolve(null))
            })
            if (!body || typeof body.headless !== 'boolean') return respond(400, { ok: false, error: 'headless 须为布尔值' })
            headlessMode = body.headless
            savePrefs()
            // 切换模式：关闭全部已运行实例，下次按需用新模式启动。
            for (const sessionId of [...sessions.keys()]) {
              await stopBrowserFor(sessionId)
            }
            return respond(200, { ok: true, headless: headlessMode })
          }
          respond(200, { ok: true, headless: headlessMode })
        } catch (e: any) {
          respond(500, { ok: false, error: String(e?.message || e) })
        }
      },
    })
  }, '@dsh-external/dsh-browser: headless route')

  ctx.logger?.info?.('[dsh-browser] loaded (headless=' + headlessMode + ', port=' + config.port + ', per-session isolation)')
}
