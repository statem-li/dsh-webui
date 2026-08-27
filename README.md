# dsh-webui — DeepSeek Harness 会话增强全家桶

一个插件融合视图切换、消息导航、技能管理、供应商管理、辅助视觉、生图/生视频、记忆（hybrid 检索）、AI 浏览器、文件浏览器、Markdown 渲染、工具聚合、用量统计、网页搜索、定时自动化任务引擎、团队 Agent 编排（多团队多角色接力）、会话产物清单、对话退回与文件回退/修改历史对比、提示音、壳管理更新、插件自更新、网络代理、网关伪装接入、供应商限流、消息截图、中文思考、工作区临时垃圾清理等能力。纯插件实现，不改动 DSH 源码。

## 一句话安装（DSH）

```bash
dsh plugin --profile web add github:statem-li/dsh-webui
```

重启 DeepSeek Harness 即可。

本包在 package.json 声明了 `dsh.bundle.patch`（DSH rc.2 起的 bundle 契约），`dsh plugin add` 安装完成后 reconcile 会自动把它加入 profile 的 `dsh.profile.bundles` 层，挂载声明由包内 `cordis.patch.yml` 自带——**无需再手动往 `~/.dsh/profiles/web/cordis.patch.yml` 追加 insert**。若你从旧版本升级且之前手动追加过同 id 条目，按 last-write-wins 合并，删除或保留均无害；已安装用户执行一次 `dsh plugin update` 即会自动激活。

> 注：webui 接管了技能 slash 源（`/` 菜单），安装后需在 `~/.dsh/profiles/web/cordis.patch.yml` 禁用内核 ui-skill 插件以避免同名源冲突：

```yaml
- id: ui-skill
  name: "@deepseek-ai/dsh-client-ui-skill"
  disabled: true
```

## 按需启停功能模块

dsh-webui 是全家桶，但每个功能模块都可以单独关闭——不需要的功能不装配（host 不注册对应工具 / provider / HTTP API，client 不注册对应 UI 槽位），界面更干净、加载更轻。

**配置方法**（二选一，改完重启 DSH 生效）：

1. 编辑 `~/.dsh/profiles/web/settings.yaml`，加 `webui-modules` 命名空间，把想关的模块显式写为 `false`（没写的模块全部保持启用，升级新增模块时老配置自动兼容）：

```yaml
webui-modules:
  browser: false      # 不需要 AI 浏览器
  automation: false   # 不需要自动化
  team: false         # 不需要团队 Agent 编排
  peakValley: false   # 不需要峰谷时刻卡片
```

2. 调 HTTP API（适合脚本批量开关，部分覆盖合并写入）：

```bash
curl -X POST http://127.0.0.1:3080/api/webui-modules \
  -H "content-type: application/json" \
  -d '{"modules": {"browser": false, "automation": false}}'
```

**生效机制**：host 半身在插件加载时一次性装配，改动后需重启 DSH；client 半身启动时同步读本地缓存立即裁剪，并后台拉取 `/api/webui-modules` 校正缓存——重启后刷新页面，两端即按同一份配置生效。

**模块 key 一览**（`false` = 关闭；缺省全部启用）：

| 分组 | key | 控制的功能 |
|---|---|---|
| 对话体验 | `messageWidth` | 消息气泡宽度设置 |
| | `voice` | 语音播报（总结播报 / 实时播报 + 多会话仲裁 + 静音） |
| | `doneSound` | 回合结束提示音 + 完成卡片 |
| | `donePill` | 对话完成胶囊 + 记录面板 |
| | `approvalNotify` | 审批等待 toast 提醒 |
| | `ctrlEnter` | 输入框 Ctrl+Enter 换行 |
| | `sessionMotion` | 会话切换柔和过渡 |
| | `sessionPin` | 会话置顶 / 归档 / 右键菜单 |
| | `rewind` | 对话退回 |
| | `screenshot` | 对话截图（本条回复 / 一轮问答 / 整段会话） |
| | `promptOptimize` | 提示词优化图标 |
| | `zhThinking` | 中文思考开关 |
| | `mood` | MOOD 自述（按 Agent 预设的开关 + 人设 + 对话流卡片） |
| | `peakValley` | DeepSeek 峰谷时刻卡片 |
| | `chatStats` | 会话统计条 |
| | `toolSummary` | 工具调用聚合 + 活动抽屉 |
| | `diagram` | mermaid 图表渲染（引擎按需加载）+ 作图提示词 |
| 模型与供应商 | `reasoningSync` | `webui_sync_reasoning` 推理等级补全工具 |
| | `modelSeats` | 模型座位接管 + 推理等级弹出 |
| | `providerHub` | 供应商管理设置页 |
| | `vision` | 辅助视觉 + 生图 + 生视频 + 生图画廊 |
| | `webSearch` | AnySearch 网页搜索 |
| | `mail` | 邮箱验证码 |
| 技能 | `skills` | 技能 slash 两级导航源 + 技能开关路由 |
| AI 浏览器 | `browser` | 浏览器工具 + dock UI + 设置开关 |
| 自动化与计划 | `automation` | 自动化任务 + 真实执行引擎 |
| | `team` | 团队 Agent 编排器（多团队多角色接力 + 一句话生成 + 可拖拽关联画布 + 每角色工具/技能装配 + 对话框团队开关 + 执行 HUD） |
| 记忆 | `memory` | 记忆引擎 + Memory Dream |
| 用量与统计 | `usage` | 用量工作台 |
| 文件与工作区 | `fileExplorer` | 文件浏览器 |
| | `workspaceDocs` | 工作区文档卡片（AGENTS.md / CLAUDE.md 检测 + 预览 + 一键创建；依赖 `fileExplorer`） |
| | `dirPicker` | 工作区目录选择器 |
| | `tmpCleaner` | 工作区临时垃圾清理器 |
| 外观与系统 | `appearance` | 玻璃质感主题 |
| | `sidebarFloat` | 悬浮侧边栏 |
| | `updater` | 壳管理更新（DSH 源码一键更新 + 开机自启） |
| | `pluginUpdate` | 插件自更新（检测上游新版本 + 增量补丁就地更新本插件） |
| | `proxy` | 网络代理 |
| | `gatewayRewrite` | 网关伪装接入（按域名改写 UA / 强制代理，接白名单网关） |
| | `providerThrottle` | 供应商限流（按域名 RPM 令牌桶 + 并发信号量，从源头避免 429） |

