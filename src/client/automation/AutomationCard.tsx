/**
 * automation — 任务卡（openhanako AutomationCard 同款交互，DSH 控件规格）。
 *
 * 折叠行 = 开关 + 名称 + 「计划预览 · 下次运行 · 徽章」副行 + 状态字 + chevron；
 * 展开区 = 名称 / 计划编辑 / 执行内容 / 模型 / 运行记录 + 操作行。
 */

import { useEffect, useMemo, useState } from 'react'
import type { CronJob, ModelOption, RunRecord } from './types.ts'
import {
  scheduleDraftFromStored,
  schedulePreviewFromDraft,
  storedScheduleFromDraft,
  type ScheduleDraft,
} from './schedule-draft.ts'
import { modelSelectValue, modelValueFromSelect } from './models.ts'
import { getRuns } from './api.ts'
import { t } from './locales.ts'
import { ScheduleEditor } from './ScheduleEditor.tsx'

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <span className="auto-chevron" data-open={open} aria-hidden="true">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </span>
  )
}

function jobTitle(job: CronJob): string {
  return job.label !== '' ? job.label : (job.prompt.slice(0, 40)) || job.id
}

export function AutomationCard({
  job,
  models,
  modelsLoading,
  open,
  onToggleOpen,
  onToggleEnabled,
  onRemove,
  onRunNow,
  onUpdate,
}: {
  job: CronJob
  models: ModelOption[]
  modelsLoading: boolean
  open: boolean
  onToggleOpen: () => void
  onToggleEnabled: (job: CronJob) => Promise<void> | void
  onRemove: (id: string) => Promise<void> | void
  onRunNow: (id: string) => Promise<void> | void
  /** 保存字段差异；抛错时由容器 toast。 */
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<void>
}): JSX.Element {
  const [label, setLabel] = useState(jobTitle(job))
  const [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraftFromStored(job.type, job.schedule))
  const [draftDirty, setDraftDirty] = useState(false)
  const [prompt, setPrompt] = useState(job.prompt)
  const [model, setModel] = useState(modelSelectValue(job.model))
  const [runs, setRuns] = useState<RunRecord[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLabel(jobTitle(job))
    setDraft(scheduleDraftFromStored(job.type, job.schedule))
    setDraftDirty(false)
    setPrompt(job.prompt)
    setModel(modelSelectValue(job.model))
  }, [job])

  // 展开时拉一次运行记录。
  useEffect(() => {
    if (!open) return
    let alive = true
    getRuns(job.id, 10).then(data => {
      if (alive) setRuns(data.runs)
    }).catch(() => {
      if (alive) setRuns([])
    })
    return () => { alive = false }
  }, [open, job.id, job.lastRunAt])

  const preview = useMemo(() => schedulePreviewFromDraft(scheduleDraftFromStored(job.type, job.schedule)), [job.type, job.schedule])
  const dirty =
    label !== jobTitle(job)
    || draftDirty
    || prompt !== job.prompt
    || model !== modelSelectValue(job.model)

  const collectFields = (): Record<string, unknown> | null => {
    const fields: Record<string, unknown> = {}
    if (label !== jobTitle(job)) fields.label = label
    if (prompt !== job.prompt) fields.prompt = prompt
    if (model !== modelSelectValue(job.model)) fields.model = modelValueFromSelect(model)
    if (draftDirty) {
      const stored = storedScheduleFromDraft(draft)
      fields.scheduleType = stored.type
      // every 走毫秒；其余直接传表达式/ISO。
      fields.schedule = stored.schedule
    }
    return Object.keys(fields).length > 0 ? fields : null
  }

  const save = async (): Promise<void> => {
    const fields = collectFields()
    if (fields === null || saving) return
    setSaving(true)
    try {
      await onUpdate(job.id, fields)
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (): Promise<void> => {
    if (job.enabled) {
      await onToggleEnabled(job)
      return
    }
    if (prompt.trim() === '') return // 启用前必须有执行内容（按钮态由 toast 提示）
    await onUpdate(job.id, { ...(collectFields() ?? {}), enabled: true })
  }

  return (
    <div className="auto-card">
      <button type="button" className="auto-row" onClick={onToggleOpen} aria-expanded={open}>
        <span
          className="auto-switch"
          role="switch"
          aria-checked={job.enabled}
          aria-label={job.enabled ? t('disable') : t('enable')}
          title={job.enabled ? t('disable') : t('enable')}
          onClick={event => {
            event.stopPropagation()
            void toggleEnabled()
          }}
        />
        <span className="auto-main">
          <span className="auto-name" title={jobTitle(job)}>{jobTitle(job)}</span>
          <span className="auto-sub">
            <span className="auto-meta">{preview}</span>
            {job.nextRunAt !== null && job.enabled ? (
              <span className="auto-meta">{t('nextRun', { time: new Date(job.nextRunAt).toLocaleString(undefined, { hour12: false }) })}</span>
            ) : null}
            <span className="auto-badge">{t('executorLabel')}</span>
            {job.consecutiveErrors > 0 ? (
              <span className="auto-meta" style={{ color: 'var(--dsw-alias-state-error-primary,#e0434b)' }}>
                {t('consecutiveErrors', { n: job.consecutiveErrors })}
              </span>
            ) : null}
          </span>
        </span>
        <span className="auto-state">{job.enabled ? t('on') : t('off')}</span>
        <Chevron open={open} />
      </button>

      {open ? (
        <div className="auto-editor">
          <label className="auto-field">
            <span>{t('fieldLabel')}</span>
            <input className="auto-input" value={label} spellCheck={false} onChange={event => setLabel(event.target.value)} />
          </label>

          <ScheduleEditor draft={draft} onChange={next => { setDraft(next); setDraftDirty(true) }} />

          <label className="auto-field">
            <span>{t('fieldPrompt')}</span>
            <textarea
              className="auto-textarea"
              value={prompt}
              placeholder={t('promptPlaceholder')}
              spellCheck={false}
              onChange={event => setPrompt(event.target.value)}
            />
          </label>

          <label className="auto-field">
            <span>{t('modelLabel')}</span>
            <select className="auto-select" value={model} onChange={event => setModel(event.target.value)}>
              <option value="">{modelsLoading && models.length === 0 ? t('modelsLoading') : t('defaultModel')}</option>
              {models.map(option => (
                <option key={`${option.provider}/${option.id}`} value={`${option.provider}/${option.id}`}>
                  {`${option.providerName} / ${option.name}`}
                </option>
              ))}
            </select>
          </label>

          {runs !== null && runs.length > 0 ? (
            <div className="auto-runs">
              <div className="auto-section-title">{t('historyTitle')}</div>
              {runs.slice(0, 5).map((run, index) => (
                <div className="auto-run" key={`${run.timestamp}-${index}`}>
                  <div className="auto-run-head">
                    <span className="auto-run-status" data-status={run.status}>
                      {run.status === 'success' ? t('statusSuccess') : run.status === 'error' ? t('statusError') : t('statusSkipped')}
                    </span>
                    <span>{new Date(run.timestamp).toLocaleString(undefined, { hour12: false })}</span>
                  </div>
                  {(run.summary ?? run.error ?? run.reason) !== undefined ? (
                    <div className="auto-run-detail">{run.summary ?? run.error ?? run.reason}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="auto-actions">
            <button type="button" className="auto-btn auto-btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
              {t('confirm')}
            </button>
            <button type="button" className="auto-btn" disabled={!job.enabled} title={t('runNow')} onClick={() => void onRunNow(job.id)}>
              {t('runNow')}
            </button>
            <button
              type="button"
              className="auto-btn auto-btn-danger"
              style={{ marginLeft: 'auto' }}
              onClick={() => void onRemove(job.id)}
            >
              {t('delete')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
