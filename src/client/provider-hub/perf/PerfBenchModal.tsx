/**
 * PerfBenchModal — 供应商推理性能基准测试弹窗。
 *
 * 交互：供应商行点「测试」→ 居中卡片淡入（opacity + scale）；选模型 → 开始；
 * 测试运行时卡片平滑扩大（width/height transition），阶段进度实时刷新；
 * 完成后展示五项指标结果表（原始样本 + avg/P50/P95/min/max）。
 * 关闭时先淡出再卸载。测试在 host 后台继续，关掉弹窗再点「测试」可恢复视图。
 *
 * 注意：必须 createPortal 到 body —— 设置面板本体带 backdrop-filter（玻璃
 * 质感），fixed 后代会相对面板而非视口定位（dsh-webui 玻璃铁律）。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface StageSnapshot {
  key: string
  name: string
  unit: string
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'
  note: string
  samples: number[]
  estimated: boolean
}
interface BenchStateShape {
  running: boolean
  provider: string
  model: string
  startedAt: number
  finishedAt: number | null
  error: string
  stages: StageSnapshot[]
  elapsedMs: number
  summaries: Record<string, { avg: number; p50: number; p95: number; min: number; max: number }>
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1200,
  background: 'rgba(0,0,0,0.32)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  opacity: 0, transition: 'opacity 260ms ease',
}
/* 玻璃卡：backdrop-filter 只直加浮层本体（dsh-webui 玻璃铁律）；本卡经
 * createPortal 挂 body、内部无 fixed 后代，不会被钉进局部坐标系。
 * 底色用 color-mix 半透明的 bg-layer-1 —— 浅色下透白纱、深色下透深纱，
 * 文字对比度由 72% 不透明度兜底，随主题自动切换。 */
const CARD_BASE: React.CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex', flexDirection: 'column',
  borderRadius: 14,
  background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 72%, transparent)',
  backdropFilter: 'blur(24px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
  overflow: 'hidden',
}
const TITLE: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const HINT: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }
const SELECT: React.CSSProperties = {
  boxSizing: 'border-box', height: 32, padding: '0 32px 0 10px',
  borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\'%3E%3Cpath d=\'M3 4.5L6 7.5L9 4.5\' stroke=\'%2381858C\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '12px 12px',
  appearance: 'none', color: 'var(--dsw-alias-label-primary)', fontSize: 14, cursor: 'pointer',
}
const PRIMARY_BTN: React.CSSProperties = {
  height: 34, padding: '0 16px', borderRadius: 17, border: 'none',
  background: 'var(--dsw-alias-state-business-primary, #4176e6)',
  color: '#fff', fontSize: 13, cursor: 'pointer', flex: 'none',
}
const GHOST_BTN: React.CSSProperties = {
  height: 30, padding: '0 14px', borderRadius: 15,
  border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)', fontSize: 12, cursor: 'pointer', flex: 'none',
}

/** 阶段状态徽标。 */
function StageDot({ status }: { status: StageSnapshot['status'] }): React.ReactElement {
  const map: Record<StageSnapshot['status'], { bg: string; text: string }> = {
    pending: { bg: 'transparent', text: '·' },
    running: { bg: 'var(--dsw-alias-state-business-primary, #4176e6)', text: '…' },
    done: { bg: 'var(--dsw-alias-state-success-primary, #00b42a)', text: '✓' },
    skipped: { bg: 'var(--dsw-alias-border-l3, #c9cdd4)', text: '—' },
    failed: { bg: 'var(--dsw-alias-state-error-primary, #d54941)', text: '×' },
  }
  const s = map[status]
  return (
    <span style={{
      width: 16, height: 16, borderRadius: '50%', flex: 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, lineHeight: '16px',
      background: s.bg,
      border: status === 'pending' ? '1px solid var(--dsw-alias-border-l3, #c9cdd4)' : 'none',
      color: status === 'pending' ? 'var(--dsw-alias-label-tertiary)' : '#fff',
    }}>{s.text}</span>
  )
}

