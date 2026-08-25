import { type ShotTheme } from './theme.js';
/**
 * 源码里是否含图表围栏（host 用它决定是否给截图页注入 mermaid 引擎 —— 没有图的
 * 截图不该付 3.4MB 解压 + 引擎解析的代价）。
 * @param md - Markdown 源码。
 */
export declare function hasDiagramFence(md: string): boolean;
/** HTML 转义（纯文本消息 + 卡片标题共用）。 */
export declare function escapeHtml(text: string): string;
/**
 * 把 Markdown 源码渲染为 HTML 片段（不含卡片骨架）。
 * @param md - Markdown 源码。
 * @param theme - 截图主题（决定 shiki 配色）。
 * @returns HTML 片段字符串。
 */
export declare function renderMarkdown(md: string, theme: ShotTheme): Promise<string>;
