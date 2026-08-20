/**
 * webui — client 半身（合并了 dsh-tool-summary 与 dsh-better-markdown）：
 *
 *  1. 会话头部右上角视图图块 + 消息入口 + 供应商标签（原生 webui 能力）。
 *  2. 工具调用聚合（tool-call shadow + 活动抽屉）。
 *  3. 助手 Markdown 渲染（markstream-react）+ 思考 chip（实时时长 / 实时文字滚动）。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 modelDirectories 服务的 Context 声明（ui-model-selection 提供）。
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（槽位注册的类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: 激活 ui-tool 的 SlotMap 合并（conversation.chat.node 的 tool-call key）。
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { removeCustomComponents, setCustomComponents } from 'markstream-react'
import 'markstream-react/index.css'
import './markdown/styles.css'
import { Webui } from './Webui'
import { ProviderBadge, type ProviderBadgeInjected } from './ProviderBadge'
// 模型选择增强：接管模型座位（纯模型弹出）+ 推理等级滑动式弹出。
import { applyModelSeats } from './model-selection'
// AnySearchCard：外接网页搜索设置卡（settings.plugin.item）。
import { registerAnySearchCard } from './AnySearchCard'
// MailCard：邮箱验证码设置卡（settings.plugin.item，紧随 AnySearchCard 之后）。
import { registerMailCard } from './mail/MailCard'
import { apply as registerZhThinking } from './zh-thinking'
import { apply as registerTaskDoneSound } from './task-done-sound'
import { apply as registerUpdater } from './updater'
import { apply as registerProxy } from './proxy'
import { applyBrowserClient } from './browser'
import { applyMemoryClient } from './memory'
import { applyImageGallery } from './image-gallery'
import { applyProviderHub } from './provider-hub'
import { applyFileExplorerClient } from './file-explorer'
import { applyWorkspaceDirPickerClient } from './workspace-dir-picker'
import { apply as applyUsageEntries } from './usage/entry'
import { applyPeakValley } from './peak-valley'
import { applyApprovalNotifier } from './approval-notify'
import {
  BetterAssistantNodeView, DshCodeBlockNode, DshImageNode, DshInlineCodeNode, DshLinkNode,
} from './markdown/renderer'
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
// 单条消息截图（樱花主题）：assistant 消息 actions 行的截图按钮。
import { applyMessageScreenshot } from './screenshot'
// 移动端响应式：手机断点识别 + DSH 设置面板单列化等全局覆盖。
import { injectResponsiveStyles } from './responsive'
// 技能 slash 源（替代内核 ui-skill）：输入 / 先选集合再选技能 + 技能工具行。
import { apply as applySkillSource } from './skill-source'
const CUSTOM_COMPONENT_SCOPE = 'dsh-better-markdown'

export const inject = ['slots', 'settingsScope', 'connection', 'conversationEvents', 'locale', 'remote', 'sessions', 'workspaces', 'inputTriggers']

export function apply(ctx: ClientContext): void {
  // ---- 移动端响应式：全局覆盖样式（DSH 设置面板单列化等），随插件生命周期清理 ----
  ctx.effect(() => injectResponsiveStyles(), 'webui: responsive styles')

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
  applyModelSeats(ctx)

  // ---- dsh-tool-summary：工具调用聚合 + 活动抽屉 -------------------------
  injectToolSummaryStyles()
  mountActivityDrawer()
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'tool-call',
    priority: -100,
    locale: 'conversation',
  }, ToolGroupNodeView))

  // ---- 对话统计条 shadow：缓存命中率精确到小数点后两位 -------------------
  // 原生 ui-conversation 的 StatsLine 注册于 conversation.composer.dock / id=stats
  // （priority 默认 0）；同 id + 更低 priority 覆盖原生条目，仅改动命中率显示。
  injectStatsStyles()
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'stats',
    order: 0,
    priority: -100,
    locale: 'conversation',
  }, StatsLineShadow))

  // ---- dsh-better-markdown：markstream 渲染 + 思考 chip -------------------
  ctx.effect(() => {
    setCustomComponents(CUSTOM_COMPONENT_SCOPE, {
      code_block: DshCodeBlockNode,
      image: DshImageNode,
      inline_code: DshInlineCodeNode,
      link: DshLinkNode,
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
  registerAnySearchCard(ctx)

  // ---- dsh-mail：邮箱验证码设置卡片（紧随「外接网页搜索」之下）--------------
  registerMailCard(ctx)

  // ---- dsh-zh-thinking：设置页「中文思考」开关 ----------------------------
  registerZhThinking(ctx)

  // ---- dsh-task-done-sound：提示音开关 + 回合结束上报 ---------------------
  registerTaskDoneSound(ctx)

  // ---- dsh-image-gallery：生图画廊（generate_image 结果渲染）----------------
  applyImageGallery(ctx)

  // ---- dsh-updater：基础设置页签（宽度/自启/版本/更新）--------------------
  registerUpdater(ctx)

  // ---- dsh-proxy：网络代理设置行 -----------------------------------------
  registerProxy(ctx)

  // ---- dsh-browser：设置页「允许 AI 使用浏览器」开关 ---------------------
  applyBrowserClient(ctx)

  // ---- dsh-memory：侧边栏记忆面板 + 注入开关 ----------------------------
  applyMemoryClient(ctx)

  // ---- dsh-provider-hub：供应商设置页（对话 + 视觉 + 生图）---------------
  applyProviderHub(ctx)

  // ---- dsh-file-explorer：右上角文件浏览器（抽屉 + 树 + 编辑器）-----------
  applyFileExplorerClient(ctx)

  // ---- 工作区目录选择器：自写弹窗（添加工作区选文件夹，shadow 官方 native）---
  applyWorkspaceDirPickerClient(ctx)

  // ---- 用量工作台 + 技能面板（自 dsh-usage-skill 融合）：footer 独立入口 ---
  applyUsageEntries(ctx)

  // ---- DeepSeek 峰谷时刻卡片（footer 首行，位于用量/技能/记忆上方）--------
  applyPeakValley(ctx)

  // ---- 审批提醒：有工具调用等待审批时顶部弹 toast ---------------------------
  applyApprovalNotifier(ctx)

  // ---- 对话「退回」：user 消息退回按钮（文件回退 + fork 上下文）--------------
  applyRewindClient(ctx)

  // ---- 对话输入框 Ctrl+Enter 换行 -------------------------------------------
  applyCtrlEnterNewline()

  // ---- 单条消息截图（樱花主题）：assistant 消息 actions 行截图按钮 -----------
  applyMessageScreenshot(ctx)

  // ---- 技能 slash 源（替代内核 ui-skill）：输入 / 先选集合再选技能 ----------
  applySkillSource(ctx)
}
