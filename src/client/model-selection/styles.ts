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
  msBody: 'webui-ms-body',
  msProviders: 'webui-ms-providers',
  msProvider: 'webui-ms-provider',
  msProviderActive: 'webui-ms-provider-active',
  msModels: 'webui-ms-models',
  msOption: 'webui-ms-option',
  msSelected: 'webui-ms-selected',
  msOptionCopy: 'webui-ms-option-copy',
  msModelName: 'webui-ms-model-name',
  msDescription: 'webui-ms-description',
  msCheck: 'webui-ms-check',
  // 推理等级座位
  effRoot: 'webui-eff-root',
  effTrigger: 'webui-eff-trigger',
  effLabel: 'webui-eff-label',
  effPanel: 'webui-eff-panel',
  effPanelHead: 'webui-eff-panel-head',
  effPanelTitle: 'webui-eff-panel-title',
  effPanelValue: 'webui-eff-panel-value',
  effSlider: 'webui-eff-slider',
  effSliderDrag: 'webui-eff-slider-drag',
  effTicks: 'webui-eff-ticks',
  effTick: 'webui-eff-tick',
  effTickOn: 'webui-eff-tick-on',
  effTickAt: 'webui-eff-tick-at',
  effThumb: 'webui-eff-thumb',
  effThumbCore: 'webui-eff-thumb-core',
  effThumbRing: 'webui-eff-thumb-ring',
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
.webui-ms-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;width:min(420px,calc(100vw - 32px));max-height:min(420px,calc(100vh - 96px));overflow:hidden;padding:4px;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.webui-ms-status,.webui-ms-empty{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.webui-ms-error,.webui-ms-warning{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.webui-ms-warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}
.webui-ms-retry{flex:0 0 auto;padding:0;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.webui-ms-groups{min-height:0;overflow-y:auto}
/* 两栏：左供应商 / 右模型 */
.webui-ms-body{flex:1;min-height:0;display:flex;overflow:hidden}
.webui-ms-providers{flex:0 0 132px;min-height:0;overflow-y:auto;padding:4px;border-right:1px solid var(--dsw-alias-border-l3,#2a2d35)}
.webui-ms-provider{display:block;width:100%;padding:7px 10px;border:none;border-radius:8px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:13px;line-height:18px;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.webui-ms-provider:hover,.webui-ms-provider:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.webui-ms-provider-active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary,#eee);font-weight:600}
.webui-ms-models{flex:1;min-width:0;min-height:0;overflow-y:auto;padding:4px}
.webui-ms-option{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:6px 8px;border:none;border-radius:10px;outline:none;background:transparent;color:inherit;text-align:left;cursor:pointer}
.webui-ms-option:hover:not(:disabled),.webui-ms-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.webui-ms-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.webui-ms-option-copy{display:flex;flex:1;flex-direction:column;min-width:0}
.webui-ms-model-name{overflow:hidden;color:inherit;font-size:14px;line-height:20px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.webui-ms-description{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.webui-ms-check{display:grid;place-items:center;flex:0 0 18px;color:var(--dsw-alias-label-primary)}

/* ---- 推理等级滑动式弹出 ----
 * 视觉：无轨道长条。整块「星空极光」画布本身就是滑杆——极光带铺到当前
 * 档位处，星尘细小闪烁；档位靠刻度点 + 档位名标识，滑块是一颗亮星。
 * 色相随档位跨度大（青绿 → 品红紫），一眼能看出等级差异。
 * 动效在 prefers-reduced-motion 下降级为无动画。 */
.webui-eff-root{position:relative;min-width:0}
.webui-eff-trigger{display:inline-flex;align-items:center;height:28px;padding:0 8px;border:none;border-radius:14px;background:transparent;color:var(--dsw-alias-label-caption,#9aa0a8);font-size:12px;line-height:20px;white-space:nowrap;cursor:pointer;transition:color 140ms ease,background-color 140ms ease}
.webui-eff-trigger:hover:not(:disabled){color:var(--dsw-alias-label-primary,#ddd);background:var(--dsw-alias-interactive-bg-hover)}
.webui-eff-trigger[aria-expanded="true"]{color:var(--dsw-alias-label-primary,#ddd)}
.webui-eff-trigger:disabled{opacity:.5;cursor:default}
.webui-eff-label{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.webui-eff-panel{position:absolute;right:0;bottom:calc(100% + 10px);z-index:20;width:min(340px,calc(100vw - 32px));padding:12px 14px 10px;border:1px solid var(--dsw-alias-border-inverted);border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);animation:webui-eff-rise 160ms cubic-bezier(.2,.9,.25,1);transform-origin:100% 100%}
/* 透明桥接：覆盖面板与按钮之间的间隙，鼠标从按钮移入面板时不中断 hover。 */
.webui-eff-panel::before{content:'';position:absolute;left:0;right:0;bottom:-10px;height:10px}
@keyframes webui-eff-rise{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
.webui-eff-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:2px}
.webui-eff-panel-title{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#bbb)}
.webui-eff-panel-value{font-size:12px;font-weight:600;color:var(--eff-accent,var(--dsw-alias-state-business-primary));animation:webui-eff-value-in 200ms cubic-bezier(.2,.9,.25,1)}
@keyframes webui-eff-value-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}

/* 滑杆本体完全透明：无底色面、无描边、无进度纱 —— 只有画布里的光尘。 */
.webui-eff-slider{position:relative;height:48px;display:flex;align-items:center;cursor:pointer;touch-action:none;user-select:none;border-radius:12px;background:transparent;transition:transform 180ms cubic-bezier(.2,.9,.25,1)}
.webui-eff-slider:focus-visible{outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--eff-accent,#679efe) 35%,transparent)}
.webui-eff-slider-drag{transform:scale(1.012)}
.webui-eff-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}

/* 刻度点：极细小的星点标记档位，已越过的点跟随主色亮起。 */
.webui-eff-ticks{position:absolute;left:10px;right:10px;top:50%;height:0;pointer-events:none}
.webui-eff-tick{position:absolute;top:0;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:var(--dsw-alias-label-dimmed,#5a616b);transition:background-color 220ms ease,transform 220ms cubic-bezier(.22,1.2,.36,1),opacity 220ms ease;opacity:.75}
.webui-eff-tick-on{background:var(--eff-accent,#679efe);opacity:1;box-shadow:0 0 6px color-mix(in srgb,var(--eff-accent,#679efe) 50%,transparent)}
.webui-eff-tick-at{opacity:0}

/* 滑块 = 一颗亮星：白核 + 主色光晕 + 呼吸光环（--eff-pulse 由 JS 给周期）。 */
.webui-eff-thumb{position:absolute;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;pointer-events:none;transition:left 300ms cubic-bezier(.22,1.2,.36,1),transform 180ms cubic-bezier(.22,1.2,.36,1)}
.webui-eff-slider-drag .webui-eff-thumb{transform:scale(1.15)}
.webui-eff-thumb-core{position:absolute;inset:2.5px;border-radius:50%;background:var(--eff-accent,#679efe);box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1,#fff),0 0 10px 1px color-mix(in srgb,var(--eff-accent,#679efe) 65%,transparent)}
.webui-eff-thumb-ring{position:absolute;inset:0;border-radius:50%;border:1px solid color-mix(in srgb,var(--eff-accent,#679efe) 65%,transparent);animation:webui-eff-pulse var(--eff-pulse,1.6s) ease-out infinite}
@keyframes webui-eff-pulse{0%{transform:scale(.9);opacity:.6}70%{transform:scale(2.4);opacity:0}100%{transform:scale(2.4);opacity:0}}
.webui-eff-thumb-glow{position:absolute;inset:-10px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--eff-accent,#679efe) 34%,transparent),transparent 70%)}

.webui-eff-labels{display:flex;justify-content:space-between;gap:4px;margin-top:0}
.webui-eff-labels-item{flex:1;min-width:0;text-align:center;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color 200ms ease,transform 200ms cubic-bezier(.22,1.2,.36,1);cursor:pointer}
.webui-eff-labels-item:hover{color:var(--dsw-alias-label-secondary,#bbb)}
.webui-eff-labels-item-on{color:var(--dsw-alias-label-primary,#eee);font-weight:600;transform:scale(1.04)}
.webui-eff-empty{margin-top:4px;padding:6px 2px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-align:center;animation:webui-eff-value-in 220ms cubic-bezier(.2,.9,.25,1)}
.webui-eff-busy{opacity:.55;pointer-events:none}

@media (prefers-reduced-motion: reduce){
  .webui-eff-panel,.webui-eff-panel-value,.webui-eff-empty{animation:none}
  .webui-eff-thumb-ring{animation:none}
  .webui-eff-thumb,.webui-eff-tick,.webui-eff-labels-item,.webui-eff-slider{transition:none}
}
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

/**
 * 档位色相：品牌蓝 → 靛紫（deepseek 品牌色家族内的窄带，等级差异可辨，
 * 又不会跳出 DSH 主题；柔光雾沿轨道从 212° 渐变到当前档位色）。
 * @param i - 档位序号。
 * @param n - 档位总数。
 */
export function effortHue(i: number, n: number): number {
  if (n <= 1) return 212
  const t = Math.min(1, Math.max(0, i / (n - 1)))
  return Math.round(212 + t * 54) // 212(品牌蓝) → 266(靛紫)
}

/** 色相 → 强调色（滑块 / 填充带 / 光点共用）。 */
export function hueColor(hue: number): string {
  return `hsl(${hue} 88% 60%)`
}
