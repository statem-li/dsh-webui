/**
 * 用量工作台 + 技能面板入口：侧边栏导航行（「自动化」菜单下方）。
 *
 * 点击时以按钮位置为锚点，面板卡片从按钮右侧滑出（automation 同款 popover）；
 * 视口过窄回退底部 sheet。开合动画与收回状态机走 modal-animation + popover-shell。
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IconDataOutline16, IconFolderOpenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { Workbench } from './dashboard/Workbench'
import { SkillsPanel } from './dashboard/SkillsPanel'
import { ensureModalAnimStyles, useModalClose } from '../modal-animation'
import { NavButton, NavPortal, ensureNavMount, ensureNavStyles, useRail } from '../sidebar-nav'
import { ensureShellStyles, type PopoverAnchor } from '../popover-shell'

/** 从点击事件取锚点：按钮右缘 +8、顶缘 -6（与 automation openCard 同款）。 */
function anchorFromEvent(e: React.MouseEvent<HTMLButtonElement>): PopoverAnchor {
  const rect = e.currentTarget.getBoundingClientRect()
  return { left: rect.right + 8, top: rect.top - 6 }
}

/** 用量/余额入口：导航行 + 贴右侧滑出的工作台卡片。 */
function UsageWorkbenchEntry(): JSX.Element {
  ensureModalAnimStyles()
  ensureShellStyles()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })
  const rail = useRail()
  return (
    <>
      <Tooltip label="用量/余额" side="right" delayMs={500} disabled={!rail}>
        <NavButton
          icon={<IconDataOutline16 size={rail ? 18 : 16} />}
          label="用量/余额"
          rail={rail}
          expanded={open}
          onClick={e => {
            e.stopPropagation()
            setAnchor(anchorFromEvent(e))
            setOpen(true)
          }}
        />
      </Tooltip>
      {open && <Workbench closing={closing} onClose={requestClose} anchor={anchor} />}
    </>
  )
}

/** 技能入口：导航行 + 贴右侧滑出的技能管理卡片。 */
function SkillsEntry(): JSX.Element {
  ensureModalAnimStyles()
  ensureShellStyles()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })
  const rail = useRail()
  return (
    <>
      <Tooltip label="技能" side="right" delayMs={500} disabled={!rail}>
        <NavButton
          icon={<IconFolderOpenOutline16 size={rail ? 18 : 16} />}
          label="技能"
          rail={rail}
          expanded={open}
          onClick={e => {
            e.stopPropagation()
            setAnchor(anchorFromEvent(e))
            setOpen(true)
          }}
        />
      </Tooltip>
      {open && <SkillsPanel closing={closing} onClose={requestClose} anchor={anchor} />}
    </>
  )
}

/** 导航行应用：两条入口 portal 到 nav host 的 usage 槽位。 */
function UsageSkillsNavApp(): JSX.Element | null {
  ensureNavStyles()
  return (
    <NavPortal name="usage">
      <UsageWorkbenchEntry />
      <SkillsEntry />
    </NavPortal>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    ensureNavMount()
    // React 根挂在游离容器上（React 18 支持容器后入树）；实际 UI 经 portal
    // 落到 sidebar-nav 的槽位 div。
    const holder = document.createElement('div')
    const root = createRoot(holder)
    root.render(<UsageSkillsNavApp />)
    return () => { root.unmount() }
  }, 'webui: usage/skills nav entries')
}
