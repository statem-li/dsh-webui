import { type ShotTheme } from './theme.js';
/** HTML 转义（纯文本消息 + 卡片标题共用）。 */
export declare function escapeHtml(text: string): string;
/**
 * 把 Markdown 源码渲染为 HTML 片段（不含卡片骨架）。
 * @param md - Markdown 源码。
 * @param theme - 截图主题（决定 shiki 配色）。
 * @returns HTML 片段字符串。
 */
export declare function renderMarkdown(md: string, theme: ShotTheme): Promise<string>;
