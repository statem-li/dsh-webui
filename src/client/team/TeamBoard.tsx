/**
 * team — 关系图画板（卡片节点 + 连线 + 拖拽 + 左键关联）。
 *
 * 节点是**角色卡片**（复用 RoleCard：头像/角色名/模型/装配折叠/关联 chips），
 * 不是圆球；节点间画 SVG 连线：
 *  - 关联（directLinks）：点划线（双向直线 / 单向箭头）
 *  - 选中链条的接力路径：品牌蓝箭头
 *
 * 交互：
 *  - 拖拽节点：按住卡片**头像**拖动，位置以归一化坐标写回 role.pos（松手提交一次）。
 *  - 左键建关联：点卡片 🔗 进入连线模式，再左键点目标卡片。
 *  - 左键点卡片身体：展开编辑（RoleCard 内嵌编辑面）。
 *
 * 性能：拖拽期间只改本地 state + 节点 transform，无布局重算、无网络；松手才 POST 一次。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RoleCard, type RoleLinkRef } from './RoleCard.tsx'
import type { CapabilityCatalog, Chain, ModelBinding, NodePos, ProviderView, Role, Team } from './types.ts'

const NODE_W = 262
const NODE_H = 178
const PAD = 16
const GAP_X = 14
const ROW_H = 190
/** 连线锚点：节点顶部头像附近（不随卡片展开高度漂移）。 */
const ANCHOR_Y = 42

interface PlacedNode {
  role: Role
  x: number
  y: number
}

export interface TeamBoardProps {
  team: Team
  chain: Chain | null
  chainOrder: Record<string, number>
  linkFrom: string
  selectedRoleId: string
  openRoleIds: Record<string, boolean>
  catalog: CapabilityCatalog | null
  providers: readonly ProviderView[]
  linksByRole: Record<string, RoleLinkRef[]>
  onToggleOpen: (roleId: string) => void
  onSave: (role: Role) => Promise<void> | void
  onRemove: (roleId: string) => void
  onStartLink: (roleId: string) => void
  onFinishLink: (roleId: string) => void
  onRemoveLink: (index: number) => void
  onCommitPositions: (positions: Record<string, NodePos>) => void
}

