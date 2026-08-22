/**
 * webui — 「玻璃质感」设置行（client 半身）。
 *
 * 在设置「通用」分区（settings.general.item）注册一行，紧随官方「外观」行
 * （id=appearance, order=10）之后（order=11），视觉复刻官方 AppearanceRow 的
 * cube 规格（圆角 16、居中图标+文字、选中态 module-platform 底 + bluish-400
 * 边框），使「玻璃质感」作为外观选项与浅色/深色/跟随系统并列展示。
 *
 * 行内包含：
 *  - cube 开关卡：点击切换玻璃拟态材质（与色调偏好正交，浅色/深色下均可用）；
 *  - 「玻璃不透明度」滑块（40–95%，步进 5）：拖动即时预览，松手落盘；
 *    拖动时若尚未开启则自动开启。
 *
 * 状态经 glass.ts 双通道持久化（localStorage + settings.yaml），刷新/重启后保持。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import {
  GLASS_OPACITY_DEFAULT, GLASS_OPACITY_MAX, GLASS_OPACITY_MIN,
  getGlassOpacity, isGlassOn, setGlassMode, setGlassOpacity,
} from './glass'

// ---- 行布局（对齐 General 分区条目 / 官方 AppearanceRow 的 Setting-Cell 规格）----
const groupStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const titleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)',
}
const descStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 400, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)',
}

/** cube 内的毛玻璃预览小方块：渐变底 + blur + 高光边，直观传达「玻璃」。 */
const previewStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10,
  background: 'linear-gradient(135deg, rgba(103,158,254,.55), rgba(167,139,250,.45) 55%, rgba(45,212,191,.40))',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.45)',
}

/** cube 按钮（官方 .themeCube 规格：radius 16、padding 20/32、column 居中）。 */
function cubeStyle(selected: boolean): React.CSSProperties {
  return {
    boxSizing: 'border-box',
    width: '100%',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: '20px 32px',
    borderRadius: 16,
    border: `1px solid ${selected ? 'var(--dsw-static-neutral-bluish-400)' : 'var(--dsw-alias-border-l2)'}`,
    background: selected ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
    font: 'inherit', fontSize: 14, lineHeight: '22px',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer', textAlign: 'center',
  }
}

/** 不透明度滑块行：标签 + range + 数值（控件规格对齐 DSH 32px 控件语言）。 */
function opacitySliderStyle(): React.CSSProperties {
  return {
    accentColor: 'var(--dsw-alias-state-business-primary)',
    flex: 1, height: 32, margin: 0, cursor: 'pointer',
  }
}
const sliderRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px',
}
const sliderLabelStyle: React.CSSProperties = {
  flex: 'none', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)',
}
const sliderValueStyle: React.CSSProperties = {
  flex: 'none', minWidth: 40, textAlign: 'right',
  fontSize: 12, lineHeight: '18px', fontVariantNumeric: 'tabular-nums',
  color: 'var(--dsw-alias-label-primary)',
}

function GlassRow({ theme }: { theme?: ThemeRuntime }): JSX.Element {
  const [on, setOn] = useState<boolean | null>(null) // null = 初始化中
  const [op, setOp] = useState<number>(GLASS_OPACITY_DEFAULT)

  useEffect(() => {
    // 启动恢复由 bootGlass 在插件装配时完成，这里只同步本地缓存到 UI。
    setOn(isGlassOn())
    setOp(getGlassOpacity())
  }, [])

  const toggle = useCallback(() => {
    const next = !(on === true)
    setOn(next)
    setGlassMode(next, theme)
  }, [on, theme])

  /** 拖动中：即时预览（重挂 token 层 + 写本地缓存），不落盘服务端。 */
  const onSlide = useCallback((raw: string) => {
    const v = Number(raw)
    if (!Number.isFinite(v)) return
    setOp(setGlassOpacity(v, theme))
    // 拖动即视为想要玻璃效果：未开启时自动开启。
    if (!isGlassOn()) {
      setOn(true)
      setGlassMode(true, theme)
    }
  }, [theme])

  /** 松手/松键：把最终值落盘 settings.yaml。 */
  const commit = useCallback(() => {
    setGlassOpacity(op, theme, { persist: true })
  }, [op, theme])

  return (
    <div style={groupStyle}>
      <div style={titleStyle}>玻璃质感</div>
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-label="玻璃质感"
        onClick={toggle}
        disabled={on === null}
        style={cubeStyle(on === true)}
      >
        <span style={{ display: 'inline-flex', borderRadius: 10 }}>
          <span style={previewStyle} />
        </span>
        {on === true ? '已开启' : '开启'}
      </button>
      <div style={sliderRowStyle}>
        <span style={sliderLabelStyle}>玻璃不透明度</span>
        <input
          type="range"
          min={GLASS_OPACITY_MIN}
          max={GLASS_OPACITY_MAX}
          step={5}
          value={op}
          aria-label="玻璃不透明度"
          onChange={(e) => { onSlide(e.currentTarget.value) }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          style={opacitySliderStyle()}
        />
        <span style={sliderValueStyle}>{`${op}%`}</span>
      </div>
      <div style={descStyle}>半透明毛玻璃材质（模糊背景 + 高光细边 + 柔和投影），可与上方浅色/深色任意组合；数值越大越不透，拖动即时生效</div>
    </div>
  )
}

/** 注册设置行到「通用」分区（紧跟官方外观行之后）。 */
export function registerGlassSetting(ctx: ClientContext): void {
  // ctx.theme 由宿主 ui-theme 提供（Context 声明经 type-only import 合并）。
  const theme = ctx.theme as ThemeRuntime | undefined
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'glass-appearance',
      order: 11,
      label: '玻璃质感',
    }, () => <GlassRow theme={theme} />))
}
