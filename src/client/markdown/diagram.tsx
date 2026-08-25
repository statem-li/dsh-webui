/**
 * webui — mermaid 图表块（client 半身，按需加载）。
 *
 * 设计目标：**不占上下文、不占性能**。
 *  - 不占体积：mermaid 引擎不进 client bundle（tsdown 仍把裸导入 'mermaid' 换成
 *    stub），而是运行时从 host 路由 /dyn-assets/vendor/mermaid.min.js 注入
 *    <script>（预压缩 ~0.95MB，immutable 强缓存）。整个会话没有图表围栏时，
 *    这个请求永远不会发生 —— 零下载、零解析、零内存。
 *  - 不占性能：① 只有围栏收尾（node.loading !== true）才渲染，流式过程中显示
 *    骨架，不会每个 token 重排一次；② 渲染结果按「主题 + 源码」缓存在模块级
 *    Map（LRU 60），滚动回滚 / 主题切回直接命中；③ IntersectionObserver 懒
 *    渲染，滚出视口的图不触发 mermaid.render。
 *  - 不占上下文：模型只写标准 mermaid 围栏，host 侧提示词仅约 100 token。
 *
 * 失败降级：引擎加载失败或语法错误 → 原样展示源码（可复制）+ 一行错误说明，
 * 绝不吞内容。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CodeBlockNode } from 'stream-markdown-parser'

/** 被识别为「图」的围栏语言（mermaid 图种关键字也一并接受）。 */
const DIAGRAM_LANGS = new Set([
  'mermaid', 'flowchart', 'graph', 'sequencediagram', 'statediagram', 'classdiagram',
  'erdiagram', 'gantt', 'journey', 'mindmap', 'timeline', 'quadrantchart',
  'gitgraph', 'sankey', 'xychart', 'block-beta', 'architecture-beta',
])

/**
 * 模块开关（webui-modules 的 diagram 键）：关闭时图表围栏回落成普通代码块，
 * mermaid 资源请求也就永远不会发生。由 client/index.ts 在启动时设定一次。
 */
let enabled = true

/** 设定图表渲染是否启用（模块开关）。 */
export function setDiagramEnabled(value: boolean): void {
  enabled = value
}

/** 某个围栏语言是否走图表渲染。 */
export function isDiagramLang(language: string | undefined): boolean {
  if (!enabled) return false
  if (language === undefined || language === '') return false
  return DIAGRAM_LANGS.has(language.trim().toLowerCase())
}

const ASSET_URL = '/dyn-assets/vendor/mermaid.min.js'

interface MermaidLike {
  initialize(config: Record<string, unknown>): void
  render(id: string, code: string): Promise<{ svg: string }>
}

/** 单例加载 promise：全页最多注入一次 <script>。 */
let loading: Promise<MermaidLike | null> | undefined
/** 当前 initialize 用的主题（切主题需要重新 initialize）。 */
let initializedDark: boolean | undefined

/** 浅色主题配色（对齐 DSH 品牌蓝 deepseek-500）。 */
const LIGHT_VARS = {
  background: 'transparent',
  primaryColor: '#eef2ff',
  primaryTextColor: '#1f2937',
  primaryBorderColor: '#a9bff2',
  lineColor: '#64748b',
  secondaryColor: '#f8fafc',
  tertiaryColor: '#f1f5f9',
  edgeLabelBackground: '#ffffff',
  clusterBkg: '#f8fafc',
  clusterBorder: '#cbd5e1',
  fontSize: '14px',
} as const

/** 深色主题配色（对齐 DSH 品牌蓝 deepseek-400）。 */
const DARK_VARS = {
  background: 'transparent',
  primaryColor: '#1e293b',
  primaryTextColor: '#e2e8f0',
  primaryBorderColor: '#4c6ea8',
  lineColor: '#94a3b8',
  secondaryColor: '#334155',
  tertiaryColor: '#1e293b',
  edgeLabelBackground: '#0f172a',
  clusterBkg: '#1b2431',
  clusterBorder: '#41506a',
  fontSize: '14px',
} as const

/**
 * 注入 <script> 拉 mermaid（UMD 包，挂 globalThis.mermaid）。首次调用才发请求，
 * 重复调用共享同一个 promise；失败返回 null（调用方降级为源码块）。
 */
