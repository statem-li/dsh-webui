/**
 * team — 链条编辑（步骤增删排序 + 每步任务说明 + 并行分组 + 尾部整合开关）。
 *
 * 并行语义：步骤上的 `parallel: true` 表示「与上一步同波次并发执行」。
 * 编辑器把连续的并行步渲染成一个并行组（左侧光带 + 「同时执行」徽标），
 * 首步不可并行（自成一波），整合步永远独占最后一波。
 */

import { useEffect, useMemo, useState } from 'react'
import type { Chain, ChainStep, Role } from './types.ts'

export interface ChainEditorProps {
  chain: Chain
  roles: readonly Role[]
  open: boolean
  onToggleOpen: () => void
  onSave: (next: Chain) => Promise<void> | void
  onRemove: () => void
  onRun: (chainId: string) => void
}

/** 步骤展示名。 */
function stepName(step: ChainStep, roles: readonly Role[]): string {
  if (step.kind === 'synthesize') return '主脑整合'
  return roles.find(role => role.id === step.roleId)?.name ?? step.roleId
}

/** 本步是否与上一步同波次（首步永远自成一波；整合步不参与并行）。 */
function isParallel(steps: readonly ChainStep[], index: number): boolean {
  if (index <= 0) return false
  const step = steps[index]
  return step !== undefined && step.kind === 'role' && step.parallel === true
}

/** 链路径文案：并行组合并成 `A‖B`。 */
export function chainPathText(chain: Chain, roles: readonly Role[]): string {
  const parts: string[] = []
  chain.steps.forEach((step, index) => {
    const label = stepName(step, roles)
    if (isParallel(chain.steps, index) && parts.length > 0) {
      parts[parts.length - 1] = `${parts[parts.length - 1]}‖${label}`
      return
    }
    parts.push(label)
  })
  const tail = chain.finalSynthesize && !chain.steps.some(s => s.kind === 'synthesize') ? ' → 主脑整合' : ''
  return parts.join(' → ') + tail
}

/** 首步不该带 parallel 标记（没有可并的上一步）——移动/删除后就地清理。 */
function normalizeHead(steps: ChainStep[]): ChainStep[] {
  const head = steps[0]
  if (head === undefined || head.kind !== 'role' || head.parallel !== true) return steps
  const cleaned = { ...head }
  delete cleaned.parallel
  const next = [...steps]
  next[0] = cleaned
  return next
}

