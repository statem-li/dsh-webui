/**
 * @dsh-external/dsh-browser — client 半身：设置页浏览器开关。
 *
 * 槽位：settings.general.item（设置 → 基础设置页条目）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-settings 的 SlotMap 合并声明（槽位注册的类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { BrowserAllowSetting } from './BrowserAllowDock'

export function applyBrowserClient(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-browser',
      order: 30,
      label: () => 'dsh-browser',
    }, BrowserAllowSetting),
  ), '@dsh-external/dsh-browser: allow setting')
}
