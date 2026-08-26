/**
 * webui — 对话框「语音播报」开关（client 半身）。
 *
 * 注册在 conversation.input.left，只影响**当前会话**。交互约定：
 *
 *  1. **左键一键总闸**：单击＝开「本会话播报＋总结播报（回复结束念结论）」，
 *     再击＝一键全关（同时停掉正在播的那句）。实时播报不强行改变，沿用既有偏好。
 *  2. **悬停展开细项**：鼠标停在图标上约 140ms 后弹出细项面板（防扫过误触），
 *     移开约 240ms 自动收起（留出挪进面板的宽限）；右键已退役，仅吞掉默认菜单。
 *  3. 会话覆盖是**双向**的：全局关着也能只为本会话打开（请求带 force 越过
 *     host 全局开关），全局开着也能只让本会话闭嘴。
 *  4. 静音态：全局运行期硬开关，一次点击掐断所有会话正在播的那句并挡住后续。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  cacheMuted, effectivePrefs, globalPrefs, isMuted, readSessionPrefs,
  subscribeVoice, writeSessionPrefs, type SessionVoicePrefs,
} from './store'
import { setMuted, stopSpeak } from './api'

/** 注入面：会话 id（覆盖按会话隔离）。 */
export interface VoiceToggleInjected {
  sessionId: SessionId
}

/** 弹层相位：closed 未挂载 / open 展开 / closing 退场动画中。 */
type PanelPhase = 'closed' | 'open' | 'closing'

/** 悬停多久后才展开（毫秒，防鼠标扫过误触）。 */
const HOVER_OPEN_MS = 140
/** 移开多久后才收起（毫秒，给「挪进弹层」留宽限）。 */
const HOVER_CLOSE_MS = 240
/** 退场动画时长（毫秒，与下方 CSS 的 webui-pop-out 保持一致）。 */
const POP_OUT_MS = 130

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
const btnMuted: React.CSSProperties = {
  ...btnBase,
  color: 'var(--dsw-alias-state-error-primary)',
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(230,80,80,0.10))',
}

/**
 * 按钮与弹层的动效（组件级一次性注入的小段 CSS）：
 * 弹层出入场、按钮 hover 微抬升与按压回弹、开启态呼吸光环；
 * prefers-reduced-motion 下全部让位。
 */
const interactionCss = `
@keyframes webuiVoicePopIn {
  from { opacity: 0; transform: translateY(7px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes webuiVoicePopOut {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(5px) scale(0.97); }
}
@keyframes webuiVoiceGlow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(65, 118, 230, 0); }
  50% { box-shadow: 0 0 9px 2px rgba(65, 118, 230, 0.30); }
}
.webui-voice-btn {
  transition: transform .18s cubic-bezier(.22, 1, .36, 1), background-color .18s ease, color .18s ease;
}
.webui-voice-btn:hover { transform: translateY(-1px) scale(1.08); }
.webui-voice-btn:active { transform: scale(.92); transition-duration: .09s; }
.webui-voice-btn.is-on { animation: webuiVoiceGlow 2.6s ease-in-out infinite; }
.webui-voice-pop { transform-origin: 50% 100%; will-change: opacity, transform; }
.webui-voice-pop.webui-pop-in { animation: webuiVoicePopIn .17s cubic-bezier(.22, 1, .36, 1) both; }
.webui-voice-pop.webui-pop-out { animation: webuiVoicePopOut .13s ease-in both; }
@media (prefers-reduced-motion: reduce) {
  .webui-voice-btn { transition: none; }
  .webui-voice-btn.is-on { animation: none; }
  .webui-voice-pop.webui-pop-in, .webui-voice-pop.webui-pop-out { animation: none; }
}
`

