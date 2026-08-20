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
8. **AI 浏览器**（原 dsh-browser）：CDP 直连 Chrome 操作（无头内嵌可交互、会话隔离、活动标识）+ 设置开关；`browser_see` / 浏览器截图在对话流内联展示
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
23. **DeepSeek 峰谷时刻卡片**：侧边栏 footer 首行显示峰时/谷时状态与切换倒计时（工作日 09:00–12:00 / 14:00–18:00 高峰）
24. **对话退回**（原 dsh-webui-rewind）：每条用户消息加退回按钮，一键回退工作区文件到该消息发送前 + 原地回退上下文（fork 到该消息之前 turn 边界 → 归档原会话 → 打开子会话）
25. **邮箱验证码**（原 dsh-mail）：`mail_get_code` 工具 + 设置卡（QQ 邮箱验证码提取，支持字母数字混合）
26. **单条消息截图**：assistant 消息 actions 行截图按钮（渲染会话长图 / 单条樱花主题截图）
27. **输入框增强**：Ctrl+Enter 换行；移动端响应式（设置面板单列化等）
28. **提示词优化**：对话框「自动优化提示词」图标，用当前选中模型流式优化草稿（loopback-only `/api/webui-prompt-optimize`，仅本地可调）
29. **消息气泡宽度**：基础设置「我发送的对话宽度」（px/% 单位，settings.yaml 持久化），只作用于本人消息气泡
30. **悬浮侧边栏**：设置「固定侧边栏」（默认开启=原生固定侧边栏；关闭=悬浮模式，左侧常驻热区悬停展开、移出自动折叠，overlay 覆盖不挤压主内容；设置持久化并即时切换）

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
- `src/client/memory/` / `browser/` / `file-explorer/` / `image-gallery/` / `markdown/` / `tool-summary/` / `usage/` / `workspace-dir-picker/` / `approval-notify/` / `chat-stats/` / `peak-valley/` / `mail/` / `model-selection/` — 各融合模块
- `src/client/styles.ts` — 注入样式（隐藏官方标签页、按钮布局等）

## 许可

BSD-3-Clause
