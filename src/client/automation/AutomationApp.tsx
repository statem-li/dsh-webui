/**
 * automation — 面板主体（侧边栏入口按钮 + 右侧滑出浮层）。
 *
 * 结构：
 *  ┌ head：分段 Tab（任务 / 记录，带计数）+ 统计条（任务/启用中/执行中）
 *  ├ toolbar：搜索 · 启用态筛选 · 刷新 · 新建
 *  └ scroll：AI 待确认建议区 → 任务卡列表 ／ 运行记录列表（带状态筛选）
 *
 * 数据流要点：
 *  - 写操作直接吃 API 返回的 { jobs, running } 快照，不再额外拉一次列表；
 *  - 打开期间 8s 轮询（有任务正在执行时 3s），关闭即停——原实现 30s 轮询，
 *    「立即运行」后要干等半分钟才看到结果；
 *  - 运行记录 Tab 与卡片内历史共用 RunRow 组件，展示口径一致。
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
  cancelRun,
  duplicateJob,
  getRunFile,
  getRuns,
  getSettings,
  listJobs,
  listSuggestions,
  removeJob,
  runNow,
  saveSettings,
  toggleJob,
  updateJob,
} from './api.ts'
import type { CronJob, ModelOption, RunRecord, RunRow as RunRowData, RunStatus, SuggestionView } from './types.ts'
import { createModelSource } from './models.ts'
import { AutomationCard } from './AutomationCard.tsx'
import { SuggestCard } from './SuggestCard.tsx'
import { RunRow } from './RunRow.tsx'
import {
  AlertIcon,
  CalendarIcon,
  ClockIcon,
  CloseIcon,
  DocIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
} from './icons.tsx'

/** 面板打开时的轮询间隔；有任务在执行时用快档，好让状态跟手。 */
const RELOAD_IDLE_MS = 8_000
const RELOAD_BUSY_MS = 3_000

type PanelTab = 'jobs' | 'runs'
type EnabledFilter = 'all' | 'enabled' | 'disabled'
type RunFilter = RunStatus | 'all'

interface ToastState {
  key: number
  text: string
  tone: 'info' | 'error'
}

