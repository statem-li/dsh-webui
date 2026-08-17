# dsh-session-message-nav — 会话消息导航插件

DeepSeek Harness Web GUI 客户端插件：会话内快速查看/定位自己发过的所有消息。

## 功能

1. **右上角消息数量徽标**（与「对话/轨迹」标签页同行，靠右）
   - 只显示本会话已发送消息总数（蓝色圆形徽标），随新消息实时 +1；
   - 点击展开消息列表：按时间正序，显示序号 / 时间 / 内容预览（两行截断）；
   - 点击某条消息 → 会话自动滚动到该消息，并高亮闪烁 2.4 秒；
   - **自动加载更早消息**：只要还有未加载历史（`hasMore`）就自动连续加载
     直到全部加载完，无需手动点击（带防死循环保护）；
   - 列表随会话实时更新（新消息到达自动出现）。

2. **右侧中间「消息横条」**（透明无背景，只显示横条本身）
   - **每条横条 = 一条你发送的消息**：15px 宽的细短线，不显示文字；
   - 颜色：**当前阅读位置的消息 = 蓝色**（加宽 1.5 倍至 23px），其余 = 灰色，
     随滚动自动切换；
   - 点击某条 → 会话自动滚动到该消息并高亮闪烁 2.4 秒；
   - 消息多时面板可滚动，当前阅读位置的消息自动滚入面板视野；
   - 按住面板空白处上下拖动 → 像拉滚轮一样滚动会话；
   - 列表随会话实时更新（新消息到达自动出现）。

## 安装

### 官方一键安装（推荐）

在 DSH 终端执行（仓库已打 `dsh-plugin` 主题，可被 [DSH 插件目录](https://github.com/topics/dsh-plugin) 发现）：

```bash
dsh plugin add github:statem-li/dsh-session-message-nav
```

安装后重启 `dsh web` 生效。如需锁定版本：`dsh plugin add github:statem-li/dsh-session-message-nav#<commit-sha>`。

---

以下是手动安装方式（备用）：

## 构建

```bash
# host 半身（tsc）+ client 半身（tsdown → lib/client.js）
export DSH_CHECKOUT=D:/AI/deepseek-harness
npm run build        # host: src/ → lib/
npm run build:client # client: → lib/client.js
```

## 装配（官方方式，随 profile 启动加载）

不依赖注入器，直接加入 web profile：

1. `~/.dsh/profiles/web/cordis.patch.yml` 追加：
   ```yaml
   - insert:
       - id: dsh-session-message-nav
         name: "@dsh-external/dsh-session-message-nav"
   ```
2. `~/.dsh/profiles/web/package.json` 的 dependencies 加入：
   ```json
   "@dsh-external/dsh-session-message-nav": "link:D:/AI/Dsh/dsh-session-message-nav"
   ```
3. 重启 DeepSeek Harness 应用，刷新 Web GUI 页面。

（调试期也可用 dev 注入链：junction + loader.create，免重启。）

## 结构

- `src/index.ts` — host 半身（占位；loader 挂载 + client bundle 发现用）
- `src/client/index.ts` — 注册 `conversation.session.header.utilities` 槽位（右上角）
- `src/client/SessionMessageNav.tsx` — 消息数量徽标/弹窗 + 右侧消息横条 UI
- `src/client/styles.ts` — 运行时注入样式（`--dsw-alias-*` 主题令牌）
- `tsdown.config.ts` — host/client 双 bundle（client 平台外部依赖走模块表）

## DOM 契约（ui-conversation 稳定提供）

`[data-conversation-scroll]` 滚动容器 / `[data-chat-flow]` 消息流 /
`[data-chat-anchor-key]` 节点锚点 / `[data-composer-seat]` 粘贴输入区。
