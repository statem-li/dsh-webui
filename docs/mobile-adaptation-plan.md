# 移动端适配改造方案 · dsh-webui

> 目标设备：手机浏览器 360px–430px（iPhone 刘海屏 / Android 挖孔屏，需 `safe-area-inset` 全向适配）。
> 约束：仅通过 `@dsh-external/dsh-webui` 插件注入（CSS/JS slot 组件）扩展，**禁止改 DSH 宿主源码**。
> 红线 A：注入式 CSS 字符串内注释**严禁出现「星号紧跟正斜杠」两字符序列**（会提前闭合注释、拖垮后续规则）；描述风险时只用「星号+斜杠」等文字。
> 红线 B：**凡是影响性能的插件需求一律不做**；涉及性能项一律标注权衡，优先轻量 CSS。
> 用户偏好：UI 改动默认带动效（过渡/按压反馈），全部动效须包 `@media (prefers-reduced-motion: reduce)` 降级。

---

## ① 现状审计结论

### 已有移动端基础（经 `responsive.ts` / `index.ts` / 团队结构证据核实）

| 层 | 内容 | 载体 |
|---|---|---|
| 断点识别 | `MOBILE_BREAKPOINT = 768`，`isMobileViewport()` / `useIsMobile()` hook | `src/client/responsive.ts` |
| 宿主设置面板单列化 | DSH 官方设置面板 188px 左导航 → 顶部横向滚动 tab + 单列内容 | `injectResponsiveStyles()`（`responsive.ts` 注入 `<style>`） |
| 对话框全屏化 | 所有居中对话框（`[role=dialog][aria-modal=true]`）移动端 `width:100vw/height:100dvh` | 同上 |
| 各组件弹窗/抽屉全屏 | 已含 `@media (max-width:767.98px)` 块：tool-summary / memory / file-explorer / browser / image-gallery / message-deliverables / team | 各 `styles.ts` |

### 缺口审计矩阵（观月汇总 + 主脑核对源码确认）

> 说明：表内事实均按现有源码与团队证据逐一核对（主脑复核）；缺口严重度按「横滚 > 触控 <44px > hover 依赖 > 固定宽 > z-index 遮罩 > safe-area 缺失」排序。

| 模块/区域 | 已覆盖 | 缺口 | 严重度 |
|---|---|---|---|
| 会话顶栏（消息扁平条 `webui`/`.webui-panel`） | — | 触屏无 hover；196px 条只遮挡内容；`titleRow{padding-right:100px}` 是为右上按钮让位，窄屏过挤 | **高**（P0）|
| 会话头部图块/trigger/shot-btn | — | 各 ~36–40px，<44px 触碰基线 | **高**（P0）|
| 用量仪表盘 dashboard（Workbench/UsageTab/TrendTab） | — | PopoverShell 非全屏；trend bento 多列不换列；AreaChart/BarChart/ShareColumns legend `min-width:170/180/240` 撑破横滚；RangePicker 触碰 <44px | **高**（P0）|
| 全局 body / 输入字重 | — | sidebar `font-size:14px`、输入 textarea 未在移动端放大 → iOS 聚焦键盘会放大页面 | **高**（P0）|
| 输入 textarea 属性（inputmode/autocomplete/enterkeyhint） | — | 宿主 `InputBar.tsx:737` 仅 `rows={2}`，**无**这三个属性；CSS 改不了属性，需 JS `setAttribute` | **高**（P0）|
| safe-area-inset | — | 全屏 sheet/浮钮/底部固定元素未垫 `env(safe-area-inset-*)` | **高**（P0）|
| 回到顶部 | — | 长会话移动端无快捷回到顶部 | **中**（P1，含动效）|
| 右侧服务导航 rail 会话切换 | 折叠成 56px rail（宿主行为） | 非抽屉；grid 抽屉化属宿主源码，**插件不可 over** | **高**（宿主限制，见风险）|
| `.psh-card[data-mode=sheet]` | media 内 safe-bottom 一行 | 曾误写一条 media 外重复规则（已按神代 P-B2 修订） | **低**（已修订）|

