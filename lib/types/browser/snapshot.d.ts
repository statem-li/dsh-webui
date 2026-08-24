/**
 * 页面感知与操作：注入 JS 遍历 DOM（含 shadow DOM 与同源 iframe）生成 ref 树，
 * 按 ref / CSS 选择器 / 可见文本三种定位方式执行真实输入（CDP Input 域）。
 *
 * 设计要点（2026-10 全量优化）：
 * - 定位器三选一：ref（快照编号）、selector（CSS，自动穿透 shadow/iframe）、
 *   text（可见文本模糊匹配）。后两者让模型在快照失效后无需重拍即可继续操作，
 *   直接省掉一整轮 LLM 推理。
 * - 元素登记表 window.__dshRefs：ref → { 元素, iframe 累积偏移 }，支持 shadow
 *   DOM / 同源 iframe 内的元素点击（旧版只能定位主文档，data-dsh-ref 保留兼容）。
 * - 快照压缩：单行描述封顶、连续同描述折叠为 ref 区间、正文摘要与总长封顶、
 *   视口外元素标 off-screen 并附滚动进度——同等信息量下 token 显著更省。
 * - 页面内等待：waitForCondition 在页面里轮询「选择器/文本出现或消失」，一次
 *   CDP 调用完成等待，避免模型用「操作→快照→再操作」空转轮次。
 * - MutationObserver 用完即 disconnect（旧版每次操作都泄漏一个观察器）。
 */
import type { CdpSession } from './cdp.js';
/** 元素定位器：三者择一（ref 最快，selector/text 免快照）。 */
export interface Locator {
    ref?: number;
    selector?: string;
    text?: string;
    /** selector/text 匹配到多个时取第几个（1 起，默认 1）。 */
    nth?: number;
}
export interface SnapshotResult {
    /** 组装后的文本树（给 LLM 的主感知） */
    text: string;
    url: string;
    title: string;
    refCount: number;
    truncated: boolean;
}
/** 人类可读的定位描述（日志/活动条用）。 */
export declare function locatorLabel(loc: Locator): string;
export declare function getSnapshot(session: CdpSession): Promise<SnapshotResult>;
/** 等 DOM 静默。返回 settled（静默/超时）与 nav（是否发生导航）。 */
export declare function waitForSettle(session: CdpSession, idleMs?: number, timeoutMs?: number): Promise<{
    settled: boolean;
    nav: boolean;
}>;
/** 点击/悬停目标的判别信息（供生成人话操作描述）。 */
export interface ClickTarget {
    x: number;
    y: number;
    tag: string;
    text: string;
    vw: number;
    vh: number;
    /** 是否输入控件 / 下拉框（供 type 走对应路径）。 */
    editable: boolean;
    isSelect: boolean;
}
/** 定位元素并滚动到视口中央，返回顶层视口坐标与判别信息。 */
export declare function resolveTarget(session: CdpSession, loc: Locator): Promise<ClickTarget>;
export declare function clickAt(session: CdpSession, loc: Locator): Promise<ClickTarget>;
export declare function hoverAt(session: CdpSession, loc: Locator): Promise<ClickTarget>;
export declare function typeAt(session: CdpSession, loc: Locator, text: string, pressEnter: boolean): Promise<ClickTarget>;
export declare function selectAt(session: CdpSession, loc: Locator, value: string): Promise<ClickTarget>;
export interface ScrollResult {
    scrollY: number;
    scrollH: number;
    atBottom: boolean;
}
export declare function scrollPage(session: CdpSession, direction: 'up' | 'down' | 'left' | 'right', amount: number, selector?: string): Promise<ScrollResult>;
/** 页面内等待选择器/文本出现或消失（一次 CDP 调用，模型零额外轮次）。 */
export declare function waitForCondition(session: CdpSession, opts: {
    selector?: string;
    text?: string;
    gone?: boolean;
    timeoutMs?: number;
}): Promise<{
    ok: boolean;
    error?: string;
    label?: string;
}>;
export interface ExtractResult {
    ok: boolean;
    error?: string;
    url?: string;
    title?: string;
    text?: string;
    total?: number;
    truncated?: boolean;
    links?: Array<{
        text: string;
        href: string;
    }>;
}
/** 提取页面/元素正文与链接（读内容场景比 snapshot 省 token）。 */
export declare function extractContent(session: CdpSession, selector?: string, maxChars?: number): Promise<ExtractResult>;
