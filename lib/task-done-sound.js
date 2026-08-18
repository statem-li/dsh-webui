/**
 * webui — 任务完成提示音 + 对话完成桌面卡片（自 dsh-task-done-sound 合并）。
 *
 * - /dyn-assets/*.wav 前缀路由：从插件 assets 目录读取音频（新增提示音 =
 *   往 assets 放一个 .wav 即可）。
 * - POST /api/task-done-sound/conversation-done：客户端回合结束时调用，
 *   启动 scripts/conversation-done-card.ps1（右下角卡片 + 提示音）。
 *   提示音由 host 端 PowerShell 播放（SoundPlayer），绕开浏览器 autoplay 拦截。
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
const CARD_SCRIPT = join(PKG_DIR, 'scripts', 'conversation-done-card.ps1');
export const inject = ['webServer'];
export function applyTaskDoneSound(ctx, config = {}) {
    const soundDir = config.soundDir || 'D:\\AI\\Dsh\\assets';
    const shellDir = config.shellDir || 'D:\\AI\\Dsh';
    const extraFallbacks = {
        'task-done.wav': ['C:\\Users\\Anti\\.hanako\\plugins\\voice-announcer\\assets\\task-done.wav'],
    };
    const cache = new Map();
    function loadAsset(name) {
        if (cache.has(name))
            return cache.get(name) ?? null;
        const path = findAssetPath(name);
        const bytes = path === null ? null : readFileSync(path);
        cache.set(name, bytes);
        return bytes;
    }
    // 返回音频文件的实际路径（首个存在的源），供 host 端 PowerShell 直接播放。
    function findAssetPath(name) {
        const sources = [join(PKG_DIR, 'assets', name), join(soundDir, name), ...(extraFallbacks[name] || [])];
        for (const path of sources) {
            try {
                if (existsSync(path) && statSync(path).size > 0)
                    return path;
            }
            catch (error) {
                console.error(`[dsh-task-done-sound] stat failed at ${path}:`, error);
            }
        }
        return null;
    }
    // 找壳子 exe（dist 目录下最新的 .exe，与 dsh-updater 同款逻辑）。
    function findShellExe() {
        try {
            const distDir = join(shellDir, 'dist');
            if (!existsSync(distDir))
                return null;
            const exes = readdirSync(distDir).filter(f => f.toLowerCase().endsWith('.exe'));
            if (exes.length === 0)
                return null;
            exes.sort((a, b) => statSync(join(distDir, b)).mtimeMs - statSync(join(distDir, a)).mtimeMs);
            return join(distDir, exes[0]);
        }
        catch (error) {
            console.error('[dsh-task-done-sound] findShellExe failed:', error);
            return null;
        }
    }
    // 与 ps1 同一份 conversation-card.log 的 host 侧写入：spawn 到 ps1 的失败也留痕。
    function appendCardLog(line) {
        try {
            appendFileSync(join(shellDir, 'conversation-card.log'), `[${new Date().toISOString()}] ${line}\n`);
        }
        catch { /* 日志失败不影响功能 */ }
    }
    // 右下角「对话完成」卡片（分离进程，不阻塞服务）；soundPath 非空时同步播放提示音。
    function spawnCard({ sound = true, sessionLabel = '', sessionId = null } = {}) {
        try {
            if (!existsSync(CARD_SCRIPT)) {
                console.error('[dsh-task-done-sound] card script missing:', CARD_SCRIPT);
                appendCardLog(`host ERROR: card script missing: ${CARD_SCRIPT}`);
                return;
            }
            const exePath = findShellExe();
            const title = exePath === null ? 'DeepSeek-Harness' : basename(exePath, '.exe');
            const soundPath = sound ? findAssetPath('task-done.wav') : null;
            const iconPath = join(shellDir, 'assets', 'app-icon.png');
            const args = [
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', CARD_SCRIPT,
                '-ExePath', exePath ?? '', '-Title', title, '-Message', '对话完成了',
            ];
            if (sessionLabel !== '')
                args.push('-SessionLabel', sessionLabel);
            if (existsSync(iconPath))
                args.push('-IconPath', iconPath);
            if (soundPath !== null)
                args.push('-SoundPath', soundPath);
            // 不要用 detached:true —— powershell.exe + detached 会瞬间退出（cmd 不受影响）。
            const child = spawn('powershell.exe', args, { stdio: 'ignore', windowsHide: true });
            child.on('error', (err) => {
                console.error('[dsh-task-done-sound] spawn powershell errored:', err);
                appendCardLog(`host ERROR: spawn powershell errored: ${err.message}`);
            });
            child.unref();
            const who = sessionLabel !== '' ? sessionLabel : (sessionId ?? 'unknown');
            console.log(`[dsh-task-done-sound] conversation-done card spawned (exe=${exePath}, sound=${soundPath ?? 'off'}, session=${who})`);
        }
        catch (error) {
            console.error('[dsh-task-done-sound] spawn card failed:', error);
            appendCardLog(`host ERROR: spawn card failed: ${String(error?.message ?? error)}`);
        }
    }
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/dyn-assets',
        handler: async (req, res) => {
            const pathname = new URL(req.url ?? '/', 'http://x').pathname;
            const name = pathname.slice('/dyn-assets/'.length);
            if (name === '' || name.includes('/') || name.includes('\\') || !/^[A-Za-z0-9._-]+\.wav$/.test(name)) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('not found');
                return;
            }
            const bytes = loadAsset(name);
            if (bytes === null) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('not found');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'audio/wav',
                'Content-Length': String(bytes.length),
                'Cache-Control': 'no-store',
            });
            res.end(bytes);
        },
    }), 'webui: task-done-sound wav prefix route');
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/api/task-done-sound/conversation-done',
        handler: async (req, res) => {
            if (req.method !== 'POST') {
                res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: false, message: 'method not allowed' }));
                return;
            }
            let sound = true;
            let sessionId = null;
            let sessionTitle = '';
            try {
                const chunks = [];
                for await (const chunk of req)
                    chunks.push(chunk);
                if (chunks.length > 0) {
                    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                    if (parsed && typeof parsed.sound === 'boolean')
                        sound = parsed.sound;
                    if (parsed && typeof parsed.sessionId === 'string' && parsed.sessionId !== '')
                        sessionId = parsed.sessionId;
                    if (parsed && typeof parsed.title === 'string' && parsed.title !== '')
                        sessionTitle = parsed.title;
                }
            }
            catch (error) {
                // 非法 body 视为默认（开），不影响卡片
            }
            if (config.cardEnabled !== false)
                spawnCard({ sound, sessionLabel: sessionTitle, sessionId });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ ok: true, sound }));
        },
    }), 'webui: task-done-sound conversation-done route');
    console.log(`[dsh-task-done-sound] mounted: /dyn-assets/*.wav, /api/task-done-sound/conversation-done (shellDir=${shellDir})`);
}
//# sourceMappingURL=task-done-sound.js.map