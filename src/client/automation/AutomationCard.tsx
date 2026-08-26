/**
 * automation — 任务卡（折叠行 + 行内展开编辑面，DSH 官方控件规格）。
 *
 * 折叠行 = 开关 + 名称/徽章 + 「计划 · 下次运行 · 上次结果」副行 + 状态字 + chevron；
 * 展开面 = 名称 / 计划（含预览与校验）/ 执行内容 / 模型 / 最近运行 + 操作行。
 *
 * 交互要点：
 *  - 运行中：副行显示转圈「执行中」，操作行的「立即运行」换成「中止」；
 *  - 校验前置：计划非法或执行内容为空时禁用保存/启用，并就地给出原因；
 *  - 删除二次确认（同一按钮两次点击），避免误删无法撤销的任务；
 *  - 有未保存改动时展示「放弃改动」，切走不会静默丢失编辑。
 */

import { useEffect, useMemo, useState } from 'react'
import type { CronJob, ModelOption, RunRecord } from './types.ts'
import {
  scheduleDraftFromStored,
  schedulePreviewFromDraft,
  storedScheduleFromDraft,
  validateDraft,
  type ScheduleDraft,
} from './schedule-draft.ts'
import { modelSelectValue, modelValueFromSelect } from './models.ts'
import { clearRuns, getRuns } from './api.ts'
import { formatAbsolute, formatRelative, t } from './locales.ts'
import { ScheduleEditor } from './ScheduleEditor.tsx'
import { ChevronIcon, CopyIcon, PlayIcon, SpinnerIcon, StopIcon, TrashIcon } from './icons.tsx'
import { ModelPicker } from './ModelPicker.tsx'
import { RunRow } from './RunRow.tsx'

/** 显示名：label 优先，否则取 prompt 前 40 字，最后退到 id。 */
function jobTitle(job: CronJob): string {
  if (job.label.trim() !== '') return job.label
  const fromPrompt = job.prompt.trim().slice(0, 40)
  return fromPrompt !== '' ? fromPrompt : job.id
}

export interface AutomationCardProps {
  job: CronJob
  models: ModelOption[]
  modelsLoading: boolean
  open: boolean
  /** 服务端报告该任务正在执行。 */
  running: boolean
  onToggleOpen: () => void
  onToggleEnabled: (job: CronJob) => Promise<void> | void
  onRemove: (id: string) => Promise<void> | void
  onDuplicate: (id: string) => Promise<void> | void
  onRunNow: (id: string) => Promise<void> | void
  onCancelRun: (id: string) => Promise<void> | void
  /** 保存字段差异；抛错时由容器 toast。 */
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<void>
  /** 查看某次运行的完整产出。 */
  onViewOutput: (job: CronJob, run: RunRecord) => void
  /** 局部提示（校验失败等）。 */
  onNotice: (message: string) => void
}

