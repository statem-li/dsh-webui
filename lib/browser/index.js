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
import { CdpConnection, attachTarget, listPageTargets, navigateAndWait, navigateHistory, waitForPageReady, captureScreenshot, captureScreenshotSafe, fetchBrowserWsUrl, evaluateJson, inspectElementAt, getViewportSize, setViewport, clearViewport, dispatchKey, dispatchMouseMove, dispatchMouseClick, dispatchMouseButton, dispatchMouseWheel, insertText, startScreencast, stopScreencast, } from './cdp.js';
import { killChrome, } from './chrome.js';
import { getSnapshot, clickRef, typeRef, hoverRef, selectRef, scrollPage, waitForSettle, } from './snapshot.js';
export const name = '@dsh-external/dsh-browser';
export const inject = ['tools', 'webServer', 'fs', 'sandboxPolicy'];
export const Config = z.object({
    chromePath: z.string().default(''),
    port: z.number().default(0),
    screenshotDir: z.string().default(''),
});
const MAX_LOG = 200;
const MAX_STEPS = 50;
const NAV_TIMEOUT_MS = 30000;
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
                runtime: null, conn: null, session: null, screenshotDir: '', lastScreenshotPath: null,
                log: [], frame: null, offFrame: null, chromeUiHeight: null,
                shellMode: false,
                bvKey: sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'default',
                tabTargets: new Map(),
                activeTabId: null,
                viewport: null,
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
        }
    }
    /** 服务重启后 CDP 重连：壳内视图还活着，用 window.name 标记重建 tabId↔target 映射。 */
    async function rebindShellTabs(st) {
        const prefix = `dshbv-${st.bvKey}/`;
        const conn = st.conn;
        if (!conn?.connected)
            return false;
        try {
            const pages = await listPageTargets(conn);
            for (const p of pages) {
                try {
                    const s = await attachTarget(conn, p.targetId);
                    const name = await evaluateJson(s, 'window.name', false);
                    if (typeof name === 'string' && name.startsWith(prefix)) {
                        const tabId = name.slice(prefix.length);
                        if (tabId !== '')
                            st.tabTargets.set(tabId, p.targetId);
                    }
                }
                catch { /* 单个 target 失败忽略 */ }
            }
        }
        catch {
            return false;
        }
        return st.tabTargets.size > 0;
    }
    /** 壳内新建标签页（可选直接导航），并设为激活标签。 */
    async function shellNewTab(sessionId, st, navigateUrl) {
        const conn = st.conn;
        if (!conn?.connected)
            throw new Error('壳内 CDP 未连接');
        const tabId = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        await bvPost('/view/create-tab', { sessionKey: st.bvKey, tabId }, 3000);
        let targetId = null;
        for (let i = 0; i < 50; i++) {
            try {
                const pages = await listPageTargets(conn);
                const hit = pages.find(p => p.url.includes(`#dshbv-${st.bvKey}/${tabId}`));
                if (hit) {
                    targetId = hit.targetId;
                    break;
                }
            }
            catch { /* CDP 未就绪，重试 */ }
            await new Promise((r) => setTimeout(r, 120));
        }
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
        if (navigateUrl != null && navigateUrl !== '') {
            await navigateAndWait(st.session, navigateUrl, NAV_TIMEOUT_MS);
        }
        log(sessionId, 'new-tab', `${tabId}${navigateUrl ? ' → ' + navigateUrl : ''}`);
        return tabId;
    }
    /** 壳内标签列表（title/url 来自 CDP target 信息）。 */
    async function shellTabsInfo(st) {
        if (!st.conn?.connected || st.tabTargets.size === 0)
            return [];
        let pages = [];
        try {
            pages = await listPageTargets(st.conn);
        }
        catch {
            return [];
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
            const rebound = await rebindShellTabs(st);
            if (rebound) {
                if (st.activeTabId == null || !st.tabTargets.has(st.activeTabId)) {
                    st.activeTabId = st.tabTargets.keys().next().value ?? null;
                }
                await syncActiveTabSession(st);
                log(sessionId, 'start', `shell embedded views rebound (${st.tabTargets.size} tabs)`);
                return { ok: true, shell: true, ...(await statusFieldsFor(sessionId)) };
            }
            // 全新会话：创建第一个标签页
            const tabId = 't' + Date.now().toString(36);
            await bvPost('/view/create-tab', { sessionKey: st.bvKey, tabId }, 3000);
            let targetId = null;
            for (let i = 0; i < 50; i++) {
                try {
                    const pages = await listPageTargets(conn);
                    const hit = pages.find(p => p.url.includes(`#dshbv-${st.bvKey}/${tabId}`));
                    if (hit) {
                        targetId = hit.targetId;
                        break;
                    }
                }
                catch { /* CDP 尚未就绪，重试 */ }
                await new Promise((r) => setTimeout(r, 120));
            }
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
        log(sessionId, 'ready', `shell-cdp:${shellCdpPort()}`);
        return { ok: true, shell: true, ...(await statusFieldsFor(sessionId)) };
    }
    async function stopBrowserFor(sessionId) {
        const st = sessions.get(sessionId);
        if (!st)
            return { ok: true, running: false };
        if (st.offFrame) {
            try {
                st.offFrame();
            }
            catch { }
        }
        st.offFrame = null;
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
    async function statusFieldsFor(sessionId) {
        const st = ensureState(sessionId);
        // 运行判定：壳内视图模式看 CDP 连接与视图会话；独立窗口模式看进程存活。
        const running = st.shellMode
            ? !!st.conn?.connected && !!st.session
            : !!st.runtime && !st.runtime.proc.killed && !!st.conn?.connected;
        let url = '';
        let title = '';
        let refCount = 0;
        if (running && st.session) {
            try {
                const snap = await getSnapshot(st.session);
                url = snap.url;
                title = snap.title;
                refCount = snap.refCount;
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
            refCount,
            port: st.runtime?.port ?? null,
            headed: true,
        };
    }
    /**
     * 操作后的统一收尾：等 DOM 静默（或等导航后的页面就绪），再返回最新快照。
     * 这是减少「快照陈旧 → 模型反复重试」的关键。
     */
    async function settleAndSnapshot(session, sessionId) {
        const st = await waitForSettle(session, SETTLE_IDLE_MS, SETTLE_TIMEOUT_MS);
        if (st.nav) {
            await waitForPageReady(session, NAV_TIMEOUT_MS);
        }
        const snap = await snapshotFor(session, sessionId);
        return {
            snapshot: snap.text,
            url: snap.url,
            title: snap.title,
            refCount: snap.refCount,
            navigated: st.nav,
        };
    }
    // ═══ 工具注册（ctx.effect：fiber dispose 自动注销）═══
    const tools = [
        defineTool({
            name: 'browser_start',
            description: '启动 AI 专用浏览器（每会话独立实例、登录态隔离，有头渲染但窗口在屏幕外不弹窗，画面同步到 Web GUI 右侧滑出的预览抽屉、可在抽屉内直接操作）。AI 操作浏览器前第一步调用；重复调用返回当前状态。',
            parameters: {},
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(_args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_start', '启动浏览器', '');
                try {
                    return await startBrowserFor(sessionId);
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_navigate',
            description: '在浏览器打开 URL 并等待加载（load + 网络空闲），返回页面 ref 树。',
            parameters: {
                url: { type: 'string', required: true, description: '要打开的网址（http/https）' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const url = String(args.url).trim();
                const step = beginActivity(sessionId, 'browser_navigate', '打开网页', '');
                try {
                    if (!/^https?:\/\//i.test(url))
                        throw new Error('仅支持 http/https 地址');
                    const session = await requireSession(sessionId);
                    const info = await navigateAndWait(session, url, NAV_TIMEOUT_MS);
                    step.label = `打开 ${(() => { try {
                        return new URL(info.url).hostname;
                    }
                    catch {
                        return info.url;
                    } })()}`;
                    const snap = await snapshotFor(session, sessionId);
                    log(sessionId, 'navigate', url);
                    return { ok: true, url: info.url, title: info.title, snapshot: snap.text };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_snapshot',
            description: '获取当前页面 ref 树：元素以 [ref] 定位。页面变化后 ref 失效，操作前先获取最新 snapshot。',
            parameters: {},
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(_args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_snapshot', '读取页面内容', '');
                try {
                    const session = await requireSession(sessionId);
                    const snap = await snapshotFor(session, sessionId);
                    return { ok: true, url: snap.url, title: snap.title, snapshot: snap.text };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_click',
            description: '点击页面元素（ref 来自最新 snapshot），返回操作后最新 snapshot。连续操作已知不变的页面时，可设 returnSnapshot=false 跳过快照以提速。',
            parameters: {
                ref: { type: 'number', required: true, description: 'snapshot 中的 [ref] 编号' },
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_click', '点击页面元素', '');
                try {
                    const session = await requireSession(sessionId);
                    const t = await clickRef(session, Number(args.ref));
                    step.label = `点击${posWord(t.x, t.y, t.vw, t.vh)}${targetWord(t.tag, t.text)}`;
                    log(sessionId, 'click', step.label);
                    if (args.returnSnapshot === false)
                        return { ok: true };
                    return { ok: true, ...(await settleAndSnapshot(session, sessionId)) };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_type',
            description: '向输入框输入文本（ref 来自最新 snapshot）。对下拉框 select 也会按文本/值选择。返回操作后最新 snapshot；可设 returnSnapshot=false 跳过。',
            parameters: {
                ref: { type: 'number', required: true, description: 'snapshot 中的 [ref] 编号' },
                text: { type: 'string', required: true, description: '要输入的文本' },
                pressEnter: { type: 'boolean', description: '输入后按回车（提交表单/搜索），默认 false' },
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_type', '输入文本', '');
                try {
                    const session = await requireSession(sessionId);
                    await typeRef(session, Number(args.ref), String(args.text), args.pressEnter === true);
                    step.label = `输入「${shortText(String(args.text))}」${args.pressEnter === true ? '并回车' : ''}`;
                    log(sessionId, 'type', `ref=${args.ref} enter=${!!args.pressEnter}`);
                    if (args.returnSnapshot === false)
                        return { ok: true };
                    return { ok: true, ...(await settleAndSnapshot(session, sessionId)) };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_select',
            description: '在下拉框 select 中选择一个选项（按选项值或可见文本匹配）。ref 来自最新 snapshot。',
            parameters: {
                ref: { type: 'number', required: true, description: 'snapshot 中 select 元素的 [ref] 编号' },
                value: { type: 'string', required: true, description: '要选择的选项值或可见文本' },
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_select', '选择下拉选项', '');
                try {
                    const session = await requireSession(sessionId);
                    await selectRef(session, Number(args.ref), String(args.value));
                    step.label = `选择「${shortText(String(args.value), 16)}」`;
                    log(sessionId, 'select', `ref=${args.ref} value=${args.value}`);
                    if (args.returnSnapshot === false)
                        return { ok: true };
                    return { ok: true, ...(await settleAndSnapshot(session, sessionId)) };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_hover',
            description: '将鼠标悬停到元素上（ref 来自最新 snapshot），用于触发 hover 菜单/下拉/提示。返回操作后最新 snapshot。',
            parameters: {
                ref: { type: 'number', required: true, description: 'snapshot 中的 [ref] 编号' },
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_hover', '悬停元素', `ref=${args.ref}`);
                try {
                    const session = await requireSession(sessionId);
                    await hoverRef(session, Number(args.ref));
                    log(sessionId, 'hover', `ref=${args.ref}`);
                    if (args.returnSnapshot === false)
                        return { ok: true };
                    return { ok: true, ...(await settleAndSnapshot(session, sessionId)) };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_press',
            description: '发送键盘按键（真实按键事件），如 Escape 关闭弹窗、Enter 确认、箭头键、以及 ctrl+a 等组合键。返回操作后最新 snapshot。',
            parameters: {
                key: { type: 'string', required: true, description: '按键名：Enter / Escape / Tab / Backspace / Delete / ArrowUp / ArrowDown / ArrowLeft / ArrowRight / Home / End / PageUp / PageDown，或单字符' },
                modifiers: { type: 'array', items: { type: 'string' }, description: '修饰键数组：ctrl / shift / alt / meta，如 ["ctrl"] 配 key="a" 表示 Ctrl+A' },
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_press', '按键', '');
                try {
                    const session = await requireSession(sessionId);
                    const mods = Array.isArray(args.modifiers) ? args.modifiers : [];
                    await dispatchKey(session, String(args.key), mods);
                    step.label = `按 ${mods.map((m) => `${m}+`).join('')}${args.key}`.replace(/^按 \+/, '按 ');
                    log(sessionId, 'press', String(args.key));
                    if (args.returnSnapshot === false)
                        return { ok: true };
                    return { ok: true, ...(await settleAndSnapshot(session, sessionId)) };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_batch',
            description: '在一次调用中按顺序执行多个页面动作（点击/输入/选择下拉/悬停/按键/滚动/导航），全程只返回最终页面快照——适合「填完整个表单再提交」这类连续操作，比逐个调用快得多。任一步骤失败立即中止（报错含步骤序号与原因）。最多 10 个动作。',
            parameters: {
                actions: {
                    type: 'array',
                    required: true,
                    description: '动作数组，按顺序执行，最多 10 项。每项为对象：{"action":"click","ref":5}；{"action":"type","ref":2,"text":"文本","pressEnter":true}；{"action":"select","ref":3,"value":"选项"}；{"action":"hover","ref":4}；{"action":"press","key":"Enter"}；{"action":"scroll","direction":"down","amount":3}；{"action":"navigate","url":"https://…"}',
                },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const actions = Array.isArray(args.actions) ? args.actions : [];
                if (actions.length === 0)
                    return { ok: false, error: 'actions 不能为空' };
                if (actions.length > 10)
                    return { ok: false, error: '单次最多 10 个动作' };
                const step = beginActivity(sessionId, 'browser_batch', `批量执行 ${actions.length} 个动作`, '');
                const labels = [];
                try {
                    const session = await requireSession(sessionId);
                    for (let i = 0; i < actions.length; i++) {
                        const a = (actions[i] ?? {});
                        const kind = String(a.action || '');
                        switch (kind) {
                            case 'click': {
                                const t = await clickRef(session, Number(a.ref));
                                labels.push(`点击${posWord(t.x, t.y, t.vw, t.vh)}${targetWord(t.tag, t.text)}`);
                                break;
                            }
                            case 'type': {
                                await typeRef(session, Number(a.ref), String(a.text ?? ''), a.pressEnter === true);
                                labels.push(`输入「${shortText(String(a.text))}」${a.pressEnter === true ? '并回车' : ''}`);
                                break;
                            }
                            case 'select': {
                                await selectRef(session, Number(a.ref), String(a.value ?? ''));
                                labels.push(`选择「${shortText(String(a.value), 16)}」`);
                                break;
                            }
                            case 'hover': {
                                const t = await hoverRef(session, Number(a.ref));
                                labels.push(`悬停${targetWord(t.tag, t.text)}`);
                                break;
                            }
                            case 'press': {
                                const mods = Array.isArray(a.modifiers) ? a.modifiers.map(String) : [];
                                await dispatchKey(session, String(a.key ?? ''), mods);
                                labels.push(`按 ${mods.map((m) => m + '+').join('')}${a.key}`);
                                break;
                            }
                            case 'scroll': {
                                const dir = ['up', 'down', 'left', 'right'].includes(String(a.direction)) ? String(a.direction) : 'down';
                                await scrollPage(session, dir, Number(a.amount) || 3);
                                labels.push(`${dir === 'up' ? '向上' : dir === 'down' ? '向下' : dir === 'left' ? '向左' : '向右'}滚动`);
                                break;
                            }
                            case 'navigate': {
                                const url = normalizeSiteUrl(String(a.url ?? ''));
                                if (url === null)
                                    throw new Error(`第 ${i + 1} 步 url 无效`);
                                const info = await navigateAndWait(session, url, NAV_TIMEOUT_MS);
                                labels.push(`打开 ${(() => { try {
                                    return new URL(info.url).hostname;
                                }
                                catch {
                                    return url;
                                } })()}`);
                                break;
                            }
                            default:
                                throw new Error(`第 ${i + 1} 步未知动作: ${kind || '(空)'}`);
                        }
                    }
                    step.label = `批量：${labels.join(' → ')}`;
                    log(sessionId, 'batch', `${actions.length} actions ok`);
                    return { ok: true, actions: labels, ...(await settleAndSnapshot(session, sessionId)) };
                }
                catch (e) {
                    step.label = `批量：${labels.join(' → ')}` + (labels.length > 0 ? ' → ' : '');
                    finishActivity(sessionId, step, 'error', `第 ${labels.length + 1} 步失败: ${String(e?.message || e).slice(0, 150)}`);
                    return { ok: false, done: labels, error: `第 ${labels.length + 1} 步失败: ${String(e?.message || e)}` };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_scroll',
            description: '滚动当前页面，返回操作后最新 snapshot（滚动可能触发懒加载，会等 DOM 稳定）。',
            parameters: {
                direction: { type: 'string', required: true, description: 'up / down / left / right' },
                amount: { type: 'number', description: '滚动步数（默认 3）' },
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_scroll', '滚动页面', '');
                try {
                    const dir = String(args.direction);
                    if (!['up', 'down', 'left', 'right'].includes(dir))
                        throw new Error('direction 须为 up/down/left/right');
                    const session = await requireSession(sessionId);
                    await scrollPage(session, dir, Number(args.amount) || 3);
                    step.label = `${dir === 'up' ? '向上' : dir === 'down' ? '向下' : dir === 'left' ? '向左' : '向右'}滚动页面`;
                    log(sessionId, 'scroll', dir);
                    if (args.returnSnapshot === false)
                        return { ok: true };
                    return { ok: true, ...(await settleAndSnapshot(session, sessionId)) };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_back',
            description: '浏览器后退一页，返回新页面 snapshot。',
            parameters: {
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_back', '后退一页', '');
                try {
                    const session = await requireSession(sessionId);
                    const info = await navigateHistory(session, -1);
                    log(sessionId, 'back', info.url);
                    if (args.returnSnapshot === false)
                        return { ok: true, ...info };
                    const snap = await snapshotFor(session, sessionId);
                    return { ok: true, ...info, snapshot: snap.text };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_forward',
            description: '浏览器前进一页，返回新页面 snapshot。',
            parameters: {
                returnSnapshot: { type: 'boolean', description: '是否返回操作后快照（默认 true）' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_forward', '前进一页', '');
                try {
                    const session = await requireSession(sessionId);
                    const info = await navigateHistory(session, 1);
                    log(sessionId, 'forward', info.url);
                    if (args.returnSnapshot === false)
                        return { ok: true, ...info };
                    const snap = await snapshotFor(session, sessionId);
                    return { ok: true, ...info, snapshot: snap.text };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_evaluate',
            description: '在页面执行 JavaScript 表达式并返回结果（JSON 序列化）。用于处理 ref 树定位不到的元素（弹窗、iframe、自定义控件）。',
            parameters: {
                expression: { type: 'string', required: true, description: '要执行的 JS 表达式，返回 JSON 可序列化的值' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_evaluate', '执行页面脚本', '');
                try {
                    const session = await requireSession(sessionId);
                    const value = await evaluateJson(session, String(args.expression));
                    log(sessionId, 'evaluate', String(args.expression).slice(0, 120));
                    return { ok: true, value };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_see',
            description: '截取当前页面并用辅助视觉模型描述画面，同时返回最新 ref 树。当 ref 树定位不到元素（图标按钮、canvas、验证码、复杂布局、无文本控件）或需要理解页面整体画面时使用，一步拿到「视觉描述 + 可操作 ref 树」。',
            parameters: {
                prompt: { type: 'string', description: '可选的视觉描述要求（默认聚焦可操作元素与布局）' },
            },
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_see', '查看页面画面', '');
                try {
                    const session = await requireSession(sessionId);
                    const st = ensureState(sessionId);
                    const base64 = await captureScreenshotSafe(session);
                    const file = path.join(st.screenshotDir, `see-${Date.now()}.jpg`);
                    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
                    st.lastScreenshotPath = file;
                    // 视觉描述：复用 vision-helper 暴露的 cordis 服务（未装则降级为纯 ref 树）
                    let vision = '';
                    let visionModel = '';
                    let visionError = '';
                    const describeFn = ctx.get('vision-describe');
                    if (typeof describeFn === 'function') {
                        try {
                            const prompt = String(args.prompt || '').trim() || DEFAULT_SEE_PROMPT;
                            // 60s 超时：视觉模型无响应时降级为纯 ref 树，不卡死工具调用
                            const res = await Promise.race([
                                describeFn(file, prompt),
                                new Promise((_, rej) => setTimeout(() => rej(new Error('视觉描述超时（60s）')), 60000)),
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
                    const fileName = path.basename(file);
                    return {
                        ok: true,
                        url: snap.url,
                        title: snap.title,
                        snapshot: snap.text,
                        vision,
                        visionModel,
                        screenshot: file,
                        imageUrl: `/api/dsh-browser/screenshot?sessionId=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(fileName)}`,
                        ...(visionError ? { visionError } : {}),
                    };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_screenshot',
            description: '截图保存为文件并返回路径。需要看页面画面（图表/验证码/布局）时，用 vision_describe 读取该路径。',
            parameters: {},
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(_args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_screenshot', '截取页面截图', '');
                try {
                    const session = await requireSession(sessionId);
                    const st = ensureState(sessionId);
                    const base64 = await captureScreenshotSafe(session);
                    const file = path.join(st.screenshotDir, `shot-${Date.now()}.jpg`);
                    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
                    st.lastScreenshotPath = file;
                    log(sessionId, 'screenshot', file);
                    const fileName = path.basename(file);
                    return {
                        ok: true,
                        path: file,
                        imageUrl: `/api/dsh-browser/screenshot?sessionId=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(fileName)}`,
                        bytes: fs.statSync(file).size,
                        hint: '如需看图内容，调用 vision_describe，image 参数传此路径',
                    };
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_stop',
            description: '关闭当前会话的浏览器实例。',
            parameters: {},
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
            async execute(_args, exec) {
                const sessionId = sessionIdOf(exec);
                const step = beginActivity(sessionId, 'browser_stop', '关闭浏览器', '');
                try {
                    return await stopBrowserFor(sessionId);
                }
                catch (e) {
                    finishActivity(sessionId, step, 'error', String(e?.message || e));
                    return { ok: false, error: String(e?.message || e) };
                }
                finally {
                    finishActivity(sessionId, step, 'done');
                }
            },
        }),
        defineTool({
            name: 'browser_status',
            description: '查询当前会话浏览器运行状态（运行中/URL/标题/元素数）。',
            parameters: {},
            output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
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
                        const running = st?.shellMode
                            ? !!st.conn?.connected && !!st.session
                            : !!st?.runtime && !st.runtime.proc.killed && !!st?.conn?.connected;
                        if (!running)
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
                    json(res, 200, {
                        ok: true,
                        sessionId,
                        active: act?.active ?? false,
                        running: st?.shellMode
                            ? !!st.conn?.connected && !!st.session
                            : !!st?.runtime && !st.runtime.proc.killed && !!st?.conn?.connected,
                        url: act?.url ?? '',
                        title: act?.title ?? '',
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
                        // （贴合后由原生视图接管、不再走这里），等不到合成帧——直接 renderer
                        // 截图，避免 surface 尝试卡满超时导致预览/选取画面延迟。
                        const base64 = st.shellMode
                            ? await captureScreenshot(st.session, 90, 'jpeg', false)
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
                    const body = await new Promise((resolve) => {
                        let raw = '';
                        req.on('data', (chunk) => { raw += chunk; });
                        req.on('end', () => {
                            try {
                                resolve(JSON.parse(raw || '{}'));
                            }
                            catch {
                                resolve(null);
                            }
                        });
                        req.on('error', () => resolve(null));
                    });
                    if (!body || typeof body.sessionId !== 'string' || body.sessionId === '') {
                        return respond(400, { ok: false, error: 'sessionId 缺失' });
                    }
                    const st = sessions.get(body.sessionId);
                    if (!st?.conn?.connected || !st?.session)
                        return respond(404, { ok: false, error: '浏览器未运行' });
                    const session = st.session;
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
                    const body = await new Promise((resolve) => {
                        let raw = '';
                        req.on('data', (chunk) => { raw += chunk; });
                        req.on('end', () => {
                            try {
                                resolve(JSON.parse(raw || '{}'));
                            }
                            catch {
                                resolve(null);
                            }
                        });
                        req.on('error', () => resolve(null));
                    });
                    if (!body || typeof body.sessionId !== 'string' || body.sessionId === '') {
                        return respond(400, { ok: false, error: 'sessionId 缺失' });
                    }
                    const st = sessions.get(body.sessionId);
                    if (!st?.conn?.connected || !st?.session)
                        return respond(404, { ok: false, error: '浏览器未运行' });
                    const x = Number(body.x);
                    const y = Number(body.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y))
                        return respond(400, { ok: false, error: '坐标无效' });
                    const info = await inspectElementAt(st.session, x, y);
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
                    const body = await new Promise((resolve) => {
                        let raw = '';
                        req.on('data', (chunk) => { raw += chunk; });
                        req.on('end', () => {
                            try {
                                resolve(JSON.parse(raw || '{}'));
                            }
                            catch {
                                resolve(null);
                            }
                        });
                        req.on('error', () => resolve(null));
                    });
                    if (!body || typeof body.sessionId !== 'string' || body.sessionId === '') {
                        return respond(400, { ok: false, error: 'sessionId 缺失' });
                    }
                    const st = sessions.get(body.sessionId);
                    if (!st?.conn?.connected || !st?.session)
                        return respond(404, { ok: false, error: '浏览器未运行' });
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
                                    const base64 = await captureScreenshot(st.session, 90, 'jpeg', true);
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
                            // detach 后 WebContentsView 视口可能归零（初始未 attach 场景），用最近
                            // attach 尺寸 Emulation 覆写兜底，确保 elementFromPoint 命中。
                            if (body.keepViewport === true && st.viewport) {
                                try {
                                    await setViewport(st.session, st.viewport.width, st.viewport.height);
                                }
                                catch { /* 忽略 */ }
                            }
                            try {
                                await stopScreencast(st.session);
                            }
                            catch { }
                            return respond(200, { ok: true, hidden: true });
                        }
                        if (st.activeTabId == null || !st.tabTargets.has(st.activeTabId)) {
                            return respond(409, { ok: false, error: '无激活标签页' });
                        }
                        // attach 前清除视口覆写，恢复跟随真实视图；随后记录视口尺寸供选取模式使用。
                        try {
                            await clearViewport(st.session);
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
                        return respond(200, { ok: true, hidden: false, uiH: 0 });
                    }
                    const win = await st.conn.send('Browser.getWindowForTarget', { targetId: st.session.targetId });
                    if (win?.windowId == null)
                        return respond(500, { ok: false, error: '无法定位浏览器窗口' });
                    const x = Number(body.x);
                    const y = Number(body.y);
                    const w = Number(body.w);
                    const h = Number(body.h);
                    const show = [x, y, w, h].every(v => Number.isFinite(v) && v >= 0) && w > 50 && h > 50;
                    if (!show) {
                        // 收回屏幕外（保持尺寸，位置移出可视区），并停掉帧流。
                        await st.conn.send('Browser.setWindowBounds', {
                            windowId: win.windowId,
                            bounds: { left: -32000, top: -32000 },
                        });
                        try {
                            await stopScreencast(st.session);
                        }
                        catch { }
                        return respond(200, { ok: true, hidden: true });
                    }
                    // 首次贴合时测量「窗口外框 − 页面视口」的高度差（标题栏等 UI），
                    // 之后把 DOM 矩形向上补偿该高度，让页面视口正好落在抽屉画面区。
                    if (st.chromeUiHeight == null) {
                        try {
                            const inner = await evaluateJson(st.session, 'window.innerHeight', false);
                            st.chromeUiHeight = Math.max(0, Math.round(Number(win.bounds?.height) - Number(inner)));
                        }
                        catch {
                            st.chromeUiHeight = 0;
                        }
                    }
                    const uiH = st.chromeUiHeight ?? 0;
                    await st.conn.send('Browser.setWindowBounds', {
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
                        await stopScreencast(st.session);
                    }
                    catch { }
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
                    const body = await new Promise((resolve) => {
                        let raw = '';
                        req.on('data', (chunk) => { raw += chunk; });
                        req.on('end', () => {
                            try {
                                resolve(JSON.parse(raw || '{}'));
                            }
                            catch {
                                resolve(null);
                            }
                        });
                        req.on('error', () => resolve(null));
                    });
                    if (!body || typeof body.sessionId !== 'string' || body.sessionId === '') {
                        return respond(400, { ok: false, error: 'sessionId 缺失' });
                    }
                    const st = sessions.get(body.sessionId);
                    if (!st?.conn?.connected || !st?.session)
                        return respond(404, { ok: false, error: '浏览器未运行' });
                    // 壳内视图模式：画面由原生 WebContentsView 呈现，帧流永远不需要。
                    if (st.shellMode)
                        return respond(200, { ok: true, on: body.on === true, shell: true });
                    if (body.on === true) {
                        await startScreencast(st.session, SCREENCAST_MAX_DIM, SCREENCAST_MAX_DIM, 85);
                    }
                    else {
                        await stopScreencast(st.session);
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
                    const body = await new Promise((resolve) => {
                        let raw = '';
                        req.on('data', (chunk) => { raw += chunk; });
                        req.on('end', () => {
                            try {
                                resolve(JSON.parse(raw || '{}'));
                            }
                            catch {
                                resolve(null);
                            }
                        });
                        req.on('error', () => resolve(null));
                    });
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
                    const body = await new Promise((resolve) => {
                        let raw = '';
                        req.on('data', (chunk) => { raw += chunk; });
                        req.on('end', () => {
                            try {
                                resolve(JSON.parse(raw || '{}'));
                            }
                            catch {
                                resolve(null);
                            }
                        });
                        req.on('error', () => resolve(null));
                    });
                    if (!body || typeof body.sessionId !== 'string' || body.sessionId === '') {
                        return respond(400, { ok: false, error: 'sessionId 缺失' });
                    }
                    const url = normalizeSiteUrl(String(body.url || ''));
                    if (url === null)
                        return respond(400, { ok: false, error: 'url 无效' });
                    const sessionId = body.sessionId;
                    // requireSession 内含自动启动（壳内视图/独立窗口两种模式均适用）
                    const st = ensureState(sessionId);
                    const session = await requireSession(sessionId);
                    if (body.newTab === true && st.shellMode) {
                        // 快捷标签点击：新开标签页打开，不打断 AI 正在操作的页面
                        await shellNewTab(sessionId, st, url);
                        const act = ensureActivity(sessionId);
                        act.url = url;
                        return respond(200, { ok: true, url, newTab: true });
                    }
                    const info = await navigateAndWait(session, url, NAV_TIMEOUT_MS);
                    const act = ensureActivity(sessionId);
                    act.url = info.url;
                    act.title = info.title;
                    log(sessionId, 'navigate', `site-bar → ${url}`);
                    respond(200, { ok: true, url: info.url, title: info.title });
                }
                catch (e) {
                    respond(500, { ok: false, error: String(e?.message || e) });
                }
            },
        });
    }, '@dsh-external/dsh-browser: navigate route');
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
                    const body = await new Promise((resolve) => {
                        let raw = '';
                        req.on('data', (chunk) => { raw += chunk; });
                        req.on('end', () => {
                            try {
                                resolve(JSON.parse(raw || '{}'));
                            }
                            catch {
                                resolve(null);
                            }
                        });
                        req.on('error', () => resolve(null));
                    });
                    const sessionId = String(body?.sessionId || '');
                    const st = ensureState(sessionId);
                    if (!st.shellMode)
                        return respond(400, { ok: false, error: '当前非壳内视图模式' });
                    const action = String(body?.action || '');
                    if (action === 'switch') {
                        const tabId = String(body.tabId || '');
                        if (!st.tabTargets.has(tabId))
                            return respond(404, { ok: false, error: '标签不存在' });
                        st.activeTabId = tabId;
                        await syncActiveTabSession(st);
                        log(sessionId, 'switch-tab', tabId);
                        return respond(200, { ok: true, activeTabId: tabId });
                    }
                    if (action === 'close') {
                        const tabId = String(body.tabId || '');
                        if (!st.tabTargets.has(tabId))
                            return respond(404, { ok: false, error: '标签不存在' });
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
                        log(sessionId, 'close-tab', `${tabId} (remaining=${st.tabTargets.size})`);
                        // 全部关闭：等同停止浏览器
                        if (st.tabTargets.size === 0) {
                            await stopBrowserFor(sessionId);
                            return respond(200, { ok: true, closedAll: true });
                        }
                        return respond(200, { ok: true, activeTabId: st.activeTabId });
                    }
                    if (action === 'new') {
                        const url = body.url != null && String(body.url) !== '' ? normalizeSiteUrl(String(body.url)) : '';
                        if (body.url != null && String(body.url) !== '' && url == null) {
                            return respond(400, { ok: false, error: 'url 无效' });
                        }
                        const tabId = await shellNewTab(sessionId, st, url ?? undefined);
                        return respond(200, { ok: true, tabId });
                    }
                    return respond(400, { ok: false, error: '未知 action' });
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
                            json(res, 200, { ok: true, sessionId, running: false, url: '', title: '', refCount: 0, port: null, headed: true, log: [] });
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
                    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
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
                        const body = await new Promise((resolve) => {
                            let data = '';
                            req.on('data', (chunk) => { data += chunk; });
                            req.on('end', () => {
                                try {
                                    resolve(JSON.parse(data || '{}'));
                                }
                                catch {
                                    resolve(null);
                                }
                            });
                            req.on('error', () => resolve(null));
                        });
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