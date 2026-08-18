/**
 * 页面感知与操作：注入 JS 遍历 DOM 生成 ref 树（文本主感知），
 * 按 ref 执行真实输入（CDP Input 域）点击 / 输入 / 滚动 / 悬停 / 下拉选择。
 *
 * 相比初版的关键改进：
 * - 点击/输入走 CDP Input 域真实事件（真实坐标点击、insertText、真实按键），
 *   命中 React/Vue 受控组件、canvas、自定义控件更高；
 * - 移除操作前的全量 REASSIGN 遍历：既慢，又会在动态页面里静默重编号导致点错。
 *   改为直接 querySelector('[data-dsh-ref="N"]') 定位，页面变化时干净报错让模型重拍；
 * - describe 增加 name/id/type/value/checked/disabled/expanded/options 等判别信息，
 *   减少模型选错元素的重试；
 * - 提供 waitForSettle（MutationObserver 静默检测），操作后等 DOM 稳定再快照，
 *   避免拿到陈旧/空快照导致反复重试。
 */
import type { CdpSession } from './cdp.js';
export interface SnapshotResult {
    /** 组装后的文本树（给 LLM 的主感知） */
    text: string;
    url: string;
    title: string;
    refCount: number;
    truncated: boolean;
}
export declare function getSnapshot(session: CdpSession): Promise<SnapshotResult>;
/** 等 DOM 静默。返回 settled（静默/超时）与 nav（是否发生导航）。 */
export declare function waitForSettle(session: CdpSession, idleMs?: number, timeoutMs?: number): Promise<{
    settled: boolean;
    nav: boolean;
}>;
export declare function clickRef(session: CdpSession, ref: number): Promise<void>;
export declare function hoverRef(session: CdpSession, ref: number): Promise<void>;
export declare function typeRef(session: CdpSession, ref: number, text: string, pressEnter: boolean): Promise<void>;
export declare function selectRef(session: CdpSession, ref: number, value: string): Promise<void>;
export declare function scrollPage(session: CdpSession, direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void>;
