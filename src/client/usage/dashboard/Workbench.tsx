import { useEffect, useState, type ReactNode } from 'react'
import { OverviewTab } from './OverviewTab'
import { UsageTab } from './UsageTab'
import { AccountsTab } from './AccountsTab'
import { modalAnimClass, modalMaskAnimClass } from '../../modal-animation'

export type TabKey = 'overview' | 'usage' | 'accounts'

const NAV: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: '总览' },
  { key: 'usage', label: '用量' },
  { key: 'accounts', label: '余额/配额' },
]

const css = {
  shell: { position: 'fixed', inset: 0, zIndex: 6000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,10,14,.5)', backdropFilter: 'blur(2px)' } as React.CSSProperties,
  modal: { width: 'min(1350px, calc(100vw - 48px))', maxWidth: 'calc(100vw - 48px)', height: '82vh', minHeight: 480, maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-base)', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,.5)', overflow: 'hidden' } as React.CSSProperties,
  topbar: { height: 48, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--dsw-alias-border-l1)', flex: 'none' } as React.CSSProperties,
  tabNav: { flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0 12px', height: 44, borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)' } as React.CSSProperties,
  tabItem: (active: boolean): React.CSSProperties => ({
    height: 32, display: 'flex', alignItems: 'center', padding: '0 14px', borderRadius: 8, cursor: 'pointer',
    border: 'none', background: active ? 'var(--dsw-alias-raised)' : 'transparent',
    color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
    fontSize: 13, fontWeight: active ? 600 : 400,
  }),
  content: { flex: 1, overflowY: 'auto', padding: '20px 24px 40px', maxWidth: 1200, margin: '0 auto', width: '100%' } as React.CSSProperties,
  title: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } as React.CSSProperties,
  close: { marginLeft: 'auto', width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: 16 } as React.CSSProperties,
}

export interface WorkbenchProps {
  onClose?: () => void
  /** 正在播放收回动画（此时弹窗仍挂载，播放 pop-out）。 */
  closing?: boolean
  renderTab?: (tab: TabKey) => ReactNode
}

export function Workbench({ onClose, closing = false, renderTab }: WorkbenchProps): JSX.Element {
  const [tab, setTab] = useState<TabKey>('overview')

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
    <div style={css.shell} className={modalMaskAnimClass(closing)}>
      <div style={css.modal} className={modalAnimClass(closing)} onClick={e => e.stopPropagation()}>
        <div style={css.topbar}>
          <span style={css.title}>用量工作台</span>
          <button type="button" style={css.close} aria-label="关闭" onClick={onClose}>✕</button>
        </div>
        <div style={css.tabNav}>
          {NAV.map(item => (
            <button key={item.key} type="button" style={css.tabItem(tab === item.key)} onClick={() => setTab(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <main style={css.content}>
          {renderTab ? renderTab(tab) : tabContent[tab]}
        </main>
      </div>
    </div>
  )
}
