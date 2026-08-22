/**
 * webui — 玻璃质感（Glassmorphism）外观主题（client 半身核心）。
 *
 * 与官方「外观」行（浅色/深色/跟随系统）正交的材质开关：
 *  - 开启 → <html data-dsh-glass> + 注入玻璃样式表 + 通过官方 ThemeRuntime
 *    的 overrideTokens 扩展点把表面色 token 换成半透明 rgba；backdrop-filter
 *    模糊、细腻边框、圆角、柔和投影由注入的 CSS 完成。
 *  - 不透明度可调（40–95%，默认 75）：buildGlassTokens(opacity) 动态生成
 *    token 值，拖动滑块即时重挂覆盖层预览，松手落盘。
 *  - 关闭 → 移除属性与样式表、撤掉 token 覆盖层，界面完全还原。
 *
 * 持久化双通道：
 *  - localStorage（同步读，启动即时恢复避免闪烁）；
 *  - settings.yaml（经 GET/POST /api/webui-appearance，host 半身落盘，
 *    跨浏览器/重启生效；API 不可用时静默降级为仅本地）。
 *
 * 性能与兼容：
 *  - backdrop-filter 全部承载在 ::before 玻璃膜上（仅少量大面板：侧边栏列/
 *    详情列/弹层面板）；消息流等大面积滚动区域只用 token 半透明，不叠加模糊。
 *    ⚠ 不能把 backdrop-filter 直接写在布局容器上——它会使元素成为
 *    position:fixed 后代的 containing block，DSH 内 Menu/Tooltip/Modal/
 *    设置弹层等大量 fixed 浮层会被「钉」进局部坐标系（实测设置弹窗被吸进
 *    侧边栏）；伪元素不产生 containing block，对官方浮层零影响。
 *  - @supports not (backdrop-filter) 时收起玻璃膜并以 linear-gradient 补差
 *    叠层抬高表面不透明度（纯半透明背景降级），文字可读性不受影响。
 */