**注意事项**：

- 关闭 `skills` 后会失去内置 slash 两级导航源，此时应删除 cordis.patch.yml 里对内核 ui-skill 的 `disabled: true` 以恢复官方 `/` 菜单。
- 关闭 `providerHub` 将失去供应商/视觉/生图/生视频模型的配置入口（已保存的配置仍生效）。
- 核心能力不提供开关、始终启用：视图图块与消息导航、markstream 基础 Markdown 渲染、供应商标签、移动端响应式。

## 功能总览

### 对话体验

| 功能 | 说明 |
|---|---|
| 右上角视图图块 + 消息导航 | 对话/轨迹切换图块、消息徽标/弹窗列表、右侧消息横条、弹窗内手动加载更早消息 |
| 会话置顶 | 侧边栏会话右键菜单：置顶（置顶组排最前）/ 归档按钮 / 重命名；localStorage 持久化，跨标签页实时同步 |
| 对话退回 | 每条用户消息加退回按钮，一键回退工作区文件到该消息发送前 + 原地回退上下文（同会话内 surface 替换，不 fork、不归档、不切换会话、无刷新）。v2 git 式内容寻址存储：文件内容按 SHA-1 入全局 blob 库（gzip），快照只落「路径 → 指纹」纯索引，体积降两个数量级 |
| 会话产物卡片 | host 端独立记账 agent 经 fs 服务的写入产物并落盘（jsonl），重启后消息操作栏「产物」入口仍可打开大卡片：左栏本会话产物清单、右栏应用内展示（图片内嵌 / markdown 渲染 / 代码高亮 / 二进制 hex 兜底），不经系统打开 |
| 对话截图 | assistant 消息操作栏相机按钮 → 截图面板：范围（本条回复 / 这一轮问答 / 整段会话）+ 版式（电脑横幅 / 手机窄幅）+ 画质（1080P / 2K / 4K，输出像素宽度）+ 四主题（浅 / 深 / 玻璃 / 玻璃深）；标题与徽章文案可编辑；打开即渲染、改选项即重渲染，预览确认后才落盘；可复制图片到剪贴板 / 下载 PNG / 打开目录。host 端 markdown-it + Shiki 渲染管线（代码高亮 / emoji 短码 / 任务清单 / 表格 / 图片白名单），常驻无头浏览器渲染（空闲自动回收），不再每次冷启动；正文含 mermaid 围栏时把随包引擎投放到临时页面就地画成 SVG（主题配色与界面一致，语法错误的围栏降级成源码块；无图的截图零额外开销） |
| 对话完成胶囊 | 顶部悬浮胶囊（常驻、可拖拽、位置持久化）——完成提醒 + 点击直达最新会话 + 运行中任务实时时长；悬停滑出记录面板；健康提醒徽章（时段可配）；空闲轮播开心话术与 AI 小知识；内置文件浏览器入口；胶囊大小 / 字体 / 显隐可调 |
| 提示音 + 完成卡片 | 回合结束提示音 + 对话完成卡片 |
| 语音播报 | 回合结束用系统语音（或任意 OpenAI 兼容 `/audio/speech` 模型）念一句**结论**——「做完了什么 / 什么原因 / 解决了什么问题」，约 35 字上限，本地提取零 token，可切模型总结。**多会话仲裁**：一台机器只有一个音响，谁先出声谁持话筒，其它会话的实时句直接丢弃、总结加会话名前缀排队，说完静默 4 秒释放话筒；同会话多标签页按文本去重。**随时闭嘴**：对话框图标单击即开关本会话（右键展开细项），静音是进程级硬开关，一次点击掐断所有会话正在念的那句并挡住后续（不写配置，重启复原）。会话覆盖是双向的：全局关着也能只为某会话打开，全局开着也能只让某会话闭嘴。实时逐句朗读默认关闭（长回复念起来就是长篇论述），只念总结 |
| 审批提醒 | 有工具调用等待审批时顶部弹 toast |
| 会话切换柔和过渡 | 内容区淡入上浮、面包屑轻淡入、侧边栏高亮 FLIP 式滑动；`prefers-reduced-motion` 自动禁用 |
| 消息气泡宽度 | 「发送对话宽度」拖动条（px/% 单位，settings.yaml 持久化），只作用于本人消息气泡 |
| 输入框增强 | Ctrl+Enter 换行；移动端响应式 |
| 移动端适配 | 窄屏自动切换 App Shell 布局：底部 Tab 栏（app-tabbar）、折叠式菜单（mobile-menu）、极简视图（mobile-minimal）、返回顶部按钮（back-to-top），响应式样式覆盖（mobile-overrides）；详见 docs/mobile-adaptation-plan.md |
| 提示词优化 | 对话框「优化提示词」图标：点击开面板，用当前选中模型改写草稿；均衡/精简/详尽三档风格可换档重跑，结果先在面板预览、点「应用到输入框」才写回草稿（可选包成 `/goal`）。模型输出会去掉解释文字/围栏/「主要改动」段落后才落地（loopback-only API，仅本地可调） |
| 中文思考开关 | 设置页「中文思考」 |
| MOOD 自述 | Agent 在思考结束、正式回答之前先写一段第一人称自述（```mood 围栏），渲染成对话流里的 MOOD 卡片。**默认折叠**成一枚 chip（星标 + 首节摘要 + 条目数），点击展开左竖线面板（按「小节名: / 条目」自动分节）；折叠态不挂面板 DOM。设置 →「MOOD」页：总开关 + 默认人设 + 按 Agent 预设逐个配开关与专属人设（留空沿用默认，新建的 Agent 自动继承）。提示词段按当次组装的 agent 解析其 preset id 渲染，关闭时返回空串零 token |

### 模型与供应商

| 功能 | 说明 |
|---|---|
| 供应商管理 | 设置 →「供应商」页，统一管理对话供应商（任意 OpenAI 兼容）/ 辅助视觉 / 生图 / 生视频模型 |
| 辅助视觉 + 生图 | `vision_describe`（图片→文本）、`generate_image`（提示词→图片）、非多模态贴图降级、浏览器截图兜底 |
| 生视频 | `generate_video` 工具（遵循 OpenAI `/videos` 规范：创建异步任务 → 轮询至完成返回 url）；设置页两级下拉选供应商/模型（标注「支持生视频」的模型） |
| 生图画廊 | `generate_image` 结果并排缩略图 + Lightbox + 保存 |
| 模型选择增强 | 接管模型座位（纯模型弹出）+ 推理等级滑动式弹出；供应商标签显示当前模型 |
| 上下文窗口/最大输出预设 | 模型上下文窗口 / 最大输出 token 改为预设下拉选择（倒序档位，支持手输） |
| 推理等级自动补全 | `webui_sync_reasoning` 工具按供应商模板补全 `reasoningEfforts` |
| Developer Role 兼容检测 | 一键检测：对每个 openai-completions 供应商真实发 `developer`/`system` 角色对照请求，判定网关是否支持新式 developer 角色；不支持则自动写入路由级 `compat.supportsDeveloperRole: false` 热修复（解决中转网关推理模型一律 HTTP 400） |
| 网关伪装接入 | 部分 LLM 网关按 User-Agent 白名单放行（如 agentrouter.org 只接受 claude-cli / codex_cli_rs 的完整 UA），DSH 归因 UA 会被 401 拒绝且无法经 provider 配置覆盖。fetch 层按域名规则改写 User-Agent、可选注入本地 HTTP 代理 dispatcher，让这类网关按原生 baseURL 直接接入，无需本地反代进程；未命中规则的请求原样透传（只多一次 URL 解析），保存即运行时生效 |
| 供应商限流 | 部分供应商对并发数与 RPM 双限流且 429 空响应（B.AI 实测 6 并发即 429、3s 间隔单发 100% 成功）。fetch 层按域名施两道闸——RPM 令牌桶（泄漏桶语义抹平突发，burst = 每秒令牌数）+ 并发信号量（默认 2），排队时被 AbortSignal 打断原样 reject、超时（60s）返回带 "rate limit" 字样 429 交还 DSH 重试层指数退避接管；默认关闭，关闭时零开销透传，保存即运行时生效 |
| 网页搜索 | AnySearch provider + 设置卡 |
| 邮箱验证码 | `mail_get_code` 工具 + 设置卡（QQ 邮箱验证码提取，支持字母数字混合） |

### 技能

| 功能 | 说明 |
|---|---|
| slash 两级导航 | 替代内核 ui-skill 平铺：输入 `/` 先展示技能集合（bundle），选中集合后再选技能；支持集合名过滤、散装技能入口、`/name` chip 装饰 |
| 技能开关 | 技能面板中每个技能可单独启用/禁用，整包一键开关；直接改写 `SKILL.md` frontmatter，模型目录、`skill` 工具、`/name` 手势同步生效 |
| 技能管理面板 | bundle 分组、上传安装、删除 |

### Markdown 渲染

markstream 流式渲染 + Shiki 代码高亮 + 悬浮目录（TOC）/ 标题锚点 + 提示块（admonition）/ 脚注 / 定义列表 / 任务列表 / 数学公式（KaTeX）+ 思考 chip + 图表。

- **提示块**：`:::note` / `:::tip` / `:::warning` / `:::danger` / `:::error` 围栏容器，支持自定义标题（`:::warning 注意`）。
- **目录 / 锚点**：正文标题 ≥ 3 个时自动在顶部生成可折叠目录，点击平滑滚动。

### 对话流卡片

对话流按「回合」分层呈现：

| 形态 | 出现位置 | 视觉 |
|---|---|---|
| 步骤卡 | 回合中间已完成的 assistant 片段 | 左侧竖线 + 极淡纱，圈出「一步」不抢注意力 |
| 总结卡 | 回合最终回复 | 顶边品牌蓝渐隐细线 + 头部「本轮完成」徽章 + 统计 chip（用时 / 步骤 / 工具 / 思考）+ 正文区 |

流式输出中的片段不包卡（避免边框随文字增长反复重排）；中断的回合总结卡转为琥珀色顶边与「已中断」徽章。统计数字全部取自已有会话投影（turnTimings、本回合节点计数），不新增轮询或订阅。

### 图表（流程图 / 架构图 / 时序图）

语言标记为 mermaid 的代码围栏直接渲染成图，覆盖 flowchart / sequenceDiagram / stateDiagram-v2 / erDiagram / classDiagram / gantt / mindmap / timeline / block-beta / architecture-beta 等图种（各图种关键字也可直接作为围栏语言）。

卡片带图种标签与操作：复制源码 / 导出 SVG / 图⇄源码切换 / 放大整屏查看，配色随 DSH 深浅主题走品牌蓝。

**零常驻开销的实现方式**（这是本功能的关键约束）：

| 维度 | 做法 |
|---|---|
| 体积 | mermaid 引擎不进 client bundle（tsdown 仍把裸导入 `mermaid` 换成 stub），而是随包分发 `assets/vendor/mermaid.min.js.gz`（预压缩 0.95MB），host 路由 `/dyn-assets/vendor/mermaid.min.js` 带 `content-encoding: gzip` + `immutable` 一年强缓存下发 |
| 加载时机 | 首次遇到图表围栏才注入 `<script>`；**整个会话没有图表就永不请求** —— 零下载、零解析、零内存 |
| 渲染时机 | 围栏收尾后才渲染（流式过程显示骨架，不逐 token 重排）；IntersectionObserver 懒渲染，滚出视口的图不计算 |
| 重复渲染 | 结果按「主题 + 源码」LRU 缓存 60 张，滚动回滚 / 主题切回直接命中 |
| 上下文 | 作图提示词仅约 100 token，基础设置「建议模型作图」可关（关闭后零 token，已写好的围栏照旧渲染） |

失败降级：引擎加载失败或语法错误时原样展示源码 + 一行错误说明，不吞内容。整个能力可用模块开关 `diagram: false` 关掉。

### AI 浏览器（壳内多标签，零独立浏览器进程）

浏览器不再是独立的 Edge/Chrome 进程，而是 **DeepSeek Harness 壳子内部的多标签 WebContentsView**——桌面永远不会弹出浏览器窗口，任务栏无图标，AI 操作的页面实时内嵌在对话面板右侧滑出的抽屉里（原生渲染 + 鼠标键盘直接命中）。

#### 架构

- 壳子（`main.js`）内置视图宿主：每会话一个 `persist:` 分区（登录态隔离），每标签一个 WebContentsView
- 控制通道 `http://127.0.0.1:3081`（仅回环）：`/view/create-tab|attach|detach|close-tab|close`
- CDP 调试端口**动态协商**：壳子启动时从 9224 起挑空闲端口并写入 `D:\AI\Dsh\.shell-cdp-port`，插件启动后读取该文件连接（不要写死端口——异常退出的壳子会留下僵尸监听）
- 标签 ↔ CDP target 映射：创建时用 URL hash 匹配，再用 `window.name` 持久标记——服务/壳子重启后视图存活可复用
- 抽屉打开 = 视图挂载到画面区（激活标签关闭 JS 节流，全速）；抽屉关闭 = 视图卸下（`visible=false` + 恢复节流，空闲 CPU 趋近 0）

