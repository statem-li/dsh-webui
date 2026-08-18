/**
 * dsh-memory 侧边栏入口：sidebar.footer.action 插槽（order 6，紧邻技能右侧）。
 * 图标用「大脑/记忆」线性 SVG（无 emoji），wide 时显示文字；右上角 badge 显示当日未读变更数。
 */

import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryApi } from './api.js'
import { MemoryPanel, BrainIcon, type MemoryTab } from './Panel.tsx'
import { useUnreadChanges } from './Notify.tsx'
import { css, ensureStyles } from './styles.js'

/** 完整入口 props：footer 所有者共享部分 + 注入 API 面 + locale。 */
export type MemoryEntryProps =
  { wide: boolean }
  & InjectFace<MemoryApi>
  & PropsLocale<'dshMemory'>

/** 渲染记忆入口与面板。 */
export function MemoryEntry({ wide, t, ...panel }: MemoryEntryProps): JSX.Element {
  ensureStyles()
  const [open, setOpen] = useState(false)
  const [initialTab, setInitialTab] = useState<MemoryTab>('all')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const unread = useUnreadChanges(panel)

  // footer 插槽 wrapper 是 display:contents，把它变成横向 flex（与技能入口同款处理）。
  useEffect(() => {
    const button = buttonRef.current
    const wrapper = button?.parentElement
    if (wrapper === undefined || wrapper === null) return
    const previousDisplay = wrapper.style.display
    const previousDirection = wrapper.style.flexDirection
    const previousWidth = wrapper.style.width
    wrapper.style.display = 'flex'
    wrapper.style.flexDirection = 'row'
    wrapper.style.alignItems = 'center'
    wrapper.style.gap = '4px'
    // wrapper 与 usg_layer（用量技能）各占 footer 一半；不设 width:100%，
    // 否则会占满整行把 usg 挤出。
    wrapper.style.flex = '1 1 50%'
    wrapper.style.minWidth = '0'
    return () => {
      wrapper.style.display = previousDisplay
      wrapper.style.flexDirection = previousDirection
      wrapper.style.width = previousWidth
      wrapper.style.flex = ''
      wrapper.style.minWidth = ''
      wrapper.style.alignItems = ''
      wrapper.style.gap = ''
    }
  }, [])

  const openPanel = (tab: MemoryTab): void => {
    setInitialTab(tab)
    setOpen(true)
    if (tab === 'changes') unread.markRead()
  }

  return (
    <>
      <Tooltip label={t('entry')} side="right" delayMs={500} disabled={wide}>
        <button
          ref={buttonRef}
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
        onClose={() => { setOpen(false) }}
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