/** 链条行卡片 + 行内编辑。 */
export function ChainEditor({ chain, roles, open, onToggleOpen, onSave, onRemove, onRun }: ChainEditorProps): JSX.Element {
  const [draft, setDraft] = useState<Chain>(chain)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) setDraft(chain)
  }, [chain, open])

  const patchStep = (index: number, fields: Partial<Extract<ChainStep, { kind: 'role' }>>): void => {
    setDraft(previous => ({
      ...previous,
      steps: previous.steps.map((step, i) => (i === index && step.kind === 'role' ? { ...step, ...fields } : step)),
    }))
  }

  /** 切换本步是否与上一步并行。 */
  const toggleParallel = (index: number): void => {
    setDraft((previous) => {
      const step = previous.steps[index]
      if (index <= 0 || step === undefined || step.kind !== 'role') return previous
      return {
        ...previous,
        steps: previous.steps.map((item, i) => {
          if (i !== index || item.kind !== 'role') return item
          const next = { ...item }
          if (next.parallel === true) delete next.parallel
          else next.parallel = true
          return next
        }),
      }
    })
  }

  const move = (index: number, delta: number): void => {
    setDraft((previous) => {
      const next = [...previous.steps]
      const target = index + delta
      if (target < 0 || target >= next.length) return previous
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return { ...previous, steps: normalizeHead(next) }
    })
  }

  const removeStep = (index: number): void => {
    setDraft(previous => ({
      ...previous,
      steps: normalizeHead(previous.steps.filter((_, i) => i !== index)),
    }))
  }

  const addStep = (roleId: string): void => {
    if (roleId === '') return
    setDraft(previous => ({
      ...previous,
      steps: [...previous.steps, roleId === '__synth__' ? { kind: 'synthesize' } : { kind: 'role', roleId }],
    }))
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSave(draft)
      onToggleOpen()
    } finally {
      setSaving(false)
    }
  }

  const pathText = chainPathText(chain, roles)

  /** 每步的波次号（1 起）：并行步沿用上一步的波次。 */
  const waves = useMemo(() => {
    const out: number[] = []
    let wave = 0
    draft.steps.forEach((step, index) => {
      if (!isParallel(draft.steps, index)) wave += 1
      out.push(wave)
    })
    return out
  }, [draft.steps])
  const waveTotal = waves.length > 0 ? waves[waves.length - 1] : 0
  const parallelCount = draft.steps.length - waveTotal

  return (
    <div className="team-role-card">
      <button type="button" className="team-role-row" onClick={onToggleOpen} aria-expanded={open}>
        <span className="team-role-main">
          <span className="team-role-name">{chain.name}</span>
          <span className="team-role-sub">
            <span className="team-tag">{chain.id}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pathText !== '' ? pathText : '（空链）'}
            </span>
          </span>
        </span>
        <span className="team-chevron" data-open={open}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="team-role-editor">
          <label className="team-field">
            <span>链条名称</span>
            <input className="team-input" value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} />
          </label>

          <div className="team-field">
            <span>
              步骤（{waveTotal} 个波次{parallelCount > 0 ? ` · ${parallelCount} 步并行` : ' · 全串行'}）
            </span>
            <div className="team-step-list">
              {draft.steps.length === 0 ? (
                <div className="team-pop-hint">还没有步骤，用下面的下拉添加。</div>
              ) : draft.steps.map((step, index) => {
                const parallel = isParallel(draft.steps, index)
                const groupHead = !parallel && isParallel(draft.steps, index + 1)
                const canParallel = step.kind === 'role' && index > 0
                return (
                  <div
                    className="team-step"
                    key={`${step.kind}-${index}`}
                    data-parallel={parallel ? 'true' : 'false'}
                    data-group-head={groupHead ? 'true' : 'false'}
                  >
                    <span className="team-card-idx" style={{ marginTop: 5 }} title={`第 ${waves[index]} 波`}>
                      {waves[index]}
                    </span>
                    <div className="team-step-body">
                      <div className="team-step-head">
                        <span>{stepName(step, roles)}</span>
                        {parallel ? <span className="team-par-badge">‖ 与上一步同时执行</span> : null}
                      </div>
                      {step.kind === 'role' ? (
                        <input
                          className="team-input"
                          style={{ height: 28, fontSize: 12 }}
                          value={step.taskNote ?? ''}
                          placeholder="本步任务说明（可留空＝沿用总任务）"
                          onChange={e => patchStep(index, { taskNote: e.target.value })}
                        />
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {canParallel ? (
                        <button
                          type="button"
                          className="team-icon-btn team-par-btn"
                          style={{ width: 24, height: 22 }}
                          aria-label={parallel ? '改为等上一步完成后执行' : '改为与上一步并行执行'}
                          aria-pressed={parallel}
                          data-on={parallel ? 'true' : 'false'}
                          title={parallel ? '当前：与上一步并行（点击改回串行）' : '当前：等上一步完成（点击改为并行）'}
                          onClick={() => toggleParallel(index)}
                        >‖</button>
                      ) : null}
                      <button type="button" className="team-icon-btn" style={{ width: 24, height: 22 }} aria-label="上移" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                      <button type="button" className="team-icon-btn" style={{ width: 24, height: 22 }} aria-label="下移" disabled={index === draft.steps.length - 1} onClick={() => move(index, 1)}>↓</button>
                      <button type="button" className="team-icon-btn" style={{ width: 24, height: 22 }} aria-label="删除" onClick={() => removeStep(index)}>×</button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="team-pop-hint">
              点步骤右侧的「‖」把该步与上一步编进同一波次：同波次的角色<b>同时开跑</b>（彼此看不到对方产出），
              适合互不依赖的工作；有依赖关系的（先取证再成稿、先实现再评审）要留在后续波次。
            </div>
          </div>

          <label className="team-field">
            <span>添加步骤</span>
            <select
              className="team-select team-select-grow"
              value=""
              onChange={(e) => { addStep(e.target.value); e.currentTarget.value = '' }}
            >
              <option value="">选择角色…</option>
              {roles.map(role => (
                <option key={role.id} value={role.id}>{role.name} · {role.tagline}</option>
              ))}
              <option value="__synth__">＋ 显式主脑整合步</option>
            </select>
          </label>

          <label className="team-check">
            <input
              type="checkbox"
              checked={draft.finalSynthesize}
              onChange={e => setDraft(p => ({ ...p, finalSynthesize: e.target.checked }))}
            />
            尾部自动追加主脑整合（已有显式整合步时不重复追加）
          </label>

          <div className="team-actions">
            <button type="button" className="team-btn team-btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" className="team-btn" disabled={saving} onClick={() => { setDraft(chain); onToggleOpen() }}>取消</button>
            <button type="button" className="team-btn" onClick={() => onRun(chain.id)}>去运行</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="team-btn team-btn-danger" disabled={saving} onClick={onRemove}>删除链条</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