/** 关系图画板。 */
export function TeamBoard({
  team, chain, chainOrder, linkFrom, selectedRoleId, openRoleIds, catalog, providers, linksByRole,
  onToggleOpen, onSave, onRemove, onStartLink, onFinishLink, onRemoveLink, onCommitPositions,
}: TeamBoardProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ w: 900, h: 560 })
  /** 本地归一化位置（拖拽中 / 未提交）。 */
  const [local, setLocal] = useState<Record<string, NodePos>>({})
  const draggingRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const measure = (): void => {
      const rect = host.getBoundingClientRect()
      setViewport(previous => {
        const w = Math.max(600, Math.round(rect.width))
        const h = Math.max(360, Math.round(rect.height))
        return previous.w === w && previous.h === h ? previous : { w, h }
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => { observer.disconnect() }
  }, [])

  // 团队切换时清空本地覆盖。
  useEffect(() => { setLocal({}); draggingRef.current = null }, [team.id])

  /** 画布逻辑尺寸：至少能放下全部节点（每行最多 5 个）。 */
  const board = useMemo(() => {
    const cols = Math.max(1, Math.min(5, Math.floor((viewport.w - PAD * 2) / (NODE_W + GAP_X))))
    const rows = Math.max(1, Math.ceil(team.roles.length / cols))
    const needW = PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X
    const needH = PAD * 2 + rows * ROW_H
    return { w: Math.max(viewport.w, needW), h: Math.max(viewport.h, needH), cols, rows }
  }, [viewport, team.roles.length])

  /** 自动网格布局（归一化）。 */
  const auto = useMemo(() => {
    const out: Record<string, NodePos> = {}
    team.roles.forEach((role, index) => {
      const col = index % board.cols
      const row = Math.floor(index / board.cols)
      out[role.id] = {
        x: (PAD + col * (NODE_W + GAP_X)) / board.w,
        y: (PAD + row * ROW_H) / board.h,
      }
    })
    return out
  }, [team.roles, board])

  /** 归一化位置：本地覆盖 > role.pos > 自动布局。 */
  const normalized = useMemo(() => {
    const out: Record<string, NodePos> = {}
    for (const role of team.roles) {
      out[role.id] = local[role.id] ?? role.pos ?? auto[role.id] ?? { x: 0.5, y: 0.5 }
    }
    return out
  }, [team.roles, local, auto])

  const placed = useMemo<PlacedNode[]>(() => team.roles.map((role) => {
    const pos = normalized[role.id]
    return {
      role,
      x: pos.x * (board.w - NODE_W),
      y: pos.y * (board.h - NODE_H),
    }
  }), [team.roles, normalized, board])

  const byId = useMemo(() => new Map(placed.map(node => [node.role.id, node])), [placed])

  /** 连线锚点（头像中心）。 */
  const anchor = (node: PlacedNode): { x: number, y: number } => ({ x: node.x + NODE_W / 2, y: node.y + ANCHOR_Y })

  /** 选中链的接力边。 */
  const chainEdges = useMemo(() => {
    if (chain === null) return [] as Array<[string, string]>
    const core = team.roles.find(role => role.group === 'core')
    const seq: string[] = []
    for (const step of chain.steps) {
      if (step.kind === 'synthesize') { const id = step.roleId ?? core?.id; if (id !== undefined) seq.push(id); continue }
      seq.push(step.roleId)
    }
    if (chain.finalSynthesize && !chain.steps.some(s => s.kind === 'synthesize') && core !== undefined) seq.push(core.id)
    const edges: Array<[string, string]> = []
    for (let i = 0; i < seq.length - 1; i += 1) if (seq[i] !== seq[i + 1]) edges.push([seq[i], seq[i + 1]])
    return edges
  }, [team, chain])

  // ── 拖拽 ──
  const startDrag = useCallback((roleId: string) => (event: React.PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    draggingRef.current = roleId
    const move = (e: PointerEvent): void => {
      const host = hostRef.current
      if (host === null) return
      const rect = host.getBoundingClientRect()
      // 画板在容器内可滚动；把视口坐标换算到画布坐标（加上当前滚动偏移）。
      const scrollLeft = host.scrollLeft
      const scrollTop = host.scrollTop
      const x = e.clientX - rect.left + scrollLeft - NODE_W / 2
      const y = e.clientY - rect.top + scrollTop - ANCHOR_Y
      const nx = Math.min(1, Math.max(0, x / (board.w - NODE_W)))
      const ny = Math.min(1, Math.max(0, y / (board.h - NODE_H)))
      setLocal(previous => ({ ...previous, [roleId]: { x: Math.round(nx * 10000) / 10000, y: Math.round(ny * 10000) / 10000 } }))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (draggingRef.current !== null) {
        // 提交当前全部归一化位置（固化布局）。
        onCommitPositions({ ...normalized })
        draggingRef.current = null
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [board, normalized, onCommitPositions])

  return (
    <div className="team-board" ref={hostRef}>
      <div className="team-board-canvas" style={{ width: board.w, height: board.h }}>
        {/* 连线层 */}
        <svg
          className="team-board-svg"
          width={board.w}
          height={board.h}
          viewBox={`0 0 ${board.w} ${board.h}`}
          aria-hidden="true"
        >
          <defs>
            <marker id="team-board-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--dsw-alias-state-business-primary, #4176e6)" />
            </marker>
            <marker id="team-board-arrow-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--dsw-alias-label-tertiary, #888)" />
            </marker>
          </defs>
          {/* 关联线 */}
          {team.directLinks.map((link, index) => {
            const from = byId.get(link.from)
            const to = byId.get(link.to)
            if (from === undefined || to === undefined) return null
            const a = anchor(from)
            const b = anchor(to)
            return (
              <line
                key={`link-${index}`}
                className="team-board-edge"
                data-direct="true"
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                {...(link.kind === 'directed' ? { markerEnd: 'url(#team-board-arrow-dim)' } : {})}
              />
            )
          })}
          {/* 选中链路径 */}
          {chainEdges.map(([fromId, toId], index) => {
            const from = byId.get(fromId)
            const to = byId.get(toId)
            if (from === undefined || to === undefined) return null
            const a = anchor(from)
            const b = anchor(to)
            return (
              <line
                key={`chain-${index}`}
                className="team-board-edge"
                data-chain="true"
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                markerEnd="url(#team-board-arrow)"
              />
            )
          })}
        </svg>

        {/* 节点 */}
        {placed.map(node => (
          <div
            key={node.role.id}
            className="team-board-node"
            style={{ left: node.x, top: node.y, width: NODE_W }}
          >
            <RoleCard
              role={node.role}
              teamModel={team.model}
              providers={providers}
              catalog={catalog}
              selected={selectedRoleId === node.role.id}
              linking={linkFrom === node.role.id}
              linkMode={linkFrom !== ''}
              chainIndex={chainOrder[node.role.id] ?? null}
              links={linksByRole[node.role.id] ?? []}
              open={openRoleIds[node.role.id] === true}
              onToggleOpen={() => onToggleOpen(node.role.id)}
              onSave={onSave}
              onRemove={() => onRemove(node.role.id)}
              onStartLink={() => onStartLink(node.role.id)}
              onFinishLink={() => onFinishLink(node.role.id)}
              onRemoveLink={onRemoveLink}
              onDragPointerDown={startDrag(node.role.id)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
