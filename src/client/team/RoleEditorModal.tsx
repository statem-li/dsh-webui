/**
 * team — 角色编辑弹窗（居中模态卡片）。
 *
 * 原先角色编辑是「卡片内联展开」：卡片在画布上会被撑高、盖住邻居节点，
 * 输入框常常点不到。改成独立模态弹窗后，编辑区有稳定的宽度与滚动，
 * 卡片本身只负责展示。
 *
 * 保存语义：草稿态改动只在弹窗内，点「保存」才提交（一次 POST /teams/<id>）。
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ModelSelect } from './ModelSelect.tsx'
import { CapabilityEditor } from './CapabilityEditor.tsx'
import {
  GROUP_META,
  type CapabilityCatalog, type ExecutorPref, type ModelBinding, type ProviderView,
  type Role, type RoleCapabilities, type RoleGroup,
} from './types.ts'

const GROUPS: RoleGroup[] = ['core', 'judge', 'act', 'guard']

const EXECUTORS: Array<{ value: ExecutorPref, label: string, hint: string }> = [
  { value: 'auto', label: '自动', hint: '对话内触发用 subagent（有工具），面板触发用 llm 直跑' },
  { value: 'llm', label: 'llm 直跑', hint: '精确使用设定的模型，但无工具能力' },
  { value: 'subagent', label: 'subagent', hint: '完整 agent（可读写文件、跑命令），模型继承会话' },
]

export interface RoleEditorModalProps {
  role: Role
  teamModel: ModelBinding
  providers: readonly ProviderView[]
  catalog: CapabilityCatalog | null
  /** 已建立的关联（对方名 + directLinks 索引）。 */
  links: Array<{ index: number, peerName: string, kind: 'bidirectional' | 'directed' }>
  onClose: () => void
  onSave: (next: Role) => Promise<void> | void
  onRemove: () => void
  onRemoveLink: (index: number) => void
}