---

## ② 分级改造清单

> 工作量：XS≈0.5h / S≈1–2h / M≈0.5d。优先级：P0=必做（影响可用性）、P1=推荐、P2=可选。

| 编号 | 项 | 模块 | 优先级 | 工作量 | 理由 |
|---|---|---|---|---|---|
| P0-1 | 会话顶栏：窄屏隐藏/收起消息扁平条，`titleRow` padding 降为 8px，图块/trigger/关闭钮提到 ≥44px | `styles.ts` + `Webui.tsx` | P0 | S | 消除触屏无 hover 与 196px 遮挡，标题行完整可见、无横滚 |
| P0-2 | 用量仪表盘：PopoverShell 强制全屏 sheet；trend bento 单列；legend `min-width` 归零+换行；RangePicker ≥44px | `usage/dashboard/*` | P0 | M | 图表图例移动端不再撑破横滚，tab 切换保留动画 |
| P0-3 | 新增全局 `mobile-overrides.ts`：safe-area 变量、全局触碰目标、正文 ≥16px、点击反馈、`.webui-panel` 取舍 | `mobile-overrides.ts`（新） | P0 | M | 一次性补齐跨模块移动端基线 |
| P0-4 | 输入框属性兜底（inputmode/autocomplete/enterkeyhint）+ observer 早退（红线 B） | `mobile-overrides.ts` | P0 | S | 缓解 iOS 聚焦自动放大；早退避免逐 token 空转 |
| P1-1 | 回到顶部浮钮（含淡入+按压反馈，`prefers-reduced-motion` 降级） | `back-to-top.tsx`（新） | P1 | S | 长会话移动端可用性；满足用户动效偏好 |
| P1-2 | 消息扁平条改「窄胶囊」保留快速跳转（替代 `display:none`） | `mobile-overrides.ts` | P1 | S | 若用户选择保留入口；删号方案则跳过 |
| P2-1 | `.webui-view-tile`/`.webui-trigger` 提升至严格 44px | `mobile-overrides.ts` | P2 | M | 当前 36–40px 偏小，真机后定夺 |
| P2-2 | 触底加载（可选） | — | P2 | M | **红线 B：明确不做进必做**；宿主用 `hasMore+loadOlder` 分页，保留分页，仅放大按钮+垫 safe-area |

**冲突与取舍（主脑整合裁定）**
- **去掉消息扁平条 vs 保留窄胶囊**：`.webui-panel{display:none}` 会让移动端失去「消息 N」快速跳转入口，属**产品取舍**，不能由 coder 单方定——上游均聚焦技术可行性。**裁定**：文档按「默认隐藏（P0-3），保留窄胶囊为 P1 可选」两案并陈，**待用户拍板**后方可定稿默认值。
- **琉夏 vs 神代（P-B1）**：琉夏原本对 `MutationObserver` 无早退；神代判红线 B 必改。**采纳神代**：设置成功后 `mo.disconnect()`，见 P0-4 示例。
- **琉夏 vs 神代（P-B2）**：琉夏在 media 外误写一条全局 `.psh-card[data-mode=sheet]`，与 media 内重复。**采纳神代**：删除媒体外全局规则，仅留媒体内一条。
- **44px vs 36–40px**：琉夏标「严格 44px 需 M 工作量」推迟；神代提示 44px 为移动端基线。**裁定**：作为真机验证项（P2-1），暂不做进 P0，避免阻塞验收。

---

## ③ 代码示例（分文件，可直接复制；注：注释均遵守红线 A，未写出「星号+斜杠」两字符序列）

### 3.1 `src/client/responsive.ts`（扩展：加全局安全区变量）

在文件内 `SHEET` 模板字符串的 `@media` 块**之前**插入一段 `:root`：

