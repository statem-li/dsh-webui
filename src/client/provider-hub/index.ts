/**
 * @dsh-external/webui — provider-hub 模块：供应商设置页（合并自 @dsh-external/dsh-provider-hub）。
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
  }, '@dsh-external/webui: provider-hub styles + hide official models')

  ctx.effect(() => {
    const connection = ctx.get('connection') as ConnectionHandle
    const controller = new ModelsSettingsStore(connection.api)
    const injected = (): ProviderHubInjected => ({ controller, api: connection.api })

    // 推送失效收敛：settings / credentials / provider 拓扑变化都重拉快照。
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { void controller.load() }),
      ctx.remote.$on('credentials/updated', () => { void controller.load() }),
      ctx.remote.$on('llm/adapters-updated', () => { void controller.load() }),
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
  }, '@dsh-external/webui: provider section')
}
