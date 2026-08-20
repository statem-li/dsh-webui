/**
 * Chrome 进程管理：启动独立实例（固定 user-data-dir、自动端口探测）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
export const DEFAULT_CHROME_CANDIDATES = [
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
].filter(Boolean);
export function resolveChromePath(candidates) {
    for (const c of candidates) {
        if (c && fs.existsSync(c))
            return c;
    }
    throw new Error(`未找到 Chrome/Edge：请通过插件配置 chromePath 指定（已尝试：${candidates.join(', ')}）`);
}
/** 探测空闲端口（从 base 开始） */
export async function findFreePort(base = 9222, maxTries = 20) {
    for (let p = base; p < base + maxTries; p++) {
        if (await isPortFree(p))
            return p;
    }
    throw new Error(`端口 ${base}~${base + maxTries} 均被占用`);
}
export function isPortFree(port) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => srv.close(() => resolve(true)));
        srv.listen(port, '127.0.0.1');
    });
}
/**
 * 启动 Chrome。幂等由调用方保证（port/profile 检查）。
 * @param chromePath Chrome 可执行文件路径
 * @param profileDir 独立用户数据目录（cookies/登录态持久化）
 * @param port CDP 端口（调用方先 findFreePort）
 * @param headless 无头模式
 * @param args 附加参数
 */
export function launchChrome(chromePath, profileDir, port, headless = false, args = []) {
    fs.mkdirSync(profileDir, { recursive: true });
    const flags = [
        `--remote-debugging-port=${port}`,
        `--remote-debugging-address=127.0.0.1`,
        `--remote-allow-origins=*`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate,MediaRouter',
        ...(headless ? ['--headless=new', '--disable-gpu'] : []),
        ...args,
        'about:blank',
    ];
    const proc = spawn(chromePath, flags, {
        stdio: 'ignore',
        windowsHide: false,
    });
    proc.on('error', (err) => {
        // spawn 失败（EXE 不存在等）由调用方等待就绪时捕获；这里只记录
        console.error(`[dsh-browser] chrome spawn error: ${err.message}`);
    });
    return { proc, port, profileDir };
}
export function killChrome(runtime, force = false) {
    if (!runtime)
        return;
    const { proc } = runtime;
    if (proc && !proc.killed) {
        try {
            if (force || process.platform === 'win32')
                proc.kill('SIGKILL');
            else
                proc.kill('SIGTERM');
        }
        catch { /* 已退出 */ }
    }
}
/** 根据 session 标识生成 profile 目录名 */
export function profileDirFor(rootDir, key) {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'default';
    return path.join(rootDir, safe);
}
//# sourceMappingURL=chrome.js.map