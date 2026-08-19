/**
 * dsh-memory 侧边栏入口：sidebar.footer.action 插槽（order 6，紧邻技能右侧）。
 * 图标用「大脑/记忆」线性 SVG（无 emoji），wide 时显示文字；右上角 badge 显示当日未读变更数。
 */

import { useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryApi } from './api.js'
import { MemoryPanel, BrainIcon, type MemoryTab } from './Panel.tsx'
import { useUnreadChanges } from './Notify.tsx'
import { css, ensureStyles } from './styles.js'
import { ensureModalAnimStyles, useModalClose } from '../modal-animation.js'

/** 完整入口 props：footer 所有者共享部分 + 注入 API 面 + locale。 */
export type MemoryEntryProps =
  { wide: boolean }
  & InjectFace<MemoryApi>
  & PropsLocale<'dshMemory'>

/** 渲染记忆入口与面板。 */
export function MemoryEntry({ wide, t, ...panel }: MemoryEntryProps): JSX.Element {
  ensureStyles()
  ensureModalAnimStyles()
  const [open, setOpen] = useState(false)
  const [initialTab, setInitialTab] = useState<MemoryTab>('all')
  const unread = useUnreadChanges(panel)
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })

  const openPanel = (tab: MemoryTab): void => {
    setInitialTab(tab)
    setOpen(true)
    if (tab === 'changes') unread.markRead()
  }

  return (
    <>
      <Tooltip label={t('entry')} side="right" delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.entry}
          aria-label={t('entry')}
          aria-expanded={open}
          onClick={() => { openPanel(unread.count > 0 ? 'changes' : 'all') }}
        >
          <BrainIcon size={16} />
          {wide && <span className={css.label}>{t('entry')}</span>}
          {unread.count > 0 && (
            <span className={css.entryBadge} title={t('unreadChanges', { n: unread.count })}>
              {unread.count > 99 ? '99+' : unread.count}
            </span>
          )}
        </button>
      </Tooltip>
      <MemoryPanel
        open={open}
        closing={closing}
        onClose={requestClose}
        initialTab={initialTab}
        t={t}
        list={panel.list}
        projects={panel.projects}
        tags={panel.tags}
        changes={panel.changes}
        summary={panel.summary}
        pin={panel.pin}
        update={panel.update}
        move={panel.move}
        deleteEntry={panel.deleteEntry}
        deleteProject={panel.deleteProject}
        meta={panel.meta}
        remember={panel.remember}
        getInjectState={panel.getInjectState}
        setInjectState={panel.setInjectState}
      />
    </>
  )
}
