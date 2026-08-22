/**
 * 「对话供应商」区块：整页行卡片列表（对齐官方 ui-settings-models 的
 * ModelsSection 布局——行卡片 + 行内展开编辑器，而非左右分栏）。
 *
 * 行卡片显示：显示名、自定义/未配置标签、凭据状态点、右侧编辑/配置按钮；
 * 选中行的卡片内展开详情（由父组件 renderDetail 提供，包在官方 editor 填充面里）。
 * 已配置行 → 编辑；目录预设行 → 配置（创建）；底部「添加自定义提供方」。
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { CSSProperties } from 'react'
import { getPath } from '@deepseek-ai/dsh-client-schema-form'
import { chatCopy } from './ModelListEditor.tsx'
import type { ModelsSettingsState, ProviderRow } from './store.ts'

/** {@link ChatProviderList} 的 props。 */
export interface ChatProviderListProps {
  /** 当前页面快照（由父组件注入，父组件负责 load）。 */
  state: ModelsSettingsState
  /** 当前选中的提供方 route id（详情正在编辑的那个）。 */
  selected: string | undefined
  /** 点击一行提供方（已配置或目录预设）。 */
  onSelect: (provider: string) => void
  /** 点击「添加自定义提供方」。 */
  onAddCustom: () => void
  /** 整页加载失败后的重试。 */
  onRetry: () => void
  /** 选中行卡片内展开的详情内容（父组件渲染，含关闭）。 */
  renderDetail?: (provider: string) => ReactNode
}

/** 一行提供方解析出的 profile 中 `models` 数组的长度（无则 0）。 */
export function modelsCountOf(state: ModelsSettingsState, row: ProviderRow): number {
  const namespace = state.namespaces.get(row.entry.settingsNs)
  if (namespace === undefined) return 0
  const models = getPath(namespace.value, [...row.entry.settingsPath, 'models'])
  return Array.isArray(models) ? models.length : 0
}

/** 一行提供方的 models 数组（无则 []）。 */
function modelsOf(state: ModelsSettingsState, row: ProviderRow): readonly Record<string, unknown>[] {
  const namespace = state.namespaces.get(row.entry.settingsNs)
  if (namespace === undefined) return []
  const models = getPath(namespace.value, [...row.entry.settingsPath, 'models'])
  return Array.isArray(models) ? models.filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null) : []
}

/** 一行提供方的能力统计：{ vision, image, video } 各支持几个模型。 */
export interface CapabilityCounts { vision: number; image: number; video: number }

export function capabilityCountsOf(
  state: ModelsSettingsState,
  row: ProviderRow,
  capabilities: Record<string, string[]>,
): CapabilityCounts {
  const counts: CapabilityCounts = { vision: 0, image: 0, video: 0 }
  for (const model of modelsOf(state, row)) {
    const input = model['input']
    if (Array.isArray(input) && (input as string[]).includes('image')) counts.vision++
    const id = typeof model['id'] === 'string' ? model['id'] : ''
    if (!id) continue
    const caps = capabilities[`${row.entry.provider}/${id}`] ?? []
    if (caps.includes('image')) counts.image++
    if (caps.includes('video')) counts.video++
  }
  return counts
}

/**
 * 渲染「对话供应商」区块。
 * @param props - 快照、选中态与回调。
 * @returns 行卡片列表。
 */
