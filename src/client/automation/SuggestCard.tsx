/**
 * automation — AI 建议确认卡（openhanako CronConfirmBlock 同款流程）。
 *
 * Agent 通过 automation 工具 create/update 时生成待确认建议；本卡展示建议
 * 概要，展开后用户可修改名称 / 计划 / 执行内容再应用；拒绝则丢弃。
 */

import { useEffect, useState } from 'react'
import type { SuggestionView } from './types.ts'
import {
  scheduleDraftFromStored,
  schedulePreviewFromDraft,
  storedScheduleFromDraft,
  type ScheduleDraft,
} from './schedule-draft.ts'
import { applySuggestion, dismissSuggestion } from './api.ts'
import { t } from './locales.ts'
import { ScheduleEditor } from './ScheduleEditor.tsx'

export function SuggestCard({ suggestion, onDone, onError }: {
  suggestion: SuggestionView
  /** 应用或拒绝成功后回调（容器刷新数据）。 */
  onDone: (appliedLabel: string | null) => void
  /** 应用失败回调（容器 toast）。 */
  onError: (message: string) => void
}): JSX.Element {
  const jobData = suggestion.jobData
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState(typeof jobData.label === 'string' ? jobData.label : '')
  const [draft, setDraft] = useState<ScheduleDraft>(() =>
    scheduleDraftFromStored(jobData.type, jobData.schedule))
  const [prompt, setPrompt] = useState(typeof jobData.prompt === 'string' ? jobData.prompt : '')

  useEffect(() => {
    const data = suggestion.jobData
    setLabel(typeof data.label === 'string' ? data.label : '')
    setDraft(scheduleDraftFromStored(data.type, data.schedule))
    setPrompt(typeof data.prompt === 'string' ? data.prompt : '')
  }, [suggestion])

  const preview = schedulePreviewFromDraft(scheduleDraftFromStored(suggestion.jobData.type, suggestion.jobData.schedule))
  const expiringSoon = suggestion.expiresAt - Date.now() < 3 * 60_000

  const apply = async (): Promise<void> => {
    if (busy) return
    if (prompt.trim() === '') {
      onError(t('promptRequired'))
      return
    }
    setBusy(true)
    try {
      const stored = storedScheduleFromDraft(draft)
      await applySuggestion(suggestion.suggestionId, {
        type: stored.type,
        schedule: stored.schedule,
        prompt,
        label: label.trim() !== '' ? label.trim() : (prompt.slice(0, 40)),
      })
      onDone(label.trim() !== '' ? label.trim() : prompt.slice(0, 30))
    } catch (error) {
      onError(`${t('suggestApplyFailed')}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const reject = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await dismissSuggestion(suggestion.suggestionId)
      onDone(null)
    } catch (error) {
      onError(`${t('suggestApplyFailed')}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auto-suggest">
      <div className="auto-suggest-head">
        <span className="auto-suggest-kind">{suggestion.operation === 'update' ? t('suggestUpdate') : t('suggestCreate')}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {(typeof suggestion.jobData.label === 'string' && suggestion.jobData.label !== '') ? suggestion.jobData.label : preview}
        </span>
        {expiringSoon ? <span className="auto-suggest-kind" style={{ color: 'var(--dsw-alias-state-error-primary,#e0434b)', borderColor: 'var(--dsw-alias-state-error-primary,#e0434b)' }}>{t('suggestExpireSoon')}</span> : null}
      </div>

      {!open ? (
        <>
          <div className="auto-suggest-desc">
            {preview}
            {(suggestion.jobData.prompt ?? '') !== '' ? `｜${suggestion.jobData.prompt}` : ''}
          </div>
          <div className="auto-suggest-actions">
            <button type="button" className="auto-btn auto-btn-primary" onClick={() => setOpen(true)}>
              {t('suggestView')}
            </button>
            <button type="button" className="auto-btn auto-btn-danger" disabled={busy} onClick={() => void reject()}>
              {t('suggestReject')}
            </button>
          </div>
        </>
      ) : (
        <div className="auto-editor" style={{ margin: 0, padding: '10px 12px' }}>
          <label className="auto-field">
            <span>{t('fieldLabel')}</span>
            <input className="auto-input" value={label} spellCheck={false} onChange={event => setLabel(event.target.value)} />
          </label>
          <ScheduleEditor draft={draft} onChange={setDraft} />
          <label className="auto-field">
            <span>{t('fieldPrompt')}</span>
            <textarea className="auto-textarea" value={prompt} spellCheck={false} onChange={event => setPrompt(event.target.value)} />
          </label>
          <div className="auto-suggest-actions">
            <button type="button" className="auto-btn auto-btn-primary" disabled={busy} onClick={() => void apply()}>
              {suggestion.operation === 'update' ? t('suggestConfirmUpdate') : t('suggestConfirmCreate')}
            </button>
            <button type="button" className="auto-btn" disabled={busy} onClick={() => setOpen(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
