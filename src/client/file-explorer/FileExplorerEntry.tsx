/**
 * dsh-file-explorer — 文件抽屉宿主（挂载在 shell.overlay 层，不改 DSH 源码）。
 *
 * 原右上角浮动图标入口已移除：文件抽屉的唯一入口是对话完成胶囊右侧的
 * 「文件」按钮（经 FILE_EXPLORER_TOGGLE_EVENT 窗口事件开合本组件持有的抽屉）。
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { FileExplorerDrawer } from './FileExplorerDrawer.tsx'
import { ensureStyles } from './styles.ts'

export type FileExplorerEntryProps = PropsRuntime<'shell.overlay'> & PropsLocale<'fileExplorer'>

/** 胶囊内嵌「文件」按钮经此窗口事件开合同一个抽屉（done-pill dispatch）。 */
export const FILE_EXPLORER_TOGGLE_EVENT = 'dsh-file-explorer-toggle'

/** 无自有 UI：只承载抽屉与外部开关事件。 */
export function FileExplorerEntry({ t, useSessions }: FileExplorerEntryProps): JSX.Element {
  ensureStyles()
  const [open, setOpen] = useState(false)

  // 外部入口（对话完成胶囊右侧的文件按钮）请求开合抽屉。
  useEffect(() => {
    const onToggle = (): void => { setOpen(value => !value) }
    window.addEventListener(FILE_EXPLORER_TOGGLE_EVENT, onToggle)
    return () => { window.removeEventListener(FILE_EXPLORER_TOGGLE_EVENT, onToggle) }
  }, [])

  // 当前会话的工作区根（cwd），用于文件浏览器自动跟随所选对话。
  const currentCwd = useSessions(state => {
    const id = state.current
    return id === undefined ? undefined : state.byId[id]?.cwd
  })

  return (
    <FileExplorerDrawer open={open} currentCwd={currentCwd} onClose={() => { setOpen(false) }} t={t} />
  )
}
