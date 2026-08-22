import { useEffect, useState, type ReactNode } from 'react'
import { TrendTab } from './TrendTab'
import { UsageTab } from './UsageTab'
import { AccountsTab } from './AccountsTab'
import { RangePicker } from './primitives/RangePicker'
import { resolveRange, type DateRange, type RangePreset } from './range'
import { modalStaggerClass } from '../../modal-animation'
import { PopoverShell, type PopoverAnchor, type PopoverSize } from '../../popover-shell'

export type TabKey = 'trend' | 'detail' | 'accounts'

const NAV: Array<{ key: TabKey; label: string }> = [
  { key: 'trend', label: '趋势' },
  { key: 'detail', label: '明细' },
  { key: 'accounts', label: '余额/配额' },
]

/** 每个 tab 的理想卡片尺寸：切换时 width/height 以 240ms 平滑过渡（automation 同款）。 */
const TAB_SIZES: Record<TabKey, PopoverSize> = {
  trend: { width: 1120, height: 780 },
  detail: { width: 1000, height: 720 },
  accounts: { width: 820, height: 600 },
}

const css = {
  topbar: { height: 48, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--dsw-alias-border-l1)', flex: 'none' } as React.CSSProperties,
  tabNav: { flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)', flexWrap: 'wrap' } as React.CSSProperties,
  tabGroup: { display: 'flex', alignItems: 'center', gap: 4 } as React.CSSProperties,
  // dense 胶囊（h28 r14 12px），对齐 ModelsSection 行内控件规格；选中走品牌色。
  tabItem: (active: boolean): React.CSSProperties => ({
    height: 28, display: 'flex', alignItems: 'center', padding: '0 12px', borderRadius: 14, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'}`,
    background: active ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)' : 'transparent',
    color: active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)',
    boxShadow: active ? '0 0 10px color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent)' : 'none',
    transition: 'background .22s cubic-bezier(.2,.8,.2,1), color .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s cubic-bezier(.2,.8,.2,1), border-color .22s cubic-bezier(.2,.8,.2,1)',
    fontSize: 12, lineHeight: '18px', fontWeight: active ? 500 : 400,
  }),
  content: { flex: 1, overflowY: 'auto', padding: '14px 16px 32px', width: '100%', boxSizing: 'border-box' } as React.CSSProperties,
  title: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } as React.CSSProperties,
  close: { marginLeft: 'auto', width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: 16 } as React.CSSProperties,
}

export interface WorkbenchProps {
  onClose?: () => void
  /** 正在播放收回动画（此时弹窗仍挂载，播放滑出）。 */
  closing?: boolean
  /** 入口锚点（按钮右缘+顶缘视口坐标）：卡片贴其右侧滑出；null 回退底部 sheet。 */
  anchor?: PopoverAnchor | null
  /** 鼠标进入卡片（hover 模式：取消自动收回）。 */
  onCardMouseEnter?: () => void
  /** 鼠标离开卡片（hover 模式：启动自动收回计时）。 */
  onCardMouseLeave?: () => void
  renderTab?: (tab: TabKey) => ReactNode
}

export function Workbench({ onClose, closing = false, anchor = null, onCardMouseEnter, onCardMouseLeave, renderTab }: WorkbenchProps): JSX.Element {
  const [tab, setTab] = useState<TabKey>('trend')
  const [preset, setPreset] = useState<RangePreset>('today')
  const [custom, setCustom] = useState<DateRange | null>(null)
  const close = onClose ?? (() => {})

  const { range, label: rangeLabel } = resolveRange(preset, custom)

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
    trend: <TrendTab range={range} rangeLabel={rangeLabel} onJumpAccounts={() => setTab('accounts')} />,
    detail: <UsageTab range={range} rangeLabel={rangeLabel} />,
    accounts: <AccountsTab />,
  }
  return (
    <PopoverShell closing={closing} onClose={close} anchor={anchor} size={TAB_SIZES[tab]} onCardMouseEnter={onCardMouseEnter} onCardMouseLeave={onCardMouseLeave} ariaLabel="用量工作台">
      <div style={css.topbar}>
        <span style={css.title}>用量工作台</span>
        <button type="button" style={css.close} aria-label="关闭" onClick={close}>✕</button>
      </div>
      <div style={css.tabNav}>
        <div style={css.tabGroup}>
          {NAV.map(item => (
            <button key={item.key} type="button" style={css.tabItem(tab === item.key)} onClick={() => setTab(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        {tab !== 'accounts' && (
          <div style={{ marginLeft: 'auto' }}>
            <RangePicker
              preset={preset}
              custom={custom}
              onChangePreset={setPreset}
              onChangeCustom={setCustom}
            />
          </div>
        )}
      </div>
      <main style={css.content} className={modalStaggerClass}>
        {renderTab ? renderTab(tab) : tabContent[tab]}
      </main>
    </PopoverShell>
  )
}
