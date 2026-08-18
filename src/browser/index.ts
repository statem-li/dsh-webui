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
 * - 独立 Chrome 实例：专属 user-data-dir（登录态持久化），用户实时可见可交互。
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
  fetchBrowserWsUrl,
  evaluateJson,
  dispatchKey,
  type CdpSession,
} from './cdp.js'
import {
  resolveChromePath,
  launchChrome,
  killChrome,
  findFreePort,
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
  /** CDP 端口（0 = 自动从 9222 起找空闲端口） */
  port: number
  /** 无头模式 */
  headless: boolean
  /** 截图输出目录（空 = Chrome profile 目录下 screenshots/） */
  screenshotDir: string
}

export const Config = z.object({
  chromePath: z.string().default(''),
  port: z.number().default(0),
  headless: z.boolean().default(false),
  screenshotDir: z.string().default(''),
})

const MAX_LOG = 200
const NAV_TIMEOUT_MS = 30000
// 操作后 DOM 静默检测参数
const SETTLE_IDLE_MS = 250
const SETTLE_TIMEOUT_MS = 2000
// browser_see 视觉描述的默认提示词（聚焦「可操作」元素，服务网页操作场景）
const DEFAULT_SEE_PROMPT = '描述当前浏览器页面可见区域：整体布局（顶部导航/侧边栏/主内容区）、所有可见的按钮、输入框、链接及它们的文字，以及当前是否有弹窗/对话框。用于辅助网页操作，请具体到可点击/可输入元素，看不清就直说。'

interface BrowserState {
  runtime: ChromeRuntime | null
  conn: CdpConnection | null
  session: CdpSession | null
  screenshotDir: string
  lastScreenshotPath: string | null
  log: Array<{ ts: string; action: string; detail: string }>
}

