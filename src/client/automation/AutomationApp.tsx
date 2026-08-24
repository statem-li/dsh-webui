/**
 * automation — 面板主体（openhanako AutomationPanel 同款布局，DSH 视觉规格）。
 *
 * 结构：侧边栏入口按钮 + PopoverShell 浮层（portal 到 body，右侧滑出）。
 * 浮层 = Tab 栏（任务计划 / 运行记录）：
 *  - 任务计划：工具栏（+ 新建）→ AI 待确认建议区 → 任务卡列表；
 *  - 运行记录：全部任务的执行历史（含完整产出全文回看）。
 * 打开期间低频轮询刷新；所有变更操作后立即重拉。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PshHead, PopoverShell, ensureShellStyles } from '../popover-shell.js'
import { NavButton, navAnchorFrom, useRail } from '../sidebar-nav.js'
import { ensureAutomationStyles } from './styles.ts'
import { t } from './locales.ts'
import {
  addJob,
  getRunFile,
  getRuns,
  listJobs,
  listSuggestions,
  removeJob,
  runNow,
  toggleJob,
  updateJob,
} from './api.ts'
import type { CronJob, ModelOption, RunRecord, SuggestionView } from './types.ts'
import { createModelSource } from './models.ts'
import { AutomationCard } from './AutomationCard.tsx'
import { SuggestCard } from './SuggestCard.tsx'

const RELOAD_MS = 30_000

type PanelTab = 'jobs' | 'runs'

interface ToastState {
  key: number
  text: string
}

/** 合并视图里的一条运行记录（带任务名）。 */
type RunRow = RunRecord & { jobId?: string, jobLabel?: string }

