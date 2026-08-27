import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatExact, formatUnits } from '../format'
import { ChartTooltip } from './ChartTooltip'
import { axisLabel, niceTicks } from './AreaChart'

export interface BarChartProps {
  /** 每个聚合周期一根柱：label（周期键）+ 三段用量。 */
  data: Array<{ label: string; input: number; output: number; cache: number }>
  height?: number
  /** 叠加 N 周期移动均线；数据点数不足窗口时不画。默认 7，传 0 关闭。 */
  movingAverage?: number
  /** 异常日期/周期键集合：柱顶标红点，tooltip 注明倍数。 */
  anomalies?: Map<string, { multiple: number; tokens: number }>
  /** 点击异常日柱的回调（如跳转信号 tab）。 */
  onSelectAnomaly?: (label: string) => void
}

/** 系列展示名与配色（cache 半透明置顶段——缓存降权，突出真实消耗）。 */
const SERIES: Array<{ key: 'input' | 'output' | 'cache'; name: string; color: string }> = [
  { key: 'input', name: '输入', color: 'var(--dsw-alias-state-business-primary)' },
  { key: 'output', name: '输出', color: '#22b8cf' },
  { key: 'cache', name: '缓存读取', color: 'var(--dsw-alias-label-tertiary)' },
]

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const STYLE_ID = 'dsh-usage-bar-chart-styles'

/** 入场动画（受 Workbench 注入的 --dsh-chart-anim 控制；不带 fill-mode，同 AreaChart 的教训）。 */
const ANIM_SHEET = `
@keyframes dsh-bar-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.dsh-bar-chart { animation: var(--dsh-chart-anim, dsh-bar-rise .5s cubic-bezier(.2,.8,.2,1)); }
.dsh-bar-chart .dsh-bar-hover { opacity: 0; transition: opacity .15s ease; }
.dsh-bar-chart:hover .dsh-bar-hover { opacity: 1; }
/* ── 移动端：图例允许换行，tooltip 数值行 min-width 归零（不撑破视口）。
    内联 minWidth 需 !important 压过；本块注释未写出「星号紧跟正斜杠」序列。 ── */
@media (max-width: 767.98px) {
  .dsh-bar-legend { flex-wrap: wrap; gap: 6px; font-size: 10px; }
  .dsh-chart-tip-row { min-width: 0 !important; flex-wrap: wrap; }
}
`

function ensureBarChartStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = ANIM_SHEET
  document.head.appendChild(tag)
}

/**
 * BarChart — 用量趋势主图（方案 A「柱状总览」）。
 *
 * 设计要点：
 *  - 每周期一根堆叠柱：输入（品牌蓝）+ 输出（青）实心在下 = 真实消耗；
 *    缓存读取为半透明段垫在柱顶 —— 缓存命中率高（>90%）时不再压制整个图，
 *    总柱高仍是该期总量，异常日一眼可见；
 *  - 叠加移动均线（细折线，不平滑），单日波动里看真实趋势；
 *  - 异常日柱顶红点 + tooltip 标注中位数倍数，点击可跳信号 tab 下钻当日会话；
 *  - 无平滑、无渐变：审计语义优先精确读数。
 */
