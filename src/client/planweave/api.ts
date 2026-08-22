/**
 * webui — PlanWeave client API：纯 fetch 封装 host 的 /api/planweave/*。
 * 无 typert、无 DSH 源码改动；错误统一归一成 { ok:false, error }。
 */

/** 块状态视图（host ExecutionStatus.blocks 的子集）。 */
export interface PwBlockView {
  ref: string
  taskId: string
  blockId: string
  type: 'implementation' | 'review'
  effectiveExecutor: string
  status: string
  reason: string | null
  completionReason: 'passed' | 'max_cycles_reached' | null
  lastRunId: string | null
}

/** 任务状态视图。 */
export interface PwTaskView {
  taskId: string
  status: string
  openFeedbackCount: number
}

/** GET /status 返回的执行状态子集。 */
export interface PwStatusView {
  taskTotal: number
  blockTotal: number
  tasks: PwTaskView[]
  blocks: PwBlockView[]
  currentRefs: string[]
  nextClaimable: string[]
  counts: {
    tasks: Record<string, number>
    blocks: Record<string, number>
    feedback: Record<string, number>
  }
}

export interface StatusResult {
  ok: boolean
  projectId?: string
  status?: PwStatusView
  error?: string
}

/** 任务图节点内的块。 */
export interface PwGraphBlock {
  ref: string
  id: string
  type: 'implementation' | 'review'
  title: string
  status: string
}

/** 任务图节点（task）。dependsOn = 上游任务（被依赖者）id 列表。 */
export interface PwGraphNode {
  taskId: string
  title: string
  status: string
  dependsOn: string[]
  blocks: PwGraphBlock[]
  /** 任务验收标准列表（可选出现）。 */
  acceptance?: string[]
  /** 任务提示词 markdown 相对路径（可选出现）。 */
  promptPath?: string
  /** manifest 里配置的任务级 executor（未配置为 null）。 */
  executor?: string | null
}

/** GET /graph 返回的任务图。 */
export interface PwGraphView {
  projectTitle: string
  nodes: PwGraphNode[]
}

export interface GraphResult {
  ok: boolean
  projectId?: string
  graph?: PwGraphView
  error?: string
}

export interface RunResult {
  ok: boolean
  summary?: string
  counts?: PwStatusView['counts']
  taskTotal?: number
  blockTotal?: number
  error?: string
}

export interface SeedResult {
  ok: boolean
  taskTotal?: number
  blockTotal?: number
  error?: string
}

/** 一个可选的执行供应商（含其模型清单）。 */
export interface PwProviderOption {
  /** settings 里的 provider 键（传给 ctx.llm.stream 的 provider）。 */
  id: string
  /** 友好显示名（displayName，缺省同 id）。 */
  displayName: string
  models: string[]
}

export interface ProvidersResult {
  ok: boolean
  providers?: PwProviderOption[]
  error?: string
}

export interface RemoveTaskResult {
  ok: boolean
  removed?: string
  affectedTasks?: string[]
  taskTotal?: number
  blockTotal?: number
  error?: string
}

export interface CreateTaskInput {
  title: string
  promptMarkdown?: string
  acceptance?: string[]
  /** 是否同时创建一个评审门块（实现 + 评审）。 */
  withReview?: boolean
}

export interface CreateTaskResult {
  ok: boolean
  affectedTasks?: string[]
  taskTotal?: number
  blockTotal?: number
  error?: string
}

export interface SetDepsResult {
  ok: boolean
  taskId?: string
  dependsOn?: string[]
  error?: string
}

/** Auto Run 运行快照。 */
export interface PwAutoRunSnapshot {
  id: string
  projectName: string
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'failed'
  startedAt: string
  endedAt: string | null
  steps: number
  maxSteps: number
  events: string[]
}

export interface AutoRunStartResult {
  ok: boolean
  snapshot?: PwAutoRunSnapshot
  error?: string
}

export interface AutoRunControlResult {
  ok: boolean
  snapshot?: PwAutoRunSnapshot
  error?: string
}

export interface AutoRunStateResult {
  ok: boolean
  snapshot?: PwAutoRunSnapshot | null
  error?: string
}

export interface RecordContentResult {
  ok: boolean
  content?: string
  file?: string
  error?: string
}

