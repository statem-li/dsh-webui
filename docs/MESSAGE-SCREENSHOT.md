# 对话截图功能增强方案（PRD）

> 目标：把「单条消息截图」从「手写正则的轻量 Markdown」升级为「与对话正文一致的全量 Markdown 渲染」，并新增一条可选实现路径——由模型生成排版良好的 HTML 页面，前端渲染后提供「下载 PNG」导出高清图片。
>
> 现状代码：host 端 `src/screenshot.ts`（渲染 + 无头浏览器截图）、client 端 `src/client/screenshot.tsx`（截图按钮 + 预览弹窗）。正文渲染器：`src/client/markdown/renderer.tsx`（markstream-react）。

---

## 1. 现状与问题

### 1.1 现有数据流

```
assistant 消息 actions 行的相机按钮
  → POST /api/webui-screenshot { role, text, sessionId }
  → host: renderMessageHtml() 手写正则渲染 Markdown → 白底 16:10 卡片 HTML
  → 独立无头 Edge/Chrome，固定 1280×800 视口，2x DPR
  → Page.captureScreenshot (png) → 保存 <DSH_HOME>/storages/webui-screenshot/*.png
  → 返回 { path, imageUrl } → 前端弹「截图预览」弹窗（复制路径 / 下载）
```

### 1.2 现有手写正则的能力与缺陷（`src/screenshot.ts` 的 `renderMarkdown`）

