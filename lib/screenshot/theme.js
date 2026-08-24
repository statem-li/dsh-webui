/**
 * webui — 截图卡片主题与样式（host 端，重做版）。
 *
 * 四套主题（浅 / 深 / 玻璃 / 玻璃深）共享同一套 CSS 变量，色值在 host 端编译成
 * 具体值——截图 HTML 是独立 file:// 页面，拿不到主界面注入的 --dsw-* token。
 *
 * 版式要点（与旧版「满幅白底」的区别）：
 *  - 卡片浮在背景画布上（外边距 + 圆角 24 + 投影），不再撑满整张图；
 *  - 顶部一条强调色导轨 + 品牌徽标块，页脚一条细线 + 鲸鱼署名；
 *  - 正文排版按宽度自适应（960 / 1200 / 1440 三档预设共用同一套比例）。
 *
 * emoji 一律 Unicode 字符、装饰图标一律内联 SVG（品牌 logo 见 card.ts）。
 */
/** 主题基色：玻璃主题按深浅分别复用浅 / 深调色板。 */
export function baseOf(theme) {
    return theme === 'light' || theme === 'glass' ? 'light' : 'dark';
}
/** 是否玻璃质感主题（半透明卡片 + 壁纸背景）。 */
export function isGlass(theme) {
    return theme === 'glass' || theme === 'glass-dark';
}
/** 调色板（编译进截图 HTML 的 CSS 变量值）。 */
const PALETTE = {
    light: {
        canvas: '#eaeef6',
        canvasGlow: 'radial-gradient(72rem 44rem at 50% -12%, rgba(65,118,230,.16), transparent 68%)',
        card: '#ffffff',
        fg: '#1a1f28',
        fg2: '#4b5462',
        fg3: '#8c94a4',
        border: '#e4e8f0',
        border2: '#eef1f6',
        accent: '#4176e6',
        accentSoft: 'rgba(65,118,230,.12)',
        codeBg: '#f5f7fb',
        inlineCode: '#c7254e',
        quoteBg: '#f7f9fc',
        theadBg: '#f2f5fa',
        zebra: '#fafbfd',
        shadow: '0 28px 68px rgba(19,25,40,.14),0 2px 10px rgba(19,25,40,.06)',
    },
    dark: {
        canvas: '#080a0f',
        canvasGlow: 'radial-gradient(72rem 44rem at 50% -12%, rgba(103,158,254,.18), transparent 68%)',
        card: '#13161d',
        fg: '#e8edf5',
        fg2: '#a3adbd',
        fg3: '#767f8f',
        border: '#242932',
        border2: '#1c2128',
        accent: '#679efe',
        accentSoft: 'rgba(103,158,254,.16)',
        codeBg: '#0f1319',
        inlineCode: '#ff8b81',
        quoteBg: '#10141a',
        theadBg: '#161b22',
        zebra: '#151a21',
        shadow: '0 28px 68px rgba(0,0,0,.55),0 2px 10px rgba(0,0,0,.35)',
    },
};
/** 玻璃壁纸（浅色）：高饱和渐变 + feTurbulence 细噪点，与主界面玻璃质感一致。 */
const WALLPAPER_LIGHT = `background-color:#eef1f6;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.55 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E"),radial-gradient(60rem 44rem at 46% 42%, rgba(120,165,250,.55), transparent 66%),radial-gradient(42rem 28rem at 12% 6%, rgba(96,150,255,.95), transparent 58%),radial-gradient(38rem 24rem at 90% 4%, rgba(168,118,255,.85), transparent 60%),radial-gradient(48rem 32rem at 82% 94%, rgba(30,200,185,.75), transparent 58%),radial-gradient(40rem 28rem at 14% 98%, rgba(255,150,120,.55), transparent 62%)`;
/** 玻璃壁纸（深色）。 */
const WALLPAPER_DARK = `background-color:#0a0b10;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.6 0 0 0 0 0.65 0 0 0 0 0.78 0 0 0 0.06 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E"),radial-gradient(62rem 46rem at 46% 42%, rgba(70,110,235,.50), transparent 68%),radial-gradient(42rem 28rem at 12% 6%, rgba(86,132,255,.90), transparent 58%),radial-gradient(38rem 24rem at 90% 4%, rgba(148,96,250,.80), transparent 60%),radial-gradient(48rem 32rem at 82% 94%, rgba(16,175,162,.70), transparent 58%),radial-gradient(40rem 28rem at 14% 98%, rgba(225,90,120,.45), transparent 62%)`;
/** 玻璃主题覆盖层：半透明卡片 + backdrop-filter + 高光内边框。 */
function glassLayer(dark) {
    const card = dark ? 'rgba(20,22,28,.62)' : 'rgba(255,255,255,.64)';
    const hairline = dark ? 'rgba(255,255,255,.10)' : 'rgba(15,17,21,.10)';
    const inset = dark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.55)';
    const fill = dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.42)';
    return `.card{background-color:${card};border-color:${hairline};backdrop-filter:saturate(165%) blur(20px);-webkit-backdrop-filter:saturate(165%) blur(20px);box-shadow:inset 0 0 0 1px ${inset},var(--shadow)}
.mark{background:${fill}}
.content pre,.content th{background:${fill};border-color:${hairline}}
.content code{background:${dark ? 'rgba(255,255,255,.10)' : 'rgba(15,17,21,.06)'}}
.content pre code{background:none}
.content blockquote{background:${dark ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.34)'}}
.content td{border-color:${hairline}}
.content tbody tr:nth-child(even){background:${dark ? 'rgba(255,255,255,.03)' : 'rgba(15,17,21,.02)'}}
.foot{border-top-color:${hairline}}`;
}
/**
 * 版式尺度：按 CSS 宽度线性插值，一套比例同时覆盖手机窄幅（480）与电脑宽幅
 * （1280）——窄幅收紧留白与字号，宽幅放大标题、拉开呼吸感。
 */