export function ChatProviderList(props: ChatProviderListProps): ReactNode {
  const { state, selected, onSelect, onAddCustom, onRetry, renderDetail } = props
  const configured = state.rows.filter(row => row.configured)
  const addable = state.rows.filter(row => !row.configured && row.entry.settingsNs !== '')

  // 模型能力声明（model-router.json capabilities），用于行卡片显示能力标签。
  const [capabilities, setCapabilities] = useState<Record<string, string[]>>({})
  useEffect(() => {
    let alive = true
    fetch('/api/model-capabilities', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: any) => {
        if (!alive) return
        if (d && typeof d.capabilities === 'object' && d.capabilities !== null) {
          setCapabilities(d.capabilities as Record<string, string[]>)
        }
      })
      .catch(() => { /* 接口不可用则无标签 */ })
    return () => { alive = false }
  }, [])

  if (state.status === 'loading' && state.rows.length === 0) {
    return (
      <section style={sectionStyle}>
        <SectionTitle />
        <p style={hintStyle}>加载中…</p>
      </section>
    )
  }
  if (state.status === 'error') {
    return (
      <section style={sectionStyle}>
        <SectionTitle />
        <p style={errorStyle}>{`${chatCopy.loadFailed}: ${state.error ?? ''}`}</p>
        <button type="button" style={smButtonStyle} onClick={onRetry}>
          {chatCopy.retry}
        </button>
      </section>
    )
  }

  return (
    <section style={sectionStyle}>
      <SectionTitle />
      {!state.writable && state.status === 'ready' ? <p style={hintStyle}>{chatCopy.readOnly}</p> : null}

      <p style={groupLabelStyle}>{chatCopy.configuredGroup}</p>
      {configured.length === 0 ? <p style={hintStyle}>暂无已配置的提供方。</p> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {configured.map(row => (
          <ProviderRowCard
            key={row.entry.provider}
            row={row}
            count={modelsCountOf(state, row)}
            counts={capabilityCountsOf(state, row, capabilities)}
            selected={selected === row.entry.provider}
            onSelect={() => { onSelect(row.entry.provider) }}
            renderDetail={renderDetail}
          />
        ))}
      </div>

      <p style={groupLabelStyle}>{chatCopy.presetGroup}</p>
      {addable.length === 0 ? <p style={hintStyle}>目录中暂无其他提供方。</p> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {addable.map(row => (
          <ProviderRowCard
            key={row.entry.provider}
            row={row}
            preset
            count={modelsCountOf(state, row)}
            counts={capabilityCountsOf(state, row, capabilities)}
            selected={selected === row.entry.provider}
            onSelect={() => { onSelect(row.entry.provider) }}
            renderDetail={renderDetail}
          />
        ))}
      </div>

      <button
        type="button"
        style={addButtonStyle}
        disabled={!state.writable}
        onClick={onAddCustom}
      >
        + {chatCopy.addCustom}
      </button>
    </section>
  )
}

/** 区块标题。 */
function SectionTitle(): ReactNode {
  return <p style={titleStyle}>{chatCopy.chatTitle}</p>
}

/** 分组小标题。 */
function GroupLabel({ children }: { children: ReactNode }): ReactNode {
  return <p style={groupLabelStyle}>{children}</p>
}

/** 一行提供方卡片（已配置行或目录预设行），选中时卡片内展开详情。 */
function ProviderRowCard({
  row, preset, count, counts, selected, onSelect, renderDetail,
}: {
  row: ProviderRow
  /** 目录预设行（未配置）时加「未配置」标记并显示「配置」按钮。 */
  preset?: boolean
  /** 该 profile 当前的模型数。 */
  count: number
  /** 该 profile 的能力统计（视觉/生图/生视频各几个模型）。 */
  counts: CapabilityCounts
  selected: boolean
  onSelect: () => void
  renderDetail?: (provider: string) => ReactNode
}): ReactNode {
  const capTags: Array<{ key: string; label: string; n: number }> = [
    { key: 'vision', label: '视觉', n: counts.vision },
    { key: 'image', label: '生图', n: counts.image },
    { key: 'video', label: '生视频', n: counts.video },
  ].filter(item => item.n > 0)
  return (
    <div style={selected ? rowCardSelectedStyle : rowCardStyle}>
      <div
        style={rowHeadStyle}
        role="button"
        tabIndex={0}
        aria-expanded={selected}
        onClick={onSelect}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }}
      >
        <span style={rowIdentityStyle}>
          <span style={rowNameStyle}>{row.entry.displayName}</span>
          {row.entry.declared === true
            ? <span style={tagStyle}>{chatCopy.customTag}</span>
            : null}
          {preset === true ? <span style={tagStyle}>{chatCopy.unconfigured}</span> : null}
          {preset !== true ? <CredentialDot row={row} /> : null}
          <span style={countBadgeStyle} title={`${count} 模型`}>{count}</span>
          {capTags.map(item => (
            <span key={item.key} style={capabilityTagStyle} title={`${item.label}：${item.n} 个模型`}>
              {item.label} {item.n}
            </span>
          ))}
        </span>
        <span style={rowActionsStyle}>
          <button
            type="button"
            style={smButtonStyle}
            onClick={(event) => { event.stopPropagation(); onSelect() }}
          >
            {preset === true ? '配置' : '编辑'}
          </button>
        </span>
      </div>
      {selected && renderDetail !== undefined
        ? (
          <div style={editorStyle}>
            {renderDetail(row.entry.provider)}
          </div>
        )
        : null}
    </div>
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

/* ---------- 内联样式（对齐官方 ModelsSection.module.css） ---------- */

const sectionStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, maxWidth: 760,
}