#### 工具速查

| 工具 | 用途 |
|---|---|
| `browser_batch` | **一次调用按顺序执行最多 20 个动作**（click/type/select/hover/press/scroll/navigate/wait），只返回最终快照；失败时报「第 N 步失败」并附已完成步骤 |
| `browser_navigate` | 打开 URL，可带 `wait_for_selector` / `wait_for_text`，加载与等待合成一次调用 |
| `browser_click` / `_type` / `_select` / `_hover` / `_press` / `_scroll` | 单步操作（作用于当前激活标签）；`_press` 支持 `repeat`，`_scroll` 支持 `selector` 滚内部容器 |
| `browser_wait_for` | 等选择器/文本出现或消失（`gone`），在页面内轮询完成——不消耗额外 LLM 轮次 |
| `browser_extract` | 提取正文文本 + 链接列表（读内容比 snapshot 省 token 且无交互噪音） |
| `browser_back` / `_forward` | 历史导航 |
| `browser_snapshot` | 文本 ref 树（元素以 `[ref]` 定位；含 shadow DOM 与同源 iframe 内元素） |
| `browser_see` / `browser_screenshot` | 截图 + 视觉描述（自动降级 renderer 截图，detached 视图不卡死） |
| `browser_evaluate` | 页面执行 JS（含 `await`/多语句自动包 async 函数） |
| `browser_status` / `browser_stop` | 状态查询 / 关闭全部标签 |

