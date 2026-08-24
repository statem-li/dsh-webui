/**
 * team — 链条编辑（步骤增删排序 + 每步任务说明 + 尾部整合开关）。
 */

import { useEffect, useState } from 'react'
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

  const move = (index: number, delta: number): void => {
    setDraft((previous) => {
      const next = [...previous.steps]
      const target = index + delta
      if (target < 0 || target >= next.length) return previous
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return { ...previous, steps: next }
    })
  }

  const removeStep = (index: number): void => {
    setDraft(previous => ({ ...previous, steps: previous.steps.filter((_, i) => i !== index) }))
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

  const pathText = chain.steps.map(step => stepName(step, roles)).join(' → ')
    + (chain.finalSynthesize && !chain.steps.some(s => s.kind === 'synthesize') ? ' → 主脑整合' : '')

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
            <span>步骤（按顺序串行执行）</span>
            <div className="team-step-list">
              {draft.steps.length === 0 ? (
                <div className="team-pop-hint">还没有步骤，用下面的下拉添加。</div>
              ) : draft.steps.map((step, index) => (
                <div className="team-step" key={`${step.kind}-${index}`}>
                  <span className="team-card-idx" style={{ marginTop: 5 }}>{index + 1}</span>
                  <div className="team-step-body">
                    <div className="team-step-head">{stepName(step, roles)}</div>
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
                    <button type="button" className="team-icon-btn" style={{ width: 24, height: 22 }} aria-label="上移" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                    <button type="button" className="team-icon-btn" style={{ width: 24, height: 22 }} aria-label="下移" disabled={index === draft.steps.length - 1} onClick={() => move(index, 1)}>↓</button>
                    <button type="button" className="team-icon-btn" style={{ width: 24, height: 22 }} aria-label="删除" onClick={() => removeStep(index)}>×</button>
                  </div>
                </div>
              ))}
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
