# webui — 会话 Web UI 插件

DeepSeek Harness Web GUI 客户端插件：把「对话/轨迹」视图切换做成右上角图块按钮，并附带会话消息导航。

## 功能

1. **右上角「对话/轨迹」图块按钮**（与 Session log 下载按钮同行）
   - 接管原生标签页：隐藏 header 第二行的「对话/轨迹」标签页，改为右上角
     utilities 区的一组图块按钮；
   - 图块文案跟随原生标签页（中英文自适应）；点击即切换会话视图；
   - 当前视图图块高亮（active 态），随视图切换实时同步。

2. **右上角消息数量徽标**
   - 只显示本会话已发送消息总数（蓝色圆形徽标），随新消息实时 +1；
   - 点击展开消息列表：按时间正序，显示序号 / 时间 / 内容预览（两行截断）；
   - 点击某条消息 → 会话自动滚动到该消息，并高亮闪烁 2.4 秒；
   - **自动加载更早消息**：只要还有未加载历史（`hasMore`）就自动连续加载
     直到全部加载完，无需手动点击（带防死循环保护）。

3. **右侧中间「消息横条」**（透明无背景，只显示横条本身）
   - 每条横条 = 一条你发送的消息；当前阅读位置 = 蓝色（加宽），其余 = 灰色；
   - 点击某条 → 滚动到该消息并高亮闪烁；悬停 → 预览内容；
   - 按住面板空白处上下拖动 → 像拉滚轮一样滚动会话。

## 构建

```bash
# host 半身（tsc）+ client 半身（tsdown → lib/client.js）
export DSH_CHECKOUT=D:/AI/deepseek-harness
npm run build        # host: src/ → lib/
npm run build:client # client: → lib/client.js
```

Windows 无 bash 时：

```powershell
# client bundle（tsdown）
node D:\AI\deepseek-harness\node_modules\tsdown\dist\run.mjs
# host 半身声明（tsc）
& D:\AI\deepseek-harness\node_modules\.bin\tsc.cmd -p tsconfig.json
```

## 装配（官方方式，随 profile 启动加载）

1. `~/.dsh/profiles/web/cordis.patch.yml` 追加：
   ```yaml
   - insert:
       - id: webui
         name: "@dsh-external/webui"
   ```
2. `~/.dsh/profiles/web/package.json` 的 dependencies 加入：
   ```json
   "@dsh-external/webui": "link:D:/AI/Dsh/webui"
   ```
3. 重启 DeepSeek Harness 应用，刷新 Web GUI 页面。

## 结构

- `src/index.ts` — host 半身（占位；loader 挂载 + client bundle 发现用）
- `src/client/index.ts` — 注册 `conversation.session.header.utilities` 槽位（右上角）
- `src/client/Webui.tsx` — 对话/轨迹图块 + 消息徽标/弹窗 + 右侧消息横条 UI
- `src/client/styles.ts` — 运行时注入样式（`--dsw-alias-*` 主题令牌）
- `tsdown.config.ts` — host/client 双 bundle（client 平台外部依赖走模块表）

## DOM 契约（ui-conversation 稳定提供）

`[data-phase]` 会话根 / `[role="tablist"]` 原生视图标签页 /
`[data-conversation-scroll]` 滚动容器 / `[data-chat-flow]` 消息流 /
`[data-chat-anchor-key]` 节点锚点 / `[data-composer-seat]` 粘贴输入区。