#### 元素定位：ref / selector / text_match 三选一

所有元素操作工具都接受三种定位方式，任选其一：

| 参数 | 适用 | 优势 |
|---|---|---|
| `ref` | 刚拍过 snapshot | 最快 |
| `selector` | 知道 CSS 选择器 | **免快照**；自动穿透 shadow DOM 与同源 iframe |
| `text_match` | 只知道按钮文字 | **免快照**；精确 → 前缀 → 包含逐级匹配，`nth` 选第几个 |

后两者不需要先 `browser_snapshot`，页面变化后也不必重拍——每省一次快照就省一整轮 LLM 推理。

#### 效率技巧：连续操作用 browser_batch

逐个调用 `browser_click` / `browser_type` 时，每个动作都要一整轮 LLM 推理（20~40 秒），注册表单这类 10~20 步的任务会拖到 6 分钟以上。改用 `browser_batch` 把整段流程压成一次调用：

```json
{"action": "browser_batch", "actions": [
  {"action": "type", "selector": "#email", "text": "me@example.com"},
  {"action": "type", "selector": "#password", "text": "密码123"},
  {"action": "click", "text_match": "同意条款"},
  {"action": "click", "text_match": "注册"},
  {"action": "wait", "text": "注册成功", "timeoutMs": 8000}
]}
```

任一步失败立即中止并报「第 N 步失败 + 原因 + 已完成步骤」；全部成功返回最终快照。给 AI 的指令里写一句「用 browser_batch 批量完成」即可触发。

> 提速策略已默认常驻：插件会把「batch / evaluate 优先」的提速策略作为系统提示词自动注入（settings 命名空间 `browser-speed`，默认开启、关闭时零 token 占用），无需每次在指令里点名；开关在 dock 工具条悬停权限卡片里。

#### 元素选取

dock 工具条「选取元素」按钮进入选取模式，点击预览画面任意元素，自动采集唯一 CSS 选择器 + 元素摘要并回填对话框草稿（再点一次或 Esc 退出）。详见 [docs/ELEMENT-PICKER.md](docs/ELEMENT-PICKER.md)。

#### 抽屉 UI

抽屉里是一套完整的浏览器 chrome，自上而下三条 38px 等高行 + 画面区 + 底部时间线：

