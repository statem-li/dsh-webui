import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatExact, formatUnits } from '../format'
import { ChartTooltip } from './ChartTooltip'

export interface SeriesPoint { label: string; input: number; output: number; cache: number }
export interface AreaChartProps {
  data: SeriesPoint[]
  height?: number
  colors?: { input: string; output: string; cache: string }
}

/** 系列展示名（图例 / tooltip）。 */
type SeriesKey = 'input' | 'output' | 'cache'
const SERIES_NAME: Record<SeriesKey, string> = { input: '输入', output: '输出', cache: '缓存' }

/**
 * 主题安全默认配色：
 * - input 主量放最上层，用品牌蓝（--dsw-alias-state-business-primary，浅=deepseek-500、深=deepseek-400）。
 *   绝不能用反色变量 --dsw-alias-brand-primary（浅色下黑块、深色下白块）。
 * - output 用青色、cache 用中性灰（底层）。
 */
const DEFAULT_COLORS: { input: string; output: string; cache: string } = {
  input: 'var(--dsw-alias-state-business-primary)',
  output: '#22b8cf',
  cache: 'var(--dsw-alias-label-tertiary)',
}

const STYLE_ID = 'dsh-usage-area-chart-styles'

/** 入场动画（受 Workbench 注入的 --dsh-chart-anim 控制：reduced-motion 时为 none）。 */
const ANIM_SHEET = `
@keyframes dsh-area-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
/* 注意：不能带 fill-mode both/forwards —— 动画结束后残留 transform 会让内部 position:fixed 的
   tooltip 定位基准变成图表容器（而非视口），导致浮层错位。 */
.dsh-area-chart { animation: var(--dsh-chart-anim, dsh-area-rise .5s cubic-bezier(.2,.8,.2,1)); }
.dsh-area-chart .dsh-area-hover { opacity: 0; transition: opacity .15s ease; }
.dsh-area-chart:hover .dsh-area-hover { opacity: 1; }
`

function ensureAreaChartStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = ANIM_SHEET
  document.head.appendChild(tag)
}

/** 渐变 id 计数器：保证多实例图表 id 不冲突。 */
let uidCounter = 0

/** Catmull-Rom → 三次贝塞尔平滑；点数不足 3 时退化为折线。 */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return ''
  if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

/** 1/2/5×10^n 步长的 nice 刻度（0 → 略高于 max），Y 轴网格与标签共用。 */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step * 0.5; v += step) ticks.push(v)
  return ticks.length >= 2 ? ticks : [0, step]
}

/** X 轴标签：小时（含冒号，如 "14:00"/"08-21 14:00"）原样；YYYY-MM-DD → MM-DD；YYYY-MM → YY-MM。 */
function axisLabel(label: string): string {
  if (label.includes(':')) return label
  if (label.length >= 8) return label.slice(5)
  if (label.length === 7) return label.slice(2)
  return label
}

