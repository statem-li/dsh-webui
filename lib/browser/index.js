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
 * - 会话隔离：每个会话（sessionId）独立 Edge/Chrome 实例 + 独立 user-data-dir，
 *   登录态/Cookie/页面完全隔离，互不干扰；有头渲染 + 窗口移出屏幕外（不弹窗
 *   打扰），窗口尺寸对齐主屏物理分辨率且固定不变（画面不跳动）；画面经 CDP
 *   screencast 同步到 Web GUI 右侧滑出的预览抽屉，抽屉内可直接鼠标/键盘/滚轮
 *   操作页面（Input 域回传，与窗口可见性无关）。
 * - 零依赖：Node 24 原生 WebSocket 实现 CDP 客户端。
 */
import fs from 'node:fs';
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { CdpConnection, attachTarget, listPageTargets, navigateAndWait, navigateHistory, navigationState, reloadPage, waitForPageReady, captureScreenshot, captureScreenshotSafe, captureScreenshotSafeClip, fetchBrowserWsUrl, evaluateJson, inspectElementAt, getViewportSize, setViewport, clearViewport, dispatchKey, dispatchMouseMove, dispatchMouseClick, dispatchMouseButton, dispatchMouseWheel, insertText, startScreencast, stopScreencast, ackScreencast, } from './cdp.js';
import { killChrome, } from './chrome.js';
import { getSnapshot, clickAt, typeAt, hoverAt, selectAt, scrollPage, waitForSettle, waitForCondition, extractContent, locatorLabel, } from './snapshot.js';
export const name = '@dsh-external/dsh-browser';
export const inject = ['tools', 'webServer', 'fs', 'sandboxPolicy'];
export const Config = z.object({
    chromePath: z.string().default(''),
    port: z.number().default(0),
    screenshotDir: z.string().default(''),
    loginGroup: z.string().default('shared'),
});
const MAX_LOG = 200;
const MAX_STEPS = 50;
const NAV_TIMEOUT_MS = 30000;
// browser_batch 单次动作上限：一轮 LLM 推理 20~26s，动作本身 <0.5s，
// 上限越高越省推理轮次；20 步足够覆盖长表单，同时错误定位仍可读。
const MAX_BATCH_ACTIONS = 20;
// browser_see 视觉描述超时（超时降级为纯 ref 树）。
const VISION_TIMEOUT_MS = 60_000;
// 会话空闲自动回收：超过该时长无任何浏览器操作则关掉视图（省内存；
// 下次调用任意 browser_* 会自动重启，对模型透明）。
const SESSION_IDLE_TTL_MS = 30 * 60_000;
const SESSION_SWEEP_MS = 5 * 60_000;
// 有头模式：窗口启动即最大化（≈电脑屏幕分辨率），视口跟随真实窗口、稳定不变；
// screencast 只设推送尺寸上限（帧按实际视口推），不做任何动态 resize，
// 避免「画面尺寸来回跳」。
const SCREENCAST_MAX_DIM = 4096;
// 浏览器任务「engaged」判定：最后一次操作完成后，标识在 UI 上再保持这段时间，
// 覆盖 AI 连续操作之间的 LLM 思考间隔，避免「单次操作结束标识就跳没」的闪烁。
const ENGAGE_TIMEOUT_MS = 90_000;
// 操作后 DOM 静默检测参数（idle 越短返回越快；150ms 兼顾 SPA 渲染间隙）
const SETTLE_IDLE_MS = 150;
const SETTLE_TIMEOUT_MS = 2000;
// browser_see 视觉描述的默认提示词（聚焦「可操作」元素，服务网页操作场景）
const DEFAULT_SEE_PROMPT = '描述当前浏览器页面可见区域：整体布局（顶部导航/侧边栏/主内容区）、所有可见的按钮、输入框、链接及它们的文字，以及当前是否有弹窗/对话框。用于辅助网页操作，请具体到可点击/可输入元素，看不清就直说。';
export function applyBrowser(ctx, config) {
    // 插件数据根目录（prefs/浏览器 profile 共用）
    const dataRoot = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'), 'plugin-data', 'dsh-browser');
    const prefsFile = path.join(dataRoot, 'prefs.json');
    /** 会话截图目录：config.screenshotDir 优先，否则插件数据目录下 screenshots/<会话>。
     *  旧实现 st.screenshotDir 恒为空串 → 截图写进进程 CWD（DSH 源码目录），
     *  且 /api/dsh-browser/screenshot 按 basename 拼目录必然 404。 */
    /** 单会话截图保留数量上限（超出删最旧的；截图目录以前会无限增长）。 */
    const MAX_SHOTS_PER_SESSION = 60;
    /** 写入截图后修剪目录：按 mtime 保留最新 MAX_SHOTS_PER_SESSION 个。 */
    function pruneShots(dir) {
        try {
            const files = fs.readdirSync(dir)
                .filter(n => /\.(jpg|jpeg|png)$/i.test(n))
                .map(n => {
                const full = path.join(dir, n);
                let mtime = 0;
                try {
                    mtime = fs.statSync(full).mtimeMs;
                }
                catch { /* 已被删 */ }
                return { full, mtime };
            })
                .sort((a, b) => b.mtime - a.mtime);
            for (const f of files.slice(MAX_SHOTS_PER_SESSION)) {
                try {
                    fs.unlinkSync(f.full);
                }
                catch { /* 占用中则下次再删 */ }
            }
        }
        catch { /* 目录不存在等：忽略 */ }
    }
    function screenshotDirFor(sessionId) {
        const base = config.screenshotDir.trim() !== ''
            ? config.screenshotDir.trim()
            : path.join(dataRoot, 'screenshots');
        const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'default';
        const dir = path.join(base, safe);
        try {
            fs.mkdirSync(dir, { recursive: true });
        }
        catch { /* 创建失败时写文件会报错，交由调用方感知 */ }
        return dir;
    }
    // ═══ 「允许 AI 使用浏览器」开关（默认开启，持久化）；浏览器固定有头运行 ═══
    let allowBrowser = true;
    function loadPrefs() {
        try {
            const parsed = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
            allowBrowser = parsed?.allowBrowser !== false;
        }
        catch {
            allowBrowser = true;
        }
    }
    function savePrefs() {
        try {
            fs.mkdirSync(dataRoot, { recursive: true });
            fs.writeFileSync(prefsFile, JSON.stringify({ allowBrowser }, null, 2) + '\n');
        }
        catch { /* 持久化失败不影响运行 */ }
    }
    loadPrefs();
    // ═══ 壳内嵌视图宿主（DeepSeek Harness 桌面壳，openhanako 同款）═══
    // 浏览器 = 壳子进程里的 WebContentsView：不 spawn 独立浏览器进程、无独立
    // 窗口/任务栏图标；attach 时嵌入 GUI 抽屉画面区（原生渲染+原生输入），
    // detach 后不可见且不合成。壳子不在时（纯浏览器访问 GUI 等）报错提示，
    // 绝不静默降级为独立浏览器窗口（用户明确要求永不弹 Edge）。
    const BV_HTTP_PORT = 3081;
    // 壳子 CDP 端口动态协商：壳启动时挑空闲端口并写入 .shell-cdp-port 文件，
    // 避开「异常退出留下的僵尸监听」。每次实时读文件（不缓存！服务启动早于
    // 壳子写入时，缓存会把默认值固化导致永远连错端口——实际踩过的坑）。
    function shellCdpPort() {
        try {
            const raw = fs.readFileSync('D:\\AI\\Dsh\\.shell-cdp-port', 'utf8').trim();
            const p = Number(raw);
            if (Number.isFinite(p) && p > 0)
                return p;
        }
        catch { /* 文件不存在（壳子未启动或未写入） */ }
        return 9224;
    }
    async function bvPost(pathname, body, timeoutMs = 1500) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(`http://127.0.0.1:${BV_HTTP_PORT}${pathname}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
            return await res.json();
        }
        finally {
            clearTimeout(timer);
        }
    }
    // ═══ 会话隔离：sessionId → 独立浏览器运行态 + 活动时间线 ═══
    const sessions = new Map();
    const activity = new Map();
    let seqCounter = 0;
    function ensureState(sessionId) {
        let st = sessions.get(sessionId);
        if (!st) {
            st = {
                runtime: null, conn: null, session: null, screenshotDir: screenshotDirFor(sessionId), lastScreenshotPath: null,
                log: [], frame: null, offFrame: null, offDialog: null, chromeUiHeight: null, lastSettleAt: 0,
                shellMode: false,
                bvKey: sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'default',
                tabTargets: new Map(),
                activeTabId: null,
                viewport: null,
                attachedToDrawer: false,
                drawerBounds: null,
                loginKey: config.loginGroup.trim(),
            };
            sessions.set(sessionId, st);
        }
        return st;
    }
    function ensureActivity(sessionId) {
        let act = activity.get(sessionId);
        if (!act) {
            act = { active: false, lastActivityAt: 0, url: '', title: '', steps: [] };
            activity.set(sessionId, act);
        }
        return act;
    }
    // ═══ 同会话操作串行化：同一浏览器视图上并发 CDP 操作（工具调用 + 抽屉交互
    // + 状态轮询）会互相打断——scrollIntoView 后坐标被另一路操作滚走、
    // Runtime.evaluate 在导航中途执行报 context destroyed。按会话排队。═══
    const locks = new Map();
    function withLock(sessionId, fn) {
        const prev = locks.get(sessionId) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        // 队列尾永远是「已结算」的 promise，避免前一步失败把整条链变成 rejected
        locks.set(sessionId, next.then(() => undefined, () => undefined));
        return next;
    }
    /** 原生弹窗（alert/confirm/beforeunload）自动放行：不处理会让页面永久挂起，
     *  之后所有 evaluate/截图全部超时——旧版没接这个事件，实测踩过。 */
    function attachDialogGuard(sessionId, conn) {
        return conn.on('Page.javascriptDialogOpening', (p) => {
            const send = async () => {
                try {
                    await conn.send('Page.handleJavaScriptDialog', {
                        accept: p?.type !== 'beforeunload',
                        ...(p?.type === 'prompt' ? { promptText: '' } : {}),
                    }, p?.sessionId);
                    log(sessionId, 'dialog', `${String(p?.type || 'dialog')}: ${String(p?.message || '').slice(0, 80)}`);
                }
                catch { /* 弹窗已被别处处理 */ }
            };
            void send();
        });
    }
    /** 从工具执行上下文解析当前会话 id（agent.id === session.id）。 */
    function sessionIdOf(exec) {
        const id = exec?.agent?.id ?? exec?.agent?.session?.id;
        return id != null && String(id) !== '' ? String(id) : 'default';
    }
    /** 记录一次操作开始，返回其 step 句柄。 */
    function beginActivity(sessionId, tool, label, detail) {
        const act = ensureActivity(sessionId);
        const step = {
            seq: ++seqCounter, tool, label, detail,
            status: 'running', startedAt: Date.now(), finishedAt: null, result: '',
        };
        act.steps.push(step);
        if (act.steps.length > MAX_STEPS)
            act.steps.splice(0, act.steps.length - MAX_STEPS);
        act.active = true;
        return step;
    }
    // ── 操作记录人话化：「点击左下角「设置」」而不是 ref=/JS/快照 ──
    /** 按视口坐标推断方位词：左下角 / 右上角 / 顶部 / 左侧…（中央返回空串）。 */
    function posWord(x, y, vw, vh) {
        if (vw <= 0 || vh <= 0)
            return '';
        const hz = x < vw / 3 ? '左' : x > (vw * 2) / 3 ? '右' : '';
        const vt = y < vh / 3 ? '上' : y > (vh * 2) / 3 ? '下' : '';
        if (hz !== '' && vt !== '')
            return `${hz}${vt}角`;
        if (hz !== '')
            return `${hz}侧`;
        if (vt === '上')
            return '顶部';
        if (vt === '下')
            return '底部';
        return '';
    }
    function tagCn(tag) {
        switch (tag) {
            case 'button': return '按钮';
            case 'a': return '链接';
            case 'input': return '输入框';
            case 'textarea': return '输入框';
            case 'select': return '下拉框';
            case 'img': return '图片';
            case 'label': return '标签';
            default: return '元素';
        }
    }
    function targetWord(tag, text) {
        const t = text.trim();
        if (t !== '')
            return `「${t.length > 16 ? t.slice(0, 16) + '…' : t}」`;
        return tagCn(tag);
    }
    function shortText(s, n = 20) {
        const t = String(s ?? '').replace(/\s+/g, ' ').trim();
        return t.length > n ? t.slice(0, n) + '…' : t;
    }
    /** URL → 主机名（失败回退原串），供活动条显示「打开 example.com」。 */
    function hostOf(url) {
        try {
            return new URL(url).hostname;
        }
        catch {
            return String(url).slice(0, 60);
        }
    }
    function scrollWord(dir) {
        return dir === 'up' ? '向上' : dir === 'down' ? '向下' : dir === 'left' ? '向左' : '向右';
    }
    /** 截图文件的对外可访问 URL（统一拼装，避免各处手写 query 拼错）。 */
    function shotUrl(sessionId, file) {
        return `/api/dsh-browser/screenshot?sessionId=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(path.basename(file))}`;
    }
    /**
     * browser_evaluate 表达式包装：含 return / await 或多语句时包成 async IIFE。
     * 旧版直接把语句块塞给 Runtime.evaluate，模型写 `const x=1; return x` 必然
     * 语法错误，只能再猜一轮——这是实测最常见的浏览器工具失败原因之一。
     */
    function wrapExpression(expr) {
        const src = expr.trim();
        if (src === '')
            return src;
        // 顶层扫描：跳过字符串/模板/注释，只在括号深度 0 处判定 return 与语句分隔。
        // 深度 >0 的 return（如 `(()=>{ return 1 })()`）属于内层函数，不算顶层。
        let depth = 0;
        let topReturn = false;
        let topSeparator = false;
        let hasAwait = false;
        for (let i = 0; i < src.length; i++) {
            const c = src[i];
            if (c === '"' || c === "'" || c === '\u0060') {
                const quote = c;
                i++;
                while (i < src.length && src[i] !== quote) {
                    if (src[i] === '\\')
                        i++;
                    i++;
                }
                continue;
            }
            if (c === '/' && src[i + 1] === '/') {
                while (i < src.length && src[i] !== '\n')
                    i++;
                continue;
            }
            if (c === '/' && src[i + 1] === '*') {
                i = src.indexOf('*/', i + 2);
                if (i < 0)
                    break;
                i++;
                continue;
            }
            if (c === '(' || c === '[' || c === '{') {
                depth++;
                continue;
            }
            if (c === ')' || c === ']' || c === '}') {
                depth--;
                continue;
            }
            if (depth !== 0)
                continue;
            if ((c === ';' || c === '\n') && src.slice(i + 1).trim() !== '')
                topSeparator = true;
            if (c === 'r' && src.startsWith('return', i) && isTokenBoundary(src, i, 6))
                topReturn = true;
            if (c === 'a' && src.startsWith('await', i) && isTokenBoundary(src, i, 5))
                hasAwait = true;
        }
        if (!topReturn && !topSeparator && !hasAwait)
            return src;
        const body = topReturn || topSeparator ? src : `return (${src})`;
        return `(async () => { ${body} })()`;
    }
    /** 关键字前后都不是标识符字符（避免匹配 returnValue / myawait）。 */
    function isTokenBoundary(src, at, len) {
        const before = at === 0 ? '' : src[at - 1];
        const after = src[at + len] ?? '';
        const ident = /[A-Za-z0-9_$]/;
        return !ident.test(before) && !ident.test(after);
    }
    /** 记录一次操作结束（done/error），并重算活跃标记。只允许从 running 结束，避免 finally 覆盖 catch 已标记的 error。 */
    function finishActivity(sessionId, step, status, result = '') {
        if (step.status !== 'running')
            return;
        step.status = status;
        step.finishedAt = Date.now();
        if (result)
            step.result = String(result).slice(0, 200);
        const act = activity.get(sessionId);
        if (act) {
            act.active = act.steps.some(s => s.status === 'running');
            act.lastActivityAt = Date.now();
        }
    }
    function log(sessionId, action, detail = '') {
        const st = ensureState(sessionId);
        st.log.push({ ts: new Date().toISOString(), action, detail: String(detail).slice(0, 200) });
        if (st.log.length > MAX_LOG)
            st.log.splice(0, st.log.length - MAX_LOG);
    }
    // ═══ 浏览器工具门禁：开关关闭时拦截全部 browser_* 调用 ═══
    ctx.effect(() => ctx.on('tools/pre-execute', async (exec, next) => {
        if (typeof exec?.name === 'string' && exec.name.startsWith('browser_') && !allowBrowser) {
            return { kind: 'deny', reason: '浏览器使用已被用户禁用（可在对话面板开关中开启）' };
        }
        return next();
    }), '@dsh-external/dsh-browser: allow gate');
    // ═══ 生命周期：启动 / 停止 / 状态（按会话）═══
    /** 壳内多标签：确保 st.session 指向当前激活标签的 target。 */
    async function syncActiveTabSession(st) {
        if (!st.shellMode || !st.conn?.connected)
            return;
        const targetId = st.activeTabId != null ? st.tabTargets.get(st.activeTabId) : null;
        if (!targetId)
            return;
        if (!st.session || st.session.targetId !== targetId) {
            st.session = await attachTarget(st.conn, targetId);
            // 弹窗/加载事件需要 Page 域启用（flatten 模式下按 session 生效）。
            try {
                await st.conn.send('Page.enable', {}, st.session.sessionId);
            }
            catch { /* 已启用 */ }
        }
    }
    /** 标签切换/新建/关闭后：若抽屉正贴合原生视图，立即把激活标签的视图挂上——
     *  壳子 create-tab 只创建视图不挂载，不重挂的话画面区会停留在旧标签。 */
    async function reattachActiveTab(st) {
        if (!st.shellMode || !st.attachedToDrawer || st.drawerBounds == null)
            return;
        if (st.activeTabId == null || !st.tabTargets.has(st.activeTabId))
            return;
        try {
            await bvPost('/view/attach', { sessionKey: st.bvKey, tabId: st.activeTabId, ...st.drawerBounds }, 3000);
        }
        catch { /* 壳不在了等场景忽略；client 的 view-bounds 轮询兜底 */ }
    }
    /** 服务重启后 CDP 重连：壳内视图还活着，用 window.name 标记重建 tabId↔target 映射。
     *  用本轮实际命中的映射**整体替换**旧 Map：任何残留的死 targetId（如 stop 后残留）
     *  都会被洗掉；返回值也只看本轮命中数，绝不能拿累积 Map 判定。 */
    async function rebindShellTabs(st) {
        const prefix = `dshbv-${st.bvKey}/`;
        const conn = st.conn;
        if (!conn?.connected)
            return false;
        const fresh = new Map();
        try {
            const pages = await listPageTargets(conn);
            for (const p of pages) {
                try {
                    const s = await attachTarget(conn, p.targetId);
                    const name = await evaluateJson(s, 'window.name', false);
                    if (typeof name === 'string' && name.startsWith(prefix)) {
                        const tabId = name.slice(prefix.length);
                        if (tabId !== '')
                            fresh.set(tabId, p.targetId);
                    }
                }
                catch { /* 单个 target 失败忽略 */ }
            }
        }
        catch {
            return false;
        }
        st.tabTargets = fresh;
        return fresh.size > 0;
    }
    /** 等壳内新视图的 CDP target 出现：先 25ms 密集轮询（通常 <200ms 就绪），
     *  之后退到 120ms，总时长仍约 6s。旧实现固定 120ms×50，白等首个周期。 */
    async function waitShellTarget(conn, bvKey, tabId) {
        const marker = `#dshbv-${bvKey}/${tabId}`;
        const deadline = Date.now() + 6000;
        let wait = 25;
        while (Date.now() < deadline) {
            try {
                const pages = await listPageTargets(conn);
                const hit = pages.find(p => p.url.includes(marker));
                if (hit)
                    return hit.targetId;
            }
            catch { /* CDP 未就绪，重试 */ }
            await new Promise((r) => setTimeout(r, wait));
            if (wait < 120)
                wait = Math.min(120, wait * 2);
        }
        return null;
    }
    /** 壳内新建标签页（可选直接导航），并设为激活标签。 */
    async function shellNewTab(sessionId, st, navigateUrl) {
        const conn = st.conn;
        if (!conn?.connected)
            throw new Error('壳内 CDP 未连接');
        const tabId = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        await bvPost('/view/create-tab', { sessionKey: st.bvKey, tabId, loginKey: st.loginKey }, 3000);
        const targetId = await waitShellTarget(conn, st.bvKey, tabId);
        if (targetId === null)
            throw new Error('新标签页未就绪');
        st.tabTargets.set(tabId, targetId);
        const s = await attachTarget(conn, targetId);
        // window.name 跨导航持久：服务重启 CDP 重连后靠它重建映射
        try {
            await evaluateJson(s, `window.name = ${JSON.stringify(`dshbv-${st.bvKey}/${tabId}`)}`, false);
        }
        catch { /* 标记失败不致命 */ }
        st.activeTabId = tabId;
        await syncActiveTabSession(st);
        await reattachActiveTab(st);
        if (navigateUrl != null && navigateUrl !== '') {
            await navigateAndWait(st.session, navigateUrl, NAV_TIMEOUT_MS);
        }
        log(sessionId, 'new-tab', `${tabId}${navigateUrl ? ' → ' + navigateUrl : ''}`);
        return tabId;
    }
    /** 标签列表短缓存（抽屉每 800ms 轮询一次；600ms 内复用，省 CDP 往返）。 */
    const tabsCache = new Map();
    /** 壳内标签列表（title/url 来自 CDP target 信息）。 */
    async function shellTabsInfo(st) {
        if (!st.conn?.connected || st.tabTargets.size === 0)
            return [];
        const cached = tabsCache.get(st.bvKey);
        if (cached && Date.now() - cached.at < 600)
            return cached.tabs;
        let pages = [];
        try {
            pages = await listPageTargets(st.conn);
        }
        catch {
            return cached?.tabs ?? [];
        }
        const byId = new Map(pages.map((p) => [p.targetId, p]));
        const out = [];
        for (const [tabId, targetId] of st.tabTargets) {
            const p = byId.get(targetId);
            if (!p)
                continue;
            out.push({
                tabId,
                title: p.title || '(空白)',
                url: p.url || '',
                active: tabId === st.activeTabId,
            });
        }
        tabsCache.set(st.bvKey, { at: Date.now(), tabs: out });
        return out;
    }
    async function startBrowserFor(sessionId) {
        const st = ensureState(sessionId);
        if (st.conn?.connected && st.session) {
            return { ok: true, alreadyRunning: true, ...(await statusFieldsFor(sessionId)) };
        }
        // ── 首选：壳内嵌视图（WebContentsView 多标签）——零独立进程、零独立窗口 ──
        try {
            // 壳里可能还有上次会话的存活视图（服务重启过）：先尝试重建映射复用。
            const wsUrl = await fetchBrowserWsUrl(shellCdpPort(), 8000);
            const conn = new CdpConnection(wsUrl);
            await conn.connect(10000);
            st.conn = conn;
            st.shellMode = true;
            // 原生弹窗守卫：alert/confirm 不放行会让页面永久挂起（后续操作全超时）。
            if (st.offDialog) {
                try {
                    st.offDialog();
                }
                catch { /* 已解绑 */ }
            }
            st.offDialog = attachDialogGuard(sessionId, conn);
            const rebound = await rebindShellTabs(st);
            if (rebound) {
                try {
                    if (st.activeTabId == null || !st.tabTargets.has(st.activeTabId)) {
                        st.activeTabId = st.tabTargets.keys().next().value ?? null;
                    }
                    await syncActiveTabSession(st);
                }
                catch {
                    // 映射里仍混入死 targetId（极端时序）：不报死，清掉后降级为全新会话
                    log(sessionId, 'start', 'rebound map stale, falling back to fresh tab');
                    st.tabTargets.clear();
                    st.activeTabId = null;
                }
                if (st.conn?.connected && st.session) {
                    log(sessionId, 'start', `shell embedded views rebound (${st.tabTargets.size} tabs)`);
                    return { ok: true, shell: true, ...(await statusFieldsFor(sessionId)) };
                }
                // 降级继续走下方全新建 tab 路径
            }
            // 全新会话：创建第一个标签页
            const tabId = 't' + Date.now().toString(36);
            await bvPost('/view/create-tab', { sessionKey: st.bvKey, tabId, loginKey: st.loginKey }, 3000);
            const targetId = await waitShellTarget(conn, st.bvKey, tabId);
            if (targetId === null)
                throw new Error('壳内浏览器视图未就绪');
            st.tabTargets.set(tabId, targetId);
            st.activeTabId = tabId;
            const session = await attachTarget(conn, targetId);
            try {
                await evaluateJson(session, `window.name = ${JSON.stringify(`dshbv-${st.bvKey}/${tabId}`)}`, false);
            }
            catch { /* 不致命 */ }
            st.session = session;
            log(sessionId, 'start', `shell embedded WebContentsView (bv=${st.bvKey} tab=${tabId})`);
            log(sessionId, 'ready', `shell-cdp:${shellCdpPort()}`);
            return { ok: true, shell: true, ...(await statusFieldsFor(sessionId)) };
        }
        catch (e) {
            // 壳子宿主不可用（未启动/端口文件缺失）：明确报错，绝不静默降级为
            // 独立浏览器窗口（用户明确要求永不弹 Edge/Chrome）。
            log(sessionId, 'shell-unavailable', String(e?.message || e));
            st.shellMode = false;
            return {
                ok: false,
                error: `壳内浏览器宿主不可用（${String(e?.message || e)}）。请确认 DeepSeek Harness 壳子已启动，然后重试。`,
            };
        }
    }
    async function stopBrowserFor(sessionId) {
        const st = sessions.get(sessionId);
        if (!st)
            return { ok: true, running: false };
        releaseFrameStream(st);
        if (st.offDialog) {
            try {
                st.offDialog();
            }
            catch { }
        }
        st.offDialog = null;
        st.frame = null;
        // 壳内视图模式：销毁壳里的 WebContentsView（无进程可杀）
        if (st.shellMode) {
            try {
                await bvPost('/view/close', { sessionKey: st.bvKey }, 2000);
            }
            catch { /* 壳不在了 */ }
            if (st.conn) {
                try {
                    st.conn.close();
                }
                catch { }
            }
            st.conn = null;
            st.session = null;
            st.runtime = null;
            // 关键：视图已全部销毁，tabId→targetId 映射全部失效，必须一并清掉。
            // 否则下次 start 时 rebindShellTabs 以「tabTargets 非空」误判复用成功，
            // syncActiveTabSession 拿着死 targetId 去 attach 永久失败
            // （Target.attachToTarget: No target with given id found）。
            st.tabTargets.clear();
            st.activeTabId = null;
            st.frame = null;
            log(sessionId, 'stop', 'embedded view closed');
            return { ok: true, running: false };
        }
        // 先优雅关闭（Browser.close）：让浏览器把「屏幕外」窗口位置写入 profile，
        // 下次启动第一帧就在屏幕外、桌面不闪现；超时再强杀兜底。
        if (st.conn?.connected) {
            try {
                await Promise.race([
                    st.conn.send('Browser.close'),
                    new Promise((r) => setTimeout(r, 1500)),
                ]);
            }
            catch { /* 连接断开即已退出 */ }
            await new Promise((r) => setTimeout(r, 600));
        }
        if (st.conn) {
            try {
                st.conn.close();
            }
            catch { }
        }
        st.conn = null;
        st.session = null;
        killChrome(st.runtime);
        st.runtime = null;
        log(sessionId, 'stop', 'browser closed');
        return { ok: true, running: false };
    }
    /**
     * 订阅 screencast 帧并逐帧 ack。
     * 旧实现只 startScreencast、无人监听 Page.screencastFrame：帧不入库、不 ack
     * （CDP 未 ack 会停止推流），于是 /frame 每 150ms 都退化成一次全量截图。
     */
    function ensureFrameStream(st) {
        if (st.offFrame !== null || st.conn === null)
            return;
        const conn = st.conn;
        st.offFrame = conn.on('Page.screencastFrame', (p) => {
            const target = st.session;
            if (target === null)
                return;
            if (p?.sessionId !== undefined && p.sessionId !== target.sessionId)
                return;
            if (typeof p?.data !== 'string' || p.data === '')
                return;
            const meta = p.metadata ?? {};
            st.frame = {
                data: p.data,
                width: Math.round(Number(meta.deviceWidth) || st.viewport?.width || 0),
                height: Math.round(Number(meta.deviceHeight) || st.viewport?.height || 0),
                ts: Date.now(),
                rev: (st.frame?.rev ?? 0) + 1,
            };
            // 必须逐帧 ack，否则 Chromium 停止后续推送。
            if (typeof p.screencastSessionId === 'number') {
                void ackScreencast(target, p.screencastSessionId).catch(() => { });
            }
        });
    }
    /** 解除帧订阅（抽屉关闭 / 停止浏览器）。 */
    function releaseFrameStream(st) {
        if (st.offFrame !== null) {
            try {
                st.offFrame();
            }
            catch { /* 已解绑 */ }
        }
        st.offFrame = null;
    }
    async function requireSession(sessionId) {
        const st = ensureState(sessionId);
        if (!st.conn?.connected || !st.session) {
            await startBrowserFor(sessionId);
        }
        if (!st.conn?.connected || !st.session) {
            throw new Error('浏览器未就绪，请先调用 browser_start');
        }
        // 壳内多标签：AI 工具始终作用于当前激活标签
        await syncActiveTabSession(st);
        return st.session;
    }
    /** 获取快照并把 url/title 回填到该会话活动（供内嵌面板显示）。 */
    async function snapshotFor(session, sessionId) {
        const snap = await getSnapshot(session);
        const act = ensureActivity(sessionId);
        act.url = snap.url;
        act.title = snap.title;
        return snap;
    }
    /**
     * 截图三级降级：CDP surface → CDP renderer → 壳控制通道 capturePage。
     * detached/最小化/托盘状态下合成器不产帧，前两级（等合成帧/向 renderer 要帧）
     * 都会超时——最后由壳子的 Electron capturePage 兜底：viz CopyOutputRequest
     * 强制渲染管线产出一帧并拷贝，不依赖页面可见性（实测踩坑后的修复）。
     */
    async function screenshotWithFallback(session, sessionId, quality = 90, format = 'jpeg', surfaceTimeoutMs = 8000) {
        const st = ensureState(sessionId);
        try {
            return await captureScreenshotSafe(session, quality, format, surfaceTimeoutMs);
        }
        catch (cdpErr) {
            if (!st.shellMode)
                throw cdpErr; // 独立浏览器模式没有壳控制通道，原样抛出
            try {
                const r = await bvPost('/view/capture', { sessionKey: st.bvKey, quality }, 6000);
                if (r?.ok && typeof r.data === 'string' && r.data.length > 0) {
                    log(sessionId, 'screenshot', 'via shell capturePage fallback');
                    return r.data;
                }
                throw new Error(String(r?.error || 'capturePage 无数据'));
            }
            catch (shellErr) {
                throw new Error(`截图失败：CDP surface/renderer 均无帧（${String(cdpErr?.message || cdpErr).slice(0, 120)}），壳兜底也不可用（${String(shellErr?.message || shellErr).slice(0, 120)}）`);
            }
        }
    }
    async function statusFieldsFor(sessionId) {
        const st = ensureState(sessionId);
        // 运行判定：壳内视图模式看 CDP 连接与视图会话；独立窗口模式看进程存活。
        const running = isRunning(st);
        let url = '';
        let title = '';
        if (running && st.session) {
            try {
                // 轻量探针：url/title 两个字段即可，不做全量 DOM 遍历
                // （旧版每次 status 都跑 getSnapshot，抽屉打开时是持续的 CPU 开销）。
                const probe = await evaluateJson(st.session, '({u:location.href,t:document.title})', false);
                url = String(probe?.u ?? '');
                title = String(probe?.t ?? '');
                const act = ensureActivity(sessionId);
                act.url = url;
                act.title = title;
            }
            catch { /* 页面可能未加载完 */ }
        }
        return {
            running,
            url,
            title,
            tabCount: st.tabTargets.size,
            activeTabId: st.activeTabId,
            port: st.runtime?.port ?? null,
            headed: true,
        };
    }
    /**
     * 操作后的统一收尾：等 DOM 静默（或等导航后的页面就绪），再返回最新快照。
     * 这是减少「快照陈旧 → 模型反复重试」的关键。
     */
    async function settleAndSnapshot(session, sessionId) {
        const settle = await waitForSettle(session, SETTLE_IDLE_MS, SETTLE_TIMEOUT_MS);
        if (settle.nav) {
            // 导航已发生：DOM 就绪即可拍快照，尾部网络空闲不在这里白等（旧实现每次
            // 点链接都要多等一个 extraMs=2.5s）。
            await waitForPageReady(session, NAV_TIMEOUT_MS, true);
        }
        ensureState(sessionId).lastSettleAt = Date.now();
        const snap = await snapshotFor(session, sessionId);
        return {
            snapshot: snap.text,
            url: snap.url,
            title: snap.title,
            refCount: snap.refCount,
            navigated: settle.nav,
        };
    }
    /** 从工具参数里取定位器（ref / selector / text_match 三选一）。 */
    function locatorOf(args) {
        return {
            ref: args?.ref != null && Number.isFinite(Number(args.ref)) ? Number(args.ref) : undefined,
            selector: typeof args?.selector === 'string' && args.selector.trim() !== '' ? args.selector.trim() : undefined,
            text: typeof args?.text_match === 'string' && args.text_match.trim() !== '' ? args.text_match.trim() : undefined,
            nth: args?.nth != null && Number(args.nth) > 0 ? Number(args.nth) : undefined,
        };
    }
    /** 定位器三参数至少给一个，否则直接报错（省一轮无效调用）。 */
    function requireLocator(loc) {
        if (loc.ref == null && loc.selector == null && loc.text == null) {
            throw new Error('缺少定位参数：ref（来自 snapshot）/ selector（CSS）/ text_match（可见文本）三者给一个');
        }
        return loc;
    }
    /**
     * 工具执行骨架：会话锁串行化 + 活动时间线 + 统一错误形状。
     * 旧版每个工具重复 try/catch/finally 20 行，且 finally 里无条件 finishActivity
     * 'done' 依赖「只允许从 running 结束」的隐式约定；并发调用还会互相打断页面状态。
     */
    async function runTool(exec, tool, label, detail, fn) {
        const sessionId = sessionIdOf(exec);
        return withLock(sessionId, async () => {
            const step = beginActivity(sessionId, tool, label, detail);
            try {
                const out = await fn({ sessionId, step });
                finishActivity(sessionId, step, 'done');
                return out;
            }
            catch (e) {
                const error = String(e?.message || e);
                finishActivity(sessionId, step, 'error', error);
                return { ok: false, error };
            }
        });
    }
    /** 工具返回的 JSON 统一渲染（旧版 18 处逐个重复同一段字面量）。 */
    const jsonOutput = {
        schema: { type: 'json' },
        render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
    };
    /** 定位参数的公共 schema 片段（三种定位方式 + nth）。 */
    const LOCATOR_PARAMS = {
        ref: { type: 'number', description: 'snapshot 中的 [ref] 编号（最快）' },
        selector: { type: 'string', description: 'CSS 选择器（自动穿透 shadow DOM / 同源 iframe）；快照失效时用它免去重拍' },
        text_match: { type: 'string', description: '元素可见文本/aria-label/placeholder 匹配串（精确优先，其次前缀、包含）' },
        nth: { type: 'number', description: 'selector/text_match 命中多个时取第几个（1 起，默认 1）' },
    };
    // ═══ 工具注册（ctx.effect：fiber dispose 自动注销）═══
    const tools = [
        defineTool({
            name: 'browser_start',
            description: '启动 AI 浏览器（每会话独立视图，画面同步到 Web GUI 右侧抽屉、可在抽屉内直接操作）。其余 browser_* 工具会自动启动，通常无需显式调用。',
            parameters: {},
            output: jsonOutput,
            async execute(_args, exec) {
                return runTool(exec, 'browser_start', '启动浏览器', '', async ({ sessionId }) => startBrowserFor(sessionId));
            },
        }),
        defineTool({
            name: 'browser_navigate',
            description: '打开 URL 并等待加载，返回页面 ref 树。能拼出最终地址（搜索结果页/详情页）就直接打开，不要「首页→搜索→点结果」逐跳。可选 wait_for_selector/wait_for_text 在同一次调用里等目标出现。',
            parameters: {
                url: { type: 'string', required: true, description: '网址（http/https；缺协议自动补 https）' },
                wait_for_selector: { type: 'string', description: '加载后等该 CSS 选择器出现（最多 15s）' },
                wait_for_text: { type: 'string', description: '加载后等该文本出现（最多 15s）' },
                returnSnapshot: { type: 'boolean', description: '是否返回 ref 树（默认 true；只为跳转时可设 false 省 token）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_navigate', '打开网页', '', async ({ sessionId, step }) => {
                    const url = normalizeSiteUrl(String(args?.url ?? ''));
                    if (url === null)
                        throw new Error('url 无效（仅支持 http/https）');
                    const session = await requireSession(sessionId);
                    const info = await navigateAndWait(session, url, NAV_TIMEOUT_MS);
                    step.label = `打开 ${hostOf(info.url)}`;
                    let waited;
                    const sel = typeof args?.wait_for_selector === 'string' ? args.wait_for_selector.trim() : '';
                    const txt = typeof args?.wait_for_text === 'string' ? args.wait_for_text.trim() : '';
                    if (sel !== '' || txt !== '') {
                        const w = await waitForCondition(session, { selector: sel || undefined, text: txt || undefined, timeoutMs: 15000 });
                        waited = w.ok ? '已出现' : (w.error ?? '未出现');
                    }
                    log(sessionId, 'navigate', url);
                    if (args?.returnSnapshot === false)
                        return { ok: true, url: info.url, title: info.title, ...(waited ? { waited } : {}) };
                    const snap = await snapshotFor(session, sessionId);
                    return { ok: true, url: info.url, title: info.title, ...(waited ? { waited } : {}), snapshot: snap.text };
                });
            },
        }),
        defineTool({
            name: 'browser_snapshot',
            description: '获取当前页面 ref 树（含 shadow DOM / 同源 iframe 内元素）。页面变化后 ref 会失效——也可以直接用 selector/text_match 定位，省一次快照往返。',
            parameters: {},
            output: jsonOutput,
            async execute(_args, exec) {
                return runTool(exec, 'browser_snapshot', '读取页面内容', '', async ({ sessionId }) => {
                    const session = await requireSession(sessionId);
                    const snap = await snapshotFor(session, sessionId);
                    return { ok: true, url: snap.url, title: snap.title, refCount: snap.refCount, snapshot: snap.text };
                });
            },
        }),
        defineTool({
            name: 'browser_click',
            description: '点击元素（ref / selector / text_match 任一定位）。连续多步操作请用 browser_batch 合并，或用 browser_evaluate 一段 JS 批量完成；单步调用仅用于需先看结果再决定下一步。returnSnapshot=false 可省快照。',
            parameters: {
                ...LOCATOR_PARAMS,
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_click', '点击页面元素', '', async ({ sessionId, step }) => {
                    const loc = requireLocator(locatorOf(args));
                    const session = await requireSession(sessionId);
                    const t = await clickAt(session, loc);
                    step.label = `点击${posWord(t.x, t.y, t.vw, t.vh)}${targetWord(t.tag, t.text)}`;
                    step.detail = locatorLabel(loc);
                    log(sessionId, 'click', step.label);
                    if (args?.returnSnapshot === false)
                        return { ok: true, clicked: step.label };
                    return { ok: true, clicked: step.label, ...(await settleAndSnapshot(session, sessionId)) };
                });
            },
        }),
        defineTool({
            name: 'browser_type',
            description: '向输入框输入文本（ref / selector / text_match 定位；命中 select 时按文本或值选择）。要填多个字段时优先用 browser_batch 合并或 browser_evaluate 一段 JS 完成，不要逐框调用。',
            parameters: {
                ...LOCATOR_PARAMS,
                text: { type: 'string', required: true, description: '要输入的文本（会先全选覆盖原内容）' },
                pressEnter: { type: 'boolean', description: '输入后按回车（提交表单/搜索），默认 false' },
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_type', '输入文本', '', async ({ sessionId, step }) => {
                    const loc = requireLocator(locatorOf(args));
                    const session = await requireSession(sessionId);
                    await typeAt(session, loc, String(args?.text ?? ''), args?.pressEnter === true);
                    step.label = `输入「${shortText(String(args?.text ?? ''))}」${args?.pressEnter === true ? '并回车' : ''}`;
                    step.detail = locatorLabel(loc);
                    log(sessionId, 'type', `${locatorLabel(loc)} enter=${args?.pressEnter === true}`);
                    if (args?.returnSnapshot === false)
                        return { ok: true };
                    return { ok: true, ...(await settleAndSnapshot(session, sessionId)) };
                });
            },
        }),
        defineTool({
            name: 'browser_select',
            description: '在下拉框 select 中选择选项（按选项值或可见文本匹配，失败会列出可选项）。',
            parameters: {
                ...LOCATOR_PARAMS,
                value: { type: 'string', required: true, description: '选项值或可见文本' },
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_select', '选择下拉选项', '', async ({ sessionId, step }) => {
                    const loc = requireLocator(locatorOf(args));
                    const session = await requireSession(sessionId);
                    await selectAt(session, loc, String(args?.value ?? ''));
                    step.label = `选择「${shortText(String(args?.value ?? ''), 16)}」`;
                    step.detail = locatorLabel(loc);
                    log(sessionId, 'select', `${locatorLabel(loc)} value=${args?.value}`);
                    if (args?.returnSnapshot === false)
                        return { ok: true };
                    return { ok: true, ...(await settleAndSnapshot(session, sessionId)) };
                });
            },
        }),
        defineTool({
            name: 'browser_hover',
            description: '鼠标悬停到元素上，用于触发 hover 菜单/下拉/提示。',
            parameters: {
                ...LOCATOR_PARAMS,
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_hover', '悬停元素', '', async ({ sessionId, step }) => {
                    const loc = requireLocator(locatorOf(args));
                    const session = await requireSession(sessionId);
                    const t = await hoverAt(session, loc);
                    step.label = `悬停${targetWord(t.tag, t.text)}`;
                    step.detail = locatorLabel(loc);
                    log(sessionId, 'hover', locatorLabel(loc));
                    if (args?.returnSnapshot === false)
                        return { ok: true };
                    return { ok: true, ...(await settleAndSnapshot(session, sessionId)) };
                });
            },
        }),
        defineTool({
            name: 'browser_press',
            description: '发送键盘按键（真实按键事件）：Escape 关弹窗、Enter 确认、箭头键、ctrl+a 等组合键。repeat 可一次连按多下。',
            parameters: {
                key: { type: 'string', required: true, description: 'Enter / Escape / Tab / Backspace / Delete / Arrow* / Home / End / PageUp / PageDown，或单字符' },
                modifiers: { type: 'array', items: { type: 'string' }, description: 'ctrl / shift / alt / meta，如 ["ctrl"] 配 key="a"' },
                repeat: { type: 'number', description: '重复次数（1~20，默认 1）——连按 5 次 Tab 只需一次调用' },
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_press', '按键', '', async ({ sessionId, step }) => {
                    const session = await requireSession(sessionId);
                    const mods = Array.isArray(args?.modifiers) ? args.modifiers.map(String) : [];
                    const key = String(args?.key ?? '');
                    if (key === '')
                        throw new Error('key 不能为空');
                    const repeat = Math.max(1, Math.min(20, Number(args?.repeat) || 1));
                    for (let i = 0; i < repeat; i++)
                        await dispatchKey(session, key, mods);
                    step.label = `按 ${mods.map((m) => `${m}+`).join('')}${key}${repeat > 1 ? ` ×${repeat}` : ''}`;
                    log(sessionId, 'press', `${key} ×${repeat}`);
                    if (args?.returnSnapshot === false)
                        return { ok: true };
                    return { ok: true, ...(await settleAndSnapshot(session, sessionId)) };
                });
            },
        }),
        defineTool({
            name: 'browser_batch',
            description: '一次调用按顺序执行多个动作（点击/输入/选择/悬停/按键/滚动/导航/等待），只返回最终快照——「填完整个表单再提交」这类连续操作比逐个调用快一个数量级。任一步失败立即中止并报出步骤序号与已完成步骤。最多 20 个动作。',
            parameters: {
                actions: {
                    type: 'array',
                    required: true,
                    description: '动作数组（最多 20 项），每项可用 ref/selector/text_match 定位：{"action":"click","ref":5}；{"action":"click","text_match":"登录"}；{"action":"type","selector":"#email","text":"a@b.c"}；{"action":"select","ref":3,"value":"选项"}；{"action":"hover","ref":4}；{"action":"press","key":"Enter","repeat":2}；{"action":"scroll","direction":"down","amount":3}；{"action":"navigate","url":"https://…"}；{"action":"wait","selector":".result"} 或 {"action":"wait","text":"成功","timeoutMs":8000}',
                },
                returnSnapshot: { type: 'boolean', description: '是否返回最终快照（默认 true）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const actions = Array.isArray(args?.actions) ? args.actions : [];
                if (actions.length === 0)
                    return { ok: false, error: 'actions 不能为空' };
                if (actions.length > MAX_BATCH_ACTIONS)
                    return { ok: false, error: `单次最多 ${MAX_BATCH_ACTIONS} 个动作` };
                const labels = [];
                const outcome = await runTool(exec, 'browser_batch', `批量执行 ${actions.length} 个动作`, '', async ({ sessionId, step }) => {
                    const session = await requireSession(sessionId);
                    for (let i = 0; i < actions.length; i++) {
                        const a = (actions[i] ?? {});
                        const kind = String(a.action || '');
                        switch (kind) {
                            case 'click': {
                                const t = await clickAt(session, requireLocator(locatorOf(a)));
                                labels.push(`点击${posWord(t.x, t.y, t.vw, t.vh)}${targetWord(t.tag, t.text)}`);
                                break;
                            }
                            case 'type': {
                                await typeAt(session, requireLocator(locatorOf(a)), String(a.text ?? ''), a.pressEnter === true);
                                labels.push(`输入「${shortText(String(a.text ?? ''))}」${a.pressEnter === true ? '并回车' : ''}`);
                                break;
                            }
                            case 'select': {
                                await selectAt(session, requireLocator(locatorOf(a)), String(a.value ?? ''));
                                labels.push(`选择「${shortText(String(a.value ?? ''), 16)}」`);
                                break;
                            }
                            case 'hover': {
                                const t = await hoverAt(session, requireLocator(locatorOf(a)));
                                labels.push(`悬停${targetWord(t.tag, t.text)}`);
                                break;
                            }
                            case 'press': {
                                const mods = Array.isArray(a.modifiers) ? a.modifiers.map(String) : [];
                                const repeat = Math.max(1, Math.min(20, Number(a.repeat) || 1));
                                for (let k = 0; k < repeat; k++)
                                    await dispatchKey(session, String(a.key ?? ''), mods);
                                labels.push(`按 ${mods.map((m) => m + '+').join('')}${a.key}${repeat > 1 ? ` ×${repeat}` : ''}`);
                                break;
                            }
                            case 'scroll': {
                                const dir = ['up', 'down', 'left', 'right'].includes(String(a.direction)) ? String(a.direction) : 'down';
                                await scrollPage(session, dir, Number(a.amount) || 3, typeof a.selector === 'string' ? a.selector : undefined);
                                labels.push(`${scrollWord(dir)}滚动`);
                                break;
                            }
                            case 'navigate': {
                                const url = normalizeSiteUrl(String(a.url ?? ''));
                                if (url === null)
                                    throw new Error(`第 ${i + 1} 步 url 无效`);
                                const info = await navigateAndWait(session, url, NAV_TIMEOUT_MS);
                                labels.push(`打开 ${hostOf(info.url)}`);
                                break;
                            }
                            case 'wait': {
                                const w = await waitForCondition(session, {
                                    selector: typeof a.selector === 'string' && a.selector !== '' ? a.selector : undefined,
                                    text: typeof a.text === 'string' && a.text !== '' ? a.text : undefined,
                                    gone: a.gone === true,
                                    timeoutMs: Number(a.timeoutMs) || 10000,
                                });
                                if (!w.ok)
                                    throw new Error(w.error ?? '等待条件未满足');
                                labels.push(`等待${a.gone === true ? '消失' : '出现'}：${shortText(String(a.selector ?? a.text ?? ''), 20)}`);
                                break;
                            }
                            default:
                                throw new Error(`第 ${i + 1} 步未知动作: ${kind || '(空)'}`);
                        }
                    }
                    step.label = `批量：${labels.join(' → ')}`;
                    log(sessionId, 'batch', `${actions.length} actions ok`);
                    if (args?.returnSnapshot === false)
                        return { ok: true, actions: labels };
                    return { ok: true, actions: labels, ...(await settleAndSnapshot(session, sessionId)) };
                });
                // 失败时补上「已完成到哪一步」，模型可从断点续跑而不必重跑整批。
                if (outcome != null && outcome.ok === false) {
                    return { ok: false, done: labels, error: `第 ${labels.length + 1} 步失败: ${outcome.error}` };
                }
                return outcome;
            },
        }),
        defineTool({
            name: 'browser_wait_for',
            description: '在页面内等待条件成立：选择器/文本出现（或 gone=true 等其消失）。等待在页面里轮询完成，不消耗额外 LLM 轮次——比「操作→快照→再快照」空转快得多。',
            parameters: {
                selector: { type: 'string', description: '等待出现/消失的 CSS 选择器' },
                text: { type: 'string', description: '等待出现/消失的页面文本' },
                gone: { type: 'boolean', description: 'true = 等目标消失（如加载遮罩），默认等出现' },
                timeoutMs: { type: 'number', description: '超时毫秒（200~60000，默认 10000）' },
                returnSnapshot: { type: 'boolean', description: '成立后是否返回快照（默认 true）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_wait_for', '等待页面条件', '', async ({ sessionId, step }) => {
                    const sel = typeof args?.selector === 'string' ? args.selector.trim() : '';
                    const txt = typeof args?.text === 'string' ? args.text.trim() : '';
                    if (sel === '' && txt === '')
                        throw new Error('需要 selector 或 text 之一');
                    const session = await requireSession(sessionId);
                    step.label = `等待${args?.gone === true ? '消失' : '出现'}：${shortText(sel || txt, 20)}`;
                    const w = await waitForCondition(session, {
                        selector: sel || undefined,
                        text: txt || undefined,
                        gone: args?.gone === true,
                        timeoutMs: Number(args?.timeoutMs) || 10000,
                    });
                    if (!w.ok)
                        throw new Error(w.error ?? '等待条件未满足');
                    log(sessionId, 'wait', step.label);
                    if (args?.returnSnapshot === false)
                        return { ok: true };
                    const snap = await snapshotFor(session, sessionId);
                    return { ok: true, url: snap.url, title: snap.title, snapshot: snap.text };
                });
            },
        }),
        defineTool({
            name: 'browser_extract',
            description: '提取页面（或某个选择器区域）的正文文本与链接列表。读文章/搜索结果/表格内容时用它，比 snapshot 省 token 且不含交互元素噪音。',
            parameters: {
                selector: { type: 'string', description: '只提取该 CSS 选择器区域（默认整页 body）' },
                maxChars: { type: 'number', description: '文本字符上限（200~40000，默认 6000）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_extract', '提取页面正文', String(args?.selector ?? ''), async ({ sessionId }) => {
                    const session = await requireSession(sessionId);
                    const res = await extractContent(session, typeof args?.selector === 'string' && args.selector.trim() !== '' ? args.selector.trim() : undefined, Number(args?.maxChars) || 6000);
                    if (!res.ok)
                        throw new Error(res.error ?? '提取失败');
                    log(sessionId, 'extract', `${res.total} chars`);
                    return res;
                });
            },
        }),
        defineTool({
            name: 'browser_scroll',
            description: '滚动页面或指定容器（selector），返回滚动进度与操作后快照（滚动可能触发懒加载，会等 DOM 稳定）。',
            parameters: {
                direction: { type: 'string', required: true, description: 'up / down / left / right' },
                amount: { type: 'number', description: '滚动步数（默认 3）' },
                selector: { type: 'string', description: '滚动该容器而非窗口（内部滚动区/虚拟列表）' },
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_scroll', '滚动页面', '', async ({ sessionId, step }) => {
                    const dir = String(args?.direction ?? '');
                    if (!['up', 'down', 'left', 'right'].includes(dir))
                        throw new Error('direction 须为 up/down/left/right');
                    const session = await requireSession(sessionId);
                    const res = await scrollPage(session, dir, Number(args?.amount) || 3, typeof args?.selector === 'string' && args.selector.trim() !== '' ? args.selector.trim() : undefined);
                    step.label = `${scrollWord(dir)}滚动页面`;
                    log(sessionId, 'scroll', dir);
                    if (args?.returnSnapshot === false)
                        return { ok: true, ...res };
                    return { ok: true, ...res, ...(await settleAndSnapshot(session, sessionId)) };
                });
            },
        }),
        defineTool({
            name: 'browser_back',
            description: '浏览器后退一页，返回新页面快照。',
            parameters: { returnSnapshot: { type: 'boolean', description: '是否返回快照（默认 true）' } },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_back', '后退一页', '', async ({ sessionId }) => {
                    const session = await requireSession(sessionId);
                    const info = await navigateHistory(session, -1);
                    log(sessionId, 'back', info.url);
                    if (args?.returnSnapshot === false)
                        return { ok: true, ...info };
                    const snap = await snapshotFor(session, sessionId);
                    return { ok: true, ...info, snapshot: snap.text };
                });
            },
        }),
        defineTool({
            name: 'browser_forward',
            description: '浏览器前进一页，返回新页面快照。',
            parameters: { returnSnapshot: { type: 'boolean', description: '是否返回快照（默认 true）' } },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_forward', '前进一页', '', async ({ sessionId }) => {
                    const session = await requireSession(sessionId);
                    const info = await navigateHistory(session, 1);
                    log(sessionId, 'forward', info.url);
                    if (args?.returnSnapshot === false)
                        return { ok: true, ...info };
                    const snap = await snapshotFor(session, sessionId);
                    return { ok: true, ...info, snapshot: snap.text };
                });
            },
        }),
        defineTool({
            name: 'browser_evaluate',
            description: '在页面执行 JavaScript 并返回结果（JSON 序列化；含 await/return 的语句块会自动包成 async 函数）。批量填表、批量勾选、读取或核对数据首选本工具一段 JS 完成（React 受控输入需经 native setter 赋值并 dispatch input/change），比逐个 click/type 快一个数量级。',
            parameters: {
                expression: { type: 'string', required: true, description: 'JS 表达式或语句块（可含 await）；写成多条语句时必须用 return 返回结果，返回值需 JSON 可序列化' },
                returnSnapshot: { type: 'boolean', description: '执行后是否附带最新快照（默认 false；改了 DOM 想看结果时设 true）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_evaluate', '执行页面脚本', '', async ({ sessionId }) => {
                    const session = await requireSession(sessionId);
                    const expr = String(args?.expression ?? '');
                    if (expr.trim() === '')
                        throw new Error('expression 不能为空');
                    const value = await evaluateJson(session, wrapExpression(expr));
                    log(sessionId, 'evaluate', expr.slice(0, 120));
                    if (args?.returnSnapshot !== true)
                        return { ok: true, value };
                    return { ok: true, value, ...(await settleAndSnapshot(session, sessionId)) };
                });
            },
        }),
        defineTool({
            name: 'browser_see',
            description: '截图并用辅助视觉模型描述画面，同时返回最新 ref 树。仅在 ref 树定位不到元素（图标按钮、canvas、验证码）或需理解整体画面时使用——纯读文字/结构用 browser_snapshot / browser_extract 更快更省。',
            parameters: {
                prompt: { type: 'string', description: '可选的视觉描述要求（默认聚焦可操作元素与布局）' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                return runTool(exec, 'browser_see', '查看页面画面', '', async ({ sessionId }) => {
                    const session = await requireSession(sessionId);
                    const st = ensureState(sessionId);
                    const base64 = await screenshotWithFallback(session, sessionId);
                    const file = path.join(st.screenshotDir, `see-${Date.now()}.jpg`);
                    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
                    st.lastScreenshotPath = file;
                    pruneShots(st.screenshotDir);
                    // 视觉描述：复用 vision-helper 暴露的 cordis 服务（未装则降级为纯 ref 树）
                    let vision = '';
                    let visionModel = '';
                    let visionError = '';
                    const describeFn = ctx.get('vision-describe');
                    if (typeof describeFn === 'function') {
                        try {
                            const prompt = String(args?.prompt || '').trim() || DEFAULT_SEE_PROMPT;
                            // 超时后降级为纯 ref 树，不卡死工具调用
                            const res = await Promise.race([
                                describeFn(file, prompt),
                                new Promise((_, rej) => setTimeout(() => rej(new Error('视觉描述超时（60s）')), VISION_TIMEOUT_MS)),
                            ]);
                            if (res && res.ok && typeof res.text === 'string') {
                                vision = res.text;
                                visionModel = res.model || '';
                            }
                            else {
                                visionError = res && res.error ? String(res.error) : '视觉描述未返回文本';
                            }
                        }
                        catch (e) {
                            visionError = String(e?.message || e);
                        }
                    }
                    else {
                        visionError = '未检测到辅助视觉插件 dsh-vision-helper，仅返回 ref 树';
                    }
                    const snap = await snapshotFor(session, sessionId);
                    log(sessionId, 'see', `vision=${vision ? 'ok' : 'fail'}`);
                    return {
                        ok: true,
                        url: snap.url,
                        title: snap.title,
                        snapshot: snap.text,
                        vision,
                        visionModel,
                        screenshot: file,
                        imageUrl: shotUrl(sessionId, file),
                        ...(visionError ? { visionError } : {}),
                    };
                });
            },
        }),
        defineTool({
            name: 'browser_screenshot',
            description: '截图保存为文件并返回路径。传 selector 只截该元素区域（自动滚动到视口中央再裁剪），图更小更聚焦；需要读图内容时把返回路径交给 vision_describe。',
            parameters: {
                selector: { type: 'string', description: '目标元素的 CSS 选择器；不传则整视口截图' },
                padding: { type: 'integer', description: 'selector 模式下四周留白像素（默认 8，上限 120）' },
                format: { type: 'string', enum: ['jpeg', 'png'], description: 'jpeg 体积小（默认）；png 无损适合文字密集区域' },
            },
            output: jsonOutput,
            async execute(args, exec) {
                const selector = args != null && typeof args.selector === 'string' ? args.selector.trim() : '';
                return runTool(exec, 'browser_screenshot', selector !== '' ? '截取元素截图' : '截取页面截图', selector, async ({ sessionId }) => {
                    const session = await requireSession(sessionId);
                    const st = ensureState(sessionId);
                    if (selector !== '') {
                        // ── 元素范围模式：scrollIntoView + getBoundingClientRect + clip 截图 ──
                        const padding = Math.max(0, Math.min(120, typeof args?.padding === 'number' ? Math.round(args.padding) : 8));
                        const format = args?.format === 'png' ? 'png' : 'jpeg';
                        const probeJs = '(() => {'
                            + 'const el = document.querySelector(' + JSON.stringify(selector) + ');'
                            + 'if (!el) return null;'
                            + "el.scrollIntoView({ block: 'center', inline: 'nearest' });"
                            + 'const r = el.getBoundingClientRect();'
                            + 'return { x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };'
                            + '})()';
                        const rect = await evaluateJson(session, probeJs, false);
                        if (rect === null || rect === undefined) {
                            throw new Error(`页面上找不到匹配元素：${selector}。可用 browser_snapshot/browser_evaluate 确认选择器写法。`);
                        }
                        if (!(Number(rect.w) > 0) || !(Number(rect.h) > 0)) {
                            throw new Error(`目标元素尺寸为零（可能 display:none 或未渲染）：${selector}`);
                        }
                        // 裁剪区 clamp 进视口，避免黑边
                        const x = Math.max(0, Number(rect.x) - padding);
                        const y = Math.max(0, Number(rect.y) - padding);
                        const w = Math.min(Number(rect.vw) - x, Number(rect.w) + padding * 2 + (Number(rect.x) - x));
                        const h = Math.min(Number(rect.vh) - y, Number(rect.h) + padding * 2 + (Number(rect.y) - y));
                        const clipped = await captureScreenshotSafeClip(session, 90, format, { x, y, width: w, height: h });
                        const ext = format === 'png' ? 'png' : 'jpg';
                        const file = path.join(st.screenshotDir, `element-${Date.now()}.${ext}`);
                        fs.writeFileSync(file, Buffer.from(clipped, 'base64'));
                        st.lastScreenshotPath = file;
                        pruneShots(st.screenshotDir);
                        log(sessionId, 'screenshot', `${file} (selector=${selector} ${Math.round(w)}x${Math.round(h)})`);
                        return {
                            ok: true,
                            selector,
                            rect: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) },
                            path: file,
                            imageUrl: shotUrl(sessionId, file),
                            bytes: fs.statSync(file).size,
                            hint: '元素区域截图完成；如需看图内容，调用 vision_describe，image 参数传此路径',
                        };
                    }
                    const base64 = await screenshotWithFallback(session, sessionId);
                    const file = path.join(st.screenshotDir, `shot-${Date.now()}.jpg`);
                    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
                    st.lastScreenshotPath = file;
                    pruneShots(st.screenshotDir);
                    log(sessionId, 'screenshot', file);
                    return {
                        ok: true,
                        path: file,
                        imageUrl: shotUrl(sessionId, file),
                        bytes: fs.statSync(file).size,
                        hint: '如需看图内容，调用 vision_describe，image 参数传此路径',
                    };
                });
            },
        }),
        defineTool({
            name: 'browser_stop',
            description: '关闭当前会话的浏览器视图（释放内存；下次调用任意 browser_* 会自动重启）。',
            parameters: {},
            output: jsonOutput,
            async execute(_args, exec) {
                return runTool(exec, 'browser_stop', '关闭浏览器', '', async ({ sessionId }) => stopBrowserFor(sessionId));
            },
        }),
        defineTool({
            name: 'browser_status',
            description: '查询当前会话浏览器状态（运行中/URL/标题/元素数/标签数）。',
            parameters: {},
            output: jsonOutput,
            async execute(_args, exec) {
                const sessionId = sessionIdOf(exec);
                try {
                    return { ok: true, ...(await statusFieldsFor(sessionId)) };
                }
                catch (e) {
                    return { ok: false, error: String(e?.message || e) };
                }
            },
        }),
    ];
    // ═══ 空闲会话回收：长期不用的浏览器视图占内存（每个 WebContentsView 一套
    // 渲染器进程）。超过 TTL 无操作即关闭；模型下次调用会自动重启。═══
    ctx.effect(() => {
        const timer = setInterval(() => {
            const now = Date.now();
            for (const [sessionId, st] of [...sessions]) {
                const running = st.shellMode ? !!st.conn?.connected && !!st.session : !!st.runtime;
                if (!running)
                    continue;
                const act = activity.get(sessionId);
                const last = Math.max(act?.lastActivityAt ?? 0, st.lastSettleAt);
                if (act?.active === true)
                    continue;
                if (last !== 0 && now - last > SESSION_IDLE_TTL_MS) {
                    log(sessionId, 'idle-reclaim', `idle ${Math.round((now - last) / 60000)}min`);
                    void stopBrowserFor(sessionId).catch(() => { });
                }
            }
            // 已停止的会话：清掉锁队列与标签缓存，避免长期运行下 Map 只增不减。
            for (const [sessionId, st] of [...sessions]) {
                if (isRunning(st))
                    continue;
                locks.delete(sessionId);
                tabsCache.delete(st.bvKey);
            }
        }, SESSION_SWEEP_MS);
        return () => clearInterval(timer);
    }, '@dsh-external/dsh-browser: idle session reclaim');
    ctx.effect(() => {
        for (const tool of tools)
            ctx.tools.register(tool);
        return () => {
            // 插件卸载/重载时清理全部会话的浏览器进程
            for (const sessionId of [...sessions.keys()]) {
                const st = sessions.get(sessionId);
                if (!st)
                    continue;
                if (st.conn) {
                    try {
                        st.conn.close();
                    }
                    catch { }
                }
                killChrome(st.runtime);
                st.runtime = null;
            }
            sessions.clear();
        };
    }, '@dsh-external/dsh-browser: tools');
    // ═══ UI 路由（供 client 面板）═══
    /** 解析请求 query 参数。 */
    function queryOf(req) {
        try {
            return new URL(String(req.url || '/'), 'http://localhost').searchParams;
        }
        catch {
            return new URLSearchParams();
        }
    }
    function json(res, status, payload) {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(payload));
    }
    /** 读取 JSON 请求体（旧版 6 条路由各自内联同一段 Promise）。上限 1MB 防内存放大。 */
    function readJsonBody(req) {
        return new Promise((resolve) => {
            let raw = '';
            let tooLarge = false;
            req.on('data', (chunk) => {
                if (tooLarge)
                    return;
                raw += chunk;
                if (raw.length > 1_000_000) {
                    tooLarge = true;
                    raw = '';
                }
            });
            req.on('end', () => {
                if (tooLarge) {
                    resolve(null);
                    return;
                }
                try {
                    resolve(JSON.parse(raw || '{}'));
                }
                catch {
                    resolve(null);
                }
            });
            req.on('error', () => resolve(null));
        });
    }
    /** 路由通用：取运行中的会话态；未运行时已应答 404/400 并返回 null。 */
    function runningState(res, sessionId) {
        if (typeof sessionId !== 'string' || sessionId === '') {
            json(res, 400, { ok: false, error: 'sessionId 缺失' });
            return null;
        }
        const st = sessions.get(sessionId);
        if (!st?.conn?.connected || !st.session) {
            json(res, 404, { ok: false, error: '浏览器未运行' });
            return null;
        }
        return { st, conn: st.conn, session: st.session };
    }
    /** 会话是否运行中（多处重复的三元判定收成一处）。 */
    function isRunning(st) {
        if (!st)
            return false;
        return st.shellMode
            ? !!st.conn?.connected && !!st.session
            : !!st.runtime && !st.runtime.proc.killed && !!st.conn?.connected;
    }
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/active-sessions',
            handler: (_req, res) => {
                try {
                    const now = Date.now();
                    const sessionsList = [];
                    for (const [sessionId, act] of activity) {
                        // 浏览器实例必须还在运行，且「正在操作」或「最近刚操作过」（engaged）。
                        const st = sessions.get(sessionId);
                        if (!isRunning(st))
                            continue;
                        const engaged = act.active || (now - act.lastActivityAt < ENGAGE_TIMEOUT_MS);
                        if (!engaged)
                            continue;
                        // 有进行中的操作优先；否则用最后一步（空闲时仍显示「上次在做什么」）。
                        const live = act.steps.find(s => s.status === 'running') ?? act.steps[act.steps.length - 1];
                        sessionsList.push({
                            sessionId,
                            active: act.active,
                            engaged: true,
                            url: act.url,
                            title: act.title,
                            tool: live?.tool ?? '',
                            label: live?.label ?? '',
                            detail: live?.detail ?? '',
                            startedAt: live?.startedAt ?? null,
                        });
                    }
                    json(res, 200, { ok: true, sessions: sessionsList });
                }
                catch (e) {
                    json(res, 500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: active-sessions route');
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/session',
            handler: async (req, res) => {
                try {
                    const sessionId = queryOf(req).get('sessionId') || 'default';
                    const act = activity.get(sessionId);
                    const st = sessions.get(sessionId);
                    // 壳内多标签：附带标签列表（title/url 来自 CDP target 信息）
                    let tabs = [];
                    if (st?.shellMode) {
                        try {
                            tabs = await shellTabsInfo(st);
                        }
                        catch { /* 忽略 */ }
                    }
                    // 地址栏工具条需要「能否前进/后退」来置灰按钮；读的是导航历史，
                    // 无 CDP 往返之外的额外开销（失败时按不可用处理）。
                    let nav = { canBack: false, canForward: false, url: '', title: '' };
                    if (st?.conn?.connected && st.session !== null) {
                        try {
                            nav = await navigationState(st.session);
                        }
                        catch { /* 页面切换中 */ }
                    }
                    json(res, 200, {
                        ok: true,
                        sessionId,
                        active: act?.active ?? false,
                        running: isRunning(st),
                        url: nav.url !== '' ? nav.url : (act?.url ?? ''),
                        title: nav.title !== '' ? nav.title : (act?.title ?? ''),
                        canBack: nav.canBack,
                        canForward: nav.canForward,
                        steps: act !== undefined ? act.steps.slice(-MAX_STEPS) : [],
                        shell: st?.shellMode === true,
                        tabs,
                        activeTabId: st?.activeTabId ?? null,
                    });
                }
                catch (e) {
                    json(res, 500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: session route');
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/frame',
            handler: async (req, res) => {
                try {
                    const sessionId = queryOf(req).get('sessionId') || 'default';
                    const st = sessions.get(sessionId);
                    if (!st?.conn?.connected || !st?.session) {
                        json(res, 404, { ok: false, error: '浏览器未运行' });
                        return;
                    }
                    // 增量拉取：client 带上已收到的帧号 since；无新帧时返回 304 空体，
                    // 避免每 150ms 全量下载+解码图片（静止页面的主要卡顿来源）。
                    const since = Number(queryOf(req).get('since')) || 0;
                    if (st.frame !== null && since === st.frame.rev) {
                        res.writeHead(304, { 'x-frame-rev': String(st.frame.rev) });
                        res.end();
                        return;
                    }
                    // 优先返回 screencast 最新帧（实时、零截图开销）；无帧时回退截图。
                    let data;
                    let width = 0;
                    let height = 0;
                    let rev = 0;
                    if (st.frame !== null) {
                        data = Buffer.from(st.frame.data, 'base64');
                        width = st.frame.width;
                        height = st.frame.height;
                        rev = st.frame.rev;
                    }
                    else {
                        // 画面兜底截图（无 screencast 帧时）。壳内视图此时必为 detached
                        // （贴合后由原生视图接管、不再走这里），等不到合成帧——renderer
                        // 截图快速尝试，仍无帧再走壳 capturePage 强制产帧兜底。
                        const base64 = st.shellMode
                            ? await screenshotWithFallback(st.session, sessionId, 90, 'jpeg', 1500)
                            : await captureScreenshotSafe(st.session, 90, 'jpeg', 1500);
                        data = Buffer.from(base64, 'base64');
                        // 截图兜底没有 screencast 帧尺寸，从视口读真实宽高——client 坐标
                        // 换算（x-frame-width/height）依赖它，缺失会导致选取坐标错位。
                        try {
                            const vp = await getViewportSize(st.session);
                            width = vp.width;
                            height = vp.height;
                        }
                        catch { /* 尺寸未知则保持 0，客户端按 1:1 兜底 */ }
                    }
                    res.writeHead(200, {
                        'content-type': 'image/jpeg',
                        'cache-control': 'no-store',
                        'x-frame-width': String(width),
                        'x-frame-height': String(height),
                        'x-frame-rev': String(rev),
                    });
                    res.end(data);
                }
                catch (e) {
                    json(res, 500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: frame route');
    // 交互回传：预览抽屉把用户鼠标/键盘/滚轮事件转发到 CDP Input 域，
    // 让屏幕外的有头浏览器也能在抽屉内「像真实浏览器一样」被直接操作
    // （Input 域按页面坐标派发真实事件，与窗口是否可见无关）。
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/input',
            handler: async (req, res) => {
                const respond = (status, payload) => {
                    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                };
                if (req.method !== 'POST')
                    return respond(405, { ok: false, error: '仅支持 POST' });
                try {
                    const body = await readJsonBody(req);
                    const live = runningState(res, body?.sessionId);
                    if (live === null)
                        return;
                    const { st, session } = live;
                    const x = Number(body.x);
                    const y = Number(body.y);
                    switch (body.type) {
                        case 'mouse': {
                            if (!Number.isFinite(x) || !Number.isFinite(y))
                                return respond(400, { ok: false, error: '坐标无效' });
                            const button = body.button === 'right' ? 'right' : body.button === 'middle' ? 'middle' : 'left';
                            if (body.event === 'move')
                                await dispatchMouseMove(session, x, y);
                            else if (body.event === 'down')
                                await dispatchMouseButton(session, 'mousePressed', x, y, button);
                            else if (body.event === 'up')
                                await dispatchMouseButton(session, 'mouseReleased', x, y, button);
                            else
                                await dispatchMouseClick(session, x, y);
                            break;
                        }
                        case 'wheel':
                            if (!Number.isFinite(x) || !Number.isFinite(y))
                                return respond(400, { ok: false, error: '坐标无效' });
                            await dispatchMouseWheel(session, x, y, Number(body.deltaX) || 0, Number(body.deltaY) || 0);
                            break;
                        case 'key':
                            await dispatchKey(session, String(body.key || ''), Array.isArray(body.modifiers) ? body.modifiers.map(String) : []);
                            break;
                        case 'text':
                            await insertText(session, String(body.text || ''));
                            break;
                        default:
                            return respond(400, { ok: false, error: '未知输入类型' });
                    }
                    respond(200, { ok: true });
                }
                catch (e) {
                    respond(500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: input route');
    // 元素选取：预览抽屉「选取元素」模式点击画面后，按视口坐标经 CDP
    // `document.elementFromPoint` 采集元素唯一选择器 + 摘要，回传给 client
    // 填入对话框。与 input 一样按页面坐标定位，和窗口可见性无关。
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/element',
            handler: async (req, res) => {
                const respond = (status, payload) => {
                    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                };
                if (req.method !== 'POST')
                    return respond(405, { ok: false, error: '仅支持 POST' });
                try {
                    const body = await readJsonBody(req);
                    const live = runningState(res, body?.sessionId);
                    if (live === null)
                        return;
                    const { st, session } = live;
                    const x = Number(body.x);
                    const y = Number(body.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y))
                        return respond(400, { ok: false, error: '坐标无效' });
                    const info = await inspectElementAt(session, x, y);
                    respond(200, { ok: true, ...info });
                }
                catch (e) {
                    respond(500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: element route');
    // 窗口贴合：把屏幕外的 app 窗口精确移到前端抽屉画面区的屏幕坐标上
    // （原生渲染 + 原生输入，对齐 openhanako 内置浏览器体验）；hide = 收回屏幕外。
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/view-bounds',
            handler: async (req, res) => {
                const respond = (status, payload) => {
                    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                };
                if (req.method !== 'POST')
                    return respond(405, { ok: false, error: '仅支持 POST' });
                try {
                    const body = await readJsonBody(req);
                    const live = runningState(res, body?.sessionId);
                    if (live === null)
                        return;
                    const { st, session, conn } = live;
                    const dpr = Number(body.dpr) || 1;
                    // ── 壳内视图模式：直接挂载/解除 WebContentsView（DIP = CSS px）──
                    if (st.shellMode) {
                        const cx = Number(body.x), cy = Number(body.y), cw = Number(body.w), ch = Number(body.h);
                        const show = [cx, cy, cw, ch].every(v => Number.isFinite(v)) && cw > 50 && ch > 50;
                        if (!show) {
                            // 选取模式（keepViewport）：detach 前先截一张 attach 状态的实时画面作
                            // 冻结帧——detach 后 WebContentsView 不再合成，截图/screencast 都会超时，
                            // 画面只能靠这张冻结帧兜底（否则选取模式画面会是「连接中」空屏）。
                            if (body.keepViewport === true) {
                                try {
                                    const base64 = await captureScreenshot(session, 90, 'jpeg', true);
                                    st.frame = {
                                        data: base64,
                                        width: st.viewport?.width ?? 0,
                                        height: st.viewport?.height ?? 0,
                                        ts: Date.now(),
                                        rev: (st.frame?.rev ?? 0) + 1,
                                    };
                                }
                                catch { /* 截图失败则画面保持上一帧 */ }
                            }
                            await bvPost('/view/detach', { sessionKey: st.bvKey });
                            st.attachedToDrawer = false;
                            // detach 后 WebContentsView 视口可能归零（初始未 attach 场景），用最近
                            // attach 尺寸 Emulation 覆写兜底，确保 elementFromPoint 命中。
                            if (body.keepViewport === true && st.viewport) {
                                try {
                                    await setViewport(session, st.viewport.width, st.viewport.height);
                                }
                                catch { /* 忽略 */ }
                            }
                            try {
                                await stopScreencast(session);
                            }
                            catch { }
                            releaseFrameStream(st);
                            return respond(200, { ok: true, hidden: true });
                        }
                        if (st.activeTabId == null || !st.tabTargets.has(st.activeTabId)) {
                            return respond(409, { ok: false, error: '无激活标签页' });
                        }
                        // attach 前清除视口覆写，恢复跟随真实视图；随后记录视口尺寸供选取模式使用。
                        try {
                            await clearViewport(session);
                        }
                        catch { /* 未覆写则忽略 */ }
                        const vw = Math.round(cw / dpr);
                        const vh = Math.round(ch / dpr);
                        await bvPost('/view/attach', {
                            sessionKey: st.bvKey,
                            tabId: st.activeTabId,
                            x: Math.round(cx / dpr),
                            y: Math.round(cy / dpr),
                            w: vw,
                            h: vh,
                        }, 3000);
                        st.viewport = { width: vw, height: vh };
                        st.attachedToDrawer = true;
                        st.drawerBounds = { x: Math.round(cx / dpr), y: Math.round(cy / dpr), w: vw, h: vh };
                        return respond(200, { ok: true, hidden: false, uiH: 0 });
                    }
                    const win = await conn.send('Browser.getWindowForTarget', { targetId: session.targetId });
                    if (win?.windowId == null)
                        return respond(500, { ok: false, error: '无法定位浏览器窗口' });
                    const x = Number(body.x);
                    const y = Number(body.y);
                    const w = Number(body.w);
                    const h = Number(body.h);
                    const show = [x, y, w, h].every(v => Number.isFinite(v) && v >= 0) && w > 50 && h > 50;
                    if (!show) {
                        // 收回屏幕外（保持尺寸，位置移出可视区），并停掉帧流。
                        await conn.send('Browser.setWindowBounds', {
                            windowId: win.windowId,
                            bounds: { left: -32000, top: -32000 },
                        });
                        try {
                            await stopScreencast(session);
                        }
                        catch { }
                        releaseFrameStream(st);
                        return respond(200, { ok: true, hidden: true });
                    }
                    // 首次贴合时测量「窗口外框 − 页面视口」的高度差（标题栏等 UI），
                    // 之后把 DOM 矩形向上补偿该高度，让页面视口正好落在抽屉画面区。
                    if (st.chromeUiHeight == null) {
                        try {
                            const inner = await evaluateJson(session, 'window.innerHeight', false);
                            st.chromeUiHeight = Math.max(0, Math.round(Number(win.bounds?.height) - Number(inner)));
                        }
                        catch {
                            st.chromeUiHeight = 0;
                        }
                    }
                    const uiH = st.chromeUiHeight ?? 0;
                    await conn.send('Browser.setWindowBounds', {
                        windowId: win.windowId,
                        bounds: {
                            left: Math.round(x),
                            top: Math.round(y - uiH),
                            width: Math.round(w),
                            height: Math.round(h + uiH),
                        },
                    });
                    // 真实窗口已贴合盖住画面区：停掉 screencast（帧编码/传输是常驻 CPU
                    // 大头，没人看时不该跑）。img 帧流只服务滑入动画的过渡期。
                    try {
                        await stopScreencast(session);
                    }
                    catch { }
                    releaseFrameStream(st);
                    respond(200, { ok: true, hidden: false, uiH });
                }
                catch (e) {
                    respond(500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: view-bounds route');
    // screencast 按需开关：只在抽屉滑入动画的过渡期开启（真实窗口贴合前给
    // img 帧流兜底），贴合成功/抽屉关闭即停——帧编码是常驻 CPU 大头，
    // 没人看时绝不推帧（对齐 openhanako「不看不渲染」的负载模型）。
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/screencast',
            handler: async (req, res) => {
                const respond = (status, payload) => {
                    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                };
                if (req.method !== 'POST')
                    return respond(405, { ok: false, error: '仅支持 POST' });
                try {
                    const body = await readJsonBody(req);
                    const live = runningState(res, body?.sessionId);
                    if (live === null)
                        return;
                    const { st, session } = live;
                    // 壳内视图模式：画面由原生 WebContentsView 呈现，帧流永远不需要。
                    if (st.shellMode)
                        return respond(200, { ok: true, on: body.on === true, shell: true });
                    if (body.on === true) {
                        ensureFrameStream(st);
                        await startScreencast(session, SCREENCAST_MAX_DIM, SCREENCAST_MAX_DIM, 85);
                    }
                    else {
                        await stopScreencast(session);
                        releaseFrameStream(st);
                    }
                    respond(200, { ok: true, on: body.on === true });
                }
                catch (e) {
                    respond(500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: screencast route');
    // ═══ 快捷标签网站：全局书签（跨会话共享，持久化 sites.json）+ 直接导航 ═══
    const sitesFile = path.join(dataRoot, 'sites.json');
    function loadSites() {
        try {
            const parsed = JSON.parse(fs.readFileSync(sitesFile, 'utf8'));
            if (Array.isArray(parsed?.sites)) {
                return parsed.sites.filter((s) => s && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.url === 'string');
            }
        }
        catch { /* 无文件/损坏 → 默认集 */ }
        return [
            { id: 'gh', title: 'GitHub', url: 'https://github.com' },
            { id: 'bing', title: 'Bing', url: 'https://www.bing.com' },
        ];
    }
    function saveSites(sites) {
        try {
            fs.mkdirSync(dataRoot, { recursive: true });
            fs.writeFileSync(sitesFile, JSON.stringify({ sites }, null, 2) + '\n');
        }
        catch { /* 持久化失败不影响运行 */ }
    }
    function normalizeSiteUrl(raw) {
        let u = String(raw || '').trim();
        if (u === '')
            return null;
        if (!/^https?:\/\//i.test(u))
            u = `https://${u}`;
        try {
            const parsed = new URL(u);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
                return null;
            return parsed.toString();
        }
        catch {
            return null;
        }
    }
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/sites',
            handler: async (req, res) => {
                const respond = (status, payload) => {
                    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                };
                try {
                    if (req.method === 'GET')
                        return respond(200, { ok: true, sites: loadSites() });
                    if (req.method !== 'POST')
                        return respond(405, { ok: false, error: '仅支持 GET/POST' });
                    const body = await readJsonBody(req);
                    const sites = loadSites();
                    if (body?.action === 'add') {
                        const title = String(body.title || '').trim().slice(0, 40);
                        const url = normalizeSiteUrl(String(body.url || ''));
                        if (title === '' || url === null)
                            return respond(400, { ok: false, error: 'title/url 无效' });
                        const site = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, url };
                        sites.push(site);
                        saveSites(sites);
                        return respond(200, { ok: true, site, sites });
                    }
                    if (body?.action === 'remove') {
                        const id = String(body.id || '');
                        const next = sites.filter(s => s.id !== id);
                        saveSites(next);
                        return respond(200, { ok: true, sites: next });
                    }
                    return respond(400, { ok: false, error: '未知 action' });
                }
                catch (e) {
                    respond(500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: sites route');
    // 直接导航：前端点标签后让当前会话的内嵌浏览器打开该站点（浏览器未启动则自动拉起）。
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/navigate',
            handler: async (req, res) => {
                const respond = (status, payload) => {
                    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                };
                if (req.method !== 'POST')
                    return respond(405, { ok: false, error: '仅支持 POST' });
                try {
                    const body = await readJsonBody(req);
                    if (!body || typeof body.sessionId !== 'string' || body.sessionId === '') {
                        return respond(400, { ok: false, error: 'sessionId 缺失' });
                    }
                    const url = normalizeSiteUrl(String(body.url || ''));
                    if (url === null)
                        return respond(400, { ok: false, error: 'url 无效' });
                    const sessionId = body.sessionId;
                    // UI 导航同样改变页面/激活 target，必须与 AI 工具调用串行（否则会
                    // 在工具的 scrollIntoView 与点击之间把页面换掉）。
                    const result = await withLock(sessionId, async () => {
                        // requireSession 内含自动启动（壳内视图/独立窗口两种模式均适用）
                        const st = ensureState(sessionId);
                        const session = await requireSession(sessionId);
                        if (body.newTab === true && st.shellMode) {
                            // 快捷标签点击：新开标签页打开，不打断 AI 正在操作的页面
                            await shellNewTab(sessionId, st, url);
                            ensureActivity(sessionId).url = url;
                            return { ok: true, url, newTab: true };
                        }
                        const info = await navigateAndWait(session, url, NAV_TIMEOUT_MS);
                        const act = ensureActivity(sessionId);
                        act.url = info.url;
                        act.title = info.title;
                        log(sessionId, 'navigate', `site-bar → ${url}`);
                        return { ok: true, url: info.url, title: info.title };
                    });
                    respond(200, result);
                }
                catch (e) {
                    respond(500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: navigate route');
    // 地址栏工具条：后退 / 前进 / 刷新（用户在抽屉里直接操作页面导航）。
    // 与工具调用共用会话锁，避免在 AI 操作中途把页面换掉。
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/control',
            handler: async (req, res) => {
                if (req.method !== 'POST')
                    return json(res, 405, { ok: false, error: '仅支持 POST' });
                try {
                    const body = await readJsonBody(req);
                    const live = runningState(res, body?.sessionId);
                    if (live === null)
                        return;
                    const { session } = live;
                    const sessionId = String(body.sessionId);
                    const action = String(body?.action || '');
                    const result = await withLock(sessionId, async () => {
                        if (action === 'back')
                            return navigateHistory(session, -1);
                        if (action === 'forward')
                            return navigateHistory(session, 1);
                        if (action === 'reload')
                            return reloadPage(session, body?.hard === true);
                        throw new Error('未知 action（back / forward / reload）');
                    });
                    const act = ensureActivity(sessionId);
                    act.url = result.url;
                    act.title = result.title;
                    log(sessionId, action, result.url);
                    json(res, 200, { ok: true, ...result });
                }
                catch (e) {
                    json(res, 200, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: control route');
    // 壳内标签页管理：列表 / 切换 / 关闭 / 新建（仅壳内视图模式）。
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/tabs',
            handler: async (req, res) => {
                const respond = (status, payload) => {
                    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                };
                try {
                    if (req.method === 'GET') {
                        const sessionId = queryOf(req).get('sessionId') || 'default';
                        const st = sessions.get(sessionId);
                        if (!st?.shellMode)
                            return respond(200, { ok: true, tabs: [], activeTabId: null, shell: false });
                        return respond(200, { ok: true, tabs: await shellTabsInfo(st), activeTabId: st.activeTabId, shell: true });
                    }
                    if (req.method !== 'POST')
                        return respond(405, { ok: false, error: '仅支持 GET/POST' });
                    const body = await readJsonBody(req);
                    const sessionId = String(body?.sessionId || '');
                    const st = ensureState(sessionId);
                    if (!st.shellMode)
                        return respond(400, { ok: false, error: '当前非壳内视图模式' });
                    const action = String(body?.action || '');
                    // 标签切换/新建/关闭会改变激活 target；与 AI 工具调用串行，避免工具
                    // 在「定位元素」和「点击」之间被换掉页面。
                    const result = await withLock(sessionId, async () => {
                        if (action === 'switch') {
                            const tabId = String(body.tabId || '');
                            if (!st.tabTargets.has(tabId))
                                return { status: 404, payload: { ok: false, error: '标签不存在' } };
                            st.activeTabId = tabId;
                            await syncActiveTabSession(st);
                            await reattachActiveTab(st);
                            tabsCache.delete(st.bvKey);
                            log(sessionId, 'switch-tab', tabId);
                            return { status: 200, payload: { ok: true, activeTabId: tabId } };
                        }
                        if (action === 'close') {
                            const tabId = String(body.tabId || '');
                            if (!st.tabTargets.has(tabId))
                                return { status: 404, payload: { ok: false, error: '标签不存在' } };
                            const r = await bvPost('/view/close-tab', { sessionKey: st.bvKey, tabId }, 3000);
                            st.tabTargets.delete(tabId);
                            // 激活标签被关 → 壳子已自动切到剩余第一个；同步映射与 session
                            if (r?.activeTabId != null && r.activeTabId !== st.activeTabId) {
                                st.activeTabId = String(r.activeTabId);
                            }
                            if (!st.tabTargets.has(st.activeTabId ?? '')) {
                                st.activeTabId = st.tabTargets.keys().next().value ?? null;
                            }
                            await syncActiveTabSession(st);
                            // 关的是激活标签：壳子已把它从窗口摘除，画面区空了——立即挂上新的激活标签
                            await reattachActiveTab(st);
                            tabsCache.delete(st.bvKey);
                            log(sessionId, 'close-tab', `${tabId} (remaining=${st.tabTargets.size})`);
                            // 全部关闭：等同停止浏览器
                            if (st.tabTargets.size === 0) {
                                await stopBrowserFor(sessionId);
                                return { status: 200, payload: { ok: true, closedAll: true } };
                            }
                            return { status: 200, payload: { ok: true, activeTabId: st.activeTabId } };
                        }
                        if (action === 'new') {
                            const url = body.url != null && String(body.url) !== '' ? normalizeSiteUrl(String(body.url)) : '';
                            if (body.url != null && String(body.url) !== '' && url == null) {
                                return { status: 400, payload: { ok: false, error: 'url 无效' } };
                            }
                            const tabId = await shellNewTab(sessionId, st, url ?? undefined);
                            tabsCache.delete(st.bvKey);
                            return { status: 200, payload: { ok: true, tabId } };
                        }
                        return { status: 400, payload: { ok: false, error: '未知 action' } };
                    });
                    return respond(result.status, result.payload);
                }
                catch (e) {
                    respond(500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: tabs route');
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/status',
            handler: async (req, res) => {
                try {
                    const sessionId = queryOf(req).get('sessionId');
                    if (sessionId) {
                        const st = sessions.get(sessionId);
                        if (!st) {
                            json(res, 200, { ok: true, sessionId, running: false, url: '', title: '', tabCount: 0, activeTabId: null, port: null, headed: true, log: [] });
                            return;
                        }
                        const body = JSON.stringify({ ok: true, sessionId, ...(await statusFieldsFor(sessionId)), log: st.log.slice(-10) });
                        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                        res.end(body);
                        return;
                    }
                    // 无 sessionId：返回所有会话的汇总状态
                    const all = [];
                    for (const id of sessions.keys()) {
                        const st = sessions.get(id);
                        if (!st)
                            continue;
                        all.push({ sessionId: id, ...(await statusFieldsFor(id)), log: st.log.slice(-10) });
                    }
                    json(res, 200, { ok: true, sessions: all });
                }
                catch (e) {
                    json(res, 500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: status route');
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/screenshot',
            handler: async (req, res) => {
                try {
                    const sessionId = queryOf(req).get('sessionId') || 'default';
                    const fileName = queryOf(req).get('file');
                    const st = sessions.get(sessionId);
                    let filePath = null;
                    if (fileName !== null && st !== undefined) {
                        // 只接受纯 basename（防路径穿越），从该会话的截图目录读取指定文件。
                        const base = path.basename(fileName);
                        if (base === fileName)
                            filePath = path.join(st.screenshotDir, base);
                    }
                    else if (st?.lastScreenshotPath) {
                        filePath = st.lastScreenshotPath;
                    }
                    if (!filePath || !fs.existsSync(filePath)) {
                        json(res, 404, { ok: false, error: 'no screenshot yet' });
                        return;
                    }
                    const data = fs.readFileSync(filePath);
                    // 元素截图可能是 png（旧版一律按 jpeg 返回，浏览器/视觉模型都可能拒读）。
                    const mime = filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
                    // 文件名含时间戳、内容不变，可安全长缓存（抽屉里重复展示不再重复传输）。
                    res.writeHead(200, { 'content-type': mime, 'cache-control': 'private, max-age=86400' });
                    res.end(data);
                }
                catch (e) {
                    json(res, 500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: screenshot route');
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-browser/allow',
            handler: async (req, res) => {
                const respond = (status, payload) => {
                    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                };
                try {
                    if (req.method === 'POST') {
                        // 读 body
                        const body = await readJsonBody(req);
                        if (!body || typeof body.allow !== 'boolean')
                            return respond(400, { ok: false, error: 'allow 须为布尔值' });
                        allowBrowser = body.allow;
                        savePrefs();
                        return respond(200, { ok: true, allow: allowBrowser });
                    }
                    respond(200, { ok: true, allow: allowBrowser });
                }
                catch (e) {
                    respond(500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: allow route');
    ctx.logger?.info?.('[dsh-browser] loaded (headed, port=' + config.port + ', per-session isolation)');
}
//# sourceMappingURL=index.js.map