import type { ThemeRuntime, ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** host 半身暴露的外观设置 API。 */
export const GLASS_API = '/api/webui-appearance'
/** 本地缓存 key：启动同步读取，避免刷新闪烁。 */
export const GLASS_STORAGE_KEY = 'dsh-webui.appearance.glass'
/** 本地缓存 key：玻璃表面不透明度（百分比）。 */
export const GLASS_OPACITY_KEY = 'dsh-webui.appearance.glass-opacity'
/** 不透明度默认值与允许范围（越大越不透）。 */
export const GLASS_OPACITY_DEFAULT = 75
export const GLASS_OPACITY_MIN = 40
export const GLASS_OPACITY_MAX = 95
/** 模式切换事件（供其他模块按需感知）。 */
export const GLASS_MODE_EVENT = 'dsh-webui:glass-mode'

/** 总开关属性：挂在 documentElement 上，全部玻璃规则以其为前缀。 */
const GLASS_ATTRIBUTE = 'data-dsh-glass'

/**
 * 按不透明度百分比生成官方 token 覆盖层（ThemeRuntime.overrideTokens 扩展点）。
 * 每个 token 必须给 { light, dark } 成对值；RGB 取各表面原色（浅=白系、深=
 * neutral-bluish 系），alpha 统一为用户设定值，保证两种色调下文字对比度达标。
 */
function buildGlassTokens(opacityPercent: number): ThemeTokenOverrides {
  const a = Math.min(1, Math.max(0.3, opacityPercent / 100))
  return {
    '--dsw-alias-bg-base': { light: `rgba(255,255,255,${a})`, dark: `rgba(16,17,20,${a})` },
    '--dsw-alias-bg-layer-1': { light: `rgba(255,255,255,${a})`, dark: `rgba(28,29,31,${a})` },
    '--dsw-alias-bg-layer-2': { light: `rgba(252,253,254,${a})`, dark: `rgba(34,35,38,${a})` },
    '--dsw-alias-bg-layer-3': { light: `rgba(250,251,252,${a})`, dark: `rgba(40,41,45,${a})` },
    '--dsw-alias-bg-overlay': { light: `rgba(255,255,255,${a})`, dark: `rgba(46,48,54,${a})` },
    '--dsw-specific-sidebar-fill': { light: `rgba(246,248,251,${a})`, dark: `rgba(20,21,24,${a})` },
  }
}

/** 注入的 <style> 节点（开启期间常驻）。 */
let styleEl: HTMLStyleElement | null = null
/** 当前挂着的 token 覆盖层的 disposer。 */
let retractTokens: (() => void) | null = null

const clampOpacity = (v: number): number =>
  Math.min(GLASS_OPACITY_MAX, Math.max(GLASS_OPACITY_MIN, Math.round(v)))

/** 读本地缓存中的开关状态。 */
export function isGlassOn(): boolean {
  try { return localStorage.getItem(GLASS_STORAGE_KEY) === '1' } catch { return false }
}

/** 读本地缓存中的玻璃表面不透明度（百分比；缺省 75）。 */
export function getGlassOpacity(): number {
  try {
    const v = Number(localStorage.getItem(GLASS_OPACITY_KEY))
    if (Number.isFinite(v) && v > 0) return clampOpacity(v)
  } catch { /* 忽略 */ }
  return GLASS_OPACITY_DEFAULT
}

/**
 * 玻璃质感样式全文。作用目标使用 CSS Modules 产物中稳定的语义后缀
 * （hash 前缀随构建变化，`_frame`/`_sidebarCol` 等后缀不变）。
 *
 * ⚠ 两条实测踩出来的铁律：
 *  1. 布局列容器（_sidebarCol/_detailsCol）**不得**加 backdrop-filter /
 *    filter / isolation / transform——backdrop-filter 等会让元素成为
 *    position:fixed 后代的 containing block（DSH 的设置弹窗等全局浮层
 *    就渲染在 sidebarCol 内），实测弹窗被「钉」进侧边栏；isolation 则
 *    会把弹窗困进局部层叠上下文，被 DOM 序靠后的中央内容整体压住
 *    （输入框盖住设置面板、全屏点不到东西）。这两列的玻璃感完全由
 *    token 半透明 + body 光斑承担，不加任何模糊。
 *  2. 模糊只直加在浮层本体（_panel）上——浮层自身就是 fixed/relative
 *    定位元素，不改变自身定位语义；其内部下拉经 floating-ui portal，
 *    不受影响。文字在 backdrop-filter 元素的内容层，不会被模糊。
 */
/**
 * 浮层面板总选择器：官方 CSS Modules 面板（*_panel）+ 插件/语义类名的
 * 弹窗、抽屉、卡片面板；遮罩层（*mask*）一律排除——遮罩不是面板，
 * 不该获得模糊+高光投影（否则弹窗后面会叠出一张「垫卡」）。
 * ⚠ 必须排除 [class*="webui-"]——本插件自绘 UI（会话导航横条 webui-panel、
 * 以及 composer 弹层的内部元素 webui-eff-panel-head / webui-po-panel-title
 * 等）都含 "panel" 子串，被子串匹配命中会出现「标题行带包裹底色」「贴右缘
 * 隐形毛玻璃卡」等事故；它们的模糊由专属规则提供。
 */
const PANELS_SELECTOR = ':is([class*="panel"], [class*="modal"], [class*="drawer"]):not([class*="mask"]):not([class*="webui-"])'

function buildGlassCss(): string {
  return `
/* ===== dsh-webui 玻璃质感（Glassmorphism）===== */
html[${GLASS_ATTRIBUTE}] {
  --dsh-glass-blur: saturate(160%) blur(18px);
  --dsh-glass-ease: background-color .25s ease, box-shadow .25s ease;
}
/* 玻璃背后的「壁纸」：多层高饱和渐变 + 细噪点（feTurbulence SVG，消除渐变
 * 色带、增加材质颗粒感）。放在 html 上；body 自身转透明（官方 body 与 frame
 * 各有一层半透明底色，双层纱会把壁纸闷死——实测透光率仅剩个位数百分比），
 * 只留 frame 一层纱：壁纸以 ~25% 透光率浮现，文字落在有结构的稳定背景上。
 * fixed 附着，滚动不动；纯静态绘制，无性能开销。 */
html[${GLASS_ATTRIBUTE}] {
  background-color: #eef1f6;
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.55 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E"),
    radial-gradient(60rem 44rem at 46% 42%, rgba(120,165,250,.55), transparent 66%),
    radial-gradient(42rem 28rem at 12% 6%, rgba(96,150,255,.95), transparent 58%),
    radial-gradient(38rem 24rem at 90% 4%, rgba(168,118,255,.85), transparent 60%),
    radial-gradient(48rem 32rem at 82% 94%, rgba(30,200,185,.75), transparent 58%),
    radial-gradient(40rem 28rem at 14% 98%, rgba(255,150,120,.55), transparent 62%);
  background-attachment: fixed;
}
html[${GLASS_ATTRIBUTE}]:has(body[data-ds-dark-theme]) {
  background-color: #0a0b10;
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.6 0 0 0 0 0.65 0 0 0 0 0.78 0 0 0 0.06 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E"),
    radial-gradient(62rem 46rem at 46% 42%, rgba(70,110,235,.50), transparent 68%),
    radial-gradient(42rem 28rem at 12% 6%, rgba(86,132,255,.90), transparent 58%),
    radial-gradient(38rem 24rem at 90% 4%, rgba(148,96,250,.80), transparent 60%),
    radial-gradient(48rem 32rem at 82% 94%, rgba(16,175,162,.70), transparent 58%),
    radial-gradient(40rem 28rem at 14% 98%, rgba(225,90,120,.45), transparent 62%);
}
/* body 让位给 html 壁纸：不再自带底色，避免与 frame 双重蒙纱 */
html[${GLASS_ATTRIBUTE}] body {
  background-color: transparent;
}
/* 浮层面板总选择器：官方 CSS Modules 面板（*_panel）+ 插件/语义类名的
 * 弹窗、抽屉、卡片面板（dsh-memory-panel / skm-panel / skm-modal /
 * auto-panel / auto-drawer / dts__modal-* 等）；遮罩层（*mask*）除外——
 * 遮罩不加高光投影，模糊由各自规则处理。 */
html[${GLASS_ATTRIBUTE}] ${PANELS_SELECTOR} {
  backdrop-filter: var(--dsh-glass-blur);
  -webkit-backdrop-filter: var(--dsh-glass-blur);
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,.50),
    0 0 0 1px rgba(15,17,21,.08),
    0 12px 40px rgba(31,35,41,.16),
    0 2px 8px rgba(31,35,41,.06);
  transition: var(--dsh-glass-ease);
  /* 注意：不在此处挂滑入动画——会与记忆/技能等面板自带的
   * dsh-modal-stagger 动画体系冲突（animation 属性互相覆盖，
   * 面板卡死在初始帧打不开，实测踩坑）。滑入动画只挂在
   * composer 弹层（.dsh-glass-anim-in）上。 */
}
@keyframes dsh-glass-rise {
  from { opacity: 0; transform: translateY(8px); }
}
/* composer 弹出层（推理等级/提示词优化）专用：滑入复用 rise；滑出下沉淡出
 * （由组件 closing 态挂载，播完再卸载）。玻璃关闭时无动画直接显隐（降级） */
.dsh-glass-anim-in { animation: dsh-glass-rise .22s cubic-bezier(.2,.8,.2,1); }
@keyframes dsh-glass-sink-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(6px); }
}
.dsh-glass-anim-out { animation: dsh-glass-sink-out .13s ease forwards; }
html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] ${PANELS_SELECTOR} {
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,.08),
    0 0 0 1px rgba(255,255,255,.05),
    0 12px 40px rgba(0,0,0,.45),
    0 2px 8px rgba(0,0,0,.30);
}
/* 插件自绘面板（记忆/技能/自动化/浏览器 dock 等）去掉自身实色底：
 * 质感交还给毛玻璃模糊 + 壁纸 + 辉光，避免「模糊之上再蒙一层厚纱」。
 * 官方 SettingsRoot .panel 的半透明 token 底不受影响。
 * 用量/技能/记忆三模块的浮层卡共用 dsh-modal-slide-in / -side-in 动画类，
 * 以它为目标可精准覆盖卡根（含用量 KPI 卡），不误伤内部控件。 */
html[${GLASS_ATTRIBUTE}] :is(
    [class*="dsh-memory-panel"],
    [class*="dsh-memory-modal-body"],
    [class*="skm-panel"],
    [class*="skm-modal"],
    [class*="skm-bundle"],
    [class*="auto-panel"],
    [class*="auto-modal"]:not([class*="mask"]),
    [class*="dsh-browser-sites__panel"],
    [class*="dsh-modal-slide-in"],
    [class*="dsh-modal-side-in"]) {
  background-color: transparent;
}
/* 降级：不支持 backdrop-filter 的浏览器 —— 以同色系补差叠层抬高表面
   不透明度（等效纯半透明背景），保证文字可读、层次不塌陷 */
@supports not ((backdrop-filter: blur(4px)) or (-webkit-backdrop-filter: blur(4px))) {
  html[${GLASS_ATTRIBUTE}] [class*="_sidebarCol"] {
    background-image: linear-gradient(rgba(246,248,251,.55), rgba(246,248,251,.55));
  }
  html[${GLASS_ATTRIBUTE}] [class*="_detailsCol"],
  html[${GLASS_ATTRIBUTE}] ${PANELS_SELECTOR} {
    background-image: linear-gradient(rgba(255,255,255,.55), rgba(255,255,255,.55));
  }
  html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] [class*="_sidebarCol"] {
    background-image: linear-gradient(rgba(20,21,24,.55), rgba(20,21,24,.55));
  }
  html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] [class*="_detailsCol"],
  html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] ${PANELS_SELECTOR} {
    background-image: linear-gradient(rgba(28,29,31,.55), rgba(28,29,31,.55));
  }
}
/* 尊重系统「降低透明度」偏好：关闭面板模糊并回到近实心表面，仅保留色调氛围 */
@media (prefers-reduced-transparency: reduce) {
  html[${GLASS_ATTRIBUTE}] ${PANELS_SELECTOR} {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background-image: linear-gradient(rgba(255,255,255,.82), rgba(255,255,255,.82));
  }
  html[${GLASS_ATTRIBUTE}] [class*="_sidebarCol"],
  html[${GLASS_ATTRIBUTE}] [class*="_detailsCol"] {
    background-image: linear-gradient(rgba(255,255,255,.82), rgba(255,255,255,.82));
  }
  html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] ${PANELS_SELECTOR},
  html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] [class*="_sidebarCol"],
  html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] [class*="_detailsCol"] {
    background-image: linear-gradient(rgba(28,29,31,.85), rgba(28,29,31,.85));
  }
}
/* done-pill 悬停滑出的任务/完成记录面板：标准毛玻璃——半透明纱 + 高斯模糊
 * （仅悬停时 visibility 可见，不存在常驻磨砂问题；inline .94 实色需 !important
 * 覆盖。注意：不做「全透明 + blur」——那会变成无实体的隐形磨砂区，实测怪异） */
html[${GLASS_ATTRIBUTE}] [role="dialog"][aria-label*="任务"],
html[${GLASS_ATTRIBUTE}] [role="dialog"][aria-label*="完成记录"] {
  background-color: rgba(22,23,28,.55) !important;
  backdrop-filter: var(--dsh-glass-blur);
  -webkit-backdrop-filter: var(--dsh-glass-blur);
}
html[${GLASS_ATTRIBUTE}] body:not([data-ds-dark-theme]) [role="dialog"][aria-label*="任务"],
html[${GLASS_ATTRIBUTE}] body:not([data-ds-dark-theme]) [role="dialog"][aria-label*="完成记录"] {
  background-color: rgba(255,255,255,.62) !important;
}
html[${GLASS_ATTRIBUTE}] [class*="dsh-peak-card"] {
  backdrop-filter: var(--dsh-glass-blur);
  -webkit-backdrop-filter: var(--dsh-glass-blur);
}
/* 对话输入框卡片：淡版毛玻璃（模糊与表面纱都比浮层面板轻一档，
 * 保留官方细边框与投影的卡片形态） */
html[${GLASS_ATTRIBUTE}] [class*="_composerSeat"] [class*="_card"] {
  background-color: rgba(255,255,255,.40);
  backdrop-filter: saturate(130%) blur(9px);
  -webkit-backdrop-filter: saturate(130%) blur(9px);
}
html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] [class*="_composerSeat"] [class*="_card"] {
  background-color: rgba(30,31,36,.38);
}
/* composer 工具条弹出层（提示词优化 / 选择模型 / 推理等级）：
 * 这三个弹层的底色 token --dsw-specific-menu 引用 --dsw-alias-bg-layer-3，
 * 随玻璃覆盖层半透明（≈0.75 不透明度），但比记忆/技能面板的「完全透明 +
 * 毛玻璃」要实，观感上仍像包着一层深色色块 → 这里同样去掉底色（transparent）、
 * 补毛玻璃模糊与高光投影，对齐记忆面板。
 * ⚠ 必须用精确类选择器（.webui-po-panel / .webui-ms-menu / .webui-eff-panel），
 * 不能用 [class*="webui-po-panel"] 之类子串匹配——webui-po-panel-title /
 * webui-eff-panel-head 等内部文字元素也含 panel 子串，会被误加 backdrop-filter，
 * 造成「标题行带包裹底色」斑块。 */
html[${GLASS_ATTRIBUTE}] :is(
    .webui-po-panel,
    .webui-ms-menu,
    .webui-eff-panel) {
  background-color: transparent;
  backdrop-filter: var(--dsh-glass-blur);
  -webkit-backdrop-filter: var(--dsh-glass-blur);
  animation: dsh-glass-rise .22s cubic-bezier(.2,.8,.2,1);
}
html[${GLASS_ATTRIBUTE}] :is(
    .webui-po-panel,
    .webui-ms-menu,
    .webui-eff-panel) {
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,.50),
    0 0 0 1px rgba(15,17,21,.08),
    0 12px 40px rgba(31,35,41,.16),
    0 2px 8px rgba(31,35,41,.06);
}
html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] :is(
    .webui-po-panel,
    .webui-ms-menu,
    .webui-eff-panel) {
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,.08),
    0 0 0 1px rgba(255,255,255,.05),
    0 12px 40px rgba(0,0,0,.45),
    0 2px 8px rgba(0,0,0,.30);
}
/* 多轮优化候选大卡片（portal 到 body 的全屏居中卡，也是 .webui-po-panel 变体）：
 * 内容多、面积大，完全透明会让背后消息流透出干扰阅读 → 保留一层轻半透明纱
 * （对齐 done-pill 任务面板的标准毛玻璃），毛玻璃模糊仍由上面的 .webui-po-panel
 * 规则提供。 */
html[${GLASS_ATTRIBUTE}] .webui-po-panel-multi {
  background-color: rgba(255,255,255,.62);
}
html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] .webui-po-panel-multi {
  background-color: rgba(22,23,28,.55);
}
/* ===== 右上角「对话/轨迹」入口（仅玻璃质感开启期间）=====
 * 图块按钮去背景；消息弹出卡改毛玻璃（去实色底）+ 滑入动画。
 * 滑出受组件卸载方式限制暂无过渡。 */
html[${GLASS_ATTRIBUTE}] [class*="webui-view-tile"],
html[${GLASS_ATTRIBUTE}] [class*="webui-trigger"] {
  background: transparent;
}
html[${GLASS_ATTRIBUTE}] [class*="webui-popup"] {
  background: rgba(22,24,30,.58);
  backdrop-filter: var(--dsh-glass-blur);
  -webkit-backdrop-filter: var(--dsh-glass-blur);
  animation: dsh-glass-pop-slide .24s cubic-bezier(.2,.8,.2,1);
}
html[${GLASS_ATTRIBUTE}] body:not([data-ds-dark-theme]) [class*="webui-popup"] {
  background: rgba(255,255,255,.62);
}
@keyframes dsh-glass-pop-slide {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
/* ===== 指针辉光（仅玻璃质感开启期间存在）=====
 * Linear/Vercel 风格的「玻璃辉光」：指针落在某个浮层面板上时，该面板自身
 * 泛起一圈跟随指针移动的柔光（radial-gradient 直接叠在宿主 background 上，
 * 坐标由 JS 写入元素内联 CSS 变量 --dsh-glow-x/y）。不新增 DOM 层、不遮挡
 * 文字、无 containing-block/层叠副作用；离开面板即熄灭。 */
html[${GLASS_ATTRIBUTE}] [class*="_panel"][data-dsh-glow] {
  background-image: radial-gradient(260px circle at var(--dsh-glow-x, 50%) var(--dsh-glow-y, 50%),
    rgba(140,170,255,.10), transparent 70%);
}
html[${GLASS_ATTRIBUTE}] body[data-ds-dark-theme] [class*="_panel"][data-dsh-glow] {
  /* 深色底吃颜色，亮度需比浅色高一档：亮核 + 柔边双段结构 */
  background-image: radial-gradient(300px circle at var(--dsh-glow-x, 50%) var(--dsh-glow-y, 50%),
    rgba(150,182,255,.26) 0%,
    rgba(132,120,255,.12) 42%,
    transparent 72%);
}
`.trim()
}

/** DOM 层：切换 html 属性 + 注入/移除样式表 + 聚光灯生灭。 */
function applyGlassDom(on: boolean): void {
  if (on) {
    document.documentElement.setAttribute(GLASS_ATTRIBUTE, '')
    if (styleEl === null || !styleEl.isConnected) {
      styleEl = document.createElement('style')
      styleEl.id = 'dsh-webui-glass'
      styleEl.dataset.plugin = 'dsh-webui'
      styleEl.textContent = buildGlassCss()
      document.head.appendChild(styleEl)
    }
  } else {
    document.documentElement.removeAttribute(GLASS_ATTRIBUTE)
    styleEl?.remove()
    styleEl = null
  }
  // 指针辉光随玻璃开关生灭（放在 applyGlassDom 内保证所有入口行为一致）。
  if (on) ensureCursorGlow()
  else removeCursorGlow()
}

// ── 指针辉光（仅玻璃开启期间存在）─────────────────────────────────────────
// 全局 pointermove（rAF 合帧）+ elementFromPoint 命中检测：指针落在哪个
// 浮层面板内，就把辉光坐标（面板局部系）写到该元素的内联 CSS 变量上，并
// 打 data-dsh-glow 标记点亮；离开即熄灭。不新增 DOM 层。

const GLOW_TARGET_SELECTOR = ':is([class*="panel"], [class*="modal"], [class*="drawer"]):not([class*="mask"]):not([class*="webui-"])'
/** 辉光半径（与 CSS radial-gradient 的 260px circle 保持一致）。 */
const GLOW_RADIUS = 260

let glowMoveHandler: ((event: PointerEvent) => void) | null = null
let glowTarget: HTMLElement | null = null

/** 清除某个面板上的辉光标记。 */
function clearGlowTarget(): void {
  if (glowTarget !== null) {
    glowTarget.removeAttribute('data-dsh-glow')
    glowTarget.style.removeProperty('--dsh-glow-x')
    glowTarget.style.removeProperty('--dsh-glow-y')
    glowTarget = null
  }
}

function applyGlowAt(x: number, y: number): void {
  const hit = document.elementFromPoint(x, y)
  const panel = (hit?.closest(GLOW_TARGET_SELECTOR) as HTMLElement | null) ?? null
  if (panel === null) {
    clearGlowTarget()
    return
  }
  if (panel !== glowTarget) {
    clearGlowTarget()
    glowTarget = panel
    panel.setAttribute('data-dsh-glow', '')
  }
  const rect = panel.getBoundingClientRect()
  // 辉光中心略超出面板边缘也允许（渐变自然淡出），不做裁剪。
  panel.style.setProperty('--dsh-glow-x', `${Math.round(x - rect.left)}px`)
  panel.style.setProperty('--dsh-glow-y', `${Math.round(y - rect.top)}px`)
}

/** 开始跟踪指针并点亮所在面板的辉光。 */
function ensureCursorGlow(): void {
  if (glowMoveHandler !== null) return
  // 直接在事件回调里写 CSS 变量（setProperty 成本极低）。不用 rAF 合帧：
  // 后台/遮挡窗口的 rAF 会被 Chromium 冻结，守卫变量将永久卡死导致辉光
  // 不再跟随（实测踩坑）。
  glowMoveHandler = (event: PointerEvent): void => {
    applyGlowAt(event.clientX, event.clientY)
  }
  window.addEventListener('pointermove', glowMoveHandler, { passive: true })
}

/** 停止跟踪并熄灭全部辉光（关闭玻璃/插件卸载时调用，监听器一并清理）。 */
function removeCursorGlow(): void {
  if (glowMoveHandler !== null) {
    window.removeEventListener('pointermove', glowMoveHandler)
    glowMoveHandler = null
  }
  clearGlowTarget()
}

/**
 * token 层：通过官方 ThemeRuntime.overrideTokens 挂/撤半透明表面色。
 * 重复挂载同一 source 会整层替换（官方语义），因此调不透明度时直接重挂即可。
 * @param theme - 宿主 theme 服务（不可得时跳过，仅剩结构层效果）。
 * @param on - 开关。
 */
function applyGlassTokens(theme: ThemeRuntime | undefined, on: boolean): void {
  if (theme === undefined) return
  if (on) {
    const next = theme.overrideTokens('dsh-webui-glass', buildGlassTokens(getGlassOpacity()))
    // 替换式重挂：旧层 disposer 由 overrideTokens 内部语义接管，只跟踪最新层。
    retractTokens?.()
    retractTokens = next
  } else if (retractTokens !== null) {
    retractTokens()
    retractTokens = null
  }
}

/**
 * 应用玻璃质感开关（UI 入口）：DOM + token + 双通道持久化 + 事件广播。
 * @param on - 目标状态。
 * @param theme - 宿主 theme 服务。
 */
export function setGlassMode(on: boolean, theme?: ThemeRuntime): void {
  applyGlassDom(on)
  applyGlassTokens(theme, on)
  try { localStorage.setItem(GLASS_STORAGE_KEY, on ? '1' : '0') } catch { /* 忽略 */ }
  window.dispatchEvent(new CustomEvent(GLASS_MODE_EVENT, { detail: { on, opacity: getGlassOpacity() } }))
  // settings.yaml 持久化（fire-and-forget；host 未就绪时静默降级为仅本地）
  fetch(GLASS_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ glass: on, opacity: getGlassOpacity() }),
  }).catch(() => {})
}