const titleStyle: CSSProperties = {
  margin: 0, fontSize: 14, fontWeight: 600,
  color: 'var(--dsw-alias-label-primary, #1f2329)',
}

const groupLabelStyle: CSSProperties = {
  margin: '6px 0 0', fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

const hintStyle: CSSProperties = {
  margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

const errorStyle: CSSProperties = {
  margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #d54941)',
}

/* 官方 .rowCard：细边框、12px 圆角、无底色，面板上以描边呈现。 */
const rowCardStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 12,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const rowCardSelectedStyle: CSSProperties = {
  ...rowCardStyle,
  borderColor: 'var(--dsw-alias-state-business-primary, #165dff)',
}

/* 官方 .rowHead。 */
const rowHeadStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', minWidth: 0,
}

const rowIdentityStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1,
}

/* 官方 .rowName：14px / 500。 */
const rowNameStyle: CSSProperties = {
  fontSize: 14, lineHeight: '22px', fontWeight: 500,
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

/* 官方 .rowTag：细边框小标签。 */
const tagStyle: CSSProperties = {
  flexShrink: 0, padding: '1px 6px',
  border: '1px solid var(--dsw-alias-border-l3, #c9cdd4)',
  borderRadius: 4, fontSize: 11, lineHeight: '16px',
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
}

const countBadgeStyle: CSSProperties = {
  flexShrink: 0, minWidth: 20, padding: '1px 5px',
  fontSize: 11, borderRadius: 10, textAlign: 'center',
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(22,93,255,0.08))',
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

/* 能力标签：视觉/生图/生视频，标注该供应商下支持各能力的模型数。 */
const capabilityTagStyle: CSSProperties = {
  flexShrink: 0, padding: '1px 6px',
  fontSize: 11, lineHeight: '16px', borderRadius: 4,
  background: 'var(--dsw-alias-state-business-primary, #4176e6)',
  color: '#fff',
}

const rowActionsStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
}

/* 官方行内小胶囊：28px 高、14px 圆角、12px 字。 */
const smButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  height: 28, padding: '0 12px',
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 14,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  fontSize: 12, lineHeight: '18px', cursor: 'pointer',
}

/* 官方 .addButton：36px 高、18px 圆角胶囊。 */
const addButtonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  boxSizing: 'border-box',
  height: 36, padding: '0 14px', marginTop: 4,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 18,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  fontSize: 14, lineHeight: '22px', cursor: 'pointer',
}

/* 官方 .editor：填充面。 */
const editorStyle: CSSProperties = {
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-module-platform, #f2f3f5)',
  padding: '14px 16px',
  display: 'flex', flexDirection: 'column', gap: 12,
}
