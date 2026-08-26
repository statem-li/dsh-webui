/**
 * automation — ModelPicker：模型选择器（左右分栏弹层）。
 *
 * 替换原生 <select> 的两级模型选择：左列 provider 列表（选中项高亮），
 * 右列该 provider 下的模型列表（选中项带对勾），对齐 DSH 模型目录的
 * 左右分栏交互。弹层 createPortal 到 body + fixed 定位（避免被
 * popover 卡片的 backdrop-filter / transform / overflow 祖先裁剪钉住），
 * 随滚动/缩放重定位。
 *
 * 交互要点：
 *  - 触发按钮展示当前模型名（无选择时显示「默认模型」）；
 *  - 弹层打开/关闭带 scale+fade 动画；
 *  - 左列 provider 切换右列，右列用 key 重建触发入场动画；
 *  - 点击外部 / Escape 关闭，关闭后焦点回到触发按钮。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModelOption } from './types.ts'
import { t } from './locales.ts'
import { ChevronIcon } from './icons.tsx'

interface ProviderGroup {
  provider: string
  providerName: string
  models: ModelOption[]
}

/** 弹层固定尺寸（与截图一致：固定高两列各自滚动）。 */
const POP_W = 344
const POP_H = 300
/** 关闭动画时长（ms）。 */
const CLOSE_MS = 160

function groupModels(models: readonly ModelOption[]): ProviderGroup[] {
  const map = new Map<string, ProviderGroup>()
  for (const option of models) {
    let group = map.get(option.provider)
    if (group === undefined) {
      group = { provider: option.provider, providerName: option.providerName, models: [] }
      map.set(option.provider, group)
    }
    group.models.push(option)
  }
  return [...map.values()]
}

