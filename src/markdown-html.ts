/**
 * webui — 截图用 Markdown 渲染管线（host 端）。
 *
 * 用 markdown-it（CommonMark + GFM 表格/删除线/linkify）替换 screenshot.ts 的
 * 手写正则，补齐：shiki 语法高亮、emoji 短码（Unicode 字符，非表情包图片库）、
 * 任务清单、嵌套列表、多行引用、表格对齐、图片（白名单 https + no-referrer）。
 *
 * 深浅两套主题用 CSS 变量在 host 端编译成具体色值（截图 HTML 是独立 file://
 * 页面，没有主文档的 --dsw-* token 注入）。emoji 一律 Unicode 字符、装饰图标
 * 一律内联 SVG（品牌 logo 在 screenshot.ts 的卡片模板里）。
 */
import MarkdownIt from 'markdown-it'
import { light as markdownItEmoji } from 'markdown-it-emoji'
import markdownItTaskLists from 'markdown-it-task-lists'
import { createHighlighter, type Highlighter } from 'shiki'

export type ShotTheme = 'light' | 'dark' | 'glass' | 'glass-dark'

/** 预加载的 shiki 语言（与 client 端 markdown/shiki.ts 对齐）。 */
const SHIKI_LANGS: string[] = [
  'bash', 'c', 'cpp', 'csharp', 'css', 'dart', 'dockerfile', 'go', 'html',
  'java', 'javascript', 'json', 'jsx', 'kotlin', 'lua', 'markdown',
  'objective-c', 'objective-cpp', 'php', 'powershell', 'python', 'ruby',
  'rust', 'scala', 'shellscript', 'sql', 'svelte', 'swift', 'toml', 'tsx',
  'typescript', 'vue', 'xml', 'yaml',
]

const SHIKI_THEME: Record<ShotTheme, string> = {
  light: 'github-light',
  dark: 'github-dark',
  glass: 'github-light',
  'glass-dark': 'github-dark',
}

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise === null) {
    highlighterPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: SHIKI_LANGS,
    })
  }
  return highlighterPromise
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** 链接白名单（http/https/mailto），与 client renderer 的 safeLink 对齐。 */
function safeHref(url: string): string {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? url : ''
  } catch {
    return ''
  }
}

/** 图片白名单（http/https），与 client renderer 的 remoteImage 对齐。 */
function safeSrc(url: string): string {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' ? url : ''
  } catch {
    return ''
  }
}

/** markdown-it 15 的 attrGet 返回 string | number | null，这里规整为 string。 */
function attrStr(value: string | number | null | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 把 Markdown 源码渲染为 HTML 片段（不含完整文档/卡片骨架）。
 * shiki 高亮单例异步初始化；markdown-it 的 highlight 回调是同步的，初始化后
 * 直接复用同步的 codeToHtml。
 */
export async function renderMarkdownToHtml(md: string, theme: ShotTheme): Promise<string> {
  const highlighter = await getHighlighter()
  const shikiTheme = SHIKI_THEME[theme]

  const it = new MarkdownIt({
    html: false,
    linkify: true,
    highlight(code, lang) {
      if (lang !== '') {
        try {
          return highlighter.codeToHtml(code, { lang, theme: shikiTheme })
        } catch {
          // 未知/未加载语言 → 降级为无高亮代码块
        }
      }
      return `<pre class="shiki plain"><code>${escapeHtml(code)}</code></pre>`
    },
  })

  // 链接：白名单 + 新窗口 + noopener；非法 URL 置空 href（不可点击）。
  it.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx]!
    token.attrSet('href', safeHref(attrStr(token.attrGet('href'))))
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
    return self.renderToken(tokens, idx, options)
  }

  // 图片：白名单 https + no-referrer；非法 URL 降级为 alt 占位文本。
  it.renderer.rules.image = (tokens, idx, options, _env, self) => {
    const token = tokens[idx]!
    const src = safeSrc(attrStr(token.attrGet('src')))
    if (src === '') {
      return `<span class="md-img-alt">${escapeHtml(attrStr(token.attrGet('alt')) || '图片')}</span>`
    }
    token.attrSet('src', src)
    token.attrSet('referrerpolicy', 'no-referrer')
    return self.renderToken(tokens, idx, options)
  }

  // emoji 短码 → Unicode 字符（关闭 :)、:( 等 shortcuts，避免误伤普通文本）。
  it.use(markdownItEmoji, { shortcuts: {} })
  // 任务清单（checkbox 默认 disabled，截图静态展示）。
  it.use(markdownItTaskLists)

  return it.render(md)
}

