/**
 * webui — 提示词优化 UI 样式（运行时幂等注入 <style>，v2 重做）。
 *
 * 规格对齐 DSH 官方设计语言（见 dsh-ui-style 技能）：
 *  - 触发图标 = 官方工具行小控件：28px 高、胶囊圆角、透明底、hover 走
 *    interactive-bg-hover（与模型座位同源）。
 *  - 面板 = 官方菜单面（--dsw-specific-menu + shadow-lv3 + 14px 圆角）。
 *  - 强调色一律 --dsw-alias-state-business-primary（brand-primary 是反色，
 *    绝不能用作强调）。
 *  - 行内小按钮 28px / 12px / r14；主按钮 36px / 14px / r18。
 *
 * v2 结构：图标 → 面板（风格 chips + 结果预览 + 应用/重试）。结果先落在
 * 面板的预览区，用户点「应用」才写回输入框——旧版直接改草稿导致无法撤销、
 * 也看不清模型到底改了什么。
 */

/** 类名常量（组件引用）。 */
export const css = {
  root: 'webui-po-root',
  trigger: 'webui-po-trigger',
  triggerActive: 'webui-po-trigger-active',
  spin: 'webui-po-spin',
  panel: 'webui-po-panel',
  head: 'webui-po-head',
  title: 'webui-po-title',
  sub: 'webui-po-sub',
  close: 'webui-po-close',
  section: 'webui-po-section',
  sectionLabel: 'webui-po-section-label',
  chips: 'webui-po-chips',
  chip: 'webui-po-chip',
  chipOn: 'webui-po-chip-on',
  source: 'webui-po-source',
  result: 'webui-po-result',
  resultText: 'webui-po-result-text',
  caret: 'webui-po-caret',
  empty: 'webui-po-empty',
  status: 'webui-po-status',
  statusBusy: 'webui-po-status-busy',
  statusError: 'webui-po-status-error',
  actions: 'webui-po-actions',
  btn: 'webui-po-btn',
  btnPrimary: 'webui-po-btn-primary',
  btnGhost: 'webui-po-btn-ghost',
  btnDanger: 'webui-po-btn-danger',
  optionRow: 'webui-po-option',
  optionLabel: 'webui-po-option-label',
  switch: 'webui-po-switch',
  switchOn: 'webui-po-switch-on',
  knob: 'webui-po-knob',
  knobOn: 'webui-po-knob-on',
  hint: 'webui-po-hint',
} as const

const STYLE_ID = 'dsh-webui-prompt-optimize-styles'

const SHEET = `
.webui-po-root{position:relative;display:grid;place-items:center}
.webui-po-trigger{display:grid;place-items:center;width:28px;height:28px;padding:0;border:none;border-radius:14px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s,color .15s}
.webui-po-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.webui-po-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.webui-po-trigger:disabled{opacity:.5;cursor:default}
.webui-po-trigger-active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}
.webui-po-spin{animation:webui-po-spin 1s linear infinite}
@keyframes webui-po-spin{to{transform:rotate(360deg)}}

/* ── 面板：贴图标上方弹出（fixed 定位由组件按锚点计算，避免被输入区裁剪）── */
.webui-po-panel{position:fixed;z-index:1000;display:flex;flex-direction:column;gap:14px;box-sizing:border-box;width:min(560px,calc(100vw - 24px));max-height:min(560px,calc(100vh - 96px));padding:16px;border:1px solid var(--dsw-alias-border-inverted);border-radius:14px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);overflow:hidden;animation:webui-po-rise 160ms cubic-bezier(.2,.8,.2,1)}
@keyframes webui-po-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.webui-po-panel[data-closing='1']{animation:webui-po-sink 140ms cubic-bezier(.4,0,.6,1) forwards!important}
@keyframes webui-po-sink{from{opacity:1;transform:none}to{opacity:0;transform:translateY(8px)}}

.webui-po-head{display:flex;align-items:flex-start;gap:8px}
.webui-po-title{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:20px}
.webui-po-sub{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.webui-po-close{flex:none;display:grid;place-items:center;width:28px;height:28px;margin:-4px -4px 0 0;padding:0;border:none;border-radius:14px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.webui-po-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}

.webui-po-section{display:flex;flex-direction:column;gap:8px;min-height:0}
.webui-po-section-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.webui-po-chips{display:flex;flex-wrap:wrap;gap:8px}
.webui-po-chip{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:26px;cursor:pointer;transition:border-color .15s,color .15s,background .15s}
.webui-po-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.webui-po-chip:disabled{opacity:.5;cursor:default}
.webui-po-chip-on{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}

/* 原文 / 结果块 */
.webui-po-source,.webui-po-result{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);font-size:13px;line-height:21px;white-space:pre-wrap;word-break:break-word;overflow-y:auto}
.webui-po-source{max-height:88px;color:var(--dsw-alias-label-secondary)}
.webui-po-result{flex:1;min-height:96px;max-height:280px;color:var(--dsw-alias-label-primary)}
.webui-po-empty{color:var(--dsw-alias-label-tertiary)}
/* 流式光标：跟在已生成文本后面轻微闪烁 */
.webui-po-caret{display:inline-block;width:2px;height:14px;margin-left:1px;vertical-align:-2px;background:var(--dsw-alias-state-business-primary);animation:webui-po-blink 1s steps(2,start) infinite}
@keyframes webui-po-blink{to{visibility:hidden}}

.webui-po-status{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.webui-po-status-busy{color:var(--dsw-alias-state-business-primary)}
.webui-po-status-error{color:var(--dsw-alias-state-error-primary)}

.webui-po-option{display:flex;align-items:center;justify-content:space-between;gap:12px}
.webui-po-option-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.webui-po-switch{position:relative;width:34px;height:18px;flex:none;padding:0;border:none;border-radius:9px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .15s}
.webui-po-switch-on{background:var(--dsw-alias-state-business-primary)}
.webui-po-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);box-shadow:0 1px 2px rgba(0,0,0,.15);transition:left .15s,background .15s}
.webui-po-knob-on{left:18px;background:#fff}

.webui-po-actions{display:flex;align-items:center;gap:8px}
.webui-po-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 16px;border:1px solid transparent;border-radius:18px;font-size:14px;font-weight:500;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.webui-po-btn:disabled{opacity:.45;cursor:default}
.webui-po-btn-primary{flex:1;background:var(--dsw-alias-state-business-primary);color:#fff}
.webui-po-btn-primary:hover:not(:disabled){filter:brightness(1.08)}
.webui-po-btn-ghost{border-color:var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary)}
.webui-po-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.webui-po-btn-danger{border-color:var(--dsw-alias-state-error-primary);background:transparent;color:var(--dsw-alias-state-error-primary)}
.webui-po-btn-danger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary);color:#fff}
.webui-po-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
@media (prefers-reduced-motion:reduce){
  .webui-po-panel,.webui-po-panel[data-closing='1'],.webui-po-spin,.webui-po-caret{animation:none!important}
}
`

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
}
