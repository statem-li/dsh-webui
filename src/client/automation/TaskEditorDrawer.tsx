/**
 * automation — 二级抽屉：新建/编辑任务表单（从屏幕右侧滑出）。
 *
 * 字段：任务名称 / 所属分类（现有分类下拉）/ 模型（provider 分组下拉，
 * 数据来自 DSH 模型目录）/ 推理强度（跟随所选模型的 efforts，未选模型
 * 或模型无 efforts 时锁定「模型默认」）。
 *
 * 动画：滑入 auto-drawer-in / 滑出 auto-drawer-out（240ms，互为反向）；
 * 遮罩独立淡入淡出，点击先关本层。
 */

import { useEffect, useRef, useState } from 'react'
import { CloseIcon } from './icons.tsx'
import type { T } from './locales.ts'
import { ensureStyles } from './styles.ts'
import { newId } from './storage.ts'
import type {
  AutomationCatalog,
  AutomationTask,
  ModelOption,
} from './types.ts'

const cls = {
  mask: 'auto-drawer-mask',
  drawer: 'auto-drawer',
  inner: 'auto-drawer-inner',
  head: 'auto-drawer-head',
  title: 'auto-drawer-title',
  close: 'auto-close',
  body: 'auto-drawer-body',
  field: 'auto-field',
  label: 'auto-field-label',
  input: 'auto-input',
  select: 'auto-select',
  foot: 'auto-drawer-foot',
  btn: 'auto-btn',
  primary: 'auto-btn-primary',
} as const

export interface TaskEditorDrawerProps {
  /** 抽屉是否挂载。 */
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

/** 渲染新建/编辑任务抽屉（含独立遮罩）。 */
export function TaskEditorDrawer({
  open, closing, onClose, t, catalog, onCatalogChange, models, modelsLoading,
  presetCategory, editing,
}: TaskEditorDrawerProps): JSX.Element | null {
  // Hooks 全部位于条件 return 之前（数量跨渲染一致）。
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [modelKey, setModelKey] = useState('')   // `${provider}::${modelId}`，'' = 未选
  const [effort, setEffort] = useState('')       // '' = 模型默认
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
    } else {
      setName('')
      setCategoryId(presetCategory ?? catalog.categories[0]?.id ?? '')
      setModelKey('')
      setEffort('')
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

  /** 提交：新建落入选中分类；编辑更新原任务。空名忽略。 */
  const submit = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    const targetCategory = categoryId !== '' ? categoryId : catalog.categories[0]?.id
    if (targetCategory === undefined) return
    const [provider, modelId] = modelKey === '' ? [undefined, undefined] : modelKey.split('::')
    if (editing != null) {
      onCatalogChange({
        ...catalog,
        tasks: catalog.tasks.map(task => task.id === editing.id
          ? {
            ...task,
            name: trimmed,
            categoryId: targetCategory,
            model: modelId,
            provider,
            effort: effort !== '' ? effort : undefined,
          }
          : task),
      })
    } else {
      const task: AutomationTask = {
        id: newId('task'),
        name: trimmed,
        categoryId: targetCategory,
        model: modelId,
        provider,
        effort: effort !== '' ? effort : undefined,
      }
      onCatalogChange({ ...catalog, tasks: [...catalog.tasks, task] })
    }
    onClose()
  }

  return (
    <>
      <div className={cls.mask} data-anim={anim} aria-hidden="true" onClick={onClose} />
      <div className={cls.drawer} data-anim={anim} role="dialog" aria-label={t('newTask')}>
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
                {/* 按 provider 分组的 optgroup */}
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