| 层 | 内容 |
|---|---|
| ① 标签页栏 | 品牌标记（运行时呼吸点）· 标签页（站点首字母 + 标题，悬停出关闭）· 新建 · 关闭抽屉 |
| ② 工具栏 | 后退 / 前进（按导航历史自动置灰）· 刷新 · **地址栏** · 复制网址 · 收藏 · 选取元素 · 更多 |
| ③ 书签栏 | 书签胶囊（点击新标签打开）· 管理面板（增删）；可在「更多」里整条隐藏 |
| 画面区 | 原生 WebContentsView 贴合于此；未贴合时回退实时帧，可直接鼠标/键盘/滚轮操作 |
| 时间线 | 收起为 34px 细轨（最新一条操作 + 步骤计数），点击展开完整列表 |

- **地址栏**：非编辑态显示「安全标识 + 域名强调 + 路径淡化」，点击进入编辑并全选，Enter 导航、Esc 取消；导航中底缘显示进度轨。
- **宽度可调**：左缘 4px 拖拽把手，范围 520px ~ 视口宽 −44px，结果持久化（localStorage）。
- 左侧留白区点击或 Esc 收起抽屉；收起后浏览器视图卸下、不占任何资源。选取模式或「更多」菜单打开时，Esc 只关闭它们。
- 图标全部为内联 SVG（`browser/icons.tsx`），规格对齐 DSH 官方 ui-primitives：28px 图标按钮 (r14)、24px 胶囊 (r12)、30px 输入件 (r8)、border-l2 细线。文字对比度在明暗 × 玻璃开关四种组合下均达 WCAG AA。

### 定时自动化任务引擎

左侧导航「新会话」下方菜单项，点开从菜单右侧滑出 TAB 式浮层卡片（窄屏回退底部 sheet），分「任务计划 / 运行记录」两个 Tab。

- **任务计划**：工具栏「＋ 新建」创建任务（调度类型：单次 at / 固定间隔 every / 5 字段 cron；执行 prompt；绑定模型与推理等级或留空用默认模型）+ **AI 待确认建议区**——Agent 通过 automation 工具发起的 create/update 先落为建议卡，用户二次确认后才生效
- **真实执行引擎**（host 半身）：CronStore 持久化到 `${DSH_HOME}/automation/dsh-webui/`，服务进程内 60s tick 调度——**GUI 关闭照常触发**；到期任务经 `ctx.llm` 以绑定模型真实执行并记录运行历史；连续失败计数驱动退避，配置修订号乐观锁防运行中编辑错写
- **运行记录**：每次执行落一条 jsonl 记录（success / error / skipped + 起止时间 + 输出摘要 + 完整产出全文回看）
- **Agent 协作**：`automation` 工具供 Agent 列出全部任务、以自然语言建议新建/修改任务（经用户确认生效）

### 团队 Agent 编排（`team`）

把「多角色 AI 团队分工协作」做成可编排的数据：**多个团队**，每个团队有自己的角色集、协作链、
团队默认模型；一次任务按链条串行接力，末尾由主脑整合成最终交付物。

- **多团队**：一团队一文件持久化（`${DSH_HOME}/team/teams/<id>.json`，可直接编辑 / 纳入 git / 导入导出），
  支持新建（空白或套用出厂编制）、复制、重命名、删除、恢复出厂编制；面板顶部团队切换器
- **一句话生成团队**：面板「✨ 一句话生成」/ 对话内 `team_create` 工具——描述一句需求，模型设计出
  完整编制（角色 + 各自的系统提示词 + 分组 + 协作链 + 关联关系）并落盘为新团队；生成只产结构不产
  模型绑定（角色统一继承团队默认模型，避免模型编出不存在的 provider/model）；解析失败不留半成品
- **全高抽屉面板**：占满右侧可视区（min(1180px, 92vw)），编制页为「左画布 + 右检视栏」双列，
  抽屉窄于 860px 时自动退化为上下单列
- **可交互编制画布**：SVG 手绘（无第三方图表依赖）——节点**可拖拽排布**（归一化坐标持久化，窗口缩放
  等比例保持）、拖节点右下角连接柄**建立关联**、点连线可改单/双向或删除、一键「自动重排」；
  中心主脑 + 分组配色，选中链高亮接力路径，运行中角色节点点亮并呼吸；拖拽只改一处 transform，
  松手才保存一次（不影响性能）
- **模型分层可设置**：团队默认模型 → 角色可单独覆盖（下拉首项固定「继承团队默认」）→ 单次运行还能临时覆盖。
  解析优先级 **本次运行 > 角色覆盖 > 团队默认 > 全局默认**，每步开始时解析一次并记录来源层（运行中改配置不影响在跑的步骤）
- **每角色能力装配（插件工具 + 技能包）**：角色编辑面里按角色开关——工具（继承全部 / 只允许所选白名单 / 禁用所选黑名单）
  + 技能（不限制 / 只用所选 / 不用技能）+ 技能包多选（选中即展开包内技能）。subagent 通道走 DSH 原生
  `toolFilter` **真实限制**（未授权工具从子 agent 提示词消失且拒绝执行）；llm 直跑通道无工具，工具装配仅作声明、
  技能则把正文**内联进提示词**（按预算截断）。装配清单里当前环境缺失的名字只提示、不阻断执行。
- **出厂编制**：主脑 brain 星见（中枢）+ architect 观月 / strategist 凛音（信息与判断）+ coder 琉夏 / tester 星乃（落地执行）+ reviewer 神代（守护支持），
  两条预设链：`full-delivery` 观月→琉夏→神代→整合、`fast-iteration` 琉夏→星乃→整合
- **链内并行组**：ChainStep 加 `parallel: true` 标记「与上一步同批并行执行」——引擎把连续标记 parallel 的步骤归入同一波次（wave）并发启动，受 `maxParallel`（默认 2，1–5）限制；超限自动溢出到下一波
- **主脑自主派发（autoPlan）**：`team_run` 传 `autoPlan: true` 时，主脑先用自身模型产 JSON 波次计划（`PLAN_SYSTEM` + `buildPlanPrompt`），按依赖关系编排并行组再执行，不必预定义链；解析失败（如空数组/非法 roleId）回退全串行+整合，不留半成品
- **两条执行通道**：`llm` 直跑（精确用设定模型，无工具）/ `subagent`（完整 agent，可读写文件跑命令，模型继承会话）；
  角色 `executor` 为 `auto` 时按触发上下文自动选择（面板触发→llm，对话内触发→subagent）