/** 弹层（body 直属 portal，避开设置面板 backdrop-filter containing-block）。 */
const popStyle: React.CSSProperties = {
  position: 'fixed', zIndex: 1001, width: 296,
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
const hintStyle: React.CSSProperties = {
  fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)',
}
const dividerStyle: React.CSSProperties = {
  height: 1, background: 'var(--dsw-alias-border-l2)', margin: '2px 0',
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
const dangerLink: React.CSSProperties = { ...linkStyle, color: 'var(--dsw-alias-state-error-primary)' }

function Switch(props: { on: boolean; label: string; disabled?: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button" role="switch" aria-checked={props.on} aria-label={props.label}
      disabled={props.disabled === true}
      style={{
        ...props.on ? switchOn : switchBase,
        opacity: props.disabled === true ? 0.45 : 1,
        cursor: props.disabled === true ? 'not-allowed' : 'pointer',
      }}
      onClick={props.onToggle}
    >
      <span style={props.on ? knobOn : knob} />
    </button>
  )
}

/** 对话框内语音播报开关。 */
export function VoiceToggle({ sessionId }: VoiceToggleInjected): JSX.Element {
  const sid = String(sessionId)
  const [, forceRender] = useState(0)
  const [phase, setPhase] = useState<PanelPhase>('closed')
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)

  // store 变化（本会话覆盖 / 全局缓存 / 静音，含其它标签页）即重渲染。
  useEffect(() => subscribeVoice(() => { forceRender(n => n + 1) }), [])

  const override = readSessionPrefs(sid)
  const global = globalPrefs()
  const muted = isMuted()
  const eff = effectivePrefs(sid)

  /** 写本会话覆盖（null = 恢复跟随全局）。 */
  const commit = (next: SessionVoicePrefs | null): void => {
    writeSessionPrefs(sid, next)
  }

  /**
   * 单击主按钮＝一键总闸：开＝「本会话播报＋总结播报」，关＝全停。
   *
   * 静音态下第一次点击优先解除静音（用户此刻的意图显然是「我又想听了」）。
   * 开启时总结播报必开（播报的价值在结论），实时播报沿用既有偏好不强改。
   */
  const toggleSession = (): void => {
    if (muted) {
      void setMuted(false).then((value) => { cacheMuted(value === true) })
      return
    }
    if (eff.on) {
      commit({ on: false, live: false, summary: false })
      void stopSpeak({ sessionId: sid })
      return
    }
    commit({ on: true, live: override?.live ?? global.live, summary: true })
  }

  /** 计算弹层落点：按钮上方优先，放不下再弹下方，两侧夹紧视口。 */
  const placePop = (): void => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const width = 296
    const left = Math.max(8, Math.min(rect.right - width / 2 + rect.width / 2, window.innerWidth - width - 8))
    const estimated = 300
    const top = rect.top - estimated - 8 >= 8
      ? rect.top - estimated - 8
      : Math.min(window.innerHeight - estimated - 8, Math.max(8, rect.bottom + 8))
    setPos({ left, top })
  }

  const clearOpenTimer = (): void => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
  }
  const clearCloseTimer = (): void => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }

  /** 悬停进入按钮：稍候展开；若正在收起则立刻拉回展开态。 */
  const handleEnter = (): void => {
    if (closeTimer.current !== null) {
      clearCloseTimer()
      setPhase('open')
      return
    }
    if (phase === 'open' || openTimer.current !== null) return
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      placePop()
      setPhase('open')
    }, HOVER_OPEN_MS)
  }

  /** 悬停离开（按钮或弹层）：宽限片刻后收起；尚未展开则直接取消。 */
  const handleLeave = (): void => {
    clearOpenTimer()
    if (phase !== 'open' || closeTimer.current !== null) return
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setPhase('closing')
    }, HOVER_CLOSE_MS)
  }

  /** 进入弹层本体：取消收起倒计时；收起动画中则拉回展开。 */
  const handlePopEnter = (): void => {
    clearCloseTimer()
    if (phase === 'closing') setPhase('open')
  }

  /** 请求关闭（Esc / 点击外部）：走退场动画后卸载。 */
  const requestClose = (): void => {
    clearOpenTimer()
    setPhase(p => (p === 'open' ? 'closing' : p))
  }

  // closing 相位落定为 closed（退场动画播完再卸载 DOM）。
  useEffect(() => {
    if (phase !== 'closing') return
    const t = window.setTimeout(() => { setPhase('closed') }, POP_OUT_MS)
    return () => { window.clearTimeout(t) }
  }, [phase])

  // Esc / 点击弹层外部关闭。
  useEffect(() => {
    if (phase === 'closed') return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (btnRef.current?.contains(target) === true) return
      if ((target as HTMLElement).closest?.('.webui-voice-pop') !== null) return
      requestClose()
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') requestClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [phase])

  // 卸载时清掉所有挂起的定时器。
  useEffect(() => () => { clearOpenTimer(); clearCloseTimer() }, [])

  const buttonStyle = muted ? btnMuted : eff.on ? btnActive : btnBase
  const btnClass = `webui-voice-btn${eff.on && !muted ? ' is-on' : ''}`
  const title = muted
    ? '已全局静音（点击解除静音；悬停展开设置）'
    : eff.on
      ? `本会话播报已开：${[eff.live ? '实时' : '', eff.summary ? '总结' : ''].filter(Boolean).join(' + ')}（点击一键关闭；悬停展开设置）`
      : '播报已关（点击一键开启本会话＋总结播报；悬停展开设置）'

  return (
    <>
      <style>{interactionCss}</style>
      <button
        ref={btnRef}
        type="button"
        className={btnClass}
        style={buttonStyle}
        aria-label="语音播报（本会话）"
        aria-pressed={eff.on && !muted}
        aria-haspopup="dialog"
        aria-expanded={phase === 'open'}
        title={title}
        onClick={toggleSession}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
        onContextMenu={(event) => { event.preventDefault() }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6.5 9H3.5v6h3L11 19V5z" fill={eff.on && !muted ? 'currentColor' : 'none'} />
          {muted ? (
            <>
              <path d="M16 9.5l5 5" />
              <path d="M21 9.5l-5 5" />
            </>
          ) : (
            <>
              <path d="M15 9a3.5 3.5 0 0 1 0 6" />
              <path d="M17.5 7a6.5 6.5 0 0 1 0 10" />
            </>
          )}
        </svg>
      </button>

      {phase !== 'closed' && pos !== null ? createPortal(
        <div
          className={`webui-voice-pop ${phase === 'open' ? 'webui-pop-in' : 'webui-pop-out'}`}
          style={{ ...popStyle, left: pos.left, top: pos.top }}
          role="dialog"
          aria-label="本会话语音播报"
          onMouseEnter={handlePopEnter}
          onMouseLeave={handleLeave}
        >
          <span style={popTitle}>本会话语音播报</span>

          <div style={rowStyle}>
            <span style={rowLabel}>本会话播报</span>
            <Switch
              on={eff.on && !muted} label="本会话播报" disabled={muted}
              onToggle={toggleSession}
            />
          </div>
          <div style={rowStyle}>
            <span style={rowLabel}>总结播报（回复结束念结论）</span>
            <Switch
              on={eff.summary && !muted} label="总结播报" disabled={muted}
              onToggle={() => {
                const live = override?.live ?? global.live
                commit(eff.summary ? { on: eff.on, live, summary: false } : { on: true, live, summary: true })
              }}
            />
          </div>
          <div style={rowStyle}>
            <span style={rowLabel}>实时播报（边生成边念）</span>
            <Switch
              on={eff.live && !muted} label="实时播报" disabled={muted}
              onToggle={() => {
                const summary = override?.summary ?? global.summary
                commit({ on: true, live: !eff.live, summary })
              }}
            />
          </div>

          <div style={dividerStyle} />

          <div style={rowStyle}>
            <span style={rowLabel}>
              {muted ? '已全局静音' : eff.overridden ? '已按本会话覆盖全局' : '跟随全局设置'}
              {!global.enabled && !eff.overridden ? '（全局已关闭）' : ''}
            </span>
            {eff.overridden && !muted ? (
              <button type="button" style={linkStyle} onClick={() => { commit(null) }}>恢复全局</button>
            ) : null}
          </div>

          <div style={{ ...rowStyle, gap: 12 }}>
            <button
              type="button" style={dangerLink}
              onClick={() => { void stopSpeak({ sessionId: sid }) }}
            >
              停止本会话播报
            </button>
            <button
              type="button" style={muted ? linkStyle : dangerLink}
              onClick={() => {
                void setMuted(!muted).then((value) => { cacheMuted(value === true) })
              }}
            >
              {muted ? '解除静音' : '全部静音'}
            </button>
          </div>

          <span style={hintStyle}>
            单击图标＝一键开关「本会话＋总结」播报；细项在此调整，移开自动收起。
            静音是全局硬开关。全局默认在「设置 → 通用 → 语音播报」。
          </span>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
