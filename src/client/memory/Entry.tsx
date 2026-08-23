/**
 * dsh-memory 侧边栏导航行入口（「自动化」菜单下方，sidebar-nav memory 槽位）：
 * 图标用「大脑/记忆」线性 SVG（无 emoji），rail 态只留图标；右上角 badge 显示
 * 当日未读变更数。面板卡片以按钮为锚点从右侧滑出（automation 同款 popover）；
 * 有未读变更时打开直达「变更」Tab。
 */

import { useMemo, useState } from 'react'
import { createMemoryApi, type MemoryApi } from './api.js'
import { MemoryPanel, BrainIcon, type MemoryTab } from './Panel.tsx'
import { useUnreadChanges } from './Notify.tsx'
import { makeT } from './locales.js'
import { ensureNavStyles, NavButton, NavPortal, useRail } from '../sidebar-nav.js'
import { ensureModalAnimStyles, useModalClose } from '../modal-animation.js'
import { ensureShellStyles, type PopoverAnchor } from '../popover-shell.js'
import { ensureStyles } from './styles.js'

/**
 * 渲染记忆导航行与面板（自足组件：内部自建 API 与翻译，不依赖 slot 注入面）。
 */
export function MemoryNavApp(): JSX.Element | null {
  ensureStyles()
  ensureNavStyles()
  ensureModalAnimStyles()
  ensureShellStyles()
  const api = useMemo<MemoryApi>(createMemoryApi, [])
  const t = useMemo(makeT, [])
  const rail = useRail()
  const unread = useUnreadChanges(api)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)
  const [initialTab, setInitialTab] = useState<MemoryTab>('all')
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })

  const openPanel = (tab: MemoryTab): void => {
    setInitialTab(tab)
    setOpen(true)
    if (tab === 'changes') unread.markRead()
  }

  return (
    <NavPortal name="memory">
      <NavButton
        icon={<BrainIcon size={rail ? 18 : 16} />}
        label={t('entry')}
        rail={rail}
        expanded={open}
        badge={unread.count}
        badgeTitle={t('unreadChanges', { n: unread.count })}
        onClick={e => {
          e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()
          setAnchor({ left: rect.right + 8, top: rect.top - 6 })
          openPanel(unread.count > 0 ? 'changes' : 'all')
        }}
      />
      <MemoryPanel
        open={open}
        closing={closing}
        onClose={requestClose}
        initialTab={initialTab}
        anchor={anchor}
        t={t}
        list={api.list}
        projects={api.projects}
        tags={api.tags}
        changes={api.changes}
        summary={api.summary}
        pin={api.pin}
        update={api.update}
        move={api.move}
        deleteEntry={api.deleteEntry}
        deleteProject={api.deleteProject}
        meta={api.meta}
        remember={api.remember}
        getInjectState={api.getInjectState}
        setInjectState={api.setInjectState}
        consolidate={api.consolidate}
        revisions={api.revisions}
        rollback={api.rollback}
        getConfig={api.getConfig}
        setConfig={api.setConfig}
      />
    </NavPortal>
  )
}