- **对话框团队开关**：输入区「团队」图标（order 4，提示词优化左侧）→ 悬浮卡选团队/链条/强制模式，
  会话级持久化；开启后 host 动态注入系统提示词，模型在需要多角色协作时自行调用 `team_run`（零 DSH 源码改动）
- **对话流执行 HUD**：运行中在对话区顶部浮出——团队名·链名、步骤圆点、总耗时、TODO 进度条，
  运行一开始即实时显示（新运行自动展开面板；页面会话错位/切会话后仍能跨会话兜底显示全局在跑的团队），
  展开后是**每角色一张运行卡**（状态灯呼吸 / 实际模型 + 来源徽标 / 单步计时 / 流式输出摘要 / 点开看全文），
  支持取消运行、多团队并发分段、结束后停留 15s 再收成小胶囊
- **产物落盘**：`${DSH_HOME}/team/runs/R-<ts>-<rand>/`（`run.json` + `steps/NN-<role>.md` + `final-deliverable.md`）
- **工具**：`team_create`（一句话生成团队）、`team_list`（列出团队与链）、`team_run`（启动并等待完成，返回最终交付物；支持 `autoPlan` 自主并行派发）、`team_status`（查运行状态与每步模型来源）
- **HTTP API**：`/api/webui-team/{teams,globals,providers,capabilities,chat-mode,runs}`（loopback-only）；
  settings 命名空间 `webui-team` 承载全局默认（超时/重试/并发/上游预算/失败即停）

### 记忆

- **记忆引擎**：侧边栏记忆面板 + 会话记忆注入 + 注入开关 + 手动写入长期记忆
- **面板（主从布局）**：左列紧凑条目行（标题 / 摘要 / 相对时间 / 重要度迷你条 / 作用域徽章 / 行内启用开关），右列详情（语义徽章 + 重要度与置信度 + Markdown 正文 + 标签 + 版本/创建/命中脚注）；顶部 Tab 组带统计条（记忆数 · 项目数 · 置顶 · 长期 · 已禁用），项目胶囊带条目计数，工具行 = 搜索（260ms 防抖 + 一键清除）· 标签下拉 · 刷新 · 一键整理 · 添加 · 多选；四个 Tab（全部 / 变更 / 修订 / 设置）各自按需加载，切 Tab 不会把所有接口重打一遍
- **条目编辑**：内容 / 标签 / 重要度 / 置顶 / 记忆类型（身份·偏好·事实·决策·踩坑·会话摘要）/ 归属（全局 ⇄ 项目）在同一编辑面完成；项目可就地改别名（清空回退目录名）、按项目开关自动记忆、清空该项目记忆（置顶豁免）
- **变更 / 修订**：变更 Tab 可切「今天 / 全部」，动作徽标按语义配色（新增绿 / 沉淀金 / 删除红），改写类变更左右并排对比；修订 Tab 列出整理前快照并可一键回滚
- **设置 Tab**：分组行卡片（注入 / 提取 / 编译与衰减 / 整理 / 诊断），每项显示取值范围与说明，数值失焦或回车才提交（避免把「删空重打」的中间态写进配置），越界由 host 钳制，另有「恢复默认」
- **本地 hybrid 检索引擎**（零外部依赖）：keyword 精确子串 AND 命中；hybrid（默认）= 字符 n-gram Jaccard 相似度 + 精确命中加成 + 元数据加权（verified / confidence / importance）。**面板搜索与 `memory_search` 工具走同一套打分**，不会出现「工具搜得到、面板搜不到」
- **semantic 向量检索（可用）**：embedding 引擎（`src/memory/engine/embedding.ts`）双后端——`http` 走任意 OpenAI 兼容 `/v1/embeddings`（含 ollama openai 端点 / one-api / new-api 等，零额外依赖，apiKey 优先读环境变量 `DSH_MEMORY_EMBEDDING_API_KEY` 绝不写日志）；`local` 走 @xenova/transformers 本地 ONNX（默认 all-MiniLM-L6-v2，384 维），动态 import 懒加载，依赖未装时优雅降级 hybrid 不崩溃。显式 semantic 检索时才按需计算并缓存到条目（schema v2 预留），不做全量预热（性能红线）
- **Memory Dream 记忆巩固**：每天（或手动触发）用 LLM 对记忆做语义化整理——合并近重复/强相关条目、精炼重写、删除过时/低价值、提升长期；与每日规则化衰减/折叠（处理「分数」）正交叠加，本引擎处理「语义」
- **安全设计**：输入排除 pinned 与已禁用条目（保护用户明确标记/冻结的内容），apply 时按 id 锚定防误删；整理前写入 revisions 快照支持一键回滚；LLM 失败/超时/解析失败一律空结果，绝不阻塞每日编译
- **回归测试**：`npm run test:memory`（`scripts/test-memory.mjs`）覆盖配置钳制、注入文本预算累积、记忆分类、条目 id 派生与合并，以及 HTTP 路由（含批量删除 / 配置合并写 / 变更全量查询 / 项目 hash 派生）——不依赖 DSH 运行时、不碰用户数据

### 用量与统计

