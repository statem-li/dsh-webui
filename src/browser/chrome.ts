/**
 * Chrome 进程管理：启动独立实例（固定 user-data-dir、自动端口探测）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export const DEFAULT_CHROME_CANDIDATES: string[] = [
  process.env.CHROME_PATH || '',
  // Edge 优先（用户偏好：不想用 Chrome；CDP 兼容，行为一致）。
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

export function resolveChromePath(candidates: string[]): string {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  throw new Error(
    `未找到 Chrome/Edge：请通过插件配置 chromePath 指定（已尝试：${candidates.join(', ')}）`,
  )
}

/** 探测空闲端口（从 base 开始） */
export async function findFreePort(base = 9222, maxTries = 20): Promise<number> {
  for (let p = base; p < base + maxTries; p++) {
    if (await isPortFree(p)) return p
  }
  throw new Error(`端口 ${base}~${base + maxTries} 均被占用`)
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

export interface ChromeRuntime {
  proc: ChildProcess
  port: number
  profileDir: string
}

/**
 * 预写 profile 的窗口位置为屏幕外：Edge/Chrome 启动时先按 profile 保存的
 * window placement 创建窗口，CDP 定位要等连接后才执行——这个间隙窗口会在
 * 桌面闪现。启动前直接改 Preferences 里的 placement，让第一帧就在屏幕外。
 */
function presetOffscreenPlacement(profileDir: string): void {
  try {
    const prefsPath = path.join(profileDir, 'Default', 'Preferences')
    let prefs: any = {}
    if (fs.existsSync(prefsPath)) {
      try { prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) } catch { prefs = {} }
    } else {
      fs.mkdirSync(path.dirname(prefsPath), { recursive: true })
    }
    prefs.browser = prefs.browser || {}
    prefs.browser.window_placement = {
      left: -32000,
      top: -32000,
      right: -29440,
      bottom: -30560,
      maximized: false,
      work_area_left: 0,
      work_area_top: 0,
      work_area_right: 2560,
      work_area_bottom: 1400,
    }
    fs.writeFileSync(prefsPath, JSON.stringify(prefs))
  } catch { /* 预置失败不影响功能，仅可能首次启动闪现 */ }
}

/**
 * 启动 Chrome（有头渲染；默认定位屏幕外，由调用方决定何时贴到界面锚点）。
 * 幂等由调用方保证（port/profile 检查）。
 * @param chromePath Chrome 可执行文件路径
 * @param profileDir 独立用户数据目录（cookies/登录态持久化）
 * @param port CDP 端口（调用方先 findFreePort）
 * @param args 附加参数（如 ['--app=about:blank']：无地址栏应用窗口，供内嵌贴合）
 */
export function launchChrome(
  chromePath: string,
  profileDir: string,
  port: number,
  args: string[] = [],
): ChromeRuntime {
  fs.mkdirSync(profileDir, { recursive: true })
  presetOffscreenPlacement(profileDir)
  const hasAppMode = args.some(a => a.startsWith('--app='))
  const flags = [
    `--remote-debugging-port=${port}`,
    `--remote-debugging-address=127.0.0.1`,
    `--remote-allow-origins=*`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    // 崩溃恢复气泡（「继续任务」）不弹。
    '--hide-crash-restore-bubble',
    // 有头渲染管线完整（GPU 合成，画质/速度与真实桌面浏览器一致）；初始定位到
    // 屏幕外不弹窗打扰，待前端抽屉展开后再由 CDP setWindowBounds 精确贴合到
    // 抽屉画面区（对齐 openhanako「内置浏览器」体验：原生渲染 + 原生输入）。
    '--window-position=-32000,-32000',
    // 注意：不加 --disable-backgrounding-occluded-windows / --disable-background-
    // timer-throttling——屏幕外无人观看时允许 Chromium 按 occlusion 自动节流视觉
    // 渲染与页面定时器（省 CPU/GPU，对齐 openhanako「不看不渲染」）；AI 的 CDP
    // 操作（DOM 快照/Input/截图）走协议层不受影响。仅保留渲染器优先级保护，
    // 防止 renderer 进程被降优先级拖慢 CDP 响应。
    '--disable-renderer-backgrounding',
    ...args,
    ...(hasAppMode ? [] : ['about:blank']),
  ]
  const proc = spawn(chromePath, flags, {
    stdio: 'ignore',
    windowsHide: false,
  })
  proc.on('error', (err) => {
    // spawn 失败（EXE 不存在等）由调用方等待就绪时捕获；这里只记录
    console.error(`[dsh-browser] chrome spawn error: ${err.message}`)
  })
  return { proc, port, profileDir }
}

export function killChrome(runtime: ChromeRuntime | null, force = false): void {
  if (!runtime) return
  const { proc } = runtime
  if (proc && !proc.killed) {
    try {
      if (force || process.platform === 'win32') proc.kill('SIGKILL')
      else proc.kill('SIGTERM')
    } catch { /* 已退出 */ }
  }
}

/** 根据 session 标识生成 profile 目录名 */
export function profileDirFor(rootDir: string, key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'default'
  return path.join(rootDir, safe)
}