/** 自动化面板（含侧边栏入口按钮）。 */
export function AutomationApp({ ctx }: { ctx: ClientContext }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [tab, setTab] = useState<PanelTab>('jobs')
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [running, setRunning] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<SuggestionView[]>([])
  const [runs, setRuns] = useState<RunRowData[]>([])
  const [runFilter, setRunFilter] = useState<RunFilter>('all')
  const [viewing, setViewing] = useState<{ title: string, content: string } | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all')
  const [autoApprove, setAutoApprove] = useState<boolean | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const toastSeq = useRef(0)
  const toastTimer = useRef(0)
  const rail = useRail()

  const modelSource = useMemo(() => createModelSource(ctx), [ctx])
  const runningSet = useMemo(() => new Set(running), [running])

  const showToast = useCallback((text: string, tone: 'info' | 'error' = 'info'): void => {
    toastSeq.current += 1
    setToast({ key: toastSeq.current, text, tone })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  const reportError = useCallback((prefix: string, error: unknown): void => {
    showToast(`${prefix}：${error instanceof Error ? error.message : String(error)}`, 'error')
  }, [showToast])

  /** 吃写操作返回的快照（jobs + running），省一次往返。 */
  const adopt = useCallback((data: { jobs?: CronJob[], running?: string[] }): void => {
    if (Array.isArray(data.jobs)) setJobs(data.jobs)
    if (Array.isArray(data.running)) setRunning(data.running)
  }, [])

  const loadData = useCallback(async (): Promise<void> => {
    try {
      const [cronData, suggestData] = await Promise.all([listJobs(), listSuggestions()])
      setJobs(cronData.jobs)
      setRunning(cronData.running ?? [])
      setSuggestions(suggestData.suggestions)
      setLoadError(null)
    } catch (error) {
      setLoadError(`${t('loadFailed')}：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  const loadRuns = useCallback(async (): Promise<void> => {
    try {
      const data = await getRuns(undefined, 50, runFilter)
      setRuns(data.runs)
    } catch {
      setRuns([])
    }
  }, [runFilter])

  // 打开：加载数据 + 模型目录 + 设置。
  useEffect(() => {
    if (!open) return
    void loadData()
    getSettings().then(data => setAutoApprove(data.autoApprove === true)).catch(() => setAutoApprove(null))
    let alive = true
    setModelsLoading(true)
    modelSource.load().then(options => {
      if (!alive) return
      setModels(options)
      setModelsLoading(false)
    }).catch(() => {
      if (alive) { setModels([]); setModelsLoading(false) }
    })
    return () => { alive = false }
  }, [open, loadData, modelSource])

  /**
   * 面板关闭时也低频探一次待确认建议：否则助手在对话里提的自动化建议，
   * 用户不主动开面板就永远看不到（入口按钮的角标是唯一的可见信号）。
   */
  useEffect(() => {
    if (open) return
    let alive = true
    const poll = (): void => {
      listSuggestions()
        .then(data => { if (alive) setSuggestions(data.suggestions) })
        .catch(() => { /* 服务不可达：静默 */ })
    }
    poll()
    const timer = window.setInterval(poll, 45_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [open])

  // 轮询：任务列表（有执行中任务时快档）。
  useEffect(() => {
    if (!open) return
    const interval = running.length > 0 ? RELOAD_BUSY_MS : RELOAD_IDLE_MS
    const timer = window.setInterval(() => { void loadData() }, interval)
    return () => { window.clearInterval(timer) }
  }, [open, loadData, running.length])

  // 运行记录：切到该 Tab（或筛选变化 / 有任务在跑）时拉取并轮询。
  useEffect(() => {
    if (!open || tab !== 'runs') return
    void loadRuns()
    const interval = running.length > 0 ? RELOAD_BUSY_MS : RELOAD_IDLE_MS
    const timer = window.setInterval(() => { void loadRuns() }, interval)
    return () => { window.clearInterval(timer) }
  }, [open, tab, loadRuns, running.length])

  useEffect(() => {
    ensureShellStyles()
    ensureAutomationStyles()
    return () => { window.clearTimeout(toastTimer.current) }
  }, [])

  const close = useCallback((): void => {
    setClosing(true)
    window.setTimeout(() => {
      setClosing(false)
      setOpen(false)
    }, 240)
  }, [])

  const manualRefresh = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await loadData()
      if (tab === 'runs') await loadRuns()
    } finally {
      setRefreshing(false)
    }
  }

  /** 新建草稿（默认每天 09:00、停用态，建完直接展开编辑）。 */
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
      adopt(data)
      setQuery('')
      setEnabledFilter('all')
      setTab('jobs')
      if (data.job !== undefined && data.job !== null) {
        setOpenIds(previous => ({ ...previous, [data.job.id]: true }))
      }
    } catch (error) {
      reportError(t('createFailed'), error)
    } finally {
      setCreating(false)
    }
  }

  const handleToggleEnabled = async (job: CronJob): Promise<void> => {
    try {
      if (!job.enabled && job.prompt.trim() === '') {
        showToast(t('promptRequired'), 'error')
        return
      }
      adopt(await toggleJob(job.id))
    } catch (error) {
      reportError(t('saveFailed'), error)
    }
  }

  const handleUpdate = async (id: string, fields: Record<string, unknown>): Promise<void> => {
    try {
      adopt(await updateJob({ id, ...fields }))
      showToast(t('saved'))
    } catch (error) {
      reportError(t('saveFailed'), error)
      throw error
    }
  }

  const handleRemove = async (id: string): Promise<void> => {
    try {
      adopt(await removeJob(id))
      setOpenIds(previous => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      showToast(t('deleted'))
    } catch (error) {
      reportError(t('saveFailed'), error)
    }
  }

  const handleDuplicate = async (id: string): Promise<void> => {
    try {
      const data = await duplicateJob(id)
      adopt(data)
      if (data.job !== undefined && data.job !== null) {
        setOpenIds(previous => ({ ...previous, [data.job.id]: true }))
      }
      showToast(t('duplicated'))
    } catch (error) {
      reportError(t('saveFailed'), error)
    }
  }

  const handleRunNow = async (id: string): Promise<void> => {
    try {
      adopt(await runNow(id))
      showToast(t('runStarted'))
      // 立刻再拉一次，让「执行中」在下一帧就出现（不等轮询）。
      void loadData()
    } catch (error) {
      reportError(t('runFailed'), error)
    }
  }

  const handleCancelRun = async (id: string): Promise<void> => {
    try {
      adopt(await cancelRun(id))
      showToast(t('runCancelled'))
      void loadData()
    } catch (error) {
      reportError(t('runFailed'), error)
    }
  }

  const toggleAutoApprove = async (): Promise<void> => {
    const next = !(autoApprove === true)
    setAutoApprove(next)
    try {
      const data = await saveSettings({ autoApprove: next })
      setAutoApprove(data.autoApprove === true)
    } catch (error) {
      setAutoApprove(!next)
      reportError(t('saveFailed'), error)
    }
  }

  const handleSuggestApplied = async (appliedLabel: string | null): Promise<void> => {
    await loadData()
    if (appliedLabel !== null) showToast(t('suggestApplied', { label: appliedLabel }))
    else showToast(t('suggestRejected'))
  }

  /** 打开某次运行的完整产出。 */
  const openRunOutput = async (jobId: string, jobLabel: string, run: RunRecord): Promise<void> => {
    if (run.file === undefined || run.file === '') return
    try {
      const data = await getRunFile(jobId, run.file)
      setViewing({ title: `${jobLabel} · ${new Date(run.timestamp).toLocaleString(undefined, { hour12: false })}`, content: data.content })
    } catch (error) {
      reportError(t('loadFailed'), error)
    }
  }

  /** 搜索 + 启用态筛选后的任务列表。 */
  const visibleJobs = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return jobs.filter((job) => {
      if (enabledFilter === 'enabled' && !job.enabled) return false
      if (enabledFilter === 'disabled' && job.enabled) return false
      if (needle === '') return true
      return job.label.toLowerCase().includes(needle) || job.prompt.toLowerCase().includes(needle)
    })
  }, [jobs, query, enabledFilter])

  const enabledCount = useMemo(() => jobs.filter(job => job.enabled).length, [jobs])
  const filtering = query.trim() !== '' || enabledFilter !== 'all'

  /** 卡片锚点：所在导航行右缘 +8、按钮顶缘 -6（与记忆/技能面板一致）。 */
  const anchor = useMemo(() => navAnchorFrom(wrapRef.current), [open])

  return (
    <>
      <div ref={wrapRef}>
        <NavButton
          icon={<ClockIcon />}
          label={t('entry')}
          rail={rail}
          expanded={open}
          badge={suggestions.length}
          badgeTitle={t('suggestTitle')}
          ariaLabel={t('entryAria')}
          onClick={() => { if (open || closing) close(); else setOpen(true) }}
        />
      </div>

      {/* 合并行槽位（技能/记忆）：由 React 随本树渲染，与按钮同生共死——
          外部 append 会与 React 首次提交竞态（槽位被清后 portal 失联，
          入口永久消失），故 sidebar-nav 的槽位兜底仅作补位。 */}
      <div data-nav-slot="skills" />
      <div data-nav-slot="memory" />

      {(open || closing) && createPortal(
        <PopoverShell closing={closing} onClose={close} anchor={anchor} width={560} ariaLabel={t('title')}>
          <PshHead title={t('title')} closeLabel={t('close')} onClose={close} />
          <div className="auto-panel">
            <div className="auto-head">
              <div className="auto-tabs" role="tablist">
                <button type="button" className="auto-tab" role="tab" data-active={tab === 'jobs'} aria-selected={tab === 'jobs'} onClick={() => setTab('jobs')}>
                  {t('tabJobs')}
                  {jobs.length > 0 ? <span className="auto-tab-count">{jobs.length}</span> : null}
                </button>
                <button type="button" className="auto-tab" role="tab" data-active={tab === 'runs'} aria-selected={tab === 'runs'} onClick={() => setTab('runs')}>
                  {t('tabRuns')}
                </button>
              </div>
              <div className="auto-stats">
                <span className="auto-stat">
                  <span className="auto-stat-value">{enabledCount}</span>
                  <span>{t('statEnabled')}</span>
                </span>
                {running.length > 0 ? (
                  <span className="auto-stat">
                    <span className="auto-stat-dot" data-kind="running" />
                    <span className="auto-stat-value">{running.length}</span>
                    <span>{t('statRunning')}</span>
                  </span>
                ) : null}
              </div>
            </div>

            {tab === 'jobs' ? (
              <>
                <div className="auto-toolbar">
                  <div className="auto-search">
                    <span className="auto-search-icon"><SearchIcon /></span>
                    <input
                      className="auto-search-input"
                      value={query}
                      placeholder={t('searchPlaceholder')}
                      spellCheck={false}
                      onChange={event => setQuery(event.target.value)}
                    />
                    {query !== '' ? (
                      <button type="button" className="auto-search-clear" aria-label={t('searchClear')} onClick={() => setQuery('')}>
                        <CloseIcon />
                      </button>
                    ) : null}
                  </div>
                  <div className="auto-chips" role="group">
                    {(['all', 'enabled', 'disabled'] as EnabledFilter[]).map(value => (
                      <button
                        key={value}
                        type="button"
                        className="auto-chip"
                        data-active={enabledFilter === value}
                        onClick={() => setEnabledFilter(value)}
                      >
                        {t(value === 'all' ? 'filterAll' : value === 'enabled' ? 'filterEnabled' : 'filterDisabled')}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="auto-icon-btn"
                    data-spin={refreshing || undefined}
                    aria-label={t('refresh')}
                    title={t('refresh')}
                    disabled={refreshing}
                    onClick={() => void manualRefresh()}
                  >
                    <RefreshIcon />
                  </button>
                  <button
                    type="button"
                    className="auto-add"
                    title={t('addAria')}
                    aria-label={t('addAria')}
                    disabled={creating}
                    onClick={() => void createDraftJob()}
                  >
                    <PlusIcon />
                    {t('add')}
                  </button>
                </div>

                <div className="auto-scroll">
                  {loadError !== null ? (
                    <div className="auto-error" role="alert"><AlertIcon />{loadError}</div>
                  ) : null}

                  {suggestions.length > 0 ? (
                    <>
                      <div className="auto-section-title">{t('suggestTitle')}</div>
                      {suggestions.map(suggestion => (
                        <SuggestCard
                          key={suggestion.suggestionId}
                          suggestion={suggestion}
                          onDone={label => void handleSuggestApplied(label)}
                          onError={message => showToast(message, 'error')}
                        />
                      ))}
                    </>
                  ) : null}

                  {visibleJobs.length === 0 && loadError === null ? (
                    suggestions.length === 0 ? (
                      <div className="auto-empty">
                        <span className="auto-empty-icon"><CalendarIcon /></span>
                        <span className="auto-empty-text">{t(filtering ? 'emptyFiltered' : 'empty')}</span>
                        <span className="auto-empty-hint">{t(filtering ? 'emptyFilteredHint' : 'emptyHint')}</span>
                      </div>
                    ) : null
                  ) : (
                    visibleJobs.map(job => (
                      <AutomationCard
                        key={job.id}
                        job={job}
                        models={models}
                        modelsLoading={modelsLoading}
                        open={openIds[job.id] === true}
                        running={runningSet.has(job.id)}
                        onToggleOpen={() => setOpenIds(previous => ({ ...previous, [job.id]: previous[job.id] !== true }))}
                        onToggleEnabled={handleToggleEnabled}
                        onRemove={handleRemove}
                        onDuplicate={handleDuplicate}
                        onRunNow={handleRunNow}
                        onCancelRun={handleCancelRun}
                        onUpdate={handleUpdate}
                        onViewOutput={(target, run) => void openRunOutput(target.id, target.label !== '' ? target.label : target.id, run)}
                        onNotice={message => showToast(message, 'error')}
                      />
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="auto-toolbar">
                  <div className="auto-chips" role="group">
                    {(['all', 'success', 'error', 'skipped'] as RunFilter[]).map(value => (
                      <button
                        key={value}
                        type="button"
                        className="auto-chip"
                        data-active={runFilter === value}
                        onClick={() => setRunFilter(value)}
                      >
                        {t(value === 'all'
                          ? 'runsFilterAll'
                          : value === 'success' ? 'statusSuccess' : value === 'error' ? 'statusError' : 'statusSkipped')}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="auto-icon-btn auto-spacer"
                    data-spin={refreshing || undefined}
                    aria-label={t('refresh')}
                    title={t('refresh')}
                    disabled={refreshing}
                    onClick={() => void manualRefresh()}
                  >
                    <RefreshIcon />
                  </button>
                </div>
                <div className="auto-scroll">
                  {runs.length === 0 ? (
                    <div className="auto-empty">
                      <span className="auto-empty-icon"><DocIcon /></span>
                      <span className="auto-empty-text">{t('runsEmpty')}</span>
                      <span className="auto-empty-hint">{t('runsEmptyHint')}</span>
                    </div>
                  ) : (
                    runs.map((row, index) => (
                      <RunRow
                        key={`${row.jobId ?? ''}-${row.timestamp}-${index}`}
                        run={row}
                        showJob
                        onViewOutput={row.jobId !== undefined
                          ? () => void openRunOutput(row.jobId as string, row.jobLabel ?? (row.jobId as string), row)
                          : undefined}
                      />
                    ))
                  )}
                </div>
              </>
            )}

            {/* 底部设置条：助手创建的任务免确认 */}
            {tab === 'jobs' && autoApprove !== null ? (
              <div className="auto-foot">
                <span className="auto-foot-main">
                  <span className="auto-foot-label">{t('autoApprove')}</span>
                  <span className="auto-foot-hint">{t('autoApproveHint')}</span>
                </span>
                <button
                  type="button"
                  className="auto-switch"
                  role="switch"
                  aria-checked={autoApprove}
                  aria-label={t('autoApprove')}
                  onClick={() => void toggleAutoApprove()}
                />
              </div>
            ) : null}

            {/* 全文查看覆盖层 */}
            {viewing !== null ? (
              <div className="auto-viewer">
                <div className="auto-viewer-head">
                  <span className="auto-viewer-title" title={viewing.title}>{viewing.title}</span>
                  <button
                    type="button"
                    className="auto-btn"
                    onClick={() => {
                      void navigator.clipboard?.writeText(viewing.content)
                        .then(() => showToast(t('copied')))
                        .catch(() => reportError(t('copy'), new Error('clipboard unavailable')))
                    }}
                  >
                    {t('copy')}
                  </button>
                  <button type="button" className="psh-close" aria-label={t('outputClose')} onClick={() => setViewing(null)}>
                    <CloseIcon size={15} />
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
        <div className="auto-toast" role="status" data-tone={toast.tone} onClick={() => setToast(null)}>
          <span className="auto-toast-dot" />
          <span>{toast.text}</span>
        </div>,
        document.body,
      )}
    </>
  )
}