| 功能 | 说明 |
|---|---|
| 用量工作台 | 「趋势」tab：概要统计 + 面积图 + 环图 + 模型/供应商消耗排行榜；时间范围预设选择器（今日/昨日/近7天/近30天/本月/上月/今年/全部/自定义），粒度自适应（≤31 天按日、≤120 天按周、更长按月） |
| 信号 tab | Agent 效率与归因统计 + 用量异常日红色警示条（可下钻当日会话列表）+ 30 日 Token 预算（数值输入保存，超支进度条预警） |
| 热力图 | 用量热力分布 |
| 账户/订阅 | 账户余额与订阅状态展示 |
| 对话统计条 | 会话流下方统计条（缓存命中率精确到小数点后两位） |
| DeepSeek 峰谷时刻卡片 | 侧边栏 footer 首行显示峰时/谷时状态与切换倒计时（工作日 09:00–12:00 / 14:00–18:00 计峰；周末全天空闲价，2026-08-23 起新规，生效前按旧规则每日计峰） |

### 文件与工作区

| 功能 | 说明 |
|---|---|
| 文件浏览器 | 右上角入口 + 树形目录 + 双击编辑（CodeMirror 语法高亮）+ 保存 |
| 文件修改历史 | 基于对话退回快照体系：时间线列出该文件在各次发消息前的内容变化点，选中后左右分栏 diff（LCS 行级双向对齐、天然同步滚动），对比历史版本与当前磁盘内容 |
| 应用内文件预览卡 | 官方产物 chip / 正文文件提及的点击接管为应用内滑出预览——图片查看器 / markdown 渲染 / 高亮文本 / 二进制 hex 兜底，全程不经系统打开 |
| 工作区文档卡片 | 侧边栏 footer 峰谷时刻卡片上方按文件出卡：检测当前会话工作区根的 AGENTS.md 与 CLAUDE.md（大小写不敏感），存在即各一张卡片、点击经应用内预览卡查看/编辑；两文件皆缺时显示虚线「创建 AGENTS.md」占位卡，一键写入初始骨架并自动打开预览卡。数据全部走既有 `/api/file-explorer` 路由，30 秒一次 loopback 目录列表轻量复查 |
| 工作区目录选择器 | 自写弹窗（添加工作区时选文件夹，shadow 官方 native 选择器） |
| 临时垃圾清理器 | 定时清空各工作区 `_tmp/` 内的 AI 临时脚本与常见垃圾文件：`_tmp/` 约定目录整体清理 + 规则扫描（内置 `*.tmp` `*.bak` `*.swp` `*.log` `.DS_Store` `Thumbs.db` 等 + 自定义追加规则）；调度可自定（每天 HH:mm / 每 N 小时，设置页通用分区行卡片配置）+ 可选启动补跑；最小文件年龄保护（默认 24h，到龄才清）、`.git`/`node_modules` 等保护目录永不下钻、单轮条目上限、每轮落 jsonl 日志（`${DSH_HOME}/tmp-cleaner/dsh-webui/log.jsonl`）；「预览待清理 / 立即清理」手动入口 + agent 工具 `webui_tmp_clean`；默认维护一条「临时脚本一律写工作区 `_tmp/`」**置顶记忆**（tag `tmp-cleaner-convention`，可在记忆面板直接改文案、重启不打回；记忆引擎未启用时退回系统提示词注入，开关可关） |

### 外观与系统

| 功能 | 说明 |
|---|---|
| 玻璃质感主题 | 「通用」分区开关 + 不透明度滑块（40–95%，步进 5）——半透明毛玻璃材质（背景模糊 + 高光细边 + 柔和投影），与官方浅色/深色任意组合，拖动即时预览、松手落盘（settings.yaml + localStorage 双通道持久化） |
| 悬浮侧边栏 | 「固定侧边栏」（默认开启=原生固定；关闭=悬浮模式，左侧常驻热区悬停展开、移出自动折叠，overlay 覆盖不挤压主内容；即时切换 + 持久化） |
| 壳管理更新 | 宽度/自启/版本/一键更新（更新的是 DSH 本体源码） |
| 插件自更新（增量） | 「通用」分区行卡片：一键检测上游是否有新版本（匿名读 GitHub，无需 token），有则**增量更新**——只下载两版之间的改动补丁（实测 1.2 MB 文本、传输 336 KB；整包重装是 4.7 MB），自写 unified diff 应用器逐文件打补丁，再按 **git blob sha 逐文件校验**，全部通过才落盘；写入用「临时文件 + rename」顶替，避开 pnpm 硬链接写穿全局 store 的坑。校验不过（本地文件被改过 / 二进制改动）自动回退整包重装，绝不留半成品。源码 checkout 形态走 `git pull --ff-only`。提交级比对（包内 `.dsh-update-commit` 标记优先、回落 profile 锁文件里的已装 sha，作者不 bump 版本号也能发现新提交）、执行日志、上次更新结果与所走路径、自动检查开关、「强制重装最新」兜底。更新后需重启 DSH 生效 |
| 网络代理 | 代理设置行 |
| 工具调用聚合 | 工具 call shadow + 活动抽屉 |

## 构建（Windows）

```powershell
node D:\AI\deepseek-harness\node_modules\tsdown\dist\run.mjs   # host + client bundle
```

Linux/macOS：`DSH_CHECKOUT=<checkout> bash scripts/build.sh`

## 结构

