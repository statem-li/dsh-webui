/**
 * StatsLine shadow — 覆盖原生「对话流下方统计条」(conversation.composer.dock /
 * id=stats) 的缓存命中显示。
 *
 * 原生 ui-conversation 的 StatsLine 用 Math.round 把缓存命中率取整为整数
 * (如 90%)；本组件复制其完整逻辑，仅把 cacheHitPercent 改为保留两位小数
 * (如 90.25%)。注册时以同 id + 更低 priority shadow 掉原生条目。
 *
 * 依赖说明：formatTokensPerSecond / assistantStepReading 是 ui-conversation
 * 内部未导出 helper，此处按源码复制；CSS 复制 StatsLine.module.css 的样式
 * 为插件注入样式（类名加 webui-stats- 前缀避免冲突）。
 */
import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AssistantMessageNode, ConversationSnapshot, UseProjection,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: 拉入 ui-conversation 的 SlotMap / LocaleNamespaceMap 合并（槽位注册的类型契约）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: 官方投影类型 — 同时把 tokenUsage / sessionStats 键合并进
// SessionProjectionMap（token-meter / session-stats 在各自模块里 declare module），
// 使 useProjection('tokenUsage') / useProjection('sessionStats') 有类型约束。
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/projection'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'

const NS = 'conversation'

interface WindowStats {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

/**
 * 折叠 assistant / tool-result 节点为窗口级统计（无 sessionStats 投影时的回退）。
 * 与原生 deriveStats 逐字段一致。
 */
function deriveStats(nodes: ConversationSnapshot['nodes']): WindowStats {
  const turns = new Set<number>()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    steps += 1
    if (node.timing !== undefined && node.timing.stepStartTime !== null) {
      llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
    }
    const reading = assistantStepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

/** 紧凑 token 计数：517 / 12.2K / 517K / 1.2M（千以下保留一位小数）。 */
function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** 紧凑时长：45.2s 以内带一位小数，之后 2m42s 形式。 */
function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** 解码吞吐：10 起取整，以下保留一位小数。 */
function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/** 求和三个互斥的 prompt 侧计费桶。 */
function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * 缓存命中占 prompt 侧输入的比例（精确到两位小数）。
 * 与原生的唯一差异：返回 toFixed(2) 而非 Math.round 整数。
 * @param usage - 会话 token 用量投影值。
 * @returns 两位小数字符串（如 "90.25"），无计费输入时返回 null。
 */
export function cacheHitPercent(usage: TokenUsageProjection): string | null {
  const denominator = billedInputTokens(usage)
  if (denominator === 0) return null
  return (usage.cacheReadTokens / denominator * 100).toFixed(2)
}

/** 一个 assistant step 的可推导延迟事实；null 表示该部分未记录。 */
interface StepReading {
  ttftMs: number | null
  decodeMs: number | null
  outputTokens: number | null
}

interface UsageLike {
  outputTokens?: number
}

type AssistantNode = AssistantMessageNode

function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as UsageLike).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** 读取一个 assistant 节点的 TTFT、解码耗时与输出 token（复制自 turn-metrics.ts）。 */
function assistantStepReading(node: AssistantNode): StepReading {
  const timing = node.timing
  const ttftMs = timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null
    ? Math.max(0, timing.firstTokenTime - timing.stepStartTime)
    : null
  const decodeMs = timing !== undefined && timing.firstTokenTime !== null
    ? Math.max(0, timing.completedTime - timing.firstTokenTime)
    : null
  return { ttftMs, decodeMs, outputTokens: usageOutputTokens(node.usage) }
}

/** Props: 会话快照选择器 + 投影读取座位 + locale 座位（与原生 StatsLine 相同）。 */
export interface StatsLineShadowProps {
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  useProjection: UseProjection
  t: TranslateNS<typeof NS>
}

export const StatsLineShadow = memo(function StatsLineShadow({
  useSession, useProjection, t,
}: StatsLineShadowProps) {
  const settledNodes = useSession(s => s.chat.legacy.nodes)
  const usage = useProjection('tokenUsage')
  // 优先使用持久化整日志投影；无投影时回退到窗口折叠（字段名一致）。
  const projected = useProjection('sessionStats')
  const stats = useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes])

  const groups: string[] = []
  if (stats.steps > 0) {
    groups.push(t('stats.counts', { turns: stats.turns, steps: stats.steps }))
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(t('stats.llm', { duration: formatDuration(stats.llmMs) }))
    if (stats.toolMs > 0) durations.push(t('stats.toolCall', { duration: formatDuration(stats.toolMs) }))
    if (durations.length > 0) groups.push(durations.join(' · '))
    const speeds: string[] = []
    if (stats.ttftSteps > 0) {
      speeds.push(t('stats.ttftAverage', { duration: formatDuration(stats.ttftMs / stats.ttftSteps) }))
    }
    if (stats.decodeMs > 0) {
      speeds.push(t('stats.tokensPerSecond', {
        throughput: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
      }))
    }
    if (speeds.length > 0) groups.push(speeds.join(' · '))
  }
  // 计费信息依赖持久化投影，翻页/压缩后仍稳定；仅在确有 token 活动时显示。
  if (usage !== undefined
    && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    const cacheHit = cacheHitPercent(usage)
    if (cacheHit !== null) groups.push(t('stats.cacheHit', { percent: cacheHit }))
    groups.push(t('stats.tokens', {
      input: formatTokens(billedInputTokens(usage)),
      output: formatTokens(usage.outputTokens),
    }))
  }
  const line = groups.join(' | ')

  // 超长省略 + 悬停显示完整行（仅在真正截断时启用）。
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const measure = () => { setTruncated(el.scrollWidth > el.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [line])

  if (groups.length === 0) return null
  return (
    <Tooltip label={line} side="top" delayMs={500} disabled={!truncated}>
      <div ref={rootRef} className="webui-stats-root">
        {groups.map((group, i) => (
          <Fragment key={group}>
            {i > 0 && <><span className="webui-stats-sep" aria-hidden>|</span>{' '}</>}
            <span>{group}</span>
          </Fragment>
        ))}
      </div>
    </Tooltip>
  )
})
