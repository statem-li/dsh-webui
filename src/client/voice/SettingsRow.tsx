/**
 * webui — 语音播报设置行（client 半身）。
 *
 * 注册进设置「通用」分区（settings.general.item，order 37，紧随一键继续）。
 * 行内样式对齐 General 分区条目的 Setting-Cell 规格：
 *  - 总开关「语音播报」（全局默认；各会话可在对话框里单独覆盖）；
 *  - 展开后：实时播报 / 总结播报两个子开关、引擎（系统语音 / 模型语音）、
 *    音色（系统引擎列 System.Speech 全部音色，含男女与方言）、语速/音量、
 *    模型引擎的模型与音色参数、总结方式、试听 / 停止 / 静音。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { fetchVoice, saveVoice, setMuted, speakText, stopSpeak, type VoiceConfig, type VoiceOption } from './api'
import { cacheGlobal, cacheMuted } from './store'

// ---- 行布局（对齐 General 分区条目的 Setting-Cell 规格，同 glass-row）----
const groupStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const titleStyle: CSSProperties = {
  fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)',
}
const descStyle: CSSProperties = {
  fontSize: 12, fontWeight: 400, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)',
}
const fieldRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }
const fieldLabelStyle: CSSProperties = {
  fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', flex: 'none', width: 64,
}
const inputStyle: CSSProperties = {
  flex: 1, minWidth: 0, boxSizing: 'border-box', height: 32, padding: '0 10px',
  fontSize: 14, lineHeight: '22px', borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
}
const selectStyle: CSSProperties = {
  ...inputStyle, appearance: 'none', paddingRight: 28,
  backgroundImage: 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 16 16%22%3E%3Cpath d=%22M4 6l4 4 4-4%22 stroke=%22%2381858C%22 stroke-width=%221.5%22 fill=%22none%22 stroke-linecap=%22round%22/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
  cursor: 'pointer',
}
const sliderStyle: CSSProperties = {
  flex: 1, height: 32, margin: 0, accentColor: 'var(--dsw-alias-state-business-primary)', cursor: 'pointer',
}
const valueStyle: CSSProperties = {
  flex: 'none', minWidth: 40, textAlign: 'right', fontSize: 12,
  lineHeight: '18px', fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary)',
}
const pillStyle: CSSProperties = {
  flex: 'none', height: 28, borderRadius: 14, padding: '0 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
}
const switchBase: CSSProperties = {
  position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
  flex: 'none', background: 'var(--dsw-alias-border-l2)', transition: 'background .15s', padding: 0,
}
const switchOn: CSSProperties = { ...switchBase, background: 'var(--dsw-alias-state-business-primary)' }
const knob: CSSProperties = {
  position: 'absolute', top: 2, left: 2, width: 18, height: 18, borderRadius: '50%',
  background: 'var(--dsw-alias-label-tertiary)', transition: 'left .15s, background .15s',
}
const knobOn: CSSProperties = { ...knob, left: 20, background: '#fff' }
const editorStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10,
  background: 'var(--dsw-alias-bg-module-platform)', borderRadius: 12, padding: '12px 14px',
}
const inlineHint: CSSProperties = {
  fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)',
}

function Switch(props: { on: boolean; label: string; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      style={props.on ? switchOn : switchBase}
      onClick={props.onToggle}
    >
      <span style={props.on ? knobOn : knob} />
    </button>
  )
}

/** 音色的展示名：名称 + 性别 + 语言。 */
function voiceLabel(voice: VoiceOption): string {
  const gender = voice.gender === 'Male' ? '男声' : voice.gender === 'Female' ? '女声' : voice.gender
  return voice.name.includes('Online') ? `${voice.name}（在线 · ${gender}）` : `${voice.name}（${gender} · ${voice.culture}）`
}