```
src/
├── index.ts                  — host 半身入口：各能力模块装配（按模块开关裁剪）
├── modules.ts                — 功能模块 key 清单与开关解析（host / client 共用）
├── modules-host.ts           — 模块开关 host（settings 命名空间 webui-modules + GET/POST /api/webui-modules）
├── team/                     — 团队 Agent 编排（types / seed 出厂编制 / store 多团队存储 / roster 模型解析 / prompts / engine 运行引擎 / capabilities 能力装配 / generate 一句话生成 / chat-mode 提示词注入 / tools / host 路由）
├── automation/               — 定时自动化任务引擎（store / scheduler / executor / tool / suggestions / routes）
├── deliverables.ts           — 会话产物记账 host（/api/webui-deliverables，按会话白名单授权）
├── devrole-probe.ts          — 供应商 Developer Role 兼容性一键检测 + 自动修复
├── gateway-rewrite.ts        — 网关伪装接入（fetch 层按域名改写 UA + 可选代理 dispatcher；/api/webui-gateway-rewrite）
├── provider-throttle.ts      — 供应商限流（fetch 层按域名 RPM 令牌桶 + 并发信号量；/api/webui-provider-throttle）
├── screenshot/               — 对话截图 host（card 卡片模板 / theme 主题 / presets 设备×画质 / renderer 常驻无头浏览器 / 路由 render·save·reveal·image）
├── diagram.ts                — 图表支撑 host（/dyn-assets/vendor/mermaid.min.js 按需下发 + 作图提示词开关）
├── memory/                   — 记忆引擎（engine/retrieval.ts 本地 hybrid 检索、engine/consolidate.ts 为 Memory Dream 语义整理）
├── vision-helper.ts          — 辅助视觉 + 生图 + 生视频能力与 HTTP 接口
├── skill-toggles.ts          — 技能开关路由（读写 SKILL.md frontmatter）
├── usage-host.ts             — 用量统计 + 技能管理 host
├── sidebar-float.ts          — 悬浮侧边栏设置
├── message-width.ts          — 消息气泡宽度设置
├── prompt-optimize.ts        — 提示词优化 host 路由（loopback-only，SSE 流式 + 风格档位）
├── prompt-optimize-clean.ts  — 优化结果清洗纯函数（去围栏/小标题/结尾说明，两端共用）
├── appearance.ts             — 玻璃质感设置（/api/webui-appearance）
├── plugin-update.ts          — 插件自更新 host（/api/webui-plugin-update：检测上游版本/提交 + 增量补丁 / 整包重装 / git pull）
├── plugin-update-patch.ts    — 增量更新纯函数内核（unified diff 解析与应用 + git blob sha 校验，可单测）
├── done-pill.ts              — 对话完成胶囊 host
├── voice.ts                  — 语音播报 host（朗读进程 / 多会话话筒仲裁 / 静音 / 结论总结；/api/webui-voice + /speak /summary /stop /mute）
├── voice-text.ts             — 播报文本纯函数（Markdown 清洗 / 流式分句 / outcomeSummary 结论提取，两端共用）
├── rewind.ts / rewind-diff.ts / screenshot.ts — 对话退回（git 式内容寻址快照）/ 行级 LCS 对齐 diff / 消息截图 host
├── workspace-dir-picker.ts   — 工作区目录选择器
├── tmp-cleaner.ts            — 工作区临时垃圾清理器（_tmp 约定目录 + 规则扫描 + 调度 + webui_tmp_clean 工具）
├── browser/                  — AI 浏览器 host（壳内多标签对接 + CDP 原语）
└── client/
    ├── index.ts              — client 入口：注册各 UI 槽位（按模块开关裁剪）
    ├── modules.ts            — 模块开关 client（localStorage 同步读 + /api/webui-modules 校正）
    ├── skill-source/         — 技能 slash 两级导航源 + 技能工具行
    ├── session-pin/          — 会话置顶 / 归档 / 右键菜单 / 重命名
    ├── provider-hub/         — 供应商设置页（chat / vision / image / video）
    ├── automation/           — 自动化面板（Tab 浮层：任务计划 / 运行记录 + AI 建议确认卡）
    ├── team/                 — 团队编排 client（Panel 全高抽屉 / TeamGraph 可拖拽关联画布 / RoleCard / CapabilityEditor 能力装配 / ChainEditor / ModelSelect / GenerateModal 一句话生成 / ChatToggle 对话框开关 / RunHud 执行 HUD / RoleRunCard 角色运行卡）
    ├── markdown/             — markstream 渲染（Shiki 高亮 / stub 替换层）+ flow-card.tsx 对话流卡片 + diagram.tsx 图表块（引擎懒加载）
    ├── memory/ browser/ file-explorer/ image-gallery/ tool-summary/ message-deliverables/
    │                         — 记忆面板（含 SettingsTab）/ 浏览器 dock / 文件浏览器（FileHistoryView 修改历史、预览总线）/ 图库 / 工具聚合 / 会话产物大卡片
    ├── usage/                — 用量工作台（TrendTab / SignalTab / RangePicker / Heatmap / AreaChart）
    ├── done-pill.tsx         — 完成胶囊 client
    ├── voice/                — 语音播报 client（SettingsRow 全局默认 / ChatToggle 本会话开关与静音 / announcer 播报驱动 / store 会话覆盖与订阅 / session-label 会话名）
    ├── glass.ts / glass-row.tsx — 玻璃质感 client
    ├── session-motion.ts     — 会话切换柔和过渡
    ├── sidebar-float*.ts(x)  — 悬浮侧边栏 client
    ├── shell-titlebar.ts     — 壳子窗口控制按钮共存样式
    ├── mobile-app-shell.ts / mobile-menu.tsx / mobile-minimal.ts / mobile-overrides.ts
    │                         — 移动端适配（App Shell 布局 / 底部菜单 / 极简模式 / 覆盖样式）
    ├── app-tabbar.tsx        — 移动端底部 Tab 栏
    ├── back-to-top.tsx       — 返回顶部按钮
    ├── tmp-cleaner-card.tsx  — 临时垃圾清理设置卡（计划 / 预览 / 立即清理）
    ├── plugin-update-card.tsx — 插件更新设置卡（检查更新 / 增量更新 / 强制重装 / 日志）
    ├── gateway-rewrite-card.tsx — 网关伪装接入设置卡（UA / 代理 规则列表）
    ├── provider-throttle-card.tsx — 供应商限流设置卡（RPM / 并发 规则列表）
    └── styles.ts             — 注入样式
docs/
├── ELEMENT-PICKER.md         — 浏览器元素选取设计文档
└── TEAM-ORCHESTRA.md         — 团队 Agent 编排插件设计文档（v0.5：多团队 + 团队级模型 + 对话框开关 + 执行 HUD + 可拖拽关联画布 + 一句话生成 + 每角色工具/技能装配）
```

## 许可

BSD-3-Clause
