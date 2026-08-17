/**
 * dsh-session-message-nav — 会话消息导航插件（host 半身）。
 *
 * 全部行为在 client bundle（dsh.client 声明）里：会话头部「消息」按钮 +
 * 右侧滚动齿轮。host 半身仅作为 loader 可挂载的插件包存在——
 * client-modules 节点侧靠它发现并装配 client bundle。
 */
import type { Context } from 'cordis';
export declare const name = "dsh-session-message-nav";
export declare const inject: string[];
export declare function apply(_ctx: Context): void;
