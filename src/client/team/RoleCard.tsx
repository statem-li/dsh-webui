/**
 * team — 角色卡片（网格卡片形态，占满编制面板）。
 *
 * 卡片自上而下：
 *  - 头部：圆形头像（emoji/首字，分组色底）+ 名称/en + 分组标签 + 操作（编辑/关联/删除）
 *  - 定位语
 *  - 供应商-模型行（实际生效模型 + 来源徽标：角色覆盖/继承团队）
 *  - 装配折叠：插件工具 + 技能/技能包（默认收起显示摘要，展开看清单）
 *  - 关联标签行：已有关联的角色（点 × 删除）
 *  - 编辑折叠：名称/头像/定位语/分组/通道/模型/能力装配/提示词
 *
 * 关联用**左键**完成：点「关联」进入连线模式（本卡高亮），再左键点目标卡片即建立关联。
 */

import { useEffect, useState } from 'react'
import { ModelSelect } from './ModelSelect.tsx'
import { CapabilityEditor, capabilitySummary } from './CapabilityEditor.tsx'
import {
  DEFAULT_CAPABILITIES, GROUP_META, SOURCE_LABEL,
  type CapabilityCatalog, type ExecutorPref, type ModelBinding, type ProviderView,
  type Role, type RoleCapabilities, type RoleGroup,
} from './types.ts'
import { bindingValue } from './util.ts'

const GROUPS: RoleGroup[] = ['core', 'judge', 'act', 'guard']
const EXECUTORS: Array<{ value: ExecutorPref, label: string, hint: string }> = [
  { value: 'auto', label: '自动', hint: '对话内触发用 subagent（有工具），面板触发用 llm 直跑' },
  { value: 'llm', label: 'llm 直跑', hint: '精确使用设定的模型，但无工具能力' },
  { value: 'subagent', label: 'subagent', hint: '完整 agent（可读写文件、跑命令），模型继承会话' },
]

/** 一条关联的视图（含对方角色名与来源索引）。 */
export interface RoleLinkRef {
  /** directLinks 里的原始索引（删除时回传）。 */
  index: number
  peerId: string
  peerName: string
  kind: 'bidirectional' | 'directed'
}

export interface RoleCardProps {
  role: Role
  teamModel: ModelBinding
  providers: readonly ProviderView[]
  /** 可装配的工具/技能/技能包目录（null = 尚未加载）。 */
  catalog: CapabilityCatalog | null
  open: boolean
  /** 图上被选中（描边高亮）。 */
  selected?: boolean
  /** 连线模式：本卡是起点。 */
  linking?: boolean
  /** 连线模式进行中（此时左键点卡片 = 完成关联）。 */
  linkMode?: boolean
  /** 选中链时本角色的步序号（1-based；不在链中为 null）。 */
  chainIndex?: number | null
  /** 本角色参与的所有关联。 */
  links: RoleLinkRef[]
  onToggleOpen: () => void
  onSave: (next: Role) => Promise<void> | void
  onRemove: () => void
  onStartLink: () => void
  onFinishLink: () => void
  onRemoveLink: (index: number) => void
  /** 头像区的拖拽手柄 pointerdown（关系图画板里拖动节点用；卡片视图可不传）。 */
  onDragPointerDown?: (event: React.PointerEvent) => void
}

