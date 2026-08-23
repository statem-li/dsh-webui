/**
 * 工作区文件浏览器 client 半身（自 dsh-file-explorer 合并）：在 shell 的全框
 * overlay 层注册右上角浮动图标，点击开合文件抽屉（工作区切换 + 懒加载树 +
 * CodeMirror 编辑器）。数据走 host 的 /api/file-explorer 路由（loopback HTTP）。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: 拉入 shell.overlay 的 SlotMap 声明（ui-layout 提供）。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { installDeliverableTap } from './deliverable-tap.ts'
import { FileExplorerEntry } from './FileExplorerEntry.tsx'
import { en, NS, zh, type FileExplorerLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The file-explorer overlay entry and panel copy. */
    fileExplorer: FileExplorerLocaleKey
  }
}

/** 注册右上角文件图标入口（webui 组合调用）。 */
export function applyFileExplorerClient(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'webui: file-explorer dictionaries')

  // 产物 chip 与正文文件提及：点击改为应用内滑出预览卡（图片渲染、
  // markdown/代码预览），拦截官方 openFile 的系统方式打开。
  ctx.effect(() => installDeliverableTap(), 'webui: deliverable in-app preview tap')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'file-explorer',
    order: 0,
    locale: NS,
  }, FileExplorerEntry))
}
