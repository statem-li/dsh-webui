/**
 * webui — 语音播报驱动（client 半身，渲染 null 的哨兵）。
 *
 * 注册在 conversation.input.right，借会话槽位拿到实时快照，做两件事：
 *
 *  1. **实时播报**：读 snapshot.chat.legacy.partial（正在流式的 assistant
 *     文本），按增量分句后逐句 POST /api/webui-voice/speak（kind=live）。
 *     用「已处理长度 + 残句缓冲」增量处理，每帧只处理新增长的部分；
 *     会话/step 切换时重置游标。关闭时 effect 直接返回，零开销。
 *  2. **总结播报**：监听回合结束（turnEnds 新增），取该回合 assistant 全文
 *     POST /api/webui-voice/summary，host 端压成「做完了什么／为什么／解决了
 *     什么问题」一句话（digest 零 token / llm 更精炼）。
 *
 * 生效判定走 store.effectivePrefs：静音 > 会话覆盖 > 全局配置；会话覆盖存在时
 * 请求带 force=true，越过 host 端全局开关。状态变化通过 subscribeVoice 订阅，
 * 开关一改立刻生效（不必等下一次流式增量）。
 *
 * 每条请求都带 sessionId 与会话名：多会话同时跑时 host 只让持话筒的会话出声，
 * 其它会话的实时句丢弃、总结加会话名前缀排队——不会几个会话交叉念成一锅粥。
 *
 * 两条防误播的硬约束：
 *  - 切进一个已有历史的会话时，先把已结束的回合全部标记为「已播」，只播之后
 *    真正新结束的回合（否则打开旧会话会从头念一遍）。
 *  - 只播 ${FRESH_END_MS}ms 内结束的回合（历史重放、快照回填一律不出声）。
 */
import { useEffect, useRef, useState } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { sanitizeForSpeech, segmentSentences } from '../../voice-text.js'
import { speakText, speakSummary } from './api'
import { effectivePrefs, subscribeVoice } from './store'
import { sessionLabel } from './session-label'

/** 回合结束多久之内才播总结（超过视为历史，不出声）。 */
const FRESH_END_MS = 60_000

/** 哨兵组件 props：owner 共享（InputZone.session = 完整会话快照）。 */
export interface VoiceAnnouncerProps {
  session: ConversationSnapshot
}

/** 该回合的全部 assistant 文本（用于总结播报）。 */
function turnAssistantText(session: ConversationSnapshot, turn: number): string {
  const keys = session.chat.locations.getTurn(turn)
  const parts: string[] = []
  for (const key of keys) {
    const node = session.chat.nodes.get(key)
    if (node === undefined || node.kind !== 'assistant-step') continue
    const data = node.data as { blocks?: readonly { kind?: string; text?: string }[] } | undefined
    for (const block of data?.blocks ?? []) {
      if (block.kind === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/** 该回合是否刚刚结束（用 turnTimings 的 endTime 判定；缺失视为不新鲜）。 */
function endedJustNow(session: ConversationSnapshot, turn: number): boolean {
  const endTime = session.turnTimings.get(turn)?.endTime
  if (typeof endTime !== 'number') return false
  const age = Date.now() - endTime
  return age >= 0 && age <= FRESH_END_MS
}

/** 播报驱动：实时增量 + 回合总结。渲染 null。 */
export function VoiceAnnouncer({ session }: VoiceAnnouncerProps): null {
  const sessionId = String(session.sessionId)

  // 生效开关：订阅 store，开关/静音一改立刻重渲染（旧版只在渲染期读取，改了要等下一帧）。
  const [prefs, setPrefs] = useState(() => effectivePrefs(sessionId))
  useEffect(() => {
    setPrefs(effectivePrefs(sessionId))
    return subscribeVoice(() => { setPrefs(effectivePrefs(sessionId)) })
  }, [sessionId])

  const liveOn = prefs.on && prefs.live
  const summaryOn = prefs.on && prefs.summary
  // 每次渲染新建：只在 effect 内即时读取，不进依赖数组。
  const contextRef = useRef({ sessionId, force: prefs.forced, label: '' })
  contextRef.current = { sessionId, force: prefs.forced, label: sessionLabel(sessionId) }

  // 实时播报状态（ref 游标，随会话/step 切换重置）。
  const lastLenRef = useRef(0)
  const restBufRef = useRef('')
  const stepKeyRef = useRef('')

  // 已总结过的回合（防重复）；切会话时用当前已结束回合做基线，避免念历史。
  const seenTurnsRef = useRef<Set<number>>(new Set())
  const baselineSessionRef = useRef<string | null>(null)
  if (baselineSessionRef.current !== sessionId) {
    baselineSessionRef.current = sessionId
    seenTurnsRef.current = new Set(session.chat.legacy.turnEnds.keys())
    lastLenRef.current = 0
    restBufRef.current = ''
    stepKeyRef.current = ''
  }

  // ── 实时播报：partial 文本增量分句 ───────────────────────────────────────
  const partial = session.chat.legacy.partial
  useEffect(() => {
    if (!liveOn) { lastLenRef.current = 0; restBufRef.current = ''; return }
    if (partial === null) return
    const key = `${partial.turn}:${partial.step}`
    if (key !== stepKeyRef.current) {
      stepKeyRef.current = key
      lastLenRef.current = 0
      restBufRef.current = ''
    }
    let text = ''
    for (const block of partial.blocks) {
      if (block.kind === 'text') text += block.text
    }
    const full = sanitizeForSpeech(text)
    if (full.length <= lastLenRef.current) return
    const delta = full.slice(lastLenRef.current)
    lastLenRef.current = full.length
    const seg = segmentSentences(restBufRef.current + delta)
    restBufRef.current = seg.rest
    for (const sentence of seg.sentences) {
      void speakText(sentence, 'live', contextRef.current)
    }
  }, [liveOn, partial, sessionId])

  // ── 总结播报：回合结束触发 ───────────────────────────────────────────────
  const turnEnds = session.chat.legacy.turnEnds
  useEffect(() => {
    // 关闭时也要推进基线：否则重新打开后会把关闭期间结束的回合一次性补播。
    if (!summaryOn) { seenTurnsRef.current = new Set(turnEnds.keys()); return }
    for (const turn of turnEnds.keys()) {
      if (seenTurnsRef.current.has(turn)) continue
      seenTurnsRef.current.add(turn)
      if (!endedJustNow(session, turn)) continue
      const text = turnAssistantText(session, turn)
      if (text.trim() !== '') void speakSummary(text, contextRef.current)
    }
  }, [summaryOn, turnEnds, session, sessionId])

  return null
}
