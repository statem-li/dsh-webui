/**
 * 三个「能力模型」区块（辅助视觉 / 生图 / 生视频）的共享外壳与控件。
 *
 * 统一版式，取代此前各块自绘的裸标题 + 整段说明文字 + 裸列表行：
 *  - {@link BlockShell}：标题行（标题 + 当前生效 pill + 「说明」折叠开关）
 *    + 折叠的说明段 + 内容区；说明默认收起，页面从三大段文字变成三行标题。
 *  - {@link Pill}：当前生效值的胶囊徽章（等宽字体，成功色点）。
 *  - {@link SelectField}：带浮起标签的下拉，规格对齐官方 .selectInput。
 *  - {@link IconButton}：24px 方形图标钮（上移/下移/删除），替代挤在一起的方块按钮。
 *
 * 规格对齐官方 ModelsSection.module.css：下拉 32px/8px 圆角/14px 字，
 * 行卡片 12px 圆角描边无底色，胶囊按钮 28px/14px 圆角/12px 字。
 */
import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'

/** 官方 .selectInput 规格（自定义 chevron，不用原生箭头）。 */
export const SELECT_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  height: 32,
  padding: '0 30px 0 10px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1, transparent)',
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\'%3E%3Cpath d=\'M3 4.5L6 7.5L9 4.5\' stroke=\'%2381858C\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  backgroundSize: '12px 12px',
  appearance: 'none',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13, lineHeight: '22px', cursor: 'pointer',
  minWidth: 0,
}

/** 官方行内小胶囊（Button .sm）。 */
export const CAPSULE_BTN: CSSProperties = {
  boxSizing: 'border-box',
  height: 28, padding: '0 12px', flexShrink: 0,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 14,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12, lineHeight: '18px', cursor: 'pointer',
}

export const CAPSULE_BTN_DISABLED: CSSProperties = { ...CAPSULE_BTN, opacity: 0.45, cursor: 'default' }

/** 行卡片：细描边、12px 圆角、无底色。 */
export const ROW_CARD: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '9px 12px', borderRadius: 12, minWidth: 0,
  border: '1px solid var(--dsw-alias-border-l2)',
}

/** 编辑面（填充面）：添加控件所在的一行。 */
export const FILL_PANEL: CSSProperties = {
  display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap',
  padding: '10px 12px', borderRadius: 12,
  background: 'var(--dsw-alias-bg-module-platform, #f2f3f5)',
}

export const MONO: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  fontSize: 12, lineHeight: '18px',
}

const HINT_TEXT: CSSProperties = {
  margin: 0, fontSize: 12, lineHeight: '19px',
  color: 'var(--dsw-alias-label-tertiary)',
}

/**
 * 当前生效值的胶囊徽章。
 * @param props - 文本与语气（active=成功色点，muted=灰点）。
 */
export function Pill({ text, tone = 'active' }: { text: string; tone?: 'active' | 'muted' }): ReactNode {
  const color = tone === 'active'
    ? 'var(--dsw-alias-state-success-primary, #00b42a)'
    : 'var(--dsw-alias-label-tertiary, #8f959e)'
  return (
    <span
      title={`当前生效：${text}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
        height: 24, padding: '0 10px', borderRadius: 12, maxWidth: 320,
        border: '1px solid var(--dsw-alias-border-l3, #c9cdd4)',
        color: 'var(--dsw-alias-label-secondary)',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ ...MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    </span>
  )
}

/** 24px 方形图标钮（上移/下移/删除）。 */
export function IconButton({ label, glyph, disabled, danger, onClick }: {
  label: string
  glyph: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className={danger === true ? 'dsh-webui-icon-btn-danger' : 'dsh-webui-icon-btn'}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 24, height: 24, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', borderRadius: 6, background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 13, lineHeight: 1,
        cursor: disabled === true ? 'default' : 'pointer',
        opacity: disabled === true ? 0.35 : 1,
      }}
    >
      {glyph}
    </button>
  )
}

/** 带小标签的下拉字段（标签在上，12px 次级色）。 */
export function SelectField({ label, value, disabled, width, onChange, children }: {
  label: string
  value: string
  disabled?: boolean
  /** 下拉宽度 px（默认 176）。 */
  width?: number
  onChange: (value: string) => void
  children: ReactNode
}): ReactNode {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' }}>{label}</span>
      <select
        style={{ ...SELECT_STYLE, width: width ?? 176 }}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => { onChange(event.target.value) }}
      >
        {children}
      </select>
    </label>
  )
}

/**
 * 区块外壳：标题行 + 可折叠说明 + 内容区。
 * @param props - 标题、当前生效值、说明文本与内容。
 */
export function BlockShell({ title, activeText, description, children }: {
  title: string
  /** 当前生效的 provider/model；空串表示未配置。 */
  activeText?: string
  /** 折叠在「说明」后面的长文本。 */
  description: string
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', flexShrink: 0 }}>
          {title}
        </span>
        {activeText !== undefined && activeText !== ''
          ? <Pill text={activeText} />
          : <Pill text="未配置" tone="muted" />}
        <button
          type="button"
          className="dsh-webui-link-btn"
          aria-expanded={open}
          onClick={() => { setOpen(v => !v) }}
          style={{
            marginLeft: 'auto', flexShrink: 0,
            height: 24, padding: '0 8px', borderRadius: 12,
            border: 'none', background: 'transparent',
            color: 'var(--dsw-alias-label-tertiary)',
            fontSize: 12, lineHeight: '18px', cursor: 'pointer',
          }}
        >
          {open ? '收起说明' : '说明'}
        </button>
      </div>
      {open ? <p style={HINT_TEXT}>{description}</p> : null}
      {children}
    </section>
  )
}

/** 加载中/错误/空态的统一小字提示。 */
export function StateHint({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'error' }): ReactNode {
  return (
    <p style={{
      margin: 0, fontSize: 12, lineHeight: '18px',
      color: tone === 'error'
        ? 'var(--dsw-alias-state-error-primary, #d54941)'
        : 'var(--dsw-alias-label-tertiary)',
    }}>{text}</p>
  )
}
