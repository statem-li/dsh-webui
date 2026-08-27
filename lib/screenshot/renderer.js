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
import { createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { CdpConnection, captureScreenshot, createPageSession, evaluateJson, fetchBrowserWsUrl, navigateAndWait, setViewport, } from '../browser/cdp.js';
import { DEFAULT_CHROME_CANDIDATES, findFreePort, killChrome, launchChrome, } from '../browser/chrome.js';
import { MERMAID_FILE, MERMAID_HOOK } from './card.js';
import { stitchPng } from './stitch.js';
/**
 * 随包分发的 mermaid 引擎（预压缩，与前端 /dyn-assets/vendor 同一份资源）。
 *
 * 路径要兼容两种产物形态：tsdown 把 host 打成单文件 lib/index.js（`..` 即包根），
 * tsc 则保留目录结构 lib/screenshot/renderer.js（`../..` 才是包根）。
 */
const MERMAID_GZ = (() => {
    const candidates = [
        join(fileURLToPath(new URL('..', import.meta.url)), 'assets', 'vendor', 'mermaid.min.js.gz'),
        join(fileURLToPath(new URL('../..', import.meta.url)), 'assets', 'vendor', 'mermaid.min.js.gz'),
    ];
    return candidates.find(path => existsSync(path)) ?? candidates[0];
})();
/** 图表渲染等待上限（引擎解析 + 画图；超时按现状截，不卡死截图）。 */
const MERMAID_WAIT_MS = 20000;
/** 常驻实例空闲回收时长：这段时间没有新截图就关掉浏览器。 */
const IDLE_TTL_MS = 5 * 60_000;
/** 长图高度上限（输出设备像素）：4K 档缩放更大，同一上限要按 scale 折算。 */
const MAX_DEVICE_HEIGHT = 28000;
/**
 * 单段截图输出像素高度上限。Chromium/Edge 无头（--disable-gpu 软件渲染）的
 * 合成表面超过可处理临界（实测约 4300~4500 万输出像素，4080 宽 × ~1.05 万高）
 * 时，Page.captureScreenshot 会挂死 → 渲染管线被重置 → CDP 断连报
 * 「CDP 连接已关闭」。分段截图把每段压到 4080×8190（≈3342 万像素，留 25%+
 * 余量），实测每段 <600ms 稳定出图。clip + captureBeyondViewport 不可行：
 * 合成表面仍按整视口全高合成，照样挂死——必须让视口本身保持小尺寸。
 */
const MAX_SEGMENT_DEVICE_HEIGHT = 8192;
let engine = null;
let idleTimer = null;
let chain = Promise.resolve();
/** 工作目录提供者（由 applyScreenshot 注入，指向 storages 下的 .engine）。 */
let baseDirProvider = () => join(process.cwd(), '.dsh-shot-engine');
/**
 * 浏览器候选游标：默认从 0（Edge 优先，用户偏好）开始；渲染失败重试时
 * 顺延到下一个候选（如 Edge 151 无头不稳 → Chrome 152），全部候选都失败
 * 才上报。空闲回收后重置回 0，保持「默认 Edge、坏了自动换」。
 */
let candidateOffset = 0;
/** 取截图引擎专用的浏览器可执行文件：**Chrome 硬编码最优先**（本机
 *  Chrome 152 无头验证稳定；Edge 151 无头必现「CDP 连接已关闭」，只作兜底）。
 *  候选游标轮换仅用于「Chrome 不在场」时的 Edge/其他候选中循环。 */
function pickChromeCandidate() {
    const PREFERRED = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const candidate of PREFERRED) {
        if (existsSync(candidate))
            return candidate;
    }
    const usable = DEFAULT_CHROME_CANDIDATES.filter(candidate => existsSync(candidate));
    if (usable.length === 0) {
        throw new Error('未找到 Chrome/Edge 可执行文件');
    }
    const chromeFirst = [...usable].sort((a, b) => Number(/chrome/i.test(b)) - Number(/chrome/i.test(a)));
    const pick = chromeFirst[candidateOffset % chromeFirst.length];
    return pick;
}
/**
 * 配置渲染引擎的工作目录。
 * @param baseDir - 返回工作目录绝对路径的函数（profile 与临时 HTML 落在这里）。
 */
export function configureRenderer(baseDir) {
    baseDirProvider = baseDir;
}
/** 重置空闲回收计时（每次渲染后调用）。空闲回收关停实例时把浏览器候选
 *  游标一并重置——下一次冷启动仍从 Chrome 开始（Edge 只是兜底）。 */
