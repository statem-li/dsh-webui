/**
 * 工作区目录选择器 client 半身：以自写弹窗填充 ui-workspace 的两个
 * directory-flow 插槽（conversation.hero.workspace.directoryFlow /
 * sidebar.workspaces.directoryFlow），数据走 /api/webui-dir-picker 路由。
 *
 * 与官方 native/browse 占用者的关系：官方 web-app 默认挂载 directory-picker
 * （win32 解析为 native surface，priority 0），这里以 priority -100 注册
 * （single 插槽不同 priority 共存，lowest renders），shadow 掉官方表面，
 * 把「添加工作区」的目录选择改为本插件的自写应用内弹窗。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-workspace 的 SlotMap 合并声明（directory-flow 插槽）。
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { DirPickerInjected } from './DirectoryPickerModal.tsx'
import { WorkspaceDirPickerFlow } from './DirectoryPickerModal.tsx'
import { createDirectory, listDirectory } from './api.ts'
import { injectDirPickerStyles } from './styles.ts'

/** 低于官方 surface（priority 0）的 shadow 优先级。 */
const SHADOW_PRIORITY = -100

/** 注入面工厂：绑定本插件的目录浏览 wire 调用。 */
const injected = (): DirPickerInjected => ({
  listDirectory: (path) => listDirectory(path),
  createDirectory: (path, name) => createDirectory(path, name).then(result => result.path),
})

/** 注册自写弹窗到两个 directory-flow 插槽（webui 组合调用）。 */
export function applyWorkspaceDirPickerClient(ctx: ClientContext): void {
  // 弹窗样式随插件生命周期注入/移除。
  ctx.effect(() => injectDirPickerStyles(), 'webui: workspace dir-picker styles')

  // 两个插槽的声明生命周期必须同时存活才安装占用者；生成器让两次注册
  // 成为同一个事务性 effect（照官方 ui-directory-picker-browse 结构）。
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow',
        priority: SHADOW_PRIORITY,
        inject: injected,
      }, WorkspaceDirPickerFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow',
        priority: SHADOW_PRIORITY,
        inject: injected,
      }, WorkspaceDirPickerFlow)
    }))
}
