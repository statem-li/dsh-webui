# dsh-webui — DeepSeek Harness 会话增强全家桶

一个插件融合了视图切换、消息导航、技能管理（slash 两级导航 + 开关）、供应商管理、辅助视觉、生图、记忆、浏览器、文件浏览器、Markdown 渲染、工具聚合、用量统计、网页搜索、提示音、壳管理更新、网络代理、对话退回、消息截图、中文思考等能力。纯插件实现，不改动 DSH 源码。

## 一句话安装（DSH）

```bash
dsh plugin --profile web add github:statem-li/dsh-webui
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml` 追加注册：

```yaml
- insert:
    - id: dsh-webui
      name: "@dsh-external/dsh-webui"
```

重启 DeepSeek Harness 即可。

> 注：webui 接管了技能 slash 源（`/` 菜单），安装后需在 `~/.dsh/profiles/web/cordis.patch.yml` 禁用内核 ui-skill 插件以避免同名源冲突：

```yaml
- id: ui-skill
  name: "@deepseek-ai/dsh-client-ui-skill"
  disabled: true
```

## 功能

1. **右上角视图图块 + 消息导航**：对话/轨迹切换图块、消息徽标/弹窗列表、右侧消息横条、自动加载更早消息
2. **技能 slash 两级导航**（替代内核 ui-skill 平铺）：输入 `/` 先展示技能集合（bundle），选中集合后进入再选技能；支持集合名过滤、散装技能入口、`/name` chip 装饰
3. **技能开关**：技能管理面板中每个技能可单独启用/禁用，每个技能包可一键开关；开关直接改写技能 `SKILL.md` frontmatter（`user-invocable` / `disable-model-invocation`），模型目录、`skill` 工具、`/name` 手势同步生效，slash 菜单自动过滤禁用技能
4. **供应商模块**（原 dsh-provider-hub）：设置 →「供应商」页，统一管理对话供应商（任意 OpenAI 兼容）/ 辅助视觉模型 / 生图模型
5. **辅助视觉 + 生图**（原 dsh-vision-helper）：`vision_describe`（图片→文本）、`generate_image`（提示词→图片）、非多模态贴图降级、浏览器截图兜底
6. **生图画廊**（原 dsh-image-gallery）：`generate_image` 结果并排缩略图 + Lightbox + 保存
7. **记忆引擎**（原 dsh-memory）：侧边栏记忆面板 + 会话记忆注入 + 注入开关
8. **AI 浏览器**（原 dsh-browser）：壳内多标签内嵌浏览器（详见下方「AI 浏览器」章节）+ 设置开关；`browser_see` / 浏览器截图在对话流内联展示
9. **文件浏览器**（原 dsh-file-explorer）：右上角入口 + 树形目录 + 双击编辑（CodeMirror 语法高亮）+ 保存
10. **工作区目录选择器**：自写弹窗（添加工作区时选文件夹，shadow 官方 native 选择器）
11. **Markdown 增强**（原 dsh-better-markdown）：markstream 渲染（代码块/图片/行内代码/链接自定义组件）+ 思考 chip
12. **工具调用聚合**（原 dsh-tool-summary）：工具 call shadow + 活动抽屉
13. **模型选择增强**：接管模型座位（纯模型弹出）+ 推理等级滑动式弹出；供应商标签显示当前模型
14. **网页搜索**（原 dsh-web-search-anysearch）：AnySearch provider + 设置卡
15. **用量工作台 + 技能面板**（原 dsh-usage-skill）：用量统计（趋势图/热力图/账户/订阅）+ 技能管理（bundle 分组、上传安装、删除、开关）
16. **对话统计条**：会话流下方统计条（缓存命中率精确到小数点后两位）
17. **审批提醒**：有工具调用等待审批时顶部弹 toast
18. **中文思考开关**（原 dsh-zh-thinking）：设置页「中文思考」
19. **提示音**（原 dsh-task-done-sound）：回合结束提示音 + 对话完成卡片
20. **壳管理更新**（原 dsh-updater）：宽度/自启/版本/一键更新
21. **网络代理**（原 dsh-proxy）：代理设置行
22. **推理等级自动补全**：`webui_sync_reasoning` 工具按供应商模板补全 `reasoningEfforts`
23. **DeepSeek 峰谷时刻卡片**：侧边栏 footer 首行显示峰时/谷时状态与切换倒计时（每日 09:00–12:00 / 14:00–18:00 高峰，周末同样计峰）
24. **对话退回**（原 dsh-webui-rewind）：每条用户消息加退回按钮，一键回退工作区文件到该消息发送前 + 原地回退上下文（fork 到该消息之前 turn 边界 → 归档原会话 → 打开子会话）
25. **邮箱验证码**（原 dsh-mail）：`mail_get_code` 工具 + 设置卡（QQ 邮箱验证码提取，支持字母数字混合）
26. **单条消息截图**：assistant 消息 actions 行截图按钮（渲染会话长图 / 单条樱花主题截图）
27. **输入框增强**：Ctrl+Enter 换行；移动端响应式（设置面板单列化等）
28. **提示词优化**：对话框「自动优化提示词」图标，用当前选中模型流式优化草稿（loopback-only `/api/webui-prompt-optimize`，仅本地可调）
29. **消息气泡宽度**：基础设置「发送对话宽度」（拖动条 + px/% 单位，settings.yaml 持久化），只作用于本人消息气泡
30. **悬浮侧边栏**：设置「固定侧边栏」（默认开启=原生固定侧边栏；关闭=悬浮模式，左侧常驻热区悬停展开、移出自动折叠，overlay 覆盖不挤压主内容；设置持久化并即时切换）
31. **自动化**：左侧导航「新会话」下方菜单项，点开从菜单右侧滑出 TAB 式卡片（窄屏回退底部 sheet），卡片宽高随 TAB 平滑过渡——「执行任务」：按分类管理任务，二级右侧抽屉新建/编辑任务、可选模型与推理强度（数据来自 DSH 模型目录），并为每个任务独立配置执行计划（间隔/每天/每周/每月/单次五种模式 + 实时人类可读预览）；「执行日志」：大卡片按日期倒序展示每天执行记录，支持按任务下拉筛选与清空；定时条件满足时自动落当日记录（同任务同日去重），240ms 淡入淡出 + 内容错落渐显，数据 localStorage 持久化（v1/v2 配置自动迁移）
32. **玻璃质感主题**：设置「通用」分区新增「玻璃质感」开关 + 不透明度滑块（40–95%，步进 5）——半透明毛玻璃材质（背景模糊 + 高光细边 + 柔和投影），与官方浅色/深色任意组合，拖动即时预览、松手落盘（settings.yaml + localStorage 双通道持久化）
33. **对话完成胶囊**：顶部悬浮胶囊（常驻、可拖拽、位置持久化）——对话完成提醒 + 点击直达最新会话 + 运行中任务实时时长；悬停滑出记录面板（用户问题 + 助手回复全文，逐字符淡入）；健康提醒徽章（休息时段/凌晨，时间段可配）；空闲时轮播开心话术与 AI 名词小知识；内置文件浏览器入口；基础设置可调「胶囊大小」（80–160%）「胶囊字体」「显隐」
34. **会话切换柔和过渡**：切换会话时内容区淡入 + 上浮、顶部面包屑标题轻淡入、侧边栏选中高亮平滑滑动（FLIP 式流体过渡），`prefers-reduced-motion` 时自动禁用
35. **用量趋势 / 排行 / 时间范围**：用量工作台「趋势」tab（替代原「总览」：概要统计 + 面积图 + 环图 + 模型/供应商消耗排行榜），时间范围预设选择器（今日/昨日/近7天/近30天/本月/上月/今年/全部/自定义），粒度自适应（≤31 天按日、≤120 天按周、更长按月）
36. **AI 浏览器元素选取**：dock 工具条「选取元素」按钮进入选取模式，点击预览画面任意元素，自动采集唯一 CSS 选择器 + 元素摘要并回填对话框草稿（再点一次或 Esc 退出）