export function BarChart({ data, height = 240, movingAverage = 7, anomalies, onSelectAnomaly }: BarChartProps): JSX.Element {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [wrapW, setWrapW] = useState(0)

  useEffect(ensureBarChartStyles, [])
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

  const totals = data.map(d => d.input + d.output + d.cache)
  const maxVal = totals.length > 0 ? Math.max(0, ...totals) : 0
  const ticks = useMemo(() => niceTicks(maxVal || 1), [maxVal])
  const chartMax = ticks[ticks.length - 1] || 1

  // 每格中心 x 与柱宽：格宽 = 绘图区/n，柱占 ~62%（上限 30px），居中。
  const slot = (W - PAD.l - PAD.r) / Math.max(1, data.length)
  const barW = Math.min(30, slot * 0.62)
  const cx = (i: number): number => PAD.l + slot * i + slot / 2

  const y = (v: number): number => H - PAD.b - (v / chartMax) * (H - PAD.t - PAD.b)
  const clampY = (v: number): number => Math.max(PAD.t, Math.min(H - PAD.b, y(v)))

  // 移动均线（对总量）：窗口取 min(movingAverage, n)，点数 < 窗口时不画。
  const maLine = useMemo(() => {
    const win = movingAverage > 0 ? Math.min(movingAverage, data.length) : 0
    if (win < 2 || data.length < win) return null
    const pts = totals.map((_, i) => {
      const start = Math.max(0, i - win + 1)
      let sum = 0
      for (let k = start; k <= i; k++) sum += totals[k]
      return { x: cx(i), y: clampY(sum / (i - start + 1)) }
    })
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, chartMax, movingAverage, W, H])

  // X 轴标签密度：约每 70px 一个，保证首尾标签。
  const labelStep = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor((W - PAD.l - PAD.r) / 70))))

  if (data.length === 0) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 }}>暂无数据</div>
  }

  const hoverPoint = hover !== null ? data[hover.index] : undefined
  const hoverTotal = hover !== null ? totals[hover.index] : 0
  // hover 期 MA 值（与 maLine 同一口径）
  const hoverMa = (() => {
    const win = movingAverage > 0 ? Math.min(movingAverage, data.length) : 0
    if (win < 2 || hover === null || data.length < win) return null
    const start = Math.max(0, hover.index - win + 1)
    let sum = 0
    for (let k = start; k <= hover.index; k++) sum += totals[k]
    return sum / (hover.index - start + 1)
  })()
  const hoverAnomaly = hoverPoint !== undefined && anomalies !== undefined ? anomalies.get(hoverPoint.label) : undefined

  return (
    <div ref={wrapRef} className="dsh-bar-chart" style={{ position: 'relative', paddingTop: 16 }}>
      {/* 图例 */}
      <div className="dsh-bar-legend" style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: 14, pointerEvents: 'none', alignItems: 'center' }}>
        {SERIES.map(s => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}>
            <span style={{
              width: 8, height: 8, borderRadius: 2, flex: 'none',
              background: s.key === 'cache'
                ? 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)'
                : s.color,
              border: s.key === 'cache' ? '1px dashed var(--dsw-alias-border-l3)' : 'none',
            }} />
            {s.name}
          </span>
        ))}
        {maLine !== null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}>
            <span style={{ width: 12, height: 0, borderTop: '2px solid var(--dsw-alias-state-warn-label)', flex: 'none' }} />
            MA{Math.min(movingAverage, data.length)}
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={renderH}>
        {/* Y 轴网格与刻度 */}
        {ticks.map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--dsw-alias-border-l1)" strokeDasharray="4 4" />
            <text x={PAD.l - 8} y={y(v) + 3.5} fontSize={10.5} fill="var(--dsw-alias-label-tertiary)" textAnchor="end">{formatUnits(v)}</text>
          </g>
        ))}
        {/* X 轴基线 */}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--dsw-alias-border-l2)" />

        {/* 堆叠柱：input 底 → output 中 → cache 顶（半透明虚线边，视觉降权） */}
        {data.map((d, i) => {
          const x0 = cx(i) - barW / 2
          const segs = [
            { v: d.input, fill: SERIES[0].color },
            { v: d.output, fill: SERIES[1].color },
            { v: d.cache, fill: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)', dashed: true },
          ]
          let acc = 0
          const isAnomaly = anomalies?.has(d.label) ?? false
          return (
            <g key={d.label}>
              {segs.map((seg, si) => {
                const yTop = clampY(acc + seg.v)
                const yBottom = clampY(acc)
                const h = Math.max(0, yBottom - yTop)
                acc += seg.v
                if (h <= 0) return null
                return (
                  <rect key={si} x={x0} y={yTop} width={barW} height={h} fill={seg.fill}
                    stroke={seg.dashed === true ? 'var(--dsw-alias-border-l3)' : 'none'}
                    strokeWidth={seg.dashed === true ? 0.75 : 0}
                    strokeDasharray={seg.dashed === true ? '2 2' : undefined}
                    rx={si === segs.length - 1 ? 2 : 0} />
                )
              })}
              {/* 异常日：柱顶上方红点（可点击的交互层统一画在命中区之后，见下） */}
              {isAnomaly && (
                <circle cx={cx(i)} cy={clampY(totals[i]) - 7} r={3.5} fill="var(--dsw-alias-state-error-primary)" />
              )}
            </g>
          )
        })}

        {/* 移动均线（琥珀细折线，不平滑） */}
        {maLine !== null && (
          <path d={maLine} fill="none" stroke="var(--dsw-alias-state-warn-label)" strokeWidth={1.75}
            strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
        )}

        {/* hover 列高亮 */}
        {hover !== null && (
          <g className="dsh-bar-hover">
            <rect x={PAD.l + slot * hover.index} y={PAD.t} width={slot} height={H - PAD.t - PAD.b}
              fill="var(--dsw-alias-border-l1)" opacity={0.35} />
            <line x1={cx(hover.index)} x2={cx(hover.index)} y1={PAD.t} y2={H - PAD.b}
              stroke="var(--dsw-alias-border-l3)" strokeDasharray="3 3" />
          </g>
        )}

        {/* X 轴标签 */}
        {data.map((d, i) => (i % labelStep === 0 || i === data.length - 1) ? (
          <text key={d.label} x={cx(i)} y={H - 8} fontSize={10.5} fill="var(--dsw-alias-label-tertiary)"
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>{axisLabel(d.label)}</text>
        ) : null)}

        {/* 命中区：整块绘图区换算列号 */}
        <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="transparent"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
            const index = Math.min(data.length - 1, Math.floor(t * data.length))
            setHover({ index, x: e.clientX, y: e.clientY })
          }}
          onMouseLeave={() => setHover(null)}
        />

        {/* 异常日红点交互层：必须画在命中区之后（DOM 后 = 上层），否则点击被
            命中 rect 拦截。透明大圆扩大点击热区，红点即按钮。 */}
        {anomalies !== undefined && onSelectAnomaly !== undefined && data.map((d, i) => {
          if (!anomalies.has(d.label)) return null
          return (
            <g key={`hit-${d.label}`} onClick={() => onSelectAnomaly(d.label)} style={{ cursor: 'pointer' }}>
              <title>{`查看 ${d.label} 的会话（异常日 ${multipleText(anomalies.get(d.label)?.multiple)}）`}</title>
              <circle cx={cx(i)} cy={clampY(totals[i]) - 7} r={10} fill="transparent" />
            </g>
          )
        })}
      </svg>

      {/* tooltip：portal 到 body（入场动画期间容器带 transform，fixed 定位基准问题同 AreaChart） */}
      {hover !== null && hoverPoint !== undefined && typeof document !== 'undefined' && createPortal(
        <ChartTooltip x={hover.x} y={hover.y} placement={hover.y < 180 ? 'bottom' : 'top'}>
          <div style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 4 }}>
            {hoverPoint.label}
            {anomalies?.has(hoverPoint.label) && (
              <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 500, color: 'var(--dsw-alias-state-error-primary)' }}>
                异常日 {multipleText(anomalies.get(hoverPoint.label)?.multiple)}
              </span>
            )}
          </div>
          {[...SERIES].reverse().map(s => (
            <div key={s.key} className="dsh-chart-tip-row" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
              <span style={{
                width: 8, height: 8, borderRadius: 2, flex: 'none',
                background: s.key === 'cache'
                  ? 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)'
                  : s.color,
                border: s.key === 'cache' ? '1px dashed var(--dsw-alias-border-l3)' : 'none',
              }} />
              <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{s.name}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--dsw-alias-label-primary)', fontFamily: MONO }}>
                {formatUnits(hoverPoint[s.key])} <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>({formatExact(hoverPoint[s.key])})</span>
              </span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--dsw-alias-border-l1)', marginTop: 5, paddingTop: 5, display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
            <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>合计</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontFamily: MONO }}>
              {formatUnits(hoverTotal)} <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>({formatExact(hoverTotal)})</span>
            </span>
          </div>
          {hoverMa !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180, marginTop: 2 }}>
              <span style={{ width: 12, height: 0, borderTop: '2px solid var(--dsw-alias-state-warn-label)', flex: 'none' }} />
              <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>MA{Math.min(movingAverage, data.length)}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--dsw-alias-label-primary)', fontFamily: MONO }}>{formatUnits(hoverMa)}</span>
            </div>
          )}
          {hoverAnomaly !== undefined && onSelectAnomaly !== undefined && (
            <div style={{ marginTop: 5, fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-state-error-primary)' }}>
              点击柱顶红点查看该日会话
            </div>
          )}
        </ChartTooltip>,
        document.body,
      )}
    </div>
  )
}

/** 倍数文本（tooltip 内联用）。 */
function multipleText(value: number | undefined): string {
  if (value === undefined || !isFinite(value)) return ''
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}x`
}
