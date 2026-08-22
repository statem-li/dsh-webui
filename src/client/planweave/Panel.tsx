/**
 * webui — PlanWeave 工作台（client 半身）：
 * 侧边栏导航行（planweave 槽位）→ 点击打开**与会话区等量级的大工作台**
 * （中心缩放滑入动效）。布局：左侧视图区（任务图 | 块列表 | 历史 | 任务详情），
 * 右侧操作栏（进度 KPI、推进/播种/删除、运行消息）。
 *
 * 数据全部走 host 的 /api/planweave/*（纯 fetch）；打开时轮询刷新（5s），
 * 推进中暂停轮询。说明书（?）从中心滑出，层级高于本工作台。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  createPlanweaveApi,
  type PwBlockView,
  type PwGraphNode,
  type PwRecord,
  type PwAutoRunSnapshot,
  type PwProjectSummary,
  type PlanweaveApi,
  type StatusResult,
  type PwGraphView,
  type EditOp,
  type DoctorResult,
  type SearchItem,
  type QualityDiag,
  type QualityResult,
} from './api.js'
import { ensureNavStyles, NavButton, NavPortal, useRail } from '../sidebar-nav.js'
import { ensureModalAnimStyles, useModalClose } from '../modal-animation.js'
import { ensureShellStyles } from '../popover-shell.js'
import { HelpModal } from './HelpModal.js'

const STYLE_ID = 'dsh-webui-planweave-styles'

const SHEET = `
/* ── 大工作台壳：与会话区等量级，中心缩放滑入 ── */
@keyframes pwWbMaskIn{from{opacity:0}to{opacity:1}}
@keyframes pwWbMaskOut{from{opacity:1}to{opacity:0}}
@keyframes pwWbIn{from{opacity:0;transform:translate(-50%,-46.5%) scale(.965)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes pwWbOut{from{opacity:1;transform:translate(-50%,-50%) scale(1)}to{opacity:0;transform:translate(-50%,-47%) scale(.97)}}
.pw-wb-mask{position:fixed;inset:0;z-index:940;background:rgba(8,10,14,.52);animation:pwWbMaskIn .22s ease both}
.pw-wb-mask[data-anim='out']{animation:pwWbMaskOut .18s ease both}
.pw-wb{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:941;width:min(1400px,95vw);height:min(92vh,1020px);display:flex;flex-direction:column;border-radius:16px;background:var(--dsw-alias-bg-layer-2,#1c1f26);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));box-shadow:0 28px 80px rgba(0,0,0,.5);overflow:hidden;animation:pwWbIn .28s cubic-bezier(.22,1,.36,1) both}
.pw-wb[data-anim='out']{animation:pwWbOut .2s ease-in both}
.pw-wb-head{flex:none;display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.pw-wb-title{font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary,#eee)}
.pw-proj-select{max-width:200px;padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:var(--dsw-alias-bg-layer-3,#23262e);color:var(--dsw-alias-label-primary,#e8eaee);font-size:12.5px;font-family:inherit;cursor:pointer}
.pw-wb-project{font-size:12.5px;color:var(--dsw-alias-label-tertiary,#98a0ac)}
.pw-wb-spacer{flex:1}
.pw-wb-roundbtn{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:none;border-radius:50%;background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.14));color:var(--dsw-alias-label-secondary,#aab);font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:background 120ms ease,color 120ms ease,transform 120ms ease}
.pw-wb-roundbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.12));color:var(--dsw-alias-label-primary,#eee);transform:scale(1.06)}
/* ── 主体两栏 ── */
.pw-wb-main{flex:1;display:flex;min-height:0}
.pw-wb-view{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;padding:16px 20px;min-height:0}
.pw-wb-side{flex:none;width:292px;border-left:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));padding:16px;display:flex;flex-direction:column;gap:14px;overflow:auto}
/* 左侧视图填充剩余高度（大空间下去掉小抽屉的 46vh 上限） */
.pw-wb-view .pw-scroll,.pw-wb-view .pw-graph-wrap,.pw-wb-view .pw-detail{flex:1;min-height:200px;max-height:none}
.pw-tabs{display:flex;gap:4px;background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.08));border-radius:8px;padding:3px;width:max-content}
.pw-tab{padding:5px 14px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font-size:12.5px;font-family:inherit;cursor:pointer}
.pw-tab[data-active='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.1));color:var(--dsw-alias-label-primary,#eee)}
.pw-progress{display:flex;gap:8px}
.pw-wb-side .pw-progress{flex-direction:column}
.pw-kpi{flex:1;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.08))}
.pw-kpi b{display:block;font-size:20px;line-height:26px;color:var(--dsw-alias-label-primary,#eee)}
.pw-kpi span{font-size:12px;color:var(--dsw-alias-label-secondary,#aaa)}
.pw-scroll{flex:1;min-height:160px;max-height:46vh;overflow:auto;border-radius:10px;border:1px solid var(--dsw-alias-stroke-subtle,rgba(127,127,127,.2));padding:4px}
.pw-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;font-size:13px;color:var(--dsw-alias-label-primary,#ddd);font-family:ui-monospace,SFMono-Regular,monospace;cursor:default}
.pw-row[data-clickable='true']{cursor:pointer}
.pw-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}
.pw-dot{flex:none;width:8px;height:8px;border-radius:50%}
.pw-row .pw-ref{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pw-row .pw-kind{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
/* 任务图 */
.pw-graph-wrap{flex:1;min-height:180px;max-height:46vh;overflow:auto;border-radius:10px;border:1px solid var(--dsw-alias-stroke-subtle,rgba(127,127,127,.2));background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.04))}
.pw-edge{fill:none;stroke:var(--dsw-alias-stroke-strong,rgba(140,146,158,.55));stroke-width:1.5}
.pw-node rect{fill:var(--dsw-alias-surface-primary,rgba(30,33,40,.92));stroke-width:1.5;transition:stroke 120ms ease}
.pw-node:hover rect{stroke-width:2.5}
.pw-node .pw-n-title{fill:var(--dsw-alias-label-primary,#e8eaee);font-size:12px;font-weight:600;font-family:inherit}
.pw-node .pw-n-status{fill:var(--dsw-alias-label-secondary,#9aa0aa);font-size:10.5px;font-family:inherit}
/* 操作与消息 */
.pw-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pw-btn{flex:none;padding:8px 16px;border:none;border-radius:8px;background:var(--dsw-alias-label-primary,#e8eaee);color:var(--dsw-alias-bg-layer-3,#16181d);font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;transition:filter 120ms ease}
.pw-btn:hover:not([disabled]){filter:brightness(1.12)}
.pw-btn[disabled]{opacity:.55;cursor:default}
.pw-btn.ghost{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#ddd)}
.pw-btn.danger{background:transparent;border:1px solid rgba(229,105,110,.6);color:#e5696e}
.pw-btn.danger:hover:not([disabled]){background:rgba(229,105,110,.12)}
.pw-msg{font-size:12.5px;color:var(--dsw-alias-label-secondary,#aaa);min-height:16px;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}
.pw-msg[data-kind='error']{color:var(--dsw-alias-state-danger-primary,#e5696e)}
.pw-empty{padding:24px 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-secondary,#999)}
/* 历史时间线 */
.pw-tl-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 8px;border-radius:6px}
.pw-tl-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}
.pw-tl-badge{flex:none;font-size:11px;font-weight:600;line-height:16px}
.pw-tl-row .pw-ref{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:var(--dsw-alias-label-primary,#ddd)}
.pw-tl-summary{flex-basis:100%;min-width:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#a8adb7);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;padding-left:18px}
/* task 详情内页 */
.pw-back{border:none;background:none;color:var(--dsw-alias-label-primary,#e8eaee);font-size:13px;font-family:inherit;cursor:pointer;padding:2px 0;text-align:left;text-decoration:underline;text-underline-offset:3px;width:max-content}
.pw-back:hover{color:var(--dsw-alias-label-secondary,#aab)}
.pw-detail{padding:4px}
.pw-detail-bar{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.pw-detail-bar .pw-btn{padding:4px 10px;font-size:12px;font-weight:500}
.pw-detail-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0 2px}
.pw-detail-title{font-size:16px;color:var(--dsw-alias-label-primary,#eee)}
.pw-detail-head .pw-kind{margin-left:auto;font-size:12px}
.pw-detail-sec{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#9aa0aa);letter-spacing:.04em}
.pw-detail-list{margin:0;padding-left:20px;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-primary,#ddd)}
.pw-detail-none{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,#999)}
.pw-node[style*='pointer']:hover rect{filter:brightness(1.15)}
/* ── 右键菜单 ── */
.pw-ctx-wrap{position:relative}
.pw-ctx-menu{position:fixed;z-index:960;min-width:168px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#1c1f26);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));box-shadow:0 12px 32px rgba(0,0,0,.4)}
.pw-ctx-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#ddd);font-size:13px;font-family:inherit;text-align:left;cursor:pointer}
.pw-ctx-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.pw-ctx-item.danger{color:#e5696e}
.pw-ctx-sep{height:1px;margin:3px 6px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
/* ── 新建任务表单 ── */
@keyframes pwFormIn{from{opacity:0;transform:translate(-50%,-46%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.pw-form-mask{position:fixed;inset:0;z-index:970;background:rgba(8,10,14,.5);animation:pwHlpMaskIn .18s ease both}
.pw-form-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:971;width:min(520px,92vw);max-height:86vh;overflow:auto;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#1c1f26);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));box-shadow:0 20px 56px rgba(0,0,0,.45);animation:pwFormIn .22s cubic-bezier(.22,1,.36,1) both;padding:18px 20px}
.pw-form-title{margin:0 0 12px;font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary,#eee)}
.pw-fld{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
.pw-fld label{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd)}
.pw-fld input[type='text'],.pw-fld textarea{padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:8px;background:var(--dsw-alias-bg-layer-3,#23262e);color:var(--dsw-alias-label-primary,#e8eaee);font-family:inherit;font-size:13px;line-height:1.55;outline:none}
.pw-fld input:focus-visible,.pw-fld textarea:focus-visible{border-color:var(--dsw-alias-label-dimmed,#889)}
.pw-fld textarea{resize:vertical;min-height:64px}
.pw-fld .pw-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#98a0ac)}
.pw-chk{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary,#bcc1ca);cursor:pointer;user-select:none}
/* 详情依赖管理 */
.pw-dep-row{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;font-size:13px;color:var(--dsw-alias-label-primary,#ddd);font-family:ui-monospace,SFMono-Regular,monospace}
.pw-dep-x{flex:none;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary,#98a);cursor:pointer}
.pw-dep-x:hover{background:rgba(229,105,110,.14);color:#e5696e}
.pw-dep-add{display:flex;gap:8px;margin-top:8px}
.pw-dep-add select{flex:1;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:7px;background:var(--dsw-alias-bg-layer-3,#23262e);color:var(--dsw-alias-label-primary,#e8eaee);font-size:12.5px;font-family:inherit}
.pw-ta{width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:8px;background:var(--dsw-alias-bg-layer-3,#23262e);color:var(--dsw-alias-label-primary,#e8eaee);font-family:ui-monospace,SFMono-Regular,monospace;font-size:12.5px;line-height:1.65;outline:none;box-sizing:border-box}
.pw-ta:focus-visible{border-color:var(--dsw-alias-label-dimmed,#889)}
.pw-detail-head .pw-dep-x{font-size:13px}
/* ── 洞察页 ── */
.pw-ins-search{display:flex;gap:8px;margin-bottom:10px}
.pw-ins-search input{flex:1;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:8px;background:var(--dsw-alias-bg-layer-3,#23262e);color:var(--dsw-alias-label-primary,#e8eaee);font-family:inherit;font-size:13px;outline:none}
.pw-ins-search input:focus-visible{border-color:var(--dsw-alias-label-dimmed,#889)}
.pw-ins-item{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer}
.pw-ins-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}
.pw-ins-kind{flex:none;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.14));color:var(--dsw-alias-label-secondary,#aab)}
.pw-ins-title{font-size:13px;color:var(--dsw-alias-label-primary,#ddd)}
.pw-ins-excerpt{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#98a0ac);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.pw-json{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px;line-height:1.7;color:var(--dsw-alias-label-secondary,#a8adb7);white-space:pre-wrap;word-break:break-word}
.pw-json .pw-jk{color:#6ea8ff}
.pw-json .pw-jv{color:var(--dsw-alias-label-primary,#cdd3dc)}
.pw-issue{display:flex;align-items:flex-start;gap:8px;padding:5px 8px;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,#bcc1ca)}
.pw-issue .pw-dot{margin-top:5px}
/* ── Auto Run ── */
.pw-ar-badge{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;width:max-content}
.pw-ar-badge::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}
.pw-ar-badge[data-s='running']{background:rgba(76,139,245,.16);color:#6ea8ff}
.pw-ar-badge[data-s='paused']{background:rgba(232,163,61,.16);color:#e8a33d}
.pw-ar-badge[data-s='completed']{background:rgba(89,185,120,.16);color:#59b978}
.pw-ar-badge[data-s='failed']{background:rgba(229,105,110,.16);color:#e5696e}
.pw-ar-badge[data-s='stopped']{background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.14));color:var(--dsw-alias-label-secondary,#aab)}
.pw-ar-log{flex:none;max-height:300px;overflow:auto;border-radius:10px;border:1px solid var(--dsw-alias-stroke-subtle,rgba(127,127,127,.18));padding:8px 10px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px;line-height:1.75;color:var(--dsw-alias-label-secondary,#a8adb7);white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-fill-subtle,rgba(127,127,127,.05))}
/* ── 产物内容查看模态 ── */
@keyframes pwRecIn{from{opacity:0;transform:translate(-50%,-46%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.pw-rec-mask{position:fixed;inset:0;z-index:980;background:rgba(8,10,14,.55);animation:pwHlpMaskIn .18s ease both}
.pw-rec-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:981;width:min(820px,92vw);max-height:84vh;display:flex;flex-direction:column;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#1c1f26);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));box-shadow:0 24px 64px rgba(0,0,0,.45);animation:pwRecIn .24s cubic-bezier(.22,1,.36,1) both}
.pw-rec-head{flex:none;display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.pw-rec-title{font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary,#eee);font-family:ui-monospace,SFMono-Regular,monospace}
.pw-rec-body{overflow:auto;padding:14px 18px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12.5px;line-height:1.75;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#ddd)}
`

function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 状态 → 颜色。 */
function statusColor(status: string): string {
  switch (status) {
    case 'implemented':
    case 'completed':
      return '#59b978'
    case 'in_progress':
      return '#4c8bf5'
    case 'ready':
      return '#e8a33d'
    case 'blocked':
    case 'diverged':
      return '#e5696e'
    default:
      return '#8a8f98'
  }
}

/** 分支图线性图标。 */
function WeaveIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M8.2 16.6 15.8 7.4M8.4 18h7.2" />
    </svg>
  )
}

const STATUS_ZH: Record<string, string> = {
  planned: '待就绪', ready: '可执行', in_progress: '进行中', implemented: '已完成',
  completed: '已完成', needs_changes: '需修改', blocked: '已阻塞', diverged: '已分叉',
}

/** 排序：进行中 > 可执行 > 待就绪 > 终态，再按 ref 字典序。 */
function sortBlocks(blocks: PwBlockView[]): PwBlockView[] {
  const rank = (s: string): number => (s === 'in_progress' ? 0 : s === 'ready' ? 1 : s === 'planned' ? 2 : 3)
  return [...blocks].sort((a, b) => rank(a.status) - rank(b.status) || a.ref.localeCompare(b.ref))
}

// ── SVG 任务图（分层布局，零依赖） ──

const NODE_W = 176
const NODE_H = 68
const GAP_X = 18
const GAP_Y = 58
const PAD = 16

interface LaidNode extends PwGraphNode {
  x: number
  y: number
}

/** 最长依赖链分层：上游（被依赖者）层浅在上，下游层深在下；环防御忽略回边。 */
function layoutTasks(nodes: PwGraphNode[]): { laid: LaidNode[]; width: number; height: number } {
  const byId = new Map(nodes.map(n => [n.taskId, n]))
  const order = new Map(nodes.map((n, i) => [n.taskId, i]))
  const memo = new Map<string, number>()
  const inStack = new Set<string>()
  const depthOf = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (inStack.has(id)) return 0
    inStack.add(id)
    const node = byId.get(id)
    let d = 0
    if (node !== undefined && node.dependsOn.length > 0) {
      let max = -1
      for (const dep of node.dependsOn) {
        if (!byId.has(dep) || dep === id) continue
        const dd = depthOf(dep)
        if (dd > max) max = dd
      }
      if (max >= 0) d = max + 1
    }
    inStack.delete(id)
    memo.set(id, d)
    return d
  }
  for (const n of nodes) depthOf(n.taskId)

  const layers = new Map<number, PwGraphNode[]>()
  for (const n of nodes) {
    const layer = layers.get(memo.get(n.taskId) ?? 0) ?? []
    layer.push(n)
    layers.set(memo.get(n.taskId) ?? 0, layer)
  }
  const sortedLayers = [...layers.entries()].sort((a, b) => a[0] - b[0])
  const laid: LaidNode[] = []
  let maxCols = 1
  for (const [, layer] of sortedLayers) {
    layer.sort((a, b) => (order.get(a.taskId) ?? 0) - (order.get(b.taskId) ?? 0))
    maxCols = Math.max(maxCols, layer.length)
    layer.forEach((n, col) => {
      laid.push({ ...n, x: PAD + col * (NODE_W + GAP_X), y: PAD + (memo.get(n.taskId) ?? 0) * (NODE_H + GAP_Y) })
    })
  }
  const rows = sortedLayers.length
  return {
    laid,
    width: PAD * 2 + maxCols * NODE_W + (maxCols - 1) * GAP_X,
    height: PAD * 2 + rows * NODE_H + Math.max(0, rows - 1) * GAP_Y,
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

/** 一个 task 节点：标题 + 状态 + 块状态点行（圆=实现，方=评审）；点击进详情，右键出菜单。 */
function TaskNode({
  node, onClick, onContext,
}: {
  node: LaidNode
  onClick?: (taskId: string) => void
  onContext?: (taskId: string, clientX: number, clientY: number) => void
}): JSX.Element {
  const color = statusColor(node.status)
  return (
    <g
      className="pw-node"
      transform={`translate(${String(node.x)},${String(node.y)})`}
      style={{ cursor: 'pointer' }}
      onClick={() => { onClick?.(node.taskId) }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContext?.(node.taskId, event.clientX, event.clientY)
      }}
    >
      <rect width={NODE_W} height={NODE_H} rx={10} stroke={color} />
      <title>{`${node.taskId} · ${node.title}`}</title>
      <text className="pw-n-title" x={12} y={22}>{clip(node.title, 20)}</text>
      <text className="pw-n-status" x={12} y={40}>
        {`${STATUS_ZH[node.status] ?? node.status} · ${String(node.blocks.length)} 块`}
      </text>
      {node.blocks.map((b, i) => (
        b.type === 'review' ? (
          <rect key={b.ref} x={12 + i * 15} y={48} width={9} height={9} rx={2} fill={statusColor(b.status)} />
        ) : (
          <circle key={b.ref} cx={16.5 + i * 15} cy={52.5} r={4.5} fill={statusColor(b.status)} />
        )
      ))}
    </g>
  )
}

/** 分层任务图：depends_on 边从下游顶部连到上游底部；节点点击进详情、右键出菜单、空白右键新建。 */
function GraphView({
  nodes, onNodeClick, onNodeContext, onBlankContext,
}: {
  nodes: PwGraphNode[]
  onNodeClick?: (taskId: string) => void
  onNodeContext?: (taskId: string, clientX: number, clientY: number) => void
  onBlankContext?: (clientX: number, clientY: number) => void
}): JSX.Element {
  const { laid, width, height } = layoutTasks(nodes)
  const posById = new Map(laid.map(n => [n.taskId, n]))
  const edges: Array<{ key: string; d: string }> = []
  for (const n of laid) {
    for (const dep of n.dependsOn) {
      const up = posById.get(dep)
      if (up === undefined || up === n) continue
      const x1 = n.x + NODE_W / 2
      const y1 = n.y
      const x2 = up.x + NODE_W / 2
      const y2 = up.y + NODE_H
      const mid = (y1 + y2) / 2
      edges.push({ key: `${n.taskId}->${dep}`, d: `M ${String(x1)} ${String(y1)} C ${String(x1)} ${String(mid)}, ${String(x2)} ${String(mid)}, ${String(x2)} ${String(y2)}` })
    }
  }
  return (
    <div
      className="pw-graph-wrap pw-ctx-wrap"
      onContextMenu={(event) => {
        event.preventDefault()
        onBlankContext?.(event.clientX, event.clientY)
      }}
    >
      <svg width={width} height={height} viewBox={`0 0 ${String(width)} ${String(height)}`} role="img" aria-label="PlanWeave 任务图">
        {edges.map(e => <path key={e.key} className="pw-edge" d={e.d} />)}
        {laid.map(n => <TaskNode key={n.taskId} node={n} onClick={onNodeClick} onContext={onNodeContext} />)}
      </svg>
    </div>
  )
}

// ── 历史（records 时间线）与 task 详情 ──

const KIND_ZH: Record<string, string> = {
  run: '执行', review: '评审', feedback: '反馈', submission: '修复',
}
const KIND_COLOR: Record<string, string> = {
  run: '#4c8bf5', review: '#a06ee8', feedback: '#e8a33d', submission: '#59b978',
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前，更久显示 月-日。 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diff = Date.now() - then
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${String(Math.floor(diff / 60_000))} 分钟前`
  if (diff < 86_400_000) return `${String(Math.floor(diff / 3_600_000))} 小时前`
  if (diff < 30 * 86_400_000) return `${String(Math.floor(diff / 86_400_000))} 天前`
  const d = new Date(then)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 一条产物记录的通用行（可点击查看全文）。 */
function RecordRow({ record, onOpen }: { record: PwRecord; onOpen?: (record: PwRecord) => void }): JSX.Element {
  return (
    <div
      className="pw-tl-row"
      data-clickable={onOpen !== undefined ? 'true' : undefined}
      style={onOpen !== undefined ? { cursor: 'pointer' } : undefined}
      title={`${record.id} · ${record.ref}\n${record.summary}${onOpen !== undefined ? '\n点击查看全文' : ''}`}
      onClick={onOpen !== undefined ? () => { onOpen(record) } : undefined}
    >
      <span className="pw-dot" style={{ background: KIND_COLOR[record.kind] ?? '#888' }} />
      <span className="pw-tl-badge" style={{ color: KIND_COLOR[record.kind] ?? '#888' }}>{KIND_ZH[record.kind] ?? record.kind}</span>
      <span className="pw-ref">{record.id}</span>
      <span className="pw-kind">{formatRelative(record.at)}</span>
      <div className="pw-tl-summary">{record.summary}</div>
    </div>
  )
}

/** 「历史」视图：全部产物的倒序时间线。 */
function RecordsTimeline({ records, onOpen }: { records: PwRecord[]; onOpen?: (record: PwRecord) => void }): JSX.Element {
  if (records.length === 0) return <div className="pw-empty">暂无执行产物——点右侧「推进」开始跑计划</div>
  return (
    <div className="pw-scroll">
      {records.map(r => <RecordRow key={`${r.taskId}/${r.kind}/${r.id}`} record={r} onOpen={onOpen} />)}
    </div>
  )
}

/** task 详情内页：元信息编辑、上游依赖、源提示词编辑器、块增删改与评审门配置。 */
function TaskDetailView({
  node, nodes, records, api, executors, busy, projectName,
  onBack, onDelete, onSetDeps, onOpenRecord, onEdit,
}: {
  node: PwGraphNode
  nodes: PwGraphNode[]
  records: PwRecord[]
  api: PlanweaveApi
  executors: string[]
  busy: boolean
  projectName?: string
  onBack: () => void
  onDelete: (node: PwGraphNode) => void
  onSetDeps: (taskId: string, next: string[]) => void
  onOpenRecord?: (record: PwRecord) => void
  onEdit: (payload: import('./api.js').EditOp) => void
}): JSX.Element {
  const related = records.filter(r => r.taskId === node.taskId)
  const others = nodes.filter(n => n.taskId !== node.taskId)
  const [addPick, setAddPick] = useState('')
  // 任务元信息（标题/验收）行内编辑。
  const [metaOpen, setMetaOpen] = useState(false)
  const [metaTitle, setMetaTitle] = useState('')
  const [metaAcceptance, setMetaAcceptance] = useState('')
  // 任务源提示词编辑器。
  const [srcState, setSrcState] = useState<{ loading: boolean; content: string } | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  // 块级操作。
  const [blockEditRef, setBlockEditRef] = useState<string | null>(null)
  const [blockDraft, setBlockDraft] = useState('')
  const [planningRef, setPlanningRef] = useState<string | null>(null)
  const [planningRequired, setPlanningRequired] = useState(true)
  const [planningCycles, setPlanningCycles] = useState(1)
  const [addBlockType, setAddBlockType] = useState<'implementation' | 'review' | null>(null)
  const [addBlockTitle, setAddBlockTitle] = useState('')
  const [executorPick, setExecutorPick] = useState(node.executor ?? '')

  useEffect(() => {
    let cancelled = false
    setSrcState({ loading: true, content: '' })
    void api.taskSource(node.taskId, projectName).then(r => {
      if (cancelled) return
      setSrcState({ loading: false, content: r.ok ? (r.content ?? '') : (r.error ?? '') })
    })
    return () => { cancelled = true }
  }, [node.taskId, api])

  const removeDep = (dep: string): void => {
    if (busy) return
    onSetDeps(node.taskId, node.dependsOn.filter(d => d !== dep))
  }
  const addDep = (): void => {
    if (busy || addPick === '' || node.dependsOn.includes(addPick)) return
    onSetDeps(node.taskId, [...node.dependsOn, addPick])
    setAddPick('')
  }
  const openMeta = (): void => {
    setMetaTitle(node.title)
    setMetaAcceptance((node.acceptance ?? []).join('\n'))
    setMetaOpen(true)
  }
  const saveMeta = (): void => {
    if (busy) return
    const acceptance = metaAcceptance.split(/\r?\n/).map(s => s.trim()).filter(s => s !== '')
    if (metaTitle.trim() === '' || acceptance.length === 0) return
    onEdit({ op: 'task.title', taskId: node.taskId, title: metaTitle.trim() })
    onEdit({ op: 'task.acceptance', taskId: node.taskId, acceptance })
    setMetaOpen(false)
  }
  const savePrompt = (): void => {
    if (busy) return
    onEdit({ op: 'task.prompt', taskId: node.taskId, markdown: promptDraft })
    setPromptOpen(false)
  }
  const saveBlockPrompt = (ref: string): void => {
    if (busy) return
    onEdit({ op: 'block.prompt', ref, markdown: blockDraft })
    setBlockEditRef(null)
  }
  const savePlanning = (ref: string): void => {
    if (busy) return
    onEdit({ op: 'block.planning', ref, reviewRequired: planningRequired, maxFeedbackCycles: planningCycles })
    setPlanningRef(null)
  }
  const submitAddBlock = (): void => {
    if (busy || addBlockType === null || addBlockTitle.trim() === '') return
    onEdit({
      op: 'block.add',
      taskId: node.taskId,
      type: addBlockType,
      title: addBlockTitle.trim(),
      ...(addBlockType === 'implementation' ? { dependsOn: [] } : {}),
    })
    setAddBlockType(null)
    setAddBlockTitle('')
  }

  return (
    <div className="pw-detail">
      <div className="pw-detail-bar">
        <button type="button" className="pw-back" onClick={onBack}>← 返回任务图</button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="pw-btn danger"
          title={`从计划中移除 ${node.taskId}（不可撤销）`}
          onClick={() => { onDelete(node) }}
        >
          删除此任务
        </button>
      </div>
      <div className="pw-detail-head">
        <span className="pw-dot" style={{ background: statusColor(node.status) }} />
        <b className="pw-detail-title">{node.title}</b>
        <button type="button" className="pw-dep-x" aria-label="编辑标题与验收标准" title="编辑标题与验收标准" onClick={openMeta}>✎</button>
        <span className="pw-kind">{node.taskId} · {STATUS_ZH[node.status] ?? node.status}</span>
      </div>
      {metaOpen ? (
        <div style={{ border: '1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25))', borderRadius: 10, padding: '10px 12px', marginBottom: 4 }}>
          <div className="pw-fld">
            <label htmlFor="pw-meta-title">任务标题</label>
            <input id="pw-meta-title" type="text" value={metaTitle} onChange={e => { setMetaTitle(e.target.value) }} />
          </div>
          <div className="pw-fld">
            <label htmlFor="pw-meta-acc">验收标准（每行一条）</label>
            <textarea id="pw-meta-acc" rows={3} value={metaAcceptance} onChange={e => { setMetaAcceptance(e.target.value) }} />
          </div>
          <div className="pw-actions">
            <button type="button" className="pw-btn" disabled={busy} onClick={saveMeta}>保存</button>
            <button type="button" className="pw-btn ghost" disabled={busy} onClick={() => { setMetaOpen(false) }}>取消</button>
          </div>
        </div>
      ) : null}
      <div className="pw-dep-row" style={{ fontFamily: 'inherit' }}>
        <span style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary,#aab)' }}>执行器</span>
        <select
          value={executorPick}
          disabled={busy}
          style={{ padding: '4px 8px', borderRadius: 7, background: 'var(--dsw-alias-bg-layer-3,#23262e)', color: 'var(--dsw-alias-label-primary,#e8eaee)', border: '1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28))', fontSize: 12.5 }}
          onChange={e => {
            setExecutorPick(e.target.value)
            onEdit({ op: 'task.executor', taskId: node.taskId, executor: e.target.value })
          }}
        >
          <option value="">default（继承）</option>
          {executors.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <div className="pw-detail-sec">上游依赖（连线）</div>
      {node.dependsOn.length > 0
        ? (
          <div>
            {node.dependsOn.map(dep => {
              const depNode = nodes.find(n => n.taskId === dep)
              return (
                <div key={dep} className="pw-dep-row" title={`依赖 ${dep}——它完成后本任务才就绪`}>
                  <span className="pw-dot" style={{ background: statusColor(depNode?.status ?? 'planned') }} />
                  <span className="pw-ref">{dep}</span>
                  <span style={{ fontFamily: 'inherit', fontSize: 12, color: 'var(--dsw-alias-label-tertiary,#98a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {depNode?.title ?? ''}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="pw-dep-x" aria-label={`移除依赖 ${dep}`} title="移除该依赖连线" disabled={busy} onClick={() => { removeDep(dep) }}>×</button>
                </div>
              )
            })}
          </div>
        )
        : <p className="pw-detail-none">无——本任务可立即执行</p>}
      {others.length > 0 ? (
        <div className="pw-dep-add">
          <select value={addPick} onChange={e => { setAddPick(e.target.value) }}>
            <option value="">选择上游任务…</option>
            {others.map(n => <option key={n.taskId} value={n.taskId}>{n.taskId} · {clip(n.title, 18)}</option>)}
          </select>
          <button type="button" className="pw-btn ghost" disabled={busy || addPick === ''} onClick={addDep}>连线</button>
        </div>
      ) : null}
      <div className="pw-detail-sec">验收标准</div>
      {(node.acceptance ?? []).length > 0
        ? <ul className="pw-detail-list">{(node.acceptance ?? []).map((a, i) => <li key={String(i)}>{a}</li>)}</ul>
        : <p className="pw-detail-none">未填写</p>}
      <div className="pw-detail-sec">任务提示词（源）</div>
      {!promptOpen ? (
        <div className="pw-actions">
          <button type="button" className="pw-btn ghost" disabled={srcState?.loading === true} onClick={() => { setPromptDraft(srcState?.content ?? ''); setPromptOpen(true) }}>
            {srcState?.loading === true ? '加载中…' : '编辑源提示词'}
          </button>
        </div>
      ) : (
        <div>
          <textarea
            className="pw-ta"
            rows={10}
            value={promptDraft}
            onChange={e => { setPromptDraft(e.target.value) }}
            spellCheck={false}
          />
          <div className="pw-actions" style={{ marginTop: 8 }}>
            <button type="button" className="pw-btn" disabled={busy} onClick={savePrompt}>保存提示词</button>
            <button type="button" className="pw-btn ghost" disabled={busy} onClick={() => { setPromptOpen(false); setPromptDraft(srcState?.content ?? '') }}>取消</button>
          </div>
        </div>
      )}
      <div className="pw-detail-sec">块明细</div>
      <div>
        {node.blocks.map(b => {
          const isReview = b.type === 'review'
          return (
            <div key={b.ref} style={{ borderBottom: '1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.15))', paddingBottom: 6, marginBottom: 6 }}>
              <div className="pw-row">
                <span className="pw-dot" style={{ background: statusColor(b.status) }} />
                <span className="pw-ref">{b.ref}</span>
                <span className="pw-kind">{STATUS_ZH[b.status] ?? b.status} · {isReview ? '评审' : '实现'}</span>
                <button type="button" className="pw-dep-x" aria-label={`编辑 ${b.ref} 提示词`} title="编辑块提示词" disabled={busy} onClick={() => {
                  setBlockEditRef(blockEditRef === b.ref ? null : b.ref)
                  setBlockDraft('')
                  void api.taskSource(b.ref, projectName).then(r => { setBlockDraft(r.ok ? (r.content ?? '') : '') })
                }}>✎</button>
                {isReview ? (
                  <button
                    type="button"
                    className="pw-dep-x"
                    aria-label={`配置 ${b.ref} 评审门`}
                    title="评审门配置"
                    disabled={busy}
                    onClick={() => {
                      setPlanningRef(planningRef === b.ref ? null : b.ref)
                      setPlanningRequired(true)
                      setPlanningCycles(1)
                    }}
                  >⚙</button>
                ) : null}
                <button type="button" className="pw-dep-x" aria-label={`删除块 ${b.ref}`} title="删除此块" disabled={busy} onClick={() => {
                  if (window.confirm(`确定删除块 ${b.ref}？`)) onEdit({ op: 'block.remove', ref: b.ref })
                }}>🗑</button>
              </div>
              {blockEditRef === b.ref ? (
                <div style={{ padding: '4px 8px 8px' }}>
                  <textarea className="pw-ta" rows={6} value={blockDraft} onChange={e => { setBlockDraft(e.target.value) }} spellCheck={false} />
                  <div className="pw-actions" style={{ marginTop: 6 }}>
                    <button type="button" className="pw-btn" disabled={busy} onClick={() => { saveBlockPrompt(b.ref) }}>保存块提示词</button>
                    <button type="button" className="pw-btn ghost" disabled={busy} onClick={() => { setBlockEditRef(null) }}>取消</button>
                  </div>
                </div>
              ) : null}
              {planningRef === b.ref && isReview ? (
                <div style={{ padding: '4px 8px 8px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <label className="pw-chk">
                    <input type="checkbox" checked={planningRequired} onChange={e => { setPlanningRequired(e.target.checked) }} />
                    必须通过
                  </label>
                  <label className="pw-chk">
                    最大反馈轮数
                    <input
                      type="number" min={0} max={9} value={planningCycles}
                      style={{ width: 56, padding: '3px 6px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#23262e)', color: 'var(--dsw-alias-label-primary,#e8eaee)', border: '1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28))' }}
                      onChange={e => { setPlanningCycles(Number(e.target.value)) }}
                    />
                  </label>
                  <button type="button" className="pw-btn" disabled={busy} onClick={() => { savePlanning(b.ref) }}>保存评审配置</button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="pw-actions">
        <button type="button" className="pw-btn ghost" disabled={busy || addBlockType !== null} onClick={() => { setAddBlockType('implementation'); setAddBlockTitle('') }}>＋ 实现块</button>
        <button type="button" className="pw-btn ghost" disabled={busy || addBlockType !== null} onClick={() => { setAddBlockType('review'); setAddBlockTitle('') }}>＋ 评审门块</button>
      </div>
      {addBlockType !== null ? (
        <div style={{ border: '1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25))', borderRadius: 10, padding: '10px 12px' }}>
          <div className="pw-fld">
            <label htmlFor="pw-ab-title">{addBlockType === 'review' ? '评审门标题 *' : '实现块标题 *'}</label>
            <input id="pw-ab-title" type="text" value={addBlockTitle} placeholder={addBlockType === 'review' ? '例如：评审产出质量' : '例如：编写核心逻辑'} onChange={e => { setAddBlockTitle(e.target.value) }} />
          </div>
          <div className="pw-actions">
            <button type="button" className="pw-btn" disabled={busy || addBlockTitle.trim() === ''} onClick={submitAddBlock}>添加{addBlockType === 'review' ? '评审门块' : '实现块'}</button>
            <button type="button" className="pw-btn ghost" disabled={busy} onClick={() => { setAddBlockType(null); setAddBlockTitle('') }}>取消</button>
          </div>
        </div>
      ) : null}
      <div className="pw-detail-sec">相关记录</div>
      {related.length > 0
        ? <div>{related.map(r => <RecordRow key={`${r.kind}/${r.id}`} record={r} onOpen={onOpenRecord} />)}</div>
        : <p className="pw-detail-none">暂无记录</p>}
    </div>
  )
}

// ── 洞察页（搜索 / 统计 / 待办 / 图质量 / doctor） ──

const SEARCH_KIND_ZH: Record<string, string> = {
  task: '任务', block: '块', prompt: '提示词', run_record: '执行', review_attempt: '评审', feedback: '反馈',
}

/** 轻量 JSON 树渲染（统计/待办等透传数据的通用呈现）。 */
function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }): JSX.Element {
  if (value === null || value === undefined) return <span className="pw-jv">—</span>
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="pw-jv">[]</span>
    return (
      <div style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
        {value.map((item, i) => (
          <div key={String(i)}><JsonView value={item} depth={depth + 1} /></div>
        ))}
      </div>
    )
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="pw-jv">{}</span>
    return (
      <div style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
        {entries.map(([k, v]) => (
          <div key={k}>
            {typeof v === 'object' && v !== null
              ? (<span><span className="pw-jk">{k}:</span> <JsonView value={v} depth={depth + 1} /></span>)
              : (<span><span className="pw-jk">{k}: </span><span className="pw-jv">{String(v)}</span></span>)}
          </div>
        ))}
      </div>
    )
  }
  return <span className="pw-jv">{String(value)}</span>
}

/** 「洞察」视图：搜索、doctor、图质量、统计与待办。 */
function InsightsView({
  api, busy, projectName, onJumpTask, onNotify,
}: {
  api: PlanweaveApi
  busy: boolean
  projectName?: string
  onJumpTask: (taskId: string) => void
  onNotify: (kind: 'info' | 'error', message: string) => void
}): JSX.Element {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchItem[] | null>(null)
  const [doctorReport, setDoctorReport] = useState<DoctorResult['report'] | null>(null)
  const [qualityView, setQualityView] = useState<QualityResult['report'] | null>(null)
  const [statsView, setStatsView] = useState<Record<string, unknown> | null>(null)
  const [todosView, setTodosView] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  const loadInsights = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [stats, todos, quality] = await Promise.all([api.statistics(projectName), api.todos(projectName), api.quality(projectName)])
      setStatsView(stats.ok ? (stats.statistics ?? {}) : { 错误: stats.error ?? '' })
      setTodosView(todos.ok ? (todos.todos ?? {}) : { 错误: todos.error ?? '' })
      setQualityView(quality.ok ? (quality.report ?? {}) : { ok: false, diagnostics: [] })
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void loadInsights()
  }, [loadInsights])

  const doSearch = async (): Promise<void> => {
    if (q.trim() === '') { setResults(null); return }
    const r = await api.search(q.trim(), projectName)
    setResults(r.ok ? (r.results ?? []) : [])
    if (!r.ok && r.error !== undefined) onNotify('error', r.error)
  }

  const runDoctorNow = async (repair: boolean): Promise<void> => {
    if (repair && !window.confirm('让 doctor 自动修复发现的问题？')) return
    const r = await api.doctor(repair, projectName)
    if (r.report !== undefined) setDoctorReport(r.report)
    if (!r.ok && r.error !== undefined) onNotify('error', r.error)
    else if (r.report?.ok === true) onNotify('info', repair ? '体检通过（已尝试修复）。' : '体检通过，未发现问题。')
  }

  const issues = doctorReport?.issues ?? []

  return (
    <div className="pw-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h3 className="pw-detail-sec" style={{ margin: '0 0 8px' }}>全项目搜索</h3>
        <div className="pw-ins-search">
          <input
            type="text"
            placeholder="搜任务标题 / 提示词 / 执行产物…"
            value={q}
            onChange={e => { setQ(e.target.value) }}
            onKeyDown={e => { if (e.key === 'Enter') void doSearch() }}
          />
          <button type="button" className="pw-btn ghost" onClick={() => { void doSearch() }}>搜索</button>
        </div>
        {results !== null && (
          results.length === 0
            ? <p className="pw-detail-none">无匹配结果</p>
            : (
              <div>
                {results.map((r, i) => (
                  <div
                    key={`${r.kind}/${r.ref ?? ''}/${String(i)}`}
                    className="pw-ins-item"
                    onClick={() => {
                      // task/block 结果直接跳详情；其余类型仅展示。
                      const refId = r.kind === 'task' ? r.ref : (r.ref !== undefined && r.ref.includes('#') ? r.ref.split('#')[0]! : undefined)
                      if (refId !== undefined) onJumpTask(refId)
                    }}
                  >
                    <span className="pw-ins-kind">{SEARCH_KIND_ZH[r.kind ?? ''] ?? r.kind}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="pw-ins-title">{r.title ?? r.ref}</div>
                      {r.excerpt !== undefined && r.excerpt !== '' ? <div className="pw-ins-excerpt">{r.excerpt}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            )
        )}
      </div>
      <div>
        <div className="pw-detail-bar">
          <h3 className="pw-detail-sec" style={{ margin: 0 }}>一致性体检（doctor）</h3>
          <span style={{ flex: 1 }} />
          <button type="button" className="pw-btn ghost" disabled={busy} onClick={() => { void runDoctorNow(false) }}>运行体检</button>
          <button type="button" className="pw-btn ghost" disabled={busy} onClick={() => { void runDoctorNow(true) }}>自动修复</button>
        </div>
        {issues.length === 0
          ? <p className="pw-detail-none">{doctorReport === null ? '尚未运行。' : '未发现问题。'}</p>
          : issues.map((issue, i) => (
            <div key={String(i)} className="pw-issue">
              <span className="pw-dot" style={{ background: issue.severity === 'warning' ? '#e8a33d' : '#e5696e' }} />
              <span>{issue.message}{issue.repaired === true ? '（已修复）' : ''}{issue.code !== undefined ? ` (${issue.code})` : ''}</span>
            </div>
          ))}
      </div>
      <div>
        <div className="pw-detail-bar">
          <h3 className="pw-detail-sec" style={{ margin: 0 }}>图质量校验</h3>
          <span style={{ flex: 1 }} />
          {loading ? <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary,#99a)' }}>加载中…</span> : null}
        </div>
        {(qualityView?.diagnostics ?? []).length === 0
          ? <p className="pw-detail-none">{qualityView?.ok === true ? '结构健康。' : '尚无数据。'}</p>
          : (qualityView?.diagnostics ?? []).map((d, i) => (
            <div key={String(i)} className="pw-issue">
              <span className="pw-dot" style={{ background: d.severity === 'error' ? '#e5696e' : d.severity === 'warning' ? '#e8a33d' : '#4c8bf5' }} />
              <span>{d.message}{d.count !== undefined && d.count > 1 ? ` ×${String(d.count)}` : ''}</span>
            </div>
          ))}
      </div>
      <div>
        <h3 className="pw-detail-sec">效率统计</h3>
        <div className="pw-json">{statsView === null ? '加载中…' : <JsonView value={statsView} />}</div>
      </div>
      <div>
        <h3 className="pw-detail-sec">待办分组</h3>
        <div className="pw-json">{todosView === null ? '加载中…' : <JsonView value={todosView} />}</div>
      </div>
    </div>
  )
}

// ── 工作台主体 ──

type WorkbenchView = 'graph' | 'list' | 'history' | 'insights'

/** 工作台属性。 */
export interface PlanWeaveWorkbenchProps {
  api: PlanweaveApi
  open: boolean
  closing: boolean
  onClose: () => void
}

/** 与会话区等量级的大工作台（portal 至 body；中心缩放滑入/滑出）。 */
export function PlanWeaveWorkbench({ api, open, closing, onClose }: PlanWeaveWorkbenchProps): JSX.Element | null {
  ensureStyles()
  ensureShellStyles()
  const [view, setView] = useState<WorkbenchView>('graph')
  const [statusData, setStatusData] = useState<StatusResult | null>(null)
  const [graphData, setGraphData] = useState<PwGraphView | null>(null)
  const [records, setRecords] = useState<PwRecord[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [msgKind, setMsgKind] = useState<'info' | 'error'>('info')
  const [helpOpen, setHelpOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; taskId: string | null } | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [autoRun, setAutoRun] = useState<PwAutoRunSnapshot | null>(null)
  const [recView, setRecView] = useState<{ record: PwRecord; content: string } | null>(null)
  const [executors, setExecutors] = useState<string[]>([])
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [projects, setProjects] = useState<PwProjectSummary[] | null>(null)
  const busyRef = useRef(false)
  const arLogRef = useRef<HTMLDivElement | null>(null)

  const arActive = autoRun !== null && (autoRun.status === 'running' || autoRun.status === 'paused')
  /** 当前生效项目名（null = 用服务端默认）。所有数据调用统一带上。 */
  const proj = activeProject ?? undefined

  useEffect(() => {
    if (!open || projects !== null) return undefined
    void api.listProjects().then(r => { if (r.ok && r.projects !== undefined) setProjects(r.projects) })
    return undefined
  }, [open, api, projects !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || executors.length > 0) return undefined
    void api.listExecutors().then(r => { if (r.ok && r.executors !== undefined) setExecutors(r.executors) })
    return undefined
  }, [open, api, executors.length])

  // Auto Run 日志自动滚到底部。
  useEffect(() => {
    if (arLogRef.current !== null) arLogRef.current.scrollTop = arLogRef.current.scrollHeight
  }, [autoRun?.events.length])

  const refresh = useCallback(async (): Promise<void> => {
    const [status, graph, recs] = await Promise.all([api.status(proj), api.graph(proj), api.records(50, proj)])
    setStatusData(status)
    if (graph.ok && graph.graph !== undefined) setGraphData(graph.graph)
    if (recs.ok && recs.records !== undefined) setRecords(recs.records)
    const failure = !status.ok && status.error !== undefined
      ? status.error
      : (!graph.ok && graph.error !== undefined ? graph.error : undefined)
    if (failure !== undefined) {
      setMsgKind('error')
      setMessage(failure)
    }
  }, [api, proj])

  useEffect(() => {
    if (!open) return undefined
    void refresh()
    void api.autoRunState(proj).then(r => { if (r.snapshot !== undefined && r.snapshot !== null) setAutoRun(r.snapshot) })
    const timer = window.setInterval(() => {
      if (!busyRef.current) void refresh()
    }, 5000)
    return () => { window.clearInterval(timer) }
  }, [open, refresh, api, proj])

  // Auto Run 状态轮询：活动中 1.5s 快频，空闲 6s 保底同步。
  useEffect(() => {
    if (!open) return undefined
    const timer = window.setInterval(() => {
      void api.autoRunState(proj).then(r => {
        if (r.snapshot !== undefined && r.snapshot !== null) setAutoRun(r.snapshot)
      })
    }, arActive ? 1500 : 6000)
    return () => { window.clearInterval(timer) }
  }, [open, api, arActive, proj])

  /** 新建托管项目并切换过去。 */
  const newProject = async (): Promise<void> => {
    const name = window.prompt('新项目名称：')
    if (name === null || name.trim() === '') return
    const trimmed = name.trim()
    const r = await api.createProject(trimmed)
    if (!r.ok) {
      setMsgKind('error')
      setMessage(r.error ?? '创建失败')
      return
    }
    const list = await api.listProjects()
    if (list.ok && list.projects !== undefined) setProjects(list.projects)
    switchProject(trimmed)
    setMessage(`项目「${trimmed}」已创建并切换。`)
  }

  /** 切换项目：清选中与数据，轮询自动重拉新项目。 */
  const switchProject = (name: string): void => {
    if (busyRef.current || name === (activeProject ?? '')) return
    setActiveProject(name === '' ? null : name)
    setSelectedTaskId(null)
    setStatusData(null)
    setGraphData(null)
    setRecords([])
    setAutoRun(null)
    setMsgKind('info')
    setMessage(`已切换到项目：${name === '' ? '（默认）' : name}`)
  }

  const arStart = async (): Promise<void> => {
    if (busyRef.current || arActive) return
    setMsgKind('info')
    setMessage('正在启动 Auto Run…')
    const result = await api.autoRunStart(60, proj)
    if (result.ok && result.snapshot !== undefined) {
      setAutoRun(result.snapshot)
      setMessage('Auto Run 已启动，右侧日志实时滚动。')
      await refresh()
    } else {
      setMsgKind('error')
      setMessage(result.error ?? '启动失败')
      if (result.snapshot !== undefined) setAutoRun(result.snapshot)
    }
  }

  const arControl = async (action: 'pause' | 'resume' | 'stop'): Promise<void> => {
    if (autoRun === null) return
    const result = await api.autoRunControl(action, autoRun.id)
    if (result.ok && result.snapshot !== undefined) setAutoRun(result.snapshot)
  }

  const openRecord = async (record: PwRecord): Promise<void> => {
    const file = record.kind === 'review' ? 'review-result.json' : record.kind === 'feedback' ? 'feedback.json' : 'report.md'
    setRecView({ record, content: '加载中…' })
    const r = await api.recordContent(record.dir, file, proj)
    setRecView({ record, content: r.ok ? (r.content ?? '') : (r.error ?? '读取失败') })
  }

  /** 统一图编辑事务：成功刷新数据并提示，失败把诊断显示到消息区。 */
  const editOp = async (payload: import('./api.js').EditOp): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const result = await api.edit(payload, proj)
      if (result.ok) {
        setMsgKind('info')
        setMessage('已保存。')
        await refresh()
      } else {
        setMsgKind('error')
        setMessage(result.error ?? '保存失败')
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!open || closing) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // 说明模态开着时由它自己接管关闭（其内部捕获监听负责）。
      if (helpOpen || formOpen) return
      event.stopPropagation()
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [open, closing, helpOpen, formOpen, onClose])

  // 右键菜单：点击任意处即关闭（capture 先于菜单项 click，菜单项用 onMouseDown 执行动作）。
  useEffect(() => {
    if (ctxMenu === null) return undefined
    const close = (): void => { setCtxMenu(null) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('wheel', close, { capture: true, passive: true })
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('wheel', close as EventListener, { capture: true })
    }
  }, [ctxMenu])

  const runSteps = async (steps: number): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMsgKind('info')
    setMessage(steps === 1 ? '正在推进一步…' : `正在推进 ${String(steps)} 步…`)
    try {
      const result = await api.run(steps, proj)
      if (result.ok) {
        setMessage(result.summary ?? '推进完成')
        await refresh()
      } else {
        setMsgKind('error')
        setMessage(result.error ?? '推进失败')
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const seedExample = async (force: boolean): Promise<void> => {
    if (busyRef.current) return
    if (force && !window.confirm('项目已有任务，播种示例会覆盖现有计划。确定继续？')) return
    busyRef.current = true
    setBusy(true)
    setMsgKind('info')
    setMessage('正在播种示例计划…')
    try {
      const result = await api.seed(proj, force)
      if (result.ok) {
        setSelectedTaskId(null)
        setMessage(`示例计划已就绪：${String(result.taskTotal ?? 0)} 任务 / ${String(result.blockTotal ?? 0)} 块。点「推进」开始执行。`)
        await refresh()
      } else if (result.error !== undefined && result.error.includes('force')) {
        busyRef.current = false
        setBusy(false)
        await seedExample(true)
        return
      } else {
        setMsgKind('error')
        setMessage(result.error ?? '播种失败')
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const deleteTask = async (taskId: string): Promise<void> => {
    if (busyRef.current) return
    if (!window.confirm(`确定从计划中删除任务 ${taskId}？其图节点与提示词将被移除（已产生的 results 产物保留在磁盘）。`)) return
    busyRef.current = true
    setBusy(true)
    setMsgKind('info')
    setMessage(`正在删除任务 ${taskId}…`)
    try {
      const result = await api.removeTask(taskId, proj)
      if (result.ok) {
        if (selectedTaskId === taskId) setSelectedTaskId(null)
        setMessage(`已删除任务 ${taskId}。`)
        await refresh()
      } else {
        setMsgKind('error')
        setMessage(result.error ?? '删除失败')
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const createTask = async (input: { title: string; promptMarkdown: string; acceptance: string[]; withReview: boolean }): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMsgKind('info')
    setMessage(`正在创建任务「${input.title}」…`)
    try {
      const result = await api.createTask(input, proj)
      if (result.ok) {
        setFormOpen(false)
        setMessage('任务已创建。')
        await refresh()
      } else {
        setMsgKind('error')
        setMessage(result.error ?? '创建失败')
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const setDeps = async (taskId: string, next: string[]): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const result = await api.setDeps(taskId, next, proj)
      if (result.ok) {
        setMsgKind('info')
        setMessage(`${taskId} 上游依赖已更新：${next.length > 0 ? next.join(', ') : '（无）'}`)
        await refresh()
      } else {
        setMsgKind('error')
        setMessage(result.error ?? '依赖设置失败')
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const graphHistory = async (action: 'undo' | 'redo'): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const result = await api.graphHistory(action, proj)
      if (result.ok) {
        setMsgKind('info')
        setMessage(action === 'undo' ? '已撤销。' : '已重做。')
        await refresh()
      } else {
        setMsgKind('error')
        setMessage(result.error ?? `${action} 失败`)
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const status = statusData?.status
  const blocks = status !== undefined ? sortBlocks(status.blocks) : []
  const hasProject = statusData?.ok === true && status !== undefined
  const graphNodes = graphData?.nodes ?? []
  const selectedTask = selectedTaskId !== null ? graphNodes.find(n => n.taskId === selectedTaskId) : undefined
  const isEmptyPlan = hasProject && graphNodes.length === 0

  if (!open) return null
  return createPortal(
    <>
      <div className="pw-wb-mask" data-anim={closing ? 'out' : 'in'} aria-hidden="true" onClick={onClose} />
      <div className="pw-wb" data-anim={closing ? 'out' : 'in'} role="dialog" aria-modal="true" aria-label="PlanWeave 工作台">
        <div className="pw-wb-head">
          <span className="pw-wb-title">PlanWeave 工作台</span>
          <select
            className="pw-proj-select"
            value={activeProject ?? ''}
            title="切换项目"
            onChange={e => { switchProject(e.target.value) }}
          >
            <option value="">默认项目</option>
            {(projects ?? []).filter(p => p.name !== '').map(p => (
              <option key={p.id} value={p.name}>{p.name}{p.canvases > 1 ? `（${String(p.canvases)} 画布）` : ''}</option>
            ))}
          </select>
          <button
            type="button"
            className="pw-wb-roundbtn"
            aria-label="新建项目"
            title="新建项目"
            onClick={() => { void newProject() }}
          >
            ＋
          </button>
          {graphData?.projectTitle !== undefined && graphData.projectTitle !== ''
            ? <span className="pw-wb-project">{graphData.projectTitle}</span>
            : null}
          <span className="pw-wb-spacer" />
          <button type="button" className="pw-wb-roundbtn" aria-label="撤销上一次图编辑" title="撤销（Ctrl+Z）" disabled={busy} onClick={() => { void graphHistory('undo') }}>↶</button>
          <button type="button" className="pw-wb-roundbtn" aria-label="重做图编辑" title="重做（Ctrl+Y）" disabled={busy} onClick={() => { void graphHistory('redo') }}>↷</button>
          <button type="button" className="pw-wb-roundbtn" aria-label="一致性体检" title="一致性体检（doctor）" onClick={() => { setView('insights') }}>❤</button>
          <button type="button" className="pw-wb-roundbtn" aria-label="使用说明" title="使用说明" onClick={() => { setHelpOpen(true) }}>?</button>
          <button type="button" className="pw-wb-roundbtn" aria-label="关闭工作台" title="关闭" onClick={onClose}>×</button>
        </div>
        <div className="pw-wb-main">
          <section className="pw-wb-view">
            {selectedTask !== undefined ? (
              <TaskDetailView
                node={selectedTask}
                nodes={graphNodes}
                records={records}
                api={api}
                executors={executors}
                busy={busy}
                projectName={proj}
                onBack={() => { setSelectedTaskId(null) }}
                onDelete={n => { void deleteTask(n.taskId) }}
                onSetDeps={(taskId, next) => { void setDeps(taskId, next) }}
                onOpenRecord={r => { void openRecord(r) }}
                onEdit={payload => { void editOp(payload) }}
              />
            ) : (
              <>
                {!hasProject ? (
                  <div className="pw-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    {statusData === null ? '加载中…' : (statusData?.error ?? '尚无计划项目')}
                    {statusData !== null && (
                      <div style={{ marginTop: 14 }}>
                        <button type="button" className="pw-btn" disabled={busy} onClick={() => { void seedExample(false) }}>播种示例计划</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="pw-tabs">
                      <button type="button" className="pw-tab" data-active={view === 'graph'} onClick={() => { setView('graph') }}>任务图</button>
                      <button type="button" className="pw-tab" data-active={view === 'list'} onClick={() => { setView('list') }}>块列表</button>
                      <button type="button" className="pw-tab" data-active={view === 'history'} onClick={() => { setView('history') }}>历史</button>
                      <button type="button" className="pw-tab" data-active={view === 'insights'} onClick={() => { setView('insights') }}>洞察</button>
                      <span style={{ flex: 1 }} />
                      <button type="button" className="pw-btn ghost" style={{ padding: '3px 10px' }} disabled={busy} onClick={() => { setFormOpen(true) }}>＋ 新建任务</button>
                    </div>
                    {view === 'insights' ? (
                      <InsightsView
                        api={api}
                        busy={busy}
                        projectName={proj}
                        onJumpTask={taskId => { setSelectedTaskId(taskId) }}
                        onNotify={(kind, msg) => { setMsgKind(kind); setMessage(msg) }}
                      />
                    ) : view === 'history' ? (
                      <RecordsTimeline records={records} onOpen={record => { void openRecord(record) }} />
                    ) : view === 'graph' ? (
                      graphNodes.length > 0
                        ? (
                          <GraphView
                            nodes={graphNodes}
                            onNodeClick={taskId => { setSelectedTaskId(taskId) }}
                            onNodeContext={(taskId, x, y) => { setCtxMenu({ x, y, taskId }) }}
                            onBlankContext={(x, y) => { setCtxMenu({ x, y, taskId: null }) }}
                          />
                        )
                        : (
                          <div className="pw-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                            任务图为空
                            <div style={{ marginTop: 14 }}>
                              <button type="button" className="pw-btn" disabled={busy} onClick={() => { void seedExample(isEmptyPlan && (status?.taskTotal ?? 0) > 0) }}>
                                {(status?.taskTotal ?? 0) > 0 ? '覆盖为示例计划' : '播种示例计划'}
                              </button>
                            </div>
                          </div>
                        )
                    ) : (
                      <div className="pw-scroll">
                        {blocks.length === 0
                          ? <div className="pw-empty">任务图为空</div>
                          : blocks.map(b => (
                            <div
                              key={b.ref}
                              className="pw-row"
                              data-clickable="true"
                              title={`${b.ref} · ${STATUS_ZH[b.status] ?? b.status}——点击查看任务详情`}
                              onClick={() => { setSelectedTaskId(b.taskId) }}
                            >
                              <span className="pw-dot" style={{ background: statusColor(b.status) }} />
                              <span className="pw-ref">{b.ref}</span>
                              <span className="pw-kind">{STATUS_ZH[b.status] ?? b.status} · {b.type === 'review' ? '评审' : '实现'}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>
          <aside className="pw-wb-side">
            <div className="pw-ar-row">
              {autoRun !== null ? (
                <span className="pw-ar-badge" data-s={autoRun.status}>
                  {autoRun.status === 'running' ? '自动推进中'
                    : autoRun.status === 'paused' ? '已暂停'
                    : autoRun.status === 'completed' ? '已完成'
                    : autoRun.status === 'failed' ? '执行失败'
                    : '已停止'}
                  {autoRun.maxSteps > 0 ? ` · ${String(autoRun.steps)}/${String(autoRun.maxSteps)} 步` : ''}
                </span>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary,#aab)' }}>Auto Run 后台自动推进</span>
              )}
            </div>
            {autoRun?.status === 'running' ? (
              <div className="pw-actions">
                <button type="button" className="pw-btn ghost" onClick={() => { void arControl('pause') }}>暂停</button>
                <button type="button" className="pw-btn danger" onClick={() => { void arControl('stop') }}>停止</button>
              </div>
            ) : autoRun?.status === 'paused' ? (
              <div className="pw-actions">
                <button type="button" className="pw-btn" disabled={busy || !hasProject} onClick={() => { void runSteps(1) }}>推进 1 步</button>
                <button type="button" className="pw-btn" onClick={() => { void arControl('resume') }}>恢复</button>
                <button type="button" className="pw-btn danger" onClick={() => { void arControl('stop') }}>停止</button>
              </div>
            ) : (
              <div className="pw-actions">
                <button type="button" className="pw-btn" disabled={busy || !hasProject} onClick={() => { void arStart() }}>
                  ▶ 自动推进（≤60 步）
                </button>
              </div>
            )}
            {autoRun !== null && autoRun.events.length > 0 ? (
              <div className="pw-ar-log" ref={arLogRef}>{
                autoRun.events.map((e, i) => <div key={String(i)}>{e}</div>)
              }</div>
            ) : null}
            {hasProject && status !== undefined ? (
              <div className="pw-progress">
                <div className="pw-kpi"><b>{`${String(status.counts.tasks.implemented ?? 0)}/${String(status.taskTotal)}`}</b><span>任务完成</span></div>
                <div className="pw-kpi"><b>{`${String(status.counts.blocks.completed ?? 0)}/${String(status.blockTotal)}`}</b><span>块完成</span></div>
                <div className="pw-kpi"><b>{String(status.nextClaimable.length)}</b><span>可认领</span></div>
              </div>
            ) : null}
            <div className="pw-actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <button type="button" className="pw-btn" disabled={busy || !hasProject} onClick={() => { void runSteps(1) }}>推进 1 步</button>
              <button type="button" className="pw-btn ghost" disabled={busy || !hasProject} onClick={() => { void runSteps(5) }}>推进 5 步</button>
              <button type="button" className="pw-btn ghost" disabled={busy || !hasProject} onClick={() => { setFormOpen(true) }}>＋ 新建任务</button>
              {hasProject
                ? (
                  <button
                    type="button"
                    className="pw-btn ghost"
                    disabled={busy}
                    onClick={() => { void seedExample((status?.taskTotal ?? 0) > 0) }}
                  >
                    {(status?.taskTotal ?? 0) > 0 ? '覆盖为示例计划' : '播种示例计划'}
                  </button>
                )
                : null}
              {selectedTask !== undefined ? (
                <button type="button" className="pw-btn danger" disabled={busy} onClick={() => { void deleteTask(selectedTask.taskId) }}>
                  删除任务 {selectedTask.taskId}
                </button>
              ) : null}
            </div>
            <div style={{ flex: 1 }} />
            <div className="pw-msg" data-kind={msgKind}>{message}</div>
          </aside>
        </div>
      </div>
      <HelpModal open={helpOpen} closing={false} onClose={() => { setHelpOpen(false) }} />
      {recView !== null ? createPortal(
        <>
          <div className="pw-rec-mask" aria-hidden="true" onClick={() => { setRecView(null) }} />
          <div className="pw-rec-card" role="dialog" aria-modal="true" aria-label="执行产物内容">
            <div className="pw-rec-head">
              <span className="pw-rec-title">{recView.record.id} · {recView.record.ref}</span>
              <span className="pw-wb-spacer" />
              <button
                type="button"
                className="pw-btn ghost"
                style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 500 }}
                title="在文件管理器中打开产物目录"
                onClick={() => { void api.reveal(recView.record.dir) }}
              >
                打开文件夹
              </button>
              <button type="button" className="pw-wb-roundbtn" aria-label="关闭" onClick={() => { setRecView(null) }}>×</button>
            </div>
            <div className="pw-rec-body">{recView.content}</div>
          </div>
        </>,
        document.body,
      ) : null}
      {ctxMenu !== null ? createPortal(
        <div
          className="pw-ctx-menu"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 190), top: Math.min(ctxMenu.y, window.innerHeight - 140) }}
          onContextMenu={e => { e.preventDefault() }}
        >
          {ctxMenu.taskId === null ? (
            <button type="button" className="pw-ctx-item" onMouseDown={() => { setCtxMenu(null); setFormOpen(true) }}>＋ 新建任务</button>
          ) : (
            <>
              <button type="button" className="pw-ctx-item" onMouseDown={() => { const id = ctxMenu.taskId; setCtxMenu(null); setSelectedTaskId(id) }}>查看详情</button>
              <div className="pw-ctx-sep" />
              <button
                type="button"
                className="pw-ctx-item danger"
                onMouseDown={() => {
                  const id = ctxMenu.taskId
                  setCtxMenu(null)
                  if (id !== null) void deleteTask(id)
                }}
              >
                删除此任务
              </button>
            </>
          )}
        </div>,
        document.body,
      ) : null}
      <TaskFormModal
        open={formOpen}
        busy={busy}
        onClose={() => { setFormOpen(false) }}
        onSubmit={input => { void createTask(input) }}
      />
    </>,
    document.body,
  )
}

/** 新建任务表单模态（中心滑入；标题必填，验收每行一条）。 */
function TaskFormModal({
  open, busy, onClose, onSubmit,
}: {
  open: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (input: { title: string; promptMarkdown: string; acceptance: string[]; withReview: boolean }) => void
}): JSX.Element | null {
  const [title, setTitle] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [prompt, setPrompt] = useState('')
  const [withReview, setWithReview] = useState(false)
  useEffect(() => {
    if (open) { setTitle(''); setAcceptance(''); setPrompt(''); setWithReview(false) }
  }, [open])
  if (!open) return null
  const valid = title.trim() !== ''
  return createPortal(
    <>
      <div className="pw-form-mask" aria-hidden="true" onClick={onClose} />
      <div className="pw-form-card" role="dialog" aria-modal="true" aria-label="新建任务">
        <h3 className="pw-form-title">新建任务</h3>
        <div className="pw-fld">
          <label htmlFor="pw-nt-title">标题 *</label>
          <input id="pw-nt-title" type="text" value={title} placeholder="例如：编写部署脚本" onChange={e => { setTitle(e.target.value) }} />
        </div>
        <div className="pw-fld">
          <label htmlFor="pw-nt-acc">验收标准（每行一条）</label>
          <textarea id="pw-nt-acc" rows={3} value={acceptance} placeholder={'脚本可在干净环境执行\n执行输出包含版本号'} onChange={e => { setAcceptance(e.target.value) }} />
        </div>
        <div className="pw-fld">
          <label htmlFor="pw-nt-prompt">执行提示词（可空，默认生成模板）</label>
          <textarea id="pw-nt-prompt" rows={4} value={prompt} placeholder="目标、边界与产出要求…" onChange={e => { setPrompt(e.target.value) }} />
        </div>
        <label className="pw-chk">
          <input type="checkbox" checked={withReview} onChange={e => { setWithReview(e.target.checked) }} />
          同时创建评审门块（实现后由评审把关）
        </label>
        <div className="ase-footer" style={{ marginTop: 14 }}>
          <button type="button" className="ase-discard" disabled={busy} onClick={onClose}>取消</button>
          <button
            type="button"
            className="ase-save"
            disabled={!valid || busy}
            onClick={() => {
              onSubmit({
                title: title.trim(),
                promptMarkdown: prompt,
                acceptance: acceptance.split(/\r?\n/).map(s => s.trim()).filter(s => s !== ''),
                withReview,
              })
            }}
          >
            {busy ? '创建中…' : '创建任务'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

/** 导航行入口（点击打开大工作台）。 */
export function PlanWeaveNavApp(): JSX.Element | null {
  ensureStyles()
  ensureNavStyles()
  ensureModalAnimStyles()
  ensureShellStyles()
  const rail = useRail()
  const [open, setOpen] = useState(false)
  const workbench = useModalClose(open, () => { setOpen(false) })
  const apiRef = useRef<PlanweaveApi | null>(null)
  if (apiRef.current === null) apiRef.current = createPlanweaveApi()

  return (
    <NavPortal name="planweave">
      <NavButton
        icon={<WeaveIcon size={rail ? 18 : 16} />}
        label="PlanWeave"
        rail={rail}
        expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      />
      <PlanWeaveWorkbench api={apiRef.current!} open={open} closing={workbench.closing} onClose={workbench.requestClose} />
    </NavPortal>
  )
}
