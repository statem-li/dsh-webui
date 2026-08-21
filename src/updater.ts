/**
 * webui — DSH 壳管理与一键更新（自 dsh-updater 合并）。
 *
 * HTTP API：/api/dsh-updater/state | check | start | autoStart
 * - state：当前/远程版本、busy、上次更新结果、日志尾部、开机自启状态
 * - check：git fetch + 比较本地/远程版本（服务存活期间执行）
 * - start：写运行配置，分离式启动 updater.ps1（git pull → pnpm install → build → 重启壳子）
 * - autoStart：读写 HKCU Run 键（开机自动运行壳子 exe）
 * 附带：抑制 Web UI 原生右键菜单（壳子右键菜单成为唯一入口）。
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url))
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const RUN_DIR = join(DSH_HOME, 'dsh-updater')
const LOG_FILE = join(RUN_DIR, 'update.log')
const RESULT_FILE = join(RUN_DIR, 'last-result.json')
const PROGRESS_FILE = join(RUN_DIR, 'progress.json')
const CONFIG_FILE = join(RUN_DIR, 'run-config.json')
const SCRIPT_FILE = join(PKG_DIR, 'assets', 'updater.ps1')
const MAX_LOG_LINES = 50

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const RUN_VALUE = 'DeepSeekHarnessShell'

export const inject = ['webServer']

export interface UpdaterConfig {
  /** DSH 源码仓库目录（默认 = 服务 cwd，即 deepseek-harness）。 */
  dshDir?: string
  /** 壳子目录（找 dist\*.exe；默认 D:\AI\Dsh）。 */
  shellDir?: string
  /** git 可执行文件（默认 git）。 */
  gitPath?: string
}

function runCmd(bin: string, args: string[], cwd: string, timeoutMs = 120000): Promise<{ ok: boolean; code: number | string; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, {
      cwd,
      env: process.env,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, code: (err as any).code ?? 'error', stdout: String(stdout ?? ''), stderr: String(stderr ?? err.message) })
      } else {
        resolve({ ok: true, code: 0, stdout: String(stdout), stderr: String(stderr) })
      }
    })
  })
}

function git(gitBin: string, args: string[], cwd: string, timeoutMs?: number) {
  return runCmd(gitBin, args, cwd, timeoutMs)
}

/** 解析 git status --porcelain 一行，返回目标路径（重命名取新路径，处理引号包裹）。 */
function porcelainPath(line: string): string | null {
  // 形如 " M packages/a.ts"、"?? .gitignore"、"R  old -> new"
  const m = /^.. (.*)$/.exec(line)
  if (!m) return null
  let p = m[1]
  const arrow = p.indexOf(' -> ')
  if (arrow !== -1) p = p.slice(arrow + 4)
  if (p.startsWith('"') && p.endsWith('"')) {
    p = p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return p
}

/** 是否 DSH 源码路径：仅 apps/ 与 packages/ 下的文件计入本地改动数。 */
function isSourcePath(p: string): boolean {
  return p.startsWith('apps/') || p.startsWith('packages/')
}

function logTail(): string | null {
  try {
    if (!existsSync(LOG_FILE)) return null
    const lines = readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean)
    return lines.slice(-MAX_LOG_LINES).join('\n')
  } catch {
    return null
  }
}

function readResult(): unknown {
  try {
    if (!existsSync(RESULT_FILE)) return null
    return JSON.parse(readFileSync(RESULT_FILE, 'utf8'))
  } catch {
    return null
  }
}

