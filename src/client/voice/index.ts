/**
 * webui — 语音播报入口（client 半身）。
 *
 * 三处注册：
 *  1. settings.general.item（order 37）：通用分区「语音播报」设置行
 *     （总开关 + 引擎/音色/语速/音量 + 实时/总结 + 试听/停止）。
 *  2. conversation.input.left（order 102）：对话框内「本会话播报」开关
 *     （ChatToggle，仅影响当前会话），紧贴「AI 浏览器」图标右侧。
 *  3. conversation.input.right（order 12）：渲染 null 的播报驱动哨兵
 *     （VoiceAnnouncer，实时增量分句 + 回合结束总结）。
 *
 * 启动时拉一次全局配置缓存（store.cacheGlobal），让 announcer 不依赖设置页
 * 是否被访问过。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（input.left / settings.general.item 槽位契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { VoiceSettingsRow } from './SettingsRow'
import { VoiceToggle, type VoiceToggleInjected } from './ChatToggle'
import { VoiceAnnouncer } from './announcer'
import { fetchVoice } from './api'
import { cacheGlobal } from './store'

/** 挂载语音播报（设置行 + 对话框开关 + 播报驱动）。 */
export function applyVoiceClient(ctx: ClientContext): void {
  // 启动即缓存全局开关（announcer 高频读，不依赖设置页被打开过）。
  void fetchVoice().then((state) => {
    if (state !== null) {
      cacheGlobal({ enabled: state.config.enabled, live: state.config.live, summary: state.config.summary })
    }
  })

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'webui-voice-settings',
    // 一键继续 36、中文思考 40；本行 37 紧随其后。
    order: 37,
    label: '语音播报',
  }, VoiceSettingsRow))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'webui-voice-toggle',
    // AI 浏览器按钮 order 101（input.left 左端）；本开关 order 102 紧贴其右侧。
    order: 102,
    inject: (sessionId: SessionId): VoiceToggleInjected => ({ sessionId }),
  }, VoiceToggle))

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'webui-voice-announcer',
    // 供应商标签 order 10 之后；渲染 null，不占布局。owner 共享（InputZone.session）
    // 自动提供会话快照，无需 inject。
    order: 12,
  }, VoiceAnnouncer))
}
