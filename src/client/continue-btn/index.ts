/**
 * webui — 一键继续入口（client 半身，发送键融合版）。
 *
 * 两处注册、零新增可见控件：
 *
 *  1. `conversation.input.right`（order 15）：渲染 null 的哨兵组件
 *     ComposerContinueEnhancer——借会话槽位拿到实时快照与 inputActions，
 *     在 document 捕获层把「继续」融进官方主发送按钮：中断态（服务重启 /
 *     API 超时导致 lastAgentError / partial 残留且回合空闲）下草稿为空时，
 *     点发送键或按 Enter 即自动代填继续文字并发送；同时给发送键注入蓝色
 *     呼吸光圈提醒。「不在对话中显示」开启时附加零宽标记并在渲染层隐藏该
 *     user 消息。
 *  2. `settings.general.item`（order 36）：通用分区设置行——继续文字 +
 *     「对话中不显示这条消息」开关（localStorage 即时生效）。
 *
 * 纯 client 功能：不新增 host 半身、不加 HTTP API、不模拟键盘 DOM。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation 的 SlotMap 合并声明（input.right 槽位契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ComposerContinueEnhancer } from './ContinueButton'
import { ContinueSettingsRow } from './SettingsRow'

/**
 * 挂载一键继续（发送键融合）+ 设置行。
 * @param ctx - client root context。
 */
export function applyContinueBtn(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'webui-continue-btn',
    // 供应商标签 order 10、模型座位 order 20；哨兵 order 15 不渲染任何 UI。
    order: 15,
  }, ComposerContinueEnhancer))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'webui-continue-settings',
    // 玻璃质感 11、完成胶囊组 31–35、中文思考 40；本行 36 紧随其后。
    order: 36,
    label: '一键继续',
  }, ContinueSettingsRow))
}
