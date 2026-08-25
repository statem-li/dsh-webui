/**
 * team — 角色卡片（纯展示，编辑走 RoleEditorModal 弹窗）。
 *
 * 同一个组件同时用于两处，靠 CSS 控制尺寸：
 *  - 编制页的卡片网格（`.team-role-grid` 下自适应宽度）；
 *  - 全屏画布的节点（`.team-board-node` 下固定宽高，保证连线锚点稳定）。
 *
 * 卡片自上而下：头像 + 名称/分组 → 定位语 → 生效模型 → 装配摘要 → 关联 chips。
 * 卡片本体点击 = 打开编辑弹窗；连线模式下点击 = 完成关联。
 * 卡片内不再内联编辑面 —— 内联展开会把画布节点撑高、盖住邻居节点导致点不到控件。
 */

import { capabilitySummary } from './CapabilityEditor.tsx'
import {
  DEFAULT_CAPABILITIES, GROUP_META, SOURCE_LABEL,
  type ModelBinding, type Role,
} from './types.ts'
import { bindingValue } from './util.ts'

/** 执行通道显示名。 */
const CHANNEL_LABEL: Readonly<Record<Role['executor'], string>> = {
  auto: '自动',
  llm: 'llm 直跑',
  subagent: 'subagent',
}

/** 一条关联的视图（含对方角色名与 directLinks 原始索引）。 */
export interface RoleLinkRef {
  index: number
  peerId: string
  peerName: string
  kind: 'bidirectional' | 'directed'
}

export interface RoleCardProps {
  role: Role
  teamModel: ModelBinding
  /** 图上被选中（描边高亮）。 */
  selected?: boolean
  /** 连线模式：本卡是起点。 */
  linking?: boolean
  /** 连线模式进行中（此时点卡片 = 完成关联）。 */
  linkMode?: boolean
  /** 选中链时本角色的步序号（1-based；不在链中为 null）。 */
  chainIndex?: number | null
  links: RoleLinkRef[]
  /** 打开编辑弹窗。 */
  onOpen: () => void
  onRemove: () => void
  onStartLink: () => void
  onFinishLink: () => void
  onRemoveLink: (index: number) => void
  /** 拖拽手柄 pointerdown（画布节点用；网格卡片不传）。 */
  onDragPointerDown?: (event: React.PointerEvent) => void
}

/** 角色卡片（展示态）。 */
export function RoleCard({
  role, teamModel, selected, linking, linkMode, chainIndex, links,
  onOpen, onRemove, onStartLink, onFinishLink, onRemoveLink, onDragPointerDown,
}: RoleCardProps): JSX.Element {
  /** 实际生效模型：角色覆盖 > 团队默认。 */
  const resolvedModel = role.model !== null ? role.model : teamModel
  const modelText = bindingValue(resolvedModel)
  const modelSource = role.model !== null ? 'role' : 'team'

  const avatar = role.avatar !== undefined && role.avatar !== '' ? role.avatar : role.name.slice(0, 1)
  const caps = role.capabilities ?? DEFAULT_CAPABILITIES
  const capsText = capabilitySummary(role.capabilities)
  const capsPlain = capsText === '' && caps.toolMode === 'inherit' && caps.skillMode === 'inherit'

  const handleCardClick = (): void => {
    // 连线模式中：点卡片 = 完成关联（本卡是起点时点击视为取消）。
    if (linkMode === true) { onFinishLink(); return }
    onOpen()
  }

  return (
    <div
      className="team-role-card-grid"
      data-selected={selected === true || undefined}
      data-linking={linking === true || undefined}
      data-link-mode={linkMode === true || undefined}
      data-group={role.group}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      aria-label={`角色 ${role.name}`}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        handleCardClick()
      }}
    >
      {/* ── 头部（画布里整块是拖拽手柄；操作按钮区自行 stopPropagation）── */}
      <div className="team-grid-head" onPointerDown={onDragPointerDown}>
        <span
          className="team-avatar"
          style={{ background: GROUP_META[role.group].color }}
          aria-hidden="true"
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
            <span className="team-tag" style={{ borderColor: GROUP_META[role.group].color, color: GROUP_META[role.group].color }}>
              {GROUP_META[role.group].label}
            </span>
            <span className="team-grid-en">{role.en}</span>
          </span>
        </span>
        <span className="team-grid-actions" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
          <button
            type="button"
            className={linking === true ? 'team-icon-btn team-icon-btn-on' : 'team-icon-btn'}
            title="关联：点这里再点另一张卡片"
            aria-label="建立关联"
            onClick={onStartLink}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6.5 9.5l3-3M6 4.5l.8-.8a2.4 2.4 0 013.4 3.4l-.8.8M10 11.5l-.8.8a2.4 2.4 0 01-3.4-3.4l.8-.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="team-icon-btn" title="编辑角色" aria-label="编辑角色" onClick={onOpen}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10.6 2.9l2.5 2.5M3 13h2.6l7-7a1.4 1.4 0 000-2L11.9 3a1.4 1.4 0 00-2 0l-7 7V13z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="team-icon-btn" title="删除角色" aria-label="删除角色" onClick={onRemove}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.5 5h9M6.5 5V3.6h3V5M5 5l.5 7.4h5L11 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </span>
      </div>

      {/* ── 定位语（固定两行高度，保证卡片等高）── */}
      <div className="team-grid-tagline">{role.tagline !== '' ? role.tagline : '—'}</div>

      {/* ── 模型行 ── */}
      <div className="team-grid-model">
        <span className="team-grid-model-label">模型</span>
        {modelText !== '' ? (
          <>
            <span className="team-grid-model-value" title={modelText}>{modelText}</span>
            <span className="team-card-src" data-src={modelSource}>{SOURCE_LABEL[modelSource]}</span>
          </>
        ) : (
          <span className="team-card-inherit">未设置（继承全局）</span>
        )}
        <span className="team-grid-model-channel">{CHANNEL_LABEL[role.executor]}</span>
      </div>

      {/* ── 装配摘要（单行；详情在编辑弹窗里）── */}
      <div className="team-grid-caps-plain" title={capsPlain ? '继承会话全部工具与技能' : capsText}>
        {capsPlain ? '继承会话全部工具与技能' : (capsText !== '' ? capsText : '已自定义装配')}
      </div>

      {/* ── 关联 chips ── */}
      {links.length > 0 ? (
        <div className="team-grid-links" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
          {links.map(link => (
            <span className="team-chip team-chip-link" key={link.index} title={`与「${link.peerName}」的关联`}>
              {link.kind === 'directed' ? '→' : '↔'} {link.peerName}
              <button
                type="button"
                aria-label={`删除与 ${link.peerName} 的关联`}
                onClick={() => onRemoveLink(link.index)}
              >×</button>
            </span>
          ))}
        </div>
      ) : <div className="team-grid-links team-grid-links-empty">无关联</div>}
    </div>
  )
}
