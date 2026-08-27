/**
 * webui — 原始 HTML 片段净化（host 截图管线与 client 消息渲染共用）。
 *
 * 策略与 markstream 的 trusted 档对齐：渲染标准标签并保留内联样式与表格布局，
 * 同时剔除结构性风险标签、剥事件属性、URL 协议白名单、消毒 style 值。
 * 纯字符串实现（无 DOM / Node 依赖），host 与 client 两个 bundle 均可内联。
 */
/**
 * 净化一段原始 HTML 片段（html_block / html_inline 内容）。
 * 标签级扫描重建：危险标签连同内容剔除（栈跟踪嵌套），普通标签逐个属性消毒。
 * 任务清单的 checkbox（markdown-it-task-lists 输出）保留，其余 input 剔除。
 */
export declare function sanitizeHtmlFragment(html: string): string;