function loadMermaid(): Promise<MermaidLike | null> {
  if (loading !== undefined) return loading
  loading = new Promise<MermaidLike | null>((resolve) => {
    const existing = (globalThis as Record<string, unknown>).mermaid as MermaidLike | undefined
    if (existing !== undefined && typeof existing.render === 'function') {
      resolve(existing)
      return
    }
    const script = document.createElement('script')
    script.src = ASSET_URL
    script.async = true
    script.onload = () => {
      const mod = (globalThis as Record<string, unknown>).mermaid as MermaidLike | undefined
      resolve(mod !== undefined && typeof mod.render === 'function' ? mod : null)
    }
    script.onerror = () => {
      console.warn('[webui-diagram] mermaid asset failed to load:', ASSET_URL)
      resolve(null)
    }
    document.head.appendChild(script)
  })
  return loading
}

/** 渲染结果缓存（key = 主题 + 源码），LRU 上限 60 张。 */
const svgCache = new Map<string, string>()
const MAX_CACHE = 60

function cacheSet(key: string, svg: string): void {
  if (svgCache.size >= MAX_CACHE) {
    const oldest = svgCache.keys().next().value
    if (oldest !== undefined) svgCache.delete(oldest)
  }
  svgCache.set(key, svg)
}

let seq = 0

/** 图种中文标签（取首个有效行的关键字，用于卡片头部标注）。 */
function diagramKind(code: string): string {
  const first = code.split('\n').map(line => line.trim()).find(line => line !== '' && !line.startsWith('%%'))
  if (first === undefined) return '图表'
  const word = /^[A-Za-z-]+/.exec(first)?.[0] ?? ''
  const map: Record<string, string> = {
    graph: '流程图',
    flowchart: '流程图',
    sequencediagram: '时序图',
    classdiagram: '类图',
    statediagram: '状态图',
    'statediagram-v2': '状态图',
    erdiagram: '实体关系图',
    journey: '用户旅程',
    gantt: '甘特图',
    pie: '饼图',
    mindmap: '思维导图',
    timeline: '时间线',
    quadrantchart: '四象限',
    gitgraph: 'Git 图',
    sankey: '桑基图',
    'block-beta': '块图',
    'architecture-beta': '架构图',
    xychart: '折线图',
  }
  return map[word.toLowerCase()] ?? '图表'
}

type RenderState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'rendering' }
  | { readonly phase: 'done'; readonly svg: string }
  | { readonly phase: 'failed'; readonly message: string }

/**
 * 一张图卡片：懒加载引擎 + 视口内才渲染 + 结果缓存 + 图/源码切换 + 复制 /
 * 导出 SVG / 放大查看。
 */