```ts
const SHEET = `
/* ── 移动端安全区变量：桌面 env()=0，无副作用；供全屏 sheet/浮钮/底部固定元素取用 ── */
:root {
  --webui-safe-top: env(safe-area-inset-top, 0px);
  --webui-safe-right: env(safe-area-inset-right, 0px);
  --webui-safe-bottom: env(safe-area-inset-bottom, 0px);
  --webui-safe-left: env(safe-area-inset-left, 0px);
}
/* ⚠ 本文件所有注释内严禁写出「星号紧跟正斜杠」组合，否则会提前闭合注释、拖垮后续规则。
     描述该风险时只用文字，切勿真正写出该组合（本行已刻意用文字替代）。 */

@media (max-width: 767.98px) {
  /* ……原有内容保持不变…… */
`
```

> 挂载说明：不改动 `injectResponsiveStyles()` 既有幂等/移除逻辑；仅把 `:root` 块并进同一注入 sheet，随插件生命周期统一清理。桌面 `env()` 不识别时回退 `0px`，零回归。

### 3.2 `src/client/mobile-overrides.ts`（新建：全局移动端覆盖 + 输入框属性兜底）

```ts
/**
 * dsh-webui — 移动端全局覆盖（触控目标/输入字号/头部收起等）。
 *
 * 与 responsive.ts 分工：
 *   - responsive.ts 管「宿主设置面板单列化 + 对话框全屏」这类插件自身 CSS 覆盖不了的行为；
 *   - 本文件管「插件自有组件（view-tile/trigger/psh-close/消息条/正文）」在窄屏的
 *     触控目标、字号、safe-area、点击反馈，以及输入框属性兜底（JS setAttribute）。
 *
 * 红线 A：以下所有注入注释均未写出「星号紧跟正斜杠」两字符序列。
 * 红线 B：输入框属性兜底在设置成功后立即停止 MutationObserver，避免逐 token 空转。
 */
import type { ClientContext } from ... // 若无需要可不引入；纯 DOM 函数即可

const STYLE_ID = 'dsh-webui-mobile-overrides'

/** 幂等注入一段样式；返回移除函数。与 injectResponsiveStyles() 套路一致。 */
function ensureStyle(id: string, css: string): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(id) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = id
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/mobile-overrides'
    tag.textContent = css
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

const SHEET = `
@media (max-width: 767.98px) {
  /* ── 触控目标：关键按钮提到触碰基线（至少 44px 高命中区） ── */
  .webui-view-tile,
  .webui-trigger,
  .webui-trigger-badge,
  .psh-close {
    min-height: 44px;
  }
  .webui-view-tile,
  .webui-trigger {
    min-width: 44px;
  }

  /* ── 正文/输入字号：不小于 16px，防 iOS 聚焦键盘自动放大页面 ── */
  [data-conversation-scroll] [class*="body"],
  [data-composer-seat] {
    font-size: clamp(16px, 4vmin, 17px);
  }
  [data-input-scroll] textarea {
    font-size: 16px !important;
    line-height: 1.45;
  }

  /* ── 会话头部 titleRow：去掉为右上按钮组预留的 100px，改 8px ── */
  [data-slot="conversation.session.header"] [class*="titleRow"] {
    padding-right: 8px !important;
    min-height: 44px;
  }
  /* 右上按钮组允许换行 + 右对齐，避免与标题重叠（若真机重叠再回退，见 P-B4） */
  [data-slot="conversation.session.header"] [class*="webui-host"] {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* ── 全局点击反馈：按钮/图块按下轻微缩放 + 背景变化 ── */
  .webui-view-tile,
  .webui-trigger,
  .psh-close,
  .webui-panel button {
    transition: transform 120ms ease, background-color 120ms ease;
  }
  .webui-view-tile:active,
  .webui-trigger:active,
  .psh-close:active,
  .webui-panel button:active {
    transform: scale(.96);
  }

  /* ── 右侧「消息」扁平条：窄屏默认隐藏（产品取舍，见待确认；若要保留改 P1 窄胶囊） ── */
  .webui-panel {
    display: none;
  }

  /* ── touch-action：仅对交互/滚动容器，避免拖拽 handle 被误伤（宿主 DragHandle 为 touch-action:none） ── */
  [data-conversation-scroll] *,
  [data-composer-card] {
    touch-action: manipulation;
  }

  /* ── 全屏 sheet 底部 safe-area 内边距（仅此一条，勿在媒体外重复） ── */
  .psh-card[data-mode="sheet"] {
    padding-bottom: var(--webui-safe-bottom, 0px);
  }
}

/* ── 动效降级：所有过渡/缩放动画在用户偏好减少动态时直接到终态 ── */
@media (prefers-reduced-motion: reduce) {
  .webui-view-tile,
  .webui-trigger,
  .psh-close,
  .webui-panel button {
    transition: none !important;
  }
  .webui-view-tile:active,
  .webui-trigger:active,
  .psh-close:active,
  .webui-panel button:active {
    transform: none !important;
  }
}
`

/** 注入全局移动端覆盖；返回移除函数。 */
export function injectMobileOverrides(): () => void {
  return ensureStyle(STYLE_ID, SHEET)
}

/**
 * 输入框属性兜底：为宿主 textarea 补齐 inputmode/enterkeyhint/autocomplete。
 * 这些是「属性」而非样式，CSS 无法修改，只能用 JS setAttribute 补。
 * 红线 B：textarea 是常驻节点（已核实跨 draft 复用、不随 draft 重挂），
 * 设置成功后立即断开 observer，避免后续逐 token 的 DOM 变更反复触发
 * querySelector+hasAttribute 空转。
 */
export function applyMobileInputAttributes(): () => void {
  if (typeof document === 'undefined') return () => {}
  let disposed = false
  let mo: MutationObserver | null = null
  const mark = 'data-webui-input-attrs'
  const apply = (): void => {
    if (disposed) return
    const ta = document.querySelector<HTMLTextAreaElement>('[data-input-scroll] textarea')
    if (!ta || ta.hasAttribute(mark)) return
    ta.setAttribute('inputmode', 'text')
    ta.setAttribute('enterkeyhint', 'send')
    ta.setAttribute('autocomplete', 'off')
    ta.setAttribute(mark, '1')
    // 成功后停止观察（红线 B）。
    mo?.disconnect()
  }
  apply()
  mo = new MutationObserver(() => apply())
  mo.observe(document.body, { childList: true, subtree: true })
  return () => { disposed = true; mo?.disconnect() }
}
```

> 挂载说明：两函数均在 `apply()` 里通过 `ctx.effect(() => ..., 'webui: ...')` 接入，随插件生命周期清理；幂等 + 返回移除函数，与现有 `injectResponsiveStyles()` 一致。
> 类名/变量说明：颜色沿用主题兜底（`--dsw-alias-border-l1` 等，reviewer 已实证在 `responsive.ts:93` 使用）；`--dsw-alias-bg-elevated/--dsw-alias-text-primary` 为按命名惯例推断的**待确认** token，落地前需随 DSH 主题核对，且一律带兜底值。

### 3.3 `src/client/back-to-top.tsx`（新建：回到顶部浮钮，带动效 + 降级）

```tsx
import { useEffect, useRef, useState } from 'react'

// 注入式 CSS：注释遵守红线 A，未写出「星号+斜杠」两字符序列。
const STYLE_ID = 'dsh-webui-back-to-top'
const SHEET = `
#webui-back-to-top {
  position: fixed;
  right: calc(var(--webui-safe-right, 0px) + 14px);
  bottom: calc(var(--webui-safe-bottom, 0px) + 80px);
  z-index: 200;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-elevated, rgba(28,30,34,.92));
  color: var(--dsw-alias-text-primary, #fff);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
  box-shadow: 0 4px 16px rgba(0,0,0,.18);
  cursor: pointer;
  opacity: 0;
  transform: translateY(8px) scale(.92);
  pointer-events: none;
  transition: opacity 200ms ease, transform 200ms ease, background-color 120ms ease;
}
#webui-back-to-top.show {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
#webui-back-to-top:active {
  transform: scale(.94);
  background-color: rgba(80,90,120,.92);
}
@media (prefers-reduced-motion: reduce) {
  #webui-back-to-top { transition: none; }
  #webui-back-to-top:active { transform: none; }
}
`

function ensureStyle(): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/back-to-top'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

export function BackToTopButton(): JSX.Element | null {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const removeStyle = ensureStyle()
    const scroller = document.querySelector('[data-conversation-scroll]')
    const onScroll = (): void => {
      const el = (scroller as HTMLElement | null) ?? document.scrollingElement
      setShow((el?.scrollTop ?? 0) > 400)
    }
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      scroller?.removeEventListener('scroll', onScroll)
      removeStyle()
    }
  }, [])

  const scrollTop = (): void => {
    const el = document.querySelector('[data-conversation-scroll]') as HTMLElement | null
    el?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <button
      id="webui-back-to-top"
      ref={ref}
      type="button"
      className={show ? 'show' : ''}
      aria-label="回到顶部"
      onClick={scrollTop}
    >
      ▲
    </button>
  )
}
```

