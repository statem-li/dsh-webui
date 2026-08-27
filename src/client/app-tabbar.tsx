/**
 * app-tabbar — 移动端「APP 一般体验」底部标签栏（P1-App-5，路径 B：插件自建 Dock + 模拟点击）。
 *
 *  v0.5.2 起由 mobile-menu.tsx 的「左上菜单 + 工作区抽屉」替代，本文件不再被引用
 *  （保留留档，待确认后删除）。
 *
 * 不重排宿主 rail（CSS module 哈希类不可用，architect 实证）；用稳定 selector
 * 对面板触发元素调用原生 .click() 打开面板（先例 Webui.tsx / GalleryStrip.tsx）。
 * 组件用 useIsMobile() 判移动端，桌面直接 return null（零渲染）；挂载点用
 * createRoot 挂到自建 div（先例 sidebar-nav / automation mount）。
 *
 * 五个 tab（sessions/settings/usage/team/memory）与本插件侧边栏导航行
 * （sidebar-nav.tsx 的 dsh-nav-btn / data-nav-slot）或宿主兜底 selector 对接：
 *   - usage / team：sidebar-nav 的独立槽位（data-nav-slot="usage|team"）——已确认存在；
 *   - memory：sidebar-nav 的「自动化」host 合并行槽位（data-nav-slot="memory"）——已确认存在；
 *   - settings：宿主设置触发行（data-slot="sidebar.settings" 的 aria-haspopup="dialog" 按钮）——已确认存在；
 *   - sessions：宿主无 data-nav-slot="sessions" 独立行（grep 实证），按 architect 兜底用
 *     [data-slot="sidebar.workspaces"] button（该容器是 ui-workspace 浏览区，首个按钮可能
 *     是搜索/添加，真机验证）。若后续 host 提供更明确的「会话主页」入口，替换即可。
 *
 * 激活行为取舍：active 状态用本地 useState 记录「最近点击的 tab」，与面板真实开合
 * 不强绑定（移动端宿主面板多为 dialog/portal，开合状态无稳定可观测信号）；点击失败
 * 静默（selector 未就位时不报错）。
 *
 * 红线 A：以下注入式 CSS 注释内未写出「星号紧跟正斜杠」两字符序列（风险仅用文字描述）。
 * 红线 C：容器与全部 tab 规则均包在 @media (max-width: 767.98px) 内；动效降级单独包
 *         (prefers-reduced-motion: reduce)。桌面零渲染、零样式注入。
 */
import { useEffect, useState } from 'react'
import { useIsMobile } from './responsive'

const STYLE_ID = 'dsh-webui-app-tabbar-styles'

/** 单个 tab 定义。 */
interface TabDef {
  /** 稳定 id（对应 data-tab）。 */
  id: string
  /** 显示文字。 */
  label: string
  /** 图标（emoji，简单可靠、真机质感可接受）。 */
  icon: string
  /** 激活目标：命中即调用原生 click（失败静默）。 */
  selector: string
}

/** 五个 tab 与激活目标（稳定 selector；sessions 用 architect 兜底，见文件头注释）。 */
const TABS: readonly TabDef[] = [
  { id: 'sessions', label: '会话', icon: '🏠', selector: '[data-slot="sidebar.workspaces"] button' },
  { id: 'settings', label: '设置', icon: '⚙️', selector: '[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]' },
  { id: 'usage', label: '用量', icon: '📊', selector: '[data-nav-slot="usage"] .dsh-nav-btn' },
  { id: 'team', label: '团队', icon: '👥', selector: '[data-nav-slot="team"] .dsh-nav-btn' },
  { id: 'memory', label: '记忆', icon: '🧠', selector: '[data-nav-slot="memory"] .dsh-nav-btn' },
]

/**
 * 容器 + tab 样式（仿 mobile-app-shell 的注入套路）。
 * 全部包在 767.98px 媒体内；动效降级单独包 prefers-reduced-motion。
 */
const SHEET = `
@media (max-width: 767.98px) {
  #webui-app-tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 300;
    display: flex;
    height: 56px;
    padding: 0 4px calc(var(--webui-safe-bottom, 0px) + 4px);
    box-sizing: border-box;
    background: color-mix(in srgb, var(--dsw-alias-bg-module-platform, #0e1116) 82%, transparent);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
  }
  .webui-tab {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 44px;
    background: none;
    border: none;
    color: var(--dsw-alias-label-tertiary, #999);
    font-size: 10px;
    line-height: 1.2;
    font-family: inherit;
    cursor: pointer;
    position: relative;
    transition: color 180ms ease, transform 180ms ease;
  }
  .webui-tab-icon {
    font-size: 19px;
    line-height: 1;
    transition: transform 180ms ease;
  }
  .webui-tab[data-active="true"] {
    color: var(--dsw-alias-state-business-primary, #4a9eff);
  }
  .webui-tab[data-active="true"] .webui-tab-icon {
    transform: translateY(-1px) scale(1.08);
  }
  /* 顶部指示条（每个 tab 自带，active 时展开）。 */
  .webui-tab::after {
    content: "";
    position: absolute;
    top: -1px;
    left: 50%;
    transform: translateX(-50%) scaleX(0);
    width: 32px;
    height: 2px;
    border-radius: 1px;
    background: var(--dsw-alias-state-business-primary, #4a9eff);
    transition: transform 220ms cubic-bezier(.2, .8, .2, 1);
  }
  .webui-tab[data-active="true"]::after {
    transform: translateX(-50%) scaleX(1);
  }
  /* :active 按压反馈。 */
  .webui-tab:active {
    transform: scale(.96);
  }
}

/* 动效降级：偏好减少动态时全部过渡直接到终态。 */
@media (prefers-reduced-motion: reduce) {
  #webui-app-tabbar * { transition: none !important; }
  .webui-tab[data-active="true"] .webui-tab-icon { transform: none; }
  .webui-tab[data-active="true"]::after { transform: translateX(-50%) scaleX(1); }
  .webui-tab:active { transform: none; }
}
`

/** 幂等注入一段样式（与 injectResponsiveStyles / injectMobileOverrides 同套思路）；返回移除函数。 */
function ensureTabbarStyle(): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/app-tabbar'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

/**
 * 移动端底部标签栏。桌面 return null（零渲染）；移动端注入样式并渲染 5 个 tab。
 * active 为本地 state，记录最近点击的 tab（与面板真实开合不强绑定，见文件头取舍）。
 */
export function AppTabBar(): JSX.Element | null {
  const mobile = useIsMobile()
  const [active, setActive] = useState<string | null>('sessions')

  // 样式随移动端状态注入/清理；桌面不注入任何样式（红线 C）。
  useEffect(() => {
    if (!mobile) return undefined
    return ensureTabbarStyle()
  }, [mobile])

  if (!mobile) return null

  const openTab = (tab: TabDef): void => {
    // 命中即模拟点击打开对应面板；selector 未就位时静默失败。
    document.querySelector<HTMLElement>(tab.selector)?.click()
    setActive(tab.id)
  }

  return (
    <nav id="webui-app-tabbar" aria-label="底部导航">
      {TABS.map(tab => (
        <button
          key={tab.id}
          type="button"
          className="webui-tab"
          data-tab={tab.id}
          data-active={active === tab.id || undefined}
          aria-label={tab.label}
          onClick={() => { openTab(tab) }}
        >
          <span className="webui-tab-icon" aria-hidden="true">{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
