import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { Workbench } from './dashboard/Workbench'
import { SkillsPanel } from './dashboard/SkillsPanel'

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

function UsageWorkbenchEntry(): JSX.Element {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) {
    return <button type="button" style={footerBtn} onClick={e => { e.stopPropagation(); setOpen(true) }}>用量/余额</button>
  }
  return <Workbench onClose={() => setOpen(false)} />
}

function SkillsEntry(): JSX.Element {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) {
    return <button type="button" style={footerBtn} onClick={e => { e.stopPropagation(); setOpen(true) }}>技能</button>
  }
  return <SkillsPanel onClose={() => setOpen(false)} />
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