/** 自动化面板（含侧边栏入口按钮）。 */
export function AutomationApp({ ctx }: { ctx: ClientContext }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [tab, setTab] = useState<PanelTab>('jobs')
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [suggestions, setSuggestions] = useState<SuggestionView[]>([])
  const [runs, setRuns] = useState<RunRow[]>([])
  const [viewing, setViewing] = useState<{ title: string, content: string } | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const toastSeq = useRef(0)
  const rail = useRail()

  const modelSource = useMemo(() => createModelSource(ctx), [ctx])

  const showToast = useCallback((text: string): void => {
    toastSeq.current += 1
    setToast({ key: toastSeq.current, text })
    window.setTimeout(() => {
      setToast(current => (current !== null && current.text === text ? null : current))
    }, 4000)
  }, [])

  const loadData = useCallback(async (): Promise<void> => {
    try {
      const [cronData, suggestData] = await Promise.all([
        listJobs(),
        listSuggestions(),
      ])
      setJobs(cronData.jobs)
      setSuggestions(suggestData.suggestions)
      setLoadError(null)
    } catch (error) {
      setLoadError(`${t('loadFailed')}：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  // 打开：加载数据 + 模型目录。
  useEffect(() => {
    if (!open) return
    void loadData()
    let alive = true
    setModelsLoading(true)
    modelSource.load().then(options => {
      if (!alive) return
      setModels(options)
      setModelsLoading(false)
    }).catch(() => {
      if (alive) { setModels([]); setModelsLoading(false) }
    })
    const timer = window.setInterval(() => { void loadData() }, RELOAD_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [open, loadData, modelSource])

  /** 运行记录加载（runs tab 打开时）。 */
  const loadRuns = useCallback(async (): Promise<void> => {
    try {
      const data = await getRuns(undefined, 50)
      setRuns(data.runs)
    } catch {
      setRuns([])
    }
  }, [])

  // 切到运行记录 tab（或面板打开）时拉取；打开期间随 tab 驻留低频刷新。
  useEffect(() => {
    if (!open || tab !== 'runs') return
    void loadRuns()
    const timer = window.setInterval(() => { void loadRuns() }, RELOAD_MS)
    return () => { window.clearInterval(timer) }
  }, [open, tab, loadRuns])

  /** 查看某次运行的完整产出。 */
  const openRunFile = async (row: RunRow): Promise<void> => {
    if (row.jobId === undefined || row.jobId === '' || row.file === undefined || row.file === '') return
    try {
      const data = await getRunFile(row.jobId, row.file)
      setViewing({ title: `${row.jobLabel ?? row.jobId} · ${new Date(row.timestamp).toLocaleString(undefined, { hour12: false })}`, content: data.content })
    } catch (error) {
      showToast(`${t('loadFailed')}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  useEffect(() => {
    ensureShellStyles()
    ensureAutomationStyles()
  }, [])

  const close = useCallback((): void => {
    setClosing(true)
    window.setTimeout(() => {
      setClosing(false)
      setOpen(false)
    }, 240)
  }, [])

  /** 新建灰卡（openhanako 同款：默认每天 09:00、停用态，建完直接展开编辑）。 */
  const createDraftJob = async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    try {
      const data = await addJob({
        scheduleType: 'cron',
        schedule: '0 9 * * *',
        label: t('newAutomation'),
        prompt: '',
        enabled: false,
      })
      await loadData()
      if (data.job !== null) setOpenIds(previous => ({ ...previous, [data.job.id]: true }))
    } catch (error) {
      showToast(`${t('createFailed')}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setCreating(false)
    }
  }

  const handleToggleEnabled = async (job: CronJob): Promise<void> => {
    try {
      if (!job.enabled && job.prompt.trim() === '') {
        showToast(t('promptRequired'))
        return
      }
      await toggleJob(job.id)
      await loadData()
    } catch (error) {
      showToast(`${t('saveFailed')}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleUpdate = async (id: string, fields: Record<string, unknown>): Promise<void> => {
    try {
      await updateJob({ id, ...fields })
      await loadData()
    } catch (error) {
      showToast(`${t('saveFailed')}：${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  const handleRemove = async (id: string): Promise<void> => {
    try {
      await removeJob(id)
      await loadData()
    } catch (error) {
      showToast(`${t('saveFailed')}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleRunNow = async (id: string): Promise<void> => {
    try {
      await runNow(id)
      showToast(t('runNow') + ' ✓')
    } catch (error) {
      showToast(`${t('saveFailed')}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleSuggestApplied = async (appliedLabel: string | null): Promise<void> => {
    await loadData()
    if (appliedLabel !== null) showToast(t('suggestApplied', { label: appliedLabel }))
    else showToast(t('suggestRejected'))
  }

  /** 卡片锚点：所在导航行右缘 +8、按钮顶缘 -6（合并行统一滑出位，与记忆一致）。 */
  const anchor = useMemo(() => navAnchorFrom(wrapRef.current), [open])

  return (
    <>
      <div ref={wrapRef}>
        <NavButton
          icon={(
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3.5 2" />
            </svg>
          )}
          label={t('entry')}
          rail={rail}
          expanded={open}
          ariaLabel={t('entryAria')}
          onClick={() => { if (open || closing) close(); else setOpen(true) }}
        />
      </div>

      {/* 合并行槽位（技能/记忆）：由 React 随本树渲染，与按钮同生共死——
          外部 append 会与 React 首次提交竞态（槽位被清后 portal 失联，
          入口永久消失），故 sidebar-nav 的 ensureAutoRowSlots 仅作兜底。 */}
      <div data-nav-slot="skills" />
      <div data-nav-slot="memory" />

      {(open || closing) && createPortal(
        <PopoverShell closing={closing} onClose={close} anchor={anchor} width={520} ariaLabel={t('title')}>
          <PshHead title={t('title')} closeLabel={t('close')} onClose={close} />
          <div className="auto-panel">
            {/* Tab 栏：任务计划 / 运行记录 */}
            <div className="auto-tabs" role="tablist">
              <button type="button" className="auto-tab" role="tab" data-active={tab === 'jobs'} aria-selected={tab === 'jobs'} onClick={() => setTab('jobs')}>{t('tabJobs')}</button>
              <button type="button" className="auto-tab" role="tab" data-active={tab === 'runs'} aria-selected={tab === 'runs'} onClick={() => setTab('runs')}>{t('tabRuns')}</button>
            </div>

            {tab === 'jobs' ? (
              <>
                <div className="auto-toolbar">
                  <button
                    type="button"
                    className="auto-add"
                    title={t('add')}
                    aria-label={t('add')}
                    disabled={creating}
                    onClick={() => void createDraftJob()}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>

                <div className="auto-scroll">
                  {loadError !== null ? <div className="auto-error" role="alert">{loadError}</div> : null}

                  {suggestions.length > 0 ? (
                    <>
                      <div className="auto-section-title">{t('suggestTitle')}</div>
                      {suggestions.map(suggestion => (
                        <SuggestCard
                          key={suggestion.suggestionId}
                          suggestion={suggestion}
                          onDone={label => void handleSuggestApplied(label)}
                          onError={showToast}
                        />
                      ))}
                    </>
                  ) : null}

                  {jobs.length === 0 && suggestions.length === 0 && loadError === null ? (
                    <div className="auto-empty">
                      <span>{t('empty')}</span>
                      <span>{t('emptyHint')}</span>
                    </div>
                  ) : (
                    jobs.map(job => (
                      <AutomationCard
                        key={job.id}
                        job={job}
                        models={models}
                        modelsLoading={modelsLoading}
                        open={openIds[job.id] === true}
                        onToggleOpen={() => setOpenIds(previous => ({ ...previous, [job.id]: previous[job.id] !== true }))}
                        onToggleEnabled={handleToggleEnabled}
                        onRemove={handleRemove}
                        onRunNow={handleRunNow}
                        onUpdate={handleUpdate}
                      />
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="auto-scroll">
                {runs.length === 0 ? (
                  <div className="auto-empty">
                    <span>{t('runsEmpty')}</span>
                    <span>{t('runsEmptyHint')}</span>
                  </div>
                ) : (
                  runs.map((row, index) => (
                    <div className="auto-run" key={`${row.jobId ?? ''}-${row.timestamp}-${index}`}>
                      <div className="auto-run-head">
                        <span className="auto-run-status" data-status={row.status}>
                          {row.status === 'success' ? t('statusSuccess') : row.status === 'error' ? t('statusError') : t('statusSkipped')}
                        </span>
                        <span className="auto-run-job">{row.jobLabel ?? row.jobId}</span>
                        <span style={{ marginLeft: 'auto', flex: 'none' }}>{new Date(row.timestamp).toLocaleString(undefined, { hour12: false })}</span>
                      </div>
                      {(row.summary ?? row.error ?? row.reason) !== undefined ? (
                        <div className="auto-run-detail">{row.summary ?? row.error ?? row.reason}</div>
                      ) : null}
                      {row.file !== undefined && row.file !== '' && row.status === 'success' ? (
                        <div className="auto-run-actions">
                          <button type="button" className="auto-btn" onClick={() => void openRunFile(row)}>{t('viewFull')}</button>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* 全文查看覆盖层 */}
            {viewing !== null ? (
              <div className="auto-viewer">
                <div className="auto-viewer-head">
                  <span className="auto-viewer-title" title={viewing.title}>{viewing.title}</span>
                  <button type="button" className="psh-close" aria-label={t('outputClose')} onClick={() => setViewing(null)}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <pre className="auto-viewer-body">{viewing.content}</pre>
              </div>
            ) : null}
          </div>
        </PopoverShell>,
        document.body,
      )}

      {toast !== null && createPortal(
        <div className="auto-toast" role="status" onClick={() => setToast(null)}>{toast.text}</div>,
        document.body,
      )}
    </>
  )
}
