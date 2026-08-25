/**
 * team — 关系画布（**无限画布**：平移 / 缩放 / 拖拽排布 / 侧边锚点连线）。
 *
 * 坐标体系（这里是之前一堆布局 bug 的根源，务必看清）：
 *  - **世界坐标 = 绝对像素，无边界**。`role.pos` 直接存 world px（可为负），
 *    不再做 0..1 归一化。归一化是老实现的原罪：它必须有一个"满量程"
 *    （WORLD_MIN_W/H），于是画布被迫有大小上限、拖到边就顶住；更坑的是量程
 *    基准 span 随角色数变化，加/删一个角色会让所有已存位置整体缩放漂移。
 *  - **旧数据兼容**：一个团队里带 pos 的角色若**全部**落在 0..1 内，视为老的
 *    归一化数据，按当年的 span 公式一次性折算成 px（见 legacyScale）；用户下次
 *    拖拽提交时即写回 px，自然完成迁移。
 *  - **视口变换**：world 容器整体套 translate(pan) + scale(zoom)，屏幕坐标 →
 *    world 坐标一律走 toWorld()。world 容器自身不设宽高（零尺寸变换原点），
 *    因此节点可以放在任意坐标；连线 svg 按节点包围盒动态铺一张"纸"，
 *    viewBox 带负原点，保持 1:1 不缩放。
 *
 * 连线：从卡片**左右两侧的垂直中点**出发（就近侧自动选择），走三次贝塞尔，
 * 不再从头像位置直线穿过卡片本体。连线可点选，选中后在中点浮出操作条
 * （切换方向 / 删除）。
 *
 * 性能：拖拽期间只更新一个 ref + 一次 setState（节点 transform），松手才提交一次
 * POST；缩放/平移只改 CSS transform，不触发布局重算。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RoleCard, type RoleLinkRef } from './RoleCard.tsx'
import type { Chain, DirectLink, ModelBinding, NodePos, Role, Team } from './types.ts'

/** 节点卡片尺寸（画布内固定，保证锚点稳定）。 */
export const NODE_W = 250
export const NODE_H = 188

/** 自动布局的列间距 / 行间距 / 起始边距（world px）。 */
const GAP_X = 130
const GAP_Y = 78
const MARGIN = 80

/**
 * 旧版归一化坐标的量程基准（仅用于一次性折算历史数据，勿用于新逻辑）。
 * 老公式：world.w = max(1680, MARGIN*2 + cols*NODE_W + (cols-1)*GAP_X)，
 * spanX = world.w - NODE_W；y 同理。
 */
const LEGACY_MIN_W = 1680
const LEGACY_MIN_H = 1000

const ZOOM_MIN = 0.2
const ZOOM_MAX = 2.5
/** 超过这个位移才算拖拽（否则视为点击，避免"想点开却被当成拖动"）。 */
const DRAG_THRESHOLD = 4
/** 连线层 svg 相对节点包围盒的外扩留白（连线会甩到卡片外侧）。 */
const EDGE_PAD = 400

interface Placed {
  role: Role
  x: number
  y: number
}

interface Point { x: number, y: number }

export interface TeamBoardProps {
  team: Team
  chain: Chain | null
  chainOrder: Record<string, number>
  linkFrom: string
  selectedRoleId: string
  linksByRole: Record<string, RoleLinkRef[]>
  /** 顶部工具条（由 Panel 传入，随画布一起全屏）。 */
  toolbar?: JSX.Element
  onOpenRole: (roleId: string) => void
  onRemoveRole: (roleId: string) => void
  onStartLink: (roleId: string) => void
  onFinishLink: (roleId: string) => void
  onRemoveLink: (index: number) => void
  /** 切换某条关联的方向（bidirectional ↔ directed）。 */
  onFlipLink: (index: number) => void
  onCommitPositions: (positions: Record<string, NodePos>) => void
}