## AI 浏览器（壳内多标签，零独立浏览器进程）

浏览器不再是独立的 Edge/Chrome 进程，而是 **DeepSeek Harness 壳子内部的多标签 WebContentsView**——桌面永远不会弹出浏览器窗口，任务栏无图标，AI 操作的页面实时内嵌在对话面板右侧滑出的抽屉里（原生渲染 + 鼠标键盘直接命中）。

### 架构

- 壳子（`main.js`）内置视图宿主：每会话一个 `persist:` 分区（登录态隔离），每标签一个 WebContentsView
- 控制通道 `http://127.0.0.1:3081`（仅回环）：`/view/create-tab|attach|detach|close-tab|close`
- CDP 调试端口**动态协商**：壳子启动时从 9224 起挑空闲端口并写入 `D:\AI\Dsh\.shell-cdp-port`，插件启动后读取该文件连接（不要写死端口——异常退出的壳子会留下僵尸监听）
- 标签 ↔ CDP target 映射：创建时用 URL hash 匹配，再用 `window.name` 持久标记——服务/壳子重启后视图存活可复用
- 抽屉打开 = 视图挂载到画面区（激活标签关闭 JS 节流，全速）；抽屉关闭 = 视图卸下（`visible=false` + 恢复节流，空闲 CPU 趋近 0）

### 工具速查

