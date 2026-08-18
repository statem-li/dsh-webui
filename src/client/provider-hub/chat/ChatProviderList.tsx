/**
 * 「对话供应商」左列表：已配置行 + 未配置的目录预设 + 添加自定义入口。
 *
 * 一行已配置提供方显示：显示名、凭据状态点（绿=已配置 / 红=缺失）、模型
 * 数徽标，以及选中态。目录预设行（适配器知道但尚未配置）点击进入创建；
 * 「添加自定义提供方」声明适配器不发货的路由。选中态由父组件持有
 * （selected = provider route id），详情侧据此切换编辑/创建模式。
 */

import type { ReactNode } from 'react'
import type { CSSProperties } from 'react'
import { getPath } from '@deepseek-ai/dsh-client-schema-form'
import { chatCopy } from './ModelListEditor.tsx'
import type { ModelsSettingsState, ProviderRow } from './store.ts'

/** {@link ChatProviderList} 的 props。 */
export interface ChatProviderListProps {
  /** 当前页面快照（由父组件注入，父组件负责 load）。 */
  state: ModelsSettingsState
  /** 当前选中的提供方 route id（详情侧正在编辑的那个）。 */
  selected: string | undefined
  /** 点击一行提供方（已配置或目录预设）。 */
  onSelect: (provider: string) => void
  /** 点击「添加自定义提供方」。 */
  onAddCustom: () => void
  /** 整页加载失败后的重试。 */
  onRetry: () => void
}

/** 一行提供方解析出的 profile 中 `models` 数组的长度（无则 0）。 */
export function modelsCountOf(state: ModelsSettingsState, row: ProviderRow): number {
  const namespace = state.namespaces.get(row.entry.settingsNs)
  if (namespace === undefined) return 0
  const models = getPath(namespace.value, [...row.entry.settingsPath, 'models'])
  return Array.isArray(models) ? models.length : 0
}

/**
 * 渲染「对话供应商」左列表。
 * @param props - 快照、选中态与回调。
 * @returns 左列表。
 */
export function ChatProviderList(props: ChatProviderListProps): ReactNode {
  const { state, selected, onSelect, onAddCustom, onRetry } = props
  const configured = state.rows.filter(row => row.configured)
  const addable = state.rows.filter(row => !row.configured && row.entry.settingsNs !== '')

  if (state.status === 'loading' && state.rows.length === 0) {
    return (
      <div style={listColumnStyle}>
        <ListTitle />
        <p style={hintStyle}>加载中…</p>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div style={listColumnStyle}>
        <ListTitle />
        <p style={errorStyle}>{`${chatCopy.loadFailed}: ${state.error ?? ''}`}</p>
        <button type="button" style={secondaryButtonStyle} onClick={onRetry}>
          {chatCopy.retry}
        </button>
      </div>
    )
  }

  return (
    <div style={listColumnStyle}>
      <ListTitle />
      {!state.writable && state.status === 'ready' ? <p style={hintStyle}>{chatCopy.readOnly}</p> : null}
      <GroupLabel>{chatCopy.configuredGroup}</GroupLabel>
      {configured.length === 0 ? <p style={hintStyle}>暂无已配置的提供方。</p> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {configured.map(row => (
          <ProviderRowButton
            key={row.entry.provider}
            row={row}
            count={modelsCountOf(state, row)}
            selected={selected === row.entry.provider}
            onClick={() => { onSelect(row.entry.provider) }}
          />
        ))}
      </div>
      <GroupLabel>{chatCopy.presetGroup}</GroupLabel>
      {addable.length === 0 ? <p style={hintStyle}>目录中暂无其他提供方。</p> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {addable.map(row => (
          <ProviderRowButton
            key={row.entry.provider}
            row={row}
            preset
            count={modelsCountOf(state, row)}
            selected={selected === row.entry.provider}
            onClick={() => { onSelect(row.entry.provider) }}
          />
        ))}
      </div>
      <button
        type="button"
        style={addCustomButtonStyle}
        disabled={!state.writable}
        onClick={onAddCustom}
      >
        + {chatCopy.addCustom}
      </button>
    </div>
  )
}

/** 分组小标题。 */
function GroupLabel({ children }: { children: ReactNode }): ReactNode {
  return <p style={groupLabelStyle}>{children}</p>
}

/** 列表区标题。 */
function ListTitle(): ReactNode {
  return <p style={titleStyle}>{chatCopy.chatTitle}</p>
}

/** 一行提供方按钮（已配置行或目录预设行）。 */
function ProviderRowButton({
  row, preset, count, selected, onClick,
}: {
  row: ProviderRow
  /** 目录预设行（未配置）时加「未配置」标记。 */
  preset?: boolean
  /** 该 profile 当前的模型数。 */
  count: number
  selected: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      style={selected ? rowButtonSelectedStyle : rowButtonStyle}
      onClick={onClick}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
        <span
          style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13,
            color: 'var(--dsw-alias-label-primary, #1f2329)',
          }}
        >
          {row.entry.displayName}
        </span>
        {row.entry.declared === true
          ? <span style={tagStyle}>{chatCopy.customTag}</span>
          : null}
        {preset === true ? <span style={tagStyle}>{chatCopy.unconfigured}</span> : null}
        {preset !== true ? <CredentialDot row={row} /> : null}
      </span>
      <span style={countBadgeStyle} title={`${count} 模型`}>
        {count}
      </span>
    </button>
  )
}