// ── 深浅主题 CSS（CSS 变量在 host 端编译为具体色值）────────────────────────

const THEME_VARS: Record<'light' | 'dark', string> = {
  light:
    '--bg:#ffffff;--fg:#24292f;--fg2:#57606a;--fg3:#9aa0a6;--border:#d0d7de;' +
    '--border2:#eaecef;--accent:#4176e6;--code-bg:#f6f8fa;--inline-code:#c7254e;' +
    '--quote-bg:#f6f8fa;--thead-bg:#f6f8fa;--zebra:#fafbfc',
  dark:
    '--bg:#0d1117;--fg:#e6edf3;--fg2:#8b949e;--fg3:#6e7681;--border:#30363d;' +
    '--border2:#21262d;--accent:#679efe;--code-bg:#161b22;--inline-code:#ff7b72;' +
    '--quote-bg:#161b22;--thead-bg:#161b22;--zebra:#161b22',
}

/** 玻璃主题对应的基础色调（glass 用浅色文字，glass-dark 用深色文字）。 */
function baseTheme(theme: ShotTheme): 'light' | 'dark' {
  return theme === 'glass' || theme === 'light' ? 'light' : 'dark'
}

/** 玻璃壁纸（浅色）：高饱和渐变 + feTurbulence 细噪点，与主界面玻璃质感一致。 */
const GLASS_WALLPAPER_LIGHT = `background-color:#eef1f6;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.55 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E"),radial-gradient(60rem 44rem at 46% 42%, rgba(120,165,250,.55), transparent 66%),radial-gradient(42rem 28rem at 12% 6%, rgba(96,150,255,.95), transparent 58%),radial-gradient(38rem 24rem at 90% 4%, rgba(168,118,255,.85), transparent 60%),radial-gradient(48rem 32rem at 82% 94%, rgba(30,200,185,.75), transparent 58%),radial-gradient(40rem 28rem at 14% 98%, rgba(255,150,120,.55), transparent 62%)`

/** 玻璃壁纸（深色）。 */
const GLASS_WALLPAPER_DARK = `background-color:#0a0b10;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.6 0 0 0 0 0.65 0 0 0 0 0.78 0 0 0 0.06 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E"),radial-gradient(62rem 46rem at 46% 42%, rgba(70,110,235,.50), transparent 68%),radial-gradient(42rem 28rem at 12% 6%, rgba(86,132,255,.90), transparent 58%),radial-gradient(38rem 24rem at 90% 4%, rgba(148,96,250,.80), transparent 60%),radial-gradient(48rem 32rem at 82% 94%, rgba(16,175,162,.70), transparent 58%),radial-gradient(40rem 28rem at 14% 98%, rgba(225,90,120,.45), transparent 62%)`

/** 玻璃主题毛玻璃覆盖层：半透明卡片 + backdrop-filter + 高光边框 + 柔和投影 + 半透明内容面。 */
function glassOverlay(dark: boolean): string {
  const card = dark ? 'rgba(22,23,28,.60)' : 'rgba(255,255,255,.62)'
  const shadow = dark
    ? 'inset 0 0 0 1px rgba(255,255,255,.08),0 0 0 1px rgba(255,255,255,.05),0 12px 40px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.30)'
    : 'inset 0 0 0 1px rgba(255,255,255,.50),0 0 0 1px rgba(15,17,21,.08),0 12px 40px rgba(31,35,41,.16),0 2px 8px rgba(31,35,41,.06)'
  const border = dark ? 'rgba(255,255,255,.10)' : 'rgba(15,17,21,.10)'
  return `.card{background-color:${card};backdrop-filter:saturate(160%) blur(18px);-webkit-backdrop-filter:saturate(160%) blur(18px);box-shadow:${shadow};border-radius:20px;overflow:hidden}
.content pre{background:${dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.40)'};border-color:${border}}
.content code{background:${dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.05)'}}
.content pre code{background:none}
.content blockquote{background:${dark ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.32)'}}
.content th{background:${dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.40)'}}
.content tbody tr:nth-child(even){background:${dark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.02)'}}
.content th,.content td{border-color:${border}}
.foot{border-top-color:${border}}`
}