/** 角色卡片。 */
export function RoleCard({
  role, teamModel, providers, catalog, open, selected, linking, linkMode, chainIndex, links,
  onToggleOpen, onSave, onRemove, onStartLink, onFinishLink, onRemoveLink, onDragPointerDown,
}: RoleCardProps): JSX.Element {
  const [draft, setDraft] = useState<Role>(role)
  const [saving, setSaving] = useState(false)
  /** 装配清单展示折叠态（只读）。 */
  const [capsListOpen, setCapsListOpen] = useState(false)
  /** 能力装配编辑折叠态。 */
  const [capsEditOpen, setCapsEditOpen] = useState(role.capabilities !== undefined)

  useEffect(() => {
    if (!open) setDraft(role)
  }, [role, open])

  const patch = (fields: Partial<Role>): void => { setDraft(previous => ({ ...previous, ...fields })) }

  const inheritLabel = teamModel.provider !== '' && teamModel.model !== ''
    ? `继承团队默认（${teamModel.model}）`
    : '继承团队默认（团队未设置 → 用全局默认）'

  /** 实际生效模型：角色覆盖 > 团队默认。 */
  const resolvedModel = role.model !== null ? role.model : teamModel
  const modelText = bindingValue(resolvedModel)
  const modelSource = role.model !== null ? 'role' : 'team'

  const avatar = role.avatar !== undefined && role.avatar !== '' ? role.avatar : role.name.slice(0, 1)
  const caps = role.capabilities ?? DEFAULT_CAPABILITIES
  const capsText = capabilitySummary(role.capabilities)

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

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSave(draft)
      onToggleOpen()
    } finally {
      setSaving(false)
    }
  }

  const bundleName = (id: string): string => catalog?.bundles.find(b => b.id === id)?.name ?? id

  const handleCardClick = (): void => {
    // 连线模式中：左键点卡片 = 完成关联（本卡是起点时忽略）。
    if (linkMode && !linking) { onFinishLink(); return }
    // 普通：选中 + 展开编辑。
    onToggleOpen()
  }

  return (
    <div
      className="team-role-card team-role-card-grid"
      data-selected={selected || undefined}
      data-linking={linking || undefined}
      data-link-mode={linkMode || undefined}
    >
      {/* ── 头部 ── */}
      <div className="team-grid-head" onClick={handleCardClick} role="button">
        <span
          className="team-avatar"
          style={{ background: GROUP_META[role.group].color }}
          data-drag-handle={onDragPointerDown !== undefined || undefined}
          aria-hidden="true"
          onPointerDown={onDragPointerDown}
          onClick={event => event.stopPropagation()}
        >
          {avatar}
        </span>
        <span className="team-grid-title">
          <span className="team-role-name">
            {role.name}
            {chainIndex !== null && chainIndex !== undefined ? (
              <span className="team-grid-step">#{chainIndex}</span>
            ) : null}
          </span>
          <span className="team-role-sub">
            <span className="team-tag">{GROUP_META[role.group].label}</span>
            <span style={{ opacity: 0.6 }}>{role.en}</span>
          </span>
        </span>
        <span className="team-grid-actions" onClick={event => event.stopPropagation()}>
          <button
            type="button"
            className={linking ? 'team-icon-btn team-icon-btn-on' : 'team-icon-btn'}
            title="关联：进入连线模式，再点另一张卡片"
            aria-label="关联"
            onClick={onStartLink}
          >🔗</button>
          <button type="button" className="team-icon-btn" title="编辑" aria-label="编辑" onClick={onToggleOpen}>✎</button>
          <button type="button" className="team-icon-btn" title="删除" aria-label="删除" onClick={onRemove}>🗑</button>
        </span>
      </div>

      {role.tagline !== '' ? <div className="team-grid-tagline">{role.tagline}</div> : null}

      {/* ── 模型行 ── */}
      <div className="team-grid-model">
        <span className="team-grid-model-label">模型</span>
        {modelText !== '' ? (
          <>
            <span className="team-grid-model-value" title={modelText}>{modelText}</span>
            <span className="team-card-src" data-src={modelSource}>{SOURCE_LABEL[modelSource]}</span>
          </>
        ) : (
          <span className="team-card-inherit">未设置（继承团队/全局默认）</span>
        )}
        <span className="team-grid-model-channel">{EXECUTORS.find(o => o.value === role.executor)?.label}</span>
      </div>

      {/* ── 装配折叠（只读清单）── */}
      {capsText !== '' || caps.toolMode !== 'inherit' || caps.skillMode !== 'inherit' ? (
        <div className="team-grid-caps">
          <button type="button" className="team-grid-caps-toggle" onClick={() => setCapsListOpen(v => !v)} aria-expanded={capsListOpen}>
            <span>{capsText !== '' ? capsText : '装配'}</span>
            <span className="team-chevron" data-open={capsListOpen}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
          {capsListOpen ? (
            <div className="team-grid-caps-body">
              <div className="team-grid-caps-row">
                <span className="team-grid-caps-key">插件工具</span>
                <span className="team-grid-caps-val">
                  {caps.toolMode === 'inherit' ? '继承全部'
                    : caps.toolMode === 'allow' ? `白名单：${caps.tools.length ? caps.tools.join('、') : '（空）'}`
                      : `禁用：${caps.tools.length ? caps.tools.join('、') : '（空）'}`}
                </span>
              </div>
              <div className="team-grid-caps-row">
                <span className="team-grid-caps-key">技能</span>
                <span className="team-grid-caps-val">
                  {caps.skillMode === 'inherit' ? '不限制'
                    : caps.skillMode === 'none' ? '不使用技能'
                      : `${caps.skills.length ? caps.skills.join('、') : '（无）'}${caps.skillBundles.length ? ` + 包[${caps.skillBundles.map(bundleName).join('、')}]` : ''}`}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="team-grid-caps team-grid-caps-plain">继承会话全部工具与技能</div>
      )}

      {/* ── 关联标签行 ── */}
      {links.length > 0 ? (
        <div className="team-grid-links">
          {links.map(link => (
            <span className="team-chip team-chip-link" key={`${link.index}`} title="点击删除关联">
              {link.kind === 'directed' ? '→' : '↔'} {link.peerName}
              <button
                type="button"
                aria-label={`删除与 ${link.peerName} 的关联`}
                onClick={() => onRemoveLink(link.index)}
              >×</button>
            </span>
          ))}
        </div>
      ) : null}

      {/* ── 编辑折叠 ── */}
      {open ? (
        <div className="team-role-editor" onClick={event => event.stopPropagation()}>
          <div className="team-inline">
            <label className="team-field" style={{ flex: '0 0 96px' }}>
              <span>头像</span>
              <input
                className="team-input"
                value={draft.avatar ?? ''}
                placeholder={role.name.slice(0, 1)}
                maxLength={4}
                onChange={e => patch({ avatar: e.target.value })}
              />
            </label>
            <label className="team-field">
              <span>名称</span>
              <input className="team-input" value={draft.name} onChange={e => patch({ name: e.target.value })} />
            </label>
            <label className="team-field">
              <span>英文名</span>
              <input className="team-input" value={draft.en} onChange={e => patch({ en: e.target.value })} />
            </label>
          </div>

          <label className="team-field">
            <span>定位语</span>
            <input
              className="team-input"
              value={draft.tagline}
              placeholder="如：深度调研·多源取证"
              onChange={e => patch({ tagline: e.target.value })}
            />
          </label>

          <div className="team-inline">
            <label className="team-field">
              <span>分组</span>
              <select className="team-select team-select-grow" value={draft.group} onChange={e => patch({ group: e.target.value as RoleGroup })}>
                {GROUPS.map(group => (
                  <option key={group} value={group}>{GROUP_META[group].label}</option>
                ))}
              </select>
            </label>
            <label className="team-field">
              <span>执行通道</span>
              <select className="team-select team-select-grow" value={draft.executor} onChange={e => patch({ executor: e.target.value as ExecutorPref })}>
                {EXECUTORS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="team-pop-hint">{EXECUTORS.find(o => o.value === draft.executor)?.hint}</div>

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

          <div className="team-caps-toggle">
            <button type="button" className="team-btn" onClick={() => setCapsEditOpen(v => !v)} aria-expanded={capsEditOpen}>
              {capsEditOpen ? '收起能力装配' : '能力装配（插件工具 + 技能）'}
            </button>
          </div>
          {capsEditOpen ? (
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
              style={{ minHeight: 120 }}
              value={draft.prompt}
              placeholder="定义这个角色的身份、职责与输出要求"
              onChange={e => patch({ prompt: e.target.value })}
            />
          </label>

          <div className="team-actions">
            <button type="button" className="team-btn team-btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" className="team-btn" disabled={saving} onClick={() => { setDraft(role); onToggleOpen() }}>取消</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
