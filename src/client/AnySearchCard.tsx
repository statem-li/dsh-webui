/**
 * AnySearch web-search provider settings card.
 *
 * Registers a card into `settings.plugin.item` (the Plugins → Configurable
 * tab) bound to the `web-search-anysearch` namespace. The card is an exact
 * visual re-implementation of the built-in plugin cards (`PluginCard` /
 * `SecretField` / `ValueField` / `CardForm` from `dsh-client-ui-settings-plugins`),
 * which are internal and not importable by a third-party plugin. The CSS is
 * copied verbatim (theme variables intact, class names prefixed `ase-`) and
 * injected once as a style sheet; the form state machine is the built-in
 * `CardForm` ported verbatim. The API key is written through the credentials
 * domain (never into the settings section), exactly like the built-in
 * web-search card does for DeepSeek.
 */

import { useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls in the settings slot contract (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * Declare the plugin-configuration card slot this package contributes into.
 * The slot's declarer lives in `dsh-client-ui-settings-plugins` (an internal
 * repo package a third-party plugin must not depend on), so the card claims
 * the slot by augmenting the platform SlotMap with its contract directly.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the plugin configuration section, keyed by settings namespace. */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root' }
  }
}

/** Namespace this card edits. Spelled here rather than imported: a client package must not depend on a Host package. */
export const NS = 'web-search-anysearch'

/** Credential reference the provider resolves when the section names none. */
export const DEFAULT_API_KEY_REF = 'ANYSEARCH_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

// ────────────────────────────────────────────────────────────────────────────
// Card form model — verbatim port of the built-in `CardForm`
// (`dsh-client-ui-settings-plugins/src/client/card-form.ts`).
// ────────────────────────────────────────────────────────────────────────────

/** The write one field's staged text performs when the card is saved. */
type FieldWrite =
  | { kind: 'set'; value: unknown }
  | { kind: 'clear' }

/** How one section field converts between its stored value and its draft text. */
interface CardFieldSpec {
  /** Field name inside the namespace section. */
  field: string
  /** Render a stored value as draft text; the empty string when the section carries none. */
  format: (value: unknown) => string
  /**
   * The write this draft text stages, or undefined when the text is not a
   * value this field accepts — which blocks the save rather than discarding it.
   */
  parse: (text: string) => FieldWrite | undefined
}

/** A control whose value is written outside the settings section. */
interface CardSecretSpec {
  /** Field name addressing this control inside the card's form. */
  field: string
  /** Write the staged text; resolves to whether the Host accepted it. */
  write: (text: string) => Promise<boolean>
}

/** One field as a card's control renders it. */
export interface CardFieldState {
  /** Draft text the control renders. */
  text: string
  /** Whether saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** Whether the draft is not a value this field accepts, which blocks saving. */
  invalid: boolean
}

/** Form state every plugin card shares. */
export interface CardShell {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
}