function metrics(width) {
    const ratio = Math.max(0, Math.min(1, (width - 480) / 800));
    const round = (from, to) => Math.round(from + (to - from) * ratio);
    return {
        pad: round(22, 50),
        title: round(20, 30),
        body: round(15, 19),
        radius: round(18, 24),
        // 卡片外的画布留白：手机版几乎贴边，电脑版留出投影空间。
        outer: round(14, 40),
        brand: round(13, 15),
    };
}
/**
 * 画布外边距（卡片与截图边缘之间的背景留白）。
 * host 端计算视口宽度时用它保持一致：viewport = width + pad * 2。
 * @param width - 卡片 CSS 宽度。
 */
export function canvasPad(width) {
    return metrics(width).outer;
}
/**
 * 画布上下留白（body 的 padding-top / padding-bottom）。固定画幅时 host
 * 用它从目标视口高反推卡片 min-height，保证短内容也精确撑满目标比例。
 * @param width - 卡片 CSS 宽度。
 */
export function canvasPadY(width) {
    const outer = metrics(width).outer;
    return { top: outer, bottom: Math.round(outer * 1.2) };
}
/**
 * 生成截图页面的完整 `<style>` 内容。
 * @param theme - 四套主题之一。
 * @param width - 卡片 CSS 宽度（手机版约 480~540，电脑版 960~1280）。
 * @param minHeight - 卡片最小高度（短消息不至于过扁）。
 * @returns CSS 文本（含调色板变量 + 卡片骨架 + Markdown 排版 + shiki 适配）。
 */
