/**
 * ContinueSettingsRow — 「一键继续」通用设置行（client 半身）。
 *
 * 注册进设置「通用」分区（settings.general.item，order=12，紧跟玻璃质感行），
 * 行内布局对齐 glass-row 的 Setting-Cell 规格（inline style + DSH 主题令牌）：
 *  - 「继续文字」输入框：服务重启 / API 超时导致回合中断后，发送键自动变为
 *    「继续」——直接点发送（或按 Enter）即以这段文字恢复任务；
 *  - 「对话中不显示这条消息」开关（默认开）：开启时发送的文字附加零宽空格
 *    标记，客户端渲染层据此隐藏这条 user 消息（agent 仍正常收到）。
 *
 * 配置走 localStorage（store.ts），改动即时生效、刷新保持。
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { css, ensureStyles } from './styles'
import { ZWSP, readHide, readText, writeHide, writeText } from './store'

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
const fieldRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
}
const fieldLabelStyle: CSSProperties = {
  fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', flex: 'none',
}
const switchRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
}

/**
 * 渲染「一键继续」设置行。
 * @returns 设置行卡片。
 */
export function ContinueSettingsRow() {
  ensureStyles()
  // 输入框只展示「可见文字」：默认值是单个零宽空格（最小唤醒消息），在框里
  // 显示为空并由 placeholder 说明；用户填了字就按字发。
  const [text, setText] = useState<string>(() => readText().replaceAll(ZWSP, ''))
  const [hide, setHide] = useState<boolean>(readHide)

  return (
    <div style={groupStyle}>
      <div style={titleStyle}>一键继续</div>
      <div style={fieldRowStyle}>
        <span style={fieldLabelStyle}>继续文字</span>
        <input
          type="text"
          className={css.input}
          value={text}
          placeholder="留空 = 静默续跑（最省上下文）"
          aria-label="继续文字"
          onChange={(e) => {
            const next = e.target.value
            setText(next)
            // 留空 → 存单个零宽空格：能唤醒回合又几乎不占 token，界面不可见。
            writeText(next.trim() === '' ? ZWSP : next)
          }}
        />
      </div>
      <div style={switchRowStyle}>
        <span style={fieldLabelStyle}>对话中不显示这条消息</span>
        <button
          type="button"
          role="switch"
          aria-checked={hide}
          aria-label="对话中不显示继续消息"
          className={hide ? `${css.switch} ${css.switchOn}` : css.switch}
          onClick={() => { setHide(prev => { const next = !prev; writeHide(next); return next }) }}
        >
          <span className={hide ? `${css.knob} ${css.knobOn}` : css.knob} />
        </button>
      </div>
      <div style={descStyle}>
        任务没跑完（服务重启／API 超时／手动停止）时，发送键会变成琥珀色「继续」——点它即恢复任务。
        留空表示静默续跑：只发一个零宽字符唤醒回合，几乎不消耗上下文；填了文字则按文字发送。
        输入框里有你自己的内容时，继续钮自动淡出让位。
      </div>
    </div>
  )
}