/** The write actions every plugin card's slot entry injects. */
export interface CardActions {
  /** Stage draft text for one field. */
  edit: (field: string, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  resetField: (field: string) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** One field's staged edit. */
interface StagedEdit {
  /** Draft text the control renders. */
  text: string
  /** True when this edit clears the field whatever text it shows. */
  clear: boolean
}

/** One staged edit resolved into the write a save performs. */
interface PlannedWrite {
  /** Field this entry writes. */
  field: string
  /** Perform the write; undefined when the draft is not a value the field accepts. */
  run: (() => Promise<boolean>) | undefined
}

/** A whole-number field; empty clears, non-finite numbers block the save. */
function numberField(field: string): CardFieldSpec {
  return {
    field,
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/** A free-text field; an empty draft clears the field. */
function textField(field: string): CardFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/** Stages one card's edits over one settings namespace and writes them on save. */
class CardForm<T> {
  private readonly specs: Map<string, CardFieldSpec>
  private readonly secretSpecs: Map<string, CardSecretSpec>
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  constructor(
    private readonly scope: SettingsScope<T>,
    specs: CardFieldSpec[],
    secrets: CardSecretSpec[] = [],
  ) {
    this.specs = new Map(specs.map(spec => [spec.field, spec]))
    this.secretSpecs = new Map(secrets.map(spec => [spec.field, spec]))
    scope.subscribe(() => { this.publish() })
  }

  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  shell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  field(field: string): CardFieldState {
    const staged = this.staged.get(field)
    if (this.secretSpecs.has(field)) {
      return { text: staged?.text ?? '', overridden: false, invalid: false }
    }
    const spec = this.spec(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return {
      text: staged.text,
      overridden: write?.kind === 'set',
      invalid: write === undefined,
    }
  }

  actions(): CardActions {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => {
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run])
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) {
      landed = await write() && landed
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const secret = this.secretSpecs.get(field)
      if (secret !== undefined) {
        const value = staged.text.trim()
        if (value !== '') plan.push({ field, run: () => secret.write(value) })
        continue
      }
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, run: () => this.clear(field) })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field, run: undefined })
      else if (write.kind === 'clear') plan.push({ field, run: () => this.clear(field) })
      else plan.push({ field, run: () => this.store(field, write.value) })
    }
    return plan
  }

  private async clear(field: string): Promise<boolean> {
    await this.scope.unset(field)
    return !this.stored(field)
  }

  private async store(field: string, value: unknown): Promise<boolean> {
    await this.scope.set(field, value)
    return this.userLayer()?.[field] === value
  }

  private stage(field: string, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private spec(field: string): CardFieldSpec {
    const spec = this.specs.get(field)
    if (spec === undefined) throw new Error(`plugin card has no field ${field}`)
    return spec
  }

  private snapshotOf(): SettingsScopeSnapshot<T> {
    return this.scope.getSnapshot()
  }

  private sectionValue(field: string): unknown {
    return (this.snapshotOf().value as Record<string, unknown> | undefined)?.[field]
  }

  private baseValue(field: string): unknown {
    return (this.snapshotOf().base as Record<string, unknown> | undefined)?.[field]
  }

  private userLayer(): Record<string, unknown> | undefined {
    return this.snapshotOf().user as Record<string, unknown> | undefined
  }

  private stored(field: string): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Card chrome CSS — verbatim port of the built-in `PluginCard.module.css` and
// `fields.module.css`, class names prefixed `ase-` to stay collision-free.
// Injected once; the theme variables come from the host design system.
// ────────────────────────────────────────────────────────────────────────────

const CARD_STYLES = `
.ase-card {
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color .16s, background .16s;
}
.ase-card:hover { border-color: var(--dsw-alias-label-dimmed); }
.ase-cardOpen {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
}
.ase-header {
  width: 100%;
  appearance: none;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
}
.ase-header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.ase-headText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ase-name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--dsw-alias-label-primary);
}
.ase-description {
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.ase-chevron {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform .16s;
}
.ase-chevronOpen { transform: rotate(180deg); }
.ase-body {
  border-top: 1px solid var(--dsw-alias-border-l2);
  margin: 0 16px;
  padding-bottom: 8px;
}
.ase-readOnly {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.ase-pending {
  flex: none;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.ase-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 4px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.ase-failed {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-error);
}
.ase-discard,
.ase-save {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 5px 14px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
}
.ase-discard {
  border-color: var(--dsw-alias-border-l2);
  background: none;
  color: var(--dsw-alias-label-secondary);
}
.ase-discard:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-dimmed);
}
.ase-save {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-layer-3);
}
.ase-discard:disabled,
.ase-save:disabled { opacity: 0.4; cursor: default; }
.ase-discard:focus-visible,
.ase-save:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

.ase-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}
.ase-field + .ase-field { border-top: 1px solid var(--dsw-alias-border-l2); }
.ase-head { display: flex; align-items: center; gap: 8px; }
.ase-label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.ase-badges { display: inline-flex; align-items: center; gap: 8px; }
.ase-badge {
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  white-space: nowrap;
  font-weight: 500;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.ase-badgeMuted {
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
}
.ase-reset {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.ase-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.ase-reset:disabled { cursor: default; }
.ase-input {
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.ase-input:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.ase-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.ase-inputInvalid { border-color: var(--dsw-alias-label-error); }
.ase-invalid {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-error);
}
.ase-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
`

/** Inject the card styles once. */
const STYLE_TAG_ID = 'dsh-web-search-anysearch-styles'
export function ensureCardStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_TAG_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_TAG_ID
  style.textContent = CARD_STYLES
  document.head.appendChild(style)
}

