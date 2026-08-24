/**
 * dash — 用量工作台「仪表盘」视觉层（趋势 tab 专用）。
 *
 * 与设置页的行卡片语言（TrendTab 里导出的 rowCard/editorFace，SignalTab 复用）
 * 并存：本模块只服务铺满右侧面板的总览布局——大圆角填充面（bento 卡）、
 * hero 统计条、带跳转的小指标块。
 *
 * 配色一律走官方 token：
 *  - 表面 = bg-module-platform（浅色=灰、深色=800），描边 border-l1；
 *  - 强调 = state-business-primary（绝不能用反色的 brand-primary）。
 */
import type { CSSProperties, ReactNode } from 'react'

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** bento 填充面：大圆角 + 细描边（面板铺满时的主要容器）。 */
export const surface: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 16,
  background: 'var(--dsw-alias-bg-module-platform)',
  boxSizing: 'border-box',
  minWidth: 0,
}

/** 面板（surface + 纵向布局 + 内距）。 */
export function panel(padding = 16, gap = 12): CSSProperties {
  return { ...surface, padding, display: 'flex', flexDirection: 'column', gap, minWidth: 0 }
}

/** 卡头：标题（14/600）+ 右侧 meta（12 tertiary）+ 可选行尾操作。 */
export function PanelHead({ title, meta, action }: { title: string; meta?: string; action?: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' }}>{title}</span>
      {meta !== undefined && (
        <span style={{ minWidth: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
      )}
      {action !== undefined && <span style={{ marginLeft: 'auto', flex: 'none' }}>{action}</span>}
    </div>
  )
}

/** hero 统计项：小图标 + mono 大数 + 名称（横排，间距由父容器给）。 */
export function HeroStat({ icon, value, label, delta }: {
  icon: ReactNode
  value: string
  label: string
  delta?: { text: string; color: string } | null
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ flex: 'none', display: 'inline-flex', alignSelf: 'center', color: 'var(--dsw-alias-label-tertiary)' }}>{icon}</span>
        <span style={{ fontSize: 26, lineHeight: '34px', fontWeight: 600, fontFamily: MONO, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' }}>{value}</span>
        {delta != null && <span style={{ fontSize: 11, fontFamily: MONO, color: delta.color, whiteSpace: 'nowrap' }}>{delta.text}</span>}
      </span>
      <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}

/** 小指标块：状态点 + 名称 + mono 大数 + 底部跳转链接（bento 底排）。 */
export function Tile({ label, value, sub, tone = 'business', action, onAction }: {
  label: string
  value: string
  sub?: string
  /** 状态点颜色语义。 */
  tone?: 'business' | 'success' | 'warn' | 'error' | 'muted'
  /** 底部链接文字（省略则不渲染链接行）。 */
  action?: string
  onAction?: () => void
}): JSX.Element {
  const dot = tone === 'success' ? 'var(--dsw-alias-state-success-primary)'
    : tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)'
      : tone === 'error' ? 'var(--dsw-alias-state-error-primary)'
        : tone === 'muted' ? 'var(--dsw-alias-label-tertiary)'
          : 'var(--dsw-alias-state-business-primary)'
  return (
    <div style={{ ...panel(14, 8), justifyContent: 'space-between' }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: dot, flex: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontSize: 22, lineHeight: '30px', fontWeight: 600, fontFamily: MONO, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' }}>{value}</span>
        {sub !== undefined && (
          <span style={{ fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
        )}
      </div>
      {action !== undefined && (
        <button type="button" onClick={onAction} style={{
          display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, padding: 0, border: 'none', background: 'transparent',
          color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px', fontFamily: 'inherit',
          cursor: onAction !== undefined ? 'pointer' : 'default',
        }}>
          {action}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 17 17 7M9 7h8v8" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** 行内胶囊小按钮（h28 r14 12px，官方行内控件规格）。 */
export function PillButton({ children, onClick, active = false }: { children: ReactNode; onClick?: () => void; active?: boolean }): JSX.Element {
  return (
    <button type="button" onClick={onClick} style={{
      height: 28, padding: '0 12px', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
      fontSize: 12, lineHeight: '18px',
      border: `1px solid ${active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'}`,
      background: active ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)' : 'transparent',
      color: active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-primary)',
    }}>{children}</button>
  )
}

/** 小图标集（feather 线性风，与导航/自动化自绘图标同款描边）。 */
export const icons = {
  tokens: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  ),
  input: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" />
    </svg>
  ),
  output: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M4 3h16" />
    </svg>
  ),
  requests: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4l3 7 4-14 3 7h4" />
    </svg>
  ),
  clock: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
    </svg>
  ),
}
