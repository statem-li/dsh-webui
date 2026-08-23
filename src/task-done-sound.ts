/**
 * webui — 任务完成提示音 + 对话完成桌面卡片（自 dsh-task-done-sound 合并）。
 *
 * - /dyn-assets/*.wav 前缀路由：从插件 assets 目录读取音频（新增提示音 =
 *   往 assets 放一个 .wav 即可）。
 * - POST /api/task-done-sound/conversation-done：客户端回合结束时调用，
 *   启动 scripts/conversation-done-card.ps1（右下角卡片 + 提示音）。
 *   提示音由 host 端 PowerShell 播放（SoundPlayer），绕开浏览器 autoplay 拦截。
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url))
const CARD_SCRIPT = join(PKG_DIR, 'scripts', 'conversation-done-card.ps1')

export const inject = ['webServer']

export interface TaskDoneSoundConfig {
  /** wav 兜底目录（默认 D:\AI\Dsh\assets）。 */
  soundDir?: string
  /** 壳子目录（找 dist\*.exe 做卡片标题/点击目标；默认 D:\AI\Dsh）。 */
  shellDir?: string
  /** false 时禁用卡片（仅保留 /dyn-assets 音频服务）。 */
  cardEnabled?: boolean
}

export function applyTaskDoneSound(ctx: any, config: TaskDoneSoundConfig = {}): void {
  const soundDir = config.soundDir || 'D:\\AI\\Dsh\\assets'
  const shellDir = config.shellDir || 'D:\\AI\\Dsh'
  const extraFallbacks: Record<string, string[]> = {
    'task-done.wav': ['C:\\Users\\Anti\\.hanako\\plugins\\voice-announcer\\assets\\task-done.wav'],
  }
  const cache = new Map<string, Buffer | null>()

  function loadAsset(name: string): Buffer | null {
    if (cache.has(name)) return cache.get(name) ?? null
    const path = findAssetPath(name)
    const bytes = path === null ? null : readFileSync(path)
    cache.set(name, bytes)
    return bytes
  }

  // 返回音频文件的实际路径（首个存在的源），供 host 端 PowerShell 直接播放。
  function findAssetPath(name: string): string | null {
    const sources = [join(PKG_DIR, 'assets', name), join(soundDir, name), ...(extraFallbacks[name] || [])]
    for (const path of sources) {
      try {
        if (existsSync(path) && statSync(path).size > 0) return path
      } catch (error) {
        console.error(`[dsh-task-done-sound] stat failed at ${path}:`, error)
      }
    }
    return null
  }

  // 找壳子 exe（dist 目录下最新的 .exe，与 dsh-updater 同款逻辑）。
  function findShellExe(): string | null {
    try {
      const distDir = join(shellDir, 'dist')
      if (!existsSync(distDir)) return null
      const exes = readdirSync(distDir).filter(f => f.toLowerCase().endsWith('.exe'))
      if (exes.length === 0) return null
      exes.sort((a, b) => statSync(join(distDir, b)).mtimeMs - statSync(join(distDir, a)).mtimeMs)
      return join(distDir, exes[0])
    } catch (error) {
      console.error('[dsh-task-done-sound] findShellExe failed:', error)
      return null
    }
  }

  // 与 ps1 同一份 conversation-card.log 的 host 侧写入：spawn 到 ps1 的失败也留痕。
  function appendCardLog(line: string): void {
    try {
      appendFileSync(join(shellDir, 'conversation-card.log'), `[${new Date().toISOString()}] ${line}\n`)
    } catch { /* 日志失败不影响功能 */ }
  }

  // 右下角「对话完成」卡片（分离进程，不阻塞服务）；soundPath 非空时同步播放提示音。
  function spawnCard({ sound = true, sessionLabel = '', sessionId = null }: { sound?: boolean; sessionLabel?: string; sessionId?: string | null } = {}): void {
    try {
      if (!existsSync(CARD_SCRIPT)) {
        console.error('[dsh-task-done-sound] card script missing:', CARD_SCRIPT)
        appendCardLog(`host ERROR: card script missing: ${CARD_SCRIPT}`)
        return
      }
      const exePath = findShellExe()
      const title = exePath === null ? 'DeepSeek-Harness' : basename(exePath, '.exe')
      const soundPath = sound ? findAssetPath('task-done.wav') : null
      const iconPath = join(shellDir, 'assets', 'app-icon.png')
      const args = [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', CARD_SCRIPT,
        '-ExePath', exePath ?? '', '-Title', title, '-Message', '对话完成了',
      ]
      if (sessionLabel !== '') args.push('-SessionLabel', sessionLabel)
      if (existsSync(iconPath)) args.push('-IconPath', iconPath)
      if (soundPath !== null) args.push('-SoundPath', soundPath)
      // 不要用 detached:true —— powershell.exe + detached 会瞬间退出（cmd 不受影响）。
      const child = spawn('powershell.exe', args, { stdio: 'ignore', windowsHide: true })
      child.on('error', (err) => {
        console.error('[dsh-task-done-sound] spawn powershell errored:', err)
        appendCardLog(`host ERROR: spawn powershell errored: ${err.message}`)
      })
      child.unref()
      const who = sessionLabel !== '' ? sessionLabel : (sessionId ?? 'unknown')
      console.log(`[dsh-task-done-sound] conversation-done card spawned (exe=${exePath}, sound=${soundPath ?? 'off'}, session=${who})`)
    } catch (error: any) {
      console.error('[dsh-task-done-sound] spawn card failed:', error)
      appendCardLog(`host ERROR: spawn card failed: ${String(error?.message ?? error)}`)
    }
  }

  // 仅播放提示音（不弹卡片）：供审批/提问等交互提醒复用。PowerShell 播放，绕开浏览器 autoplay。
  function playSoundOnly(soundName = 'task-done.wav'): void {
    const soundPath = findAssetPath(soundName)
    if (soundPath === null) {
      console.warn(`[dsh-task-done-sound] playSoundOnly: sound not found: ${soundName}`)
      return
    }
    try {
      const escaped = soundPath.replace(/'/g, "''")
      const command = `Add-Type -AssemblyName System.Media; (New-Object System.Media.SoundPlayer '${escaped}').PlaySync()`
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { stdio: 'ignore', windowsHide: true })
      child.on('error', (err) => {
        console.error('[dsh-task-done-sound] playSoundOnly spawn errored:', err)
      })
      child.unref()
    } catch (error: any) {
      console.error('[dsh-task-done-sound] playSoundOnly failed:', String(error?.message ?? error))
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dyn-assets',
    handler: async (req: any, res: any) => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      const name = pathname.slice('/dyn-assets/'.length)
      if (name === '' || name.includes('/') || name.includes('\\') || !/^[A-Za-z0-9._-]+\.wav$/.test(name)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      const bytes = loadAsset(name)
      if (bytes === null) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
      })
      res.end(bytes)
    },
  }), 'webui: task-done-sound wav prefix route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/task-done-sound/conversation-done',
    handler: async (req: any, res: any) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
        return
      }
      let sound = true
      let sessionId: string | null = null
      let sessionTitle = ''
      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        if (chunks.length > 0) {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          if (parsed && typeof parsed.sound === 'boolean') sound = parsed.sound
          if (parsed && typeof parsed.sessionId === 'string' && parsed.sessionId !== '') sessionId = parsed.sessionId
          if (parsed && typeof parsed.title === 'string' && parsed.title !== '') sessionTitle = parsed.title
        }
      } catch (error) {
        // 非法 body 视为默认（开），不影响卡片
      }
      if (config.cardEnabled !== false) spawnCard({ sound, sessionLabel: sessionTitle, sessionId })
      else if (sound) playSoundOnly() // 卡片禁用时降级为仅提示音（2026-08 用户反馈桌面卡片烦人）
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: true, sound }))
    },
  }), 'webui: task-done-sound conversation-done route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/task-done-sound/play',
    handler: async (req: any, res: any) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
        return
      }
      let soundName = 'task-done.wav'
      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        if (chunks.length > 0) {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          if (parsed && typeof parsed.sound === 'string' && /^[A-Za-z0-9._-]+\.wav$/.test(parsed.sound)) soundName = parsed.sound
        }
      } catch (error) {
        // 非法 body 视为默认提示音
      }
      playSoundOnly(soundName)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: true, sound: soundName }))
    },
  }), 'webui: task-done-sound play route')

  console.log(`[dsh-task-done-sound] mounted: /dyn-assets/*.wav, /api/task-done-sound/conversation-done, /api/task-done-sound/play (shellDir=${shellDir})`)
}
