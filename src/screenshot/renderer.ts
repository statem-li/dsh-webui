/**
 * webui — 截图渲染引擎（host 端）：常驻无头浏览器 + 串行渲染队列。
 *
 * 与旧实现的区别：不再「每次截图起一个 Edge/Chrome、截完杀掉」——那条路径每张
 * 图都要付 1.5~3s 的冷启动。这里维护一个常驻实例（固定 profile 目录，复用磁盘
 * 与字体缓存），首张图之后只剩导航 + 截图的开销；空闲超过 IDLE_TTL_MS 自动
 * 回收，插件卸载时一并关掉。
 *
 * 稳定性：连接/目标失效（用户手杀进程、Chrome 崩溃）时自动重建一次再试，不把
 * 首次失败直接抛给调用方；渲染串行化，避免多请求同时抢同一个 target。
 */
import { createGunzip } from 'node:zlib'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import {
  CdpConnection, captureScreenshot, createPageSession, evaluateJson,
  fetchBrowserWsUrl, navigateAndWait, setViewport, type CdpSession,
} from '../browser/cdp.js'
import {
  DEFAULT_CHROME_CANDIDATES, findFreePort, killChrome, launchChrome,
  resolveChromePath, type ChromeRuntime,
} from '../browser/chrome.js'
import { MERMAID_FILE, MERMAID_HOOK } from './card.js'

/**
 * 随包分发的 mermaid 引擎（预压缩，与前端 /dyn-assets/vendor 同一份资源）。
 *
 * 路径要兼容两种产物形态：tsdown 把 host 打成单文件 lib/index.js（`..` 即包根），
 * tsc 则保留目录结构 lib/screenshot/renderer.js（`../..` 才是包根）。
 */
const MERMAID_GZ = ((): string => {
  const candidates = [
    join(fileURLToPath(new URL('..', import.meta.url)), 'assets', 'vendor', 'mermaid.min.js.gz'),
    join(fileURLToPath(new URL('../..', import.meta.url)), 'assets', 'vendor', 'mermaid.min.js.gz'),
  ]
  return candidates.find(path => existsSync(path)) ?? candidates[0]!
})()
/** 图表渲染等待上限（引擎解析 + 画图；超时按现状截，不卡死截图）。 */
const MERMAID_WAIT_MS = 20000

/** 常驻实例空闲回收时长：这段时间没有新截图就关掉浏览器。 */
const IDLE_TTL_MS = 5 * 60_000
/** 长图高度上限（输出设备像素）：4K 档缩放更大，同一上限要按 scale 折算。 */
const MAX_DEVICE_HEIGHT = 28000

/** 渲染引擎运行时状态。 */
interface Engine {
  runtime: ChromeRuntime
  conn: CdpConnection
  session: CdpSession
  /** 该实例的工作目录（profile + 临时页面）。 */
  dir: string
}

let engine: Engine | null = null
let idleTimer: NodeJS.Timeout | null = null
let chain: Promise<unknown> = Promise.resolve()
/** 工作目录提供者（由 applyScreenshot 注入，指向 storages 下的 .engine）。 */
let baseDirProvider: () => string = () => join(process.cwd(), '.dsh-shot-engine')

/**
 * 配置渲染引擎的工作目录。
 * @param baseDir - 返回工作目录绝对路径的函数（profile 与临时 HTML 落在这里）。
 */
export function configureRenderer(baseDir: () => string): void {
  baseDirProvider = baseDir
}

/** 重置空闲回收计时（每次渲染后调用）。 */
function touchIdle(): void {
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { void shutdownRenderer() }, IDLE_TTL_MS)
  // 不阻塞进程退出：空闲回收只为省内存，不该拖住 DSH 关停。
  idleTimer.unref?.()
}

/** 关闭常驻实例（幂等；空闲回收与插件卸载共用）。 */
export async function shutdownRenderer(): Promise<void> {
  if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null }
  const current = engine
  engine = null
  if (current === null) return
  try { current.conn.close() } catch { /* 已断开 */ }
  killChrome(current.runtime, true)
  await rm(join(current.dir, 'page'), { recursive: true, force: true }).catch(() => {})
}

/** 启动一个新的常驻实例。 */
async function launch(): Promise<Engine> {
  const chromePath = resolveChromePath(DEFAULT_CHROME_CANDIDATES)
  const port = await findFreePort(9400)
  const dir = baseDirProvider()
  const profileDir = join(dir, 'profile')
  await mkdir(profileDir, { recursive: true })
  const runtime = launchChrome(chromePath, profileDir, port, ['--headless=new', '--disable-gpu', '--hide-scrollbars'])
  try {
    const wsUrl = await fetchBrowserWsUrl(port, 20000)
    const conn = new CdpConnection(wsUrl)
    await conn.connect(10000)
    const session = await createPageSession(conn, 'about:blank')
    return { runtime, conn, session, dir }
  } catch (error) {
    killChrome(runtime, true)
    throw error
  }
}

/** 取得可用实例：已存在且连接健康则复用，否则重建。 */
async function ensureEngine(): Promise<Engine> {
  if (engine !== null && engine.conn.connected) return engine
  await shutdownRenderer()
  engine = await launch()
  return engine
}

