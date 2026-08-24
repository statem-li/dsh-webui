/**
 * @dsh-external/dsh-webui — provider-hub 模块：供应商设置页（合并自 @dsh-external/dsh-provider-hub）。
 *
 * 槽位：settings.section（设置 → 供应商页）。统一管理对话供应商 + 辅助视觉 + 生图。
 * 同时隐藏官方「模型」导航项。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: 拉入 ui-settings 的 SlotMap 合并声明（settings.section 契约）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ProviderHubSection } from './ProviderHubSection'
import type { ProviderHubInjected } from './ProviderHubSection'
import { ModelsSettingsStore } from './chat/store'
import { injectStyles, hideOfficialModelsNav } from './styles'

export function applyProviderHub(ctx: ClientContext): void {
  ctx.effect(() => {
    const removeStyles = injectStyles()
    const stopHide = hideOfficialModelsNav()
    return () => { removeStyles(); stopHide() }
  }, '@dsh-external/dsh-webui: provider-hub styles + hide official models')

  ctx.effect(() => {
    const connection = ctx.get('connection') as ConnectionHandle
    const controller = new ModelsSettingsStore(connection.api)
    const injected = (): ProviderHubInjected => ({ controller, api: connection.api })

    // 推送失效收敛：settings / credentials / provider 拓扑变化都重拉快照。
    // 仅在页面已加载过（status 离开 idle）后才重拉：设置弹窗从未打开过的会话里，
    // 每个 settings/credentials 事件都会白跑 llm.providers + settings.describe +
    // credentials.describe 三次 wire 调用（对齐官方 refreshIfLoaded 语义）。
    const refresh = (): void => {
      if (controller.store.getSnapshot().status === 'idle') return
      void controller.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.remote.$on('credentials/reference-updated', refresh),
      ctx.remote.$on('llm/adapters-updated', refresh),
    ]

    const unregister = ctx.slots.inject('settings.section', () =>
      ctx.slots.register({
        name: 'settings.section',
        id: 'provider-hub',
        order: 10,
        label: '供应商',
        inject: injected,
      }, ProviderHubSection),
    )

    return () => {
      unregister?.()
      for (const dispose of disposers) dispose()
    }
  }, '@dsh-external/dsh-webui: provider section')
}
