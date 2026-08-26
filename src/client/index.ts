/**
 * webui — client 半身（合并了 dsh-tool-summary 与 dsh-better-markdown）：
 *
 *  1. 会话头部右上角视图图块 + 消息入口 + 供应商标签（原生 webui 能力）。
 *  2. 工具调用聚合（tool-call shadow + 活动抽屉）。
 *  3. 助手 Markdown 渲染（markstream-react）+ 思考 chip（实时时长 / 实时文字滚动）。
 *
 * 功能模块开关：启动时同步读 localStorage `dsh-webui.modules`（缺省全启用，
 * 只有显式 false 关闭），按它裁剪下方注册点；同时后台 fetch
 * `/api/webui-modules` 校正缓存（host settings.yaml 为准），下次刷新生效。
 * 核心导航与渲染（视图图块 / markstream 基础组件 / 供应商标签 / 响应式样式）
 * 不提供开关，始终启用。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 modelDirectories 服务的 Context 声明（ui-model-selection 提供）。
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
// Type-only: 拉入 theme 服务的 Context 声明（ui-theme 提供；玻璃质感 token 层用）。
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（槽位注册的类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: 激活 ui-tool 的 SlotMap 合并（conversation.chat.node 的 tool-call key）。
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { removeCustomComponents, setCustomComponents } from 'markstream-react'
import 'markstream-react/index.css'
import './markdown/styles.css'
import { Webui } from './Webui'
import { ProviderBadge, type ProviderBadgeInjected } from './ProviderBadge'
// 功能模块开关：localStorage 同步读 + /api/webui-modules 后台校正。
import { readStoredModules, syncServerModules, isModuleEnabled, type WebuiModuleKey } from './modules'
// 模型选择增强：接管模型座位（纯模型弹出）+ 推理等级滑动式弹出。
import { applyModelSeats } from './model-selection'
// AnySearchCard：外接网页搜索设置卡（settings.plugin.item）。
import { registerAnySearchCard } from './AnySearchCard'
// MailCard：邮箱验证码设置卡（settings.plugin.item，紧随 AnySearchCard 之后）。
import { registerMailCard } from './mail/MailCard'
import { apply as registerZhThinking } from './zh-thinking'
import { apply as registerTaskDoneSound } from './task-done-sound'
import { applyVoiceClient } from './voice'
import { applyDonePill } from './done-pill'
import { apply as registerUpdater } from './updater'
import { apply as registerPluginUpdateCard } from './plugin-update-card'
import { applyMessageWidthClient } from './message-width'
import { apply as registerProxy } from './proxy'
// 网关伪装接入：设置页卡片（域名 → UA 改写 / 强制代理，接白名单网关）。
import { apply as registerGatewayRewrite } from './gateway-rewrite-card'
// 供应商限流：设置页卡片（域名 → RPM 令牌桶 + 并发信号量，从源头避免 429）。
import { apply as registerProviderThrottleCard } from './provider-throttle-card'
import { applyBrowserClient } from './browser'
import { applyMemoryClient } from './memory'
import { applyImageGallery } from './image-gallery'
import { applyProviderHub } from './provider-hub'
import { applyFileExplorerClient } from './file-explorer'
// 工作区文档卡片：sidebar footer 峰谷卡上方的 agent.md / claude.md 卡片。
import { applyWorkspaceDocs } from './workspace-docs'
import { applyWorkspaceDirPickerClient } from './workspace-dir-picker'
import { apply as applyUsageEntries } from './usage/entry'
import { applyPeakValley } from './peak-valley'
import { applyApprovalNotifier } from './approval-notify'
import {
  BetterAssistantNodeView, DshCodeBlockNode, DshImageNode, DshInlineCodeNode, DshLinkNode,
  MarkdownImageStrip,
} from './markdown/renderer'
// 图表渲染（mermaid 围栏 → 图，引擎按需加载）：模块开关。
import { DiagramBlock, setDiagramEnabled } from './markdown/diagram'
import { registerDiagramSetting } from './markdown/diagram-row'
// MOOD：```mood 围栏渲染成自述卡片 + 设置页（按 Agent 预设的开关与人设）。
import { setMoodEnabled } from './mood/MoodBlock'
import { applyMoodSettings } from './mood/MoodSection'
import { ToolGroupNodeView } from './tool-summary/ToolGroupNodeView'
import { mountActivityDrawer } from './tool-summary/activity-drawer'
import { injectStyles as injectToolSummaryStyles } from './tool-summary/styles'
// StatsLine shadow：对话流下方统计条，缓存命中率保留两位小数。
import { StatsLineShadow } from './chat-stats/StatsLineShadow'
import { injectStatsStyles } from './chat-stats/styles'
// 对话「退回」：user 消息复制按钮旁追加退回（文件回退 + 上下文分支）。
import { applyRewindClient } from './rewind'
// 对话输入框 Ctrl+Enter 换行。
import { applyCtrlEnterNewline } from './ctrl-enter-newline'
// 对话截图：assistant 消息 actions 行的相机按钮 → 截图面板（范围/主题/宽度 + 预览后保存）。
import { applyMessageScreenshot } from './screenshot/index'
// 会话产物大卡片：assistant 消息 actions 行的归档盒按钮（截图旁）→ 本会话产物清单+预览。
import { applyMessageDeliverables } from './message-deliverables/index'
// 会话产物大卡片已下线：文件浏览器统一弹窗（历史 + 页内编辑）覆盖其全部能力。
// host 端 /api/webui-deliverables 记账与路由保留——产物 chip 点击预览、
// workspace 外产物的读取授权仍依赖它；卡片本体（message-deliverables/）留档不挂载。
// 移动端响应式：手机断点识别 + DSH 设置面板单列化等全局覆盖。
import { injectResponsiveStyles } from './responsive'
// 壳子窗口控制按钮共存：详情面板头部为右上角「最小化/最大化/关闭」让位。
import { injectShellTitlebarStyles } from './shell-titlebar'
// 技能 slash 源（替代内核 ui-skill）：输入 / 先选集合再选技能 + 技能工具行。
import { apply as applySkillSource } from './skill-source'
// 提示词优化：对话框供应商左侧的「自动优化提示词」图标（用选中模型优化草稿）。
import { applyPromptOptimize } from './prompt-optimize'
// 一键继续：中断态下发送键/Enter 自动代填继续文字（服务重启 / API 超时恢复）。
import { applyContinueBtn } from './continue-btn'
// 左侧悬浮侧边栏：热区悬停展开/移出折叠（overlay）+「启动服务时默认折叠」设置行。
import { applySidebarFloat } from './sidebar-float'
import { applySidebarFloatSetting } from './sidebar-float-row'
// 外观主题：玻璃质感（Glassmorphism）——启动恢复 + 通用设置里的外观开关行。
import { bootGlass, retractGlass } from './glass'
import { registerGlassSetting } from './glass-row'
// 自动化：侧边栏导航行 + 任务计划面板（openhanako 式 cron/at/every）+ 完成通知。
import { applyAutomation } from './automation'
// 团队编排：侧边栏「团队」面板 + 对话框团队开关 + 对话流执行 HUD。
import { applyTeamClient } from './team'
// 会话切换柔和过渡：内容区淡入浮入 + 侧边栏行选中底色平滑渐变。
import { applySessionSwitchMotion } from './session-motion'
// 会话置顶：置顶排序 + 行内归档按钮（替代三个点）+ 右键菜单（置顶/重命名/分叉/归档）。
import { applySessionPin } from './session-pin'
// 工作区临时垃圾清理：通用分区行卡片（自动清理计划 / 预览 / 立即清理）。
import { apply as registerTmpCleanerCard } from './tmp-cleaner-card'
const CUSTOM_COMPONENT_SCOPE = 'dsh-better-markdown'

export const inject = ['slots', 'settingsScope', 'connection', 'conversationEvents', 'locale', 'remote', 'sessions', 'workspaces', 'inputTriggers', 'layout', 'theme']

export function apply(ctx: ClientContext): void {
  // ---- 功能模块开关：同步读缓存立即裁剪；后台校正缓存，下次刷新对齐服务端 ----
  const moduleOverrides = readStoredModules()
  const on = (key: WebuiModuleKey): boolean => isModuleEnabled(moduleOverrides, key)
  syncServerModules()

  // ---- 移动端响应式：全局覆盖样式（DSH 设置面板单列化等），随插件生命周期清理 ----
  ctx.effect(() => injectResponsiveStyles(), 'webui: responsive styles')

  // ---- 壳子标题栏共存：详情面板头部为右上角窗口按钮让位（同一行对齐）----
  ctx.effect(() => injectShellTitlebarStyles(), 'webui: shell titlebar styles')

  // ---- 我发送的对话宽度：启动即注入覆盖样式并恢复上次宽度（刷新后生效）----
  if (on('messageWidth')) applyMessageWidthClient(ctx)

  // ---- 原生 webui：右上角「对话/轨迹」图块 + 消息入口 --------------------
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'webui',
      order: 10,
    }, Webui))

  // 供应商标签：等 modelDirectories 服务（ui-model-selection 提供）就绪后再注册。
  ctx.inject(['slots', 'modelDirectories'], (scope) => {
    const models = scope.modelDirectories
    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right',
      id: 'webui-provider',
      order: 10,
      inject: (sessionId: SessionId): ProviderBadgeInjected => {
        const directory = models.directoryFor(sessionId)
        return { directory: directory.store }
      },
    }, ProviderBadge))
  })

  // ---- 模型选择增强：接管模型座位（纯模型弹出）+ 推理等级滑动弹出 ----------
  if (on('modelSeats')) applyModelSeats(ctx)

  // ---- dsh-tool-summary：工具调用聚合 + 活动抽屉 -------------------------
  if (on('toolSummary')) {
    injectToolSummaryStyles()
    mountActivityDrawer()
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'tool-call',
      priority: -100,
      locale: 'conversation',
    }, ToolGroupNodeView))
  }

  // ---- 对话统计条 shadow：缓存命中率精确到小数点后两位 -------------------
  // 原生 ui-conversation 的 StatsLine 注册于 conversation.composer.dock / id=stats
  // （priority 默认 0）；同 id + 更低 priority 覆盖原生条目，仅改动命中率显示。
  if (on('chatStats')) {
    injectStatsStyles()
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'stats',
      order: 0,
      priority: -100,
      locale: 'conversation',
    }, StatsLineShadow))
  }

  // ---- 图表渲染：mermaid 围栏画成图（引擎按需从 host 拉，无图表零开销）----
  setDiagramEnabled(on('diagram'))
  if (on('diagram')) registerDiagramSetting(ctx)

  // ---- MOOD：```mood 围栏渲染成自述卡片 + 设置页（每个 Agent 的开关与人设）----
  setMoodEnabled(on('mood'))
  if (on('mood')) applyMoodSettings(ctx)

  // ---- dsh-better-markdown：markstream 渲染 + 思考 chip -------------------
  ctx.effect(() => {
    setCustomComponents(CUSTOM_COMPONENT_SCOPE, {
      code_block: DshCodeBlockNode,
      image: DshImageNode,
      inline_code: DshInlineCodeNode,
      link: DshLinkNode,
      // 回复正文里连续出现的生图结果图片（![]() 引用）聚合条：多张并排缩略图、
      // 单张小图、点击全屏 Lightbox（替代原先一张占满整行宽的大图）。
      image_strip: MarkdownImageStrip,
      // markstream 对 ```mermaid 围栏走**专用分支**（在查 code_block 自定义组件
      // 之前就命中），不注册这个 key 的话会落到它内置的 MermaidBlockNode ——
      // 那个组件静态 import 'mermaid'，被我们的构建 stub 掉，只会显示源码占位。
      // 按 key 覆盖后 mermaid 围栏才真正走 DiagramBlock（其余图种关键字如
      // flowchart / graph 走 code_block 分支，由 DshCodeBlockNode 内部分派）。
      ...on('diagram') ? { mermaid: DiagramBlock } : {},
    })
    return () => { removeCustomComponents(CUSTOM_COMPONENT_SCOPE) }
  }, 'webui: markstream component policy')

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    priority: -100,
    locale: 'conversation',
  }, BetterAssistantNodeView))

  // ---- dsh-web-search-anysearch：AnySearch 网页搜索设置卡片 ---------------
  if (on('webSearch')) registerAnySearchCard(ctx)

  // ---- dsh-mail：邮箱验证码设置卡片（紧随「外接网页搜索」之下）--------------
  if (on('mail')) registerMailCard(ctx)

  // ---- dsh-zh-thinking：设置页「中文思考」开关 ----------------------------
  if (on('zhThinking')) registerZhThinking(ctx)

  // ---- dsh-task-done-sound：提示音开关 + 回合结束上报 ---------------------
  if (on('doneSound')) registerTaskDoneSound(ctx)

  // ---- 语音播报：实时播报 + 总结播报（设置行 + 对话框开关 + 播报驱动）------
  if (on('voice')) applyVoiceClient(ctx)

  // ---- 对话完成胶囊：顶部居中胶囊 + 完成记录面板（含对话全文）--------------
  if (on('donePill')) applyDonePill(ctx)

  // ---- dsh-image-gallery：生图画廊（generate_image 结果渲染）----------------
  if (on('vision')) applyImageGallery(ctx)

  // ---- dsh-updater：基础设置页签（宽度/自启/版本/更新）--------------------
  if (on('updater')) registerUpdater(ctx)

  // ---- 插件更新：检测上游新版本 + 一键就地更新卡片 -------------------------
  if (on('pluginUpdate')) registerPluginUpdateCard(ctx)

  // ---- dsh-proxy：网络代理设置行 -----------------------------------------
  if (on('proxy')) registerProxy(ctx)

  // ---- 网关伪装接入：按域名改写 UA / 强制代理的规则卡（紧随网络代理之下）----
  if (on('gatewayRewrite')) registerGatewayRewrite(ctx)

  // ---- 供应商限流：按域名 RPM 令牌桶 + 并发信号量设置卡（紧随网关伪装之下）----
  if (on('providerThrottle')) registerProviderThrottleCard(ctx)

  // ---- dsh-browser：设置页「允许 AI 使用浏览器」开关 ---------------------
  if (on('browser')) applyBrowserClient(ctx)

  // ---- dsh-memory：侧边栏导航行记忆面板 + 注入开关 ------------------------
  if (on('memory')) applyMemoryClient(ctx)

  // ---- dsh-provider-hub：供应商设置页（对话 + 视觉 + 生图）---------------
  if (on('providerHub')) applyProviderHub(ctx)

  // ---- dsh-file-explorer：右上角文件浏览器（抽屉 + 树 + 编辑器）-----------
  if (on('fileExplorer')) applyFileExplorerClient(ctx)

  // ---- 工作区文档卡片：峰谷卡上方的 AGENTS.md / CLAUDE.md 卡片（点击复用 ----
  //      文件浏览器的应用内预览卡，两文件皆缺时提供 AGENTS.md 一键创建）。
  //      依赖 fileExplorer：预览宿主（FileExplorerEntry）由其装配，关闭后
  //      预览事件无人接听，本卡片随之隐藏。
  if (on('workspaceDocs') && on('fileExplorer')) applyWorkspaceDocs(ctx)

  // ---- 工作区目录选择器：自写弹窗（添加工作区选文件夹，shadow 官方 native）---
  if (on('dirPicker')) applyWorkspaceDirPickerClient(ctx)

  // ---- 工作区临时垃圾清理：通用分区行卡片（tmpCleaner host 模块联动）-------
  if (on('tmpCleaner')) registerTmpCleanerCard(ctx)

  // ---- 用量工作台 + 技能面板（自 dsh-usage-skill 融合）：侧边栏导航行入口 ----
  if (on('usage')) applyUsageEntries(ctx)

  // ---- DeepSeek 峰谷时刻卡片（footer 首行）---------------------------------
  if (on('peakValley')) applyPeakValley(ctx)

  // ---- 审批提醒：有工具调用等待审批时顶部弹 toast ---------------------------
  if (on('approvalNotify')) applyApprovalNotifier(ctx)

  // ---- 对话「退回」：user 消息退回按钮（文件回退 + fork 上下文）--------------
  if (on('rewind')) applyRewindClient(ctx)

  // ---- 对话输入框 Ctrl+Enter 换行 -------------------------------------------
  if (on('ctrlEnter')) applyCtrlEnterNewline()

  // ---- 对话截图：assistant 消息 actions 行相机按钮 → 截图面板 ---------------
  if (on('screenshot')) applyMessageScreenshot(ctx)

  // ---- 会话产物大卡片：assistant 操作栏归档盒按钮 → 本会话产物清单+预览 -----
  if (on('deliverables')) applyMessageDeliverables(ctx)

  // ---- 技能 slash 源（替代内核 ui-skill）：输入 / 先选集合再选技能 ----------
  if (on('skills')) applySkillSource(ctx)

  // ---- 提示词优化：供应商左侧图标，点击后用选中模型优化草稿 ---------------
  if (on('promptOptimize')) applyPromptOptimize(ctx)

  // ---- 一键继续：中断态下点发送键/按 Enter 自动代填继续文字恢复任务 -------
  if (on('continueBtn')) applyContinueBtn(ctx)

  // ---- 左侧悬浮侧边栏：热区悬停展开/移出折叠 + 默认态设置 ----------------
  if (on('sidebarFloat')) {
    applySidebarFloatSetting(ctx)
    ctx.effect(() => applySidebarFloat(ctx), 'webui: sidebar float')
  }

  // ---- 外观主题：玻璃质感（Glassmorphism）--------------------------------
  // 启动即按持久化状态恢复（localStorage 同步 + 服务端校正）；插件卸载时
  // 仅撤销视觉效果，不触碰持久化值。设置行注册进「通用」分区外观区域。
  if (on('appearance')) {
    registerGlassSetting(ctx)
    ctx.effect(() => {
      bootGlass(ctx.theme)
      return () => { retractGlass(ctx.theme) }
    }, 'webui: glass appearance')
  }

  // ---- 会话切换柔和过渡：内容区淡入浮入 + 侧边栏行底色平滑 ----------------
  if (on('sessionMotion')) ctx.effect(() => applySessionSwitchMotion(), 'webui: session switch motion')

  // ---- 会话置顶：置顶排序 + 行内归档按钮 + 右键菜单 -------------------------
  if (on('sessionPin')) applySessionPin(ctx)

  // ---- 自动化（openhanako 式）：侧边栏入口 + 任务计划面板 + 完成通知 --------
  if (on('automation')) applyAutomation(ctx)

  // ---- 团队编排：侧边栏「团队」面板 + 对话框团队开关 + 对话流执行 HUD --------
  if (on('team')) applyTeamClient(ctx)
}