/** 角色编辑弹窗。 */
export function RoleEditorModal({
  role, teamModel, providers, catalog, links, onClose, onSave, onRemove, onRemoveLink,
}: RoleEditorModalProps): JSX.Element {
  const [draft, setDraft] = useState<Role>(role)
  const [saving, setSaving] = useState(false)
  const [capsOpen, setCapsOpen] = useState(role.capabilities !== undefined)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement | null>(null)

  // 切换到另一个角色时重置草稿。
  useEffect(() => { setDraft(role); setError(null) }, [role.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setTimeout(() => firstRef.current?.focus(), 60)
    return () => { window.clearTimeout(timer) }
  }, [])

  // Esc 关闭（捕获阶段拦住抽屉的 Esc）；上层的输入/确认弹窗优先消费。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.team-ask') !== null) return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  const patch = (fields: Partial<Role>): void => { setDraft(previous => ({ ...previous, ...fields })) }

  const applyCaps = (next: RoleCapabilities): void => {
    const isDefault = next.toolMode === 'inherit' && next.skillMode === 'inherit'
      && next.tools.length === 0 && next.skills.length === 0 && next.skillBundles.length === 0
    if (isDefault) {
      setDraft((previous) => {
        const copy = { ...previous }
        delete copy.capabilities
        return copy
      })
      return
    }
    patch({ capabilities: next })
  }

  const inheritLabel = teamModel.provider !== '' && teamModel.model !== ''
    ? `继承团队默认（${teamModel.model}）`
    : '继承团队默认（团队未设置 → 用全局默认）'

  const save = async (): Promise<void> => {
    if (draft.name.trim() === '') { setError('角色名称不能为空'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({ ...draft, name: draft.name.trim(), en: draft.en.trim(), tagline: draft.tagline.trim() })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const avatar = draft.avatar !== undefined && draft.avatar !== '' ? draft.avatar : draft.name.slice(0, 1)

  return createPortal(
    <>
      {/* ⚠ 两条硬约束：
          1. 遮罩用自己的类（z-index 1205 < 卡片 1210）——早期复用输入弹窗的
             遮罩（1300）会盖在卡片上面，弹窗可见但点不动；
          2. 类名不含 modal/panel/drawer 子串——glass.ts 按子串匹配给浮层叠
             backdrop-filter blur(18px)，连 -head/-body/-foot 都会各自命中，
             叠出多层模糊把弹窗整张糊掉。 */}
      <div className="team-editor-mask" aria-hidden="true" onClick={() => { if (!saving) onClose() }} />
      <div className="team-editor-card" role="dialog" aria-modal="true" aria-label={`编辑角色 ${role.name}`}>
        <div className="team-editor-head">
          <span className="team-avatar" style={{ background: GROUP_META[draft.group].color }} aria-hidden="true">
            {avatar}
          </span>
          <span className="team-editor-title">
            <span className="team-editor-name">{draft.name !== '' ? draft.name : '（未命名角色）'}</span>
            <span className="team-editor-sub">
              <span className="team-tag">{GROUP_META[draft.group].label}</span>
              <span style={{ opacity: 0.65, fontFamily: 'ui-monospace, monospace' }}>{role.id}</span>
            </span>
          </span>
          <button type="button" className="psh-close" aria-label="关闭" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="team-editor-body">
          <div className="team-inline">
            <label className="team-field" style={{ flex: '0 0 92px' }}>
              <span>头像</span>
              <input
                className="team-input"
                value={draft.avatar ?? ''}
                placeholder={draft.name.slice(0, 1)}
                maxLength={4}
                onChange={event => patch({ avatar: event.target.value })}
              />
            </label>
            <label className="team-field">
              <span>名称</span>
              <input
                ref={firstRef}
                className="team-input"
                value={draft.name}
                onChange={event => patch({ name: event.target.value })}
              />
            </label>
            <label className="team-field">
              <span>英文名</span>
              <input className="team-input" value={draft.en} onChange={event => patch({ en: event.target.value })} />
            </label>
          </div>

          <label className="team-field">
            <span>定位语</span>
            <input
              className="team-input"
              value={draft.tagline}
              placeholder="如：深度调研·多源取证"
              onChange={event => patch({ tagline: event.target.value })}
            />
          </label>

          <div className="team-inline">
            <label className="team-field">
              <span>分组</span>
              <select
                className="team-select team-select-grow"
                value={draft.group}
                onChange={event => patch({ group: event.target.value as RoleGroup })}
              >
                {GROUPS.map(group => (
                  <option key={group} value={group}>{GROUP_META[group].label}</option>
                ))}
              </select>
            </label>
            <label className="team-field">
              <span>执行通道</span>
              <select
                className="team-select team-select-grow"
                value={draft.executor}
                onChange={event => patch({ executor: event.target.value as ExecutorPref })}
              >
                {EXECUTORS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="team-pop-hint">{EXECUTORS.find(option => option.value === draft.executor)?.hint}</div>

          <label className="team-field">
            <span>模型</span>
            <ModelSelect
              value={draft.model}
              providers={providers}
              inheritLabel={inheritLabel}
              grow
              ariaLabel={`${draft.name} 的模型`}
              onChange={next => patch({ model: next })}
            />
          </label>

          {links.length > 0 ? (
            <div className="team-field">
              <span>关联（{links.length}）</span>
              <div className="team-grid-links" style={{ padding: 0, border: 'none' }}>
                {links.map(link => (
                  <span className="team-chip team-chip-link" key={link.index}>
                    {link.kind === 'directed' ? '→' : '↔'} {link.peerName}
                    <button
                      type="button"
                      aria-label={`删除与 ${link.peerName} 的关联`}
                      onClick={() => onRemoveLink(link.index)}
                    >×</button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="team-caps-toggle">
            <button type="button" className="team-btn" aria-expanded={capsOpen} onClick={() => setCapsOpen(value => !value)}>
              {capsOpen ? '收起能力装配' : '能力装配（插件工具 + 技能）'}
            </button>
          </div>
          {capsOpen ? (
            <CapabilityEditor
              value={draft.capabilities}
              catalog={catalog}
              executor={draft.executor}
              onChange={applyCaps}
            />
          ) : null}

          <label className="team-field">
            <span>角色提示词</span>
            <textarea
              className="team-textarea"
              style={{ minHeight: 180 }}
              value={draft.prompt}
              placeholder="定义这个角色的身份、职责与输出要求"
              onChange={event => patch({ prompt: event.target.value })}
            />
          </label>

          {error !== null ? <div className="team-error" role="alert">{error}</div> : null}
        </div>

        <div className="team-editor-foot">
          <button type="button" className="team-btn team-btn-lg team-btn-danger" disabled={saving} onClick={onRemove}>
            删除角色
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="team-btn team-btn-lg" disabled={saving} onClick={onClose}>取消</button>
          <button type="button" className="team-btn team-btn-primary team-btn-lg" disabled={saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
