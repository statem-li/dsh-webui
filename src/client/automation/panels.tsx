/**
 * automation — TAB 面板：执行任务 / 执行日志。
 *
 * 两个面板都是受控展示组件（数据与动作由 AutomationCard 容器下发）：
 *  - TasksPanel：分类分组任务列表——每行显示启用开关、任务名、执行计划预览、
 *    模型徽标，行尾「立即执行」+ 删除；行点击进入编辑；分类标题旁「+ 新建任务」。
 *  - LogsPanel：按日期倒序的执行记录，顶部按任务/状态筛选 + 清空；每条记录可
 *    展开查看单次执行的步骤结果（成功/失败/跳过 + 输出摘要 + 失败原因）与生成的
 *    文件清单（文件名/完整路径/大小 + 下载/复制路径/打开所在文件夹），并可重跑。
 */

import { useMemo, useState } from 'react'
import {
  ChevronDownIcon, CopyIcon, DownloadIcon, FolderOpenIcon, PlayIcon, PlusIcon, RotateCwIcon, TrashIcon,
} from './icons.tsx'
import type { T } from './locales.ts'
import { schedulePreview } from './schedule.ts'
import { todayString } from './storage.ts'
import type {
  AutomationCatalog,
  AutomationFileResult,
  AutomationLogEntry,
  AutomationStepResult,
} from './types.ts'

// ── 工具函数 ──────────────────────────────────────────────────────────────

/** 字节数格式化。 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 相对日期标题（今天 / 昨天 / 原始 yyyy-MM-dd）。 */
function dayLabel(date: string, t: T): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const y = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
  if (date === todayString()) return t('dayToday')
  if (date === y) return t('dayYesterday')
  return date
}

