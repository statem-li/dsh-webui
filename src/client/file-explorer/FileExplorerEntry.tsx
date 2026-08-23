/**
 * dsh-file-explorer — 文件抽屉宿主（挂载在 shell.overlay 层，不改 DSH 源码）。
 *
 * 原右上角浮动图标入口已移除：文件抽屉的唯一入口是对话完成胶囊右侧的
 * 「文件」按钮（经 FILE_EXPLORER_TOGGLE_EVENT 窗口事件开合本组件持有的抽屉）。
 * 另承载应用内文件预览卡（产物 chip / 正文文件提及点击，经
 * PREVIEW_FILE_EVENT 请求）：独立于抽屉开合，抽屉没开也能滑出卡片。
 * 产物大卡片的「用文件浏览器打开」经 FILE_EXPLORER_OPEN_PATH_EVENT 开抽屉
 * 并直接弹出该文件的查看卡。
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { FileEditorModal } from './FileEditorModal.tsx'
import { FileExplorerDrawer } from './FileExplorerDrawer.tsx'
import { PREVIEW_FILE_EVENT } from './preview-bus.ts'
import { ensureStyles } from './styles.ts'

export type FileExplorerEntryProps = PropsRuntime<'shell.overlay'> & PropsLocale<'fileExplorer'>

/** 胶囊内嵌「文件」按钮经此窗口事件开合同一个抽屉（done-pill dispatch）。 */
export const FILE_EXPLORER_TOGGLE_EVENT = 'dsh-file-explorer-toggle'

/** 请求用文件浏览器打开某文件：开抽屉并直接弹出该文件的查看卡。 */
export const FILE_EXPLORER_OPEN_PATH_EVENT = 'dsh-file-explorer-open-path'

/** 无自有 UI：只承载抽屉、预览卡与外部开关事件。 */
export function FileExplorerEntry({ t, useSessions }: FileExplorerEntryProps): JSX.Element {
  ensureStyles()
  const [open, setOpen] = useState(false)
  // 应用内预览卡的当前文件；null 即关闭。与抽屉内的编辑弹窗互不相干。
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  // 抽屉的「打开指定文件」种子：每次事件都换新对象引用以触发 Drawer 副作用。
  const [drawerSeed, setDrawerSeed] = useState<{ path: string } | null>(null)

  // 外部入口（对话完成胶囊的文件按钮）请求开合抽屉；
  // deliverable-tap 拦截产物 chip / 文件提及点击后请求应用内预览；
  // 产物大卡片请求「用文件浏览器打开」某文件。
  useEffect(() => {
    const onToggle = (): void => { setOpen(value => !value) }
    const onPreview = (event: Event): void => {
      const path = (event as CustomEvent).detail
      if (typeof path === 'string' && path !== '') setPreviewPath(path)
    }
    const onOpenPath = (event: Event): void => {
      const detail = (event as CustomEvent).detail
      const path = typeof detail === 'string' ? detail : (detail as { path?: unknown })?.path
      if (typeof path === 'string' && path !== '') {
        setOpen(true)
        setDrawerSeed({ path })
      }
    }
    window.addEventListener(FILE_EXPLORER_TOGGLE_EVENT, onToggle)
    window.addEventListener(PREVIEW_FILE_EVENT, onPreview)
    window.addEventListener(FILE_EXPLORER_OPEN_PATH_EVENT, onOpenPath)
    return () => {
      window.removeEventListener(FILE_EXPLORER_TOGGLE_EVENT, onToggle)
      window.removeEventListener(PREVIEW_FILE_EVENT, onPreview)
      window.removeEventListener(FILE_EXPLORER_OPEN_PATH_EVENT, onOpenPath)
    }
  }, [])

  // 当前会话的工作区根（cwd），用于文件浏览器自动跟随所选对话；
  // 会话 id 供「修改历史」定位该会话的快照。
  const currentCwd = useSessions(state => {
    const id = state.current
    return id === undefined ? undefined : state.byId[id]?.cwd
  })
  const currentSessionId = useSessions(state => state.current)

  return (
    <>
      <FileExplorerDrawer
        open={open}
        currentCwd={currentCwd}
        sessionId={currentSessionId}
        openSeed={drawerSeed}
        onClose={() => { setOpen(false) }}
        t={t}
      />
      <FileEditorModal
        open={previewPath !== null}
        path={previewPath ?? ''}
        sessionId={currentSessionId}
        onClose={() => { setPreviewPath(null) }}
        t={t}
      />
    </>
  )
}
