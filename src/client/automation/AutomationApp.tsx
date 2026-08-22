/**
 * automation — 容器组件（状态中枢 + 侧边栏入口 portal）。
 *
 * 职责：
 *  - 持有卡片/抽屉的开合与 closing 动画状态机（复用 modal-animation，240ms）；
 *  - 持有 AutomationCatalog（任务自带执行计划）/ 执行日志 并即时持久化；
 *  - 启动定时调度检查器（按每任务 schedule 触发，每天有没有执行都有记录）；
 *  - 接入模型目录（任务可绑定模型 + 推理强度）；
 *  - 「自动化」菜单项经 portal 渲进侧边栏（新会话正下方），rail 态只显示图标；
 *  - Esc 分层退出：先关抽屉，再关卡片。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalClose } from '../modal-animation.js'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { AutomationCard } from './AutomationCard.tsx'
import { TaskEditorModal } from './TaskEditorModal.tsx'
import { createModelSource, type ModelSource } from './models.ts'
import { AutomationIcon } from './icons.tsx'
import { makeT } from './locales.ts'
import { ensureStyles } from './styles.ts'
import {
  defaultSteps, loadCatalog, loadLogs, recordRun, saveCatalog, saveLogs,
} from './storage.ts'
import { startScheduler } from './scheduler.ts'
import type {
  AutomationCatalog,
  AutomationLogEntry,
  AutomationRunResult,
  AutomationTask,
  ModelOption,
} from './types.ts'

/** 侧边栏折叠观察：与 sidebar-float 相同的稳定 DOM 契约。 */
const FRAME_SELECTOR = 'div:has(> [data-shell-overlay])'

/** 抽屉状态：关闭 / 新建（预选分类）/ 编辑（指定任务）。 */
interface DrawerState {
  open: boolean
  presetCategory?: string
  editing?: AutomationTask | null
}