已覆盖（均为简单子集）：段落、`#`–`######` 标题、`**bold**` / `*italic*` / `~~del~~`、行内 `` `code` ``、``` 代码围栏（**无语法高亮**）、`> 引用`、`-/+/*` 无序列表、`1.` 有序列表、`|` 表格（**无对齐、无单元格内换行/转义**）、`---` 分隔线、链接。

缺陷清单（即本次要补齐的能力）：

| # | 缺陷 | 用户诉求 | 现状后果 |
|---|------|---------|---------|
| 1 | 无语法高亮 | 代码块 | 代码纯灰底、无 token 着色，与正文（shiki）不一致 |
| 2 | 无 emoji 短码解析 | emoji | `:smile:` 原样输出，不会变成 😄 |
| 3 | 无图标/提示块 | 图标 | admonition、品牌图标、任务复选框等一律缺 |
| 4 | 无任务清单 | 列表 | `- [x]` 被当普通列表项，`[x]` 原样显示 |
| 5 | 无嵌套列表 | 列表 | `  - 子项` 丢失层级，全部拍平 |
| 6 | 多行引用不合并 | 引用 | 连续 `>` 各自成块，视觉割裂 |
| 7 | 表格不支持对齐/转义 | 表格 | `:---:`、`\|`、单元格内 `<br>`/行内代码失效 |
| 8 | 无图片 / 公式 / mermaid | 通用 | `![](url)`、`$...$`、```mermaid 全部当纯文本 |
| 9 | 无脚注 / 定义列表 / 高亮 `==x==` / 插入 `++x++` | 通用 | 与正文渲染器能力断层 |
| 10 | 渲染结果与正文不一致 | 一致性 | 截图「所见」≠ 对话「所见」，用户感知为简陋 |

### 1.3 对齐目标（正文渲染器已具备）

`src/client/markdown/renderer.tsx`（markstream-react + shiki + katex + mermaid + echarts）已支持：标题、表格、列表、任务清单、引用、代码块 shiki 高亮、行内代码、图片、链接、高亮/插入/删除线、脚注、定义列表、TOC、mermaid、echarts、katex 公式、admonition。**本次截图侧以它为能力上限，优先覆盖用户点名的元素，图表类可后置。**

---

## 2. 目标与非目标

**目标**
- G1：截图正确渲染图标、emoji、代码块（语法高亮）、表格、列表（含任务/嵌套）、引用、加粗/斜体，并与正文视觉一致。
- G2：新增「模型生成 HTML → 前端渲染 → 下载 PNG」路径，导出高清（2x/3x DPR）PNG。
- G3：保留并增强现有无头浏览器截图管线（长图自动扩展、PNG 无损），两条路径共享同一套导出原理。

**非目标（v1 不做）**
- mermaid / echarts 的截图侧原生渲染（先降级为带语言标签的代码块，标注 P1 再补）。
- 整段会话「长截图」的全量归档（当前仍为单条消息级；G2 的模型路径可天然扩展为会话级，但不作为 v1 验收）。

---

## 3. 两条实现路径总览

| | 路径 A：确定性增强（推荐主路径） | 路径 B：模型生成 HTML（可选路径） |
|---|---|---|
| 渲染入口 | host 端 `markdown-it` 插件生态，确定性渲染 | 模型产出排版 HTML，前端沙箱渲染 |
| 优势 | 稳定、可测试、能力可控、与正文一致 | 排版自由（模型可设计卡片/海报/长图版式） |
| 代价 | 需引入 markdown-it 及插件依赖 | 依赖模型输出质量，需安全净化 + 沙箱 |
| 导出 | 无头浏览器截图（复用现有管线） | 前端渲染后「下载 PNG」 |
| 关系 | 独立可上线 | 可选增强，模型生成失败时**回退到路径 A** |

两条路径**共用**：① 无头浏览器 CDP 截图基础设施（`src/browser/cdp.ts` 的 `captureScreenshot` / `setViewport`）；② 导出「高清 PNG」原理（DPR 缩放）；③ 白底/深色两套截图主题的样式模板。

---

## 4. 路径 A：确定性增强（详细设计）

### 4.1 渲染方式：`markdown-it` 装配为「截图渲染管线」

用 `markdown-it`（CommonMark 兼容）替换 `renderMarkdown` 手写正则，插件清单如下（按用户诉求优先级排序）：

| 能力 | 插件 | 说明 |
|------|------|------|
| 基础 CommonMark + GFM 表格/删除线/链接 | `markdown-it` `default` preset | 自带 table、strikethrough、linkify |
| 语法高亮 | `@shikijs/markdown-it` + 现有 `shiki` 依赖 | 与正文 shiki 同引擎同主题，视觉一致 |
| emoji | `markdown-it-emoji` | 短码 `:smile:` → Unicode emoji，由系统 emoji 字体渲染（**不引入表情包图片库**） |
| 任务清单 | `markdown-it-task-lists` | `- [ ]` / `- [x]` 输出带禁用态 `<input type=checkbox>` |
| 脚注 | `markdown-it-footnote` | `[^1]` |
| 定义列表 | `markdown-it-deflist` | `term\n: def` |
| 高亮 / 插入 | `markdown-it-mark` / `markdown-it-ins` | `==x==` / `++x++`（对齐正文 renderer 的 highlight/insert 节点） |
| 公式 | `markdown-it-texmath` + `katex` | `$...$` / `$$...$$`，服务端 `katex.renderToString` |
| 提示块 / 图标 | `markdown-it-container` | `::: note/info/tip/warning/danger` → 带内联 SVG 图标的 admonition（对齐正文 `.admonition` 样式） |
| 表格扩展 | `markdown-it-multimd-table`（可选） | 单元格内换行、对齐、多行表头；v1 可先用内置表格 |

> **代码围栏高亮实现要点**：shiki 高亮是异步初始化。host 侧在插件加载时创建**单例 highlighter**（`await createHighlighter({ themes: ['github-light','github-dark'], langs: [...] })`），`renderMarkdown` 变为 `async`，在 markdown-it 的 `highlight` 回调里同步调用 `highlighter.codeToHtml`（shiki 4 的 `codeToHtml` 在预加载后是同步的）。`handle()` 已是 async，调用点无需大改。

### 4.2 新模块拆分（host 侧）

```
src/markdown-html.ts   # markdown-it 装配 + shiki/katex/emoji/admonition 插件 + 两套主题 CSS
src/screenshot.ts      # 只保留：HTTP 路由 + 无头浏览器截图管线 + 卡片模板拼装
```

`markdown-html.ts` 导出：

```ts
export type ShotTheme = 'light' | 'dark'
export async function renderMarkdownToHtml(md: string, theme: ShotTheme): Promise<string>
```

### 4.3 交互流程（路径 A，几乎不变，仅增强渲染）

1. 用户在 assistant 消息 actions 行点相机按钮（`src/client/screenshot.tsx` 的 `MessageScreenshotButton`）。
2. 前端 `POST /api/webui-screenshot { role, text, sessionId, theme? }`，新增可选 `theme`（缺省 `light`，未来接当前主题）。
3. host `renderMarkdownToHtml(text, theme)` → 拼进卡片模板（header 标题 + 品牌 logo + footer）。
4. 无头浏览器渲染 + 2x DPR 截图 → PNG 落盘 → 返回 `{ path, imageUrl }`。
5. 前端弹预览（现状已有），补齐「下载 PNG」入口（见第 6 章）。

### 4.4 样式适配（路径 A）

- **主题**：截图 HTML 是独立 `file://` 页面，**没有主文档的 `--dsw-*` token 注入**，因此 token 必须在 host 端**编译为具体色值**写入内联 `<style>`。提供 `light` / `dark` 两套色板（见第 7 章），默认 `light`（白底品牌卡，保留现状视觉）；`dark` 用 DSH 深色品牌蓝 `#679efe` 做强调。
- **宽度**：固定 `1280px`（现状），新增常量集中管理，便于未来开放 1080/1280/1600 选项。
- **溢出**：`.md-table { overflow-x:auto }`、`pre { overflow:auto; word-break:normal }`、`th/td { overflow-wrap:anywhere; min-width:80px }`，避免长代码/宽表撑破卡片。
- **字体栈**：正文 `-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`；等宽 `"SF Mono", "JetBrains Mono", Consolas, monospace`；emoji 字体追加 `"Apple Color Emoji", "Segoe UI Emoji"`。
- **高清**：`setViewport(session, width, height, 2)`（DPR=2，现有）；支持按需 3x。

### 4.5 emoji 与图标策略（不用表情包，图标一律 SVG）

- **emoji**：短码 `:smile:` → Unicode 字符，由系统 emoji 字体（Segoe UI Emoji / Apple Color Emoji）直接渲染成字符，**不引入 twemoji / noto-emoji 等表情图片库**，不把 emoji 替换成 `<img>`。目标环境（Windows 无头 Edge/Chrome）自带 emoji 字体，彩色字符直接可截图。
- **图标**：所有装饰性图标一律内联 SVG——品牌鲸鱼 logo、admonition 提示块图标、任务复选框、代码语言徽标、弹窗的相机 / 下载 / 复制图标等。矢量缩放不糊、深浅主题换色方便，与正文 renderer 的 SVG 图标策略一致。
- emoji 字体缺失时的降级（Linux headless 渲染成方框）：保持 Unicode 字符 + 单色回退字体，不引入表情图片库；必要时在截图 HTML 内用 `@font-face` 指向本机 emoji 字体，缺省则显示单色字形。

---

## 5. 路径 B：模型生成 HTML + 前端导出 PNG（可选路径，详细设计）

### 5.1 交互流程（端到端）

```
assistant 消息 actions 行「排版导出」按钮（新增，与相机按钮并列）
  → 前端组装导出上下文 { role, text, sessionId, 可选: 会话标题/前文摘要 }
  → POST /api/webui-export-html { payload }
  → host 调用 LLM（复用 prompt-optimize 的模型调用模式）生成「排版良好的 HTML」
  → host 返回 { html }（或 结构校验失败时返回错误）
  → 前端 DOMPurify 净化 → iframe(srcdoc, sandbox) 渲染 → 预览弹窗
  → 用户点「下载 PNG」
     ├─ 主：POST 净化后 HTML 回 host → 无头浏览器 2x/3x DPR 截图 → 返回 PNG（复用现有管线）
     └─ 备：前端 modern-screenshot DOM→Canvas → toBlob 下载（纯前端降级）
```

### 5.2 模型生成 HTML 的协议与约束

**提示词约束（写入 system/prompt）**：

- 输出**仅**完整 HTML 文档（`<!DOCTYPE html>…</html>`），不要 markdown 代码围栏包裹，不要解释文字。
- 样式全部**内联在 `<style>`**（自包含，不依赖外部 CSS）。
- **禁止** `<script>`、`<iframe>`、`<object>`、`<embed>`、事件属性（`on*=`）、`javascript:`/`data:text/html` URL。
- 外部资源白名单：图片仅 `https://` 且 `referrerPolicy="no-referrer"`；不引用外部字体/脚本。
- 适配 16:10 或 A4 纵向版式；正文建议 15–20px、行高 1.7，含标题/品牌栏/页脚。
- 内容以「排版美观」为准，允许重组标题、加卡片/强调块，但**不得改变语义事实**。

**结构化返回**：优先要求模型返回 JSON（`{ title, html }`），host 侧解析更稳；解析失败则回退「整段即 HTML」并做校验。

**模型调用**：参考 `src/prompt-optimize.ts` 既有的 LLM 调用路径（宿主已注入 `@deepseek-ai/dsh-llm` 能力）；抽象一个 `generateExportHtml(ctx, payload): Promise<string>`。

### 5.3 安全：净化 + 沙箱（必须，模型输出不可信）

1. **DOMPurify 净化**（前端）：白名单标签/属性，强制剥离 script/iframe/事件/危险 URL；允许 `<style>` 但用 DOMPurify 的 `FORBID_TAGS/FORBID_ATTR` 收紧。
2. **iframe 沙箱渲染**：`<iframe sandbox="" srcdoc={safeHtml}>`（**不带 `allow-scripts`**，禁脚本执行；不带 `allow-same-origin` 以免逃逸）。预览即安全区，即使净化有漏网也拿不到宿主权限。
3. **host 侧二次校验**：host 截图前对 HTML 做一次服务端 sanitize（`sanitize-html`）＋拒绝含 `<script` 字面量的 HTML，双保险。
4. **图片跨域**：img 统一 `crossorigin="anonymous" referrerPolicy="no-referrer"`；加载失败渲染占位块，不阻塞整体导出。

### 5.4 渲染方式（前端）

- 用 `iframe.srcdoc` 隔离渲染，避免污染主文档主题/样式，也避免全局 CSS reset 干扰导出版式。
- 预览弹窗内 `iframe` 高度随内容自适应（`onLoad` 后读 `contentDocument.scrollHeight` 设 iframe 高度）。
- 提供「浅色 / 深色」切换（把 `<body class="dark">` 或注入对应背景色），与第 7 章色板一致。

### 5.5 导出原理（两条子路径对比）

| 维度 | B2：host 无头浏览器截图（**推荐**） | B1：前端 DOM→Canvas（可选降级） |
|------|----------------------------------|-------------------------------|
| 原理 | `Page.captureScreenshot` 直接抓渲染层像素 | DOM 序列化为 SVG `foreignObject` → `Image` → `canvas.drawImage` → `toBlob` |
| 依赖 | 复用现有 `src/browser/cdp.ts` 管线 | 引入 `modern-screenshot`（html-to-image 后继，自动内联 web font） |
| emoji/字体 | 完美（真实浏览器渲染） | 依赖系统字体，foreignObject 中彩色 emoji 易丢失 |
| 跨域图片 | 无头浏览器可正常加载（同 host） | 无 CORS 头 → canvas 污染 → 导出失败 |
| SVG/阴影/渐变 | 完美 | 部分丢失 / 需内联样式 |
| 高清 | `setViewport(w,h,dpr)`，2x/3x | `canvas.width = cssW * dpr`，需手动 scale |
| 网络 | 一次后端往返 | 纯前端、离线可用 |
| 结论 | 质量最稳，作为**默认** | 作为「无后端/弱网」降级或「快速导出」 |

> **推荐策略**：默认走 B2（复用现有截图管线，emoji/字体/SVG/高清全可控）；B1 仅在 B2 不可用（如 host 无浏览器）时兜底，并明确告知用户「图片含跨域资源时可能导出失败」。

---

## 6. 「下载 PNG」按钮与导出管线（统一）

无论路径 A 还是 B，最终产物都是**高清 PNG**，导出原理一致：

1. **像素密度（高清核心）**：`setViewport(session, cssW, cssH, dpr)` 后 `Page.captureScreenshot({ format:'png' })`，输出像素 = CSS 尺寸 × DPR。文字在 2x/3x 下锐利。
2. **长图自动扩展**（复用现状逻辑）：固定宽度排版 → `evaluateJson` 读 `scrollHeight` → 二次 `setViewport` 扩展视口高度 → 截全。上限 24000px（超出分页或提示，见第 8 章）。
3. **前端交互**：预览弹窗（`src/client/screenshot.tsx` 的 `shotPopup`）新增主按钮「下载 PNG」：
   - 路径 A：已有 `imageUrl`，直接 `<a download>` 即可（现状已有「下载」，改为明确「下载 PNG」并加主按钮样式）。
   - 路径 B：调用导出接口拿 `imageUrl` / `blob` 后触发下载（`URL.createObjectURL` + 程序化 `a.click()`），文件名 `shot-{date}-{dpr}x.png`。
4. **按钮样式对齐 DSH**：下载主按钮用胶囊主按钮（`borderRadius 18px / height 36px / fontSize 14px`，主按钮 `button-primary-fill` 底 + `label-primary-foreground` 字）；次按钮（复制路径/关闭）用 `border-l2` + 透明；**不要**用 `--dsw-alias-brand-primary` 做强调（它是反色，浅色下变黑块）。

---

## 7. 样式适配（两套主题色板）

截图 HTML 独立于主文档，token 需在 host 端**编译成具体色值**。给出两套基准色板（后续可让用户在设置项里选）：

| 语义 | 浅色（白底品牌卡，现状） | 深色（DSH 深色） |
|------|------------------------|------------------|
| 背景 | `#ffffff` | `#0d1117` |
| 文字主 | `#24292f` | `#e6edf3` |
| 文字次 | `#57606a` | `#8b949e` |
| 强调/链接（品牌蓝） | `#4176e6` | `#679efe` |
| 边框 | `#d0d7de` | `#30363d` |
| 代码底 | `#f6f8fa` | `#161b22` |
| 行内代码 | `#c7254e` | `#ff7b72` |
| 引用底 | `#f6f8fa` | `#161b22` |
| 表头底 | `#f6f8fa` | `#161b22` |
| 斑马纹 | `#fafbfc` | `#161b22` |

- 强调色一律走品牌蓝（浅 `#4176e6` / 深 `#679efe`），对齐 DSH `--dsw-alias-state-business-primary`；**不用反色 `--dsw-alias-brand-primary` 做强调**。
- 深色主题下 shiki 主题切 `github-dark`，浅色用 `github-light`（与正文 shiki 主题策略一致）。
- 设置项（可选，P2）：在「通用 → 外观」区新增「截图主题」下拉（light / dark / 跟随当前主题），控件规格对齐 DSH（输入框 32px / 圆角 8px / 边框 `border-l2`；下拉 `appearance:none` + 自定义 chevron + `max-width 240px`）。

---

## 8. 异常处理

| 场景 | 处理策略 | 用户可见 |
|------|---------|---------|
| 无头浏览器启动失败 / WS 超时 | 现有 `launchChrome`+`fetchBrowserWsUrl` 已带超时；捕获后返回 500 | toast「截图失败，请重试」+ 保留重试按钮 |
| 端口冲突 | 已有 `findFreePort(9222)` 自动换端口 | 无感 |
| 内容超长 | 现状 `MAX_TEXT_LEN=80000` 截断 + 追加「（内容过长已截断）」；新增截断点落在代码围栏/表格边界时闭合标签，避免烂 HTML | 截断提示文字 |
| 模型返回非法 HTML / 非 HTML | 结构校验（`<!DOCTYPE` 或 `<html` 命中）失败 → 返回错误 | toast「模型未能生成有效排版」→ **回退路径 A** 渲染 |
| 模型 HTML 含脚本 / 危险 URL | DOMPurify 净化 + iframe `sandbox=""`（无 allow-scripts）+ host 侧 sanitize 三保险 | 无感（脚本被剥离） |
| 图片跨域 / 加载失败 | 白名单 `https` + `no-referrer`；加载失败渲染占位块 | 占位块，不阻塞导出 |
| emoji / 字体缺失 | 保持 Unicode 字符 + 单色字体回退（4.5），不引入表情包 | 无感或降级为单色 |
| 长图超出 24000px | 超过上限 → 拒绝导出并提示 | 「内容过长，已超出单张导出上限」 |
| 前端 canvas 污染（B1） | 捕获 `SecurityError` → 提示 + 自动回退 B2 | 「图片含跨域资源，已改用服务端导出」 |
| 并发截图（多消息同时点） | 截图管线加**互斥锁/串行队列**，避免多无头实例抢资源 | 排队，按钮 loading 态 |
| LLM 调用超时 / 限流 | 设置调用超时；超时即失败回退路径 A | toast + 回退 |

---

## 9. 落地拆解与改动文件

### 9.1 依赖新增（`package.json` dependencies）

```
markdown-it, markdown-it-emoji, markdown-it-task-lists, markdown-it-footnote,
markdown-it-deflist, markdown-it-mark, markdown-it-ins, markdown-it-texmath,
markdown-it-container, @shikijs/markdown-it, dompurify,
sanitize-html（host 侧服务端净化，可选）, modern-screenshot（仅 B1 可选）
```

（katex、shiki、mermaid 已在 dependencies；host 端复用 shiki/katex 无需新增。）

### 9.2 改动/新增文件

| 文件 | 改动 |
|------|------|
| `src/markdown-html.ts`（新） | markdown-it 装配 + shiki/katex/emoji/admonition + 两套主题 CSS 模板 |
| `src/screenshot.ts` | `renderMarkdown` 换为 `renderMarkdownToHtml`（async）；卡片模板支持 `theme`；新增 `/api/webui-export-html`（模型生成 HTML）路由；导出管线加并发锁 |
| `src/export-html.ts`（新，可选） | `generateExportHtml(ctx,payload)` 调 LLM + 结构校验 + sanitize |
| `src/client/screenshot.tsx` | 预览弹窗补「下载 PNG」主按钮；新增「排版导出」按钮（路径 B 入口） |
| `src/client/export-html.tsx`（新，可选） | iframe sandbox 渲染 + DOMPurify + B1/B2 导出 |
| `src/client/styles.ts` | 新增导出按钮/预览 iframe 样式（对齐 DSH 控件规格） |

### 9.3 里程碑

- **M1（路径 A 核心，先交付）**：markdown-it 管线替换手写正则，覆盖 G1 全部点名元素 + shiki 高亮 + emoji + 任务/嵌套列表 + 表格对齐。此步即可明显改善「简陋」问题。
- **M2（导出体验）**：预览弹窗「下载 PNG」主按钮 + 深浅主题色板 + 设置项（可选）。
- **M3（路径 B 可选）**：模型生成 HTML + iframe 渲染 + B2 导出 + DOMPurify 净化 + 异常回退。

### 9.4 验收清单

- [ ] 一条含「emoji + 代码块(多种语言) + 表格(对齐) + 嵌套/任务列表 + 多行引用 + 粗斜体/删除线 + 行内代码 + 链接」的消息，截图与正文渲染**逐项一致**。
- [ ] 代码块 token 着色与正文 shiki 一致；浅/深两套主题下均可读。
- [ ] 长内容自动扩展为长图；超长正确截断且不烂 HTML。
- [ ] 「下载 PNG」产出 2x DPR 高清 PNG，文字锐利。
- [ ] （路径 B）模型生成的 HTML 经净化后在沙箱正常渲染；注入 `<script>`/`onerror` 的恶意 HTML 被剥离且不执行。
- [ ] 跨域图片、emoji 字体缺失、无头浏览器启动失败等异常均有可见反馈且不崩溃。

---

## 10. 待确认事项

1. 路径 B 是否纳入 v1 范围，还是先只做路径 A（本方案推荐「先 A 后 B」）。
2. 「排版导出」是否要支持**整个会话**（非单条）——路径 B 天然适合，但需明确会话文本组装规则（截断/摘要策略）。
3. 截图默认主题：保持白底品牌卡，还是跟随当前主题（需从 client 把 `data-ds-dark-theme` 传入 host）。
4. mermaid/echarts 截图侧原生渲染的优先级（建议 P1，先降级为代码块）。