> 挂载说明：见 3.4。`<button>` 在 `show` 为 false 时 `pointer-events:none`、不可点，不阻塞输入区；出现/消失用淡入+上移+缩放动画，用户偏好减少动态时直接到终态。

### 3.4 `src/client/index.ts`（挂载点改动）

在 `apply()` 中 `injectResponsiveStyles()` 之后追加：

```ts
// ---- 移动端全局覆盖（触控/字号/头部收起等）+ 输入框属性兜底 + 回顶浮钮 ----
import { injectMobileOverrides, applyMobileInputAttributes } from './mobile-overrides'
import { BackToTopButton } from './back-to-top'
// ↑ 合并进现有 import 区（响应式相关 import 附近）

// 在 apply() 内、injectResponsiveStyles() 之后：
ctx.effect(() => injectMobileOverrides(), 'webui: mobile overrides')
ctx.effect(() => applyMobileInputAttributes(), 'webui: mobile input attrs')

// 回到顶部浮钮：conversation.composer.dock 槽（StatsLineShadow 同槽，order 更大置顶）。
ctx.slots.inject('conversation.composer.dock', () =>
  ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'webui-back-to-top',
    order: 100,
    locale: 'conversation',
  }, BackToTopButton))
```

> 结构对齐：`[data-conversation-scroll]`/`[data-composer-seat]` → 宿主 `ConversationRoot.tsx`；`[data-composer-card]`/`[data-input-scroll] textarea` → 宿主 `InputBar.tsx`；`[data-slot="conversation.session.header"] [class*="titleRow"]` 与现有 `styles.ts:61` 一致。**均已经神代对宿主源码实证核验成立**。
> ⚠ 不要全局写 `button { touch-action: ... }`——宿主 sidebar 内 `DragHandle` 设了 `touch-action:none`（拖拽用），故 `touch-action` 规则限定在 `[data-conversation-scroll]`/`[data-composer-card]` 内。

