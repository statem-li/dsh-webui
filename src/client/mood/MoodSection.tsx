/**
 * webui — MOOD 设置页（client 半身）。
 *
 * 槽位 `settings.section`（设置 → MOOD）。布局对齐官方 ui-settings-models：
 * 整页行卡片列表，点击行内展开编辑器；不用左右分栏、不用卡片网格。
 *
 * 页面结构：
 *  1. 顶部两行通用设置：总开关 + 默认人设（未单独配置的 Agent 都用它）；
 *  2. 「按 Agent 预设」行卡片列表：每行一个 preset，行内开关控制该 Agent 是否
 *     输出 MOOD，点行展开 textarea 编辑该 Agent 专属人设；留空 = 沿用默认人设。
 *
 * 数据面在 ./api.ts（单一 host 路由），本文件只管呈现与草稿态。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-settings 的 SlotMap 合并声明（settings.section 契约）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { fetchMood, saveMood, type MoodEntry, type MoodPresetRow, type MoodState } from './api'

// ── 样式（对齐官方 ModelsSection.module.css 规格）────────────────────────────

const page: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760, minWidth: 0 }
const groupTitle: CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const groupHint: CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: '20px' }
const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0' }
const rowCopy: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }
const rowTitle: CSSProperties = { fontSize: 14, color: 'var(--dsw-alias-label-primary)' }
const rowDesc: CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
const rowCard: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10,
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: '12px 14px',
}
const editor: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  background: 'var(--dsw-alias-bg-module-platform)', borderRadius: 12, padding: '14px 16px',
}
const textarea: CSSProperties = {
  width: '100%', minHeight: 132, boxSizing: 'border-box',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '8px 10px',
  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
  fontSize: 14, lineHeight: '22px', resize: 'vertical',
}
const pill: CSSProperties = {
  flex: 'none', height: 28, borderRadius: 14, padding: '0 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
}
const pillPrimary: CSSProperties = {
  ...pill,
  border: '1px solid transparent',
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
}
const tag: CSSProperties = {
  flex: 'none', border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 4,
  padding: '0 5px', fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)',
}
const switchBase: CSSProperties = {
  position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
  flex: 'none', background: 'var(--dsw-alias-border-l2)', transition: 'background .15s', padding: 0,
}
// 开启态用品牌蓝（state-business-primary）；brand-primary 是反色设计，不能用。
const switchOn: CSSProperties = { ...switchBase, background: 'var(--dsw-alias-state-business-primary)' }
const knob: CSSProperties = {
  position: 'absolute', top: 2, left: 2, width: 18, height: 18, borderRadius: '50%',
  background: 'var(--dsw-alias-label-tertiary)', transition: 'left .15s, background .15s',
  boxShadow: '0 1px 2px rgba(0,0,0,.2)',
}
const knobOn: CSSProperties = { ...knob, left: 20, background: '#fff' }
const listStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }
const rowHead: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }
const rowButton: CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, textAlign: 'left',
  border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
}
const nameStyle: CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }
const actions: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }

/** 行式开关。 */
function Switch(props: { on: boolean, label: string, disabled?: boolean, onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      style={props.on ? switchOn : switchBase}
      disabled={props.disabled === true}
      onClick={props.onToggle}
    >
      <span style={props.on ? knobOn : knob} />
    </button>
  )
}

