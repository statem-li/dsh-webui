/**
 * 审批提醒 client 注册：shell.overlay（root scope，常驻挂载），
 * 监听各会话的待审批状态，有审批时顶部弹 toast 提醒。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ApprovalNotifier } from './ApprovalNotifier.tsx'

export function applyApprovalNotifier(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'approval-notifier',
    order: 100,
  }, ApprovalNotifier))
}