export function applyBrowser(ctx: PluginContext, config: Config): void {
  // 插件数据根目录（prefs/浏览器 profile 共用）
  const dataRoot = path.join(
    process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'),
    'plugin-data', 'dsh-browser',
  )
  const prefsFile = path.join(dataRoot, 'prefs.json')

  // ═══ 「允许 AI 使用浏览器」开关（默认开启，持久化）═══
  let allowBrowser = true
  function loadPrefs(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(prefsFile, 'utf8'))
      allowBrowser = parsed?.allowBrowser !== false
    } catch { allowBrowser = true }
  }
  function savePrefs(): void {
    try {
      fs.mkdirSync(dataRoot, { recursive: true })
      fs.writeFileSync(prefsFile, JSON.stringify({ allowBrowser }, null, 2) + '\n')
    } catch { /* 持久化失败不影响运行 */ }
  }
  loadPrefs()

  const state: BrowserState = {
    runtime: null,
    conn: null,
    session: null,
    screenshotDir: '',
    lastScreenshotPath: null,
    log: [],
  }

  const log = (action: string, detail = ''): void => {
    state.log.push({ ts: new Date().toISOString(), action, detail: String(detail).slice(0, 200) })
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG)
  }

  // ═══ 浏览器工具门禁：开关关闭时拦截全部 browser_* 调用 ═══
  ctx.effect(() => ctx.on('tools/pre-execute', async (exec: any, next: any) => {
    if (typeof exec?.name === 'string' && exec.name.startsWith('browser_') && !allowBrowser) {
      return { kind: 'deny', reason: '浏览器使用已被用户禁用（可在对话面板开关中开启）' }
    }
    return next()
  }), '@dsh-external/dsh-browser: allow gate')

  // ═══ 生命周期：启动 / 停止 / 状态 ═══

  async function startBrowser(): Promise<any> {
    if (state.conn?.connected && state.session) {
      return { ok: true, alreadyRunning: true, ...(await statusFields()) }
    }
    // 进程真实存活判定：exitCode === null 表示还在跑（proc.killed 是本地标记，进程可能已被外部关闭）
    const procAlive = !!state.runtime && state.runtime.proc.exitCode === null && !state.runtime.proc.killed
    if (procAlive) {
      // 进程活着但连接断了：重连
      if (state.conn) { try { state.conn.close() } catch {} }
      state.conn = null
    } else {
      const chromePath = config.chromePath || resolveChromePath(DEFAULT_CHROME_CANDIDATES)
      const port = config.port || (await findFreePort(9222))
      const profileDir = path.join(dataRoot, 'profiles', 'default')
      const runtime = launchChrome(chromePath, profileDir, port, config.headless)
      state.runtime = runtime
      state.screenshotDir = config.screenshotDir || path.join(profileDir, 'screenshots')
      fs.mkdirSync(state.screenshotDir, { recursive: true })
      log('start', `${chromePath} port=${port} headless=${config.headless}`)
    }

    // 等待 CDP 就绪并连接
    const wsUrl = await fetchBrowserWsUrl(state.runtime!.port, 15000)
    const conn = new CdpConnection(wsUrl)
    await conn.connect(10000)
    state.conn = conn
    const session = await createPageSession(conn)
    state.session = session
    log('ready', wsUrl)
    return { ok: true, ...(await statusFields()) }
  }

  async function stopBrowser(): Promise<any> {
    if (state.conn) { try { state.conn.close() } catch {} }
    state.conn = null
    state.session = null
    killChrome(state.runtime)
    state.runtime = null
    log('stop', 'browser closed')
    return { ok: true, running: false }
  }

  async function requireSession(): Promise<CdpSession> {
    if (!state.conn?.connected || !state.session) {
      await startBrowser()
    }
    if (!state.conn?.connected || !state.session) {
      throw new Error('浏览器未就绪，请先调用 browser_start')
    }
    return state.session
  }

  async function statusFields(): Promise<any> {
    const running = !!state.runtime && !state.runtime.proc.killed && !!state.conn?.connected
    let url = ''
    let title = ''
    let refCount = 0
    if (running && state.session) {
      try {
        const snap = await getSnapshot(state.session)
        url = snap.url
        title = snap.title
        refCount = snap.refCount
      } catch { /* 页面可能未加载完 */ }
    }
    return {
      running,
      url,
      title,
      refCount,
      port: state.runtime?.port ?? null,
      headless: config.headless,
    }
  }

  /**
   * 操作后的统一收尾：等 DOM 静默（或等导航后的页面就绪），再返回最新快照。
   * 这是减少「快照陈旧 → 模型反复重试」的关键。
   */
  async function settleAndSnapshot(session: CdpSession): Promise<{ snapshot: string; url: string; title: string; refCount: number; navigated: boolean }> {
    const st = await waitForSettle(session, SETTLE_IDLE_MS, SETTLE_TIMEOUT_MS)
    if (st.nav) {
      await waitForPageReady(session, NAV_TIMEOUT_MS)
    }
    const snap = await getSnapshot(session)
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
      description: '启动 AI 专用 Chrome 实例（独立配置目录、登录态持久化）。AI 操作浏览器前第一步调用；重复调用返回当前状态。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(): Promise<any> {
        try { return await startBrowser() } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
    defineTool({
      name: 'browser_navigate',
      description: '在浏览器打开 URL 并等待加载（load + 网络空闲），返回页面 ref 树。',
      parameters: {
        url: { type: 'string', required: true, description: '要打开的网址（http/https）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { url: string }): Promise<any> {
        try {
          const session = await requireSession()
          const url = String(args.url).trim()
          if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http/https 地址')
          const info = await navigateAndWait(session, url, NAV_TIMEOUT_MS)
          const snap = await getSnapshot(session)
          log('navigate', url)
          return { ok: true, url: info.url, title: info.title, snapshot: snap.text }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
    defineTool({
      name: 'browser_snapshot',
      description: '获取当前页面 ref 树：元素以 [ref] 定位。页面变化后 ref 失效，操作前先获取最新 snapshot。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(): Promise<any> {
        try {
          const session = await requireSession()
          const snap = await getSnapshot(session)
          return { ok: true, url: snap.url, title: snap.title, snapshot: snap.text }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
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
      async execute(args: { ref: number; returnSnapshot?: boolean }): Promise<any> {
        try {
          const session = await requireSession()
          await clickRef(session, Number(args.ref))
          log('click', `ref=${args.ref}`)
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session)) }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
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
      async execute(args: { ref: number; text: string; pressEnter?: boolean; returnSnapshot?: boolean }): Promise<any> {
        try {
          const session = await requireSession()
          await typeRef(session, Number(args.ref), String(args.text), args.pressEnter === true)
          log('type', `ref=${args.ref} enter=${!!args.pressEnter}`)
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session)) }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
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
      async execute(args: { ref: number; value: string; returnSnapshot?: boolean }): Promise<any> {
        try {
          const session = await requireSession()
          await selectRef(session, Number(args.ref), String(args.value))
          log('select', `ref=${args.ref} value=${args.value}`)
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session)) }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
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
      async execute(args: { ref: number; returnSnapshot?: boolean }): Promise<any> {
        try {
          const session = await requireSession()
          await hoverRef(session, Number(args.ref))
          log('hover', `ref=${args.ref}`)
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session)) }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
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
      async execute(args: { key: string; modifiers?: string[]; returnSnapshot?: boolean }): Promise<any> {
        try {
          const session = await requireSession()
          await dispatchKey(session, String(args.key), Array.isArray(args.modifiers) ? args.modifiers : [])
          log('press', String(args.key))
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session)) }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
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
      async execute(args: { direction: string; amount?: number; returnSnapshot?: boolean }): Promise<any> {
        try {
          const dir = String(args.direction)
          if (!['up', 'down', 'left', 'right'].includes(dir)) throw new Error('direction 须为 up/down/left/right')
          const session = await requireSession()
          await scrollPage(session, dir as any, Number(args.amount) || 3)
          log('scroll', dir)
          if (args.returnSnapshot === false) return { ok: true }
          return { ok: true, ...(await settleAndSnapshot(session)) }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
    defineTool({
      name: 'browser_back',
      description: '浏览器后退一页，返回新页面 snapshot。',
      parameters: {
        returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { returnSnapshot?: boolean }): Promise<any> {
        try {
          const session = await requireSession()
          const info = await navigateHistory(session, -1)
          log('back', info.url)
          if (args.returnSnapshot === false) return { ok: true, ...info }
          const snap = await getSnapshot(session)
          return { ok: true, ...info, snapshot: snap.text }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
    defineTool({
      name: 'browser_forward',
      description: '浏览器前进一页，返回新页面 snapshot。',
      parameters: {
        returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { returnSnapshot?: boolean }): Promise<any> {
        try {
          const session = await requireSession()
          const info = await navigateHistory(session, 1)
          log('forward', info.url)
          if (args.returnSnapshot === false) return { ok: true, ...info }
          const snap = await getSnapshot(session)
          return { ok: true, ...info, snapshot: snap.text }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
    defineTool({
      name: 'browser_evaluate',
      description: '在页面执行 JavaScript 表达式并返回结果（JSON 序列化）。用于处理 ref 树定位不到的元素（弹窗、iframe、自定义控件）。',
      parameters: {
        expression: { type: 'string', required: true, description: '要执行的 JS 表达式，返回 JSON 可序列化的值' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { expression: string }): Promise<any> {
        try {
          const session = await requireSession()
          const value = await evaluateJson(session, String(args.expression))
          log('evaluate', String(args.expression).slice(0, 120))
          return { ok: true, value }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
    defineTool({
      name: 'browser_see',
      description: '截取当前页面并用辅助视觉模型描述画面，同时返回最新 ref 树。当 ref 树定位不到元素（图标按钮、canvas、验证码、复杂布局、无文本控件）或需要理解页面整体画面时使用，一步拿到「视觉描述 + 可操作 ref 树」。',
      parameters: {
        prompt: { type: 'string', description: '可选的视觉描述要求（默认聚焦可操作元素与布局）' },
      },
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(args: { prompt?: string }): Promise<any> {
        try {
          const session = await requireSession()
          const base64 = await captureScreenshot(session)
          const file = path.join(state.screenshotDir, `see-${Date.now()}.jpg`)
          fs.writeFileSync(file, Buffer.from(base64, 'base64'))
          state.lastScreenshotPath = file

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

          const snap = await getSnapshot(session)
          log('see', `vision=${vision ? 'ok' : 'fail'}`)
          return {
            ok: true,
            url: snap.url,
            title: snap.title,
            snapshot: snap.text,
            vision,
            visionModel,
            screenshot: file,
            ...(visionError ? { visionError } : {}),
          }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
    defineTool({
      name: 'browser_screenshot',
      description: '截图保存为文件并返回路径。需要看页面画面（图表/验证码/布局）时，用 vision_describe 读取该路径。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(): Promise<any> {
        try {
          const session = await requireSession()
          const base64 = await captureScreenshot(session)
          const file = path.join(state.screenshotDir, `shot-${Date.now()}.jpg`)
          fs.writeFileSync(file, Buffer.from(base64, 'base64'))
          state.lastScreenshotPath = file
          log('screenshot', file)
          return {
            ok: true,
            path: file,
            bytes: fs.statSync(file).size,
            hint: '如需看图内容，调用 vision_describe，image 参数传此路径',
          }
        } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
    defineTool({
      name: 'browser_stop',
      description: '关闭 AI 浏览器实例。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(): Promise<any> {
        try { return await stopBrowser() } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
    defineTool({
      name: 'browser_status',
      description: '查询浏览器运行状态（运行中/URL/标题/元素数）。',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
      async execute(): Promise<any> {
        try { return { ok: true, ...(await statusFields()) } } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
      },
    }),
  ]

  ctx.effect(() => {
    for (const tool of tools) ctx.tools.register(tool)
    return () => {
      // 插件卸载/重载时清理浏览器进程
      if (state.conn) { try { state.conn.close() } catch {} }
      killChrome(state.runtime)
      state.runtime = null
    }
  }, '@dsh-external/dsh-browser: tools')

  // ═══ UI 路由（供 client 面板）═══

  ctx.effect(() => {
    const webServer = ctx.webServer
    if (!webServer) return () => {}
    return webServer.register({
      kind: 'exact',
      path: '/api/dsh-browser/status',
      handler: async (_req: any, res: any) => {
        try {
          const body = JSON.stringify({ ok: true, ...(await statusFields()), log: state.log.slice(-10) })
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(body)
        } catch (e: any) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }))
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
      handler: async (_req: any, res: any) => {
        try {
          if (!state.lastScreenshotPath || !fs.existsSync(state.lastScreenshotPath)) {
            res.writeHead(404, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'no screenshot yet' }))
            return
          }
          const data = fs.readFileSync(state.lastScreenshotPath)
          res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' })
          res.end(data)
        } catch (e: any) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }))
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
            log('allow', String(allowBrowser))
            return respond(200, { ok: true, allow: allowBrowser })
          }
          respond(200, { ok: true, allow: allowBrowser })
        } catch (e: any) {
          respond(500, { ok: false, error: String(e?.message || e) })
        }
      },
    })
  }, '@dsh-external/dsh-browser: allow route')

  ctx.logger?.info?.('[dsh-browser] loaded (headless=' + config.headless + ', port=' + config.port + ')')
}
