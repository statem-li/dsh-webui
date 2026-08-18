/**
 * dsh-file-explorer — 右上角浮动图标入口（挂载在 shell.overlay 层，不改 DSH 源码），
 * 点击开合文件抽屉。
 */

import { useState } from 'react'
import { IconFolderOpenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { FileExplorerDrawer } from './FileExplorerDrawer.tsx'
import { css, ensureStyles } from './styles.ts'

export type FileExplorerEntryProps = PropsLocale<'fileExplorer'>

export function FileExplorerEntry({ t }: FileExplorerEntryProps): JSX.Element {
  ensureStyles()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Tooltip label={t('entry')} side="bottom" delayMs={500}>
        <button
          type="button"
          className={css.entryIcon}
          aria-label={t('entry')}
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconFolderOpenOutline16 size={16} />
        </button>
      </Tooltip>
      <FileExplorerDrawer open={open} onClose={() => { setOpen(false) }} t={t} />
    </>
  )
}
