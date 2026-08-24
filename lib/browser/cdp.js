/**
 * CDP 客户端 — 零依赖（Node 24 原生 WebSocket），直连 Chrome DevTools Protocol。
 * 连接 Browser 级 WebSocket，支持 Target 创建/附加后以 sessionId 发页面级命令。
 *
 * 除基础命令外，还提供「真实输入」原语（Input 域：真实坐标鼠标点击 / 文本插入 /
 * 键盘按键），相比页面内 dispatchEvent 合成事件更接近真实用户，对 React/Vue
 * 受控组件、canvas、验证码滑块等场景命中率更高。
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class CdpConnection {
    url;
    ws = null;
    nextId = 1;
    pending = new Map();
    listeners = new Map();
    constructor(url) {
        this.url = url;
    }
    /** 连接并等待 open */
    async connect(timeoutMs = 10000) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN)
            return;
        await new Promise((resolve, reject) => {
            const ws = new WebSocket(this.url);
            const timer = setTimeout(() => {
                ws.close();
                reject(new Error(`CDP 连接超时: ${this.url}`));
            }, timeoutMs);
            ws.onopen = () => {
                clearTimeout(timer);
                this.ws = ws;
                resolve();
            };
            ws.onerror = (e) => {
                clearTimeout(timer);
                reject(new Error(`CDP 连接失败: ${e?.message || 'unknown'}`));
            };
        });
        this.ws.onmessage = (ev) => this.onMessage(ev);
        this.ws.onclose = () => this.onClose();
    }
    get connected() {
        return !!this.ws && this.ws.readyState === WebSocket.OPEN;
    }
    onMessage(ev) {
        let msg;
        try {
            msg = JSON.parse(String(ev.data));
        }
        catch {
            return;
        }
        if (msg.id && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error)
                p.reject(new Error(`${p.method}: ${msg.error.message || JSON.stringify(msg.error)}`));
            else
                p.resolve(msg.result);
            return;
        }
        if (msg.method && this.listeners.has(msg.method)) {
            // flatten 模式下页面级事件会带顶层 sessionId；合并进 params 供监听器按 session 过滤。
            // screencast 帧的 params.sessionId 是「screencast 会话号」（ack 用），与 target
            // sessionId 同名冲突，故原值保留为 screencastSessionId。
            const raw = msg.params || {};
            const params = msg.sessionId
                ? { ...raw, sessionId: msg.sessionId, ...(raw.sessionId !== undefined ? { screencastSessionId: raw.sessionId } : {}) }
                : raw;
            for (const fn of this.listeners.get(msg.method)) {
                try {
                    fn(params);
                }
                catch { /* 监听器错误忽略 */ }
            }
        }
    }
    onClose() {
        const err = new Error('CDP 连接已关闭');
        for (const [, p] of this.pending)
            p.reject(err);
        this.pending.clear();
        this.ws = null;
    }
    /** 发送命令，返回 result（含 sessionId 时走 session 路由）。
     *  timeoutMs 兜底防止命令永久挂起（如 detached 视图上 captureScreenshot
     *  等不到合成帧）：超时后 Promise reject，调用方可以降级重试。 */
    send(method, params = {}, sessionId, timeoutMs = 45000) {
        if (!this.connected)
            throw new Error('CDP 未连接');
        const id = this.nextId++;
        const payload = { id, method, params };
        if (sessionId)
            payload.sessionId = sessionId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method}: 超时（${timeoutMs}ms 内无响应）`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); },
                method,
            });
            this.ws.send(JSON.stringify(payload));
        });
    }
    /** 订阅事件（返回取消函数）。监听器收到的 params 在 flatten 模式下含 sessionId 字段。 */
    on(method, fn) {
        if (!this.listeners.has(method))
            this.listeners.set(method, new Set());
        this.listeners.get(method).add(fn);
        return () => this.listeners.get(method)?.delete(fn);
    }
    close() {
        try {
            this.ws?.close();
        }
        catch { /* ignore */ }
        this.ws = null;
    }
}
/** 从 http://127.0.0.1:port/json/version 读取 browser websocket 地址（100ms 快速轮询） */
export async function fetchBrowserWsUrl(port, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (res.ok) {
                const info = await res.json();
                if (info && typeof info.webSocketDebuggerUrl === 'string')
                    return info.webSocketDebuggerUrl;
            }
        }
        catch (e) {
            lastErr = e;
        }
        await sleep(100);
    }
    throw new Error(`Chrome DevTools 端口 ${port} 未就绪: ${String(lastErr || 'timeout')}`);
}
/** 列出所有 page target */
export async function listPageTargets(conn) {
    const res = await conn.send('Target.getTargets');
    return (res?.targetInfos || []).filter((t) => t.type === 'page');
}
/** 创建新标签页并 attach，返回 session */
export async function createPageSession(conn, url = 'about:blank') {
    const created = await conn.send('Target.createTarget', { url });
    const targetId = created.targetId;
    return attachTarget(conn, targetId);
}
/** attach 已有 target */
export async function attachTarget(conn, targetId) {
    const attached = await conn.send('Target.attachToTarget', { targetId, flatten: true });
    return { targetId, sessionId: attached.sessionId, conn };
}
// 网络空闲判定参数（SPA 首屏：load 后等异步请求静默）
const NETIDLE_IDLE_MS = 250;
const NETIDLE_EXTRA_MS = 2500;
// 单个请求在途超过该时长即按「长连接/流式」处理（SSE、埋点心跳、轮询 XHR），
// 不再计入活跃请求——否则这类页面每次导航都白等满 extraMs（实测主要空等来源）。
const NETIDLE_STREAM_MS = 1000;
/**
 * 等网络空闲：连续 idleMs 无请求变动且无短请求在途，最多额外等 extraMs。
 * 按 requestId 记账（旧实现用计数器，事件丢一次就永远不归零）。
 */
export async function waitForNetworkIdle(session, idleMs = NETIDLE_IDLE_MS, extraMs = NETIDLE_EXTRA_MS) {
    const { conn, sessionId } = session;
    /** requestId → 发起时刻；超过 NETIDLE_STREAM_MS 视为流式并剔除。 */
    const inflight = new Map();
    let lastChange = Date.now();
    const mine = (p) => !p || p.sessionId === undefined || p.sessionId === sessionId;
    const onReq = (p) => {
        if (!mine(p))
            return;
        if (typeof p?.requestId === 'string')
            inflight.set(p.requestId, Date.now());
        lastChange = Date.now();
    };
    const onDone = (p) => {
        if (!mine(p))
            return;
        if (typeof p?.requestId === 'string')
            inflight.delete(p.requestId);
        lastChange = Date.now();
    };
    const off1 = conn.on('Network.requestWillBeSent', onReq);
    const off2 = conn.on('Network.loadingFinished', onDone);
    const off3 = conn.on('Network.loadingFailed', onDone);
    try {
        const idleDeadline = Date.now() + extraMs;
        while (Date.now() < idleDeadline) {
            const now = Date.now();
            for (const [id, ts] of inflight) {
                if (now - ts > NETIDLE_STREAM_MS)
                    inflight.delete(id);
            }
            if (inflight.size === 0 && now - lastChange >= idleMs)
                break;
            await sleep(50);
        }
    }
    finally {
        off1();
        off2();
        off3();
    }
}
/**
 * 等页面就绪：先轮询 document.readyState 直到 complete（兼容初次导航与
 * 操作触发的二次导航），再等网络空闲。返回时页面已可稳定 snapshot。
 */
export async function waitForPageReady(session, timeoutMs = 30000, skipNetworkIdle = false) {
    const { conn, sessionId } = session;
    try {
        await conn.send('Network.enable', {}, sessionId);
    }
    catch { /* 已启用 */ }
    try {
        await conn.send('Page.enable', {}, sessionId);
    }
    catch { /* 已启用 */ }
    const deadline = Date.now() + timeoutMs;
    // load 事件先到就立即放行，不必等下一次轮询 tick（省最多 1 个轮询周期）。
    let loaded = false;
    const offLoad = conn.on('Page.loadEventFired', (p) => {
        if (p?.sessionId === undefined || p.sessionId === sessionId)
            loaded = true;
    });
    try {
        while (Date.now() < deadline) {
            if (loaded)
                break;
            try {
                const rs = await evaluateJson(session, 'document.readyState', false);
                if (rs === 'complete')
                    break;
            }
            catch { /* 上下文尚未就绪（导航切换中），继续等 */ }
            await sleep(70);
        }
    }
    finally {
        offLoad();
    }
    if (!skipNetworkIdle)
        await waitForNetworkIdle(session);
}
/**
 * 导航到 URL 并等待页面就绪（load + 网络空闲）。
 */
export async function navigateAndWait(session, url, timeoutMs = 30000) {
    const { conn, sessionId } = session;
    try {
        await conn.send('Network.enable', {}, sessionId);
    }
    catch { /* 已启用 */ }
    try {
        await conn.send('Page.enable', {}, sessionId);
    }
    catch { /* 已启用 */ }
    await conn.send('Page.navigate', { url }, sessionId);
    await waitForPageReady(session, timeoutMs);
    const info = await conn.send('Page.getNavigationHistory', {}, sessionId);
    const current = info?.entries?.[info.currentIndex];
    return { url: current?.url || url, title: current?.title || '' };
}
/** 重新加载当前页（ignoreCache=true 相当于 Ctrl+Shift+R）。 */
export async function reloadPage(session, ignoreCache = false) {
    const { conn, sessionId } = session;
    try {
        await conn.send('Page.enable', {}, sessionId);
    }
    catch { /* 已启用 */ }
    await conn.send('Page.reload', { ignoreCache }, sessionId);
    await waitForPageReady(session, 30000, true);
    const info = await conn.send('Page.getNavigationHistory', {}, sessionId);
    const current = info?.entries?.[info.currentIndex];
    return { url: current?.url || '', title: current?.title || '' };
}
/** 当前页的历史可用性（供 UI 置灰前进/后退按钮）。 */
export async function navigationState(session) {
    const { conn, sessionId } = session;
    const info = await conn.send('Page.getNavigationHistory', {}, sessionId);
    const entries = info?.entries || [];
    const idx = info?.currentIndex ?? -1;
    const current = entries[idx];
    return {
        canBack: idx > 0,
        canForward: idx >= 0 && idx < entries.length - 1,
        url: current?.url || '',
        title: current?.title || '',
    };
}
/** 历史前进/后退（delta 正=前进，负=后退） */
export async function navigateHistory(session, delta) {
    const { conn, sessionId } = session;
    const info = await conn.send('Page.getNavigationHistory', {}, sessionId);
    const entries = info?.entries || [];
    const idx = info?.currentIndex ?? -1;
    const target = entries[idx + delta];
    if (!target)
        throw new Error(delta < 0 ? '没有可后退的历史记录' : '没有可前进的历史记录');
    await conn.send('Page.navigateToHistoryEntry', { entryId: target.id }, sessionId);
    await waitForPageReady(session);
    const after = await conn.send('Page.getNavigationHistory', {}, sessionId);
    const current = after?.entries?.[after.currentIndex];
    return { url: current?.url || '', title: current?.title || '' };
}
/**
 * 设置视口尺寸（Emulation 覆写）。仅供 screenshot.ts 等无头截图场景使用；
 * AI 浏览器主流程为有头模式，视口跟随真实窗口，不做覆写（避免画面跳动）。
 */
export async function setViewport(session, width, height, deviceScaleFactor = 1) {
    const { conn, sessionId } = session;
    await conn.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor, mobile: false,
    }, sessionId);
}
/** 清除视口覆写，恢复跟随真实窗口/视图（选取模式结束后调用）。 */
export async function clearViewport(session) {
    const { conn, sessionId } = session;
    try {
        await conn.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
    }
    catch { /* 未覆写则忽略 */ }
}
/** 页面截图（默认 jpeg；format 可传 png 无损，适合文字/卡片）。
 *  fromSurface=true 截合成器表面（视图可见时画质最佳）；detached/不可见视图
 *  可能等不到合成帧（命令会超时），调用方应降级重试 fromSurface=false
 *  （直接向 renderer 要一帧，不依赖 compositor）。
 *  clip 传入时只截取该矩形区域（元素范围截图的基础）。 */
export async function captureScreenshot(session, quality = 90, format = 'jpeg', fromSurface = true, timeoutMs = 8000, clip) {
    const { conn, sessionId } = session;
    const shot = await conn.send('Page.captureScreenshot', {
        format,
        ...(format === 'jpeg' ? { quality } : {}),
        fromSurface,
        ...(clip ? {
            clip: {
                x: Math.max(0, clip.x),
                y: Math.max(0, clip.y),
                width: Math.max(1, clip.width),
                height: Math.max(1, clip.height),
                scale: clip.scale ?? 1,
            },
            // 允许截取视口外区域：scrollIntoView 后通常已在视口内，此开关只是兜底
            captureBeyondViewport: true,
        } : {}),
    }, sessionId, timeoutMs);
    if (!shot?.data)
        throw new Error('截图失败：CDP 未返回图像数据');
    return shot.data;
}
/**
 * 截图（带降级）：surface 截图失败/超时 → 自动改用 renderer 截图。
 * fromSurfaceTimeoutMs 只作用于第一次 surface 尝试——detached（不合成）视图
 * 等不到合成帧，会卡满该超时；预览抽屉的画面兜底传更短的值以快速降级。
 */
export async function captureScreenshotSafe(session, quality = 90, format = 'jpeg', fromSurfaceTimeoutMs = 8000) {
    try {
        return await captureScreenshot(session, quality, format, true, fromSurfaceTimeoutMs);
    }
    catch {
        return await captureScreenshot(session, quality, format, false, fromSurfaceTimeoutMs);
    }
}
/** 元素范围截图（带降级）：clip 模式下同样 surface 失败再试 renderer。
 *  注意 renderer 路径不支持 captureBeyondViewport 之外的差异——参数一致透传。 */
export async function captureScreenshotSafeClip(session, quality, format, clip, fromSurfaceTimeoutMs = 8000) {
    try {
        return await captureScreenshot(session, quality, format, true, fromSurfaceTimeoutMs, clip);
    }
    catch {
        return await captureScreenshot(session, quality, format, false, fromSurfaceTimeoutMs, clip);
    }
}
/** 启动 CDP screencast：Chrome 持续推送 JPEG 帧（仅变化时），供内嵌面板实时展示 + 交互。 */
export async function startScreencast(session, width, height, quality = 85) {
    const { conn, sessionId } = session;
    await conn.send('Page.startScreencast', {
        format: 'jpeg',
        quality,
        maxWidth: width,
        maxHeight: height,
        everyNthFrame: 1,
    }, sessionId);
}
/** 停止 screencast（幂等）。 */
export async function stopScreencast(session) {
    const { conn, sessionId } = session;
    try {
        await conn.send('Page.stopScreencast', {}, sessionId);
    }
    catch { /* 未启动则忽略 */ }
}
/** 确认收到一帧 screencast（CDP 要求逐帧 ack，否则暂停推送）。 */
export async function ackScreencast(session, screencastSessionId) {
    const { conn, sessionId } = session;
    await conn.send('Page.screencastFrameAck', { sessionId: screencastSessionId }, sessionId);
}
/** 真实鼠标滚轮（CDP Input 域 mouseWheel，delta 正=向下/向右）。 */
export async function dispatchMouseWheel(session, x, y, deltaX, deltaY) {
    const { conn, sessionId } = session;
    await conn.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x, y, deltaX, deltaY,
    }, sessionId);
}
/** 通用鼠标按下/释放（前端交互回传：拖拽、长按等）。 */
export async function dispatchMouseButton(session, type, x, y, button = 'left', clickCount = 1) {
    const { conn, sessionId } = session;
    await conn.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount }, sessionId);
}
/** 页面执行 JS，返回 JSON 值 */
export async function evaluateJson(session, expression, awaitPromise = true) {
    const { conn, sessionId } = session;
    const result = await conn.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, sessionId);
    if (result?.exceptionDetails) {
        const d = result.exceptionDetails;
        throw new Error(`页面 JS 异常: ${d.text || 'unknown'} ${d.exception?.description || ''}`.slice(0, 400));
    }
    return result?.result?.value;
}
/** 读取视口尺寸（用于校验点击坐标是否落在可视区内） */
export async function getViewportSize(session) {
    const v = await evaluateJson(session, '({ w: window.innerWidth, h: window.innerHeight })', false);
    return { width: v?.w || 0, height: v?.h || 0 };
}
/**
 * 元素选取注入脚本：在页面上下文按视口坐标 `document.elementFromPoint(x, y)`
 * 定位元素，生成唯一且稳定的 CSS 选择器（id 优先 → 短 class 唯一定位 → 全
 * nth-of-type 路径），并摘取 tag / id / class / role / 可见文本（≤120 字符）。
 * 避开 `[class*="…"]` 宽泛子串匹配（会误伤多元素）；id 用 CSS.escape 转义，
 * 兜底退回属性选择器。脚本为同步纯函数，evaluate 时 awaitPromise 传 false。
 */
const INSPECT_JS = `(function (x, y) {
  function str(s, n) {
    s = (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) : s;
  }
  function escapeAttr(s) { return String(s).replace(/"/g, '\\\\"'); }
  function cssEscape(s) {
    try { return CSS.escape(s); } catch (e) { return s; }
  }
  function idSelector(el) {
    if (!el.id) return null;
    var sel;
    try { sel = '#' + cssEscape(el.id); }
    catch (e) { sel = '[id="' + escapeAttr(el.id) + '"]'; }
    try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
    return null;
  }
  function classSelector(el) {
    var cn = (typeof el.className === 'string') ? el.className : '';
    var cls = cn.trim().split(/\\s+/).filter(Boolean);
    if (!cls.length) return null;
    var sel = el.tagName.toLowerCase();
    for (var i = 0; i < cls.length && i < 3; i++) {
      try { sel += '.' + cssEscape(cls[i]); } catch (e) { return null; }
    }
    try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
    return null;
  }
  function nthPath(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body) {
      var tag = cur.tagName.toLowerCase();
      var part = tag;
      var parent = cur.parentElement;
      if (parent) {
        var idx = 1;
        var sib = cur.previousElementSibling;
        while (sib) {
          if (sib.tagName === cur.tagName) idx++;
          sib = sib.previousElementSibling;
        }
        if (idx > 1) part += ':nth-of-type(' + idx + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }
  var el = document.elementFromPoint(x, y);
  if (!el || el === document.documentElement || el === document.body) {
    return { found: false };
  }
  var tag = el.tagName.toLowerCase();
  var id = el.id || '';
  var cls = (typeof el.className === 'string' ? el.className : '') || '';
  var role = el.getAttribute ? (el.getAttribute('role') || '') : '';
  var text = str(el.innerText || el.textContent || '', 120);
  var label = '';
  var aria = el.getAttribute ? (el.getAttribute('aria-label') || '') : '';
  if (!text && aria) label = aria;
  if (!text && (tag === 'input' || tag === 'textarea') && el.value != null && el.value !== '') label = el.value;
  if (tag === 'img') {
    var alt = el.getAttribute ? (el.getAttribute('alt') || '') : '';
    if (alt) { text = str(alt, 120); label = ''; }
  }
  var selector = idSelector(el) || classSelector(el) || nthPath(el);
  var r = el.getBoundingClientRect();
  return {
    found: true,
    selector: selector,
    tag: tag,
    id: id,
    className: cls.slice(0, 200),
    role: role,
    text: text,
    label: str(label, 120),
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    vw: window.innerWidth,
    vh: window.innerHeight
  };
})`;
/** 在目标页按视口坐标采集元素定位信息（唯一选择器 + 摘要字段 + 范围）。 */
export async function inspectElementAt(session, x, y) {
    const data = await evaluateJson(session, `${INSPECT_JS}(${Number(x)}, ${Number(y)})`, false);
    const empty = { found: false, selector: '', tag: '', id: '', className: '', role: '', text: '', label: '', rect: null, vw: 0, vh: 0 };
    if (!data || typeof data !== 'object')
        return empty;
    const r = data.rect;
    const rect = r && typeof r === 'object'
        ? { left: Number(r.left) || 0, top: Number(r.top) || 0, width: Number(r.width) || 0, height: Number(r.height) || 0 }
        : null;
    return {
        found: data.found === true,
        selector: String(data.selector ?? ''),
        tag: String(data.tag ?? ''),
        id: String(data.id ?? ''),
        className: String(data.className ?? ''),
        role: String(data.role ?? ''),
        text: String(data.text ?? ''),
        label: String(data.label ?? ''),
        rect,
        vw: Number(data.vw) || 0,
        vh: Number(data.vh) || 0,
    };
}
/**
 * 真实坐标鼠标点击（CDP Input 域）。
 * 触发完整事件链：mouseover → mousedown → mouseup → click，以及 pointer 事件，
 * 对依赖真实命中的元素（canvas、验证码滑块、部分自定义控件）比合成事件更精准。
 */
export async function dispatchMouseClick(session, x, y) {
    const { conn, sessionId } = session;
    await conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }, sessionId);
    await conn.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await conn.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
}
/** 真实鼠标移动（悬停，用于触发 hover 菜单/下拉） */
export async function dispatchMouseMove(session, x, y) {
    const { conn, sessionId } = session;
    await conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }, sessionId);
}
/** 真实文本插入（写入当前焦点/选区的输入控件，走浏览器原生输入路径） */
export async function insertText(session, text) {
    const { conn, sessionId } = session;
    await conn.send('Input.insertText', { text }, sessionId);
}
/** 真实回车键（rawKeyDown + char + keyUp，兼容监听 keypress/keydown 的表单） */
export async function dispatchEnterKey(session) {
    await dispatchKey(session, 'Enter');
}
// 修饰键位掩码（CDP modifiers）：Alt=1 Ctrl=2 Meta=4 Shift=8
const MOD_BITS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };
const KEY_DEFS = {
    Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
    Escape: { key: 'Escape', code: 'Escape', vk: 27 },
    Tab: { key: 'Tab', code: 'Tab', vk: 9 },
    Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
    Delete: { key: 'Delete', code: 'Delete', vk: 46 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
    Home: { key: 'Home', code: 'Home', vk: 36 },
    End: { key: 'End', code: 'End', vk: 35 },
    PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
    PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
    ' ': { key: ' ', code: 'Space', vk: 32, text: ' ' },
};
/**
 * 真实键盘按键（rawKeyDown + 可选 char + keyUp）。
 * @param key 按键名（Enter/Escape/Tab/ArrowUp…）或单字符
 * @param modifiers 修饰键数组（ctrl/shift/alt/meta），如 ['ctrl','shift']
 */
export async function dispatchKey(session, key, modifiers = []) {
    const { conn, sessionId } = session;
    const def = KEY_DEFS[key] || {
        key,
        code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
        vk: 0,
        text: key,
    };
    let mods = 0;
    for (const m of modifiers)
        mods |= MOD_BITS[String(m).toLowerCase()] || 0;
    const base = {
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.vk,
        nativeVirtualKeyCode: def.vk,
    };
    if (mods)
        base.modifiers = mods;
    await conn.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, sessionId);
    if (def.text != null) {
        await conn.send('Input.dispatchKeyEvent', {
            type: 'char',
            text: def.text,
            key: def.key,
            code: def.code,
            windowsVirtualKeyCode: def.vk,
        }, sessionId);
    }
    await conn.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
}
//# sourceMappingURL=cdp.js.map