/** HH:mm。 */
function timeOf(createdAt: number): string {
  const d = new Date(createdAt)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ── 执行任务面板 ──────────────────────────────────────────────────────────

export interface TasksPanelProps {
  t: T
  catalog: AutomationCatalog
  /** 新建任务（presetCategory = 预选分类）。 */
  onNewTask: (presetCategory: string) => void
  /** 编辑任务。 */
  onEditTask: (taskId: string) => void
  /** 切换任务启用/停用。 */
  onToggleTask: (taskId: string, enabled: boolean) => void
  /** 删除任务。 */
  onDeleteTask: (taskId: string) => void
  /** 立即执行任务。 */
  onRunTask: (taskId: string) => void
  /** 正在执行的任务 id 集合。 */
  running: ReadonlySet<string>
}

/** 「执行任务」面板：按分类分组展示任务，支持新建/编辑/删除/立即执行。 */
export function TasksPanel({ t, catalog, onNewTask, onEditTask, onToggleTask, onDeleteTask, onRunTask, running }: TasksPanelProps): JSX.Element {
  return (
    <div className="auto-panel">
      {catalog.tasks.length === 0 && (
        <div className="auto-empty auto-stagger-item">{t('emptyTasks')}</div>
      )}
      {catalog.categories.map(cat => {
        const tasks = catalog.tasks.filter(task => task.categoryId === cat.id)
        if (tasks.length === 0 && catalog.tasks.length > 0) return null
        return (
          <section key={cat.id} className="auto-task-cat auto-stagger-item">
            <div className="auto-task-cat-name">
              {cat.label}
              <button
                type="button"
                className="auto-cat-add"
                onClick={() => { onNewTask(cat.id) }}
              >
                <PlusIcon size={11} />
                {t('newTask')}
              </button>
            </div>
            {tasks.map(task => {
              const enabled = task.enabled !== false
              const isRunning = running.has(task.id)
              return (
                <div
                  key={task.id}
                  className="auto-task-row"
                  role="button"
                  tabIndex={0}
                  data-disabled={!enabled || undefined}
                  onClick={() => { onEditTask(task.id) }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') onEditTask(task.id)
                  }}
                  title={t('editTask')}
                >
                  <button
                    type="button"
                    className="auto-switch auto-switch-sm"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${t('enabledLabel')} · ${task.name}`}
                    onClick={event => {
                      event.stopPropagation()
                      onToggleTask(task.id, !enabled)
                    }}
                  />
                  <span className="auto-task-name">
                    {task.name}
                    <span className="auto-task-sched">{schedulePreview(task.schedule)}</span>
                  </span>
                  {task.model !== undefined && task.model !== '' && (
                    <span className="auto-task-badge">{task.model}</span>
                  )}
                  <button
                    type="button"
                    className="auto-task-run"
                    aria-label={t('runNow')}
                    title={t('runNow')}
                    disabled={isRunning}
                    onClick={event => {
                      event.stopPropagation()
                      onRunTask(task.id)
                    }}
                  >
                    <PlayIcon size={13} />
                  </button>
                  <button
                    type="button"
                    className="auto-task-del"
                    aria-label={t('delete')}
                    onClick={event => {
                      event.stopPropagation()
                      onDeleteTask(task.id)
                    }}
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

// ── 执行日志面板 ──────────────────────────────────────────────────────────

export interface LogsPanelProps {
  t: T
  catalog: AutomationCatalog
  logs: AutomationLogEntry[]
  onClearLogs: () => void
  /** 重跑某个任务（按 taskId）。 */
  onRerunTask: (taskId: string) => void
  /** 正在执行的任务 id 集合。 */
  running: ReadonlySet<string>
}

/** 单个文件行：名称/路径/大小 + 下载/复制路径/打开所在文件夹。 */
function FileRow({ t, file }: { t: T; file: AutomationFileResult }): JSX.Element {
  const [copied, setCopied] = useState(false)

  const copyPath = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(file.path)
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 2000)
    } catch { /* 剪贴板不可用 */ }
  }

  const download = (): void => {
    const a = document.createElement('a')
    a.href = `/api/webui-automation/download?path=${encodeURIComponent(file.path)}`
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const reveal = (): void => {
    void fetch('/api/webui-automation/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: file.path }),
    }).catch(() => {})
  }

  return (
    <div className="auto-file-row">
      <span className="auto-file-name" title={file.path}>{file.name}</span>
      <span className="auto-file-path" title={file.path}>{file.path}</span>
      <span className="auto-file-size">{formatSize(file.size)}</span>
      <span className="auto-file-ops">
        <button type="button" className="auto-file-op" title={t('downloadFile')} onClick={download}>
          <DownloadIcon size={13} />
        </button>
        <button type="button" className="auto-file-op" title={copied ? t('copied') : t('copyPath')} onClick={() => { void copyPath() }}>
          <CopyIcon size={13} />
        </button>
        <button type="button" className="auto-file-op" title={t('openFolder')} onClick={reveal}>
          <FolderOpenIcon size={13} />
        </button>
      </span>
    </div>
  )
}

/** 单条执行日志行（可展开详情）。 */
function LogRow({ t, log, canRerun, running, onRerun }: {
  t: T
  log: AutomationLogEntry
  canRerun: boolean
  running: ReadonlySet<string>
  onRerun: (taskId: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const steps = log.steps ?? []
  const files = log.files ?? []
  const isRunning = running.has(log.taskId)

  return (
    <div className="auto-log-row-wrap">
      <div
        className="auto-log-row"
        role="button"
        tabIndex={0}
        onClick={() => { setExpanded(v => !v) }}
        onKeyDown={event => {
          if (event.key === 'Enter') setExpanded(v => !v)
        }}
        data-expanded={expanded || undefined}
      >
        <span className="auto-log-dot" data-status={log.status} aria-hidden="true" />
        <span className="auto-log-task">{log.taskName}</span>
        {log.detail !== undefined && log.detail !== '' && (
          <span className="auto-log-detail" title={log.detail}>{log.detail}</span>
        )}
        <span className="auto-log-time">{timeOf(log.createdAt)}</span>
        <span className={`auto-log-chevron${expanded ? ' open' : ''}`} aria-hidden="true">
          <ChevronDownIcon size={13} />
        </span>
      </div>

      {expanded && (
        <div className="auto-log-detail-panel">
          {log.error !== undefined && log.error !== '' && (
            <div className="auto-log-error">
              <span className="auto-log-error-label">{t('logError')}</span>
              {log.error}
            </div>
          )}

          {steps.length > 0 && (
            <div className="auto-log-steps">
              {steps.map((step: AutomationStepResult) => (
                <div key={step.stepId} className="auto-log-step" data-status={step.status}>
                  <span className="auto-log-step-dot" data-status={step.status} aria-hidden="true" />
                  <div className="auto-log-step-body">
                    <div className="auto-log-step-head">
                      <span className="auto-log-step-name">{step.name}</span>
                      <span className="auto-log-step-status" data-status={step.status}>
                        {step.status === 'success' ? t('stepStatusSuccess')
                          : step.status === 'failed' ? t('stepStatusFailed')
                            : t('stepStatusSkipped')}
                      </span>
                      {step.recordCount !== undefined && step.recordCount > 0 && (
                        <span className="auto-log-step-count">{t('stepRecords', { n: step.recordCount })}</span>
                      )}
                    </div>
                    {step.summary !== undefined && step.summary !== '' && (
                      <div className="auto-log-step-summary">{step.summary}</div>
                    )}
                    {step.error !== undefined && step.error !== '' && (
                      <div className="auto-log-step-error">{step.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {files.length > 0 && (
            <div className="auto-log-files">
              <div className="auto-log-files-title">{t('fileSection')}</div>
              {files.map(file => <FileRow key={file.path} t={t} file={file} />)}
            </div>
          )}

          {canRerun && (
            <button
              type="button"
              className="auto-log-rerun"
              disabled={isRunning}
              onClick={() => { onRerun(log.taskId) }}
            >
              <RotateCwIcon size={13} />
              {isRunning ? t('executing') : t('rerun')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** 「执行日志」面板：按任务/状态筛选 + 日期倒序 + 展开详情。 */
export function LogsPanel({ t, catalog, logs, onClearLogs, onRerunTask, running }: LogsPanelProps): JSX.Element {
  const [filter, setFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const visible = useMemo(() => {
    let list = filter === 'all' ? logs : logs.filter(log => log.taskId === filter)
    if (statusFilter === 'success') list = list.filter(log => log.status === 'success')
    if (statusFilter === 'failed') list = list.filter(log => log.status === 'failed')
    return [...list].sort((a, b) =>
      a.date === b.date ? b.createdAt - a.createdAt : (a.date < b.date ? 1 : -1))
  }, [logs, filter, statusFilter])

  // 日期倒序分组。
  const groups = useMemo(() => {
    const map = new Map<string, AutomationLogEntry[]>()
    for (const log of visible) {
      const bucket = map.get(log.date)
      if (bucket === undefined) map.set(log.date, [log])
      else bucket.push(log)
    }
    return [...map.entries()]
  }, [visible])

  const existingTaskIds = useMemo(() => new Set(catalog.tasks.map(task => task.id)), [catalog])

  return (
    <div className="auto-panel">
      <div className="auto-logs-toolbar auto-stagger-item">
        <select
          className="auto-log-filter"
          value={filter}
          aria-label={t('filterLabel')}
          onChange={event => { setFilter(event.currentTarget.value) }}
        >
          <option value="all">{t('filterAll')}</option>
          {catalog.tasks.map(task => (
            <option key={task.id} value={task.id}>{task.name}</option>
          ))}
          {/* 已删除任务的遗留记录仍可筛选查看 */}
          {[...new Map(logs.filter(log => !catalog.tasks.some(task => task.id === log.taskId))
            .map(log => [log.taskId, log.taskName])).entries()]
            .map(([taskId, name]) => <option key={taskId} value={taskId}>{name}</option>)}
        </select>
        <select
          className="auto-log-filter auto-log-status-filter"
          value={statusFilter}
          aria-label={t('filterStatusLabel')}
          onChange={event => { setStatusFilter(event.currentTarget.value) }}
        >
          <option value="all">{t('filterStatusAll')}</option>
          <option value="success">{t('filterStatusSuccess')}</option>
          <option value="failed">{t('filterStatusFailed')}</option>
        </select>
        {logs.length > 0 && (
          <button
            type="button"
            className="auto-log-clear"
            onClick={() => {
              if (window.confirm(t('clearLogsConfirm'))) onClearLogs()
            }}
          >
            {t('clearLogs')}
          </button>
        )}
      </div>

      {visible.length === 0 && (
        <div className="auto-empty auto-stagger-item">
          {t('logEmpty')}
          <div className="auto-empty-hint">{t('logEmptyHint')}</div>
        </div>
      )}

      {groups.map(([date, entries]) => (
        <section key={date} className="auto-stagger-item">
          <div className="auto-log-day">{dayLabel(date, t)}</div>
          {entries.map(log => (
            <LogRow
              key={log.id}
              t={t}
              log={log}
              canRerun={existingTaskIds.has(log.taskId)}
              running={running}
              onRerun={onRerunTask}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
