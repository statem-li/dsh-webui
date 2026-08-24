/**
 * 用量工作台 + 技能面板入口：侧边栏导航行（「自动化」菜单下方）。
 *
 * 「用量/余额」行尾常驻显示今日总用量（每 60s 自动刷新）；点击以按钮位置为
 * 锚点打开完整工作台卡片（automation 同款 popover，视口过窄回退底部 sheet）。
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { Workbench } from './dashboard/Workbench'
import { SkillsPanel } from './dashboard/SkillsPanel'
import { usageApi } from './dashboard/api'
import { sumTokens } from './dashboard/aggregate'
import { formatUnits } from './dashboard/format'
import { ensureModalAnimStyles, useModalClose } from '../modal-animation'
import { NavButton, NavPortal, ensureNavMount, ensureNavStyles, navAnchorFrom, useRail } from '../sidebar-nav'
import { ensureShellStyles, type PopoverAnchor } from '../popover-shell'

/** 从点击事件取锚点：所在导航行右缘 +8、按钮顶缘 -6（合并行统一滑出位）。 */
function anchorFromEvent(e: React.MouseEvent<HTMLButtonElement>): PopoverAnchor | null {
  return navAnchorFrom(e.currentTarget)
}

// ── 今日总用量 ───────────────────────────────────────────────────────────

function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** 拉取今日 tokens 总量；失败返回 null（保持上次显示）。 */
async function fetchTodayTotal(): Promise<number | null> {
  try {
    const payload = await usageApi.usage()
    if (!payload.ok) return null
    const today = localToday()
    const days = payload.days.filter(day => day.date === today)
    return sumTokens(days).total
  } catch {
    return null
  }
}

/** 用量/余额入口：导航行（行尾今日总用量）+ 点击打开完整工作台。 */
function UsageWorkbenchEntry(): JSX.Element {
  ensureModalAnimStyles()
  ensureShellStyles()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null)
  const [todayTotal, setTodayTotal] = useState<number | null>(null)
  const { closing, requestClose } = useModalClose(open, () => { setOpen(false) })
  const rail = useRail()

  // 挂载拉一次 + 每 60s 刷新今日总量。
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const total = await fetchTodayTotal()
      if (alive && total !== null) setTodayTotal(total)
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 60_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  return (
    <>
      <NavButton
        icon={<IconDataOutline16 size={rail ? 18 : 16} />}
        label="用量/余额"
        rail={rail}
        expanded={open}
        trailing={todayTotal !== null ? formatUnits(todayTotal) : undefined}
        onClick={e => {
          e.stopPropagation()
          setAnchor(anchorFromEvent(e))
          setOpen(true)
        }}
      />
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
      {/* 打开的书（Feather book-open 线性风，与自动化/记忆的自绘图标同款描边） */}
      <NavButton
        icon={(
          <svg width={rail ? 18 : 16} height={rail ? 18 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
        )}
        label="技能"
        rail={rail}
        expanded={open}
        onClick={e => {
          e.stopPropagation()
          setAnchor(anchorFromEvent(e))
          setOpen(true)
        }}
      />
      {open && <SkillsPanel closing={closing} onClose={requestClose} anchor={anchor} />}
    </>
  )
}

/** 导航行应用：用量入口 portal 到 nav host 的 usage 槽（独立行）；
 * 技能入口 portal 到「自动化」host 的 skills 槽——与自动化、记忆合成一行。 */
function UsageSkillsNavApp(): JSX.Element | null {
  ensureNavStyles()
  return (
    <>
      <NavPortal name="usage">
        <UsageWorkbenchEntry />
      </NavPortal>
      <NavPortal name="skills">
        <SkillsEntry />
      </NavPortal>
    </>
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
