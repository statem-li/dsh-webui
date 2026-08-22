export type ShotTheme = 'light' | 'dark' | 'glass' | 'glass-dark';
/**
 * 把 Markdown 源码渲染为 HTML 片段（不含完整文档/卡片骨架）。
 * shiki 高亮单例异步初始化；markdown-it 的 highlight 回调是同步的，初始化后
 * 直接复用同步的 codeToHtml。
 */
export declare function renderMarkdownToHtml(md: string, theme: ShotTheme): Promise<string>;
/** 生成截图卡片的完整 `<style>` 内容（含主题变量 + 排版 + shiki/emoji/checkbox 适配）。 */
export declare function buildThemeCss(theme: ShotTheme, pageWidth: number, pageHeight: number): string;
