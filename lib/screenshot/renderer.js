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
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CdpConnection, captureScreenshot, createPageSession, evaluateJson, fetchBrowserWsUrl, navigateAndWait, setViewport, } from '../browser/cdp.js';
import { DEFAULT_CHROME_CANDIDATES, findFreePort, killChrome, launchChrome, resolveChromePath, } from '../browser/chrome.js';
/** 常驻实例空闲回收时长：这段时间没有新截图就关掉浏览器。 */
const IDLE_TTL_MS = 5 * 60_000;
/** 长图高度上限（输出设备像素）：4K 档缩放更大，同一上限要按 scale 折算。 */
const MAX_DEVICE_HEIGHT = 28000;
let engine = null;
let idleTimer = null;
let chain = Promise.resolve();
/** 工作目录提供者（由 applyScreenshot 注入，指向 storages 下的 .engine）。 */
let baseDirProvider = () => join(process.cwd(), '.dsh-shot-engine');
/**
 * 配置渲染引擎的工作目录。
 * @param baseDir - 返回工作目录绝对路径的函数（profile 与临时 HTML 落在这里）。
 */
export function configureRenderer(baseDir) {
    baseDirProvider = baseDir;
}
/** 重置空闲回收计时（每次渲染后调用）。 */
function touchIdle() {
    if (idleTimer !== null)
        clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void shutdownRenderer(); }, IDLE_TTL_MS);
    // 不阻塞进程退出：空闲回收只为省内存，不该拖住 DSH 关停。
    idleTimer.unref?.();
}
/** 关闭常驻实例（幂等；空闲回收与插件卸载共用）。 */
export async function shutdownRenderer() {
    if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    const current = engine;
    engine = null;
    if (current === null)
        return;
    try {
        current.conn.close();
    }
    catch { /* 已断开 */ }
    killChrome(current.runtime, true);
    await rm(join(current.dir, 'page'), { recursive: true, force: true }).catch(() => { });
}
/** 启动一个新的常驻实例。 */
async function launch() {
    const chromePath = resolveChromePath(DEFAULT_CHROME_CANDIDATES);
    const port = await findFreePort(9400);
    const dir = baseDirProvider();
    const profileDir = join(dir, 'profile');
    await mkdir(profileDir, { recursive: true });
    const runtime = launchChrome(chromePath, profileDir, port, ['--headless=new', '--disable-gpu', '--hide-scrollbars']);
    try {
        const wsUrl = await fetchBrowserWsUrl(port, 20000);
        const conn = new CdpConnection(wsUrl);
        await conn.connect(10000);
        const session = await createPageSession(conn, 'about:blank');
        return { runtime, conn, session, dir };
    }
    catch (error) {
        killChrome(runtime, true);
        throw error;
    }
}
/** 取得可用实例：已存在且连接健康则复用，否则重建。 */
async function ensureEngine() {
    if (engine !== null && engine.conn.connected)
        return engine;
    await shutdownRenderer();
    engine = await launch();
    return engine;
}
/** 页面稳定脚本：字体就绪 + 图片解码完成（最多等 waitMs，超时按现状截）。 */
function settleJs(waitMs) {
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
})()`;
}
/** 测量文档内容高度（CSS px）。 */
async function measureHeight(session) {
    const value = await evaluateJson(session, 'Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight)', false);
    return Math.round(Number(value)) || 0;
}
/** 一次渲染（内部：假定已在串行队列内、实例已就绪）。 */
async function renderOnce(target, input) {
    const scale = input.scale ?? 2;
    // 高度上限按缩放折算成 CSS px，保证输出设备像素不超 Chromium 合成限制。
    const maxCssHeight = Math.min(16000, Math.floor(MAX_DEVICE_HEIGHT / scale));
    const pageDir = join(target.dir, 'page');
    await mkdir(pageDir, { recursive: true });
    const htmlFile = join(pageDir, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
    await writeFile(htmlFile, input.html, 'utf8');
    try {
        await setViewport(target.session, input.width, input.height, scale);
        await navigateAndWait(target.session, `file:///${htmlFile.replaceAll('\\', '/')}`, 20000);
        await evaluateJson(target.session, settleJs(3000), true).catch(() => null);
        // 内容比初始视口高时扩展视口截长图；扩展会触发重排，最多修正两轮。
        let cssHeight = input.height;
        for (let round = 0; round < 2; round += 1) {
            const measured = await measureHeight(target.session);
            const next = Math.min(Math.max(measured, input.height), maxCssHeight);
            if (next === cssHeight)
                break;
            cssHeight = next;
            await setViewport(target.session, input.width, cssHeight, scale);
        }
        return await captureScreenshot(target.session, 100, 'png', true, 30000);
    }
    finally {
        await rm(htmlFile, { force: true }).catch(() => { });
    }
}
/**
 * 渲染 HTML 为 PNG（base64）。串行执行；实例失效时自动重建并重试一次。
 * @param input - HTML 与视口尺寸。
 * @returns PNG 的 base64 数据（不含 data: 前缀）。
 */
export function renderPng(input) {
    const task = async () => {
        try {
            return await renderOnce(await ensureEngine(), input);
        }
        catch {
            // 实例可能已被外部杀掉或崩溃：整体重建一次再试，仍失败才上报。
            await shutdownRenderer();
            try {
                return await renderOnce(await ensureEngine(), input);
            }
            catch (retryError) {
                await shutdownRenderer();
                throw retryError instanceof Error ? retryError : new Error(String(retryError));
            }
        }
        finally {
            touchIdle();
        }
    };
    const run = chain.then(task, task);
    chain = run.catch(() => { });
    return run;
}
//# sourceMappingURL=renderer.js.map