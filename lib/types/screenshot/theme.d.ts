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
/** 截图主题（与 client 端选项一一对应）。 */
export type ShotTheme = 'light' | 'dark' | 'glass' | 'glass-dark';
/** 主题基色：玻璃主题按深浅分别复用浅 / 深调色板。 */
export declare function baseOf(theme: ShotTheme): 'light' | 'dark';
/** 是否玻璃质感主题（半透明卡片 + 壁纸背景）。 */
export declare function isGlass(theme: ShotTheme): boolean;
/**
 * 画布外边距（卡片与截图边缘之间的背景留白）。
 * host 端计算视口宽度时用它保持一致：viewport = width + pad * 2。
 * @param width - 卡片 CSS 宽度。
 */
export declare function canvasPad(width: number): number;
/**
 * 画布上下留白（body 的 padding-top / padding-bottom）。固定画幅时 host
 * 用它从目标视口高反推卡片 min-height，保证短内容也精确撑满目标比例。
 * @param width - 卡片 CSS 宽度。
 */
export declare function canvasPadY(width: number): {
    top: number;
    bottom: number;
};
/**
 * 生成截图页面的完整 `<style>` 内容。
 * @param theme - 四套主题之一。
 * @param width - 卡片 CSS 宽度（手机版约 480~540，电脑版 960~1280）。
 * @param minHeight - 卡片最小高度（短消息不至于过扁）。
 * @returns CSS 文本（含调色板变量 + 卡片骨架 + Markdown 排版 + shiki 适配）。
 */
export declare function buildCardCss(theme: ShotTheme, width: number, minHeight: number): string;
