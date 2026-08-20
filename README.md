# dsh-webui — DeepSeek Harness 会话增强全家桶

一个插件融合了视图切换、消息导航、供应商管理、辅助视觉、生图、记忆、浏览器、文件浏览器、Markdown 渲染、工具聚合、网页搜索、提示音、壳管理更新、网络代理、中文思考等能力。纯插件实现，不改动 DSH 源码。

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

## 功能

1. **右上角视图图块 + 消息导航**：对话/轨迹切换图块、消息徽标/弹窗列表、右侧消息横条、自动加载更早消息
2. **供应商模块**（原 dsh-provider-hub）：设置 →「供应商」页，统一管理对话供应商（任意 OpenAI 兼容）/ 辅助视觉模型 / 生图模型
3. **辅助视觉 + 生图**（原 dsh-vision-helper）：`vision_describe`（图片→文本）、`generate_image`（提示词→图片）、非多模态贴图降级、浏览器截图兜底
4. **生图画廊**（原 dsh-image-gallery）：`generate_image` 结果并排缩略图 + Lightbox + 保存
5. **记忆引擎**（原 dsh-memory）：侧边栏记忆面板 + 会话记忆注入
6. **AI 浏览器**（原 dsh-browser）：CDP 直连 Chrome 操作 + 设置开关
7. **文件浏览器**（原 dsh-file-explorer）：右上角入口 + 树形目录 + 双击编辑
8. **Markdown 增强**（原 dsh-better-markdown）：markstream 渲染 + 思考 chip
9. **工具调用聚合**（原 dsh-tool-summary）：工具 call shadow + 活动抽屉
10. **网页搜索**（原 dsh-web-search-anysearch）：AnySearch provider + 设置卡
11. **用量工作台 + 技能面板**（原 dsh-usage-skill）：用量统计 + 技能管理
12. **中文思考开关**（原 dsh-zh-thinking）：设置页「中文思考」
13. **提示音**（原 dsh-task-done-sound）：回合结束提示音 + 对话完成卡片
14. **壳管理更新**（原 dsh-updater）：宽度/自启/版本/一键更新
15. **网络代理**（原 dsh-proxy）：代理设置行
16. **推理等级自动补全**：`webui_sync_reasoning` 工具按供应商模板补全 `reasoningEfforts`
17. **DeepSeek 峰谷时刻卡片**：侧边栏 footer 首行显示峰时/谷时状态与切换倒计时（工作日 09:00–12:00 / 14:00–18:00 高峰）
18. **对话退回**（原 dsh-webui-rewind）：每条用户消息加退回按钮，一键回退工作区文件到该消息发送前 + 原地回退上下文（fork 到该消息之前 turn 边界 → 归档原会话 → 打开子会话）

## 构建（Windows）

```powershell
node D:\AI\deepseek-harness\node_modules\tsdown\dist\run.mjs   # host + client bundle
```

Linux/macOS：`DSH_CHECKOUT=<checkout> bash scripts/build.sh`

## 结构

- `src/index.ts` — host 半身：推理等级工具、AnySearch provider、各能力模块装配
- `src/vision-helper.ts` — 辅助视觉 + 生图能力（vision_describe / generate_image / 图片降级 / HTTP 接口）
- `src/client/index.ts` — client 入口：注册各 UI 槽位（header utilities、settings.section 等）
- `src/client/provider-hub/` — 供应商设置页（对话供应商 + 视觉 + 生图）
- `src/client/memory/` / `browser/` / `file-explorer/` / `image-gallery/` / `markdown/` / `tool-summary/` / `usage/` — 各融合模块
- `src/client/styles.ts` — 注入样式（隐藏官方标签页、按钮布局等）

## 许可

BSD-3-Clause
