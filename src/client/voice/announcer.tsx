/**
 * webui — 语音播报驱动（client 半身，渲染 null 的哨兵）。
 *
 * 注册在 conversation.input.right，借会话槽位拿到实时快照，做两件事：
 *
 *  1. **实时播报**：读 snapshot.chat.legacy.partial（正在流式的 assistant
 *     文本），按增量分句后逐句 POST /api/webui-voice/speak（kind=live）。
 *     用「已处理长度 + 残句缓冲」增量处理，每帧只处理新增长的部分；
 *     会话/step 切换时重置游标。默认关闭时 effect 直接返回，零开销。
 *  2. **总结播报**：监听回合结束（turnEnds 新增），取该回合 assistant 全文
 *     POST /api/webui-voice/summary（digest/llm 由 host 决定）。
 *
 * 生效判定：本会话覆盖（store.ts）> 全局配置缓存；全局 enabled=false 时全部
 * 跳过。
 */
import { useEffect, useRef } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { sanitizeForSpeech, segmentSentences } from '../../voice-text.js'
import { speakText, speakSummary } from './api'
import { readSessionPrefs, globalPrefs } from './store'

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

/** 播报驱动：实时增量 + 回合总结。渲染 null。 */
export function VoiceAnnouncer({ session }: VoiceAnnouncerProps): null {
  const sessionId = String(session.sessionId)
  // 生效开关（渲染期取值：会话覆盖 > 全局缓存）。
  const prefs = readSessionPrefs(sessionId) ?? globalPrefs()
  const liveOn = prefs.live
  const summaryOn = prefs.summary
  const masterOn = globalPrefs().enabled

  // 实时播报状态（ref 游标，随会话/step 切换重置）。
  const lastLenRef = useRef(0)
  const restBufRef = useRef('')
  const stepKeyRef = useRef('')

  // 已总结过的回合（防重复）。
  const seenTurnsRef = useRef<ReadonlySet<number>>(new Set())

  // ── 实时播报：partial 文本增量分句 ───────────────────────────────────────
  const partial = session.chat.legacy.partial
  useEffect(() => {
    if (!masterOn || !liveOn) { lastLenRef.current = 0; restBufRef.current = ''; return }
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
      void speakText(sentence, 'live')
    }
  }, [masterOn, liveOn, partial, sessionId])

  // ── 总结播报：回合结束触发 ───────────────────────────────────────────────
  const turnEnds = session.chat.legacy.turnEnds
  useEffect(() => {
    if (!masterOn || !summaryOn) { seenTurnsRef.current = new Set(); return }
    if (turnEnds.size <= seenTurnsRef.current.size) return
    for (const turn of turnEnds.keys()) {
      if (seenTurnsRef.current.has(turn)) continue
      const text = turnAssistantText(session, turn)
      if (text.trim() !== '') void speakSummary(text)
    }
    seenTurnsRef.current = new Set(turnEnds.keys())
  }, [masterOn, summaryOn, turnEnds, session, sessionId])

  return null
}