function touchIdle() {
    if (idleTimer !== null)
        clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        candidateOffset = 0;
        void shutdownRenderer();
    }, IDLE_TTL_MS);
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
    // 给进程树一点退出时间：Windows 上文件句柄释放有延迟，profile 锁未释放
    // 就重建会撞上「用户数据目录被占用」→ 新实例连接后即断开（CDP 连接已关闭）。
    await new Promise(resolve => setTimeout(resolve, 300));
    await rm(join(current.dir, 'page'), { recursive: true, force: true }).catch(() => { });
    await rm(join(current.dir, 'profile'), { recursive: true, force: true }).catch(() => { });
}
/** 取得可用实例：已存在且连接健康则复用，否则重建。
 *  健康判定不止 ws readyState——连接可能假死（ws 开着但浏览器已无响应），
 *  这里多发一个轻量 Browser.getVersion 探活，任何异常都走重建。 */
async function ensureEngine() {
    if (engine !== null && engine.conn.connected) {
        try {
            await engine.conn.send('Browser.getVersion', {}, undefined, 5000);
            return engine;
        }
        catch {
            // 假死连接：按失活处理，走下方重建。
        }
    }
    await shutdownRenderer();
    engine = await launch();
    return engine;
}
/** 启动一个新的常驻实例。 */
async function launch() {
    const chromePath = pickChromeCandidate();
    const port = await findFreePort(9400);
    const dir = baseDirProvider();
    const profileDir = join(dir, 'profile');
    await mkdir(profileDir, { recursive: true });
    const runtime = launchChrome(chromePath, profileDir, port, ['--headless=new'], join(dir, 'engine.log'));
    try {
        const wsUrl = await fetchBrowserWsUrl(port, 20000);
        const conn = new CdpConnection(wsUrl);
        await conn.connect(10000);
        const session = await createPageSession(conn, 'about:blank');
        return { runtime, conn, session, dir };
    }
    catch (error) {
        killChrome(runtime, true);
        // 启动失败（可能是残留进程占着 profile）：等退出后清掉目录，下次全新启动。
        await new Promise(resolve => setTimeout(resolve, 300));
        await rm(profileDir, { recursive: true, force: true }).catch(() => { });
        throw error;
    }
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
/**
 * 把 mermaid 引擎解压到临时页面目录（页面用相对路径同目录加载）。
 * 已存在就复用 —— 常驻实例的 page 目录在两次截图之间不清理，解压只付一次
 * （~3.4MB 写盘）；引擎资源缺失时返回 false，页面回落成源码块。
 */
async function ensureMermaidAsset(pageDir) {
    const target = join(pageDir, MERMAID_FILE);
    if (existsSync(target))
        return true;
    if (!existsSync(MERMAID_GZ)) {
        console.warn('[webui-screenshot] mermaid asset missing, diagrams fall back to source:', MERMAID_GZ);
        return false;
    }
    try {
        await pipeline(createReadStream(MERMAID_GZ), createGunzip(), createWriteStream(target));
        return true;
    }
    catch (error) {
        console.warn('[webui-screenshot] mermaid asset unpack failed:', String(error?.message ?? error));
        await rm(target, { force: true }).catch(() => { });
        return false;
    }
}
/**
 * 等页面里的图画完（card.ts 的引导脚本把整批渲染暴露成 window 上的 promise）。
 * 超时/异常都不抛：宁可截一张图没画完的，也不让截图整体失败。
 */
async function waitMermaid(session) {
    await evaluateJson(session, `(async () => {
  const hook = window.${MERMAID_HOOK};
  if (hook === undefined) return 'absent';
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), ${MERMAID_WAIT_MS}));
  const result = await Promise.race([Promise.resolve(hook).catch(() => 'failed'), timeout]);
  // 图是同步插进 DOM 的，但字体/布局要一帧才稳定。
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try { await document.fonts.ready } catch (error) {}
  return result;
})()`, true).catch(() => null);
}
/**
 * 引擎健康诊断：逐步探测「实例状态 → CDP 探活 → 冷启动新实例 → 版本信息」，
 * 并报告浏览器候选与游标。供 /api/webui-screenshot/diagnose 调用，排查
 * 「CDP 连接已关闭」不再靠猜。
 */
export async function diagnoseEngine() {
    const out = {
        hasEngine: engine !== null,
        candidateOffset,
        browser: engine?.runtime.proc.spawnfile ?? null,
        candidates: DEFAULT_CHROME_CANDIDATES.filter(candidate => existsSync(candidate)),
    };
    if (engine !== null) {
        out.connected = engine.conn.connected;
        if (engine.conn.connected) {
            try {
                const version = await engine.conn.send('Browser.getVersion', {}, undefined, 5000);
                out.version = version;
            }
            catch (error) {
                out.probeError = String(error?.message ?? error);
            }
        }
    }
    try {
        const started = await ensureEngine();
        out.engineReady = true;
        out.port = started.runtime.port;
        out.browser = started.runtime.proc.spawnfile;
        try {
            const version = await started.conn.send('Browser.getVersion', {}, undefined, 5000);
            out.version = version;
        }
        catch (error) {
            out.versionError = String(error?.message ?? error);
        }
    }
    catch (error) {
        out.engineError = String(error?.message ?? error);
    }
    return out;
}
/** 一次渲染（内部：假定已在串行队列内、实例已就绪）。 */
async function renderOnce(target, input) {
    const scale = input.scale ?? 2;
    // 高度上限按缩放折算成 CSS px，保证输出设备像素不超 Chromium 合成限制。
    const maxCssHeight = Math.min(16000, Math.floor(MAX_DEVICE_HEIGHT / scale));
    const pageDir = join(target.dir, 'page');
    await mkdir(pageDir, { recursive: true });
    if (input.needsMermaid === true)
        await ensureMermaidAsset(pageDir);
    const htmlFile = join(pageDir, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
    await writeFile(htmlFile, input.html, 'utf8');
    try {
        await setViewport(target.session, input.width, input.height, scale);
        await navigateAndWait(target.session, `file:///${htmlFile.replaceAll('\\', '/')}`, 20000);
        await evaluateJson(target.session, settleJs(3000), true).catch(() => null);
        // 图表要等引擎画完再量高度，否则测到的是源码块的高度（长图会被截断）。
        if (input.needsMermaid === true)
            await waitMermaid(target.session);
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
        return await captureTiled(target.session, input.width, cssHeight, scale);
    }
    finally {
        await rm(htmlFile, { force: true }).catch(() => { });
    }
}
/**
 * 截取当前页面为 PNG（base64）。输出表面超临界时自动分段滚动截图 + 拼接。
 * 段与段之间的衔接：滚动位置 y 逐段累加，最后一段视口高设为「剩余高」，
 * 保证 scrollTo(y) 不被浏览器钳制（钳制会导致该段与上一段重叠/错位）。
 */
async function captureTiled(session, cssWidth, cssHeight, scale) {
    if (Math.round(cssHeight * scale) <= MAX_SEGMENT_DEVICE_HEIGHT) {
        return captureScreenshot(session, 100, 'png', true, 30000);
    }
    const segCss = Math.floor(MAX_SEGMENT_DEVICE_HEIGHT / scale);
    const tiles = [];
    // 视口高缓存：参数相同时跳过 setDeviceMetricsOverride（每次覆写都会重置
    // 页面的合成/滚动状态，白付一个 CDP 往返）；最后一段视口=剩余高。
    let vpHeight = -1;
    for (let y = 0; y < cssHeight; y += segCss) {
        const segCssHeight = Math.min(segCss, cssHeight - y);
        if (segCssHeight !== vpHeight) {
            await setViewport(session, cssWidth, segCssHeight, scale);
            vpHeight = segCssHeight;
        }
        await evaluateJson(session, `new Promise((resolve) => { window.scrollTo(0, ${y}); setTimeout(resolve, 150) })`, true).catch(() => { });
        const png = Buffer.from(await captureScreenshot(session, 100, 'png', true, 30000), 'base64');
        tiles.push({
            png,
            x: 0,
            y: Math.round(y * scale),
            width: Math.round(cssWidth * scale),
            height: Math.round(segCssHeight * scale),
        });
    }
    const totalHeight = tiles.reduce((sum, tile) => sum + tile.height, 0);
    return stitchPng(tiles, Math.round(cssWidth * scale), totalHeight).toString('base64');
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
        catch (firstError) {
            // 实例可能已被外部杀掉或崩溃：重建一次再试，且**换下一个浏览器候选**
            //（Chrome 失败 → Edge 兜底），排除单一浏览器无头模式的偶发问题。
            const firstBrowser = engine?.runtime.proc.spawnfile ?? 'unknown';
            console.warn('[webui-screenshot] render failed, engine will be rebuilt with next browser candidate:', `${firstBrowser}:`, String(firstError?.message ?? firstError));
            candidateOffset += 1;
            await shutdownRenderer();
            try {
                return await renderOnce(await ensureEngine(), input);
            }
            catch (retryError) {
                await shutdownRenderer();
                const message = retryError instanceof Error ? retryError.message : String(retryError);
                throw new Error(`${message}（截图引擎已自动重建并换用备用浏览器重试仍失败；可再点一次「重新渲染」触发全新实例）`);
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