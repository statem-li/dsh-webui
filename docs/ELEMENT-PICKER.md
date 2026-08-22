# 新功能需求 · AI 浏览器元素选取 → 自动进对话框

> 状态：已实现（2026-08-22）
> 背景：AI 无法精确知道用户在浏览器预览里指的是哪个元素，纯文字描述反复对齐成本极高
> （dsh-webui 玻璃质感主题迭代中已实际暴露此痛点）。

## 目标

在 AI 浏览器预览抽屉中支持「选取元素」：

1. 用户点击 dock 工具条上的「选取元素」按钮进入选取模式；
2. 在预览画面上点击任意元素；
3. 该元素的定位信息自动填入 DSH 对话框输入框，作为给 AI 的上下文；
4. 再点一次按钮或按 Esc 退出选取模式。

## 技术要点

### 预览链路

- 预览抽屉组件：`src/client/browser/BrowserActivityDock.tsx`
- 抽屉容器样式：`dsh-browser-drawer`（`z-index: 8801`, `fixed right:0` 全高）
- 画面来源：screencast 流；相关 host 路由（`src/browser/index.ts`）：
  `/api/dsh-browser/screencast | frame | session | input | navigate | tabs | status`

### 交互与实现路径

1. **选取模式开关**：dock 头部加按钮（明显状态指示，开启时高亮）。
2. **坐标捕获**：开启后拦截抽屉画面的下一次点击，取画面内坐标，
   按画面缩放比换算到目标页真实视口坐标。
3. **元素信息采集**：经 CDP `Runtime.evaluate` 在目标页执行脚本：
   - `document.elementFromPoint(x, y)`
   - 生成唯一 CSS 选择器（id 优先 → nth-of-type 路径）
   - 元素摘要：tag / id / class / role / 可见文本截断（~120 字符）
4. **回传进对话框**：走槽位组件的标准 kit `inputActions.setDraft`（对齐
   PromptOptimizeButton 的「唯一公开写入路径」，不碰 DOM、不用原生 setter），
   把 `` `[选择器] 元素摘要` `` 追加到草稿尾部。
5. 填入格式：`` `[选择器] 元素摘要` `` 追加到输入框尾部，
   待用户补充问题后手动发送（未提供「立即发送」）。

### 实现记录（与需求稿的差异）

- 回填未采用「DOM 直填」：`BrowserSeat` 是 `conversation.input.left` 槽位，
  组件天然拿到 owner `input.draft` + kit `inputActions.setDraft`，比
  `querySelector('textarea')` + 原生 setter 更可靠（React 受控组件不丢值）。
- 选取模式依赖「detach 原生视图 → 画面回到 img 帧流」：壳内 WebContentsView
  贴合后会把画面区的鼠标/键盘事件直接吃进页面（React 收不到），必须先
  detach 才能用 React 点击捕获；退出选取模式（或采集成功）再重新贴合。
- 帧兜底截图在壳内模式直走 `captureScreenshot(..., fromSurface=false)`（detached
  视图等不到合成帧，surface 尝试会卡满超时），并从 `window.innerWidth/Height`
  回填帧尺寸——`toPage` 坐标换算依赖它，缺失会导致选取坐标错位。
- 选取模式下拦截全部 input 回传（move/down/up/click/wheel/key），只保留
  「点击采集」，避免 detach 后仍经 Input 域误点页面。

### 经验教训（来自玻璃质感迭代）

- 选择器生成必须唯一且稳定，避免 `[class*="panel"]` 这类宽泛子串匹配
  （本次毛玻璃误伤 `webui-panel` 会话导航条的事故即源于此）。
- composer 定位经验：输入卡 = `[class*="_composerSeat"] [class*="_card"]`，
  输入域 = `[class*="_composerSeat"] textarea`。
- 屏外/后台测试实例：CDP Input 可能整体失效、rAF 可能冻结、窗口可能最小化，
  验证交互需在前台实例进行。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/client/browser/BrowserActivityDock.tsx` | 选取模式 UI + 点击捕获 + 回传 + `inputActions.setDraft` 回填 |
| `src/browser/index.ts` | `/api/dsh-browser/element` 路由 + 帧兜底截图尺寸回填 |
| `src/browser/cdp.ts` | `inspectElementAt`（CDP evaluate 采集唯一选择器 + 摘要）+ 截图超时参数 |
| `src/client/browser/styles.ts` | 选取模式视觉样式（按钮高亮 / 十字准星 / 提示条） |
