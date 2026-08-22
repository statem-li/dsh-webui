/**
 * webui — DSH 壳管理与一键更新（自 dsh-updater 合并）。
 *
 * HTTP API：/api/dsh-updater/state | check | start | autoStart
 * - state：当前/远程版本、busy、上次更新结果、日志尾部、开机自启状态
 * - check：git fetch + 比较本地/远程版本（服务存活期间执行）
 * - start：在本插件进程内直接执行更新（stash → git pull → pnpm install →
 *   pnpm build），每步写 progress/log 供前端轮询；完成后注册一个一次性
 *   Windows 计划任务（schtasks），由系统 Task Scheduler 杀掉 DSH 服务与
 *   壳子并重新拉起壳子 exe。重启不再依赖本进程 spawn 分离脚本——旧方案
 *   （cmd start /b + powershell）在本机会出现子进程"句柄已创建但从未执行"，
 *   导致进度永远停在 0。
 * - autoStart：读写 HKCU Run 键（开机自动运行壳子 exe）
 * 附带：抑制 Web UI 原生右键菜单（壳子右键菜单成为唯一入口）。
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url))
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const RUN_DIR = join(DSH_HOME, 'dsh-updater')
const LOG_FILE = join(RUN_DIR, 'update.log')
const RESULT_FILE = join(RUN_DIR, 'last-result.json')
const PROGRESS_FILE = join(RUN_DIR, 'progress.json')
const TASK_NAME = 'DSH-Updater-Restart'
const RESTART_FILE = join(RUN_DIR, 'restart-task.cmd')
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

/** pnpm 经 cmd.exe /c 间接调用：execFile 直接跑 pnpm.cmd 会被 Node 拒绝（.cmd 需 shell），cmd.exe 本体是可靠入口。 */
function pnpm(args: string[], cwd: string, timeoutMs: number) {
  const comspec = process.env.ComSpec || 'cmd.exe'
  return runCmd(comspec, ['/d', '/s', '/c', 'pnpm', ...args], cwd, timeoutMs)
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

function outTail(s: string, max = 4000): string {
  const t = (s || '').trim()
  return t.length > max ? '…' + t.slice(-max) : t
}

function appendLog(text: string): void {
  try { appendFileSync(LOG_FILE, text.trimEnd() + '\n', 'utf8') } catch { /* 日志失败不影响更新 */ }
}

function logResult(label: string, r: { ok: boolean; code: number | string; stdout: string; stderr: string }): void {
  const parts = [`[${label}] exit=${r.code}`]
  const out = outTail(r.stdout)
  if (out) parts.push(out)
  const err = (r.stderr || '').trim()
  if (err) parts.push('stderr: ' + outTail(err, 2000))
  appendLog(parts.join('\n'))
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

function writeResult(result: { ok: boolean; commit: string; stashed: boolean; error?: string }): void {
  try {
    writeFileSync(RESULT_FILE, JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2), 'utf8')
  } catch { /* 忽略 */ }
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
  // 壳子候选目录：配置的 shellDir\dist + 常见实际安装目录（D:\AI\DeepSeek Harness）。
  // dist 里可能是打包器 stub（启动后转手拉起安装目录的真壳子），所以两处都看，
  // 取修改时间最新的 exe。
  function shellExeCandidates(): string[] {
    const dirs = [join(shellDir, 'dist'), join('D:\\AI', 'DeepSeek Harness')]
    const found: string[] = []
    for (const dir of dirs) {
      try {
        const exes = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.exe'))
        for (const f of exes) found.push(join(dir, f))
      } catch { /* 目录不存在 */ }
    }
    found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    return found
  }

  function findShellExe(): string | null {
    return shellExeCandidates()[0] ?? null
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

  // ---- 进度上报（progress.json 供前端轮询，同时落日志）----
  function setProgress(stage: string, percent: number, msg: string): void {
    try {
      writeFileSync(PROGRESS_FILE, JSON.stringify({ stage, percent, msg, at: new Date().toISOString() }), 'utf8')
    } catch { /* 忽略 */ }
    appendLog(`progress: ${stage} ${percent}% ${msg}`)
  }

  // ---- 重启（Windows 计划任务；由系统执行，不依赖本进程存活）----
  // 任务脚本：等 HTTP 响应送达 → 杀 3080 服务（连同本插件宿主）→ 杀壳子 →
  // 重新拉起壳子 exe → 自删任务。用 ping 代替 timeout（timeout 在 stdin
  // 非控制台的计划任务环境里会报输入重定向错误）。
  async function scheduleRestart(): Promise<{ ok: boolean; message: string }> {
    const exePath = findShellExe()
    if (!exePath) {
      return { ok: false, message: `未找到壳子 exe（${join(shellDir, 'dist')} 或 D:\\AI\\DeepSeek Harness 下没有 .exe），无法自动重启` }
    }
    // 扫描运行中的壳子进程：按可执行文件路径前缀匹配候选目录（进程名可能
    // 带空格、可能与候选 exe 不同名，taskkill /IM 不可靠）。execFile 同步
    // 等待 powershell 输出，与 git 同款机制，非旧方案的分离 spawn。
    const dirs = [join(shellDir, 'dist'), join('D:\\AI', 'DeepSeek Harness')]
    const psScript = `$dirs=@('${dirs.join("','")}'); Get-CimInstance Win32_Process | ForEach-Object { $p = $_.ExecutablePath; if ($p) { $pl = $p.ToLower(); foreach ($d in $dirs) { if ($pl.StartsWith($d.ToLower())) { $_.ProcessId; break } } } }`
    const scan = await runCmd('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], RUN_DIR, 30000)
    logResult('shell scan', scan)
    const shellPids = scan.ok
      ? scan.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s))
      : []
    appendLog(`shell pids: ${shellPids.join(', ') || '(none running)'}`)
    const lines = [
      '@echo off',
      'rem DSH updater restart task (auto-generated by dsh-webui, do not edit)',
      'rem 等浏览器收到 HTTP 响应、更新进程写完状态文件',
      'ping -n 4 127.0.0.1 >nul',
      'rem 杀掉 3080 上的 DSH 服务（连同插件宿主一起结束）',
      "for /f \"tokens=5\" %%p in ('netstat -ano ^| findstr /C:\":3080 \" ^| findstr \"LISTENING\"') do taskkill /PID %%p /T /F >nul 2>&1",
      'rem 杀掉壳子 Electron 进程并重新拉起',
      ...shellPids.map((p) => `taskkill /PID ${p} /T /F >nul 2>&1`),
      'ping -n 3 127.0.0.1 >nul',
      `start "" "${exePath}"`,
      `schtasks /Delete /TN ${TASK_NAME} /F >nul 2>&1`,
    ]
    try {
      writeFileSync(RESTART_FILE, lines.join('\r\n') + '\r\n', 'utf8')
    } catch (err: any) {
      return { ok: false, message: `写入重启脚本失败: ${String(err?.message ?? err)}` }
    }
    const create = await runCmd('schtasks.exe', ['/Create', '/TN', TASK_NAME, '/TR', RESTART_FILE, '/SC', 'ONCE', '/ST', '00:00', '/F'], RUN_DIR, 15000)
    logResult('schtasks create', create)
    if (!create.ok) {
      return { ok: false, message: `注册重启计划任务失败: ${(create.stderr || create.stdout).trim().slice(0, 200)}` }
    }
    const run = await runCmd('schtasks.exe', ['/Run', '/TN', TASK_NAME], RUN_DIR, 15000)
    logResult('schtasks run', run)
    if (!run.ok) {
      return { ok: false, message: `触发重启计划任务失败: ${(run.stderr || run.stdout).trim().slice(0, 200)}` }
    }
    return { ok: true, message: exePath }
  }

  // ---- 执行更新（插件进程内直跑；成功结尾由计划任务重启服务）----
  async function runUpdate(stashed: boolean): Promise<void> {
    let pull = false
    let install = false
    let build = false
    try {
      // 1) git pull --ff-only
      setProgress('git-pull', 12, '正在拉取最新源码（git pull）…')
      const pullRes = await git(gitBin, ['pull', '--ff-only'], dshDir, 600000)
      logResult('git pull', pullRes)
      pull = pullRes.ok
      if (!pull) {
        throw new Error(`git pull 失败（exit=${pullRes.code}）: ${outTail(pullRes.stderr || pullRes.stdout, 400)}`)
      }
      setProgress('git-pull', 40, '源码拉取完成')

      // 2) pnpm install
      setProgress('install', 45, '正在安装依赖（pnpm install）…')
      const installRes = await pnpm(['install'], dshDir, 1800000)
      logResult('pnpm install', installRes)
      install = installRes.ok
      if (!install) {
        throw new Error(`pnpm install 失败（exit=${installRes.code}）: ${outTail(installRes.stderr || installRes.stdout, 400)}`)
      }
      setProgress('install', 70, '依赖安装完成')

      // 3) pnpm build
      setProgress('build', 75, '正在构建（pnpm build）…')
      const buildRes = await pnpm(['build'], dshDir, 1800000)
      logResult('pnpm build', buildRes)
      build = buildRes.ok
      if (!build) {
        throw new Error(`pnpm build 失败（exit=${buildRes.code}）: ${outTail(buildRes.stderr || buildRes.stdout, 400)}`)
      }
      setProgress('build', 90, '构建完成')

      // 4) 恢复本地改动
      if (stashed) {
        setProgress('stash-pop', 93, '正在恢复本地改动（stash pop）…')
        const popRes = await git(gitBin, ['stash', 'pop'], dshDir, 60000)
        logResult('git stash pop', popRes)
        if (!popRes.ok) appendLog('stash pop 有冲突，请手动处理（git stash list）')
      }

      // 5) 记录结果
      const commitRes = await git(gitBin, ['log', '-1', '--oneline'], dshDir, 15000)
      const commit = commitRes.ok ? commitRes.stdout.trim() : ''
      writeResult({ ok: true, commit, stashed })
      appendLog(`result: ok=true commit=${commit} stashed=${stashed}`)

      // 6) 计划任务重启（系统执行，本进程即将被杀）
      setProgress('restart', 96, '正在通过计划任务重启服务与壳子…')
      const restart = await scheduleRestart()
      if (!restart.ok) {
        state.error = `更新完成，但自动重启失败：${restart.message}。请手动重启壳子/服务后生效。`
        setProgress('restart-failed', 100, state.error)
        return
      }
      setProgress('done', 100, '更新完成，服务正在重启…')
      appendLog('==== dsh updater done ====')
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      state.error = msg
      writeResult({ ok: false, commit: '', stashed, error: msg })
      appendLog(`result: ok=false pull=${pull} install=${install} build=${build} error=${msg}`)
      setProgress('error', 100, `更新失败：${msg}`)
    } finally {
      state.busy = null
    }
  }

  // ---- 启动更新 ----
  function startUpdate(): { ok: boolean; message: string } {
    if (state.busy) return { ok: false, message: '已有任务在进行中' }
    if (!state.current || !state.remote || !state.remote.hasUpdate) {
      return { ok: false, message: '请先检查更新，确认有可用更新后再启动' }
    }
    state.busy = 'updating'
    state.error = null
    try { mkdirSync(RUN_DIR, { recursive: true }) } catch { /* 目录已存在 */ }
    appendLog('==== dsh updater start ====')
    setProgress('queued', 3, '更新任务已启动，正在准备…')

    // stash 判定与整个更新流程放到后台，HTTP 立即返回。
    void (async () => {
      let stashed = false
      try {
        const dirtyRes = await git(gitBin, ['status', '--porcelain'], dshDir, 15000)
        const dirty = dirtyRes.ok
          ? dirtyRes.stdout.split(/\r?\n/).filter(Boolean).map(porcelainPath).filter((p): p is string => !!p && isSourcePath(p)).length
          : 0
        if (dirty > 0) {
          setProgress('stash', 8, `工作区有 ${dirty} 处源码改动，正在自动暂存（stash）…`)
          const stashRes = await git(gitBin, ['stash', 'push', '-m', 'dsh-updater auto-stash'], dshDir, 60000)
          logResult('git stash push', stashRes)
          stashed = stashRes.ok
        }
      } catch { /* stash 判定失败不阻塞更新 */ }
      await runUpdate(stashed)
    })()

    return { ok: true, message: '更新已启动，完成后服务将自动重启' }
  }

  // ---- HTTP 路由 ----
  const handlers: Record<string, (req: any) => Promise<any> | any> = {
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

  console.log(`[dsh-updater] mounted dshDir=${dshDir} shellDir=${shellDir} (in-process update + schtasks restart)`)

  // 抑制 Web UI 页面里的原生右键菜单（输入框/文本域除外，保留复制粘贴）。
  ctx.effect(() => ctx.webServer.tapIndex((html: string) => {
    const tag = '<script>document.addEventListener("contextmenu",function(e){var t=e.target;if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable))return;e.preventDefault()},true)</script>'
    const headEnd = html.indexOf('</head>')
    return headEnd === -1 ? tag + html : html.slice(0, headEnd) + tag + html.slice(headEnd)
  }), 'webui: updater suppress native context menu')
}
