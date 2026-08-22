/**
 * webui — PlanWeave 使用说明模态（client 半身）。
 *
 * 从视口中心缩放滑出的说明书（分节 + SVG 流程图）。滑入：淡入 + 下移上浮 +
 * 缩放到位；滑出反向播放完毕才卸载（useModalClose 同款节奏）。portal 到
 * document.body 并把层级压在设置弹窗（z-1000）之上；Esc 在捕获阶段拦截，
 * 避免连带关闭底层设置弹窗。
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

const STYLE_ID = 'dsh-webui-planweave-help-styles'

const SHEET = `
/* 入口小圆钮：钉在 PlanWeave 设置卡右上角（chevron 左侧）。 */
.ase-card.pw-has-help{position:relative}
.pw-hlp-entry{position:absolute;top:13px;right:40px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:none;border-radius:50%;background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.14));color:var(--dsw-alias-label-secondary,#aab);font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;z-index:1;transition:background 120ms ease,color 120ms ease,transform 120ms ease}
.pw-hlp-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.12));color:var(--dsw-alias-label-primary,#eee);transform:scale(1.08)}

/* 模态：中心滑入/滑出。 */
@keyframes pwHlpMaskIn{from{opacity:0}to{opacity:1}}
@keyframes pwHlpMaskOut{from{opacity:1}to{opacity:0}}
@keyframes pwHlpCardIn{from{opacity:0;transform:translate(-50%,-42%) scale(.93)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes pwHlpCardOut{from{opacity:1;transform:translate(-50%,-50%) scale(1)}to{opacity:0;transform:translate(-50%,-44%) scale(.95)}}
.pw-hlp-mask{position:fixed;inset:0;z-index:1180;background:rgba(8,10,14,.55);animation:pwHlpMaskIn .2s ease both}
.pw-hlp-mask[data-anim='out']{animation:pwHlpMaskOut .18s ease both}
.pw-hlp-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1181;width:min(860px,94vw);max-height:min(84vh,860px);display:flex;flex-direction:column;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#1c1f26);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));box-shadow:0 24px 64px rgba(0,0,0,.45);animation:pwHlpCardIn .26s cubic-bezier(.22,1,.36,1) both}
.pw-hlp-card[data-anim='out']{animation:pwHlpCardOut .2s ease-in both}
.pw-hlp-head{flex:none;display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.pw-hlp-title{font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary,#eee)}
.pw-hlp-sub{font-size:12px;color:var(--dsw-alias-label-tertiary,#99a)}
.pw-hlp-close{margin-left:auto;width:30px;height:30px;border:none;border-radius:8px;background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary,#aab);font-size:16px;line-height:1;font-family:inherit;cursor:pointer;transition:background 120ms ease,color 120ms ease}
.pw-hlp-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.1));color:var(--dsw-alias-label-primary,#eee)}
.pw-hlp-body{overflow:auto;padding:18px 22px 22px;color:var(--dsw-alias-label-primary,#ddd)}
.pw-hlp-body h3{margin:18px 0 8px;font-size:13.5px;color:var(--dsw-alias-label-primary,#eee)}
.pw-hlp-body h3:first-child{margin-top:0}
.pw-hlp-body p{margin:0 0 8px;font-size:13px;line-height:1.75;color:var(--dsw-alias-label-secondary,#bcc1ca)}
.pw-hlp-body code{padding:1px 6px;border-radius:5px;background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.12));font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:var(--dsw-alias-label-primary,#e8eaee)}
.pw-hlp-flow{width:100%;border-radius:12px;border:1px solid var(--dsw-alias-stroke-subtle,rgba(127,127,127,.18));background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.05));margin:4px 0 2px}
.pw-hlp-steps{margin:0;padding-left:20px;font-size:13px;line-height:1.9;color:var(--dsw-alias-label-secondary,#bcc1ca)}
.pw-hlp-steps b{color:var(--dsw-alias-label-primary,#eee)}
.pw-hlp-tools{width:100%;border-collapse:collapse;font-size:12.5px}
.pw-hlp-tools td{padding:7px 10px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.15));vertical-align:top}
.pw-hlp-tools tr:first-child td{border-top:none}
.pw-hlp-tools code{white-space:nowrap}
.pw-hlp-tools td:last-child{color:var(--dsw-alias-label-secondary,#a8adb7)}
.pw-hlp-note{margin-top:14px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.07));font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary,#a8adb7)}
`

function ensureHelpStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 主链流程图：创建 → 认领 → 执行 → 提交 → 评审门（passed ↓ 完成；needs_changes 虚线回环）。 */
function FlowChart(): JSX.Element {
  const nodes = [
    { x: 20, title: '创建计划', sub: '播种 / init' },
    { x: 196, title: '认领块', sub: '就绪优先' },
    { x: 372, title: '执行', sub: 'subagent · llm' },
    { x: 548, title: '提交产物', sub: '幂等落盘' },
    { x: 724, title: '评审门', sub: 'review' },
  ]
  const W = 148
  const H = 54
  const rowY = 28
  const doneY = 138
  return (
    <svg className="pw-hlp-flow" viewBox="0 0 892 208" role="img" aria-label="PlanWeave 执行闭环流程图">
      <defs>
        <marker id="pw-hlp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--dsw-alias-label-tertiary,#889)" />
        </marker>
        <marker id="pw-hlp-arrow-warn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#e8a33d" />
        </marker>
        <marker id="pw-hlp-arrow-ok" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#59b978" />
        </marker>
      </defs>
      {/* 主链边 */}
      {[0, 1, 2, 3].map(i => (
        <line
          key={i}
          x1={nodes[i]!.x + W} y1={rowY + H / 2}
          x2={nodes[i + 1]!.x - 6} y2={rowY + H / 2}
          stroke="var(--dsw-alias-label-tertiary,#889)" strokeWidth="1.6" markerEnd="url(#pw-hlp-arrow)"
        />
      ))}
      {/* needs_changes 回环：评审门底部 → 执行节点底部（虚线琥珀色） */}
      <path
        d={`M ${String(nodes[4]!.x + 34)} ${String(rowY + H)} C ${String(nodes[4]!.x + 34)} ${String(rowY + H + 34)}, ${String(nodes[2]!.x + W / 2)} ${String(rowY + H + 34)}, ${String(nodes[2]!.x + W / 2)} ${String(rowY + H + 6)}`}
        fill="none" stroke="#e8a33d" strokeWidth="1.6" strokeDasharray="6 5" markerEnd="url(#pw-hlp-arrow-warn)"
      />
      <text x={String((nodes[2]!.x + nodes[4]!.x) / 2 + 40)} y={String(rowY + H + 32)} textAnchor="middle" fontSize="11.5" fill="#e8a33d">needs_changes · 反馈修复后重审</text>
      {/* passed：评审门 → 完成 */}
      <line
        x1={nodes[4]!.x + W - 34} y1={rowY + H} x2={nodes[4]!.x + W - 34} y2={doneY - 6}
        stroke="#59b978" strokeWidth="1.6" markerEnd="url(#pw-hlp-arrow-ok)"
      />
      <text x={String(nodes[4]!.x + W - 26)} y={String(rowY + H + 30)} fontSize="11.5" fill="#59b978">passed</text>
      {/* 节点 */}
      {nodes.map(n => (
        <g key={n.title}>
          <rect x={n.x} y={rowY} width={W} height={H} rx={10} fill="var(--dsw-alias-bg-layer-3,#23262e)" stroke="var(--dsw-alias-stroke-strong,rgba(140,146,158,.5))" />
          <text x={n.x + W / 2} y={rowY + 23} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--dsw-alias-label-primary,#e8eaee)">{n.title}</text>
          <text x={n.x + W / 2} y={rowY + 41} textAnchor="middle" fontSize="10.5" fill="var(--dsw-alias-label-tertiary,#98a0ac)">{n.sub}</text>
        </g>
      ))}
      {/* 完成节点 */}
      <g>
        <rect x={nodes[4]!.x} y={doneY} width={W} height={44} rx={10} fill="rgba(89,185,120,.14)" stroke="#59b978" />
        <text x={nodes[4]!.x + W / 2} y={doneY + 27} textAnchor="middle" fontSize="13" fontWeight="600" fill="#59b978">✔ 任务完成</text>
      </g>
    </svg>
  )
}

/** 说明模态属性。 */
export interface HelpModalProps {
  open: boolean
  closing: boolean
  onClose: () => void
}

/** 居中滑出的使用说明模态（portal 至 body；open=false 且 out 动画播完后由父级卸载）。 */
export function HelpModal({ open, closing, onClose }: HelpModalProps): JSX.Element | null {
  ensureHelpStyles()
  useEffect(() => {
    if (!open || closing) return undefined
    // 捕获阶段拦 Esc：只关本模态，不穿透到底下的设置弹窗。
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [open, closing, onClose])
  if (!open) return null
  return createPortal(
    <>
      <div className="pw-hlp-mask" data-anim={closing ? 'out' : 'in'} aria-hidden="true" onClick={onClose} />
      <div className="pw-hlp-card" data-anim={closing ? 'out' : 'in'} role="dialog" aria-modal="true" aria-label="PlanWeave 使用说明">
        <div className="pw-hlp-head">
          <div>
            <div className="pw-hlp-title">PlanWeave 使用说明</div>
            <div className="pw-hlp-sub">把模糊目标变成任务图，AI 自动执行 · 评审 · 修复直到通过</div>
          </div>
          <button type="button" className="pw-hlp-close" aria-label="关闭使用说明" onClick={onClose}>×</button>
        </div>
        <div className="pw-hlp-body">
          <h3>它是怎么运转的</h3>
          <FlowChart />
          <p>
            一个计划由多个<b>任务</b>组成，每个任务拆成<b>实现块</b>与可选的<b>评审块</b>；
            依赖满足的块才能被认领，评审不通过会自动生成反馈让实现块返工，直到
            <b style={{ color: '#59b978' }}> 通过</b> 或达到最大循环次数。全程产物落盘、断点可续。
          </p>
          <h3>三步上手</h3>
          <ol className="pw-hlp-steps">
            <li><b>选执行模型</b>：在本卡片的「执行 Provider / Model」下拉里选择并保存——面板「推进」用它；对话内的 <code>planweave_run</code> 走 DSH subagent（完整 agent），不受此项限制。</li>
            <li><b>准备计划</b>：侧边栏打开 PlanWeave 面板，空态点「播种示例计划」体验；真实项目可在对话里让 AI 用 <code>planweave_init</code> 创建，或用 <code>plan-maker</code> 技能从模糊目标生成。</li>
            <li><b>推进闭环</b>：面板点「推进 1 步 / 5 步」逐步跑；或在对话里说「用 planweave_run 推进计划」自动认领-执行-评审直到完成。「历史」页可查每次执行/评审/反馈产物。</li>
          </ol>
          <h3>对话工具速查</h3>
          <table className="pw-hlp-tools">
            <tbody>
              <tr><td><code>planweave_init</code></td><td>初始化/打开一个计划项目（幂等）</td></tr>
              <tr><td><code>planweave_status</code></td><td>查看任务/块状态与可认领项</td></tr>
              <tr><td><code>planweave_run</code></td><td>推进若干步：认领 → subagent 执行 → 提交 → 评审 → 反馈</td></tr>
              <tr><td><code>planweave_install_skills</code></td><td>安装 plan-maker/coordinator/runner 等 7 个技能到 DSH 技能目录</td></tr>
            </tbody>
          </table>
          <div className="pw-hlp-note">
            数据全部本地留存于 <code>~/.dsh/planweave/</code>（<code>state.json</code> 为实时状态，
            <code> results/</code> 为全部执行产物），随时可查可删；状态异常时对话里说
            「用 doctor 检查修复 PlanWeave」即可自愈。
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
