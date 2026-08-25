/**
 * webui — 截图卡片 HTML 组装（host 端）。
 *
 * 输入一条或多条消息（user / assistant），输出可直接喂给无头浏览器的完整
 * HTML 文档：顶部导轨 + 徽标页头 + 标题 + 正文（assistant 走 Markdown 管线、
 * user 走纯文本）+ 页脚署名。多条消息按段落堆叠，段间有角色标签与细线。
 *
 * 正文里的 mermaid 围栏会真的画成图：命中图表围栏时在文档末尾追加
 * `<script src="mermaid.min.js">` + 引导脚本（引擎文件由 renderer.ts 投放到同
 * 目录），并把「渲染完成」暴露成 window.__shotMermaid 供渲染器等待。
 */
import { escapeHtml, hasDiagramFence, renderMarkdown } from './markdown.js';
import { buildCardCss, mermaidConfigJson } from './theme.js';
/** 单条消息文本上限，超出截断（避免超长图与内存尖峰）。 */
const MAX_TEXT_LEN = 80000;
// ── DeepSeek 鲸鱼 logo（官方 FishLogo 的 path）─────────────────────────────
const FISH_LOGO_PATH = 'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6' +
    '716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988Z' +
    'M15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z';
/** 内联鲸鱼 SVG（品牌徽标 + 页脚署名共用）。 */
function whale(width, height) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path d="${FISH_LOGO_PATH}" fill="currentColor"/></svg>`;
}
/** 从消息文本提取标题：首个有意义内容行，剥离 Markdown 标记，截断到 64 字符。 */
export function deriveTitle(text, role) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let inFence = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (inFence) {
            if (trimmed.startsWith('```'))
                inFence = false;
            continue;
        }
        if (trimmed.startsWith('```')) {
            inFence = true;
            continue;
        }
        if (trimmed === '')
            continue;
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed))
            continue;
        if (trimmed.startsWith('|'))
            continue;
        const cleaned = trimmed
            .replace(/^#{1,6}\s+/, '')
            .replace(/^>\s*/, '')
            .replace(/^[-*+]\s+/, '')
            .replace(/^\d+[.)]\s+/, '')
            .replace(/^\[[ xX]\]\s+/, '')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/[*_~`]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (cleaned !== '') {
            const limit = 64;
            return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
        }
    }
    return role === 'user' ? '我的提问' : 'AI 回复';
}
/** 时间戳（本地时区，分钟精度）。 */
function stampNow() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
/** 超长正文截断（保留提示尾注）。 */
function clamp(text) {
    return text.length <= MAX_TEXT_LEN ? text : `${text.slice(0, MAX_TEXT_LEN)}\n\n…（内容过长已截断）`;
}
/**
 * mermaid 引擎文件名（renderer.ts 把解压后的引擎投放到临时页面同目录，
 * 页面用相对路径加载 —— file:// 页面无网络，必须同目录）。
 */
export const MERMAID_FILE = 'mermaid.min.js';
/**
 * 页面里「图表是否已渲染完」的全局钩子名。renderer.ts 用它决定要不要等图，
 * 也用它判断本次渲染需不需要投放引擎文件。
 */
export const MERMAID_HOOK = '__shotMermaid';
/**
 * 图表引导脚本：加载引擎 → 逐个围栏渲染 → 失败的围栏回退成源码文本。
 *
 * 逐个 run 而非一次性 run 全部：mermaid 的 runThrowsErrors 在循环末尾抛出第一个
 * 错误，但已 setAttribute('data-processed') 的节点不会重试 —— 一个语法错误会让
 * 后面的好图一起变成裸源码。逐个跑则互不影响。
 */
function mermaidBoot(theme) {
    return `<script src="${MERMAID_FILE}"></script>
<script>
window.${MERMAID_HOOK} = (async () => {
  var nodes = Array.prototype.slice.call(document.querySelectorAll('pre.mermaid'));
  if (nodes.length === 0) return 'empty';
  if (!window.mermaid || typeof window.mermaid.run !== 'function') return 'engine-missing';
  try { window.mermaid.initialize(${mermaidConfigJson(theme)}); } catch (error) { return 'init-failed'; }
  for (var i = 0; i < nodes.length; i += 1) {
    var node = nodes[i];
    // mermaidAPI.render 会先清空容器再解析（r.innerHTML=""），语法错误抛出时
    // 源码已经没了 —— 必须先存原文，失败时还原成源码块，绝不吞内容。
    var source = node.textContent;
    try { await window.mermaid.run({ nodes: [node], suppressErrors: true }); } catch (error) { /* 单张失败不影响其它 */ }
    if (node.querySelector('svg') === null) {
      node.removeAttribute('data-processed');
      node.textContent = source;
    }
  }
  return 'done';
})();
</script>`;
}
/** 渲染单条消息的正文 HTML（assistant 走 Markdown，user 保留换行的纯文本）。 */
async function bodyOf(message, theme) {
    const source = clamp(message.text);
    if (message.role === 'user') {
        return `<div class="content plain">${escapeHtml(source)}</div>`;
    }
    return `<div class="content">${await renderMarkdown(source, theme)}</div>`;
}
/**
 * 组装完整截图 HTML 文档。
 * @param input - 消息、主题、尺寸与文案。
 * @returns HTML 文本与「是否需要 mermaid 引擎」标记。
 */
export async function buildCardHtml(input) {
    const { messages, theme, width, minHeight } = input;
    const first = messages[0];
    if (first === undefined)
        throw new Error('没有可渲染的消息');
    const title = (input.title ?? '').trim() !== ''
        ? input.title.trim()
        : deriveTitle(first.text, first.role);
    const multi = messages.length > 1;
    const chars = messages.reduce((sum, message) => sum + message.text.length, 0);
    const chip = (input.label ?? '').trim() !== ''
        ? input.label.trim()
        : multi ? `${messages.length} 条消息` : (first.role === 'user' ? '提问' : 'AI 回复');
    const sections = [];
    for (const message of messages) {
        const body = await bodyOf(message, theme);
        sections.push(multi
            ? `<section class="seg"><div class="seg-role">${message.role === 'user' ? '我' : 'AI'}</div>${body}</section>`
            : body);
    }
    const note = `${multi ? `${messages.length} 条消息 · ` : ''}${chars.toLocaleString('zh-CN')} 字`;
    // 只有 assistant 正文走 Markdown 管线，user 是纯文本（围栏不会成图）。
    const needsMermaid = messages.some(m => m.role === 'assistant' && hasDiagramFence(clamp(m.text)));
    // 多条消息时段与段之间加细线与角色标签（单条不需要额外分隔）。
    const segCss = multi
        ? `.seg{border-top:1px solid var(--border2)}
.seg:first-child{border-top:none}
.seg-role{padding:calc(var(--pad) * .5) var(--pad) 0;font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--fg3)}
.seg .content{padding-top:calc(var(--pad) * .3)}`
        : '';
    const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=${width}">
<style>${buildCardCss(theme, width, minHeight)}
${segCss}</style></head>
<body><div class="card">
<div class="rail"></div>
<header class="head">
  <span class="mark">${whale(20, 15)}</span>
  <span class="brand">DeepSeek Harness</span>
  <span class="chip">${escapeHtml(chip)}</span>
  <span class="stamp">${stampNow()}</span>
</header>
<h1 class="title">${escapeHtml(title)}</h1>
${sections.join('\n')}
<footer class="foot">
  <span class="whale">${whale(18, 13)}</span>
  <span class="sign">DeepSeek Harness</span>
  <span class="right">${note}</span>
</footer>
</div>${needsMermaid ? `\n${mermaidBoot(theme)}` : ''}</body></html>`;
    return { html, needsMermaid };
}
//# sourceMappingURL=card.js.map