/** 生成截图卡片的完整 `<style>` 内容（含主题变量 + 排版 + shiki/emoji/checkbox 适配）。 */
export function buildThemeCss(theme: ShotTheme, pageWidth: number, pageHeight: number): string {
  const base = baseTheme(theme)
  const isGlass = theme === 'glass' || theme === 'glass-dark'
  const glass = isGlass ? glassOverlay(base === 'dark') : ''
  const wallpaper = isGlass ? (base === 'dark' ? GLASS_WALLPAPER_DARK : GLASS_WALLPAPER_LIGHT) : 'background:var(--bg)'
  return `:root{${THEME_VARS[base]}}
*{margin:0;padding:0;box-sizing:border-box}
html{font-size:16px}
body{${wallpaper};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,sans-serif;color:var(--fg);-webkit-font-smoothing:antialiased}
.card{width:${pageWidth}px;min-height:${pageHeight}px;background:var(--bg);display:flex;flex-direction:column}
.head{display:flex;flex-direction:column;gap:12px;padding:36px 72px 0}
.head-top{display:flex;align-items:center;justify-content:space-between}
.head-brand{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:var(--fg)}
.head-date{font-size:13px;color:var(--fg3)}
.head-title{font-size:24px;font-weight:700;color:var(--fg);line-height:1.35;overflow-wrap:anywhere}
.content{flex:1;padding:30px 72px 24px;font-size:20px;line-height:1.85;color:var(--fg)}
.content p{margin:0 0 .95em}
.content p:last-child{margin-bottom:0}
.content h1,.content h2,.content h3,.content h4,.content h5,.content h6{color:var(--fg);font-weight:650;margin:1.15em 0 .55em;line-height:1.4}
.content h1{font-size:1.7em;border-bottom:1px solid var(--border2);padding-bottom:.3em;margin-top:0}
.content h2{font-size:1.4em}.content h3{font-size:1.2em}.content h4{font-size:1.08em}
.content a{color:var(--accent);text-decoration:underline;text-underline-offset:2px;text-decoration-color:var(--accent)}
.content code{font-family:"SF Mono","JetBrains Mono",Consolas,monospace;font-size:.85em;background:var(--code-bg);padding:.14em .4em;border-radius:4px;color:var(--inline-code)}
.content pre{background:var(--code-bg);border:1px solid var(--border);border-radius:8px;padding:14px 18px;overflow-x:auto;margin:1em 0;line-height:1.6}
.content pre code{background:none;padding:0;color:var(--fg);font-size:.8em}
.content pre.shiki{overflow-x:auto}
.content pre.shiki code{color:inherit;font-size:.8em}
.content blockquote{border-left:4px solid var(--border);margin:1em 0;padding:.5em 1.2em;color:var(--fg2);background:var(--quote-bg);border-radius:0 6px 6px 0}
.content blockquote p:last-child{margin-bottom:0}
.content ul,.content ol{margin:.6em 0 .95em;padding-left:1.9em}
.content li{margin:.3em 0}
.content li>ul,.content li>ol{margin-top:.3em;margin-bottom:0}
.content li.task-list-item{list-style:none;margin-left:-1.4em}
.content input.task-list-item-checkbox{accent-color:var(--accent);margin-right:.55em;width:1.05em;height:1.05em;vertical-align:-.2em}
.content table{border-collapse:collapse;width:100%;font-size:.9em;margin:1em 0}
.content th,.content td{border:1px solid var(--border);padding:.55em .9em;text-align:left;overflow-wrap:anywhere}
.content th{background:var(--thead-bg);font-weight:600}
.content tbody tr:nth-child(even){background:var(--zebra)}
.content hr{border:none;border-top:1px solid var(--border2);margin:1.4em 0}
.content strong{font-weight:650}
.content em{font-style:italic}
.content del{color:var(--fg2)}
.content img{max-width:100%;height:auto;border-radius:8px;display:block;margin:.5em 0}
.md-img-alt{color:var(--fg2);font-style:italic}
.foot{display:flex;align-items:center;justify-content:center;gap:8px;padding:20px 72px 24px;border-top:1px solid var(--border2)}
.foot .brand-left{display:flex;align-items:center;color:var(--fg)}
.foot .brand-right{font-size:14px;color:var(--fg3);letter-spacing:.02em;font-weight:500}
${glass}`
}