/** 凭据状态点：绿=已配置，红=缺失（无引用时不显示）。 */
function CredentialDot({ row }: { row: ProviderRow }): ReactNode {
  const configured = row.credential?.configured === true
  const missing = !configured && row.apiKeyEnv !== undefined && row.credential?.configured === false
  if (configured) {
    return (
      <span
        role="img"
        aria-label={chatCopy.credentialConfigured}
        title={chatCopy.credentialConfigured}
        style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: 'var(--dsw-alias-state-success-primary, #00b42a)',
        }}
      />
    )
  }
  if (missing) {
    return (
      <span
        role="img"
        aria-label={chatCopy.credentialMissing}
        title={chatCopy.credentialMissing}
        style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: 'var(--dsw-alias-state-error-primary, #d54941)',
        }}
      />
    )
  }
  return null
}

/* ---------- 内联样式（主题令牌 + fallback） ---------- */

const listColumnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
  maxWidth: '100%',
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-primary, #1f2329)',
}

const groupLabelStyle: CSSProperties = {
  margin: '8px 0 0',
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

const errorStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--dsw-alias-state-error-primary, #d54941)',
}

const rowButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid transparent',
  background: 'transparent',
  cursor: 'pointer',
  textAlign: 'left',
}

const rowButtonSelectedStyle: CSSProperties = {
  ...rowButtonStyle,
  borderColor: 'var(--dsw-alias-brand-primary, #165dff)',
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(22,93,255,0.08))',
}

const tagStyle: CSSProperties = {
  flexShrink: 0,
  padding: '1px 6px',
  fontSize: 11,
  borderRadius: 4,
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(22,93,255,0.08))',
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
}

const countBadgeStyle: CSSProperties = {
  flexShrink: 0,
  minWidth: 22,
  padding: '1px 5px',
  fontSize: 11,
  borderRadius: 10,
  textAlign: 'center',
  background: 'var(--dsw-alias-bg-layer-1, #f2f3f5)',
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

const secondaryButtonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '5px 12px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  cursor: 'pointer',
}

const addCustomButtonStyle: CSSProperties = {
  marginTop: 4,
  alignSelf: 'flex-start',
  padding: '5px 12px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px dashed var(--dsw-alias-border-l3, #c9cdd4)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
  cursor: 'pointer',
}