export function ModelPicker({ models, loading, value, onChange }: {
  models: readonly ModelOption[]
  loading: boolean
  value: string
  onChange: (value: string) => void
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [hoverProvider, setHoverProvider] = useState<string | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const openRef = useRef(false)
  const closingRef = useRef(false)
  const closeTimer = useRef(0)

  const groups = useMemo(() => groupModels(models), [models])

  const slash = value.indexOf('/')
  const currentProvider = slash > 0 ? value.slice(0, slash) : ''
  const currentId = slash > 0 ? value.slice(slash + 1) : ''

  const label = useMemo(() => {
    if (value === '') {
      return loading && models.length === 0 ? t('modelsLoading') : t('defaultModel')
    }
    // 目录里已不存在的旧绑定也要能显示
    const found = models.find(option => `${option.provider}/${option.id}` === value)
    return found !== undefined ? `${found.providerName} / ${found.name}` : value
  }, [value, models, loading])

  const activeProvider = useMemo(() => {
    if (hoverProvider !== null) return hoverProvider
    if (value === '') return ''
    if (currentProvider !== '' && groups.some(group => group.provider === currentProvider)) return currentProvider
    return groups.length > 0 ? groups[0].provider : ''
  }, [groups, hoverProvider, currentProvider, value])
  const activeGroup = groups.find(group => group.provider === activeProvider) ?? null

  const measure = useCallback((): void => {
    const el = triggerRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = Math.round(rect.left)
    if (left + POP_W > vw - 8) left = Math.max(8, vw - POP_W - 8)
    const below = rect.bottom + 4 + POP_H <= vh - 8
    const top = below ? Math.round(rect.bottom) + 4 : Math.max(8, Math.round(rect.top) - POP_H - 4)
    setPos({ top, left })
  }, [])

  const requestClose = useCallback((): void => {
    if (closingRef.current || !openRef.current) return
    closingRef.current = true
    setClosing(true)
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      openRef.current = false
      closingRef.current = false
      setOpen(false)
      setClosing(false)
      setPos(null)
      triggerRef.current?.focus()
    }, CLOSE_MS)
  }, [])

  const show = useCallback((): void => {
    if (closingRef.current) return
    openRef.current = true
    setHoverProvider(null)
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    measure()
    const onScroll = (): void => measure()
    const onResize = (): void => measure()
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      // 弹层 portal 到 body，不在 wrapRef 内：必须把弹层自身也算「内部」，
      // 否则点击弹层里的模型会先被 mousedown 误判为外部点击而关闭。
      if (wrapRef.current?.contains(target) === true) return
      if (popRef.current?.contains(target) === true) return
      requestClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') requestClose()
    }
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, measure, requestClose])

  // 打开/切换 provider 后滚动到当前选中项。
  useEffect(() => {
    if (!open) return
    const raf = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame
      : (callback: FrameRequestCallback) => window.setTimeout(callback, 0)
    raf(() => {
      if (popRef.current === null) return
      const selected = popRef.current.querySelector<HTMLElement>('[data-selected="true"]')
      if (selected !== null && typeof selected.scrollIntoView === 'function') {
        selected.scrollIntoView({ block: 'center' })
      }
      const active = popRef.current.querySelector<HTMLElement>('[data-active="true"]')
      if (active !== null && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest' })
      }
    })
  }, [open, activeProvider])

  useEffect(() => () => { window.clearTimeout(closeTimer.current) }, [])

  const choose = (next: string): void => {
    if (next !== value) onChange(next)
    requestClose()
  }

  return (
    <div className="auto-model" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="auto-model-btn"
        aria-haspopup="dialog"
        aria-expanded={open || closing}
        title={label}
        onClick={() => { if (open) requestClose(); else show() }}
      >
        <span className="auto-model-label">{label}</span>
        <span className="auto-model-chevron"><ChevronIcon size={13} /></span>
      </button>

      {(open || closing) && pos !== null && createPortal(
        <div
          ref={popRef}
          className="auto-model-pop"
          data-anim={closing ? 'out' : 'in'}
          style={{ top: pos.top, left: pos.left }}
          role="dialog"
          aria-label={t('modelLabel')}
        >
          <div className="auto-model-providers" role="tablist" aria-label="模型来源">
            <button
              type="button"
              role="tab"
              aria-selected={activeProvider === ''}
              className="auto-model-provider"
              data-active={activeProvider === '' || undefined}
              onClick={() => setHoverProvider('')}
            >
              <span className="auto-model-provider-name">{t('defaultModel')}</span>
            </button>
            {groups.map(group => (
              <button
                key={group.provider}
                type="button"
                role="tab"
                aria-selected={group.provider === activeProvider}
                className="auto-model-provider"
                data-active={group.provider === activeProvider || undefined}
                title={group.providerName}
                onClick={() => setHoverProvider(group.provider)}
              >
                <span className="auto-model-provider-name">{group.providerName}</span>
                <span className="auto-model-provider-count">{group.models.length}</span>
              </button>
            ))}
          </div>
          <div
            key={activeProvider === '' ? 'default' : (activeGroup?.provider ?? 'none')}
            className="auto-model-models"
            role="tabpanel"
          >
            {loading && models.length === 0 ? (
              <span className="auto-model-empty">{t('modelsLoading')}</span>
            ) : activeProvider === '' ? (
              <button
                type="button"
                role="option"
                aria-selected={value === ''}
                className="auto-model-model"
                data-selected={value === '' || undefined}
                onClick={() => choose('')}
              >
                <span className="auto-model-model-name">{t('defaultModel')}</span>
                <span className="auto-model-check">
                  {value === '' ? (
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>
              </button>
            ) : activeGroup === null ? (
              <span className="auto-model-empty">{t('defaultModel')}</span>
            ) : activeGroup.models.map(model => {
              const selected = activeGroup.provider === currentProvider && model.id === currentId
              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="auto-model-model"
                  data-selected={selected || undefined}
                  title={model.name}
                  onClick={() => choose(`${activeGroup.provider}/${model.id}`)}
                >
                  <span className="auto-model-model-name">{model.name}</span>
                  <span className="auto-model-check">
                    {selected ? (
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}