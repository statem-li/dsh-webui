/**
 * dsh-browser — client 侧样式注入（活动条 + 内嵌面板 + 侧边栏标识）。
 * 全部使用 --dsw-alias-* 主题变量，跟随 DSH 明暗主题。
 */

const STYLE_ID = 'dsh-browser-styles'

const SHEET = `
/* ── 会话内浏览器常驻按钮（conversation.input.left，对齐记忆开关）── */
.dsh-browser-seat{
  display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;padding:6px;border:none;border-radius:28px;
  background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;
  transition:color .15s,background .15s;
}
.dsh-browser-seat:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-browser-seat--on{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-browser-seat--on:hover{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-browser-seat--on svg{animation:dsh-browser-pulse 1.4s ease-in-out infinite}
@keyframes dsh-browser-pulse{
  0%,100%{opacity:1}50%{opacity:.45}
}

/* ── 内嵌面板（portal 到 body）──────────────────────────────────── */
.dsh-browser-panel__backdrop{
  position:fixed;inset:0;z-index:8800;background:rgba(0,0,0,.4);
}
.dsh-browser-panel{
  position:fixed;z-index:8801;top:50%;left:50%;transform:translate(-50%,-50%);
  width:min(1200px,calc(100vw - 40px));height:min(800px,calc(100vh - 80px));
  display:flex;flex-direction:column;overflow:hidden;border-radius:14px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));
  background:var(--dsw-alias-bg-overlay,#1c1f26);box-shadow:0 24px 64px rgba(0,0,0,.45);
  color:var(--dsw-alias-label-primary,#eee);
}
.dsh-browser-panel--fullscreen{
  width:100vw;height:100vh;max-width:none;max-height:none;
  top:0;left:0;transform:none;border-radius:0;border:none;
}
.dsh-browser-panel__head{
  display:flex;align-items:center;gap:10px;padding:12px 16px;
  border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));
}
.dsh-browser-panel__title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;min-width:0}
.dsh-browser-panel__url{font-size:12px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.dsh-browser-panel__close{border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);font-size:16px;cursor:pointer;padding:4px 8px;border-radius:8px}
.dsh-browser-panel__close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-browser-panel__fullscreen{
  border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);
  font-size:15px;cursor:pointer;padding:4px 8px;border-radius:8px;
  display:inline-flex;align-items:center;justify-content:center;
}
.dsh-browser-panel__fullscreen:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-browser-panel__body{position:relative;display:flex;flex:1;min-height:0}
.dsh-browser-panel__frame{
  flex:1;min-width:0;position:relative;background:#000;
  display:flex;align-items:center;justify-content:center;overflow:hidden;
}
.dsh-browser-panel__frame img{max-width:100%;max-height:100%;object-fit:contain;display:block;cursor:crosshair;outline:none}
.dsh-browser-panel__frame-empty{color:var(--dsw-alias-label-tertiary,#888);font-size:13px}
.dsh-browser-panel__timeline{
  position:absolute;top:0;right:0;bottom:0;
  width:min(360px,82%);box-sizing:border-box;
  overflow-y:auto;padding:12px;
  display:flex;flex-direction:column;gap:10px;
  background:transparent;scrollbar-width:thin;pointer-events:auto;
}
.dsh-browser-panel__tl-head{
  font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#bbb);
  display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;
  background:rgba(28,31,38,.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
}
.dsh-browser-step{
  display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:10px;
  background:rgba(28,31,38,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  border:1px solid rgba(255,255,255,.10);
}
.dsh-browser-step--running{border-color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-browser-step--error{border-color:var(--dsw-alias-state-danger-primary,#f56c6c)}
.dsh-browser-step__row{display:flex;align-items:center;gap:7px}
.dsh-browser-step__dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#888)}
.dsh-browser-step--running .dsh-browser-step__dot{background:var(--dsw-alias-state-business-primary,#4a9eff);animation:dsh-browser-pulse 1.4s ease-in-out infinite}
.dsh-browser-step--error .dsh-browser-step__dot{background:var(--dsw-alias-state-danger-primary,#f56c6c)}
.dsh-browser-step__label{font-size:13px;font-weight:600}
.dsh-browser-step__status{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-browser-step--running .dsh-browser-step__status{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-browser-step--error .dsh-browser-step__status{color:var(--dsw-alias-state-danger-primary,#f56c6c)}
.dsh-browser-step__detail{font-size:12px;color:var(--dsw-alias-label-secondary,#bbb);word-break:break-all}
.dsh-browser-step__result{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);word-break:break-all}
.dsh-browser-panel__empty{
  color:var(--dsw-alias-label-tertiary,#888);font-size:12px;padding:6px 10px;border-radius:8px;
  background:rgba(28,31,38,.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
}

/* ── 侧边栏会话列表标识 ───────────────────────────────────────── */
.dsh-browser-sidebar-badge{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:14px;height:14px;margin-right:4px;border-radius:4px;
  background:rgba(74,158,255,.18);color:var(--dsw-alias-state-business-primary,#4a9eff);
}
.dsh-browser-sidebar-badge svg{animation:dsh-browser-pulse 1.4s ease-in-out infinite}
`

let injected = false

export function injectBrowserStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/browser'
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