export function PerfBenchModal({ provider, models, onClose }: {
  provider: string
  models: Array<{ id: string; name?: string }>
  onClose: () => void
}): React.ReactElement | null {
  const [fade, setFade] = useState(0)
  const [expand, setExpand] = useState(0)
  const [modelId, setModelId] = useState(models[0]?.id ?? '')
  const [phase, setPhase] = useState<'select' | 'running' | 'done' | 'error'>('select')
  const [state, setState] = useState<BenchStateShape | null>(null)
  const [error, setError] = useState('')
  const pollRef = useRef<number | null>(null)

  // 动画全部用 setInterval 步进 React 状态（内联样式直出），不用 CSS transition /
  // requestAnimationFrame —— 屏外/最小化窗口的合成器与 rAF 可能冻结，CSS 过渡
  // 会卡在起始帧不动（dsh-webui 调试铁律）。步进在任何环境都可靠且足够平滑。
  useEffect(() => {
    const iv = window.setInterval(() => {
      setFade(f => { if (f >= 1) { window.clearInterval(iv); return 1 } return Math.min(1, f + 0.18) })
    }, 36)
    return () => window.clearInterval(iv)
  }, [])
  // 展开动画：进入 running/done 视图时卡片从 440×250 平滑长到 820×620。
  useEffect(() => {
    if (phase !== 'running' && phase !== 'done') return
    const iv = window.setInterval(() => {
      setExpand(e => { if (e >= 1) { window.clearInterval(iv); return 1 } return Math.min(1, e + 0.12) })
    }, 40)
    return () => window.clearInterval(iv)
  }, [phase])

  // 挂载时恢复可能仍在后台跑的测试——仅限同一供应商：全局单例是跨供应商
  // 共享的，切到别家打开应停留在「选择模型」初始卡，而不是别人家的进度/报告。
  useEffect(() => {
    fetch('/api/perf-bench', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: any) => {
        if (!d?.ok || !d.state || d.state.provider !== provider) return
        if (d.state.running) {
          setState(d.state)
          setModelId(d.state.model)
          setPhase('running')
        } else if (Date.now() - (d.state.finishedAt ?? 0) < 60_000) {
          setState(d.state)
          setModelId(d.state.model)
          setPhase('done')
        }
      })
      .catch(() => { /* 无状态则停在 select */ })
    return () => { if (pollRef.current !== null) window.clearInterval(pollRef.current) }
  }, [provider])

  const pollOnce = async (): Promise<void> => {
    try {
      const r = await fetch('/api/perf-bench', { cache: 'no-store' })
      const d: any = await r.json()
      if (!d?.ok || !d.state) return
      setState(d.state)
      if (!d.state.running) {
        setPhase(d.state.error ? 'error' : 'done')
        if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null }
      }
    } catch { /* 轮询失败下次再试 */ }
  }

  const start = (): void => {
    if (!modelId) return
    setError('')
    fetch('/api/perf-bench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model: modelId }),
    })
      .then((r) => r.json())
      .then((d: any) => {
        if (!d?.ok) { setError(d?.error || '启动失败'); return }
        setPhase('running')
        if (pollRef.current === null) pollRef.current = window.setInterval(() => { void pollOnce() }, 900)
        void pollOnce()
      })
      .catch((e) => setError(String(e?.message ?? e)))
  }

  const close = (): void => {
    // 淡出后再卸载（步进到 0，不依赖 CSS transition）。
    const iv = window.setInterval(() => {
      setFade(f => {
        if (f <= 0) { window.clearInterval(iv); onClose(); return 0 }
        return Math.max(0, f - 0.25)
      })
    }, 30)
  }

  const cardStyle: React.CSSProperties = {
    ...CARD_BASE,
    width: Math.round(440 + 380 * expand),
    height: Math.round(250 + 370 * expand),
    opacity: fade,
    transform: `scale(${(0.92 + 0.08 * fade).toFixed(3)}) translateY(${Math.round(8 * (1 - fade))}px)`,
  }

  return createPortal(
    <div style={{ ...OVERLAY, opacity: fade }} onClick={close}>
      <div style={cardStyle} onClick={(e) => { e.stopPropagation() }}>
        {/* 头部 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px 10px', borderBottom: '1px solid var(--dsw-alias-border-l2, #dcdfe6)', flex: 'none' }}>
          <span style={TITLE}>推理性能基准测试</span>
          <span style={HINT}>{provider}/{phase === 'select' ? '' : state?.model ?? modelId}</span>
          <button type="button" style={{ ...GHOST_BTN, marginLeft: 'auto' }} onClick={close}>关闭</button>
        </div>

        {/* 内容区：小卡片时只露选择面，展开后显示进度/报告 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {phase === 'select'
            ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>选择模型</span>
                  <select style={SELECT} value={modelId} onChange={(e) => { setModelId(e.target.value) }}>
                    {models.length === 0 ? <option value="">（该供应商没有已配置的模型）</option> : null}
                    {models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                  </select>
                </div>
                <p style={HINT}>
                  固定条件：temperature=0 · 流式 · 单请求超时 45s · 总预算 170s（超时自动跳过剩余阶段）。
                  指标：TTFT（首字）×5 · TPS/E2E（256 输出）×3 · 预填充（~1400 字输入）×3 · RPS（并发 4×8 请求）。
                </p>
                {error !== '' && <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #d54941)' }}>{error}</p>}
                <div>
                  <button type="button" style={PRIMARY_BTN} disabled={!modelId} onClick={start}>开始测试</button>
                </div>
              </>
            )
            : null}

          {(phase === 'running' || phase === 'done' || phase === 'error') && state !== null
            ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>
                    {state.running ? `测试中… ${(state.elapsedMs / 1000).toFixed(0)}s / 预算 170s` : phase === 'error' ? '测试失败' : `完成，用时 ${(state.elapsedMs / 1000).toFixed(1)}s`}
                  </span>
                </div>
                {state.error !== ''
                  ? <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #d54941)' }}>{state.error}</p>
                  : null}

                {/* 阶段进度 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {state.stages.map(s => (
                    <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <StageDot status={s.status} />
                      <span style={{ fontSize: 13, color: 'var(--dsw-alias-label-primary)', minWidth: 128 }}>{s.name}</span>
                      <span style={HINT}>{s.status === 'running' ? `${s.samples.length} 次采样…` : s.note}</span>
                    </div>
                  ))}
                </div>

                {/* 结果表 */}
                {phase === 'done'
                  ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          {['指标', '单位', 'avg', 'P50', 'P95', 'min', 'max'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2, #dcdfe6)', color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {state.stages.filter(s => s.samples.length > 0).map(s => {
                          const sum = state.summaries[s.key]
                          if (!sum) return null
                          const fmt = (n: number): string => n >= 100 ? String(Math.round(n)) : String(Math.round(n * 100) / 100)
                          return (
                            <tr key={s.key}>
                              <td style={{ padding: '6px 8px', color: 'var(--dsw-alias-label-primary)' }}>
                                {s.name}{s.estimated ? <sup style={{ color: 'var(--dsw-alias-label-tertiary)' }}>（估）</sup> : null}
                              </td>
                              <td style={{ padding: '6px 8px', color: 'var(--dsw-alias-label-tertiary)' }}>{s.unit}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--dsw-alias-label-primary)', fontWeight: 600 }}>{fmt(sum.avg)}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--dsw-alias-label-primary)' }}>{fmt(sum.p50)}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--dsw-alias-label-primary)' }}>{fmt(sum.p95)}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--dsw-alias-label-tertiary)' }}>{fmt(sum.min)}</td>
                              <td style={{ padding: '6px 8px', color: 'var(--dsw-alias-label-tertiary)' }}>{fmt(sum.max)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )
                  : null}
                {phase === 'done'
                  ? <p style={HINT}>口径：TTFT 含推理链首个增量；TPS = completion_tokens ÷ 解码时长（usage 缺失按 chunk 计数并标注「估」）；预填充速度 = prompt_tokens ÷ 长 prompt TTFT；RPS 为非流式短请求 wall-clock。数据为单机单网关实测，受网络波动影响。</p>
                  : null}

                {phase === 'running'
                  ? <p style={HINT}>可以关闭此窗口，测试将在后台继续；重新点击「测试」可回到本视图。</p>
                  : null}
                {(phase === 'done' || phase === 'error')
                  ? (
                    <div>
                      <button type="button" style={GHOST_BTN} onClick={() => { setPhase('select'); setExpand(0); setState(null) }}>再测一次</button>
                    </div>
                  )
                  : null}
              </>
            )
            : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
