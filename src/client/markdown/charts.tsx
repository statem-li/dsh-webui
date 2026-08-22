import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import {
  BarChart, BoxplotChart, CandlestickChart, CustomChart, EffectScatterChart,
  FunnelChart, GaugeChart, GraphChart, HeatmapChart, LineChart, LinesChart,
  ParallelChart, PictorialBarChart, PieChart, RadarChart, SankeyChart,
  ScatterChart, SunburstChart, ThemeRiverChart, TreeChart, TreemapChart,
} from 'echarts/charts'
import {
  AriaComponent, AxisPointerComponent, BrushComponent, CalendarComponent,
  DataZoomComponent, DatasetComponent, GeoComponent, GraphicComponent,
  GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent,
  MarkPointComponent, ParallelComponent, PolarComponent, SingleAxisComponent,
  TimelineComponent, TitleComponent, ToolboxComponent, TooltipComponent,
  TransformComponent, VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'
import type { CodeBlockNode } from 'stream-markdown-parser'
import type { NodeComponentProps } from 'markstream-react'

echarts.use([
  BarChart, BoxplotChart, CandlestickChart, CustomChart, EffectScatterChart,
  FunnelChart, GaugeChart, GraphChart, HeatmapChart, LineChart, LinesChart,
  ParallelChart, PictorialBarChart, PieChart, RadarChart, SankeyChart,
  ScatterChart, SunburstChart, ThemeRiverChart, TreeChart, TreemapChart,
  AriaComponent, AxisPointerComponent, BrushComponent, CalendarComponent,
  DataZoomComponent, DatasetComponent, GeoComponent, GraphicComponent,
  GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent,
  MarkPointComponent, ParallelComponent, PolarComponent, SingleAxisComponent,
  TimelineComponent, TitleComponent, ToolboxComponent, TooltipComponent,
  TransformComponent, VisualMapComponent,
  CanvasRenderer, SVGRenderer,
])

type EChartsOption = Parameters<EChartsType['setOption']>[0]

/** 浅色主题的图表基础配色（对齐 DSH 品牌蓝 #4176e6）。 */
const LIGHT_THEME = {
  backgroundColor: 'transparent',
  textStyle: { color: '#334155' },
  color: ['#4176e6', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#ec4899', '#3b82f6', '#f97316', '#84cc16'],
} as const

/** 深色主题的图表基础配色（对齐 DSH 品牌蓝 #679efe）。 */
const DARK_THEME = {
  backgroundColor: 'transparent',
  textStyle: { color: '#cbd5e1' },
  color: ['#679efe', '#2dd4bf', '#fbbf24', '#f87171', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#fb923c', '#a3e635'],
} as const

/** 默认图表高度（px），可通过 option 里的 $height 覆盖。 */
const DEFAULT_HEIGHT = 360
const MIN_HEIGHT = 120
const MAX_HEIGHT = 1200

/** 去掉 JSON 里的行注释与块注释标记（保留字符串内的内容）。 */
function stripJsonComments(code: string): string {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i]
    const next = code[i + 1]
    if (inLine) {
      if (ch === '\n') { inLine = false; out += ch }
      continue
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i += 1 }
      continue
    }
    if (inString) {
      out += ch
      if (ch === '\\') { out += next ?? ''; i += 1; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; out += ch; continue }
    if (ch === '/' && next === '/') { inLine = true; i += 1; continue }
    if (ch === '/' && next === '*') { inBlock = true; i += 1; continue }
    out += ch
  }
  return out
}

/** 去掉 JSON 里的尾逗号（对象/数组最后一个元素后的逗号）。 */
function stripTrailingCommas(code: string): string {
  return code.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']')
}

interface ParsedOption {
  option?: Record<string, unknown>
  height?: number
  error?: string
}

/**
 * 解析 ECharts 代码块：严格 JSON → 容错（去注释/尾逗号）。
 * 支持 $height 特殊字段控制图表高度（提取后从 option 中移除）。
 */
function parseOption(code: string): ParsedOption {
  const trimmed = code.trim()
  if (!trimmed) return { error: '空图表配置' }
  let obj: unknown
  try {
    obj = JSON.parse(trimmed)
  } catch {
    try {
      obj = JSON.parse(stripTrailingCommas(stripJsonComments(trimmed)))
    } catch (err) {
      return { error: '配置解析失败：' + (err as Error).message }
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { error: '配置必须是 JSON 对象（{ "series": [...] }）' }
  }
  const record = obj as Record<string, unknown>
  const heightRaw = record.$height
  delete record.$height
  const height = typeof heightRaw === 'number' && Number.isFinite(heightRaw)
    ? Math.min(Math.max(heightRaw, MIN_HEIGHT), MAX_HEIGHT)
    : undefined
  return { option: record, height }
}

/**
 * ECharts 图表代码块（用 echarts 作为围栏语言）。
 * 内容为 ECharts option 的 JSON，支持 $height 指定高度（默认 360px）。
 */
export const EChartsDiagram = memo(function EChartsDiagram({ node, isDark = false }: NodeComponentProps<CodeBlockNode>) {
  const code = (node.code ?? node.raw ?? '').trim()
  const loading = node.loading === true
  const parsed = useMemo(() => parseOption(code), [code])
  const height = parsed.error !== undefined ? 140 : (parsed.height ?? DEFAULT_HEIGHT)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || loading) return
    if (parsed.error !== undefined || parsed.option === undefined) {
      setError(parsed.error ?? null)
      return
    }
    setError(null)
    try {
      const chart = chartRef.current ?? echarts.init(el)
      chartRef.current = chart
      const base = isDark ? DARK_THEME : LIGHT_THEME
      chart.setOption({ ...base, ...parsed.option } as EChartsOption, { notMerge: true })
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    }
  }, [parsed, isDark, loading])

  // 容器尺寸变化时自适应。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const resize = () => { chartRef.current?.resize() }
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(resize)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // 卸载时销毁实例，避免内存泄漏。
  useEffect(() => () => {
    chartRef.current?.dispose()
    chartRef.current = null
  }, [])

  const copy = () => {
    const write = () => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(write, write)
    } else {
      write()
    }
  }

  return (
    <figure className="dsh-better-markdown__diagram dsh-better-markdown__echarts" data-is-dark={isDark || undefined}>
      <figcaption className="dsh-better-markdown__diagram-header">
        <span className="dsh-better-markdown__diagram-title">
          <span className="dsh-better-markdown__diagram-dot" aria-hidden />
          ECharts
        </span>
        <button type="button" className="dsh-better-markdown__diagram-copy" onClick={copy}>
          {copied ? '已复制' : '复制'}
        </button>
      </figcaption>
      {loading
        ? <div className="dsh-better-markdown__diagram-loading" style={{ height }}>渲染图表中…</div>
        : error !== null
          ? (
            <div className="dsh-better-markdown__diagram-error" style={{ minHeight: height }}>
              <p className="dsh-better-markdown__diagram-error-title">图表渲染失败</p>
              <pre className="dsh-better-markdown__diagram-error-message">{error}</pre>
            </div>
          )
          : (
            <div ref={containerRef} className="dsh-better-markdown__diagram-canvas" style={{ height }} role="img" aria-label="ECharts 图表" />
          )}
    </figure>
  )
})
