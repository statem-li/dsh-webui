/**
 * dsh-image-gallery — 样式（运行时注入 <style>，卸载时移除）。
 * 类名前缀 gig-；颜色走 DSH 主题令牌（--dsw-alias-*），缺省兜底深色值。
 */

export const css = {
  gallery: 'gig-gallery',
  head: 'gig-head',
  row: 'gig-row',
  item: 'gig-item',
  thumb: 'gig-thumb',
  badge: 'gig-badge',
  backdrop: 'gig-backdrop',
  stage: 'gig-stage',
  full: 'gig-full',
  broken: 'gig-broken',
  metaLine: 'gig-meta-line',
  model: 'gig-model',
  hint: 'gig-hint',
  saveButton: 'gig-save-button',
  saveIcon: 'gig-save-icon',
  hintLine: 'gig-hint-line',
} as const

const STYLE_ID = 'dsh-image-gallery-styles'

const SHEET = `
.gig-gallery{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#16181d)}
.gig-head{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#bbb)}
.gig-row{display:flex;flex-wrap:wrap;gap:10px}
.gig-item{position:relative;display:block;padding:0;border:none;border-radius:10px;background:transparent;cursor:zoom-in;overflow:hidden;flex:0 0 auto;line-height:0}
.gig-item:hover .gig-thumb{outline:2px solid var(--dsw-alias-state-business-primary,#4a9eff);outline-offset:-2px}
.gig-thumb{display:block;max-width:min(220px,38vw);max-height:190px;min-width:80px;object-fit:cover;border-radius:10px;transition:outline 120ms}
.gig-badge{position:absolute;left:6px;bottom:6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;line-height:18px;text-align:center;font-weight:600}
.gig-backdrop{position:fixed;inset:0;z-index:6000;display:flex;align-items:center;justify-content:center;background:rgba(8,10,14,.78);backdrop-filter:blur(2px);animation:gig-fade .16s ease-out}
.gig-stage{position:relative;display:flex;flex-direction:column;gap:10px;max-width:92vw;max-height:92vh}
.gig-full{display:block;max-width:92vw;max-height:82vh;object-fit:contain;border-radius:8px;box-shadow:0 12px 48px rgba(0,0,0,.55);cursor:zoom-out}
.gig-broken{display:flex;align-items:center;justify-content:center;min-width:280px;min-height:160px;border:1px dashed var(--dsw-alias-border-l2,#444);border-radius:10px;color:var(--dsw-alias-label-tertiary,#888);font-size:13px}
.gig-meta-line{display:flex;align-items:center;gap:10px;justify-content:center;font-size:11px;color:var(--dsw-alias-label-secondary,#bbb)}
.gig-model{font-family:var(--dsw-font-mono,ui-monospace,Menlo,monospace);color:var(--dsw-alias-label-tertiary,#888)}
.gig-save-button{position:absolute;top:12px;right:12px;z-index:5;display:flex;align-items:center;gap:7px;padding:8px 18px;border:none;border-radius:20px;background:var(--dsw-alias-state-business-primary,#4a9eff);color:#fff;font-size:12px;font-weight:600;line-height:1.3;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.45);transition:filter 120ms,transform 120ms}
.gig-save-button:hover:not(:disabled){filter:brightness(1.12);transform:translateY(-1px)}
.gig-save-button:active:not(:disabled){transform:translateY(0)}
.gig-save-button:disabled{opacity:.6;cursor:default}
.gig-save-icon{flex:0 0 auto;display:block}
.gig-hint{color:var(--dsw-alias-label-tertiary,#777)}
.gig-hint-line{margin-top:-4px;text-align:center;font-size:11px;color:var(--dsw-alias-label-tertiary,#666)}
@keyframes gig-fade{from{opacity:0}to{opacity:1}}

/* ── 移动端：损坏占位不设最小宽 ───────────────────────────────── */
@media (max-width: 767.98px) {
  .gig-broken{min-width:0;min-height:120px}
}
`

let injected = false

/** 注入全局样式（幂等）；返回移除函数。 */
export function injectStyles(): () => void {
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/image-gallery/styles'
    tag.textContent = SHEET
    document.head.appendChild(tag)
    injected = true
  }
  return () => {
    if (!injected) return
    document.getElementById(STYLE_ID)?.remove()
    injected = false
  }
}