/** 统一图编辑事务（POST /edit）。 */
export type EditOp =
  | { op: 'block.add'; taskId: string; type: 'implementation' | 'review'; title: string; promptMarkdown?: string; dependsOn?: string[] }
  | { op: 'block.remove'; ref: string }
  | { op: 'block.prompt'; ref: string; markdown: string }
  | { op: 'block.planning'; ref: string; reviewRequired?: boolean; maxFeedbackCycles?: number }
  | { op: 'task.prompt'; taskId: string; markdown: string }
  | { op: 'task.acceptance'; taskId: string; acceptance: string[] }
  | { op: 'task.title'; taskId: string; title: string }
  | { op: 'task.executor'; taskId: string; executor: string }

export interface EditResult {
  ok: boolean
  taskTotal?: number
  blockTotal?: number
  error?: string
}

/** GET /task-source 返回的任务源提示词。 */
export interface TaskSourceResult {
  ok: boolean
  content?: string
  path?: string
  title?: string
  acceptance?: string[]
  error?: string
}

export interface ExecutorsResult {
  ok: boolean
  executors?: string[]
  error?: string
}

export interface DoctorIssueView {
  code?: string
  message?: string
  severity?: string
  ref?: string
  repaired?: boolean
  [key: string]: unknown
}

export interface DoctorResult {
  ok: boolean
  report?: { ok?: boolean; issues?: DoctorIssueView[] }
  error?: string
}

/** 搜索结果（host 透传 DesktopSearchResult）。 */
export interface SearchItem {
  kind?: string
  ref?: string
  title?: string
  excerpt?: string
  recordId?: string
  path?: string
}

export interface SearchResultList {
  ok: boolean
  results?: SearchItem[]
  error?: string
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export interface StatisticsResult {
  ok: boolean
  statistics?: Record<string, unknown>
  error?: string
}

export interface TodosResult {
  ok: boolean
  todos?: Record<string, unknown>
  error?: string
}

/** 图质量诊断（GraphQualityDiagnostic 子集）。 */
export interface QualityDiag {
  severity?: 'error' | 'warning' | 'info'
  message?: string
  count?: number
  code?: string
}

export interface QualityResult {
  ok: boolean
  report?: { ok?: boolean; summary?: Record<string, unknown>; diagnostics?: QualityDiag[] }
  error?: string
}

/** 项目清单条目。 */
export interface PwProjectSummary {
  id: string
  name: string
  kind: 'managed' | 'external'
  rootPath: string
  canvases: number
}

export interface ProjectsResult {
  ok: boolean
  projects?: PwProjectSummary[]
  error?: string
}

export interface CreateProjectResult {
  ok: boolean
  id?: string
  name?: string
  error?: string
}

/** GET /records 返回的单条执行产物记录（run/review/feedback/submission）。 */
export interface PwRecord {
  /** RUN-001 / REV-002 / FE-001 / FS-001 形式。 */
  id: string
  kind: 'run' | 'review' | 'feedback' | 'submission'
  /** T-001#B-001 形式的块引用。 */
  ref: string
  taskId: string
  /** ≤160 字符片段。 */
  summary: string
  /** ISO 时间。 */
  at: string
  /** 绝对路径。 */
  dir: string
}

export interface RecordsResult {
  ok: boolean
  records?: PwRecord[]
  error?: string
}

async function toJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return await res.json() as Record<string, unknown>
  } catch {
    return { ok: false, error: `HTTP ${String(res.status)}` }
  }
}