export function buildCardCss(theme, width, minHeight) {
    const base = baseOf(theme);
    const glass = isGlass(theme);
    const p = PALETTE[base];
    const m = metrics(width);
    const vars = Object.entries(p).map(([key, value]) => `--${key}:${value}`).join(';');
    const canvas = glass
        ? (base === 'dark' ? WALLPAPER_DARK : WALLPAPER_LIGHT)
        : `background-color:var(--canvas);background-image:var(--canvasGlow)`;
    return `:root{${vars};--w:${width}px;--pad:${m.pad}px;--radius:${m.radius}px}
*{margin:0;padding:0;box-sizing:border-box}
html{font-size:16px;-webkit-text-size-adjust:100%}
body{${canvas};padding:${m.outer}px ${m.outer}px ${Math.round(m.outer * 1.2)}px;color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.card{width:var(--w);min-height:${minHeight}px;margin:0 auto;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
/* 顶部强调色导轨 */
.rail{flex:none;height:3px;background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 25%,transparent) 62%,transparent)}
/* 页头：徽标块 + 品牌 + 角色标签 + 右侧时间 */
.head{flex:none;display:flex;align-items:center;gap:14px;padding:calc(var(--pad) * .78) var(--pad) 0}
.mark{flex:none;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--accentSoft);color:var(--accent)}
.brand{font-size:${m.brand}px;font-weight:650;letter-spacing:.01em}
.chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:11px;background:var(--accentSoft);color:var(--accent);font-size:12px;font-weight:600;line-height:1}
.stamp{margin-left:auto;font-size:13px;color:var(--fg3);font-variant-numeric:tabular-nums;white-space:nowrap}
/* 标题 */
.title{flex:none;padding:calc(var(--pad) * .62) var(--pad) 0;font-size:${m.title}px;font-weight:700;line-height:1.36;letter-spacing:-.01em;overflow-wrap:anywhere}
/* 正文 */
.content{flex:1;padding:calc(var(--pad) * .6) var(--pad) calc(var(--pad) * .8);font-size:${m.body}px;line-height:1.8;color:var(--fg)}
.content.plain{white-space:pre-wrap;overflow-wrap:anywhere}
.content > :first-child{margin-top:0}
.content > :last-child{margin-bottom:0}
.content p{margin:0 0 .9em}
.content h1,.content h2,.content h3,.content h4,.content h5,.content h6{font-weight:650;margin:1.15em 0 .5em;line-height:1.4;letter-spacing:-.005em}
.content h1{font-size:1.55em;padding-bottom:.28em;border-bottom:1px solid var(--border2)}
.content h2{font-size:1.32em}
.content h3{font-size:1.16em}
.content h4{font-size:1.06em}
.content a{color:var(--accent);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--accent) 45%,transparent)}
.content code{font-family:"SF Mono","JetBrains Mono",Consolas,monospace;font-size:.86em;background:var(--codeBg);padding:.14em .42em;border-radius:5px;color:var(--inlineCode)}
.content pre{background:var(--codeBg);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin:1.05em 0;overflow:hidden;line-height:1.62}
.content pre code{background:none;padding:0;color:var(--fg);font-size:.82em;white-space:pre-wrap;overflow-wrap:anywhere}
.content pre.shiki code{color:inherit}
.content blockquote{margin:1em 0;padding:.6em 1.2em;border-left:3px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:0 10px 10px 0;background:var(--quoteBg);color:var(--fg2)}
.content blockquote p:last-child{margin-bottom:0}
.content ul,.content ol{margin:.55em 0 .9em;padding-left:1.7em}
.content li{margin:.28em 0}
.content li>ul,.content li>ol{margin-top:.28em;margin-bottom:0}
.content li::marker{color:var(--fg3)}
.content li.task-list-item{list-style:none;margin-left:-1.35em}
.content input.task-list-item-checkbox{accent-color:var(--accent);margin-right:.5em;width:1.02em;height:1.02em;vertical-align:-.16em}
.content table{border-collapse:separate;border-spacing:0;width:100%;font-size:.9em;margin:1em 0;border:1px solid var(--border);border-radius:12px;overflow:hidden}
.content th,.content td{padding:.6em .95em;text-align:left;overflow-wrap:anywhere;border-bottom:1px solid var(--border)}
.content tr:last-child td{border-bottom:none}
.content th{background:var(--theadBg);font-weight:600}
.content tbody tr:nth-child(even){background:var(--zebra)}
.content hr{border:none;border-top:1px solid var(--border2);margin:1.5em 0}
.content strong{font-weight:650}
.content del{color:var(--fg3)}
.content img{max-width:100%;height:auto;border-radius:10px;display:block;margin:.6em 0}
.md-img-alt{color:var(--fg3);font-style:italic}
/* 页脚：细线 + 鲸鱼署名 + 右侧统计 */
.foot{flex:none;display:flex;align-items:center;gap:9px;margin:0 var(--pad);padding:16px 0 calc(var(--pad) * .52);border-top:1px solid var(--border2);color:var(--fg3);font-size:13px}
.foot .whale{display:flex;align-items:center;color:var(--fg2)}
.foot .sign{color:var(--fg2);font-weight:500;letter-spacing:.01em}
.foot .right{margin-left:auto;font-variant-numeric:tabular-nums}
// 手机窄幅：页头放不下「品牌 + 徽章 + 时间」一行，收起时间戳并缩小徽标块。
// 宽度是编译期已知值，直接按宽度出条件 CSS，不用媒体查询。
${width < 640 ? `.head{gap:10px;padding-top:calc(var(--pad) * .9)}.mark{width:30px;height:30px;border-radius:9px}.mark svg{width:17px;height:13px}.stamp{display:none}.chip{height:20px;padding:0 8px;font-size:11px}.foot{font-size:12px}` : ''}
${glass ? glassLayer(base === 'dark') : ''}`;
}
//# sourceMappingURL=theme.js.map