| 工具 | 用途 |
|---|---|
| `browser_batch` | **一次调用按顺序执行最多 10 个动作**（click/type/select/hover/press/scroll/navigate），只返回最终快照 |
| `browser_navigate` / `_click` / `_type` / `_select` / `_hover` / `_press` / `_scroll` | 单步操作（作用于当前激活标签） |
| `browser_back` / `_forward` | 历史导航 |
| `browser_snapshot` | 文本 ref 树（元素以 `[ref]` 定位） |
| `browser_see` / `browser_screenshot` | 截图 + 视觉描述（自动降级 renderer 截图，detached 视图不卡死） |
| `browser_evaluate` | 页面执行 JS（处理 ref 定位不到的场景） |
| `browser_status` / `browser_stop` | 状态查询 / 关闭全部标签 |

### 效率技巧：连续操作用 browser_batch

逐个调用 `browser_click` / `browser_type` 时，每个动作都要一整轮 LLM 推理（20~40 秒），注册表单这类 10~20 步的任务会拖到 6 分钟以上。改用 `browser_batch` 把整段流程压成一次调用：

```json
{"action": "browser_batch", "actions": [
  {"action": "click", "ref": 12},
  {"action": "type", "ref": 15, "text": "me@example.com"},
  {"action": "type", "ref": 18, "text": "密码123", "pressEnter": false},
  {"action": "click", "ref": 22},
  {"action": "click", "ref": 30}
]}
```

任一步失败立即中止并报「第 N 步失败 + 原因」；全部成功返回最终快照。给 AI 的指令里写一句「用 browser_batch 批量完成」即可触发。

### 抽屉 UI

- 标题右侧为**标签页栏**：切换 / 悬停关闭 / ＋ 新建
- 第二行左侧是**快捷站点**（点一下新开标签打开，＋ 可添加/删除，全局共享持久化）；右侧是当前网址 + 一键复制
- 底部悬浮条显示最新一条 AI 操作（一句话），点击展开完整时间线
- 左侧留白区点击或 Esc 收起抽屉；收起后浏览器视图卸下、不占任何资源

## 构建（Windows）

```powershell
node D:\AI\deepseek-harness\node_modules\tsdown\dist\run.mjs   # host + client bundle
```

Linux/macOS：`DSH_CHECKOUT=<checkout> bash scripts/build.sh`

## 结构

- `src/index.ts` — host 半身：推理等级工具、AnySearch provider、各能力模块装配
- `src/skill-toggles.ts` — 技能开关路由（/api/skill-toggles：读写 SKILL.md frontmatter，单技能/整包开关）
- `src/vision-helper.ts` — 辅助视觉 + 生图能力（vision_describe / generate_image / 图片降级 / HTTP 接口）
- `src/workspace-dir-picker.ts` — 工作区目录选择器 host 路由
- `src/usage-host.ts` — 用量统计 + 技能管理 host（复用 dsh-usage-skill lib）
- `src/sidebar-float.ts` — 悬浮侧边栏设置（固定/悬浮模式开关，settings.yaml 持久化 + /api/sidebar-float）
- `src/message-width.ts` — 消息气泡宽度设置（/api/webui-message-width）
- `src/prompt-optimize.ts` — 提示词优化 host 路由（loopback-only，选中模型流式优化草稿）
- `src/client/index.ts` — client 入口：注册各 UI 槽位（header utilities、settings.section 等）
- `src/client/skill-source/` — 技能 slash 两级导航源（集合→技能）+ 技能工具行（SkillRow）
- `src/client/provider-hub/` — 供应商设置页（对话供应商 + 视觉 + 生图）
- `src/client/sidebar-float.ts` / `sidebar-float-row.tsx` — 悬浮侧边栏 client（固定/悬浮模式切换 + 左侧热区悬停展开/折叠 + 设置行）
- `src/browser/` — AI 浏览器 host（壳内多标签视图宿主对接 + CDP 操作原语 + 快捷站点/标签路由）
- `src/client/shell-titlebar.ts` — 壳子窗口控制按钮共存样式（详情面板头部让位）
- `src/appearance.ts` — 玻璃质感设置（settings 持久化 + `/api/webui-appearance`）
- `src/done-pill.ts` — 对话完成胶囊 host（全局监听 turn/end + `/api/webui-done-pill`）
- `src/client/glass.ts` / `glass-row.tsx` — 玻璃质感 client（材质叠加 + 通用分区设置行）
- `src/client/done-pill.tsx` — 对话完成胶囊 client（悬浮胶囊 + 记录面板 + 健康提醒）
- `src/client/session-motion.ts` — 会话切换柔和过渡（CSS 动画 + 侧边栏高亮滑动）
- `src/client/automation/schedule.ts` / `ScheduleEditor.tsx` — 自动化执行计划模型 + 编辑器（间隔/每天/每周/每月/单次五模式）
- `src/client/memory/` / `browser/` / `file-explorer/` / `image-gallery/` / `markdown/` / `tool-summary/` / `usage/` / `workspace-dir-picker/` / `approval-notify/` / `chat-stats/` / `peak-valley/` / `mail/` / `model-selection/` — 各融合模块
- `src/client/styles.ts` — 注入样式（隐藏官方标签页、按钮布局等）

## 许可

BSD-3-Clause
