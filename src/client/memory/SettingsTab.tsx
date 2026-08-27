/**
 * dsh-memory 面板「设置」Tab：运行时配置（分组行卡片 + 开关 / 数值输入）。
 *
 * 每行 = 官方 rowCard 规格（border-l2 / r12 / 12-14 内距）：左侧标签 + 说明，
 * 右侧控件（开关或 32px 数值输入）。改动即时生效并持久化到 config.json；
 * 数值失焦或按 Enter 才提交（边输边提交会把「1」这类中间态写进配置），
 * 越界值由 host 按取值域钳制，这里同步显示允许范围。
 */

import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MemoryConfigView } from './api.js'
import type { MemoryT } from './locales.js'
import { css } from './styles.js'

/** 数值字段取值域（与 host CONFIG_NUMBER_BOUNDS 保持一致）。 */
const BOUNDS = {
  extractEveryTurns: { min: 1, max: 100, step: 1 },
  compileEveryTurns: { min: 1, max: 500, step: 1 },
  compileThreshold: { min: 0, max: 20, step: 0.5 },
  decayLambda: { min: 0, max: 0.5, step: 0.01 },
  hitBonus: { min: 0, max: 10, step: 0.5 },
  injectTokenBudget: { min: 1000, max: 60000, step: 500 },
  extractMaxChars: { min: 500, max: 60000, step: 500 },
  minImportance: { min: 1, max: 10, step: 0.5 },
  consolidateMaxEntries: { min: 10, max: 2000, step: 10 },
  consolidateTimeoutMs: { min: 5000, max: 600000, step: 5000 },
  injectTopK: { min: 1, max: 50, step: 1 },
  entryLimit: { min: 50, max: 100000, step: 50 },
} as const

/** 数值字段名。 */
type NumberKey = keyof typeof BOUNDS

/** 布尔字段名。 */
type BooleanKey = 'dailyCompileEnabled' | 'consolidateEnabled' | 'logApiRequests'

/** 一行设置（标签 + 说明 + 右侧控件）。 */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className={css.settingsRow}>
      <span className={css.settingsMain}>
        <span className={css.settingsLabel}>{label}</span>
        {hint !== undefined && hint !== '' && <span className={css.settingsHint}>{hint}</span>}
      </span>
      <span className={css.settingsControl}>{children}</span>
    </div>
  )
}

