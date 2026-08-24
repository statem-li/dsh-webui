/**
 * webui — 对话流卡片外壳（client）。
 *
 * 两种卡：
 *  - **步骤卡**（`variant="step"`）：回合中间的 assistant 片段，极轻量——只有
 *    一条左侧竖线 + 淡纱，用来在视觉上把「一步」圈起来，不抢主回复的注意力。
 *  - **总结卡**（`variant="reply"`）：回合最终回复。带头部（完成标记 + 本轮
 *    统计 chip：用时 / 步数 / 工具次数 / 思考次数）与顶部高光，正文用 markdown
 *    渲染，底部一条极淡的分隔收口。
 *
 * 统计数字全部来自已有的会话投影（TurnLocation 的 start/end 事件、本回合的
 * assistant step 与 tool-call 节点数），不新增任何轮询或订阅。
 */
import type { ReactNode } from 'react'

/** 本轮统计（全部可缺省：拿不到就不显示对应 chip）。 */
export interface ReplyCardMeta {
  /** 本回合总耗时（ms）。 */
  readonly durationMs?: number | undefined
  /** 本回合 assistant 步数。 */
  readonly steps?: number | undefined
  /** 本回合工具调用次数。 */
  readonly tools?: number | undefined
  /** 本回合思考段数。 */
  readonly thinking?: number | undefined
}

/** 紧凑时长：1.2s / 45s / 2m30s。 */
function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const seconds = ms / 1000
  if (seconds < 10) return `${Math.round(seconds * 10) / 10}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  if (minutes < 60) return `${minutes}m${rest.toString().padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${(minutes % 60).toString().padStart(2, '0')}m`
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M2.5 6.4 4.7 8.6 9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 一枚统计 chip。 */
function Chip({ label, value, kind }: { readonly label: string; readonly value: string; readonly kind: string }): JSX.Element {
  return (
    <span className="dsh-reply-card__chip" data-kind={kind} title={`${label} ${value}`}>
      <span className="dsh-reply-card__chip-label">{label}</span>
      <span className="dsh-reply-card__chip-value">{value}</span>
    </span>
  )
}

/** 卡片外壳：step 轻量、reply 带总结头部。 */
export function FlowCard({ variant, meta, interrupted, children }: {
  readonly variant: 'step' | 'reply'
  readonly meta?: ReplyCardMeta | undefined
  readonly interrupted?: boolean | undefined
  readonly children: ReactNode
}): JSX.Element {
  if (variant === 'step') {
    return <div className="dsh-better-markdown__card dsh-better-markdown__card--step">{children}</div>
  }
  const duration = meta?.durationMs !== undefined && meta.durationMs > 0 ? formatSpan(meta.durationMs) : ''
  const steps = meta?.steps ?? 0
  const tools = meta?.tools ?? 0
  const thinking = meta?.thinking ?? 0
  return (
    <div
      className="dsh-better-markdown__card dsh-better-markdown__card--reply"
      data-interrupted={interrupted === true ? '' : undefined}
    >
      <div className="dsh-reply-card__head">
        <span className="dsh-reply-card__badge" data-interrupted={interrupted === true ? '' : undefined}>
          <CheckIcon />
          {interrupted === true ? '已中断' : '本轮完成'}
        </span>
        <span className="dsh-reply-card__chips">
          {duration !== '' && <Chip label="用时" value={duration} kind="time" />}
          {steps > 1 && <Chip label="步骤" value={String(steps)} kind="steps" />}
          {tools > 0 && <Chip label="工具" value={String(tools)} kind="tools" />}
          {thinking > 0 && <Chip label="思考" value={String(thinking)} kind="think" />}
        </span>
      </div>
      <div className="dsh-reply-card__body">{children}</div>
    </div>
  )
}