export function AreaChart({ data, height = 240, colors = DEFAULT_COLORS }: AreaChartProps): JSX.Element {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // 响应式高度：让 SVG viewport 保持 viewBox 比例（W:H），避免窄屏下
  // preserveAspectRatio 默认 meet 造成的上下留白与文字挤压。
  const [wrapW, setWrapW] = useState(0)

  useEffect(ensureAreaChartStyles, [])
  useEffect(() => {
    const el = wrapRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { setWrapW(el.clientWidth) })
    ro.observe(el)
    setWrapW(el.clientWidth)
    return () => { ro.disconnect() }
  }, [])

  const W = 800, H = height
  const PAD = { l: 48, r: 16, t: 20, b: 26 }
  const renderH = wrapW > 0 ? Math.max(120, Math.round((wrapW * H) / W)) : H
  const gradId = useMemo(() => `dsh-area-grad-${++uidCounter}`, [])

  // 堆叠分层：每点是「当天值」而非累计 —— 趋势图语义是每日用量，不是截至当天的累计总量。
  // cache（底）→ output（中）→ input（顶）。
  const topCache = useMemo(() => data.map(d => d.cache), [data])
  const topOut = useMemo(() => data.map((d, i) => topCache[i] + d.output), [data, topCache])
  const topIn = useMemo(() => data.map((d, i) => topOut[i] + d.input), [data, topOut])

  const maxVal = topIn.length > 0 ? Math.max(0, ...topIn) : 0
  const ticks = useMemo(() => niceTicks(maxVal || 1), [maxVal])
  const chartMax = ticks[ticks.length - 1] || 1

  const x = (i: number): number => PAD.l + (i / Math.max(1, data.length - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number): number => H - PAD.b - (v / chartMax) * (H - PAD.t - PAD.b)
  const clampY = (v: number): number => Math.max(PAD.t, Math.min(H - PAD.b, y(v)))

  /** 面积路径：顶部平滑曲线 + 右侧落底 + 底边闭合。 */
  const areaPath = (top: number[], base: number[]): string => {
    if (data.length === 0) return ''
    const pts = top.map((v, i) => ({ x: x(i), y: clampY(v) }))
    return `${smoothPath(pts)} L ${x(data.length - 1).toFixed(2)} ${y(base[data.length - 1]).toFixed(2)} L ${x(0).toFixed(2)} ${y(base[0]).toFixed(2)} Z`
  }
  const linePath = (top: number[]): string => smoothPath(top.map((v, i) => ({ x: x(i), y: clampY(v) })))

  // X 轴标签密度：约每 70px 一个，保证首尾标签。
  const labelStep = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor((W - PAD.l - PAD.r) / 70))))

  if (data.length === 0) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 }}>暂无数据</div>
  }

  const hoverPoint = hover !== null ? data[hover.index] : undefined
  const hoverTotal = hoverPoint !== undefined ? hoverPoint.input + hoverPoint.output + hoverPoint.cache : 0

  return (
    <div ref={wrapRef} className="dsh-area-chart" style={{ position: 'relative', paddingTop: 16 }}>
      {/* 图例 */}
      <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: 14, pointerEvents: 'none' }}>
        {(['input', 'output', 'cache'] as const).map(k => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[k], flex: 'none' }} />
            {SERIES_NAME[k]}
          </span>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={renderH}>
        <defs>
          {(['input', 'output', 'cache'] as const).map(k => (
            <linearGradient key={k} id={`${gradId}-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[k]} stopOpacity={0.95} />
              <stop offset="100%" stopColor={colors[k]} stopOpacity={0.1} />
            </linearGradient>
          ))}
        </defs>

        {/* Y 轴网格与刻度 */}
        {ticks.map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--dsw-alias-border-l1)" strokeDasharray="4 4" />
            <text x={PAD.l - 8} y={y(v) + 3.5} fontSize={10.5} fill="var(--dsw-alias-label-tertiary)" textAnchor="end">{formatUnits(v)}</text>
          </g>
        ))}
        {/* X 轴基线 */}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--dsw-alias-border-l2)" />

        {/* 堆叠面积：cache 底 → output 中 → input 顶；顶部描边线保证层边界清晰 */}
        <path d={areaPath(topCache, topCache.map(() => 0))} fill={`url(#${gradId}-cache)`} />
        <path d={linePath(topCache)} fill="none" stroke={colors.cache} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <path d={areaPath(topOut, topCache)} fill={`url(#${gradId}-output)`} />
        <path d={linePath(topOut)} fill="none" stroke={colors.output} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <path d={areaPath(topIn, topOut)} fill={`url(#${gradId}-input)`} />
        <path d={linePath(topIn)} fill="none" stroke={colors.input} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* hover 分割线 + 各层数据点 */}
        {hover !== null && (
          <g className="dsh-area-hover">
            <line x1={x(hover.index)} x2={x(hover.index)} y1={PAD.t} y2={H - PAD.b} stroke="var(--dsw-alias-border-l3)" strokeDasharray="3 3" />
            {([['input', topIn], ['output', topOut], ['cache', topCache]] as const).map(([k, top]) => (
              <circle key={k} cx={x(hover.index)} cy={clampY(top[hover.index])} r={4}
                fill="var(--dsw-alias-bg-layer-2)" stroke={colors[k]} strokeWidth={2} />
            ))}
          </g>
        )}

        {/* X 轴标签 */}
        {data.map((d, i) => (i % labelStep === 0 || i === data.length - 1) ? (
          <text key={d.label} x={x(i)} y={H - 8} fontSize={10.5} fill="var(--dsw-alias-label-tertiary)"
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>{axisLabel(d.label)}</text>
        ) : null)}

        {/* 命中区：整块绘图区捕获鼠标，换算 viewBox 坐标 */}
        <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="transparent"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
            const index = Math.min(data.length - 1, Math.round(t * (data.length - 1)))
            setHover({ index, x: e.clientX, y: e.clientY })
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>

      {/* tooltip：跟随鼠标；近视口顶部时翻转到下方；每行「缩写 + 完整数字」。
          必须 portal 到 body：入场动画期间容器带 transform，会成为后代 fixed
          元素的包含块，tooltip 会整体偏移（portal 后定位基准恒为视口）。 */}
      {hover !== null && hoverPoint !== undefined && typeof document !== 'undefined' && createPortal(
        <ChartTooltip x={hover.x} y={hover.y} placement={hover.y < 180 ? 'bottom' : 'top'}>
          <div style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 4 }}>{hoverPoint.label}</div>
          {(['input', 'output', 'cache'] as const).map(k => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 170 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[k], flex: 'none' }} />
              <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{SERIES_NAME[k]}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--dsw-alias-label-primary)', fontFamily: 'ui-monospace, monospace' }}>
                {formatUnits(hoverPoint[k])} <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>({formatExact(hoverPoint[k])})</span>
              </span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--dsw-alias-border-l1)', marginTop: 5, paddingTop: 5, display: 'flex', alignItems: 'center', gap: 8, minWidth: 170 }}>
            <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>合计</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontFamily: 'ui-monospace, monospace' }}>
              {formatUnits(hoverTotal)} <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>({formatExact(hoverTotal)})</span>
            </span>
          </div>
        </ChartTooltip>,
        document.body,
      )}
    </div>
  )
}