---

## ④ 手机验证步骤

### ① DevTools 设备模拟（快速回归）

1. Chrome DevTools → `Ctrl+Shift+M` 进入 Device Toolbar。
2. 设备矩阵：**iPhone 12/13/14（390×844，3x）**、**iPhone SE（375×667，2x）**、**Galaxy S8/20（360×800，3x）**、**Pixel 6（411×915，3x）**。
3. 逐项勾选「Show device frame」「emulate CSS media」；查看 `width≤767.98` 生效点。

### ② 真机清单（关键交互必须在真机核对）

- **iPhone 带刘海/灵动岛 + Android 挖孔**：验证 `safe-area-inset-top/bottom` 是否正确垫高顶部导航与底部固定元素（浮钮/底栏不被 home indicator 遮挡）。
- **iOS 聚焦键盘**：点输入框，确认**页面不被自动放大**（`font-size≥16px` 生效）；键盘弹起后 `100dvh` 容器不破。
- **双击缩放**：快速双击卡片/按钮，确认**不触发缩放**（`touch-action: manipulation` 生效）。
- **拖拽 handle**：确认 sidebar 内 `DragHandle` 拖拽仍正常（未被 `touch-action: manipulation` 误伤）。
- **输入法发送键**：安卓/苹果分别验证 `enterkeyhint="send"`；若与插件 `ctrl-enter-newline.ts` 冲突（部分安卓在 multi-line 上把 send 键触发单次提交），降级为 `"enter"`（见待确认）。

