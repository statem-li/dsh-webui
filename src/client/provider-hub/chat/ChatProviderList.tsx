/**
 * 「对话供应商」左栏导航：分组列表（已配置 / 目录预设）+ 底部「+ 添加自定义提供方」。
 *
 * 分栏布局（对齐常见网关控制台）：本组件只渲染导航列——图标 + 名称 + 凭据状态点；
 * 选中项的编辑详情由父组件 {@link ../ProviderHubSection.tsx} 渲染在右侧详情面板，
 * 因此这里不再承担行内展开编辑器、能力标签与基准测试入口。
 *
 * 「Developer Role 兼容」检测条（{@link DevRoleProbeBar}）也由父组件放到分栏之外的
 * 全宽区域——它的结果面板需要整页宽度。
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import { getPath } from '@deepseek-ai/dsh-client-schema-form'
import { chatCopy, ensureProviderFieldStyles } from './ModelListEditor.tsx'
import { ProviderIcon } from '../provider-icons.tsx'
import type { ModelsSettingsState, ProviderRow } from './store.ts'

/** {@link ChatProviderList} 的 props。 */
export interface ChatProviderListProps {
  /** 当前页面快照（由父组件注入，父组件负责 load）。 */
  state: ModelsSettingsState
  /** 当前选中的提供方 route id（右侧详情正在编辑的那个）。 */
  selected: string | undefined
  /** 点击一行提供方（已配置或目录预设）。 */
  onSelect: (provider: string) => void
  /** 点击「添加自定义提供方」。 */
  onAddCustom: () => void
  /** 整页加载失败后的重试。 */
  onRetry: () => void
}

/** 一行提供方的 models 数组（无则 []）；父组件的性能基准测试弹窗用它取模型清单。 */
export function modelsOf(state: ModelsSettingsState, row: ProviderRow): readonly Record<string, unknown>[] {
  const namespace = state.namespaces.get(row.entry.settingsNs)
  if (namespace === undefined) return []
  const models = getPath(namespace.value, [...row.entry.settingsPath, 'models'])
  return Array.isArray(models) ? models.filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null) : []
}

/**
 * 渲染「对话供应商」左栏导航。
 * @param props - 快照、选中态与回调。
 * @returns 导航栏（分组列表 + 添加按钮）。
 */
export function ChatProviderList(props: ChatProviderListProps): ReactNode {
  const { state, selected, onSelect, onAddCustom, onRetry } = props
  const configured = state.rows.filter(row => row.configured)
  const addable = state.rows.filter(row => !row.configured && row.entry.settingsNs !== '')

  // 行内小胶囊按钮的 hover 态样式（与展开编辑器共用同一注入块）。
  useEffect(() => { ensureProviderFieldStyles() }, [])

  if (state.status === 'loading' && state.rows.length === 0) {
    return (
      <section style={navColStyle}>
        <p style={titleStyle}>{chatCopy.chatTitle}</p>
        <p style={hintStyle}>加载中…</p>
      </section>
    )
  }
  if (state.status === 'error') {
    return (
      <section style={navColStyle}>
        <p style={titleStyle}>{chatCopy.chatTitle}</p>
        <p style={errorStyle}>{`${chatCopy.loadFailed}: ${state.error ?? ''}`}</p>
        <button type="button" className="dsh-webui-capsule-btn" style={addBtnStyle} onClick={onRetry}>
          {chatCopy.retry}
        </button>
      </section>
    )
  }

  return (
    <section style={navColStyle}>
      <p style={titleStyle}>{chatCopy.chatTitle}</p>

      <div style={navScrollStyle}>
        <p style={groupLabelStyle}>{chatCopy.configuredGroup}</p>
        {configured.length === 0 ? <p style={hintStyle}>暂无已配置的提供方。</p> : null}
        {configured.map(row => (
          <NavRow
            key={row.entry.provider}
            row={row}
            selected={selected === row.entry.provider}
            onSelect={() => { onSelect(row.entry.provider) }}
          />
        ))}

        <p style={{ ...groupLabelStyle, marginTop: 8 }}>{chatCopy.presetGroup}</p>
        {addable.length === 0 ? <p style={hintStyle}>目录中暂无其他提供方。</p> : null}
        {addable.map(row => (
          <NavRow
            key={row.entry.provider}
            row={row}
            preset
            selected={selected === row.entry.provider}
            onSelect={() => { onSelect(row.entry.provider) }}
          />
        ))}
      </div>

      <button
        type="button"
        className="dsh-webui-capsule-btn"
        style={addBtnStyle}
        disabled={!state.writable}
        onClick={onAddCustom}
      >
        + {chatCopy.addCustom}
      </button>
    </section>
  )
}