/**
 * 调整玻璃表面不透明度（百分比）：即时重挂 token 层预览 + 写本地缓存；
 * persist=true 时才落盘 settings.yaml（拖动过程节流用——input 事件传 false，
 * 松手/松键再传 true），并广播事件。
 * @param value - 目标不透明度（自动收敛到允许区间并取整）。
 * @param theme - 宿主 theme 服务。
 * @param opts - persist：是否写入服务端（默认 false 仅本地预览）。
 * @returns 收敛后的实际值。
 */
export function setGlassOpacity(value: number, theme?: ThemeRuntime, opts?: { persist?: boolean }): number {
  const v = clampOpacity(value)
  try { localStorage.setItem(GLASS_OPACITY_KEY, String(v)) } catch { /* 忽略 */ }
  if (isGlassOn()) applyGlassTokens(theme, true)
  window.dispatchEvent(new CustomEvent(GLASS_MODE_EVENT, { detail: { on: isGlassOn(), opacity: v } }))
  if (opts?.persist === true) {
    fetch(GLASS_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ opacity: v }),
    }).catch(() => {})
  }
  return v
}

/**
 * 仅撤销视觉效果（DOM + token 层），不改任何持久化状态——供插件生命周期
 * 卸载时还原原生外观（下次装配仍会按持久化值恢复）。
 * @param theme - 宿主 theme 服务。
 */
export function retractGlass(theme?: ThemeRuntime): void {
  applyGlassDom(false)
  applyGlassTokens(theme, false)
}

/**
 * 启动恢复：localStorage 同步应用（避免刷新闪烁），再以服务端持久化值
 * 校正开关与不透明度（覆盖「换浏览器/清缓存但 settings.yaml 有值」的场景）。
 * @param theme - 宿主 theme 服务。
 */
export function bootGlass(theme?: ThemeRuntime): void {
  const local = isGlassOn()
  if (local) setGlassMode(true, theme)
  fetch(GLASS_API, { cache: 'no-store' })
    .then(r => r.json())
    .then((state) => {
      if (!state) return
      if (typeof state.opacity === 'number' && state.opacity !== getGlassOpacity()) {
        setGlassOpacity(state.opacity, theme)
      }
      if (typeof state.glass === 'boolean' && state.glass !== isGlassOn()) {
        setGlassMode(state.glass, theme)
      }
    })
    .catch(() => { /* host 未更新（API 不存在）：保持本地缓存状态 */ })
}