### ③ 验收点（逐项打勾）

| # | 验收点 | 通过条件 |
|---|---|---|
| A | 360px 无横向滚动 | `document.scrollingElement.scrollWidth <= innerWidth` |
| B | 顶部标题完整可见 | 标题不被右上按钮组/消息条遮盖；`titleRow` 与 `webui-host` 不重叠（P-B4） |
| C | 图块/trigger 可点 | 命中区 ≥44px，无遮挡、无误触 |
| D | 用量工作台全屏 | PopoverShell 移动端 full-screen sheet，无横向滚动，图表 legend 完整可见 |
| E | 对话框全屏 | 内容不裁剪、可滚动、safe-area 已垫 |
| F | 回顶浮钮 | 滚动 >400px 后淡入，点击回到顶部；`prefers-reduced-motion` 下无动画直接跳转 |
| G | 正文/输入 ≥16px | iOS 聚焦不放大页面 |
| H | 动效降级 | `prefers-reduced-motion: reduce` 时所有过渡/缩放至终态 |
| I | 消息条取舍 | 按最终拍板：隐藏或窄胶囊；二者必居其一且不遮挡内容 |
| J | 桌面端零回归 | 桌面宽视口逐项重验，确认无 `max-width` 外规则生效 |

---

## ⑤ 量化提升指标（主脑补充 · 目标值）

> ⚠ **本文件为方案，非已测数据**。以下为目标/验收 KPI，**具体基线数值需在真机采集后方可确认**（上游各角色均未提供实测数据，由主脑按移动端标准拟定，落地后回填实测值）。

| 指标 | 目标 | 测量方法 |
|---|---|---|
| 关键触控目标命中区 | ≥44×44 CSS px（当前 36–40px） | 真机/DevTools `getBoundingClientRect` 抽查 `.webui-view-tile/.webui-trigger/.psh-close` |
| 正文/输入字号 | ≥16px（当前 sidebar 14px、输入区未放大） | computed `font-size` |
| 横向滚动 | 360px & 430px 下无横滚 | `scrollWidth <= innerWidth` |
| iOS 聚焦自动放大 | 消除 | 真机点输入框观察是否放大 |
| 双击缩放 | 消除 | 真机快速双击卡片 |
| 顶部信息可见率 | 360px 下标题/tab 完整可见 | 截图核对 |
| 动效降级 | 100% 动画尊重 `prefers-reduced-motion` | DevTools 模拟 reduce 核验 |
| 桌面回归 | 0 条新规则在 `max-width` 外生效 | 桌面宽视口逐项回归 |

---

## ⑥ 风险与回滚

### 风险清单

