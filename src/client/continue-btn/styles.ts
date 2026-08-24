/**
 * webui — 一键继续（发送键融合版）样式（运行时幂等注入 <style>）。
 *
 * 中断态下哨兵会在官方主发送键正上方覆盖一层琥珀色按钮（body 直属 fixed 元素，
 * 与官方样式零层叠关系）：整颗按钮呈琥珀警示色 + 外发光呼吸，一眼可辨。
 * prefers-reduced-motion 下仅停呼吸动画，静态琥珀依旧醒目。
 */

/** 类名常量（组件引用）。 */
export const css = {
  /** body 直属的覆盖按钮 id。 */
  overlay: 'webui-cb-overlay',
  input: 'webui-cb-input',
  switch: 'webui-cb-switch',
  switchOn: 'webui-cb-switch-on',
  knob: 'webui-cb-knob',
  knobOn: 'webui-cb-knob-on',
} as const

const STYLE_ID = 'dsh-webui-continue-btn-styles'

const SHEET = `
/* 覆盖按钮：琥珀警示色 + 外发光呼吸，几何由 JS 与官方主发送键逐帧对齐 */
#webui-cb-overlay{position:fixed;z-index:1250;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:999px;padding:0;margin:0;background:#f59e0b;color:#fff;cursor:pointer;box-shadow:0 0 14px 4px rgba(245,158,11,.7);outline:2px solid rgba(245,158,11,.55);outline-offset:2px;font-family:inherit;opacity:1;transition:opacity .24s ease}
#webui-cb-overlay:hover{filter:brightness(1.1)}
#webui-cb-overlay.webui-cb-dim{opacity:0;pointer-events:none}
@keyframes webui-cb-breathe{0%,100%{box-shadow:0 0 14px 4px rgba(245,158,11,.75);outline-color:rgba(245,158,11,.9)}50%{box-shadow:0 0 26px 10px rgba(245,158,11,.15);outline-color:rgba(251,191,36,.9)}}
#webui-cb-overlay{animation:webui-cb-breathe 1.6s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){#webui-cb-overlay{animation:none}}
/* 设置行控件（对齐官方 .input 与开关规格）。 */
.webui-cb-input{display:flex;align-items:center;width:100%;max-width:280px;height:32px;padding:0 10px;font-size:14px;line-height:22px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);outline:none}
.webui-cb-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.webui-cb-input:focus{border-color:var(--dsw-alias-state-business-primary)}
.webui-cb-switch{position:relative;width:34px;height:18px;border-radius:9px;border:none;padding:0;cursor:pointer;flex:none;background:var(--dsw-alias-border-l2);transition:background .15s}
.webui-cb-switch-on{background:var(--dsw-alias-state-business-primary)}
.webui-cb-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:left .15s,background .15s;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.webui-cb-knob-on{left:18px;background:#fff}
`

let injected = false

/** 注入样式表（幂等；loader 卸载插件时会移除其 style 标签）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.dataset.pluginCss = 'webui/continue-btn'
  tag.textContent = SHEET
  document.head.appendChild(tag)
  injected = true
}

export { injected }