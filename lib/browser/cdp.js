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
            const params = msg.sessionId
                ? { ...(msg.params || {}), sessionId: msg.sessionId }
                : (msg.params || {});
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
    /** 发送命令，返回 result（含 sessionId 时走 session 路由） */
    send(method, params = {}, sessionId) {
        if (!this.connected)
            throw new Error('CDP 未连接');
        const id = this.nextId++;
        const payload = { id, method, params };
        if (sessionId)
            payload.sessionId = sessionId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, method });
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
const NETIDLE_IDLE_MS = 300;
const NETIDLE_EXTRA_MS = 2500;
/** 等网络空闲：连续 idleMs 无新请求，最多额外等 extraMs */
export async function waitForNetworkIdle(session, idleMs = NETIDLE_IDLE_MS, extraMs = NETIDLE_EXTRA_MS) {
    const { conn, sessionId } = session;
    let active = 0;
    let lastChange = Date.now();
    const onReq = (p) => { if (!p || p.sessionId === sessionId) {
        active++;
        lastChange = Date.now();
    } };
    const onDone = (p) => { if (!p || p.sessionId === sessionId) {
        active = Math.max(0, active - 1);
        lastChange = Date.now();
    } };
    const off1 = conn.on('Network.requestWillBeSent', onReq);
    const off2 = conn.on('Network.loadingFinished', onDone);
    const off3 = conn.on('Network.loadingFailed', onDone);
    try {
        const idleDeadline = Date.now() + extraMs;
        while (Date.now() < idleDeadline) {
            if (active === 0 && Date.now() - lastChange >= idleMs)
                break;
            await sleep(80);
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
export async function waitForPageReady(session, timeoutMs = 30000) {
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
    while (Date.now() < deadline) {
        try {
            const rs = await evaluateJson(session, 'document.readyState', false);
            if (rs === 'complete')
                break;
        }
        catch { /* 上下文尚未就绪（导航切换中），继续等 */ }
        await sleep(120);
    }
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
/** 设置视口尺寸（无头 Chrome 默认视口过小，网页会以小屏响应式渲染；这里设成桌面尺寸）。 */
export async function setViewport(session, width, height) {
    const { conn, sessionId } = session;
    await conn.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
}
/** 页面截图（jpeg base64） */
export async function captureScreenshot(session, quality = 80) {
    const { conn, sessionId } = session;
    const shot = await conn.send('Page.captureScreenshot', { format: 'jpeg', quality, fromSurface: true }, sessionId);
    if (!shot?.data)
        throw new Error('截图失败：CDP 未返回图像数据');
    return shot.data;
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