| 风险 | 级别 | 触发点 | 缓解 |
|---|---|---|---|
| 移动端会话切换无解（grid 抽屉化属宿主源码） | **高** | 360px 窄屏 sidebar 仅折叠为 56px rail，非抽屉 | 二选一并明示：① 标「已知限制」保留 rail；② 插件自建 bottom-sheet 会话切换（需评估接入成本）。**避免默认「CSS 拉抽屉」** |
| CSS 选择器与宿主 DOM 不匹配 | **高** | 注入选择器失效 → 静默不覆盖 | 神代已实证全部锚点选择器对宿主源码成立；后续宿主升级需回归复核 |
| 桌面回归 | **高** | 规则写在 `max-width` 外 / 选择器过宽 | 全部包 `@media (max-width:767.98px)`；全局 `touch-action` 仅置于交互与滚动容器；**已按神代 P-B2 删除媒体外重复规则** |
| 红线 A 注释序列 | **高** | `styles.ts`/`mobile-overrides.ts` 注入字符串注释含「星号+正斜杠」 | 注释只用「星号+斜杠」文字描述；排查 `sheet.cssRules` 里选择器是否存活 |
| 红线 B 性能 | **高** | 输入框观察器空转 | **已按神代 P-B1 在设置成功后 `mo.disconnect()`**；未引入懒加载/无限滚动（触底加载列为可选并标注权衡） |
| `.webui-panel{display:none}` 产品取舍 | 中 | 移动端失去消息快速跳转 | 待用户拍板（默认隐藏 / 窄胶囊），定稿前不写死 |
| `enterkeyhint="send"` 与 `ctrl-enter-newline` 冲突 | 中 | 部分安卓在 multi-line 把 send 键触发单次提交 | 真机验证；冲突则降级 `"enter"` |
| 标题行与 `webui-host` 换行重叠（P-B4） | 中 | `titleRow{padding-right:8px}` + `webui-host{flex-wrap}` 在部分槽位重叠 | 真机验证；重叠则给 titleRow 留 `min-width` 或 `webui-host{justify-content:flex-end}` |
| 主题 token 名不确定 | 低 | `--dsw-alias-bg-elevated`/`--dsw-alias-text-primary` 为推断 | 落地随 DSH 主题核对；一律带兜底值 |

### 回滚方案

- **全量回滚**：`src/client/index.ts` 移除 3 处新增（2 个 `ctx.effect` + 1 个 `slots.inject`），删除 `mobile-overrides.ts`/`back-to-top.tsx`，恢复 `responsive.ts` 中新增的 `:root` 块。所有移动端规则随插件生命周期注入/移除，**无残留**（幂等 + `effect` 清理）。
- **局部回滚**：若 `display:none` 消息条取舍出问题，仅移除 `.webui-panel{display:none}` 一行即可恢复桌面/移动条。
- **验证失败即退**：任一验收点不通过（尤其 P-B4 重叠、enterkeyhint 冲突），直接回退对应模块，不阻塞其他已过项。

---

## 变更说明与风险提示（brain 附）

- **本方案为纯文档**：`mobile-overrides.ts`/`back-to-top.tsx` 为「可直接应用示例」，**尚未落盘实现**；`responsive.ts`/`index.ts` 的改动为待落地增量。落地后需 `pnpm run build:client`（或等价构建）重新生成 bundle，并重启 DSH 服务生效。
- **已采纳神代 2 处必改**：P-B1（observer 早退 → 红线 B）、P-B2（删除 media 外重复 `.psh-card` 规则）。相应代码示例已按修订版给出。
- **1 处待用户拍板**：`.webui-panel{display:none}` 的「隐藏 vs 窄胶囊」产品取舍，定稿前默认按「隐藏」示例提供，正式决定以用户确认为准。
- **量化指标为主脑拟定目标值，非实测**：落地后需回填真机基线。
- **宿主不可覆盖点**：sidebar 会话语动切换、`<meta viewport user-scalable=no>`（宿主层）——前者用「已知限制」标注或自建 bottom-sheet，后者统一用 `touch-action: manipulation` 规避，不用 `user-zoom`。