export const DiagramBlock = memo(function DiagramBlock({ node, isDark = false }: {
  readonly node: CodeBlockNode
  readonly isDark?: boolean | undefined
  /** markstream 会额外透传 mermaidProps（estimatedPreviewHeightPx 等），此处忽略。 */
  readonly [key: string]: unknown
}) {
  const code = (node.code ?? node.raw ?? '').trim()
  const streaming = node.loading === true
  const cacheKey = (isDark ? 'd:' : 'l:') + code
  const cached = svgCache.get(cacheKey)
  const [state, setState] = useState<RenderState>(
    cached === undefined ? { phase: 'idle' } : { phase: 'done', svg: cached },
  )
  const [showSourceMode, setShowSourceMode] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [copied, setCopied] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(cached !== undefined)
  const kind = useMemo(() => diagramKind(code), [code])

  // 视口可见性：滚出屏幕的图不触发渲染（长会话里几十张图不会一起算）。
  useEffect(() => {
    if (visible) return
    const el = hostRef.current
    if (el === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px' })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [visible])

  useEffect(() => {
    const hit = svgCache.get(cacheKey)
    if (hit !== undefined) {
      setState({ phase: 'done', svg: hit })
      return
    }
    if (streaming || code === '' || !visible) return
    let cancelled = false
    setState({ phase: 'rendering' })
    void (async () => {
      const mermaid = await loadMermaid()
      if (cancelled) return
      if (mermaid === null) {
        setState({ phase: 'failed', message: '图表引擎未能加载（已降级为源码）' })
        return
      }
      try {
        if (initializedDark !== isDark) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            // 语法错误不要自绘错误图（我们自己降级成源码 + 一行说明）。
            suppressErrorRendering: true,
            theme: isDark ? 'dark' : 'default',
            fontFamily: 'inherit',
            themeVariables: isDark ? DARK_VARS : LIGHT_VARS,
            flowchart: { htmlLabels: true, curve: 'basis' },
          })
          initializedDark = isDark
        }
        seq += 1
        const id = 'dsh-diagram-' + Date.now().toString(36) + '-' + String(seq)
        try {
          const result = await mermaid.render(id, code)
          if (cancelled) return
          cacheSet(cacheKey, result.svg)
          setState({ phase: 'done', svg: result.svg })
        } finally {
          // 语法错误时 mermaid 会把「Syntax error」占位 SVG 留在 <body> 下的
          // 临时容器 #d<id> 里（实测 11.16：失败路径不自清），必须手动摘除，
          // 否则每张坏图都会在页面底部堆一块错误图。
          document.getElementById('d' + id)?.remove()
        }
      } catch (error: any) {
        if (cancelled) return
        const message = String(error?.message ?? error).split('\n')[0] ?? '语法错误'
        setState({ phase: 'failed', message })
      }
    })()
    return () => { cancelled = true }
  }, [cacheKey, code, isDark, streaming, visible])

  const copy = useCallback(() => {
    const done = (): void => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1500)
    }
    if (navigator.clipboard?.writeText !== undefined) navigator.clipboard.writeText(code).then(done, done)
    else done()
  }, [code])

  // 放大层打开时支持 Esc 关闭（portal 挂在 body 上，键盘焦点不在卡片内也能响应）。
  useEffect(() => {
    if (!zoom) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setZoom(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [zoom])

  const download = useCallback(() => {
    if (state.phase !== 'done') return
    const blob = new Blob([state.svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'diagram-' + Date.now().toString(36) + '.svg'
    anchor.click()
    window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
  }, [state])

  const sourceVisible = showSourceMode || state.phase === 'failed'

  return (
    <figure className="dsh-diagram" data-dark={isDark || undefined} ref={hostRef}>
      <figcaption className="dsh-diagram__head">
        <span className="dsh-diagram__kind">
          <svg className="dsh-diagram__kind-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <rect x="0.75" y="0.75" width="4.5" height="3" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="6.75" y="8.25" width="4.5" height="3" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M3 3.75v3.5h6v1" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
          {kind}
        </span>
        <span className="dsh-diagram__spacer" />
        <button type="button" className="dsh-diagram__act" onClick={copy}>{copied ? '已复制' : '复制'}</button>
        {state.phase === 'done' && (
          <>
            <button type="button" className="dsh-diagram__act" onClick={download}>SVG</button>
            <button
              type="button"
              className="dsh-diagram__act"
              onClick={() => { setShowSourceMode(value => !value) }}
            >
              {sourceVisible ? '看图' : '源码'}
            </button>
            <button type="button" className="dsh-diagram__act" onClick={() => { setZoom(true) }}>放大</button>
          </>
        )}
      </figcaption>
      {streaming && (
        <div className="dsh-diagram__skeleton" aria-label="图表生成中">
          <span className="dsh-diagram__skeleton-bar" />
          <span className="dsh-diagram__skeleton-bar" />
          <span className="dsh-diagram__skeleton-bar" />
        </div>
      )}
      {!streaming && state.phase === 'rendering' && <div className="dsh-diagram__hint">绘制中…</div>}
      {!streaming && state.phase === 'idle' && <div className="dsh-diagram__hint">滚动到此处后绘制</div>}
      {!streaming && state.phase === 'failed' && (
        <div className="dsh-diagram__error">图表未能渲染：{state.message}</div>
      )}
      {!streaming && state.phase === 'done' && !sourceVisible && (
        <div
          className="dsh-diagram__canvas"
          role="img"
          aria-label={kind}
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      )}
      {!streaming && sourceVisible && <pre className="dsh-diagram__source"><code>{code}</code></pre>}
      {/* 放大层必须 createPortal 到 body：消息卡片/玻璃质感容器可能带
          backdrop-filter / transform / contain，任一都会把 position:fixed 的
          遮罩钉进局部坐标系并被 overflow:hidden 裁掉——表现为「点放大没反应」。
          全站弹层惯例同此（见 PerfBenchModal / ModelListEditor 内注释）。 */}
      {zoom && state.phase === 'done' && createPortal(
        <div
          className="dsh-diagram__zoom"
          role="dialog"
          aria-label={kind}
          onClick={() => { setZoom(false) }}
        >
          <div className="dsh-diagram__zoom-inner" dangerouslySetInnerHTML={{ __html: state.svg }} />
        </div>,
        document.body,
      )}
    </figure>
  )
})
