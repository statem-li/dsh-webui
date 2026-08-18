/**
 * CDP 客户端 — 零依赖（Node 24 原生 WebSocket），直连 Chrome DevTools Protocol。
 * 连接 Browser 级 WebSocket，支持 Target 创建/附加后以 sessionId 发页面级命令。
 *
 * 除基础命令外，还提供「真实输入」原语（Input 域：真实坐标鼠标点击 / 文本插入 /
 * 键盘按键），相比页面内 dispatchEvent 合成事件更接近真实用户，对 React/Vue
 * 受控组件、canvas、验证码滑块等场景命中率更高。
 */
export interface CdpTarget {
    targetId: string;
    type: string;
    title: string;
    url: string;
    attached?: boolean;
}
export interface CdpSession {
    targetId: string;
    sessionId: string;
    conn: CdpConnection;
}
export declare class CdpConnection {
    private url;
    private ws;
    private nextId;
    private pending;
    private listeners;
    constructor(url: string);
    /** 连接并等待 open */
    connect(timeoutMs?: number): Promise<void>;
    get connected(): boolean;
    private onMessage;
    private onClose;
    /** 发送命令，返回 result（含 sessionId 时走 session 路由） */
    send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any>;
    /** 订阅事件（返回取消函数）。监听器收到的 params 在 flatten 模式下含 sessionId 字段。 */
    on(method: string, fn: (params: any) => void): () => void;
    close(): void;
}
/** 从 http://127.0.0.1:port/json/version 读取 browser websocket 地址（100ms 快速轮询） */
export declare function fetchBrowserWsUrl(port: number, timeoutMs?: number): Promise<string>;
/** 列出所有 page target */
export declare function listPageTargets(conn: CdpConnection): Promise<CdpTarget[]>;
/** 创建新标签页并 attach，返回 session */
export declare function createPageSession(conn: CdpConnection, url?: string): Promise<CdpSession>;
/** attach 已有 target */
export declare function attachTarget(conn: CdpConnection, targetId: string): Promise<CdpSession>;
/** 等网络空闲：连续 idleMs 无新请求，最多额外等 extraMs */
export declare function waitForNetworkIdle(session: CdpSession, idleMs?: number, extraMs?: number): Promise<void>;
/**
 * 等页面就绪：先轮询 document.readyState 直到 complete（兼容初次导航与
 * 操作触发的二次导航），再等网络空闲。返回时页面已可稳定 snapshot。
 */
export declare function waitForPageReady(session: CdpSession, timeoutMs?: number): Promise<void>;
/**
 * 导航到 URL 并等待页面就绪（load + 网络空闲）。
 */
export declare function navigateAndWait(session: CdpSession, url: string, timeoutMs?: number): Promise<{
    url: string;
    title: string;
}>;
/** 历史前进/后退（delta 正=前进，负=后退） */
export declare function navigateHistory(session: CdpSession, delta: number): Promise<{
    url: string;
    title: string;
}>;
/** 页面截图（jpeg base64） */
export declare function captureScreenshot(session: CdpSession, quality?: number): Promise<string>;
/** 页面执行 JS，返回 JSON 值 */
export declare function evaluateJson(session: CdpSession, expression: string, awaitPromise?: boolean): Promise<any>;
/** 读取视口尺寸（用于校验点击坐标是否落在可视区内） */
export declare function getViewportSize(session: CdpSession): Promise<{
    width: number;
    height: number;
}>;
/**
 * 真实坐标鼠标点击（CDP Input 域）。
 * 触发完整事件链：mouseover → mousedown → mouseup → click，以及 pointer 事件，
 * 对依赖真实命中的元素（canvas、验证码滑块、部分自定义控件）比合成事件更精准。
 */
export declare function dispatchMouseClick(session: CdpSession, x: number, y: number): Promise<void>;
/** 真实鼠标移动（悬停，用于触发 hover 菜单/下拉） */
export declare function dispatchMouseMove(session: CdpSession, x: number, y: number): Promise<void>;
/** 真实文本插入（写入当前焦点/选区的输入控件，走浏览器原生输入路径） */
export declare function insertText(session: CdpSession, text: string): Promise<void>;
/** 真实回车键（rawKeyDown + char + keyUp，兼容监听 keypress/keydown 的表单） */
export declare function dispatchEnterKey(session: CdpSession): Promise<void>;
/**
 * 真实键盘按键（rawKeyDown + 可选 char + keyUp）。
 * @param key 按键名（Enter/Escape/Tab/ArrowUp…）或单字符
 * @param modifiers 修饰键数组（ctrl/shift/alt/meta），如 ['ctrl','shift']
 */
export declare function dispatchKey(session: CdpSession, key: string, modifiers?: string[]): Promise<void>;
