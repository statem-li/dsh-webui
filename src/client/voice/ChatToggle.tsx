/**
 * webui — 对话框「语音播报」开关（client 半身）。
 *
 * 注册在 conversation.input.right（order 6，供应商标签 order 10 左侧）。
 * 只影响**当前会话**：本会话的播报总开关 + 实时/总结子开关，写入
 * localStorage（store.ts），announcer 读取后生效。点「跟随全局」清除覆盖。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { readSessionPrefs, writeSessionPrefs, globalPrefs, type SessionVoicePrefs } from './store'
import { stopSpeak } from './api'

/** 注入面：会话 id（覆盖按会话隔离）。 */
export interface VoiceToggleInjected {
  sessionId: SessionId
}

/** 按钮行内样式（对齐官方 tool-row 小图标按钮）。 */
const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, padding: 0, margin: 0,
  border: 'none', borderRadius: 8, cursor: 'pointer', flex: 'none',
  background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
}
const btnActive: React.CSSProperties = {
  ...btnBase,
  color: 'var(--dsw-alias-state-business-primary)',
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(65,118,230,0.10))',
}

/** 弹层（body 直属 portal，避开设置面板 backdrop-filter containing-block）。 */
const popStyle: React.CSSProperties = {
  position: 'fixed', zIndex: 1001, width: 280,
  display: 'flex', flexDirection: 'column', gap: 10,
  background: 'var(--dsw-alias-bg-module-platform)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12, padding: '12px 14px',
  boxShadow: '0 8px 28px rgba(0,0,0,.18)',
}
const popTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)',
}
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const rowLabel: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)',
}
const switchBase: React.CSSProperties = {
  position: 'relative', width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
  flex: 'none', background: 'var(--dsw-alias-border-l2)', transition: 'background .15s', padding: 0,
}
const switchOn: React.CSSProperties = { ...switchBase, background: 'var(--dsw-alias-state-business-primary)' }
const knob: React.CSSProperties = {
  position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: '50%',
  background: 'var(--dsw-alias-label-tertiary)', transition: 'left .15s, background .15s',
}
const knobOn: React.CSSProperties = { ...knob, left: 18, background: '#fff' }
const linkStyle: React.CSSProperties = {
  alignSelf: 'flex-start', border: 'none', background: 'none', padding: 0, cursor: 'pointer',
  fontSize: 12, color: 'var(--dsw-alias-state-business-primary)',
}

function Switch(props: { on: boolean; label: string; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button" role="switch" aria-checked={props.on} aria-label={props.label}
      style={props.on ? switchOn : switchBase}
      onClick={props.onToggle}
    >
      <span style={props.on ? knobOn : knob} />
    </button>
  )
}

/** 对话框内语音播报开关。 */
export function VoiceToggle({ sessionId }: VoiceToggleInjected): JSX.Element {
  const sid = String(sessionId)
  const [prefs, setPrefs] = useState<SessionVoicePrefs | null>(() => readSessionPrefs(sid))
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const global = globalPrefs()
  // 生效值：会话覆盖 > 全局。
  const effLive = prefs?.live ?? global.live
  const effSummary = prefs?.summary ?? global.summary
  const effectiveOn = global.enabled && (effLive || effSummary)

  const commit = (next: SessionVoicePrefs): void => {
    writeSessionPrefs(sid, next)
    setPrefs(next)
  }

  const toggleOpen = (): void => {
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      const width = 280
      const left = Math.max(8, Math.min(rect.right - width / 2 + rect.width / 2, window.innerWidth - width - 8))
      // 优先弹在按钮上方（输入框在窗口底部，弹下方会被推出视口）；上方放不下再弹下方。
      const estimated = 250
      const top = rect.top - estimated - 8 >= 8
        ? rect.top - estimated - 8
        : Math.min(window.innerHeight - estimated - 8, Math.max(8, rect.bottom + 8))
      setPos({ left, top })
    }
    setOpen(true)
  }

  // 点击外部 / Esc 关闭。
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (btnRef.current?.contains(target) === true) return
      if ((target as HTMLElement).closest?.('.webui-voice-pop') !== null) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        style={effectiveOn ? btnActive : btnBase}
        aria-label="语音播报（本会话）"
        aria-expanded={open}
        title={effectiveOn ? '语音播报已开（本会话）' : '语音播报（本会话）'}
        onClick={toggleOpen}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6.5 9H3.5v6h3L11 19V5z" fill={effectiveOn ? 'currentColor' : 'none'} />
          <path d="M15 9a3.5 3.5 0 0 1 0 6" />
          <path d="M17.5 7a6.5 6.5 0 0 1 0 10" />
        </svg>
      </button>

      {open && pos !== null ? createPortal(
        <div className="webui-voice-pop" style={{ ...popStyle, left: pos.left, top: pos.top }} role="dialog" aria-label="本会话语音播报">
          <span style={popTitle}>本会话语音播报</span>
          <div style={rowStyle}>
            <span style={rowLabel}>
              {prefs === null ? '跟随全局设置' : '已按本会话覆盖'}
              {!global.enabled ? '（全局已关闭）' : ''}
            </span>
            <button
              type="button" style={linkStyle}
              onClick={() => { writeSessionPrefs(sid, null); setPrefs(null) }}
            >
              恢复全局
            </button>
          </div>
          <div style={rowStyle}>
            <span style={rowLabel}>实时播报（边生成边念）</span>
            <Switch on={effLive} label="实时播报" onToggle={() => { commit({ live: !effLive, summary: effSummary }) }} />
          </div>
          <div style={rowStyle}>
            <span style={rowLabel}>总结播报（回复结束念总结）</span>
            <Switch on={effSummary} label="总结播报" onToggle={() => { commit({ live: effLive, summary: !effSummary }) }} />
          </div>
          <div style={rowStyle}>
            <button
              type="button" style={{ ...linkStyle, color: 'var(--dsw-alias-state-error-primary)' }}
              onClick={() => { void stopSpeak() }}
            >
              停止当前播报
            </button>
            <span style={{ ...rowLabel, textAlign: 'right', flex: 'none' }}>
              全局开关在「设置 → 通用 → 语音播报」
            </span>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