/** 左栏导航行：官方图标 + 名称 + 凭据状态点；选中行以填充面高亮。 */
function NavRow({
  row, preset, selected, onSelect,
}: {
  row: ProviderRow
  /** 目录预设行（未配置）：名称降级为次级文字色。 */
  preset?: boolean
  selected: boolean
  onSelect: () => void
}): ReactNode {
  return (
    <div
      className="dsh-webui-provider-nav-row"
      style={selected ? navRowSelectedStyle : navRowStyle}
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      title={row.entry.displayName}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }}
    >
      <ProviderIcon provider={row.entry.provider} name={row.entry.displayName} size={18} />
      <span style={preset === true ? navNamePresetStyle : navNameStyle}>{row.entry.displayName}</span>
      {preset !== true ? <CredentialDot row={row} /> : null}
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

/* ---------- 内联样式（对齐官方 ModelsSection.module.css 规格） ---------- */

/* 左栏：窄导航列（给右侧详情留出主要宽度）。 */
const navColStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  width: 200, flex: 'none', minWidth: 0,
}

const titleStyle: CSSProperties = {
  margin: 0, fontSize: 14, fontWeight: 600,
  color: 'var(--dsw-alias-label-primary, #1f2329)',
}

const groupLabelStyle: CSSProperties = {
  margin: '2px 0 0', fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

const hintStyle: CSSProperties = {
  margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #8f959e)',
}

const errorStyle: CSSProperties = {
  margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #d54941)',
}

/* 列表滚动区：目录很长时栏内自滚，「+ 添加」按钮始终钉在栏底可见。 */
const navScrollStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  overflowY: 'auto', minHeight: 0, maxHeight: 464,
  paddingRight: 2, marginLeft: -4, paddingLeft: 4,
}

/* 导航行：无描边，仅靠底色区分状态——描边（哪怕 transparent）会被主题/全局
 * 规则染色，在点过的行上留下外圈；状态一律用 background 表达。 */
const navRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
  minWidth: 0,
}

/* 选中态：填充面 + 左侧品牌色指示条（用 boxShadow inset 画，不占布局、不成描边）。 */
const navRowSelectedStyle: CSSProperties = {
  ...navRowStyle,
  background: 'var(--dsw-alias-bg-module-platform, #f2f3f5)',
  boxShadow: 'inset 3px 0 0 0 var(--dsw-alias-state-business-primary, #4176e6)',
}

const navNameStyle: CSSProperties = {
  fontSize: 13, lineHeight: '20px', fontWeight: 500, flex: 1, minWidth: 0,
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

const navNamePresetStyle: CSSProperties = {
  ...navNameStyle,
  fontWeight: 400,
  color: 'var(--dsw-alias-label-secondary, #4e5969)',
}

/* 官方行内小胶囊（Button .sm）：28px 高、14px 圆角、12px 字。 */
const addBtnStyle: CSSProperties = {
  boxSizing: 'border-box',
  alignSelf: 'flex-start',
  height: 28, padding: '0 10px', flexShrink: 0,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 14,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  fontSize: 12, lineHeight: '18px', cursor: 'pointer',
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

/** 渲染 Developer Role 兼容检测条（父组件放在分栏之外的全宽区域）。 */
export function DevRoleProbeBar(): ReactNode {
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
