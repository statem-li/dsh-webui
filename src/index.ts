/**
 * webui — 会话 Web UI 插件（host 半身）。
 *
 * 全部行为在 client bundle（dsh.client 声明）里：右上角「对话/轨迹」图块
 * 视图切换 + 「消息」按钮 + 右侧消息横条。host 半身仅作为 loader 可挂载的
 * 插件包存在——client-modules 节点侧靠它发现并装配 client bundle。
 */
import type { Context } from 'cordis'

export const name = 'webui'
export const inject: string[] = []

export function apply(_ctx: Context): void {
  // 无 host 行为：UI 全部在 client 半身（见 src/client/）。
}
