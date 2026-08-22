/**
 * webui — 提示词优化入口样式（运行时幂等注入 <style>）。
 *
 * 图标按钮规格对齐 DSH 官方工具行小控件（与模型座位 .webui-ms-trigger 同源）：
 * 28px 高、胶囊圆角、透明底、hover 用 interactive-bg-hover，主题变量一律走 DSH 令牌。
 * popover 面板规格对齐模型座位弹出菜单（菜单底色/阴影/圆角同源）；开关对齐官方
 * 开关规范（开启态 business-primary + 白钮，关闭态 border-l2 + 灰钮）。
 */

/** 类名常量（组件引用）。 */
export const css = {
  root: 'webui-po-root',
  trigger: 'webui-po-trigger',
  busy: 'webui-po-busy',
  panel: 'webui-po-panel',
  panelTitle: 'webui-po-panel-title',
  caption: 'webui-po-caption',
  status: 'webui-po-status',
  statusOptimizing: 'webui-po-status-optimizing',
  statusDone: 'webui-po-status-done',
  statusError: 'webui-po-status-error',
  options: 'webui-po-options',
  option: 'webui-po-option',
  optionLabel: 'webui-po-option-label',
  switch: 'webui-po-switch',
  switchOn: 'webui-po-switch-on',
  knob: 'webui-po-switch-knob',
  knobOn: 'webui-po-switch-knob-on',
  stop: 'webui-po-stop',
  panelMulti: 'webui-po-panel-multi',
  panelClosing: 'webui-po-panel-closing',
  multiBody: 'webui-po-multi-body',
  sourceBlock: 'webui-po-source',
  sourceLabel: 'webui-po-source-label',
  sourceText: 'webui-po-source-text',
  candidates: 'webui-po-candidates',
  candidate: 'webui-po-candidate',
  candidateHead: 'webui-po-candidate-head',
  candidateLabel: 'webui-po-candidate-label',
  candidateText: 'webui-po-candidate-text',
  recommendBadge: 'webui-po-recommend',
  closeCard: 'webui-po-close',
} as const

const STYLE_ID = 'dsh-webui-prompt-optimize-styles'

const SHEET = `
.webui-po-root{position:relative;display:grid;place-items:center}
.webui-po-trigger{display:grid;place-items:center;width:28px;height:28px;padding:0;border:none;border-radius:14px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.webui-po-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.webui-po-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.webui-po-trigger:disabled{opacity:.5;cursor:default}
.webui-po-busy{animation:webui-po-spin 1s linear infinite}
@keyframes webui-po-spin{to{transform:rotate(360deg)}}
.webui-po-panel{position:absolute;right:0;bottom:calc(100% + 10px);z-index:20;width:max-content;min-width:236px;max-width:320px;padding:14px 16px;border:1px solid var(--dsw-alias-border-inverted);border-radius:14px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);animation:webui-po-slide-in 160ms cubic-bezier(.2,.8,.2,1)}
/* 透明桥接：覆盖卡片与图标之间的间隙，鼠标移动时命中卡片不中断 hover。 */
.webui-po-panel::before{content:'';position:absolute;left:0;right:0;bottom:-10px;height:10px}
@keyframes webui-po-slide-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
.webui-po-panel-title{font-size:14px;font-weight:600;line-height:20px;margin-bottom:4px}
.webui-po-caption{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.webui-po-options{display:flex;flex-direction:column;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}
.webui-po-option{display:flex;align-items:center;justify-content:space-between;gap:12px}
.webui-po-option-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.webui-po-switch{position:relative;width:34px;height:18px;border-radius:9px;border:none;padding:0;cursor:pointer;flex:none;background:var(--dsw-alias-border-l2);transition:background .15s}
.webui-po-switch-on{background:var(--dsw-alias-state-business-primary)}
.webui-po-switch-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:left .15s,background .15s;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.webui-po-switch-knob-on{left:18px;background:#fff}
.webui-po-status{display:flex;align-items:center;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.webui-po-status-optimizing{color:var(--dsw-alias-state-business-primary)}
.webui-po-status-done{color:var(--dsw-alias-state-success-primary)}
.webui-po-status-error{color:var(--dsw-alias-state-error-primary)}
.webui-po-stop{display:flex;align-items:center;justify-content:center;width:100%;height:28px;margin-top:10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;font-weight:600;cursor:pointer;transition:background .15s,color .15s}
.webui-po-stop:hover{background:var(--dsw-alias-state-error-primary);color:#fff}
/* 多轮候选卡片：滑出动画（滑入沿用 .webui-po-panel 的 slide-in / glass rise）。
 * important 覆盖玻璃模式 html[data-dsh-glass] 的 rise 强制 animation。 */
.webui-po-panel-closing{animation:webui-po-slide-out 140ms cubic-bezier(.4,0,.6,1) forwards!important}
@keyframes webui-po-slide-out{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(6px)}}
.webui-po-panel-multi{position:fixed;left:0;right:0;top:0;bottom:0;margin:auto;width:800px;max-width:calc(100vw - 32px);height:fit-content;max-height:82vh;padding:20px 24px;overflow-y:auto;z-index:1000}
.webui-po-multi-body{display:flex;flex-direction:column;gap:14px;min-width:0}
.webui-po-source{margin-top:2px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.webui-po-source-label{font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.webui-po-source-text{font-size:15px;line-height:24px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
.webui-po-candidates{display:flex;flex-direction:column;gap:12px;min-width:0}
.webui-po-candidate{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:transparent;text-align:left;cursor:pointer;transition:border-color .15s,background .15s}
.webui-po-candidate:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}
.webui-po-candidate-head{display:flex;align-items:center;gap:10px}
.webui-po-candidate-label{font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.webui-po-recommend{font-size:13px;line-height:18px;font-weight:600;padding:0 8px;border-radius:6px;background:var(--dsw-alias-state-business-primary);color:#fff}
.webui-po-candidate-text{font-size:15px;line-height:24px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.webui-po-close{display:flex;align-items:center;justify-content:center;width:100%;height:36px;margin-top:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600;cursor:pointer;transition:background .15s,color .15s}
.webui-po-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
`

let injected = false

/** 注入样式表（幂等；loader 卸载插件时会移除其 style 标签）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.dataset.pluginCss = 'webui/prompt-optimize'
  tag.textContent = SHEET
  document.head.appendChild(tag)
  injected = true
}

export { injected }