/** 创建 PlanWeave HTTP API（每次面板打开复用同一实例即可）。 */
export function createPlanweaveApi() {
  return {
    async status(projectName?: string): Promise<StatusResult> {
      const qs = projectName !== undefined && projectName !== '' ? `?projectName=${encodeURIComponent(projectName)}` : ''
      try {
        return await toJson(await fetch(`/api/planweave/status${qs}`, { cache: 'no-store' })) as unknown as StatusResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    async graph(projectName?: string): Promise<GraphResult> {
      const qs = projectName !== undefined && projectName !== '' ? `?projectName=${encodeURIComponent(projectName)}` : ''
      try {
        return await toJson(await fetch(`/api/planweave/graph${qs}`, { cache: 'no-store' })) as unknown as GraphResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** GET /records：执行产物时间线（按 at 倒序由 host 保证；limit 默认 30）。 */
    async records(limit = 30, projectName?: string): Promise<RecordsResult> {
      const qs = `?limit=${encodeURIComponent(String(limit))}${projectName !== undefined && projectName !== '' ? `&projectName=${encodeURIComponent(projectName)}` : ''}`
      try {
        return await toJson(await fetch(`/api/planweave/records${qs}`, { cache: 'no-store' })) as unknown as RecordsResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** GET /providers：可选执行供应商与其模型清单（设置卡下拉数据源）。 */
    async listProviders(): Promise<ProvidersResult> {
      try {
        return await toJson(await fetch('/api/planweave/providers', { cache: 'no-store' })) as unknown as ProvidersResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** POST /tasks/remove：删除一个任务节点（图编辑事务，非法删除由 host 返回诊断）。 */
    async removeTask(taskId: string, projectName?: string): Promise<RemoveTaskResult> {
      try {
        return await toJson(await fetch('/api/planweave/tasks/remove', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId, ...(projectName !== undefined && projectName !== '' ? { projectName } : {}) }),
        })) as unknown as RemoveTaskResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** POST /tasks：新建任务节点（可选带评审门）。 */
    async createTask(input: CreateTaskInput, projectName?: string): Promise<CreateTaskResult> {
      try {
        return await toJson(await fetch('/api/planweave/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, ...(projectName !== undefined && projectName !== '' ? { projectName } : {}) }),
        })) as unknown as CreateTaskResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** POST /tasks/deps：整表设置某任务的上游依赖。 */
    async setDeps(taskId: string, dependsOn: string[], projectName?: string): Promise<SetDepsResult> {
      try {
        return await toJson(await fetch('/api/planweave/tasks/deps', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId, dependsOn, ...(projectName !== undefined && projectName !== '' ? { projectName } : {}) }),
        })) as unknown as SetDepsResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** POST /autorun/start：启动后台自动推进（llm 直跑）。 */
    async autoRunStart(maxSteps: number, projectName?: string): Promise<AutoRunStartResult> {
      try {
        return await toJson(await fetch('/api/planweave/autorun/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ maxSteps, ...(projectName !== undefined && projectName !== '' ? { projectName } : {}) }),
        })) as unknown as AutoRunStartResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** POST /autorun/control：pause / resume / stop。 */
    async autoRunControl(action: 'pause' | 'resume' | 'stop', id: string): Promise<AutoRunControlResult> {
      try {
        return await toJson(await fetch('/api/planweave/autorun/control', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, id }),
        })) as unknown as AutoRunControlResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** GET /autorun/state：不带 id 返回项目最近一次。 */
    async autoRunState(projectName?: string, id?: string): Promise<AutoRunStateResult> {
      const qs = `?${id !== undefined && id !== '' ? `id=${encodeURIComponent(id)}` : `projectName=${encodeURIComponent(projectName ?? '')}`}`
      try {
        return await toJson(await fetch(`/api/planweave/autorun/state${qs}`, { cache: 'no-store' })) as unknown as AutoRunStateResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** GET /record-content：读取产物文件文本。 */
    async recordContent(dir: string, file: string, projectName?: string): Promise<RecordContentResult> {
      const qs = `?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(file)}${projectName !== undefined && projectName !== '' ? `&projectName=${encodeURIComponent(projectName)}` : ''}`
      try {
        return await toJson(await fetch(`/api/planweave/record-content${qs}`, { cache: 'no-store' })) as unknown as RecordContentResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** POST /reveal：在文件管理器打开产物目录。 */
    async reveal(dir: string, projectName?: string): Promise<{ ok: boolean; error?: string }> {
      try {
        return await toJson(await fetch('/api/planweave/reveal', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dir, ...(projectName !== undefined && projectName !== '' ? { projectName } : {}) }),
        })) as unknown as { ok: boolean; error?: string }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** POST /edit：统一图编辑事务（块增删改/任务字段/executor）。 */
    async edit(payload: EditOp, projectName?: string): Promise<EditResult> {
      try {
        return await toJson(await fetch('/api/planweave/edit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, ...(projectName !== undefined && projectName !== '' ? { projectName } : {}) }),
        })) as unknown as EditResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** GET /task-source：任务/块（id=taskId 或 blockRef）源提示词。 */
    async taskSource(id: string, projectName?: string): Promise<TaskSourceResult> {
      const qs = `?id=${encodeURIComponent(id)}${projectName !== undefined && projectName !== '' ? `&projectName=${encodeURIComponent(projectName)}` : ''}`
      try {
        return await toJson(await fetch(`/api/planweave/task-source${qs}`, { cache: 'no-store' })) as unknown as TaskSourceResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** GET /executors：内置 executor 名清单。 */
    async listExecutors(): Promise<ExecutorsResult> {
      try {
        return await toJson(await fetch('/api/planweave/executors', { cache: 'no-store' })) as unknown as ExecutorsResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** GET /projects：全部项目清单。 */
    async listProjects(): Promise<ProjectsResult> {
      try {
        return await toJson(await fetch('/api/planweave/projects', { cache: 'no-store' })) as unknown as ProjectsResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** POST /projects：新建托管项目（幂等）。 */
    async createProject(name: string): Promise<CreateProjectResult> {
      try {
        return await toJson(await fetch('/api/planweave/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        })) as unknown as CreateProjectResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** POST /doctor：一致性体检（repair 自动修复）。 */
    async doctor(repair = false, projectName?: string): Promise<DoctorResult> {
      try {
        return await toJson(await fetch('/api/planweave/doctor', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repair, ...(projectName !== undefined && projectName !== '' ? { projectName } : {}) }),
        })) as unknown as DoctorResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** GET /search：全项目搜索。 */
    async search(q: string, projectName?: string): Promise<SearchResultList> {
      const qs = `?q=${encodeURIComponent(q)}${projectName !== undefined && projectName !== '' ? `&projectName=${encodeURIComponent(projectName)}` : ''}`
      try {
        return await toJson(await fetch(`/api/planweave/search${qs}`, { cache: 'no-store' })) as unknown as SearchResultList
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    async statistics(projectName?: string): Promise<StatisticsResult> {
      const qs = projectName !== undefined && projectName !== '' ? `?projectName=${encodeURIComponent(projectName)}` : ''
      try {
        return await toJson(await fetch(`/api/planweave/statistics${qs}`, { cache: 'no-store' })) as unknown as StatisticsResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    async todos(projectName?: string): Promise<TodosResult> {
      const qs = projectName !== undefined && projectName !== '' ? `?projectName=${encodeURIComponent(projectName)}` : ''
      try {
        return await toJson(await fetch(`/api/planweave/todos${qs}`, { cache: 'no-store' })) as unknown as TodosResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    async quality(projectName?: string): Promise<QualityResult> {
      const qs = projectName !== undefined && projectName !== '' ? `?projectName=${encodeURIComponent(projectName)}` : ''
      try {
        return await toJson(await fetch(`/api/planweave/quality${qs}`, { cache: 'no-store' })) as unknown as QualityResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** POST /graph-history：undo / redo。 */
    async graphHistory(action: 'undo' | 'redo', projectName?: string): Promise<{ ok: boolean; error?: string }> {
      try {
        return await toJson(await fetch('/api/planweave/graph-history', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, ...(projectName !== undefined && projectName !== '' ? { projectName } : {}) }),
        })) as unknown as { ok: boolean; error?: string }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    async run(steps: number, projectName?: string): Promise<RunResult> {
      try {
        return await toJson(await fetch('/api/planweave/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ steps, ...(projectName !== undefined && projectName !== '' ? { projectName } : {}) }),
        })) as unknown as RunResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    /** 播种内置示例计划（force 覆盖已有非空计划）。 */
    async seed(projectName?: string, force = false): Promise<SeedResult> {
      try {
        return await toJson(await fetch('/api/planweave/seed', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ force, ...(projectName !== undefined && projectName !== '' ? { projectName } : {}) }),
        })) as unknown as SeedResult
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

export type PlanweaveApi = ReturnType<typeof createPlanweaveApi>