export function AutomationCard({
  job,
  models,
  modelsLoading,
  open,
  running,
  onToggleOpen,
  onToggleEnabled,
  onRemove,
  onDuplicate,
  onRunNow,
  onCancelRun,
  onUpdate,
  onViewOutput,
  onNotice,
}: AutomationCardProps): JSX.Element {
  const [label, setLabel] = useState(job.label)
  const [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraftFromStored(job.type, job.schedule))
  const [draftDirty, setDraftDirty] = useState(false)
  const [prompt, setPrompt] = useState(job.prompt)
  const [model, setModel] = useState(modelSelectValue(job.model))
  const [runs, setRuns] = useState<RunRecord[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [armDelete, setArmDelete] = useState(false)

  /** 服务端值变化时同步本地编辑态（configRevision 是唯一权威的「变了」信号——
   *  轮询刷新返回的新 job 对象引用变化不算，否则会覆盖用户未保存的编辑）。 */
  useEffect(() => {
    setLabel(job.label)
    setDraft(scheduleDraftFromStored(job.type, job.schedule))
    setDraftDirty(false)
    setPrompt(job.prompt)
    setModel(modelSelectValue(job.model))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- job.model 等是对象引用，
    // 轮询每次重建引用；只有 configRevision（写操作自增）才是服务端值变化的信号。
  }, [job.id, job.configRevision])

  // 收起卡片时复位删除待确认态，避免下次展开时按钮还停在「确认删除？」。
  useEffect(() => {
    if (!open) setArmDelete(false)
  }, [open])

  /** 展开 / 运行结束时拉最近运行记录。 */
  useEffect(() => {
    if (!open) return
    let alive = true
    getRuns(job.id, 5).then(data => {
      if (alive) setRuns(data.runs)
    }).catch(() => {
      if (alive) setRuns([])
    })
    return () => { alive = false }
  }, [open, job.id, job.lastRunAt, running])

  const storedPreview = useMemo(
    () => schedulePreviewFromDraft(scheduleDraftFromStored(job.type, job.schedule)),
    [job.type, job.schedule],
  )
  const scheduleError = useMemo(() => validateDraft(draft), [draft])
  const title = jobTitle(job)
  const promptEmpty = prompt.trim() === ''
  const isDraftJob = !job.enabled && job.prompt.trim() === ''
  const lastRun = runs !== null && runs.length > 0 ? runs[0] : null

  const dirty =
    label !== job.label
    || draftDirty
    || prompt !== job.prompt
    || model !== modelSelectValue(job.model)

  const collectFields = (): Record<string, unknown> | null => {
    const fields: Record<string, unknown> = {}
    if (label !== job.label) fields.label = label
    if (prompt !== job.prompt) fields.prompt = prompt
    if (model !== modelSelectValue(job.model)) fields.model = modelValueFromSelect(model)
    if (draftDirty) {
      const stored = storedScheduleFromDraft(draft)
      fields.scheduleType = stored.type
      fields.schedule = stored.schedule
    }
    return Object.keys(fields).length > 0 ? fields : null
  }

  const revert = (): void => {
    setLabel(job.label)
    setDraft(scheduleDraftFromStored(job.type, job.schedule))
    setDraftDirty(false)
    setPrompt(job.prompt)
    setModel(modelSelectValue(job.model))
  }

  const save = async (): Promise<void> => {
    if (saving) return
    if (scheduleError !== null) {
      onNotice(scheduleError)
      return
    }
    const fields = collectFields()
    if (fields === null) return
    setSaving(true)
    try {
      await onUpdate(job.id, fields)
    } catch {
      // 容器已 toast；保留编辑态让用户改。
    } finally {
      setSaving(false)
    }
  }

  /** 开关：启用前先把未保存的编辑一起提交（否则「开了但内容还是旧的」）。 */
  const toggleEnabled = async (): Promise<void> => {
    if (saving) return
    if (job.enabled) {
      await onToggleEnabled(job)
      return
    }
    if (promptEmpty) {
      onNotice(t('promptRequired'))
      return
    }
    if (scheduleError !== null) {
      onNotice(scheduleError)
      return
    }
    setSaving(true)
    try {
      await onUpdate(job.id, { ...(collectFields() ?? {}), enabled: true })
    } catch {
      // 容器已 toast。
    } finally {
      setSaving(false)
    }
  }

  const removeWithConfirm = async (): Promise<void> => {
    if (!armDelete) {
      setArmDelete(true)
      window.setTimeout(() => setArmDelete(false), 4000)
      return
    }
    setArmDelete(false)
    await onRemove(job.id)
  }

  const clearHistory = async (): Promise<void> => {
    try {
      await clearRuns(job.id)
      setRuns([])
      onNotice(t('historyCleared'))
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="auto-card" data-open={open} data-draft={isDraftJob || undefined}>
      <div className="auto-row">
        <button
          type="button"
          className="auto-switch"
          role="switch"
          aria-checked={job.enabled}
          aria-label={job.enabled ? t('disable') : t('enable')}
          title={job.enabled ? t('disable') : t('enable')}
          disabled={saving}
          onClick={() => void toggleEnabled()}
        />
        <button type="button" className="auto-row-main" onClick={onToggleOpen} aria-expanded={open}>
          <span className="auto-main">
            <span className="auto-name-line">
              <span className="auto-name" title={title}>{title}</span>
              {isDraftJob ? <span className="auto-badge" data-tone="muted">{t('off')}</span> : null}
            </span>
            <span className="auto-sub">
              <span className="auto-meta" title={storedPreview}>{storedPreview}</span>
              {running ? (
                <span className="auto-running"><SpinnerIcon />{t('running')}</span>
              ) : job.enabled && job.nextRunAt !== null ? (
                <span className="auto-meta" title={formatAbsolute(job.nextRunAt)}>
                  {t('nextRun', { time: formatRelative(job.nextRunAt) })}
                </span>
              ) : job.lastRunAt !== null ? (
                <span className="auto-meta" title={formatAbsolute(job.lastRunAt)}>
                  {t('lastRun', { time: formatRelative(job.lastRunAt) })}
                </span>
              ) : (
                <span className="auto-meta">{t('neverRun')}</span>
              )}
              {job.consecutiveErrors > 0 ? (
                <span className="auto-meta" data-tone="error">
                  {t('consecutiveErrors', { n: job.consecutiveErrors })}
                </span>
              ) : null}
            </span>
          </span>
          <span className="auto-state">{job.enabled ? t('on') : t('off')}</span>
          <ChevronIcon />
        </button>
      </div>

      {open ? (
        <div className="auto-editor">
          <label className="auto-field">
            <span>{t('fieldLabel')}</span>
            <input
              className="auto-input"
              value={label}
              spellCheck={false}
              placeholder={t('labelPlaceholder')}
              onChange={event => setLabel(event.target.value)}
            />
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
            {promptEmpty
              ? <span className="auto-hint">{t('draftHint')}</span>
              : <span className="auto-count">{prompt.length}</span>}
          </label>

          <label className="auto-field">
            <span>{t('modelLabel')}</span>
            <ModelPicker
              models={models}
              loading={modelsLoading}
              value={model}
              onChange={setModel}
            />
          </label>

          <div className="auto-runs">
            <div className="auto-runs-head">
              <span className="auto-section-title">{t('historyTitle')}</span>
              {runs !== null && runs.length > 0 ? (
                <button type="button" className="auto-btn auto-btn-danger auto-spacer" onClick={() => void clearHistory()}>
                  {t('historyClear')}
                </button>
              ) : null}
            </div>
            {runs === null ? null : runs.length === 0 ? (
              <span className="auto-hint">{t('historyEmpty')}</span>
            ) : (
              runs.map((run, index) => (
                <RunRow
                  key={`${run.timestamp}-${index}`}
                  run={run}
                  onViewOutput={() => onViewOutput(job, run)}
                />
              ))
            )}
          </div>

          <div className="auto-actions">
            <button
              type="button"
              className="auto-btn auto-btn-primary"
              disabled={!dirty || saving || scheduleError !== null}
              onClick={() => void save()}
            >
              {t('confirm')}
            </button>
            {dirty ? (
              <button type="button" className="auto-btn" disabled={saving} onClick={revert}>{t('revert')}</button>
            ) : null}
            {running ? (
              <button type="button" className="auto-btn" onClick={() => void onCancelRun(job.id)}>
                <StopIcon />{t('cancelRun')}
              </button>
            ) : (
              <button
                type="button"
                className="auto-btn"
                disabled={promptEmpty || saving}
                title={promptEmpty ? t('promptRequired') : t('runNow')}
                onClick={() => void onRunNow(job.id)}
              >
                <PlayIcon />{t('runNow')}
              </button>
            )}
            <button type="button" className="auto-btn auto-spacer" onClick={() => void onDuplicate(job.id)}>
              <CopyIcon />{t('duplicate')}
            </button>
            <button
              type="button"
              className="auto-btn auto-btn-danger"
              data-armed={armDelete || undefined}
              onClick={() => void removeWithConfirm()}
            >
              <TrashIcon />{armDelete ? t('deleteConfirm') : t('delete')}
            </button>
          </div>

          {lastRun !== null && lastRun.status === 'error' ? (
            <span className="auto-hint" data-tone="error">{lastRun.error}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