/** 文本输入行：本地草稿 + 失焦/Enter 提交（与 NumberRow 同款防中间态）。 */
function TextRow({ label, hint, value, placeholder, disabled, type = 'text', onCommit }: {
  label: string
  hint?: string
  value: string | undefined
  placeholder?: string
  disabled?: boolean
  type?: 'text' | 'password'
  onCommit: (next: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed !== (value ?? '')) onCommit(trimmed)
  }

  return (
    <Row label={label} hint={hint}>
      <input
        type={type}
        className={css.inlineInput}
        style={{ width: 200 }}
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        disabled={disabled}
        onChange={event => { setDraft(event.currentTarget.value) }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
      />
    </Row>
  )
}

/** 开关行。 */
function SwitchRow({ label, hint, value, disabled, onChange }: {
  label: string
  hint?: string
  value: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        className={css.switch}
        onClick={() => { onChange(!value) }}
      />
    </Row>
  )
}

/**
 * 数值行：本地草稿 + 失焦/Enter 提交。
 * 受控 input 直接 onChange 提交会导致「删空重打」的中间态（空串→NaN、单字符）
 * 被立刻写进配置；草稿态让用户可以自由编辑，只在确认时才落库。
 */
function NumberRow({ label, hint, field, value, t, onCommit }: {
  label: string
  hint?: string
  field: NumberKey
  value: number | undefined
  t: MemoryT
  onCommit: (next: number) => void
}): JSX.Element {
  const bounds = BOUNDS[field]
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  // 外部值变化（保存成功后 host 回传钳制结果 / 恢复默认）时同步草稿。
  useEffect(() => { setDraft(value === undefined ? '' : String(value)) }, [value])

  const commit = (): void => {
    const parsed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(value === undefined ? '' : String(value))
      return
    }
    const clamped = Math.min(bounds.max, Math.max(bounds.min, parsed))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  const rangeHint = t('rangeHint', { min: bounds.min, max: bounds.max })
  return (
    <Row label={label} hint={hint !== undefined && hint !== '' ? `${hint} ${rangeHint}` : rangeHint}>
      <input
        type="number"
        className={css.numberInput}
        aria-label={label}
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={draft}
        onChange={event => { setDraft(event.currentTarget.value) }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
      />
    </Row>
  )
}

/** 设置 Tab 内容。 */
export function SettingsTab({ config, busy = false, t, onPatch, onReset }: {
  config: MemoryConfigView | null
  busy?: boolean
  t: MemoryT
  onPatch: (patch: Partial<MemoryConfigView>) => void
  onReset: () => void
}): JSX.Element {
  if (config === null) {
    return (
      <div className={css.skeleton} aria-busy="true">
        <div className={css.skeletonRow} />
        <div className={css.skeletonRow} />
        <div className={css.skeletonRow} />
        <div className={css.skeletonRow} />
      </div>
    )
  }

  const num = (field: NumberKey): number | undefined => config[field]
  const bool = (field: BooleanKey): boolean => config[field] === true
  const str = (field: 'embeddingBaseUrl' | 'embeddingModel' | 'embeddingApiKey'): string | undefined => config[field]
  const setNum = (field: NumberKey) => (next: number): void => { onPatch({ [field]: next } as Partial<MemoryConfigView>) }
  const setBool = (field: BooleanKey) => (next: boolean): void => { onPatch({ [field]: next } as Partial<MemoryConfigView>) }
  const setStr = (field: 'embeddingBaseUrl' | 'embeddingModel' | 'embeddingApiKey') => (next: string): void => { onPatch({ [field]: next } as Partial<MemoryConfigView>) }
  const embeddingOn = config.embeddingProvider !== undefined && config.embeddingProvider !== 'off'

  return (
    <div className={css.settingsBody}>
      <section className={css.settingsGroup}>
        <h4 className={css.settingsGroupTitle}>{t('settingsGroupInject')}</h4>
        <NumberRow label={t('cfgInjectTopK')} hint={t('cfgInjectTopKHint')} field="injectTopK" value={num('injectTopK')} t={t} onCommit={setNum('injectTopK')} />
        <NumberRow label={t('cfgInjectTokenBudget')} field="injectTokenBudget" value={num('injectTokenBudget')} t={t} onCommit={setNum('injectTokenBudget')} />
      </section>

      <section className={css.settingsGroup}>
        <h4 className={css.settingsGroupTitle}>{t('settingsGroupExtract')}</h4>
        <NumberRow label={t('cfgExtractEveryTurns')} hint={t('cfgExtractEveryTurnsHint')} field="extractEveryTurns" value={num('extractEveryTurns')} t={t} onCommit={setNum('extractEveryTurns')} />
        <NumberRow label={t('cfgMinImportance')} hint={t('cfgMinImportanceHint')} field="minImportance" value={num('minImportance')} t={t} onCommit={setNum('minImportance')} />
        <NumberRow label={t('cfgExtractMaxChars')} field="extractMaxChars" value={num('extractMaxChars')} t={t} onCommit={setNum('extractMaxChars')} />
      </section>

      <section className={css.settingsGroup}>
        <h4 className={css.settingsGroupTitle}>{t('settingsGroupCompile')}</h4>
        <SwitchRow label={t('cfgDailyCompile')} value={bool('dailyCompileEnabled')} disabled={busy} onChange={setBool('dailyCompileEnabled')} />
        <NumberRow label={t('cfgCompileEveryTurns')} field="compileEveryTurns" value={num('compileEveryTurns')} t={t} onCommit={setNum('compileEveryTurns')} />
        <NumberRow label={t('cfgCompileThreshold')} field="compileThreshold" value={num('compileThreshold')} t={t} onCommit={setNum('compileThreshold')} />
        <NumberRow label={t('cfgDecayLambda')} hint={t('cfgDecayLambdaHint')} field="decayLambda" value={num('decayLambda')} t={t} onCommit={setNum('decayLambda')} />
        <NumberRow label={t('cfgHitBonus')} field="hitBonus" value={num('hitBonus')} t={t} onCommit={setNum('hitBonus')} />
        <NumberRow label={t('cfgEntryLimit')} hint={t('cfgEntryLimitHint')} field="entryLimit" value={num('entryLimit')} t={t} onCommit={setNum('entryLimit')} />
      </section>

      <section className={css.settingsGroup}>
        <h4 className={css.settingsGroupTitle}>{t('settingsGroupConsolidate')}</h4>
        <SwitchRow label={t('cfgConsolidate')} hint={t('consolidateHint')} value={bool('consolidateEnabled')} disabled={busy} onChange={setBool('consolidateEnabled')} />
        <NumberRow label={t('cfgConsolidateMax')} field="consolidateMaxEntries" value={num('consolidateMaxEntries')} t={t} onCommit={setNum('consolidateMaxEntries')} />
        <NumberRow label={t('cfgConsolidateTimeout')} field="consolidateTimeoutMs" value={num('consolidateTimeoutMs')} t={t} onCommit={setNum('consolidateTimeoutMs')} />
      </section>

      <section className={css.settingsGroup}>
        <h4 className={css.settingsGroupTitle}>{t('settingsGroupEmbedding')}</h4>
        <Row label={t('cfgEmbeddingProvider')} hint={t('cfgEmbeddingProviderHint')}>
          <select
            className={css.tagSelect}
            aria-label={t('cfgEmbeddingProvider')}
            value={config.embeddingProvider ?? 'off'}
            disabled={busy}
            onChange={event => { onPatch({ embeddingProvider: event.currentTarget.value as 'off' | 'http' | 'local' }) }}
          >
            <option value="off">{t('cfgEmbeddingOff')}</option>
            <option value="http">{t('cfgEmbeddingHttp')}</option>
            <option value="local">{t('cfgEmbeddingLocal')}</option>
          </select>
        </Row>
        {embeddingOn && (
          <>
            <TextRow label={t('cfgEmbeddingBaseUrl')} hint={t('cfgEmbeddingBaseUrlHint')} value={str('embeddingBaseUrl')} placeholder="https://api.openai.com/v1" disabled={busy} onCommit={setStr('embeddingBaseUrl')} />
            <TextRow label={t('cfgEmbeddingModel')} hint={t('cfgEmbeddingModelHint')} value={str('embeddingModel')} placeholder="text-embedding-3-small" disabled={busy} onCommit={setStr('embeddingModel')} />
            <TextRow label={t('cfgEmbeddingApiKey')} hint={t('cfgEmbeddingApiKeyHint')} value={str('embeddingApiKey')} placeholder={t('cfgEmbeddingApiKeyPlaceholder')} type="password" disabled={busy} onCommit={setStr('embeddingApiKey')} />
            {config.embeddingProvider === 'local' && (
              <div className={css.settingsHint}>{t('cfgEmbeddingLocalHint')}</div>
            )}
          </>
        )}
      </section>

      <section className={css.settingsGroup}>
        <h4 className={css.settingsGroupTitle}>{t('settingsGroupDiag')}</h4>
        <SwitchRow label={t('cfgLogApi')} hint={t('cfgLogApiHint')} value={bool('logApiRequests')} disabled={busy} onChange={setBool('logApiRequests')} />
      </section>

      <div className={css.settingsFoot}>
        <Button variant="outline" size="sm" disabled={busy} onClick={onReset}>{t('settingsReset')}</Button>
      </div>
    </div>
  )
}
