/**
 * automation — 一级卡片：TAB 容器（定时 / 执行任务 / 执行日志）。
 *
 * 从「自动化」菜单右侧滑出（popover）；窄屏或右侧空间不足回退底部 sheet。
 * 卡片宽度高度随选中 TAB 平滑变化（transition 240ms）：日志页最大。
 * 面板切换淡入 + 内容错落渐显；关闭时整体反向收回。
 */

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { AutomationIcon, CloseIcon } from './icons.tsx'
import { ensureStyles } from './styles.ts'
import { LogsPanel, SchedulePanel, TasksPanel } from './panels.tsx'
import type { T } from './locales.ts'
import type {
  AutomationCatalog,
  AutomationLogEntry,
  ScheduleConfig,
} from './types.ts'

/** TAB 标识。 */
export type AutomationTab = 'schedule' | 'tasks' | 'logs'

/** 每个 TAB 的卡片尺寸（px）：日志需要很大的卡片。 */
const TAB_SIZES: Record<AutomationTab, { width: number; height: number }> = {
  schedule: { width: 400, height: 330 },
  tasks: { width: 480, height: 460 },
  logs: { width: 720, height: 560 },
}

/** popover 回退阈值：锚点右侧可用宽度低于该值改用底部 sheet。 */
const POPOVER_MIN_SPACE = 360

export interface AutomationCardProps {
  open: boolean
  closing: boolean
  onClose: () => void
  t: T
  schedule: ScheduleConfig
  onScheduleChange: (patch: Partial<ScheduleConfig>) => void
  catalog: AutomationCatalog
  onCatalogChange: (catalog: AutomationCatalog) => void
  logs: AutomationLogEntry[]
  onClearLogs: () => void
  /** 新建任务（预选分类）。 */
  onNewTask: (presetCategory: string) => void
  /** 编辑任务。 */
  onEditTask: (taskId: string) => void
  /** 菜单项锚点（popover 定位）；null/空间不足时回退 sheet。 */
  anchor: { left: number; top: number } | null
}

/** 渲染 TAB 式一级卡片（含遮罩）。 */
export function AutomationCard({
  open, closing, onClose, t, schedule, onScheduleChange, catalog, logs, onClearLogs,
  onNewTask, onEditTask, anchor,
}: AutomationCardProps): JSX.Element | null {
  // Hooks 在条件 return 之前（跨渲染数量一致）。
  const [tab, setTab] = useState<AutomationTab>('schedule')

  if (!open) return null
  ensureStyles()
  const anim = closing ? 'out' : 'in'

  // 模式判定：有锚点且右侧放得下 → popover；否则底部 sheet。
  const vw = window.innerWidth
  const vh = window.innerHeight
  const asPopover = anchor !== null && (vw - anchor.left) >= POPOVER_MIN_SPACE
  const mode = asPopover ? 'popover' : 'sheet'

  // popover 定位 + 当前 TAB 尺寸（宽高变化由 CSS transition 平滑过渡）。
  let style: CSSProperties | undefined
  if (anchor !== null && asPopover) {
    const left = Math.round(anchor.left)
    const top = Math.max(8, Math.min(Math.round(anchor.top), vh - 200))
    const size = TAB_SIZES[tab]
    const width = Math.min(size.width, vw - left - 12)
    const height = Math.min(size.height, vh - top - 12)
    style = { left, top, width, height }
  }

  const tabs: Array<{ key: AutomationTab; label: string }> = [
    { key: 'schedule', label: t('tabSchedule') },
    { key: 'tasks', label: t('tabTasks') },
    { key: 'logs', label: t('tabLogs') },
  ]

  return (
    <>
      <div className="auto-mask" data-anim={anim} aria-hidden="true" onClick={onClose} />
      <div
        className="auto-card"
        data-anim={anim}
        data-mode={mode}
        style={style}
        role="dialog"
        aria-label={t('cardTitle')}
      >
        <div className="auto-card-head">
          <span className="auto-card-title">
            <AutomationIcon size={16} />
            {t('cardTitle')}
          </span>
          <button type="button" className="auto-close" aria-label={t('close')} onClick={onClose}>
            <CloseIcon size={15} />
          </button>
        </div>

        {/* TAB 栏：切换时卡片宽高平滑过渡到该 TAB 的预设尺寸 */}
        <div className="auto-tabs" role="tablist">
          {tabs.map(item => (
            <button
              key={item.key}
              type="button"
              className="auto-tab"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => { setTab(item.key) }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="auto-card-body">
          {tab === 'schedule' && (
            <SchedulePanel t={t} config={schedule} onConfigChange={onScheduleChange} />
          )}
          {tab === 'tasks' && (
            <TasksPanel
              t={t}
              catalog={catalog}
              onNewTask={onNewTask}
              onEditTask={onEditTask}
              onDeleteTask={taskId => {
                onCatalogChange({ ...catalog, tasks: catalog.tasks.filter(task => task.id !== taskId) })
              }}
            />
          )}
          {tab === 'logs' && (
            <LogsPanel t={t} catalog={catalog} logs={logs} onClearLogs={onClearLogs} />
          )}
        </div>
      </div>
    </>
  )
}
