/**
 * webui — PlanWeave 设置卡（client 半身）。
 *
 * 注册进 `settings.plugin.item`（插件 → 可配置 页签），绑定 `planweave`
 * settings 命名空间：项目名 / 执行 provider / 执行 model / 每轮步数。
 * 样式复用 AnySearch 卡注入的 ase-* 类（同一 bundle，视觉与内置插件卡一致）；
 * 表单为轻量草稿态（无需 staged-edit 全状态机）。
 */

import { useEffect, useRef, useState } from 'react'
import type { ClientContext, SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ensureCardStyles } from '../AnySearchCard'
import { useModalClose } from '../modal-animation'
import { createPlanweaveApi, type PwProviderOption } from './api'
import { HelpModal } from './HelpModal'
// Type-only: 拉入 settings 槽位契约（ctx.settingsScope）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** 与 host 半身 SETTINGS_NS 一致（host 用 branded 包装同名命名空间）。 */
const NS = 'planweave'

/** 命名空间 section 形状（全部可选；缺省继承默认）。 */
interface PlanweaveSettings {
  projectName?: string
  provider?: string
  model?: string
  maxSteps?: number
}

/** 卡片状态投影。 */
export interface PwCardState {
  available: boolean
  writable: boolean
  projectName: string
  provider: string
  model: string
  maxSteps: number
}

function clsx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function fieldText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 把 scope 与保存动作桥接成卡片面。 */
class PwSettingsController {
  private readonly store: SnapshotStore<PwCardState>

  constructor(private readonly scope: SettingsScope<PlanweaveSettings>) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.store.set(this.projection()) })
  }

  private projection(): PwCardState {
    const snapshot = this.scope.getSnapshot()
    const value = (snapshot.value ?? {}) as Record<string, unknown>
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      projectName: fieldText(value.projectName),
      provider: fieldText(value.provider),
      model: fieldText(value.model),
      maxSteps: typeof value.maxSteps === 'number' ? value.maxSteps : 0,
    }
  }

  /** 逐字段写入；空串清除让字段回到默认。 */
  private async save(draft: Record<string, string>): Promise<void> {
    for (const [field, text] of Object.entries(draft)) {
      const trimmed = text.trim()
      if (field === 'maxSteps') {
        const parsed = Number(trimmed)
        if (trimmed === '') await this.scope.unset(field)
        else if (Number.isFinite(parsed)) await this.scope.set(field, Math.min(20, Math.max(1, Math.round(parsed))))
        continue
      }
      if (trimmed === '') await this.scope.unset(field)
      else await this.scope.set(field, trimmed)
    }
  }

  inject(): {
    hooks: { pwCard: SnapshotStore<PwCardState> }
    save: (draft: Record<string, string>) => Promise<void>
  } {
    return {
      hooks: { pwCard: this.store },
      save: draft => this.save(draft),
    }
  }
}

/** 一个带标签的文本输入行（ase-field 同款观感）。 */
function Field(props: {
  id: string
  label: string
  hint: string
  text: string
  overridden: boolean
  disabled: boolean
  numeric?: boolean
  placeholder?: string
  onEdit: (text: string) => void
  onReset: () => void
}): React.ReactElement {
  return (
    <div className="ase-field">
      <div className="ase-head">
        <label className="ase-label" htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className="ase-badges">
              <span className="ase-badge">已覆盖</span>
              <button type="button" className="ase-reset" disabled={props.disabled} onClick={props.onReset}>重置</button>
            </span>
          )
          : null}
      </div>
      <input
        id={props.id}
        className="ase-input"
        type="text"
        inputMode={props.numeric === true ? 'numeric' : undefined}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className="ase-hint">{props.hint}</p>
    </div>
  )
}

/** 一个带标签的下拉选择行（ase-input 同款观感）。 */
function SelectField(props: {
  id: string
  label: string
  hint: string
  value: string
  overridden: boolean
  disabled: boolean
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  onReset: () => void
}): React.ReactElement {
  return (
    <div className="ase-field">
      <div className="ase-head">
        <label className="ase-label" htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className="ase-badges">
              <span className="ase-badge">已覆盖</span>
              <button type="button" className="ase-reset" disabled={props.disabled} onClick={props.onReset}>重置</button>
            </span>
          )
          : null}
      </div>
      <select
        id={props.id}
        className="ase-input"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => { props.onChange(event.target.value) }}
      >
        {props.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <p className="ase-hint">{props.hint}</p>
    </div>
  )
}

