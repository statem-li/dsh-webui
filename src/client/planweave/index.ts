/**
 * webui — PlanWeave client 半身：侧边栏导航行入口（planweave 槽位，
 * 记忆入口下方）。全部数据走 host 的 /api/planweave/*（纯 fetch）。
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PlanWeaveNavApp } from './Panel.js'
import { ensureNavMount } from '../sidebar-nav.js'

/** 挂载侧边栏导航行入口（DOM 注入 + portal，与 usage/memory 同一 host）。 */
export function applyPlanweaveClient(ctx: ClientContext): void {
  ctx.effect(() => {
    ensureNavMount()
    const holder = document.createElement('div')
    const root = createRoot(holder)
    root.render(createElement(PlanWeaveNavApp))
    return () => { root.unmount() }
  }, 'dsh-planweave: nav entry')
}
