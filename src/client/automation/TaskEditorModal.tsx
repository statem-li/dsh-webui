/**
 * automation — 二级弹窗：新建/编辑任务表单（居中模态框）。
 *
 * 字段：任务名称 / 所属分类 / 模型（provider 分组下拉）/ 推理强度 /
 * 失败重试次数 / 执行步骤（有序动作序列，每步带失败分支 + 可选文件输出）/
 * 执行计划（ScheduleEditor）。
 *
 * 动画：淡入 + 轻微上浮缩放进入（auto-modal-in）/ 反向退出（auto-modal-out），
 * 240ms；遮罩独立淡入淡出，点击先关本层。Esc 关闭。挂载即聚焦首个输入框。
 */

import { useEffect, useRef, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, PlusIcon, TrashIcon } from './icons.tsx'
import type { T } from './locales.ts'
import { ensureStyles } from './styles.ts'
import { defaultSteps, newId } from './storage.ts'
import { defaultScheduleDraft, draftFromStored, storedFromDraft, type ScheduleDraft } from './schedule.ts'
import { ScheduleEditor } from './ScheduleEditor.tsx'
import type {
  AutomationCatalog,
  AutomationStep,
  AutomationTask,
  ModelOption,
  StepOnError,
} from './types.ts'

const cls = {
  mask: 'auto-modal-mask',
  modal: 'auto-modal',
  inner: 'auto-modal-inner',
  head: 'auto-modal-head',
  title: 'auto-modal-title',
  close: 'auto-close',
  body: 'auto-modal-body',
  field: 'auto-field',
  label: 'auto-field-label',
  input: 'auto-input',
  select: 'auto-select',
  textarea: 'auto-textarea',
  foot: 'auto-modal-foot',
  btn: 'auto-btn',
  primary: 'auto-btn-primary',
} as const

export interface TaskEditorModalProps {
  /** 弹窗是否挂载。 */
  open: boolean
  /** 正在播放关闭动画。 */
  closing: boolean
  /** 请求关闭。 */
  onClose: () => void
  t: T
  /** 任务目录（分类列表 + 提交写入）。 */
  catalog: AutomationCatalog
  /** 目录变更（提交后由容器持久化）。 */
  onCatalogChange: (catalog: AutomationCatalog) => void
  /** 可选模型列表。 */
  models: ModelOption[]
  /** 模型目录是否仍在加载。 */
  modelsLoading: boolean
  /** 新建时预选的分类 id；editing 存在时忽略。 */
  presetCategory?: string
  /** 待编辑的任务；存在 = 编辑模式（回填表单）。 */
  editing?: AutomationTask | null
}

/** 新建一个空白步骤。 */
function blankStep(): AutomationStep {
  return { id: newId('step'), name: '', prompt: '', onError: 'stop', saveToFile: false, fileName: 'output-{date}.md' }
}

