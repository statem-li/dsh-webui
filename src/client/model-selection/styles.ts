/**
 * dsh-webui 模型选择增强 — 样式（运行时幂等注入 <style>）。
 *
 * 拆分后的两个入口：
 *  - `.webui-ms-*`：纯模型选择器（接管 `conversation.input.model` 座位）。
 *  - `.webui-eff-*`：推理等级滑动式弹出（含渐变轨道 + 粒子 canvas）。
 * 颜色走 DSH 主题令牌，渐变/粒子用固定 HSL 保证高饱和观感。
 */

export const css = {
  // 模型座位
  msRoot: 'webui-ms-root',
  msTrigger: 'webui-ms-trigger',
  msTriggerLabel: 'webui-ms-trigger-label',
  msChevron: 'webui-ms-chevron',
  msChevronOpen: 'webui-ms-chevron-open',
  msMenu: 'webui-ms-menu',
  msStatus: 'webui-ms-status',
  msEmpty: 'webui-ms-empty',
  msError: 'webui-ms-error',
  msWarning: 'webui-ms-warning',
  msRetry: 'webui-ms-retry',
  msGroups: 'webui-ms-groups',
  msGroup: 'webui-ms-group',
  msGroupTitle: 'webui-ms-group-title',
  msOption: 'webui-ms-option',
  msSelected: 'webui-ms-selected',
  msOptionCopy: 'webui-ms-option-copy',
  msModelName: 'webui-ms-model-name',
  msDescription: 'webui-ms-description',
  msCheck: 'webui-ms-check',
  // 推理等级座位
  effRoot: 'webui-eff-root',
  effTrigger: 'webui-eff-trigger',
  effDot: 'webui-eff-dot',
  effDotHalo: 'webui-eff-dot-halo',
  effLabel: 'webui-eff-label',
  effPanel: 'webui-eff-panel',
  effPanelHead: 'webui-eff-panel-head',
  effPanelTitle: 'webui-eff-panel-title',
  effPanelValue: 'webui-eff-panel-value',
  effSlider: 'webui-eff-slider',
  effTrack: 'webui-eff-track',
  effFill: 'webui-eff-fill',
  effTick: 'webui-eff-tick',
  effTickOn: 'webui-eff-tick-on',
  effThumb: 'webui-eff-thumb',
  effThumbGlow: 'webui-eff-thumb-glow',
  effCanvas: 'webui-eff-canvas',
  effLabels: 'webui-eff-labels',
  effLabelsItem: 'webui-eff-labels-item',
  effLabelsItemOn: 'webui-eff-labels-item-on',
  effEmpty: 'webui-eff-empty',
  effBusy: 'webui-eff-busy',
} as const

const STYLE_ID = 'dsh-webui-model-selection-styles'

