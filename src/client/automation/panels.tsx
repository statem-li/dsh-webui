/**
 * automation — TAB 面板：定时 / 执行任务 / 执行日志。
 *
 * 三个面板都是受控展示组件（数据与动作由 AutomationCard 容器下发）：
 *  - SchedulePanel：执行日期 + 每日定时开关（沿用 v1 配置项）；
 *  - TasksPanel：分类分组任务列表，行点击进入编辑、行尾删除、
 *    分类标题旁「+ 新建任务」打开二级抽屉（预选该分类）；
 *  - LogsPanel：按日期倒序的执行记录，顶部按任务下拉筛选 +
 *    清空记录；状态点区分已执行/失败。
 */

import { useMemo, useState } from 'react'
import { PlusIcon, TrashIcon } from './icons.tsx'
import type { T } from './locales.ts'
import { todayString } from './storage.ts'
import type {
  AutomationCatalog,
  AutomationLogEntry,
  ScheduleConfig,
} from './types.ts'

// ── 定时面板 ─────────────────────────────────────────────────────────────

export interface SchedulePanelProps {
  t: T
  config: ScheduleConfig
  onConfigChange: (patch: Partial<ScheduleConfig>) => void
}

/** 「定时」面板：执行日期设定 + 是否每天定时执行。 */
export function SchedulePanel({ t, config, onConfigChange }: SchedulePanelProps): JSX.Element {
  return (
    <div className="auto-panel">
      <section className="auto-row auto-stagger-item">
        <div className="auto-row-label">{t('dateLabel')}</div>
        <div className="auto-row-hint">{t('dateHint')}</div>
        <div className="auto-date-line">
          <input
            type="date"
            className="auto-date-input"
            value={config.date}
            aria-label={t('dateLabel')}
            onChange={event => { onConfigChange({ date: event.currentTarget.value }) }}
          />
          {config.date !== '' && (
            <button type="button" className="auto-date-clear" onClick={() => { onConfigChange({ date: '' }) }}>
              {t('cancel')}
            </button>
          )}
        </div>
      </section>

      <section className="auto-row auto-stagger-item">
        <div className="auto-row-label">{t('dailyLabel')}</div>
        <div className="auto-switch-line">
          <span className="auto-switch-text">{t('dailyHint')}</span>
          <button
            type="button"
            className="auto-switch"
            role="switch"
            aria-checked={config.daily}
            aria-label={t('dailyLabel')}
            onClick={() => { onConfigChange({ daily: !config.daily }) }}
          />
        </div>
      </section>
    </div>
  )
}

// ── 执行任务面板 ──────────────────────────────────────────────────────────

export interface TasksPanelProps {
  t: T
  catalog: AutomationCatalog
  /** 新建任务（presetCategory = 预选分类）。 */
  onNewTask: (presetCategory: string) => void
  /** 编辑任务。 */
  onEditTask: (taskId: string) => void
  /** 删除任务。 */
  onDeleteTask: (taskId: string) => void
}

/** 「执行任务」面板：按分类分组展示任务，支持新建/编辑/删除。 */
export function TasksPanel({ t, catalog, onNewTask, onEditTask, onDeleteTask }: TasksPanelProps): JSX.Element {
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
            {tasks.map(task => (
              <div
                key={task.id}
                className="auto-task-row"
                role="button"
                tabIndex={0}
                onClick={() => { onEditTask(task.id) }}
                onKeyDown={event => {
                  if (event.key === 'Enter') onEditTask(task.id)
                }}
                title={t('editTask')}
              >
                <span className="auto-task-name">{task.name}</span>
                {task.model !== undefined && task.model !== '' && (
                  <span className="auto-task-badge">{task.model}</span>
                )}
                {task.effort !== undefined && task.effort !== '' && (
                  <span className="auto-task-badge">{task.effort}</span>
                )}
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
            ))}
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

/** 「执行日志」面板：按任务下拉筛选 + 日期倒序记录列表。 */
export function LogsPanel({ t, catalog, logs, onClearLogs }: LogsPanelProps): JSX.Element {
  // 筛选任务 id：'all' = 全部任务（需求：按已创建的任务下拉分类筛选）。
  const [filter, setFilter] = useState<string>('all')

  const visible = useMemo(() => {
    const list = filter === 'all' ? logs : logs.filter(log => log.taskId === filter)
    return [...list].sort((a, b) =>
      a.date === b.date ? b.createdAt - a.createdAt : (a.date < b.date ? 1 : -1))
  }, [logs, filter])

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

  const timeOf = (createdAt: number): string => {
    const d = new Date(createdAt)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

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
            <div key={log.id} className="auto-log-row">
              <span className="auto-log-dot" data-status={log.status} aria-hidden="true" />
              <span className="auto-log-task">{log.taskName}</span>
              {log.detail !== undefined && log.detail !== '' && (
                <span className="auto-log-detail" title={log.detail}>{log.detail}</span>
              )}
              <span className="auto-log-time">{timeOf(log.createdAt)}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