/** 设置卡组件。 */
function PlanweaveSettingsCard(props: {
  usePwCard: (selector: (state: PwCardState) => PwCardState) => PwCardState
  save: (draft: Record<string, string>) => Promise<void>
}): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  const state = props.usePwCard(snapshot => snapshot)
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [providers, setProviders] = useState<PwProviderOption[] | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const help = useModalClose(helpOpen, () => { setHelpOpen(false) })
  const apiRef = useRef<ReturnType<typeof createPlanweaveApi> | null>(null)
  if (apiRef.current === null) apiRef.current = createPlanweaveApi()

  // 展开卡片时拉取一次供应商/模型清单（下拉数据源；失败回退手填）。
  useEffect(() => {
    if (!open || providers !== null) return
    void apiRef.current!.listProviders().then((result) => {
      setProviders(result.ok ? (result.providers ?? []) : [])
    })
  }, [open, providers])

  if (!state.available) return null

  const current: Record<string, string> = {
    projectName: state.projectName,
    provider: state.provider,
    model: state.model,
    maxSteps: state.maxSteps > 0 ? String(state.maxSteps) : '',
  }
  const view = draft ?? current
  const dirty = draft !== null && Object.keys(current).some(key => (draft[key] ?? '') !== (current[key] ?? ''))
  const blocked = !dirty || saving || !state.writable

  const edit = (field: string, text: string): void => {
    setDraft(previous => ({ ...(previous ?? current), [field]: text }))
    setFailed(false)
  }
  const resetField = (field: string): void => {
    setDraft(previous => ({ ...(previous ?? current), [field]: '' }))
  }

  const onSave = async (): Promise<void> => {
    if (blocked) return
    setSaving(true)
    setFailed(false)
    try {
      await props.save(draft ?? {})
      setDraft(null)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className={clsx('ase-card', 'pw-has-help', open && 'ase-cardOpen')}>
      <button
        type="button"
        className="ase-header"
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}: PlanWeave`}
        onClick={() => { setOpen(!open) }}
      >
        <span className="ase-headText">
          <span className="ase-name">PlanWeave</span>
          <span className="ase-description">计划任务图与执行循环：默认项目、执行模型与每轮步数</span>
        </span>
        {dirty ? <span className="ase-pending">未保存更改</span> : null}
        <IconChevronDownOutline14 className={clsx('ase-chevron', open && 'ase-chevronOpen')} />
      </button>
      {/* 使用说明入口：右上角小圆钮；stopPropagation 避免触发折叠。 */}
      <button
        type="button"
        className="pw-hlp-entry"
        aria-label="打开 PlanWeave 使用说明"
        title="使用说明"
        onClick={(event) => { event.stopPropagation(); setHelpOpen(true) }}
      >
        ?
      </button>
      {open
        ? (
          <div className="ase-body">
            {!state.writable ? <p className="ase-readOnly" role="status">当前设置文档为只读</p> : null}
            <Field
              id="plugin-config-planweave-project"
              label="项目名"
              hint="托管项目的稳定标识，同名即同一计划"
              text={view.projectName ?? ''}
              overridden={current.projectName !== ''}
              disabled={!state.writable}
              placeholder="default"
              onEdit={(text) => { edit('projectName', text) }}
              onReset={() => { resetField('projectName') }}
            />
            {(providers !== null && providers.length > 0) ? (
              <>
                <SelectField
                  id="plugin-config-planweave-provider"
                  label="执行 Provider"
                  hint="面板「推进」用的模型供应商（对话内工具执行走 subagent，不受此项限制）"
                  value={view.provider ?? ''}
                  overridden={current.provider !== ''}
                  disabled={!state.writable}
                  options={(() => {
                    const opts: Array<{ value: string; label: string }> = [{ value: '', label: '（未设置）' }]
                    for (const p of providers) {
                      opts.push({ value: p.id, label: p.displayName === p.id ? p.id : `${p.displayName} · ${p.id}` })
                    }
                    const cur = view.provider ?? ''
                    if (cur !== '' && !opts.some(o => o.value === cur)) {
                      opts.splice(1, 0, { value: cur, label: `${cur}（当前值，不在已配置列表）` })
                    }
                    return opts
                  })()}
                  onChange={(value) => {
                    // 切换供应商后旧模型多半不再有效，联动清空让用户重选。
                    edit('provider', value)
                    if ((view.model ?? '') !== '' && !(providers.find(p => p.id === value)?.models ?? []).includes(view.model ?? '')) {
                      edit('model', '')
                    }
                  }}
                  onReset={() => { resetField('provider'); resetField('model') }}
                />
                <SelectField
                  id="plugin-config-planweave-model"
                  label="执行 Model"
                  hint="与所选 Provider 配套的模型"
                  value={view.model ?? ''}
                  overridden={current.model !== ''}
                  disabled={!state.writable || (view.provider ?? '') === ''}
                  options={(() => {
                    const selected = providers.find(p => p.id === (view.provider ?? ''))
                    const models = selected?.models ?? []
                    const opts: Array<{ value: string; label: string }> = [{ value: '', label: '（未设置）' }]
                    for (const m of models) opts.push({ value: m, label: m })
                    const cur = view.model ?? ''
                    if (cur !== '' && !opts.some(o => o.value === cur)) {
                      opts.push({ value: cur, label: `${cur}（当前值，不在该供应商清单）` })
                    }
                    return opts
                  })()}
                  onChange={(value) => { edit('model', value) }}
                  onReset={() => { resetField('model') }}
                />
              </>
            ) : (
              <>
                <Field
                  id="plugin-config-planweave-provider"
                  label="执行 Provider"
                  hint={providers === null ? '正在加载可选供应商…（也可直接手填）' : '未读到已配置的供应商，手动填写 provider 键'}
                  text={view.provider ?? ''}
                  overridden={current.provider !== ''}
                  disabled={!state.writable}
                  placeholder="例如 deepseek"
                  onEdit={(text) => { edit('provider', text) }}
                  onReset={() => { resetField('provider') }}
                />
                <Field
                  id="plugin-config-planweave-model"
                  label="执行 Model"
                  hint="与 Provider 配套的模型 id"
                  text={view.model ?? ''}
                  overridden={current.model !== ''}
                  disabled={!state.writable}
                  placeholder="模型 id"
                  onEdit={(text) => { edit('model', text) }}
                  onReset={() => { resetField('model') }}
                />
              </>
            )}
            <Field
              id="plugin-config-planweave-steps"
              label="每轮步数"
              hint="单次「推进」最多执行的认领步数（1–20，留空默认 5）"
              text={view.maxSteps ?? ''}
              overridden={current.maxSteps !== ''}
              disabled={!state.writable}
              numeric
              onEdit={(text) => { edit('maxSteps', text) }}
              onReset={() => { resetField('maxSteps') }}
            />
            <div className="ase-footer">
              {failed ? <p className="ase-failed" role="status">保存失败，请重试</p> : null}
              <button type="button" className="ase-discard" disabled={!dirty || saving} onClick={() => { setDraft(null); setFailed(false) }}>
                放弃
              </button>
              <button type="button" className="ase-save" disabled={blocked} onClick={() => { void onSave() }}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )
        : null}
      <HelpModal open={helpOpen} closing={help.closing} onClose={help.requestClose} />
    </li>
  )
}

/**
 * 注册 PlanWeave 设置卡到插件配置页签。由 webui client 入口调用
 * （需 slots + settingsScope 服务）。
 */
export function registerPlanweaveSettingsCard(ctx: ClientContext): void {
  ensureCardStyles()
  const scope = ctx.settingsScope.bind({ namespace: NS }) as SettingsScope<PlanweaveSettings>
  const controller = new PwSettingsController(scope)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    // keyed slot：key 必须是本卡编辑的 settings 命名空间。
    key: NS,
    inject: () => controller.inject(),
  }, PlanweaveSettingsCard as never))
}
