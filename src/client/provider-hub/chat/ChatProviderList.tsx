/**
 * 「对话供应商」区块：整页行卡片列表（对齐官方 ui-settings-models 的
 * ModelsSection 布局——行卡片 + 行内展开编辑器，而非左右分栏）。
 *
 * 行卡片显示：显示名、自定义/未配置标签、凭据状态点、右侧编辑/配置按钮；
 * 选中行的卡片内展开详情（由父组件 renderDetail 提供，包在官方 editor 填充面里）。
 * 已配置行 → 编辑；目录预设行 → 配置（创建）；底部「添加自定义提供方」。
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CSSProperties } from 'react'
import { getPath } from '@deepseek-ai/dsh-client-schema-form'
import { chatCopy, ensureProviderFieldStyles } from './ModelListEditor.tsx'
import { PerfBenchModal } from '../perf/PerfBenchModal.tsx'
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
  // 当前打开基准测试弹窗的供应商行（null = 关闭）。
  const [benchRow, setBenchRow] = useState<ProviderRow | null>(null)
  // 行内小胶囊按钮的 hover 态样式（与展开编辑器共用同一注入块）。
  useEffect(() => { ensureProviderFieldStyles() }, [])
  useEffect(() => {
    let alive = true
    const load = (): void => {
      fetch('/api/model-capabilities', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: any) => {
          if (!alive) return
          if (d && typeof d.capabilities === 'object' && d.capabilities !== null) {
            setCapabilities(d.capabilities as Record<string, string[]>)
          }
        })
        .catch(() => { /* 接口不可用则无标签 */ })
    }
    load()
    // 模型行勾选/取消生图/生视频后，实时刷新能力标签（无需刷新页面）
    window.addEventListener('dsh-webui:model-capabilities-changed', load)
    return () => {
      alive = false
      window.removeEventListener('dsh-webui:model-capabilities-changed', load)
    }
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
        <button type="button" className="dsh-webui-capsule-btn" style={smButtonStyle} onClick={onRetry}>
          {chatCopy.retry}
        </button>
      </section>
    )
  }

  return (
    <section style={sectionStyle}>
      {benchRow !== null
        ? (
          <PerfBenchModal
            provider={benchRow.entry.provider}
            models={modelsOf(state, benchRow).map(m => ({ id: String(m['id'] ?? ''), name: typeof m['name'] === 'string' ? m['name'] : undefined }))}
            onClose={() => { setBenchRow(null) }}
          />
        )
        : null}
      <SectionTitle />
      <DevRoleProbeBar />
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
            onBench={() => { setBenchRow(row) }}
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

/**
 * 「Developer Role 兼容」一键检测条：对全部 openai-completions 供应商真实发
 * developer/system 各一条最小请求做对照，判定不支持的自动写入路由级
 * compat.supportsDeveloperRole=false 并落盘。POST 启动 + GET 轮询逐项点亮，
 * 与模型行「一键检测」同一交互模式。
 */
const DEVROLE_API = '/api/webui-devrole/probe'

interface DevRoleItem {
  key: string
  label: string
  status: 'pending' | 'running' | 'done'
  ok: boolean | null
  model: string
  note: string
}

interface DevRoleState {
  running: boolean
  error: string
  saved: boolean
  saveError: string
  items: DevRoleItem[]
}

function DevRoleProbeBar(): ReactNode {
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<DevRoleState | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => { if (timer.current !== undefined) window.clearInterval(timer.current) }, [])

  const pollOnce = async (): Promise<void> => {
    try {
      const r = await fetch(DEVROLE_API, { cache: 'no-store' })
      const d: any = await r.json()
      if (!d?.ok || !d.state) return
      setState(d.state as DevRoleState)
      if (d.state.running === false) {
        if (timer.current !== undefined) window.clearInterval(timer.current)
        setBusy(false)
      }
    } catch { /* 轮询失败下次再试 */ }
  }

  const start = (): void => {
    if (busy) return
    setBusy(true)
    fetch(DEVROLE_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then(r => r.json())
      .then((d: any) => {
        if (!d?.ok) {
          setBusy(false)
          setState({ running: false, error: String(d?.error ?? '启动失败'), saved: false, saveError: '', items: [] })
          return
        }
        if (d.state !== null && d.state !== undefined) setState(d.state as DevRoleState)
        timer.current = window.setInterval(() => { void pollOnce() }, 800)
        void pollOnce()
      })
      .catch((error) => {
        setBusy(false)
        setState({ running: false, error: String(error?.message ?? error), saved: false, saveError: '', items: [] })
      })
  }

  return (
    <div style={probeBarStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          style={probeButtonStyle}
          disabled={busy}
          title="向每个供应商真实发送 developer / system 角色的最小请求做对照测试：不认 OpenAI “developer” 角色的网关（症状是该家推理模型一直报错连不通）会被自动改用传统 system 角色并保存，无需手动改配置。"
          onClick={start}
        >
          {busy ? '🛡 检测中…' : '🛡 一键兼容检测'}
        </button>
        <span style={hintStyle}>
          自动验证各供应商是否接受 OpenAI “developer” 角色，不接受的自动改用 system 并保存
        </span>
      </div>
      {(state?.error ?? '') !== ''
        ? <p style={errorStyle}>{`检测失败：${state!.error}`}</p>
        : null}
      {state !== null && state.items.length > 0
        ? (
          <div style={probePanelStyle}>
            {state.items.map(item => {
              const mark = item.status !== 'done'
                ? (item.status === 'running' ? '…' : '—')
                : item.ok === true ? '✓' : item.ok === false ? '✗ 已修复' : '?'
              const markColor = item.status !== 'done'
                ? 'var(--dsw-alias-label-tertiary, #8f959e)'
                : item.ok === true
                  ? 'var(--dsw-alias-state-success-primary, #00b42a)'
                  : item.ok === false
                    ? 'var(--dsw-alias-state-business-primary, #4176e6)'
                    : 'var(--dsw-alias-label-tertiary, #8f959e)'
              return (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '2px 0', minWidth: 0 }}>
                  <span style={{ flex: 'none', width: 120, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-primary, #1f2329)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </span>
                  <span style={{ flex: 'none', width: 86, fontSize: 12, lineHeight: '18px', color: markColor }}>
                    {mark}{item.status === 'running' ? ' 测试中' : ''}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8f959e)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.note}>
                    {item.note || `测试模型 ${item.model}`}
                  </span>
                </div>
              )
            })}
            {state.running === false
              ? (
                <p style={hintStyle}>
                  {state.saveError !== ''
                    ? `保存出错：${state.saveError}`
                    : `完成。${state.items.filter(i => i.ok === false).length} 家已自动改用 system 角色并保存；✓ 的保持现状。`}
                </p>
              )
              : null}
          </div>
        )
        : null}
    </div>
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
  row, preset, count, counts, selected, onSelect, onBench, renderDetail,
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
  /** 打开推理性能基准测试弹窗。 */
  onBench?: () => void
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
          {preset !== true && onBench !== undefined
            ? (
              <button
                type="button"
                className="dsh-webui-capsule-btn"
                style={smButtonStyle}
                onClick={(event) => { event.stopPropagation(); onBench() }}
              >
                测试
              </button>
            )
            : null}
          <button
            type="button"
            className="dsh-webui-capsule-btn"
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
  borderColor: 'var(--dsw-alias-state-business-primary, #4176e6)',
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
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(65,118,230,0.08))',
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

/* 官方行内小胶囊（Button .sm）：28px 高、14px 圆角、12px 字、0 10 内边距。 */
const smButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  height: 28, padding: '0 10px',
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

/* Developer Role 一键检测：容器 / 主按钮 / 结果面板。 */
const probeBarStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
}

const probeButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  height: 28, padding: '0 10px',
  border: '1px solid var(--dsw-alias-state-business-primary, #4176e6)',
  borderRadius: 14,
  background: 'transparent',
  color: 'var(--dsw-alias-state-business-primary, #4176e6)',
  fontSize: 12, lineHeight: '18px', cursor: 'pointer',
  flexShrink: 0,
}

const probePanelStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column',
  padding: '8px 12px',
  border: '1px solid var(--dsw-alias-border-l3, #e5e6eb)',
  borderRadius: 10,
}
