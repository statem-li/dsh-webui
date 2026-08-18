/**
 * dsh-memory browser half：注册侧边栏 footer 动作（sidebar.footer.action，
 * 记忆入口）与 composer 输入框左端的记忆注入开关（conversation.input.left）。
 * 全部数据走 host 的 /api/dsh-memory/* HTTP 路由（纯 fetch——无 typert、无 DSH 源码改动）。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MemoryEntry } from './Entry.js'
import { MemoryToggle } from './Toggle.js'
import { createMemoryApi, type MemoryApi } from './api.js'
import { en, NS, zh, type MemoryLocaleKey } from './locales.js'

export type { MemoryEntryProps } from './Entry.js'
export type { MemoryPanelProps, MemoryTab } from './Panel.js'
export type { MemoryToggleProps } from './Toggle.js'
export type { MemoryLocaleKey } from './locales.js'
export type { MemoryApi, MemoryEntryView, ProjectView, ChangeView } from './api.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dsh-memory sidebar entry and panel copy. */
    dshMemory: MemoryLocaleKey
  }
}

/** Services required by the footer registration. */

/** Contribute the footer entry wired to the dsh-memory HTTP API. */
export function applyMemoryClient(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-memory: dictionaries')

  const panelInjected = (): MemoryApi => createMemoryApi()

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-memory',
    // usage-skill 合并了「用量+技能」（order 10，占满整行）；记忆放其后（11）
    // 并在 styles.ts 中让 usg_layer 收缩到 50%，使「技能」右侧紧邻完整显示的记忆按钮。
    order: 11,
    locale: NS,
    inject: panelInjected,
  }, MemoryEntry))

  // 记忆注入开关：composer 输入框工具行左端（resident chrome 之后，小常驻控件）。
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'dsh-memory-inject-toggle',
    order: 100,
    locale: NS,
    inject: panelInjected,
  }, MemoryToggle))
}
