/**
 * 工作区文档卡片 —— client 注册：sidebar.footer.action（order -1，位于峰谷
 * 时刻卡片 order 0 之前，即其上方）。检测当前会话工作区根的 AGENTS.md /
 * CLAUDE.md 并逐文件出卡，点击复用文件浏览器的应用内预览卡；两文件皆缺时
 * 提供 AGENTS.md 一键创建占位卡。数据全部走既有 /api/file-explorer 路由。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { WorkspaceDocsCards } from './WorkspaceDocsCards'
import { ensureStyles } from './styles'

export function applyWorkspaceDocs(ctx: ClientContext): void {
  ensureStyles()
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'workspace-docs-cards',
      order: -1,
    }, WorkspaceDocsCards))
}