/** 页面稳定脚本：字体就绪 + 图片解码完成（最多等 waitMs，超时按现状截）。 */
function settleJs(waitMs: number): string {
  return `(async () => {
  const deadline = Date.now() + ${waitMs};
  try { await document.fonts.ready } catch (e) {}
  await Promise.all(Array.from(document.images).map((img) => {
    if (img.complete) return null;
    return new Promise((resolve) => {
      const done = () => resolve(null);
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, Math.max(0, deadline - Date.now()));
    });
  }));
  return true;
})()`
}

/** 测量文档内容高度（CSS px）。 */
async function measureHeight(session: CdpSession): Promise<number> {
  const value = await evaluateJson(
    session,
    'Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)',
    false,
  )
  return Math.round(Number(value)) || 0
}

/** 渲染参数。 */
export interface RenderInput {
  html: string
  /** 布局视口宽度（CSS px）。 */
  width: number
  /** 起始视口高度（CSS px），内容更高时自动扩展成长图。 */
  height: number
  /** 输出缩放（deviceScaleFactor；缺省 2x）。 */
  scale?: number
  /** 正文含 mermaid 围栏：投放引擎文件并等图画完再截。 */
  needsMermaid?: boolean
}

/**
 * 把 mermaid 引擎解压到临时页面目录（页面用相对路径同目录加载）。
 * 已存在就复用 —— 常驻实例的 page 目录在两次截图之间不清理，解压只付一次
 * （~3.4MB 写盘）；引擎资源缺失时返回 false，页面回落成源码块。
 */
async function ensureMermaidAsset(pageDir: string): Promise<boolean> {
  const target = join(pageDir, MERMAID_FILE)
  if (existsSync(target)) return true
  if (!existsSync(MERMAID_GZ)) {
    console.warn('[webui-screenshot] mermaid asset missing, diagrams fall back to source:', MERMAID_GZ)
    return false
  }
  try {
    await pipeline(createReadStream(MERMAID_GZ), createGunzip(), createWriteStream(target))
    return true
  } catch (error) {
    console.warn('[webui-screenshot] mermaid asset unpack failed:', String((error as Error)?.message ?? error))
    await rm(target, { force: true }).catch(() => {})
    return false
  }
}

/**
 * 等页面里的图画完（card.ts 的引导脚本把整批渲染暴露成 window 上的 promise）。
 * 超时/异常都不抛：宁可截一张图没画完的，也不让截图整体失败。
 */
async function waitMermaid(session: CdpSession): Promise<void> {
  await evaluateJson(
    session,
    `(async () => {
  const hook = window.${MERMAID_HOOK};
  if (hook === undefined) return 'absent';
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), ${MERMAID_WAIT_MS}));
  const result = await Promise.race([Promise.resolve(hook).catch(() => 'failed'), timeout]);
  // 图是同步插进 DOM 的，但字体/布局要一帧才稳定。
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try { await document.fonts.ready } catch (error) {}
  return result;
})()`,
    true,
  ).catch(() => null)
}

/** 一次渲染（内部：假定已在串行队列内、实例已就绪）。 */
async function renderOnce(target: Engine, input: RenderInput): Promise<string> {
  const scale = input.scale ?? 2
  // 高度上限按缩放折算成 CSS px，保证输出设备像素不超 Chromium 合成限制。
  const maxCssHeight = Math.min(16000, Math.floor(MAX_DEVICE_HEIGHT / scale))
  const pageDir = join(target.dir, 'page')
  await mkdir(pageDir, { recursive: true })
  if (input.needsMermaid === true) await ensureMermaidAsset(pageDir)
  const htmlFile = join(pageDir, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`)
  await writeFile(htmlFile, input.html, 'utf8')
  try {
    await setViewport(target.session, input.width, input.height, scale)
    await navigateAndWait(target.session, `file:///${htmlFile.replaceAll('\\', '/')}`, 20000)
    await evaluateJson(target.session, settleJs(3000), true).catch(() => null)
    // 图表要等引擎画完再量高度，否则测到的是源码块的高度（长图会被截断）。
    if (input.needsMermaid === true) await waitMermaid(target.session)
    // 内容比初始视口高时扩展视口截长图；扩展会触发重排，最多修正两轮。
    let cssHeight = input.height
    for (let round = 0; round < 2; round += 1) {
      const measured = await measureHeight(target.session)
      const next = Math.min(Math.max(measured, input.height), maxCssHeight)
      if (next === cssHeight) break
      cssHeight = next
      await setViewport(target.session, input.width, cssHeight, scale)
    }
    return await captureScreenshot(target.session, 100, 'png', true, 30000)
  } finally {
    await rm(htmlFile, { force: true }).catch(() => {})
  }
}

/**
 * 渲染 HTML 为 PNG（base64）。串行执行；实例失效时自动重建并重试一次。
 * @param input - HTML 与视口尺寸。
 * @returns PNG 的 base64 数据（不含 data: 前缀）。
 */
export function renderPng(input: RenderInput): Promise<string> {
  const task = async (): Promise<string> => {
    try {
      return await renderOnce(await ensureEngine(), input)
    } catch {
      // 实例可能已被外部杀掉或崩溃：整体重建一次再试，仍失败才上报。
      await shutdownRenderer()
      try {
        return await renderOnce(await ensureEngine(), input)
      } catch (retryError) {
        await shutdownRenderer()
        throw retryError instanceof Error ? retryError : new Error(String(retryError))
      }
    } finally {
      touchIdle()
    }
  }
  const run = chain.then(task, task)
  chain = run.catch(() => {})
  return run
}