export function AutomationApp({ ctx }: { ctx: ClientContext }): JSX.Element {
  ensureStyles()
  const t = useMemo(makeT, [])

  // ---- 数据：localStorage 初始化，commit 阶段即时落盘 ---------------------
  const [catalog, setCatalog] = useState<AutomationCatalog>(loadCatalog)
  const [logs, setLogs] = useState<AutomationLogEntry[]>(loadLogs)
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set<string>())
  const runningRef = useRef<Set<string>>(new Set())

  // refs：调度器闭包经它们读取最新值（避免每 tick 重挂 interval）。
  const catalogRef = useRef(catalog)
  useEffect(() => { catalogRef.current = catalog }, [catalog])

  const replaceCatalog = useCallback((next: AutomationCatalog): void => {
    setCatalog(next)
  }, [])

  useEffect(() => { saveCatalog(catalog) }, [catalog])
  useEffect(() => { saveLogs(logs) }, [logs])

  // ---- 真实执行：把任务步骤交给 host 执行引擎，结果落执行日志 --------------
  const executeTask = useCallback((task: AutomationTask): void => {
    if (runningRef.current.has(task.id)) return
    runningRef.current.add(task.id)
    setRunning(new Set(runningRef.current))
    void (async () => {
      try {
        const response = await fetch('/api/webui-automation/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider: task.provider ?? '',
            model: task.model ?? '',
            retry: task.retry ?? 0,
            steps: task.steps ?? defaultSteps(),
          }),
        })
        const result = await response.json() as AutomationRunResult
        const detailParts: string[] = []
        if (task.model !== undefined && task.model !== '') detailParts.push(task.model)
        if (task.effort !== undefined && task.effort !== '') detailParts.push(task.effort)
        const entry = recordRun(task, result.status, detailParts.length > 0 ? detailParts.join(' · ') : undefined, {
          error: result.error,
          steps: result.steps,
          files: result.files,
        })
        setLogs(prev => [...prev, entry])
      } catch (error) {
        const entry = recordRun(task, 'failed', undefined, {
          error: error instanceof Error ? error.message : String(error),
        })
        setLogs(prev => [...prev, entry])
      } finally {
        runningRef.current.delete(task.id)
        setRunning(new Set(runningRef.current))
      }
    })()
  }, [])

  /** 按任务 id 立即执行（任务行「立即执行」与日志行「重跑」共用）。 */
  const runTaskById = useCallback((taskId: string): void => {
    const task = catalogRef.current.tasks.find(candidate => candidate.id === taskId)
    if (task !== undefined) executeTask(task)
  }, [executeTask])

  /** 任务是否正在执行（调度器防重）。 */
  const isRunning = useCallback((taskId: string): boolean => runningRef.current.has(taskId), [])

  // ---- 定时调度检查器：挂载启动一次；按每任务执行计划触发并真实执行 --------
  useEffect(() => startScheduler({
    getCatalog: () => catalogRef.current,
    executeTask,
    isRunning,
  }), [executeTask, isRunning])

  // ---- 模型目录（任务绑定模型 + 推理强度） ---------------------------------
  const [models, setModels] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const modelSourceRef = useRef<ModelSource | null>(null)
  useEffect(() => {
    modelSourceRef.current = createModelSource(ctx)
  }, [ctx])

  /** 打开抽屉前拉取一次模型目录。 */
  const ensureModels = useCallback((): void => {
    const source = modelSourceRef.current
    if (source === null) return
    setModelsLoading(true)
    source.load()
      .then(list => { setModels(list) })
      .catch(() => { setModels([]) })
      .finally(() => { setModelsLoading(false) })
  }, [])

  // ---- 两级开合动画状态机 --------------------------------------------------
  const [cardOpen, setCardOpen] = useState(false)
  const [drawer, setDrawer] = useState<DrawerState>({ open: false })
  const card = useModalClose(cardOpen, () => { setCardOpen(false) })
  const drawerAnim = useModalClose(drawer.open, () => { setDrawer(prev => ({ ...prev, open: false })) })

  // ---- 侧边栏折叠态：rail 模式下菜单项只显示图标 --------------------------
  const [rail, setRail] = useState(() =>
    document.querySelector(FRAME_SELECTOR)?.hasAttribute('data-sidebar-collapsed') ?? false)
  useEffect(() => {
    const frame = document.querySelector(FRAME_SELECTOR)
    if (frame === null) return
    setRail(frame.hasAttribute('data-sidebar-collapsed'))
    const observer = new MutationObserver(() => {
      setRail(frame.hasAttribute('data-sidebar-collapsed'))
    })
    observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
    return () => { observer.disconnect() }
  }, [])

  // ---- Esc 统一退出：先抽屉后卡片；遮罩由各层自行处理 ----------------------
  useEffect(() => {
    if (!cardOpen && !drawer.open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (drawer.open) drawerAnim.requestClose()
      else card.requestClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [cardOpen, drawer.open, card, drawerAnim])

  // ---- 菜单项：portal 进侧边栏（mount 已把 host 放到新会话按钮下方）--------
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  const [cardAnchor, setCardAnchor] = useState<{ left: number; top: number } | null>(null)
  const openCard = useCallback((): void => {
    const rect = menuBtnRef.current?.getBoundingClientRect()
    setCardAnchor(rect !== undefined ? { left: rect.right + 8, top: rect.top - 6 } : null)
    setCardOpen(true)
  }, [])

  const openNewTask = useCallback((presetCategory: string): void => {
    ensureModels()
    setDrawer({ open: true, presetCategory, editing: null })
  }, [ensureModels])

  const openEditTask = useCallback((taskId: string): void => {
    const task = catalog.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return
    ensureModels()
    setDrawer({ open: true, editing: task })
  }, [catalog, ensureModels])

  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let timer = 0
    const poll = (): void => {
      const host = document.getElementById('dsh-automation-menu-host')
      setMenuHost(host)
      if (host === null) timer = window.setTimeout(poll, 400)
    }
    poll()
    return () => { window.clearTimeout(timer) }
  }, [])

  const menu = menuHost !== null && createPortal(
    <button
      ref={menuBtnRef}
      type="button"
      className="auto-nav"
      data-rail={rail || undefined}
      aria-label={t('entryAria')}
      onClick={openCard}
    >
      <AutomationIcon size={rail ? 18 : 15} />
      {!rail && <span className="auto-nav-label">{t('entry')}</span>}
    </button>,
    menuHost,
  )

  // 编辑模式：以最新目录中的任务为准（编辑期间被删则回退原快照）。
  const editingTask: AutomationTask | null = drawer.editing != null
    ? catalog.tasks.find(task => task.id === drawer.editing?.id) ?? drawer.editing
    : null

  return (
    <>
      {menu}
      <AutomationCard
        open={cardOpen}
        closing={card.closing}
        onClose={card.requestClose}
        t={t}
        catalog={catalog}
        onCatalogChange={replaceCatalog}
        logs={logs}
        onClearLogs={() => { setLogs([]) }}
        onNewTask={openNewTask}
        onEditTask={openEditTask}
        onRunTask={runTaskById}
        onRerunTask={runTaskById}
        running={running}
        anchor={cardAnchor}
      />
      <TaskEditorModal
        open={drawer.open}
        closing={drawerAnim.closing}
        onClose={drawerAnim.requestClose}
        t={t}
        catalog={catalog}
        onCatalogChange={replaceCatalog}
        models={models}
        modelsLoading={modelsLoading}
        presetCategory={drawer.presetCategory}
        editing={editingTask}
      />
    </>
  )
}
