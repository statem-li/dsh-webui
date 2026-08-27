/**
 * mobile-minimal — 移动端「极简模式」样式注入模块（Wave A，纯样式注入）。
 *
 * 目标：用户真机反馈「跟 PC 页面一模一样，太乱」——在窄屏只留内容区与必要入口，
 *       把冗余 UI（AppFrame 侧栏、会话头右上工具钮、assistant 消息操作行、
 *       composer 多余开关）收进 TabBar / 隐藏，仅保留消息正文与发送链路。
 *       index.ts 挂载由下一波完成；本文件只导出幂等注入函数。
 *
 * 宿主结构依据（主脑 2026-08-26 运行时实测契约，原文照做）：
 *   1. AppFrame 根 = div[data-sidebar-collapsed]（display:grid，collapsed 态计算
 *      列宽 '56px 0px 0px'；侧栏列是第一子元素、class 为 CSS module 哈希不可选）。
 *      只 display:none 会留白 56px，必须同步把列宽 56px 归零。
 *   2. header = [data-slot="conversation.session.header"] 内 titleRow 的 titleCluster
 *      （会话标题，保留）与 headerUtilities（「标准模式/Session log」+「对话/轨迹」
 *      图块 + 消息徽标，隐藏）；不动 titleRow 整体。
 *   3. assistant 消息操作行 = [data-slot="conversation.chat.assistant-actions"]
 *      （display:none；产品 chip 兜底在消息卡内）。
 *   4. composer 开关按钮按 aria 清单隐藏（范围限定在 input 与 composer.bar 内防误伤）。
 *   5. 安全区 = [data-conversation-scroll] 补 env(safe-area-inset-*) 与底部 TabBar 56px。
 *   6. .webui-panel 消息胶囊彻底隐藏，规则放本文件（mobile-overrides.ts 里的窄胶囊旧块
 *      由下一波替换删除；本文件先加新规则并存，注释标明来源）。
 *
 * 红线 A：以下注入式 CSS(sheet) 注释内未写出「星号紧跟正斜杠」两字符序列
 *         （该风险仅用文字描述，字符序列本身不出现）。
 * 红线 C：全部规则包 @media (max-width: 767.98px)（本模块无动效/动画规则，
 *         故不产生 prefers-reduced-motion(reduce) 分支），桌面零回归。
 */

const MINIMAL_STYLE_ID = 'dsh-webui-mobile-minimal-styles'

/** 幂等注入一段样式；返回移除函数。与 injectResponsiveStyles / injectMobileOverrides 同套思路。 */
function ensureStyle(id: string, css: string): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(id) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = id
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/mobile-minimal'
    tag.textContent = css
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

const MINIMAL_SHEET = `
@media (max-width: 767.98px) {
  /* ── 1. AppFrame 根：窄屏隐藏侧栏并归零其列宽（只 display:none 会留白 56px，须同步归零列宽）。
        ⚠ 隐藏侧栏列绝不能 display:none：frame 是 grid 布局，子项按 DOM 顺序自动入轨，
        display:none 会把该子项移出网格流，后续子项整体左移一轨——实测 mobile-minimal
        原实现（display:none + 0 1fr 0）导致 centerCol 掉进 0px 轨道、detailsCol 抢占
        390px 轨道：手机上看不到对话页，只有「详情面板全屏 + 空态提示」。必须用
        visibility:hidden 保留占位（侧栏列自身 overflow:hidden，0px 轨道下内容不泄漏）。 ── */
  [data-sidebar-collapsed] {
    grid-template-columns: 0 minmax(0, 1fr) 0 !important;
  }
  [data-sidebar-collapsed] > *:first-child {
    visibility: hidden !important;
    pointer-events: none !important;
  }

  /* ── 2. header：只隐藏右上工具钮（headerUtilities），保留 titleRow 与标题 ── */
  [data-slot="conversation.session.header"] [class*="headerUtilities"] {
    display: none !important;
  }

  /* ── 2b. 给左上菜单钮（fixed，left=10px+44px 宽）让位：标题行左侧让出 54px。
       仅动 padding-left，与 mobile-overrides 的 padding-right:8px 不同属性，无冲突。
       真机若标题本为居中布局，可改 margin 兜底（以真机为准，先此条）。 ── */
  [data-slot="conversation.session.header"] [class*="titleRow"] {
    padding-left: calc(var(--webui-safe-left, 0px) + 54px) !important;
  }

  /* ── 3. assistant 消息操作行（产品 chip 兜底在消息卡内） ── */
  [data-slot="conversation.chat.assistant-actions"] {
    display: none !important;
  }

  /* ── 4. composer 开关按钮：仅保留 发送消息 / 选择模型 / 上下文已用 / 语音播报 ── */
  :is(
    [data-slot^="conversation.input"],
    [data-slot="conversation.composer.bar"]
  ) :is(
    button[aria-label="命令"],
    button[aria-label^="访问模式"],
    button[aria-label^="记忆注入"],
    button[aria-label^="AI 浏览器"],
    button[aria-label="禁止 AI 使用浏览器"],
    button[aria-label="浏览器提速模式"],
    button[aria-label="优化提示词"],
    button[aria-label="团队模式"],
    button[aria-label^="推理等级"],
    button[title^="推理等级"]
  ) {
    display: none !important;
  }

  /* ── 5. 安全区：顶部让出状态栏，底部让出 TabBar（宿主已给 padding 则用 !important 覆盖） ── */
  [data-conversation-scroll] {
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px)) !important;
  }

  /* ── 6. 消息胶囊彻底隐藏（mobile-overrides.ts 旧窄胶囊样式块已同步替换为 display:none，
        本文件 !important 版本作双保险，二者等价并存） ── */
  .webui-panel {
    display: none !important;
  }
}
`

/**
 * 挂载移动端「极简模式」样式注入；返回一次性移除函数（幂等）。
 * index.ts 用单个 ctx.effect(...) 调用，随插件生命周期卸载。
 */
export function injectMobileMinimal(): () => void {
  return ensureStyle(MINIMAL_STYLE_ID, MINIMAL_SHEET)
}
