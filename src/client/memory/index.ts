/**
 * dsh-memory browser half：侧边栏导航行入口（sidebar-nav memory 槽位，
 * 「自动化」菜单下方）与 composer 输入框左端的记忆注入开关
 * （conversation.input.left）。全部数据走 host 的 /api/dsh-memory/*
 * HTTP 路由（纯 fetch——无 typert、无 DSH 源码改动）。
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MemoryNavApp } from './Entry.js'
import { MemoryToggle } from './Toggle.js'
import { createMemoryApi, type MemoryApi } from './api.js'
import { en, NS, zh, type MemoryLocaleKey } from './locales.js'
import { ensureNavMount } from '../sidebar-nav.js'

export type { MemoryToggleProps } from './Toggle.js'
export type { MemoryPanelProps, MemoryTab } from './Panel.js'
export type { MemoryLocaleKey } from './locales.js'
export type { MemoryApi, MemoryEntryView, MemoryKind, ProjectView, ChangeView } from './api.js'

export { changeActionLabel } from './Panel.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dsh-memory sidebar entry and panel copy. */
    dshMemory: MemoryLocaleKey
  }
}

/** Contribute the nav-row entry wired to the dsh-memory HTTP API. */
export function applyMemoryClient(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-memory: dictionaries')

  // 导航行入口：DOM 注入 + portal（与 usage/skills 入口同一 host、固定槽位顺序）。
  ctx.effect(() => {
    ensureNavMount()
    const holder = document.createElement('div')
    const root = createRoot(holder)
    root.render(createElement(MemoryNavApp))
    return () => { root.unmount() }
  }, 'dsh-memory: nav entry')

  // 记忆注入开关：composer 输入框工具行左端（resident chrome 之后，浏览器开关之前）。
  const panelInjected = (): MemoryApi => createMemoryApi()

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'dsh-memory-inject-toggle',
    order: 99,
    locale: NS,
    inject: panelInjected,
  }, MemoryToggle))
}