const SHEET = `
/* ---- 纯模型选择器（接管 model 座位，不含推理等级） ---- */
.webui-ms-root{position:relative;min-width:0}
.webui-ms-trigger{display:flex;align-items:center;gap:4px;min-width:0;max-width:220px;height:28px;padding:0 4px 0 8px;border:none;border-radius:24px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500;cursor:pointer}
.webui-ms-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.webui-ms-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.webui-ms-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.webui-ms-trigger-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.webui-ms-chevron{flex:0 0 auto;color:var(--dsw-alias-label-caption);transition:transform 120ms ease}
.webui-ms-chevron-open{transform:rotate(180deg)}
.webui-ms-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;width:min(240px,calc(100vw - 32px));max-height:min(360px,calc(100vh - 96px));overflow:hidden;padding:4px;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.webui-ms-status,.webui-ms-empty{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.webui-ms-error,.webui-ms-warning{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.webui-ms-warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}
.webui-ms-retry{flex:0 0 auto;padding:0;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.webui-ms-groups{min-height:0;overflow-y:auto}
.webui-ms-group + .webui-ms-group{margin-top:4px}
.webui-ms-group-title{position:sticky;top:0;z-index:1;padding:5px 8px 3px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-weight:500}
.webui-ms-option{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:6px 8px;border:none;border-radius:10px;outline:none;background:transparent;color:inherit;text-align:left;cursor:pointer}
.webui-ms-option:hover:not(:disabled),.webui-ms-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.webui-ms-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.webui-ms-option-copy{display:flex;flex:1;flex-direction:column;min-width:0}
.webui-ms-model-name{overflow:hidden;color:inherit;font-size:14px;line-height:20px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.webui-ms-description{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.webui-ms-check{display:grid;place-items:center;flex:0 0 18px;color:var(--dsw-alias-label-primary)}

/* ---- 推理等级滑动式弹出 ---- */
.webui-eff-root{position:relative;min-width:0}
.webui-eff-trigger{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 10px 0 8px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:11px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-secondary,#bbb);font-size:12px;line-height:1;white-space:nowrap;cursor:pointer}
.webui-eff-trigger:hover:not(:disabled){border-color:var(--dsw-alias-border-l1,#555);color:var(--dsw-alias-label-primary,#ddd)}
.webui-eff-trigger:disabled{opacity:.5;cursor:default}
.webui-eff-dot{position:relative;flex:0 0 auto;width:10px;height:10px;border-radius:50%;background:var(--eff-dot-color,#4a9eff);box-shadow:0 0 8px color-mix(in srgb,var(--eff-dot-color,#4a9eff) 70%,transparent)}
.webui-eff-dot-halo{position:absolute;inset:-3px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--eff-dot-color,#4a9eff) 55%,transparent),transparent 70%);filter:blur(2px)}
.webui-eff-label{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.webui-eff-panel{position:absolute;right:0;bottom:calc(100% + 10px);z-index:20;width:min(320px,calc(100vw - 32px));padding:14px 16px 12px;border:1px solid var(--dsw-alias-border-inverted);border-radius:16px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);animation:webui-eff-slide-in 180ms cubic-bezier(.2,.8,.2,1)}
@keyframes webui-eff-slide-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.webui-eff-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:12px}
.webui-eff-panel-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#ddd)}
.webui-eff-panel-value{font-size:12px;color:var(--dsw-alias-label-caption,#888)}
.webui-eff-slider{position:relative;height:40px;display:flex;align-items:center;cursor:pointer;touch-action:none;user-select:none}
.webui-eff-track{position:absolute;left:10px;right:10px;top:50%;transform:translateY(-50%);height:8px;border-radius:4px;background:linear-gradient(90deg,#3b82f6 0%,#8b5cf6 42%,#ec4899 74%,#f97316 100%);opacity:.9}
.webui-eff-fill{position:absolute;left:10px;top:50%;transform:translateY(-50%);height:8px;border-radius:4px;background:transparent}
.webui-eff-tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:50%;background:var(--dsw-specific-menu,#16181d);box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 55%,transparent)}
.webui-eff-tick-on{box-shadow:inset 0 0 0 2px var(--eff-dot-color,#4a9eff),0 0 6px color-mix(in srgb,var(--eff-dot-color,#4a9eff) 60%,transparent)}
.webui-eff-thumb{position:absolute;top:50%;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;background:var(--eff-dot-color,#4a9eff);box-shadow:0 0 0 3px var(--dsw-specific-menu,#16181d),0 0 14px color-mix(in srgb,var(--eff-dot-color,#4a9eff) 75%,transparent);pointer-events:none;transition:left 60ms ease-out}
.webui-eff-thumb-glow{position:absolute;inset:-8px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--eff-dot-color,#4a9eff) 45%,transparent),transparent 70%);filter:blur(3px)}
.webui-eff-canvas{position:absolute;inset:-6px -4px;width:calc(100% + 8px);height:calc(100% + 12px);pointer-events:none}
.webui-eff-labels{display:flex;justify-content:space-between;gap:4px;margin-top:8px}
.webui-eff-labels-item{flex:1;min-width:0;text-align:center;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.webui-eff-labels-item-on{color:var(--dsw-alias-label-primary,#eee);font-weight:600}
.webui-eff-empty{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center}
.webui-eff-busy{opacity:.55;pointer-events:none}
`

let injected = false

/** 注入样式表（幂等；loader 卸载插件时会移除其 style 标签）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.dataset.pluginCss = 'webui/model-selection'
  tag.textContent = SHEET
  document.head.appendChild(tag)
  injected = true
}

/** 计算第 i 档（共 n 档）的色相：低等级冷色 → 高等级暖色。 */
export function effortHue(i: number, n: number): number {
  if (n <= 1) return 210
  const t = i / (n - 1)
  return Math.round(215 - t * 200) // 215(蓝) → 15(橙红)
}

/** 色相 → 明亮主色（供 thumb / dot / 粒子共用）。 */
export function hueColor(hue: number): string {
  return `hsl(${hue} 92% 58%)`
}
