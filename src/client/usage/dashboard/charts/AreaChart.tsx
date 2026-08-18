import { useMemo, useState } from 'react'
import { formatCompact } from '../format'
import { ChartTooltip } from './ChartTooltip'

export interface SeriesPoint { label: string; input: number; output: number; cache: number }
export interface AreaChartProps {
  data: SeriesPoint[]
  height?: number
  colors?: { input: string; output: string; cache: string }
}

export function AreaChart({ data, height = 240, colors = { input: 'var(--dsw-alias-brand-primary)', output: 'var(--dsw-alias-state-business-primary)', cache: 'var(--dsw-alias-label-tertiary)' } }: AreaChartProps): JSX.Element {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const W = 800, H = height, PAD = { l: 48, r: 12, t: 12, b: 24 }
  const max = useMemo(() => Math.max(1, ...data.map(d => d.input + d.output + d.cache)), [data])
  const x = (i: number): number => PAD.l + (i / Math.max(1, data.length - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number): number => H - PAD.b - (v / max) * (H - PAD.t - PAD.b)
  const area = (key: 'input' | 'output' | 'cache', base: (i: number) => number): string => {
    let path = `M ${x(0)} ${y(base(0))}`
    for (let i = 1; i < data.length; i++) path += ` L ${x(i)} ${y(base(i))}`
    path += ` L ${x(data.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`
    return path
  }
  const cum = (key: 'input' | 'output' | 'cache'): Array<number> => {
    let acc = 0
    return data.map(d => { acc += d[key]; return acc })
  }
  const outBase = cum('input')
  const cacheBase = cum('input').map((v, i) => v + cum('output')[i])
  if (data.length === 0) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 }}>暂无数据</div>
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={PAD.l} x2={W - PAD.r} y1={y(max * t)} y2={y(max * t)} stroke="var(--dsw-alias-border-l1)" strokeDasharray="3 3" />
        ))}
        <path d={area('cache', i => cacheBase[i] ?? 0)} fill={colors.cache} opacity={0.55} />
        <path d={area('output', i => outBase[i] ?? 0)} fill={colors.output} opacity={0.65} />
        <path d={area('input', i => 0)} fill={colors.input} opacity={0.75} />
        {data.map((d, i) => (
          <rect key={d.label} x={x(i) - 4} y={PAD.t} width={8} height={H - PAD.t - PAD.b} fill="transparent"
            onMouseEnter={(e) => setHover({ index: i, x: e.clientX, y: e.clientY })} />
        ))}
        {hover !== null && (
          <line x1={x(hover.index)} x2={x(hover.index)} y1={PAD.t} y2={H - PAD.b} stroke="var(--dsw-alias-border-l2)" strokeDasharray="3 3" />
        )}
        {data.map((d, i) => i % 5 === 0 ? <text key={d.label} x={x(i)} y={H - 6} fontSize={10} fill="var(--dsw-alias-label-tertiary)" textAnchor="middle">{d.label.slice(5)}</text> : null)}
        {[0.25, 0.5, 0.75, 1].map(t => (
          <text key={t} x={PAD.l - 6} y={y(max * t) + 3} fontSize={10} fill="var(--dsw-alias-label-tertiary)" textAnchor="end">{formatCompact(max * t)}</text>
        ))}
      </svg>
      {hover !== null && data[hover.index] !== undefined && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div><b>{data[hover.index].label}</b></div>
          <div>输入 {formatCompact(data[hover.index].input)} · 输出 {formatCompact(data[hover.index].output)} · 缓存 {formatCompact(data[hover.index].cache)}</div>
          <div>合计 {formatCompact(data[hover.index].input + data[hover.index].output + data[hover.index].cache)}</div>
        </ChartTooltip>
      )}
    </div>
  )
}
