import { useEffect, useState, type ReactNode } from 'react'
import { OverviewTab } from './OverviewTab'
import { UsageTab } from './UsageTab'
import { AccountsTab } from './AccountsTab'
import { modalStaggerClass } from '../../modal-animation'
import { PopoverShell, type PopoverAnchor } from '../../popover-shell'

export type TabKey = 'overview' | 'usage' | 'accounts'

const NAV: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: '总览' },
  { key: 'usage', label: '用量' },
  { key: 'accounts', label: '余额/配额' },
]

const css = {
  topbar: { height: 48, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--dsw-alias-border-l1)', flex: 'none' } as React.CSSProperties,
  tabNav: { flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0 12px', height: 44, borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)' } as React.CSSProperties,
  tabItem: (active: boolean): React.CSSProperties => ({
    height: 32, display: 'flex', alignItems: 'center', padding: '0 14px', borderRadius: 8, cursor: 'pointer',
    border: 'none',
    // 选中态用 ghost 按钮选中填充(浅色 bluish-100 / 深色 bluish-750),禁用不存在的 --dsw-alias-raised。
    background: active ? 'var(--dsw-alias-button-ghost-active-fill)' : 'transparent',
    color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
    fontSize: 13, fontWeight: active ? 600 : 400,
  }),
  content: { flex: 1, overflowY: 'auto', padding: '20px 24px 40px', maxWidth: 1200, margin: '0 auto', width: '100%', boxSizing: 'border-box' } as React.CSSProperties,
  title: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } as React.CSSProperties,
  close: { marginLeft: 'auto', width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: 16 } as React.CSSProperties,
}

export interface WorkbenchProps {
  onClose?: () => void
  /** 正在播放收回动画（此时弹窗仍挂载，播放滑出）。 */
  closing?: boolean
  /** 入口锚点（按钮右缘+顶缘视口坐标）：卡片贴其右侧滑出；null 回退底部 sheet。 */
  anchor?: PopoverAnchor | null
  renderTab?: (tab: TabKey) => ReactNode
}

export function Workbench({ onClose, closing = false, anchor = null, renderTab }: WorkbenchProps): JSX.Element {
  const [tab, setTab] = useState<TabKey>('overview')
  const close = onClose ?? (() => {})

  // prefers-reduced-motion：检测并注入 CSS 变量（已知限制：图表内联 transition 未逐处改造，见任务报告）
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = (): void => {
      if (media.matches) document.documentElement.style.setProperty('--dsh-chart-anim', 'none')
      else document.documentElement.style.removeProperty('--dsh-chart-anim')
    }
    apply()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply)
      return () => { media.removeEventListener('change', apply); document.documentElement.style.removeProperty('--dsh-chart-anim') }
    }
    if (typeof media.addListener === 'function') {
      media.addListener(apply)
      return () => { media.removeListener(apply); document.documentElement.style.removeProperty('--dsh-chart-anim') }
    }
    return undefined
  }, [])

  const tabContent: Record<TabKey, ReactNode> = {
    overview: <OverviewTab onJumpAccounts={() => setTab('accounts')} />,
    usage: <UsageTab />,
    accounts: <AccountsTab />,
  }
  return (
    <PopoverShell closing={closing} onClose={close} anchor={anchor} width={1080} ariaLabel="用量工作台">
      <div style={css.topbar}>
        <span style={css.title}>用量工作台</span>
        <button type="button" style={css.close} aria-label="关闭" onClick={close}>✕</button>
      </div>
      <div style={css.tabNav}>
        {NAV.map(item => (
          <button key={item.key} type="button" style={css.tabItem(tab === item.key)} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      <main style={css.content} className={modalStaggerClass}>
        {renderTab ? renderTab(tab) : tabContent[tab]}
      </main>
    </PopoverShell>
  )
}