/** 渲染新建/编辑任务居中模态框（含独立遮罩）。 */
export function TaskEditorModal({
  open, closing, onClose, t, catalog, onCatalogChange, models, modelsLoading,
  presetCategory, editing,
}: TaskEditorModalProps): JSX.Element | null {
  // Hooks 全部位于条件 return 之前（数量跨渲染一致）。
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [modelKey, setModelKey] = useState('')   // `${provider}::${modelId}`，'' = 未选
  const [effort, setEffort] = useState('')       // '' = 模型默认
  const [retry, setRetry] = useState(0)
  const [steps, setSteps] = useState<AutomationStep[]>([])
  const [draft, setDraft] = useState<ScheduleDraft>(defaultScheduleDraft())
  const nameRef = useRef<HTMLInputElement | null>(null)

  // 打开瞬间按模式初始化表单（编辑回填 / 新建预置分类）。
  useEffect(() => {
    if (!open) return
    if (editing != null) {
      setName(editing.name)
      setCategoryId(editing.categoryId)
      setModelKey(editing.provider !== undefined && editing.model !== undefined
        ? `${editing.provider}::${editing.model}`
        : '')
      setEffort(editing.effort ?? '')
      setRetry(editing.retry ?? 0)
      setSteps(editing.steps !== undefined && editing.steps.length > 0 ? editing.steps : defaultSteps())
      setDraft(draftFromStored(editing.schedule))
    } else {
      setName('')
      setCategoryId(presetCategory ?? catalog.categories[0]?.id ?? '')
      setModelKey('')
      setEffort('')
      setRetry(0)
      setSteps(defaultSteps())
      setDraft(defaultScheduleDraft())
    }
    const timer = window.setTimeout(() => { nameRef.current?.focus() }, 50)
    return () => { window.clearTimeout(timer) }
    // 仅在 open/editing/presetCategory 变化时初始化一次。
  }, [open, editing, presetCategory])

  if (!open) return null
  ensureStyles()
  const anim = closing ? 'out' : 'in'

  const selectedModel = models.find(model =>
    modelKey !== '' && `${model.provider}::${model.id}` === modelKey)
  const effortOptions = selectedModel?.efforts ?? []

  // ---- 步骤操作 ----
  const updateStep = (id: string, patch: Partial<AutomationStep>): void => {
    setSteps(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)))
  }
  const addStep = (): void => { setSteps(prev => [...prev, blankStep()]) }
  const removeStep = (id: string): void => {
    setSteps(prev => (prev.length <= 1 ? prev : prev.filter(s => s.id !== id)))
  }
  const moveStep = (id: string, dir: -1 | 1): void => {
    setSteps(prev => {
      const index = prev.findIndex(s => s.id === id)
      const target = index + dir
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  /** 提交：新建落入选中分类；编辑更新原任务。空名忽略。 */
  const submit = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    const targetCategory = categoryId !== '' ? categoryId : catalog.categories[0]?.id
    if (targetCategory === undefined) return
    const [provider, modelId] = modelKey === '' ? [undefined, undefined] : modelKey.split('::')
    const schedule = storedFromDraft(draft)
    // 过滤掉指令为空的步骤；全空回退默认单步。
    const validSteps = steps
      .filter(s => s.prompt.trim() !== '')
      .map((s, index) => ({ ...s, name: s.name.trim() !== '' ? s.name.trim() : `步骤 ${index + 1}` }))
    const finalSteps = validSteps.length > 0 ? validSteps : defaultSteps()

    if (editing != null) {
      onCatalogChange({
        ...catalog,
        tasks: catalog.tasks.map(task => task.id === editing.id
          ? {
            ...task,
            name: trimmed,
            categoryId: targetCategory,
            schedule,
            model: modelId,
            provider,
            effort: effort !== '' ? effort : undefined,
            retry,
            steps: finalSteps,
          }
          : task),
      })
    } else {
      const task: AutomationTask = {
        id: newId('task'),
        name: trimmed,
        categoryId: targetCategory,
        schedule,
        model: modelId,
        provider,
        effort: effort !== '' ? effort : undefined,
        retry,
        steps: finalSteps,
      }
      onCatalogChange({ ...catalog, tasks: [...catalog.tasks, task] })
    }
    onClose()
  }

  return (
    <>
      <div className={cls.mask} data-anim={anim} aria-hidden="true" onClick={onClose} />
      <div
        className={cls.modal}
        data-anim={anim}
        role="dialog"
        aria-modal="true"
        aria-label={t('newTask')}
        onKeyDown={event => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className={cls.inner}>
          <div className={cls.head}>
            <span className={cls.title}>{editing != null ? t('editTask') : t('newTask')}</span>
            <button type="button" className={cls.close} aria-label={t('close')} onClick={onClose}>
              <CloseIcon size={15} />
            </button>
          </div>

          <div className={cls.body}>
            <div className={cls.field}>
              <label className={cls.label} htmlFor="auto-task-name">{t('newTask')}</label>
              <input
                ref={nameRef}
                id="auto-task-name"
                className={cls.input}
                value={name}
                placeholder={t('taskNamePlaceholder')}
                onChange={event => { setName(event.currentTarget.value) }}
                onKeyDown={event => {
                  if (event.key === 'Enter') submit()
                  if (event.key === 'Escape') onClose()
                }}
              />
            </div>

            <div className="auto-modal-row">
              <div className={cls.field}>
                <label className={cls.label} htmlFor="auto-task-category">{t('categoryLabel')}</label>
                <select
                  id="auto-task-category"
                  className={cls.select}
                  value={categoryId}
                  onChange={event => { setCategoryId(event.currentTarget.value) }}
                >
                  {catalog.categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>
              <div className={cls.field}>
                <label className={cls.label} htmlFor="auto-task-retry">{t('retryLabel')}</label>
                <select
                  id="auto-task-retry"
                  className={cls.select}
                  value={String(retry)}
                  onChange={event => { setRetry(Number(event.currentTarget.value) || 0) }}
                >
                  {[0, 1, 2, 3].map(n => (
                    <option key={n} value={String(n)}>{n}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={cls.field}>
              <label className={cls.label} htmlFor="auto-task-model">{t('modelLabel')}</label>
              <select
                id="auto-task-model"
                className={cls.select}
                value={modelKey}
                disabled={modelsLoading || models.length === 0}
                onChange={event => { setModelKey(event.currentTarget.value); setEffort('') }}
              >
                <option value="">
                  {modelsLoading ? t('modelsLoading')
                    : models.length === 0 ? t('modelsEmpty')
                      : t('modelPlaceholder')}
                </option>
                {[...new Map(models.map(model => [model.provider, model.providerName])).entries()]
                  .map(([provider, providerName]) => (
                    <optgroup key={provider} label={providerName}>
                      {models.filter(model => model.provider === provider).map(model => (
                        <option key={`${provider}::${model.id}`} value={`${provider}::${model.id}`}>
                          {model.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </select>
            </div>

            <div className={cls.field}>
              <label className={cls.label} htmlFor="auto-task-effort">{t('effortLabel')}</label>
              <select
                id="auto-task-effort"
                className={cls.select}
                value={effort}
                disabled={effortOptions.length === 0}
                onChange={event => { setEffort(event.currentTarget.value) }}
              >
                <option value="">{t('effortDefault')}</option>
                {effortOptions.map(option => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </div>

            {/* 执行步骤：有序动作序列 + 失败分支 + 文件输出 */}
            <div className="auto-steps">
              <div className="auto-steps-head">
                <span className={cls.label} style={{ marginBottom: 0 }}>{t('stepsLabel')}</span>
                <button type="button" className="auto-cat-add" onClick={addStep}>
                  <PlusIcon size={11} />
                  {t('addStep')}
                </button>
              </div>

              {steps.map((step, index) => (
                <div key={step.id} className="auto-step">
                  <div className="auto-step-head">
                    <span className="auto-step-index">{t('stepNo', { n: index + 1 })}</span>
                    <div className="auto-step-actions">
                      <button
                        type="button"
                        className="auto-step-btn"
                        aria-label="上移"
                        disabled={index === 0}
                        onClick={() => { moveStep(step.id, -1) }}
                      >
                        <ArrowUpIcon size={13} />
                      </button>
                      <button
                        type="button"
                        className="auto-step-btn"
                        aria-label="下移"
                        disabled={index === steps.length - 1}
                        onClick={() => { moveStep(step.id, 1) }}
                      >
                        <ArrowDownIcon size={13} />
                      </button>
                      <button
                        type="button"
                        className="auto-step-btn auto-step-del"
                        aria-label={t('deleteStep')}
                        onClick={() => { removeStep(step.id) }}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  </div>

                  <div className={cls.field}>
                    <label className={cls.label} htmlFor={`step-name-${step.id}`}>{t('stepName')}</label>
                    <input
                      id={`step-name-${step.id}`}
                      className={cls.input}
                      value={step.name}
                      placeholder={t('stepNamePlaceholder')}
                      onChange={event => { updateStep(step.id, { name: event.currentTarget.value }) }}
                    />
                  </div>

                  <div className={cls.field}>
                    <label className={cls.label} htmlFor={`step-prompt-${step.id}`}>{t('stepPrompt')}</label>
                    <textarea
                      id={`step-prompt-${step.id}`}
                      className={cls.textarea}
                      value={step.prompt}
                      placeholder={t('stepPromptPlaceholder')}
                      rows={3}
                      onChange={event => { updateStep(step.id, { prompt: event.currentTarget.value }) }}
                    />
                  </div>

                  <div className="auto-step-row">
                    <div className={cls.field} style={{ flex: 1 }}>
                      <label className={cls.label} htmlFor={`step-onerror-${step.id}`}>{t('stepOnError')}</label>
                      <select
                        id={`step-onerror-${step.id}`}
                        className={cls.select}
                        value={step.onError}
                        onChange={event => { updateStep(step.id, { onError: event.currentTarget.value as StepOnError }) }}
                      >
                        <option value="stop">{t('onErrorStop')}</option>
                        <option value="skip">{t('onErrorSkip')}</option>
                      </select>
                    </div>
                    <div className={cls.field} style={{ flex: 1.4 }}>
                      <label className={cls.label} htmlFor={`step-file-${step.id}`}>{t('stepFileName')}</label>
                      <input
                        id={`step-file-${step.id}`}
                        className={cls.input}
                        value={step.fileName}
                        disabled={!step.saveToFile}
                        placeholder="output-{date}.md"
                        onChange={event => { updateStep(step.id, { fileName: event.currentTarget.value }) }}
                      />
                    </div>
                  </div>

                  <label className="auto-check-line">
                    <input
                      type="checkbox"
                      className="auto-check"
                      checked={step.saveToFile}
                      onChange={event => { updateStep(step.id, { saveToFile: event.currentTarget.checked }) }}
                    />
                    <span>{t('stepSaveFile')}</span>
                    <span className="auto-check-hint">{t('stepFileNameHint')}</span>
                  </label>
                </div>
              ))}
            </div>

            {/* 执行计划：模式 + 动态字段 + 预览 */}
            <ScheduleEditor draft={draft} onChange={setDraft} t={t} />
          </div>

          <div className={cls.foot}>
            <button type="button" className={cls.btn} onClick={onClose}>{t('cancel')}</button>
            <button type="button" className={`${cls.btn} ${cls.primary}`} onClick={submit}>
              {editing != null ? t('save') : t('confirmAdd')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
