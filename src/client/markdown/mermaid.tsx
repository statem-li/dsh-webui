import { memo, useEffect, useRef, useState } from 'react'
import type { CodeBlockNode } from 'stream-markdown-parser'
import type { NodeComponentProps } from 'markstream-react'

let uid = 0

/** 浅色主题的 mermaid 配色（对齐 DSH 品牌蓝 #4176e6）。 */
const LIGHT_VARS = {
  background: 'transparent',
  primaryColor: '#eef2ff',
  primaryTextColor: '#1f2937',
  primaryBorderColor: '#c7d2fe',
  lineColor: '#64748b',
  secondaryColor: '#f8fafc',
  tertiaryColor: '#f1f5f9',
  edgeLabelBackground: '#ffffff',
  fontSize: '14px',
} as const

/** 深色主题的 mermaid 配色（对齐 DSH 品牌蓝 #679efe）。 */
const DARK_VARS = {
  background: 'transparent',
  primaryColor: '#1e293b',
  primaryTextColor: '#e2e8f0',
  primaryBorderColor: '#475569',
  lineColor: '#94a3b8',
  secondaryColor: '#334155',
  tertiaryColor: '#1e293b',
  edgeLabelBackground: '#0f172a',
  fontSize: '14px',
} as const

/**
 * Mermaid 图表代码块（用 mermaid 作为围栏语言）。
 * 主线程动态加载 mermaid 渲染，深浅主题自适应，失败时降级展示源码与错误。
 */
export const MermaidDiagram = memo(function MermaidDiagram({ node, isDark = false }: NodeComponentProps<CodeBlockNode>) {
  const code = (node.code ?? node.raw ?? '').trim()
  const loading = node.loading === true
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const renderSeq = useRef(0)

  useEffect(() => {
    if (loading || !code) return
    let cancelled = false
    const id = `dsh-mermaid-${Date.now().toString(36)}-${uid++}`
    const seq = renderSeq.current + 1
    renderSeq.current = seq
    setError(null)
    setSvg(null)
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'default',
          fontFamily: 'inherit',
          themeVariables: isDark ? DARK_VARS : LIGHT_VARS,
          flowchart: { htmlLabels: true, curve: 'basis' },
        })
        const result = await mermaid.render(id, code)
        if (!cancelled && renderSeq.current === seq) setSvg(result.svg)
      } catch (err) {
        if (!cancelled && renderSeq.current === seq) {
          setError(String((err as Error)?.message ?? err))
        }
      }
    })()
    return () => { cancelled = true }
  }, [code, isDark, loading])

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
    <figure className="dsh-better-markdown__diagram dsh-better-markdown__mermaid" data-is-dark={isDark || undefined}>
      <figcaption className="dsh-better-markdown__diagram-header">
        <span className="dsh-better-markdown__diagram-title">
          <span className="dsh-better-markdown__diagram-dot" aria-hidden />
          Mermaid
        </span>
        <button type="button" className="dsh-better-markdown__diagram-copy" onClick={copy}>
          {copied ? '已复制' : '复制'}
        </button>
      </figcaption>
      {loading
        ? <div className="dsh-better-markdown__diagram-loading">渲染图表中…</div>
        : error !== null
          ? (
            <div className="dsh-better-markdown__diagram-error">
              <p className="dsh-better-markdown__diagram-error-title">图表渲染失败</p>
              <pre className="dsh-better-markdown__diagram-error-message">{error}</pre>
              <pre className="dsh-better-markdown__diagram-error-source"><code>{code}</code></pre>
            </div>
          )
          : svg !== null
            ? <div className="dsh-better-markdown__diagram-canvas dsh-better-markdown__diagram-svg" role="img" aria-label="Mermaid 图表" dangerouslySetInnerHTML={{ __html: svg }} />
            : <div className="dsh-better-markdown__diagram-loading">渲染图表中…</div>}
    </figure>
  )
})
