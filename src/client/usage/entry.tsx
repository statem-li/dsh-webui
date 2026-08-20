import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { IconDataOutline16, IconFolderOpenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { Workbench } from './dashboard/Workbench'
import { SkillsPanel } from './dashboard/SkillsPanel'
import { ensureModalAnimStyles, useModalClose } from '../modal-animation'

export const inject = ['slots', 'locale']

/** footer 按钮基础样式：与记忆入口（.dsh-memory-entry）完全一致——统一字体/大小/对齐。 */
const footerBtn: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  boxSizing: 'border-box',
  border: 'none',
  borderRadius: 10,
  padding: '0 8px',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  lineHeight: '20px',
  overflow: 'hidden',
}

/** rail（侧边栏收起 56px）模式：36×36 圆形图标按钮，对齐官方 rail trigger。 */
const railBtn: React.CSSProperties = {
  flex: 'none',
  width: 36,
  height: 36,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: '50%',
  padding: 0,
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--dsw-alias-label-primary)',
}

function UsageWorkbenchEntry({ wide }: { wide: boolean }): JSX.Element {
  ensureModalAnimStyles()
  const [open, setOpen] = useState(false)
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })
  useEffect(() => {
    if (!open || closing) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closing, requestClose])
  if (!open) {
    if (!wide) {
      return (
        <Tooltip label="用量/余额" side="right" delayMs={500}>
          <button type="button" style={railBtn} aria-label="用量/余额" onClick={e => { e.stopPropagation(); setOpen(true) }}>
            <IconDataOutline16 size={18} />
          </button>
        </Tooltip>
      )
    }
    return <button type="button" style={footerBtn} onClick={e => { e.stopPropagation(); setOpen(true) }}>用量/余额</button>
  }
  return <Workbench closing={closing} onClose={requestClose} />
}

function SkillsEntry({ wide }: { wide: boolean }): JSX.Element {
  ensureModalAnimStyles()
  const [open, setOpen] = useState(false)
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })
  useEffect(() => {
    if (!open || closing) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closing, requestClose])
  if (!open) {
    if (!wide) {
      return (
        <Tooltip label="技能" side="right" delayMs={500}>
          <button type="button" style={railBtn} aria-label="技能" onClick={e => { e.stopPropagation(); setOpen(true) }}>
            <IconFolderOpenOutline16 size={18} />
          </button>
        </Tooltip>
      )
    }
    return <button type="button" style={footerBtn} onClick={e => { e.stopPropagation(); setOpen(true) }}>技能</button>
  }
  return <SkillsPanel closing={closing} onClose={requestClose} />
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'usage-stats',
      order: 8,
      label: () => '用量/余额',
    }, UsageWorkbenchEntry))
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'skills',
      order: 9,
      label: () => '技能',
    }, SkillsEntry))
}
