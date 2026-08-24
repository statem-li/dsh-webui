/**
 * webui — 截图用 Markdown 渲染管线（host 端）。
 *
 * markdown-it（CommonMark + GFM 表格/删除线/linkify）+ shiki 语法高亮 + emoji
 * 短码（Unicode 字符，非表情包图片库）+ 任务清单 + 图片（http/https 白名单）。
 * 输出的是 HTML 片段，卡片骨架与主题在 card.ts / theme.ts。
 */
import MarkdownIt from 'markdown-it';
// full 预设才带完整 emoji 短码表：light 只收录极少数条目，:rocket: 之类常见
// 短码会原样输出（旧实现用的就是 light，短码渲染不出来）。
import { full as markdownItEmoji } from 'markdown-it-emoji';
import markdownItTaskLists from 'markdown-it-task-lists';
import { createHighlighter } from 'shiki';
import { baseOf } from './theme.js';
/** 预加载的 shiki 语言（与 client 端 markdown/shiki.ts 对齐）。 */
const SHIKI_LANGS = [
    'bash', 'c', 'cpp', 'csharp', 'css', 'dart', 'dockerfile', 'go', 'html',
    'java', 'javascript', 'json', 'jsx', 'kotlin', 'lua', 'markdown',
    'objective-c', 'objective-cpp', 'php', 'powershell', 'python', 'ruby',
    'rust', 'scala', 'shellscript', 'sql', 'svelte', 'swift', 'toml', 'tsx',
    'typescript', 'vue', 'xml', 'yaml',
];
let highlighterPromise = null;
/** shiki 单例（首次调用初始化，后续复用）。 */
function getHighlighter() {
    if (highlighterPromise === null) {
        highlighterPromise = createHighlighter({
            themes: ['github-light', 'github-dark'],
            langs: SHIKI_LANGS,
        });
    }
    return highlighterPromise;
}
/** HTML 转义（纯文本消息 + 卡片标题共用）。 */
export function escapeHtml(text) {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
/** 链接白名单（http/https/mailto），与 client renderer 的 safeLink 对齐。 */
function safeHref(url) {
    try {
        const protocol = new URL(url).protocol;
        return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? url : '';
    }
    catch {
        return '';
    }
}
/** 图片白名单（http/https），与 client renderer 的 remoteImage 对齐。 */
function safeSrc(url) {
    try {
        const protocol = new URL(url).protocol;
        return protocol === 'http:' || protocol === 'https:' ? url : '';
    }
    catch {
        return '';
    }
}
/** markdown-it 15 的 attrGet 返回 string | number | null，这里规整为 string。 */
function attrStr(value) {
    return typeof value === 'string' ? value : '';
}
/**
 * 把 Markdown 源码渲染为 HTML 片段（不含卡片骨架）。
 * @param md - Markdown 源码。
 * @param theme - 截图主题（决定 shiki 配色）。
 * @returns HTML 片段字符串。
 */
export async function renderMarkdown(md, theme) {
    const highlighter = await getHighlighter();
    const shikiTheme = baseOf(theme) === 'dark' ? 'github-dark' : 'github-light';
    const it = new MarkdownIt({
        html: false,
        linkify: true,
        highlight(code, lang) {
            if (lang !== '') {
                try {
                    return highlighter.codeToHtml(code, { lang, theme: shikiTheme });
                }
                catch {
                    // 未知/未加载语言 → 降级为无高亮代码块
                }
            }
            return `<pre class="shiki plain"><code>${escapeHtml(code)}</code></pre>`;
        },
    });
    // 链接：白名单 + 新窗口 + noopener；非法 URL 置空 href（不可点击）。
    it.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
        const token = tokens[idx];
        token.attrSet('href', safeHref(attrStr(token.attrGet('href'))));
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
        return self.renderToken(tokens, idx, options);
    };
    // 图片：白名单 https + no-referrer；非法 URL 降级为 alt 占位文本。
    it.renderer.rules.image = (tokens, idx, options, _env, self) => {
        const token = tokens[idx];
        const src = safeSrc(attrStr(token.attrGet('src')));
        if (src === '') {
            return `<span class="md-img-alt">${escapeHtml(attrStr(token.attrGet('alt')) || '图片')}</span>`;
        }
        token.attrSet('src', src);
        token.attrSet('referrerpolicy', 'no-referrer');
        return self.renderToken(tokens, idx, options);
    };
    // emoji 短码 → Unicode 字符（关闭 :)、:( 等 shortcuts，避免误伤普通文本）。
    it.use(markdownItEmoji, { shortcuts: {} });
    // 任务清单（checkbox 默认 disabled，截图静态展示）。
    it.use(markdownItTaskLists);
    return it.render(md);
}
//# sourceMappingURL=markdown.js.map