function readProgress(): unknown {
  try {
    if (!existsSync(PROGRESS_FILE)) return null
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'))
  } catch {
    return null
  }
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk: any) => {
      data += chunk
      if (data.length > 65536) {
        req.destroy()
        resolve(null)
      }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

export function applyUpdater(ctx: any, config: UpdaterConfig = {}): void {
  const dshDir = config.dshDir || process.cwd()
  const shellDir = config.shellDir || 'D:\\AI\\Dsh'
  const gitBin = config.gitPath || 'git'
  const state: { busy: string | null; current: any; remote: any; error: string | null } = { busy: null, current: null, remote: null, error: null }

  // ---- 开机自启（HKCU Run 键）----
  function findShellExe(): string | null {
    try {
      const distDir = join(shellDir, 'dist')
      const exes = readdirSync(distDir).filter((f) => f.toLowerCase().endsWith('.exe'))
      if (exes.length === 0) return null
      exes.sort((a, b) => statSync(join(distDir, b)).mtimeMs - statSync(join(distDir, a)).mtimeMs)
      return join(distDir, exes[0])
    } catch {
      return null
    }
  }

  async function getAutoStart(): Promise<{ enabled: boolean; exePath: string | null }> {
    const exePath = findShellExe()
    const q = await runCmd('reg.exe', ['query', RUN_KEY, '/v', RUN_VALUE], process.cwd(), 10000)
    let enabled = false
    if (q.ok && /DeepSeekHarnessShell/.test(q.stdout)) {
      const m = q.stdout.match(/REG_SZ\s+(\S.*)$/m)
      enabled = !!(exePath && m && m[1].trim().replace(/^"|"$/g, '').toLowerCase() === exePath.toLowerCase())
    }
    return { enabled, exePath }
  }

  async function setAutoStart(enabled: boolean): Promise<{ ok: boolean; exePath?: string | null; message?: string }> {
    const exePath = findShellExe()
    if (!exePath) {
      return { ok: false, message: `未找到壳子 exe（${join(shellDir, 'dist')} 目录下没有 .exe），请先打包壳子` }
    }
    if (enabled) {
      const r = await runCmd('reg.exe', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', exePath, '/f'], process.cwd(), 10000)
      return r.ok ? { ok: true, exePath } : { ok: false, message: `写入注册表失败: ${(r.stderr || '').slice(0, 200)}` }
    }
    const r = await runCmd('reg.exe', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], process.cwd(), 10000)
    return r.ok ? { ok: true, exePath } : { ok: false, message: `删除注册表失败: ${(r.stderr || '').slice(0, 200)}` }
  }

  // ---- 检查更新 ----
  async function checkUpdate(): Promise<{ ok: boolean; message?: string }> {
    if (state.busy) return { ok: false, message: '已有任务在进行中' }
    state.busy = 'checking'
    state.error = null
    try {
      const branchRes = await git(gitBin, ['rev-parse', '--abbrev-ref', 'HEAD'], dshDir, 15000)
      const branch = branchRes.ok ? branchRes.stdout.trim() : 'master'

      const headRes = await git(gitBin, ['rev-parse', 'HEAD'], dshDir, 15000)
      if (!headRes.ok) {
        state.error = `git rev-parse HEAD 失败: ${headRes.stderr.slice(0, 300)}`
        return { ok: false, message: state.error }
      }
      const full = headRes.stdout.trim()

      const dateRes = await git(gitBin, ['log', '-1', '--format=%cd', '--date=short'], dshDir, 15000)
      const date = dateRes.ok ? dateRes.stdout.trim() : ''

      // 只统计「源码」改动：git status --porcelain 每行形如 "XY path"
      // （重命名/复制为 "R  old -> new"），取目标路径后仅保留 apps/ 与
      // packages/ 下的文件；根目录点文件（.gitignore 等）与临时脚本不算。
      const dirtyRes = await git(gitBin, ['status', '--porcelain'], dshDir, 15000)
      const dirty = dirtyRes.ok
        ? dirtyRes.stdout.split(/\r?\n/).filter(Boolean).map(porcelainPath).filter((p): p is string => !!p && isSourcePath(p)).length
        : 0

      state.current = { full, short: full.slice(0, 7), date, branch, dirty }

      const fetchRes = await git(gitBin, ['fetch', 'origin'], dshDir, 180000)
      if (!fetchRes.ok) {
        state.error = `git fetch 失败: ${fetchRes.stderr.slice(0, 400)}`
        return { ok: false, message: state.error }
      }

      const remoteRef = `origin/${branch}`
      const remoteRes = await git(gitBin, ['rev-parse', remoteRef], dshDir, 15000)
      if (!remoteRes.ok) {
        state.error = `无法解析远程分支 ${remoteRef}（本地可能没有该分支的跟踪）`
        state.remote = null
        return { ok: false, message: state.error }
      }
      const remoteFull = remoteRes.stdout.trim()

      const aheadRes = await git(gitBin, ['rev-list', '--count', `${full}..${remoteRef}`], dshDir, 15000)
      const ahead = aheadRes.ok ? Number(aheadRes.stdout.trim() || 0) : 0
      state.remote = { full: remoteFull, short: remoteFull.slice(0, 7), ahead, hasUpdate: remoteFull !== full }
      return { ok: true }
    } catch (err: any) {
      state.error = String(err?.message ?? err)
      return { ok: false, message: state.error }
    } finally {
      state.busy = null
    }
  }

  // ---- 启动更新 ----
  async function startUpdate(): Promise<{ ok: boolean; message: string }> {
    if (state.busy) return { ok: false, message: '已有任务在进行中' }
    if (!state.current || !state.remote) {
      const checked = await checkUpdate()
      if (!checked.ok) return checked as { ok: false; message: string }
    }
    if (!state.remote.hasUpdate) return { ok: false, message: '已是最新版本，无需更新' }
    try {
      mkdirSync(RUN_DIR, { recursive: true })
      writeFileSync(CONFIG_FILE, JSON.stringify({ dshDir, shellDir, logFile: LOG_FILE, resultFile: RESULT_FILE, progressFile: PROGRESS_FILE }, null, 2), 'utf8')
      try { writeFileSync(PROGRESS_FILE, JSON.stringify({ stage: 'queued', percent: 0, msg: '更新任务已排队，脚本即将启动' }), 'utf8') } catch { /* 忽略 */ }
      // 本机实测：child_process 的 stdio:'ignore'（无论 detached 与否）spawn 出的
      // 子进程「句柄已创建但从未执行」（无 error 事件、无任何落盘痕迹）；
      // 相对路径 exe（powershell.exe）在壳子精简 PATH 下也可能解析失败。
      // 可靠模式：绝对路径 + stdio:'inherit'（实测唯一能真正执行的组合）。
      // 更新脚本自身的 Log/Set-Progress 全部 try/catch，stdio 失效不影响执行。
      const cmdExe = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
      const psExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      // spawn 前先落盘诊断信息，若仍失败可从 progress.json 直接定位。
      try {
        writeFileSync(PROGRESS_FILE, JSON.stringify({
          stage: 'spawning', percent: 0,
          msg: `启动更新脚本（${cmdExe} → ${psExe}）…`,
          script: SCRIPT_FILE,
          config: CONFIG_FILE,
          at: new Date().toISOString(),
        }), 'utf8')
      } catch { /* 忽略 */ }
      const child = spawn(cmdExe, [
        '/d', '/c', 'start', '', '/b',
        psExe, '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', SCRIPT_FILE, '-ConfigFile', CONFIG_FILE,
      ], {
        stdio: 'inherit',
        windowsHide: true,
      })
      // spawn 失败（ENOENT/EPERM 等）时把错误写进进度文件，避免前端永远卡在 queued。
      child.on('error', (err: any) => {
        try {
          writeFileSync(PROGRESS_FILE, JSON.stringify({ stage: 'spawn-error', percent: 0, msg: `启动更新脚本失败: ${String(err?.message ?? err)}` }), 'utf8')
        } catch { /* 忽略 */ }
        state.busy = null
      })
      child.unref()
      state.busy = 'updating'
      return { ok: true, message: '更新已启动，服务即将重启' }
    } catch (err: any) {
      state.busy = null
      return { ok: false, message: `启动更新失败: ${String(err?.message ?? err)}` }
    }
  }

  // ---- HTTP 路由 ----
  const handlers: Record<string, (req: any) => Promise<any>> = {
    '/api/dsh-updater/state': async () => ({
      ok: true,
      busy: state.busy,
      dshDir,
      shellDir,
      current: state.current,
      remote: state.remote,
      error: state.error,
      lastResult: readResult(),
      progress: readProgress(),
      logTail: logTail(),
      autoStart: await getAutoStart(),
    }),
    '/api/dsh-updater/check': async (req) => {
      if (req.method !== 'POST') return null
      return checkUpdate()
    },
    '/api/dsh-updater/start': async (req) => {
      if (req.method !== 'POST') return null
      return startUpdate()
    },
    '/api/dsh-updater/autoStart': async (req) => {
      if (req.method !== 'POST') return null
      const body = await readBody(req)
      if (!body || typeof body.enabled !== 'boolean') {
        return { ok: false, message: '参数错误：需要 JSON body {"enabled": boolean}' }
      }
      return setAutoStart(body.enabled)
    },
  }

  for (const [path, fn] of Object.entries(handlers)) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req: any, res: any) => {
        try {
          const body = await fn(req)
          if (body === null) {
            res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
            return
          }
          const payload = JSON.stringify(body)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(payload)
        } catch (err: any) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, message: String(err?.message ?? err) }))
        }
      },
    }), `webui: updater ${path}`)
  }

  console.log(`[dsh-updater] mounted dshDir=${dshDir} shellDir=${shellDir} script=${SCRIPT_FILE}`)

  // 抑制 Web UI 页面里的原生右键菜单（输入框/文本域除外，保留复制粘贴）。
  ctx.effect(() => ctx.webServer.tapIndex((html: string) => {
    const tag = '<script>document.addEventListener("contextmenu",function(e){var t=e.target;if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable))return;e.preventDefault()},true)</script>'
    const headEnd = html.indexOf('</head>')
    return headEnd === -1 ? tag + html : html.slice(0, headEnd) + tag + html.slice(headEnd)
  }), 'webui: updater suppress native context menu')
}