/** 一行 preset 卡片：行内开关 + 展开的人设编辑器。 */
function PresetRow(props: {
  row: MoodPresetRow
  entry: MoodEntry | undefined
  defaultPersona: string
  open: boolean
  onOpen: () => void
  onPatch: (patch: MoodEntry | null) => void
}): JSX.Element {
  const { row, entry, open } = props
  const on = entry?.enabled !== false
  const persona = entry?.persona ?? ''
  const [draft, setDraft] = useState(persona)
  // 折叠时丢弃未保存草稿：展开是一次新的编辑会话。
  useEffect(() => { if (open) setDraft(persona) }, [open, persona])

  const custom = persona.trim() !== ''
  return (
    <div style={rowCard}>
      <div style={rowHead}>
        <button type="button" style={rowButton} onClick={props.onOpen}>
          <span style={nameStyle}>{row.name ?? row.id}</span>
          <span style={rowDesc}>
            {row.id}
            {custom ? ' · 专属人设' : ' · 沿用默认人设'}
          </span>
        </button>
        {row.isDefault && <span style={tag}>默认</span>}
        {row.trust === 'system' && <span style={tag}>随附</span>}
        {row.broken !== undefined && <span style={{ ...tag, color: 'var(--dsw-alias-state-error-primary)' }}>损坏</span>}
        <Switch
          on={on}
          label={(row.name ?? row.id) + ' 的 MOOD 开关'}
          onToggle={() => { props.onPatch({ enabled: !on, persona }) }}
        />
      </div>
      {open && (
        <div style={editor}>
          <span style={groupHint}>
            这个 Agent 专属的 MOOD 人设。留空则沿用上方的默认人设。
          </span>
          <textarea
            style={textarea}
            value={draft}
            placeholder={props.defaultPersona}
            spellCheck={false}
            aria-label={(row.name ?? row.id) + ' 的 MOOD 人设'}
            onChange={(event) => { setDraft(event.target.value) }}
          />
          <div style={actions}>
            <button
              type="button"
              style={pillPrimary}
              onClick={() => { props.onPatch({ enabled: on, persona: draft }) }}
            >
              保存
            </button>
            <button
              type="button"
              style={pill}
              disabled={!custom}
              onClick={() => { setDraft(''); props.onPatch(null) }}
            >
              沿用默认
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** MOOD 设置页主体。 */
export function MoodSection(): JSX.Element {
  const [state, setState] = useState<MoodState | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [defaultDraft, setDefaultDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void fetchMood().then((next) => {
      if (!alive || next === null) return
      setState(next)
      setDefaultDraft(next.defaultPersona)
    })
    return () => { alive = false }
  }, [])

  const commit = useCallback(async (patch: Parameters<typeof saveMood>[0]) => {
    setBusy(true)
    const next = await saveMood(patch)
    setBusy(false)
    if (next === null) return
    setState(next)
    if (patch.defaultPersona !== undefined) setDefaultDraft(next.defaultPersona)
  }, [])

  const roster = useMemo(() => state?.roster ?? [], [state])

  if (state === null) {
    return <div style={page}><span style={groupHint}>读取 MOOD 配置…</span></div>
  }

  return (
    <div style={page}>
      <div style={rowCard}>
        <div style={row}>
          <div style={rowCopy}>
            <span style={rowTitle}>MOOD 自述</span>
            <span style={rowDesc}>
              开启后，Agent 会在思考结束、正式回答之前先写一段第一人称自述，渲染成对话流里的 MOOD 卡片。
            </span>
          </div>
          <Switch
            on={state.enabled}
            label="MOOD 总开关"
            disabled={busy}
            onToggle={() => { void commit({ enabled: !state.enabled }) }}
          />
        </div>
      </div>

      <div style={rowCard}>
        <span style={groupTitle}>默认人设</span>
        <span style={groupHint}>
          没有单独配置的 Agent（包含以后新建的）都用这段人设。小节名可以随意改——卡片按「小节名: / 条目」自动分节。
        </span>
        <textarea
          style={textarea}
          value={defaultDraft}
          spellCheck={false}
          aria-label="MOOD 默认人设"
          onChange={(event) => { setDefaultDraft(event.target.value) }}
        />
        <div style={actions}>
          <button
            type="button"
            style={pillPrimary}
            disabled={busy || defaultDraft.trim() === ""}
            onClick={() => { void commit({ defaultPersona: defaultDraft }) }}
          >
            保存
          </button>
          <button
            type="button"
            style={pill}
            disabled={busy || state.template === ""}
            onClick={() => { void commit({ defaultPersona: state.template }) }}
          >
            恢复出厂模板
          </button>
        </div>
      </div>

      <span style={groupTitle}>按 Agent 预设</span>
      {roster.length === 0 && (
        <span style={groupHint}>
          当前部署没有 Agent 预设名单（agent-presets 未组装）。所有 Agent 统一使用上方的默认人设。
        </span>
      )}
      <div style={listStyle}>
        {roster.map(item => (
          <PresetRow
            key={item.id}
            row={item}
            entry={state.presets[item.id]}
            defaultPersona={state.defaultPersona}
            open={openId === item.id}
            onOpen={() => { setOpenId(current => (current === item.id ? null : item.id)) }}
            onPatch={(patch) => { void commit({ presets: { [item.id]: patch } }) }}
          />
        ))}
      </div>
    </div>
  )
}

/** 注册 MOOD 设置页（settings.section）。 */
export function applyMoodSettings(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'mood',
      order: 24,
      label: () => 'MOOD',
    }, MoodSection))
}