/** `clsx`-free class join. */
function clsx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ────────────────────────────────────────────────────────────────────────────
// Card controller, component, and its slot registration.
// ────────────────────────────────────────────────────────────────────────────

/** What the anysearch card renders. */
export interface AnySearchCardState extends CardShell {
  /** Provider endpoint. */
  baseURL: CardFieldState
  /** Default result count per request. */
  maxResults: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the anysearch card's slot entry injects. */
export interface AnySearchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useAnysearchCard. */
    anysearchCard: SnapshotStore<AnySearchCardState>
  }
}

/** Component-side view of the injected face. */
export type AnySearchCardProps = Omit<AnySearchCardFace, 'hooks'> & {
  useAnysearchCard: (selector: (state: AnySearchCardState) => AnySearchCardState) => AnySearchCardState
}

/** The namespace section this card edits. */
export interface AnySearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. */
  maxResults?: number
}

/** Bridges the `web-search-anysearch` scope and the credentials domain onto the card. */
class AnySearchCardController {
  private readonly form: CardForm<AnySearchSettings>
  private readonly store: SnapshotStore<AnySearchCardState>
  private credential: { ref: string; configured: boolean; writable: boolean } = {
    ref: DEFAULT_API_KEY_REF,
    configured: false,
    writable: true,
  }

  constructor(
    private readonly scope: SettingsScope<AnySearchSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [textField('baseURL'), numberField('maxResults')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): AnySearchCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      maxResults: this.form.field('maxResults'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /** Build the face the card's slot registration injects. */
  inject(): AnySearchCardFace {
    return { hooks: { anysearchCard: this.store }, ...this.form.actions() }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   * The answer is stored with the reference it describes, so a stale response
   * for a changed reference is dropped.
   */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch {
      return
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.result.value.credentials[ref]
    const next: { ref: string; configured: boolean; writable: boolean } = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /** Write the staged key, then re-read whether the Host now holds one. */
  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({ ref: refOf(this.scope.getSnapshot()), value })
    } catch {
      // Refusals surface through the re-read below.
    }
    await this.readCredential()
    return this.credential.configured
  }
}

/** The credential reference the section names, or the provider's default. */
function refOf(snapshot: SettingsScopeSnapshot<AnySearchSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}

/** One labelled text field control, matching the built-in `ValueField`. */
function ValueField(props: {
  id: string
  label: string
  hint: string
  text: string
  overridden: boolean
  invalid: boolean
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
              <button
                type="button"
                className="ase-reset"
                disabled={props.disabled}
                onClick={props.onReset}
              >
                重置
              </button>
            </span>
          )
          : null}
      </div>
      <input
        id={props.id}
        className={props.invalid ? 'ase-input ase-inputInvalid' : 'ase-input'}
        type="text"
        inputMode={props.numeric === true ? 'numeric' : undefined}
        aria-invalid={props.invalid || undefined}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={props.invalid ? 'ase-invalid' : 'ase-hint'}>
        {props.invalid ? '请输入有效的数字' : props.hint}
      </p>
    </div>
  )
}