/** 渲染「语音播报」设置行。 */
export function VoiceSettingsRow(): JSX.Element {
  const [config, setConfig] = useState<VoiceConfig | null>(null)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [models, setModels] = useState<string[]>([])
  const [muted, setMutedState] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const hintTimer = useRef<number | null>(null)

  // 初始拉取 + 刷新全局缓存（announcer 读取）。
  useEffect(() => {
    let alive = true
    void fetchVoice().then((state) => {
      if (!alive || state === null) return
      setConfig(state.config)
      setVoices(state.voices)
      setModels(state.models)
      setMutedState(state.muted)
      cacheMuted(state.muted)
      cacheGlobal({ enabled: state.config.enabled, live: state.config.live, summary: state.config.summary })
    })
    return () => { alive = false }
  }, [])

  const commit = async (patch: Partial<VoiceConfig>): Promise<void> => {
    setBusy(true)
    const next = await saveVoice(patch)
    setBusy(false)
    if (next === null) return
    setConfig(next.config)
    setVoices(next.voices)
    setModels(next.models)
    setMutedState(next.muted)
    cacheMuted(next.muted)
    cacheGlobal({ enabled: next.config.enabled, live: next.config.live, summary: next.config.summary })
  }

  const flash = (text: string): void => {
    setHint(text)
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint(''), 3000)
  }

  useEffect(() => () => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
  }, [])

  if (config === null) {
    return (
      <div style={groupStyle}>
        <div style={titleStyle}>语音播报</div>
        <div style={descStyle}>读取配置…</div>
      </div>
    )
  }

  const on = config.enabled

  return (
    <div style={groupStyle}>
      <div style={fieldRowStyle}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={titleStyle}>语音播报</div>
          <div style={descStyle}>
            {muted
              ? '已静音（运行期硬开关）——点下方「解除静音」恢复'
              : on
                ? `已开启 · ${config.engine === 'system' ? '系统语音' : '模型语音'} · ${config.systemVoice !== '' && config.engine === 'system' ? config.systemVoice : config.modelKey !== '' && config.engine === 'model' ? config.modelKey : '未选音色'}`
                : '回复结束播报一句「做完了什么／为什么／解决了什么」；各会话可在对话框图标上单独开关'}
          </div>
        </div>
        <Switch
          on={on}
          label="语音播报总开关"
          onToggle={() => { void commit({ enabled: !on }) }}
        />
      </div>

      {open && (
        <div style={editorStyle}>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>总结播报</span>
            <Switch on={config.summary} label="总结播报" onToggle={() => { void commit({ summary: !config.summary }) }} />
            <span style={{ ...inlineHint, flex: 1 }}>回复结束念一句结论（约 35 字，推荐只开这个）</span>
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>实时播报</span>
            <Switch on={config.live} label="实时播报" onToggle={() => { void commit({ live: !config.live }) }} />
            <span style={{ ...inlineHint, flex: 1 }}>边生成边逐句念——长回复会变成长篇朗读</span>
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>语音引擎</span>
            <select
              style={{ ...selectStyle, maxWidth: 220 }}
              value={config.engine}
              aria-label="语音引擎"
              disabled={busy}
              onChange={(event) => { void commit({ engine: event.target.value as 'system' | 'model' }) }}
            >
              <option value="system">系统语音（Windows）</option>
              <option value="model">模型语音（OpenAI 兼容）</option>
            </select>
          </div>

          {config.engine === 'system' ? (
            <>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>音色</span>
                <select
                  style={{ ...selectStyle, maxWidth: 260 }}
                  value={config.systemVoice}
                  aria-label="音色"
                  disabled={busy}
                  onChange={(event) => { void commit({ systemVoice: event.target.value }) }}
                >
                  <option value="">默认音色</option>
                  {voices.map(voice => (
                    <option key={voice.id} value={voice.id}>{voiceLabel(voice)}</option>
                  ))}
                </select>
                <span style={inlineHint}>含男女与方言音色（晓北·辽宁 / 晓妮·陕西 等）</span>
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>语速</span>
                <input
                  type="range" min={-10} max={10} step={1}
                  style={sliderStyle} value={config.rate}
                  aria-label="语速"
                  onChange={(event) => { void commit({ rate: Number(event.target.value) }) }}
                />
                <span style={valueStyle}>{config.rate > 0 ? `+${config.rate}` : String(config.rate)}</span>
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>音量</span>
                <input
                  type="range" min={0} max={100} step={5}
                  style={sliderStyle} value={config.volume}
                  aria-label="音量"
                  onChange={(event) => { void commit({ volume: Number(event.target.value) }) }}
                />
                <span style={valueStyle}>{config.volume}%</span>
              </div>
            </>
          ) : (
            <>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>模型</span>
                <select
                  style={{ ...selectStyle, maxWidth: 260 }}
                  value={config.modelKey}
                  aria-label="语音模型"
                  disabled={busy}
                  onChange={(event) => { void commit({ modelKey: event.target.value }) }}
                >
                  <option value="">请选择（需在模型列表开启「语音」）</option>
                  {models.map(key => <option key={key} value={key}>{key}</option>)}
                </select>
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>音色参数</span>
                <input
                  type="text" style={inputStyle}
                  value={config.modelVoice}
                  placeholder="如 alloy / nova（OpenAI）；各家自定义音色名"
                  aria-label="模型音色参数"
                  onChange={(event) => { void commit({ modelVoice: event.target.value }) }}
                />
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>语速</span>
                <input
                  type="range" min={-10} max={10} step={1}
                  style={sliderStyle} value={config.rate}
                  aria-label="语速"
                  onChange={(event) => { void commit({ rate: Number(event.target.value) }) }}
                />
                <span style={valueStyle}>{config.rate > 0 ? `+${config.rate}` : String(config.rate)}</span>
              </div>
            </>
          )}

          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>总结方式</span>
            <select
              style={{ ...selectStyle, maxWidth: 220 }}
              value={config.summaryStyle}
              aria-label="总结方式"
              disabled={busy}
              onChange={(event) => { void commit({ summaryStyle: event.target.value as 'digest' | 'llm' }) }}
            >
              <option value="digest">本地提取（零 token）</option>
              <option value="llm">模型总结（费 token）</option>
            </select>
            <span style={inlineHint}>都只念结论：做完了什么 / 原因 / 解决了什么；模型总结更凝练</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={pillStyle}
              disabled={busy}
              onClick={() => {
                void speakText('已修复对话框开关不生效的问题，原因是全局开关一票否决。', 'test')
                  .then((ok) => { flash(ok ? '' : '试听未入队（可能处于静音）') })
              }}
            >
              试听
            </button>
            <button
              type="button"
              style={pillStyle}
              onClick={() => { void stopSpeak() }}
            >
              停止播报
            </button>
            <button
              type="button"
              style={{
                ...pillStyle,
                ...muted ? {} : { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
              }}
              onClick={() => {
                void setMuted(!muted).then((value) => {
                  const next = value === true
                  setMutedState(next)
                  cacheMuted(next)
                  flash(next ? '已静音：所有会话立刻闭嘴' : '已解除静音')
                })
              }}
            >
              {muted ? '解除静音' : '立刻静音（全部会话）'}
            </button>
            {hint !== '' && <span style={inlineHint}>{hint}</span>}
          </div>
          <span style={inlineHint}>
            多会话同时跑时只有一个会话出声（先出声者持话筒），其它会话的实时句丢弃、
            总结加会话名前缀排队；静音不写配置，重启后回到未静音。
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={() => { setOpen(current => !current) }}
        style={{ ...pillStyle, alignSelf: 'flex-start' }}
      >
        {open ? '收起设置' : '展开设置'}
      </button>
    </div>
  )
}