/** 关系画布。 */
export function TeamBoard({
  team, chain, chainOrder, linkFrom, selectedRoleId, linksByRole, toolbar,
  onOpenRole, onRemoveRole, onStartLink, onFinishLink, onRemoveLink, onFlipLink, onCommitPositions,
}: TeamBoardProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ w: 1200, h: 700 })
  /** 本地位置覆盖（world px；拖拽中 / 尚未回流）。 */
  const [local, setLocal] = useState<Record<string, NodePos>>({})
  /** 正在拖拽的节点 id（用于 z-index 与光标）。 */
  const [dragging, setDragging] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  /** 选中的关联（directLinks 索引）。 */
  const [activeLink, setActiveLink] = useState<number | null>(null)
  /** 连线模式下光标的 world 坐标（画预览线）。 */
  const [ghost, setGhost] = useState<Point | null>(null)

  /** 最新位置（拖拽 up 回调读它，避免闭包拿到旧值——旧实现因此丢位置）。 */
  const posRef = useRef<Record<string, NodePos>>({})
  /** 刚结束一次拖拽的时间戳：随后的 click 要吞掉，否则松手就打开编辑弹窗。 */
  const draggedAtRef = useRef(0)
  /** 变换的最新值（滚轮/拖拽回调里读，避免闭包过期）。 */
  const zoomRef = useRef(1)
  const panRef = useRef<Point>({ x: 0, y: 0 })
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

  // ── 视口测量 ──
  useLayoutEffect(() => {
    const host = viewportRef.current
    if (host === null) return
    const measure = (): void => {
      const rect = host.getBoundingClientRect()
      setViewport((previous) => {
        const w = Math.max(320, Math.round(rect.width))
        const h = Math.max(240, Math.round(rect.height))
        return previous.w === w && previous.h === h ? previous : { w, h }
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => { observer.disconnect() }
  }, [])

  // 团队切换：清空本地覆盖与选中态。
  useEffect(() => {
    setLocal({})
    setActiveLink(null)
    setDragging(null)
  }, [team.id])

  /** 自动布局用的列数（仅决定网格形状，不再限制画布尺寸）。 */
  const cols = useMemo(() => {
    const count = Math.max(1, team.roles.length)
    return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))))
  }, [team.roles.length])

  /** 自动布局（分组排序后按网格铺，间距恒定不重叠；world px）。 */
  const auto = useMemo(() => {
    const order: Record<Role['group'], number> = { core: 0, judge: 1, act: 2, guard: 3 }
    const sorted = [...team.roles].sort((a, b) => (order[a.group] - order[b.group]))
    const out: Record<string, NodePos> = {}
    sorted.forEach((role, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      out[role.id] = {
        x: MARGIN + col * (NODE_W + GAP_X),
        y: MARGIN + row * (NODE_H + GAP_Y),
      }
    })
    return out
  }, [team.roles, cols])

  /**
   * 旧归一化数据的折算系数。判定规则：本团队所有 pos 都落在 0..1 内，**且**至少
   * 有一个值带小数——新格式是整数 px，只有 0/1 这种整数才会误落进 0..1 区间，
   * 加上"带小数"这条就不会把真拖到原点附近的节点误当历史数据放大。
   * 系数按老公式还原当年的 span。
   */
  const legacyScale = useMemo((): Point | null => {
    const withPos = team.roles.filter((role): role is Role & { pos: NodePos } => role.pos !== undefined)
    if (withPos.length === 0) return null
    const inUnitRange = withPos.every(role => (
      role.pos.x >= 0 && role.pos.x <= 1 && role.pos.y >= 0 && role.pos.y <= 1
    ))
    if (!inUnitRange) return null
    const hasFraction = withPos.some(role => (
      !Number.isInteger(role.pos.x) || !Number.isInteger(role.pos.y)
    ))
    if (!hasFraction) return null
    const rows = Math.ceil(Math.max(1, team.roles.length) / cols)
    const needW = MARGIN * 2 + cols * NODE_W + (cols - 1) * GAP_X
    const needH = MARGIN * 2 + rows * NODE_H + (rows - 1) * GAP_Y
    return {
      x: Math.max(1, Math.max(LEGACY_MIN_W, needW) - NODE_W),
      y: Math.max(1, Math.max(LEGACY_MIN_H, needH) - NODE_H),
    }
  }, [team.roles, cols])

  /** 生效位置（world px）：本地覆盖 > role.pos（必要时折算） > 自动布局。 */
  const positions = useMemo(() => {
    const out: Record<string, NodePos> = {}
    for (const role of team.roles) {
      const localPos = local[role.id]
      if (localPos !== undefined) { out[role.id] = localPos; continue }
      const saved = role.pos
      if (saved !== undefined) {
        out[role.id] = legacyScale === null
          ? saved
          : { x: Math.round(saved.x * legacyScale.x), y: Math.round(saved.y * legacyScale.y) }
        continue
      }
      out[role.id] = auto[role.id] ?? { x: MARGIN, y: MARGIN }
    }
    return out
  }, [team.roles, local, auto, legacyScale])

  useEffect(() => { posRef.current = positions }, [positions])

  const placed = useMemo<Placed[]>(() => team.roles.map(role => ({
    role,
    x: positions[role.id].x,
    y: positions[role.id].y,
  })), [team.roles, positions])

  const byId = useMemo(() => new Map(placed.map(node => [node.role.id, node])), [placed])

  /** 节点包围盒（连线 svg 的画纸范围；空团队给一个占位框）。 */
  const bounds = useMemo(() => {
    if (placed.length === 0) return { x: 0, y: 0, w: 1, h: 1 }
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (const node of placed) {
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + NODE_W)
      maxY = Math.max(maxY, node.y + NODE_H)
    }
    return {
      x: minX - EDGE_PAD,
      y: minY - EDGE_PAD,
      w: Math.max(1, maxX - minX + EDGE_PAD * 2),
      h: Math.max(1, maxY - minY + EDGE_PAD * 2),
    }
  }, [placed])

  /** 屏幕坐标 → world 坐标。 */
  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const host = viewportRef.current
    if (host === null) return { x: 0, y: 0 }
    const rect = host.getBoundingClientRect()
    const scale = zoomRef.current
    return {
      x: (clientX - rect.left - panRef.current.x) / scale,
      y: (clientY - rect.top - panRef.current.y) / scale,
    }
  }, [])

  /** 把视图对齐到节点包围盒（适应视图）。 */
  const fitView = useCallback((): void => {
    if (placed.length === 0) { setZoom(1); setPan({ x: 0, y: 0 }); return }
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (const node of placed) {
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + NODE_W)
      maxY = Math.max(maxY, node.y + NODE_H)
    }
    const pad = 60
    const boxW = Math.max(1, maxX - minX + pad * 2)
    const boxH = Math.max(1, maxY - minY + pad * 2)
    const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(viewport.w / boxW, viewport.h / boxH)))
    setZoom(scale)
    setPan({
      x: (viewport.w - (maxX - minX) * scale) / 2 - minX * scale,
      y: (viewport.h - (maxY - minY) * scale) / 2 - minY * scale,
    })
  }, [placed, viewport])

  // 首次有节点 + 视口就绪时自动适应一次。
  const fittedRef = useRef('')
  useEffect(() => {
    const key = `${team.id}:${team.roles.length}`
    if (fittedRef.current === key) return
    if (team.roles.length === 0 || viewport.w <= 320) return
    fittedRef.current = key
    fitView()
  }, [team.id, team.roles.length, viewport.w, fitView])

  /** 以某个屏幕点为焦点缩放（焦点下的 world 坐标保持不动）。 */
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number): void => {
    const host = viewportRef.current
    if (host === null) return
    const rect = host.getBoundingClientRect()
    const current = zoomRef.current
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor))
    if (next === current) return
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const wx = (sx - panRef.current.x) / current
    const wy = (sy - panRef.current.y) / current
    setZoom(next)
    setPan({ x: sx - wx * next, y: sy - wy * next })
  }, [])

  // 滚轮：Ctrl/⌘ = 缩放，否则平移（wheel 必须非 passive 才能 preventDefault）。
  useEffect(() => {
    const host = viewportRef.current
    if (host === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12)
        return
      }
      setPan(previous => ({ x: previous.x - event.deltaX, y: previous.y - event.deltaY }))
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => { host.removeEventListener('wheel', onWheel) }
  }, [zoomAt])

  // ── 节点拖拽（带抓取偏移 + 阈值 + ref 提交最新值）──
  const startDrag = useCallback((roleId: string) => (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const node = byId.get(roleId)
    if (node === undefined) return
    const start = toWorld(event.clientX, event.clientY)
    // 抓取偏移：按下点相对节点左上角的位移，拖动时保持不变（不再把卡片中心吸到光标）。
    const grabX = start.x - node.x
    const grabY = start.y - node.y
    let moved = false

    const move = (e: PointerEvent): void => {
      const point = toWorld(e.clientX, e.clientY)
      if (!moved) {
        const scale = zoomRef.current
        if (Math.abs(point.x - start.x) * scale < DRAG_THRESHOLD
          && Math.abs(point.y - start.y) * scale < DRAG_THRESHOLD) return
        moved = true
        setDragging(roleId)
      }
      // 无限画布：不做任何边界钳制，坐标可为负。
      const next = { x: Math.round(point.x - grabX), y: Math.round(point.y - grabY) }
      posRef.current = { ...posRef.current, [roleId]: next }
      setLocal(previous => ({ ...previous, [roleId]: next }))
    }

    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setDragging(null)
      // 只有真的拖动过才写盘；读 ref 拿到最新位置（闭包里的 positions 已过期）。
      if (moved) {
        draggedAtRef.current = Date.now()
        onCommitPositions({ ...posRef.current })
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [byId, toWorld, onCommitPositions])

  // ── 画布平移（空白处拖拽 / 中键）──
  const startPan = useCallback((event: React.PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return
    // 点空白：取消连线模式的选中态与关联选中。
    setActiveLink(null)
    const originX = event.clientX
    const originY = event.clientY
    const base = { ...panRef.current }
    const host = viewportRef.current
    host?.setAttribute('data-panning', 'true')
    const move = (e: PointerEvent): void => {
      setPan({ x: base.x + (e.clientX - originX), y: base.y + (e.clientY - originY) })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      host?.removeAttribute('data-panning')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [])

  // 连线模式下跟随光标画预览线。
  useEffect(() => {
    if (linkFrom === '') { setGhost(null); return }
    const host = viewportRef.current
    if (host === null) return
    const move = (event: PointerEvent): void => { setGhost(toWorld(event.clientX, event.clientY)) }
    host.addEventListener('pointermove', move)
    return () => { host.removeEventListener('pointermove', move) }
  }, [linkFrom, toWorld])

  /** 选中链的接力边（角色 id 序列 → 相邻对）。 */
  const chainEdges = useMemo(() => {
    if (chain === null) return [] as Array<[string, string]>
    const core = team.roles.find(role => role.group === 'core')
    const seq: string[] = []
    for (const step of chain.steps) {
      if (step.kind === 'synthesize') {
        const id = step.roleId ?? core?.id
        if (id !== undefined) seq.push(id)
        continue
      }
      seq.push(step.roleId)
    }
    if (chain.finalSynthesize && !chain.steps.some(step => step.kind === 'synthesize') && core !== undefined) {
      seq.push(core.id)
    }
    const edges: Array<[string, string]> = []
    for (let i = 0; i < seq.length - 1; i += 1) {
      if (seq[i] !== seq[i + 1]) edges.push([seq[i], seq[i + 1]])
    }
    return edges
  }, [team, chain])

  /** world 容器自身零尺寸：只作为 translate/scale 的原点，节点坐标可任意（含负）。 */
  const worldStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
  }

  /**
   * 网格底纹跟随 pan/zoom（无限画布的空间参照：拖动时网格一起走，才有"在移动"的感觉）。
   * 缩放很小时按 2 的幂加粗网格，避免线密到糊成一片。
   */
  const gridStyle = useMemo(() => {
    let step = 32 * zoom
    while (step < 14) step *= 2
    while (step > 120) step /= 2
    const ox = ((pan.x % step) + step) % step
    const oy = ((pan.y % step) + step) % step
    return {
      backgroundSize: `${fmt(step)}px ${fmt(step)}px`,
      backgroundPosition: `${fmt(ox)}px ${fmt(oy)}px`,
    }
  }, [pan, zoom])

  const linking = linkFrom !== ''
  const linkFromNode = linking ? byId.get(linkFrom) : undefined

  return (
    <div className="team-canvas">
      {toolbar !== undefined ? <div className="team-canvas-bar">{toolbar}</div> : null}

      <div
        className="team-canvas-viewport"
        ref={viewportRef}
        style={gridStyle}
        data-linking={linking || undefined}
        onPointerDown={startPan}
      >
        <div className="team-canvas-world" style={worldStyle}>
          {/* ── 连线层（按节点包围盒铺纸，viewBox 带负原点承接负坐标）── */}
          <svg
            className="team-canvas-svg"
            style={{ left: bounds.x, top: bounds.y }}
            width={bounds.w}
            height={bounds.h}
            viewBox={`${fmt(bounds.x)} ${fmt(bounds.y)} ${fmt(bounds.w)} ${fmt(bounds.h)}`}
          >
            <defs>
              <marker id="team-arrow-chain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="var(--dsw-alias-state-business-primary, #4176e6)" />
              </marker>
              <marker id="team-arrow-link" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="var(--dsw-alias-label-tertiary, #888)" />
              </marker>
              <marker id="team-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="var(--dsw-alias-state-business-primary, #4176e6)" />
              </marker>
            </defs>

            {/* 选中链的接力路径（画在关联线下层） */}
            {chainEdges.map(([fromId, toId], index) => {
              const from = byId.get(fromId)
              const to = byId.get(toId)
              if (from === undefined || to === undefined) return null
              return (
                <path
                  key={`chain-${String(index)}`}
                  className="team-edge"
                  data-kind="chain"
                  d={edgePath(from, to)}
                  markerEnd="url(#team-arrow-chain)"
                />
              )
            })}

            {/* 关联线（透明加粗 path 承接命中：左键点选、右键直接删）*/}
            {team.directLinks.map((link, index) => {
              const from = byId.get(link.from)
              const to = byId.get(link.to)
              if (from === undefined || to === undefined) return null
              const d = edgePath(from, to)
              const active = activeLink === index
              return (
                <g key={`link-${String(index)}`}>
                  <path
                    className="team-edge-hit"
                    d={d}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      // 右键交给 onContextMenu（这里若也 toggle 选中，删除后索引已变会选错线）。
                      if (event.button !== 0) return
                      setActiveLink(current => (current === index ? null : index))
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setActiveLink(null)
                      onRemoveLink(index)
                    }}
                  >
                    <title>左键选中 · 右键删除连线</title>
                  </path>
                  <path
                    className="team-edge"
                    data-kind="link"
                    data-active={active || undefined}
                    d={d}
                    {...(link.kind === 'directed'
                      ? { markerEnd: active ? 'url(#team-arrow-active)' : 'url(#team-arrow-link)' }
                      : {})}
                  />
                </g>
              )
            })}

            {/* 连线模式预览线（起点右侧锚点 → 光标） */}
            {linkFromNode !== undefined && ghost !== null ? (
              <path
                className="team-edge"
                data-kind="ghost"
                d={ghostPath(linkFromNode, ghost)}
              />
            ) : null}
          </svg>

          {/* ── 关联操作条（选中一条线时浮在中点）── */}
          {activeLink !== null ? renderLinkTools({
            link: team.directLinks[activeLink],
            index: activeLink,
            byId,
            onFlip: onFlipLink,
            onRemove: (index) => { setActiveLink(null); onRemoveLink(index) },
          }) : null}

          {/* ── 节点层 ── */}
          {placed.map(node => (
            <div
              key={node.role.id}
              className="team-board-node"
              data-dragging={dragging === node.role.id || undefined}
              style={{
                left: node.x,
                top: node.y,
                width: NODE_W,
                height: NODE_H,
                zIndex: dragging === node.role.id ? 30 : (selectedRoleId === node.role.id ? 20 : 10),
              }}
              onPointerDown={event => event.stopPropagation()}
            >
              <RoleCard
                role={node.role}
                teamModel={team.model}
                selected={selectedRoleId === node.role.id}
                linking={linkFrom === node.role.id}
                linkMode={linking}
                chainIndex={chainOrder[node.role.id] ?? null}
                links={linksByRole[node.role.id] ?? []}
                onOpen={() => {
                  // 拖拽刚结束的那一下 click 不算「打开编辑」。
                  if (Date.now() - draggedAtRef.current < 220) return
                  onOpenRole(node.role.id)
                }}
                onRemove={() => onRemoveRole(node.role.id)}
                onStartLink={() => onStartLink(node.role.id)}
                onFinishLink={() => onFinishLink(node.role.id)}
                onRemoveLink={onRemoveLink}
                onDragPointerDown={startDrag(node.role.id)}
              />
            </div>
          ))}
        </div>

        {/* ── 缩放控件 ── */}
        <div className="team-canvas-zoom" onPointerDown={event => event.stopPropagation()}>
          <button
            type="button"
            className="team-icon-btn"
            aria-label="缩小"
            onClick={() => zoomAt(centerX(viewportRef), centerY(viewportRef), 1 / 1.2)}
          >−</button>
          <span className="team-canvas-zoom-val">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="team-icon-btn"
            aria-label="放大"
            onClick={() => zoomAt(centerX(viewportRef), centerY(viewportRef), 1.2)}
          >＋</button>
          <button type="button" className="team-btn" onClick={fitView}>适应视图</button>
        </div>

        {team.roles.length === 0 ? (
          <div className="team-canvas-empty">
            <span>这个团队还没有角色</span>
            <span>用工具条的「＋ 添加角色」新建第一个</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 视口中心（缩放按钮的焦点）。 */
function centerX(ref: React.MutableRefObject<HTMLDivElement | null>): number {
  const rect = ref.current?.getBoundingClientRect()
  return rect === undefined ? 0 : rect.left + rect.width / 2
}

function centerY(ref: React.MutableRefObject<HTMLDivElement | null>): number {
  const rect = ref.current?.getBoundingClientRect()
  return rect === undefined ? 0 : rect.top + rect.height / 2
}

/** 卡片四个侧边中点锚（连线只走左右两侧的垂直中点，上下作为竖向排布的兜底）。 */
function anchors(node: Placed): { left: Point, right: Point, top: Point, bottom: Point } {
  const midY = node.y + NODE_H / 2
  const midX = node.x + NODE_W / 2
  return {
    left: { x: node.x, y: midY },
    right: { x: node.x + NODE_W, y: midY },
    top: { x: midX, y: node.y },
    bottom: { x: midX, y: node.y + NODE_H },
  }
}

/**
 * 两个节点之间的连线路径：优先左右侧中点互连（就近侧），
 * 水平间距不足而竖向偏移明显时改走上下侧中点。
 */
function edgePath(from: Placed, to: Placed): string {
  const a = anchors(from)
  const b = anchors(to)
  const dx = (to.x + NODE_W / 2) - (from.x + NODE_W / 2)
  const dy = (to.y + NODE_H / 2) - (from.y + NODE_H / 2)

  // 卡片在水平方向几乎重叠（列对齐）且竖向拉开：走上下锚，曲线更自然。
  if (Math.abs(dx) < NODE_W * 0.75 && Math.abs(dy) > NODE_H * 0.6) {
    const start = dy > 0 ? a.bottom : a.top
    const end = dy > 0 ? b.top : b.bottom
    const lift = Math.max(40, Math.abs(end.y - start.y) * 0.42)
    const c1 = { x: start.x, y: start.y + (dy > 0 ? lift : -lift) }
    const c2 = { x: end.x, y: end.y - (dy > 0 ? lift : -lift) }
    return `M ${fmt(start.x)} ${fmt(start.y)} C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(end.x)} ${fmt(end.y)}`
  }

  const start = dx >= 0 ? a.right : a.left
  const end = dx >= 0 ? b.left : b.right
  const reach = Math.max(60, Math.abs(end.x - start.x) * 0.45)
  const c1 = { x: start.x + (dx >= 0 ? reach : -reach), y: start.y }
  const c2 = { x: end.x - (dx >= 0 ? reach : -reach), y: end.y }
  return `M ${fmt(start.x)} ${fmt(start.y)} C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(end.x)} ${fmt(end.y)}`
}

/** 连线模式的预览线：起点就近侧锚 → 光标。 */
function ghostPath(from: Placed, cursor: Point): string {
  const a = anchors(from)
  const start = cursor.x >= from.x + NODE_W / 2 ? a.right : a.left
  const reach = Math.max(50, Math.abs(cursor.x - start.x) * 0.4)
  const sign = cursor.x >= start.x ? 1 : -1
  return `M ${fmt(start.x)} ${fmt(start.y)} C ${fmt(start.x + sign * reach)} ${fmt(start.y)}, ${fmt(cursor.x - sign * reach)} ${fmt(cursor.y)}, ${fmt(cursor.x)} ${fmt(cursor.y)}`
}

/** 关联中点的操作条（切换方向 / 删除）。 */
function renderLinkTools({ link, index, byId, onFlip, onRemove }: {
  link: DirectLink | undefined
  index: number
  byId: Map<string, Placed>
  onFlip: (index: number) => void
  onRemove: (index: number) => void
}): JSX.Element | null {
  if (link === undefined) return null
  const from = byId.get(link.from)
  const to = byId.get(link.to)
  if (from === undefined || to === undefined) return null
  const mid = {
    x: (from.x + to.x) / 2 + NODE_W / 2,
    y: (from.y + to.y) / 2 + NODE_H / 2,
  }
  return (
    <div
      className="team-edge-tools"
      style={{ left: mid.x, top: mid.y }}
      onPointerDown={event => event.stopPropagation()}
    >
      <button
        type="button"
        className="team-btn"
        title={link.kind === 'directed' ? '改为双向' : '改为单向（from → to）'}
        onClick={() => onFlip(index)}
      >{link.kind === 'directed' ? '→ 单向' : '↔ 双向'}</button>
      <button type="button" className="team-btn team-btn-danger" onClick={() => onRemove(index)}>删除连线</button>
    </div>
  )
}

/** 路径数值格式化（避免超长小数塞满 DOM）。 */
function fmt(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}

/** 供 Panel 复用的模型绑定类型再导出（避免多处 import 路径）。 */
export type { ModelBinding }