/** Write-only credential control, matching the built-in `SecretField`. */
function SecretField(props: {
  id: string
  label: string
  hint: string
  text: string
  disabled: boolean
  configured: boolean
  onEdit: (text: string) => void
}): React.ReactElement {
  return (
    <div className="ase-field">
      <div className="ase-head">
        <label className="ase-label" htmlFor={props.id}>{props.label}</label>
        <span className="ase-badges">
          <span className={props.configured ? 'ase-badge' : 'ase-badgeMuted'}>
            {props.configured ? '已配置' : '未配置'}
          </span>
        </span>
      </div>
      <input
        id={props.id}
        className="ase-input"
        type="password"
        autoComplete="off"
        value={props.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className="ase-hint">{props.hint}</p>
    </div>
  )
}

/**
 * The card component. The slot dispatcher injects the face: `hooks` arrive as
 * the `useAnysearchCard` selector hook, and the action callbacks pass through.
 */
function AnySearchCard(props: AnySearchCardProps): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  const state = props.useAnysearchCard(snapshot => snapshot)
  if (!state.available) return null
  const title = '外接网页搜索'
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li className={clsx('ase-card', open && 'ase-cardOpen')}>
      <button
        type="button"
        className="ase-header"
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className="ase-headText">
          <span className="ase-name">{title}</span>
          <span className="ase-description">使用 AnySearch API（api.anysearch.com）的网页搜索提供者</span>
        </span>
        {state.dirty ? <span className="ase-pending">未保存更改</span> : null}
        <IconChevronDownOutline14 className={clsx('ase-chevron', open && 'ase-chevronOpen')} />
      </button>
      {open
        ? (
          <div className="ase-body">
            {!state.writable ? <p className="ase-readOnly" role="status">当前设置文档为只读</p> : null}
            <SecretField
              id="plugin-config-anysearch-key"
              label="API Key"
              hint={state.apiKeyConfigured ? '已配置，输入新 Key 以更换' : '粘贴 ANYSEARCH_API_KEY，留空则使用匿名免费层'}
              text={state.apiKey.text}
              disabled={!state.apiKeyWritable}
              configured={state.apiKeyConfigured}
              onEdit={(text) => { props.edit(API_KEY_FIELD, text) }}
            />
            <ValueField
              id="plugin-config-anysearch-base-url"
              label="Base URL"
              hint="AnySearch API 地址，/v1/search 自动拼接"
              text={state.baseURL.text}
              overridden={state.baseURL.overridden}
              invalid={state.baseURL.invalid}
              disabled={!state.writable}
              placeholder="https://api.anysearch.com"
              onEdit={(text) => { props.edit('baseURL', text) }}
              onReset={() => { props.resetField('baseURL') }}
            />
            <ValueField
              id="plugin-config-anysearch-max-results"
              label="默认结果数"
              hint="每次搜索默认返回的结果数量，可留空"
              text={state.maxResults.text}
              overridden={state.maxResults.overridden}
              invalid={state.maxResults.invalid}
              disabled={!state.writable}
              numeric
              onEdit={(text) => { props.edit('maxResults', text) }}
              onReset={() => { props.resetField('maxResults') }}
            />
            <div className="ase-footer">
              {state.failed ? <p className="ase-failed" role="status">保存失败，请重试</p> : null}
              <button
                type="button"
                className="ase-discard"
                disabled={!state.dirty || state.saving}
                onClick={props.discard}
              >
                放弃
              </button>
              <button
                type="button"
                className="ase-save"
                disabled={blocked}
                onClick={props.save}
              >
                {state.saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}

/**
 * Register the AnySearch card into the plugin-configuration section. Called by
 * the webui client entry so this package's SlotMap/declare-module augmentations
 * share one apply.
 * @param ctx - browser plugin context (needs slots + settingsScope + connection).
 */
export function registerAnySearchCard(ctx: ClientContext): void {
  ensureCardStyles()
  const handle = ctx.get('connection') as ConnectionHandle | undefined
  if (handle === undefined) return
  const scope = ctx.settingsScope.bind({ namespace: NS }) as SettingsScope<AnySearchSettings>
  const controller = new AnySearchCardController(scope, handle.api)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    // A keyed slot: the entry is dispatched by its key, and the key must be
    // the settings namespace the card edits (`web-search-anysearch`) so the
    // configurable-plugins tab pairs it with the section this plugin serves.
    key: NS,
    inject: () => controller.inject(),
  }, AnySearchCard as never))
}
