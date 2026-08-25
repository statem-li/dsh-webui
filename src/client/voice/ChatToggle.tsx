/**
 * webui — 对话框「语音播报」开关（client 半身）。
 *
 * 注册在 conversation.input.left，只影响**当前会话**。旧版的三个坑这里都修了：
 *
 *  1. 生效值被 `global.enabled &&` 一票否决——全局关着时，对话框里怎么点都不响，
 *     「开关跟没开一样」。现在会话覆盖是**双向**的：全局关着也能只为本会话打开
 *     （请求带 force 越过 host 全局开关），全局开着也能只让本会话闭嘴。
 *  2. 主按钮只是个「打开弹层」的入口，没有一键开关语义。现在**单击即开关本会话**，
 *     右键 / 长按（或点箭头）才展开细项。
 *  3. 没有「立刻别念了」的入口。现在按钮上带静音态：静音是全局运行期硬开关，
 *     一次点击掐断所有会话正在播的那句，并挡住后续所有播报。
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
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

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
   * 单击主按钮：开关**本会话**播报。
   *
   * 静音态下第一次点击优先解除静音（用户此刻的意图显然是「我又想听了」）。
   * 从关到开时补齐子开关：若本会话/全局都没开过任何一项，默认只开总结播报——
   * 播报的价值在结论，实时朗读长篇是噪音。
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
    const live = override?.live ?? global.live
    const summary = override?.summary ?? global.summary
    commit(live || summary ? { on: true, live, summary } : { on: true, live: false, summary: true })
  }

  const toggleOpen = (): void => {
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      const width = 296
      const left = Math.max(8, Math.min(rect.right - width / 2 + rect.width / 2, window.innerWidth - width - 8))
      // 优先弹在按钮上方（输入框在窗口底部，弹下方会被推出视口）；上方放不下再弹下方。
      const estimated = 300
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

  const buttonStyle = muted ? btnMuted : eff.on ? btnActive : btnBase
  const title = muted
    ? '已静音（点击恢复；右键展开设置）'
    : eff.on
      ? `本会话播报已开：${[eff.live ? '实时' : '', eff.summary ? '总结' : ''].filter(Boolean).join(' + ')}（点击关闭；右键展开设置）`
      : '本会话播报已关（点击开启；右键展开设置）'

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        style={buttonStyle}
        aria-label="语音播报（本会话）"
        aria-pressed={eff.on && !muted}
        aria-expanded={open}
        title={title}
        onClick={toggleSession}
        onContextMenu={(event) => { event.preventDefault(); toggleOpen() }}
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

      {open && pos !== null ? createPortal(
        <div className="webui-voice-pop" style={{ ...popStyle, left: pos.left, top: pos.top }} role="dialog" aria-label="本会话语音播报">
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
                commit({ on: true, live, summary: !eff.summary })
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
            单击图标即开关本会话；静音是全局硬开关，立刻掐断所有会话。
            全局默认在「设置 → 通用 → 语音播报」。
          </span>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
