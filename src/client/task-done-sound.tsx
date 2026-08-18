/**
 * webui — client 半身「任务完成提示音」（自 dsh-task-done-sound 合并）。
 *
 * 基础设置开关行（localStorage 持久化）+ 回合结束（conversation.chat.turnTail）
 * 上报宿主弹卡片/播提示音。提示音实际由 host 端 PowerShell 播放，浏览器只上报。
 */
import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

// ---- 通用开关 store（localStorage 持久化，默认开启）----
function createStore<T>(storageKey: string, defaultValue: T): {
  get: () => T
  set: (next: T) => void
  subscribe: (fn: (next: T) => void) => () => void
} {
  let value = defaultValue
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw === '1' || raw === 'true') value = true as T
    else if (raw === '0' || raw === 'false') value = false as T
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: T) => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      try { localStorage.setItem(storageKey, next ? '1' : '0') } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

const doneStore = createStore('dsh.taskDoneSound.enabled', true)

// ---- 试听（仅开关行点击时调用；点击 = 用户手势，浏览器允许播放）----
function playDone(): void {
  if (!doneStore.get()) return
  try {
    const audio = new Audio('/dyn-assets/task-done.wav')
    audio.volume = 1
    const p = audio.play()
    if (p !== undefined && typeof p.catch === 'function') {
      p.catch((error) => { console.error('sound playback failed:', error) })
    }
  } catch (error) {
    console.error('sound could not start:', error)
  }
}

// ---- 设置行样式（与 General 区条目一致的 Setting-Cell 布局）----
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const textStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 48,
}
const titleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const descStyle: React.CSSProperties = { fontSize: 12, fontWeight: 400, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }

function switchStyle(on: boolean): React.CSSProperties {
  return {
    position: 'relative', flex: 'none', width: 40, height: 22, padding: 0,
    border: 'none', borderRadius: 11, cursor: 'pointer',
    background: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-module-platform)',
    transition: 'background .15s',
  }
}
function knobStyle(on: boolean): React.CSSProperties {
  return {
    position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18,
    borderRadius: '50%', background: on ? '#ffffff' : 'var(--dsw-alias-label-tertiary)',
    transition: 'left .15s, background .15s',
  }
}

// ---- 基础设置行：插件任务完成提示音 ----
function TaskDoneRow(): JSX.Element {
  const [on, setOn] = useState(doneStore.get())
  useEffect(() => doneStore.subscribe(setOn), [])

  function toggle(): void {
    const next = !doneStore.get()
    doneStore.set(next)
    setOn(next)
    if (next) playDone() // 开启时试听一次
  }

  return (
    <div style={rowStyle}>
      <div style={textStyle}>
        <div style={titleStyle}>插件任务完成提示音</div>
        <div style={descStyle}>助手每次回复结束后播放提示音</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="插件任务完成提示音"
        onClick={toggle}
        style={switchStyle(on)}
      >
        <span style={knobStyle(on)} />
      </button>
    </div>
  )
}

// ---- 回复结束检测：turn-tail 节点只在 turn/end 之后发布 ----
const PLAYED_KEY = 'dsh.taskDoneSound.played'
const ENDED_WINDOW_MS = 300000   // 回合必须在 5 分钟内结束（防历史重放误触发）
const SAME_END_TOLERANCE_MS = 5000
const DEDUPE_WINDOW_MS = 5000

interface PlayedRecord { turn: number; endedAt: number; at: number }

function playedRecords(): PlayedRecord[] {
  try {
    const raw = localStorage.getItem(PLAYED_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch { /* 忽略 */ }
  return []
}
function recentlyPlayed(turn: number, endedAt: number): boolean {
  const now = Date.now()
  for (const r of playedRecords()) {
    if (!r || typeof r.turn !== 'number' || r.turn !== turn) continue
    if (typeof r.endedAt === 'number' && Math.abs(r.endedAt - endedAt) < SAME_END_TOLERANCE_MS) return true
    if (typeof r.at === 'number' && now - r.at < DEDUPE_WINDOW_MS) return true
  }
  return false
}
function notePlayed(turn: number, endedAt: number): void {
  try {
    const keepUntil = Date.now() - 600000
    const recs = playedRecords().filter(r => r && typeof r.at === 'number' && r.at > keepUntil)
    recs.push({ turn, endedAt, at: Date.now() })
    localStorage.setItem(PLAYED_KEY, JSON.stringify(recs))
  } catch { /* 忽略 */ }
}

// 通知宿主：桌面「对话完成」卡片 + 提示音。失败重试 3 次。
function reportDone(payload: { sound: boolean; sessionId?: string; title?: string }): void {
  let attempts = 0
  function trySend(): void {
    attempts += 1
    fetch('/api/task-done-sound/conversation-done', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (!res.ok) throw new Error('http ' + res.status)
    }).catch((err) => {
      if (attempts < 3) setTimeout(trySend, 300 * attempts)
      else console.warn('[dsh-task-done-sound] conversation-done 上报失败（已重试 3 次）:', err)
    })
  }
  trySend()
}

// 当前会话标识：displayTitle → 工作目录名 → session id；sessions 未就绪返回 null。
let sessionsService: any
function currentSessionLabel(): { sessionId: string; title: string } | null {
  try {
    if (sessionsService === undefined) return null
    const snap = sessionsService.list.getSnapshot()
    const id = snap.current
    if (typeof id !== 'string' || id === '') return null
    const summary = snap.byId[id]
    if (!summary) return null
    return {
      sessionId: id,
      title: typeof summary.displayTitle === 'string' ? summary.displayTitle : '',
    }
  } catch { return null }
}

function TurnDoneSound(props: { matched?: { turn: number; endedAt: number } | null }): null {
  const matched = props.matched
  useEffect(() => {
    if (matched === null || typeof matched !== 'object') return
    const turn = matched.turn
    const endedAt = matched.endedAt
    if (typeof turn !== 'number' || typeof endedAt !== 'number') return
    const age = Date.now() - endedAt
    if (age < 0 || age > ENDED_WINDOW_MS) return
    if (recentlyPlayed(turn, endedAt)) return
    notePlayed(turn, endedAt)
    const payload: { sound: boolean; sessionId?: string; title?: string } = { sound: doneStore.get() }
    const label = currentSessionLabel()
    if (label !== null) {
      payload.sessionId = label.sessionId
      if (label.title !== '') payload.title = label.title
    }
    reportDone(payload)
  }, [matched])
  return null
}

export function apply(ctx: ClientContext): void {
  // 运行时会话服务（供卡片显示当前会话标题）；未提供时降级为仅提示音。
  try { sessionsService = (ctx as any).get('sessions') } catch { sessionsService = undefined }

  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'task-done-sound',
      order: 30,
      label: '插件任务完成提示音',
    }, TaskDoneRow))

  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: (owner: any) => ({
        turn: owner.turn.turn,
        endedAt: owner.turn.end === undefined ? 0 : owner.turn.end.time,
      }),
    }, TurnDoneSound))
}
