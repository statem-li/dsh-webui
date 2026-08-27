/**
 * webui — 对话截图面板样式（client 端，运行时注入 <style>）。
 *
 * 规格对齐官方 ModelsSection：输入框/下拉 32px、行内小按钮胶囊 28px、
 * 主按钮胶囊 36px、行卡片圆角 12px、填充面用 bg-module-platform。
 * 颜色一律走 --dsw-* 令牌（强调色用 state-business-primary，绝不用
 * brand-primary——它在浅色下是黑、深色下是白）。
 */

const STYLE_ID = 'dsh-webui-screenshot-styles'

/** 类名表（前缀 wsh- = webui screenshot）。 */
export const cls = {
  btn: 'wsh-btn',
  btnBusy: 'wsh-btn-busy',
  mask: 'wsh-mask',
  panel: 'wsh-panel',
  head: 'wsh-head',
  title: 'wsh-title',
  close: 'wsh-close',
  bar: 'wsh-bar',
  group: 'wsh-group',
  label: 'wsh-label',
  seg: 'wsh-seg',
  segItem: 'wsh-seg-item',
  segItemOn: 'wsh-seg-item-on',
  select: 'wsh-select',
  input: 'wsh-input',
  stage: 'wsh-stage',
  canvas: 'wsh-canvas',
  img: 'wsh-img',
  spinner: 'wsh-spinner',
  hint: 'wsh-hint',
  error: 'wsh-error',
  editBar: 'wsh-edit-bar',
  editHint: 'wsh-edit-hint',
  editCount: 'wsh-edit-count',
  editSpacer: 'wsh-edit-spacer',
  editor: 'wsh-editor',
  frame: 'wsh-frame',
  foot: 'wsh-foot',
  meta: 'wsh-meta',
  actions: 'wsh-actions',
  action: 'wsh-action',
  primary: 'wsh-primary',
  toast: 'wsh-toast',
} as const

const SHEET = `
/* ── 消息操作栏相机按钮（与官方 IconActions 同规格）── */
.wsh-btn{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;transition:color .12s,background .12s}
.wsh-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.wsh-btn-busy{color:var(--dsw-alias-state-business-primary,#4176e6);cursor:default;pointer-events:none}

/* ── 遮罩 + 面板 ── */
.wsh-mask{position:fixed;inset:0;z-index:1399;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45))}
.wsh-panel{position:fixed;z-index:1400;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;box-sizing:border-box;width:min(calc(100vw - 48px),2160px);height:min(calc(100vh - 40px),1720px);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden}
/* 居中面板的开合动画自带 translate(-50%,-50%)，不能复用通用滑入类（会覆盖定位）。 */
.wsh-panel[data-anim='in']{animation:wsh-panel-in 240ms cubic-bezier(.2,.8,.2,1)}
.wsh-panel[data-anim='out']{animation:wsh-panel-out 240ms cubic-bezier(.4,0,.2,1) both}
@keyframes wsh-panel-in{from{opacity:0;transform:translate(-50%,calc(-50% + 18px))}to{opacity:1;transform:translate(-50%,-50%)}}
@keyframes wsh-panel-out{from{opacity:1;transform:translate(-50%,-50%)}to{opacity:0;transform:translate(-50%,calc(-50% + 18px))}}

/* ── 头部 ── */
.wsh-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.wsh-title{flex:1;min-width:0;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary,#eee)}
.wsh-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer}
.wsh-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}

/* ── 选项条 ── */
.wsh-bar{flex:none;display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.wsh-group{display:flex;align-items:center;gap:8px;min-width:0}
.wsh-label{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb)}
/* 分段选择：整体一枚 32px 高的胶囊，选中项走品牌蓝底 */
.wsh-seg{display:inline-flex;align-items:center;height:32px;padding:2px;gap:2px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent)}
.wsh-seg-item{display:inline-flex;align-items:center;height:26px;padding:0 12px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:13px;line-height:1;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s}
.wsh-seg-item:hover{color:var(--dsw-alias-label-primary,#eee)}
.wsh-seg-item-on{background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff}
.wsh-seg-item-on:hover{color:#fff}
/* 文本输入（标题/徽章可编辑）：官方输入框规格 32px / 圆角 8 */
.wsh-input{height:32px;padding:0 10px;font-size:14px;line-height:22px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#333);background-color:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,#eee);min-width:0}
.wsh-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.wsh-input::placeholder{color:var(--dsw-alias-label-tertiary,#888)}
.wsh-group .wsh-input{width:190px}
.wsh-select{height:32px;padding:0 32px 0 10px;font-size:14px;line-height:22px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#333);background-color:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,#eee);max-width:200px;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5L6 8l3.5-3.5' fill='none' stroke='%2381858C' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;cursor:pointer}

/* ── 预览台 ── */
.wsh-stage{flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:18px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.02));scrollbar-width:thin}
.wsh-stage::-webkit-scrollbar{width:8px;height:8px}
.wsh-stage::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,#333);border-radius:4px}
.wsh-canvas{display:flex;align-items:center;justify-content:center;min-height:100%;width:100%}
.wsh-img{max-width:100%;height:auto;display:block;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.28)}
.wsh-spinner{width:26px;height:26px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,#333);border-top-color:var(--dsw-alias-state-business-primary,#4176e6);animation:wsh-spin .8s linear infinite}
@keyframes wsh-spin{to{transform:rotate(360deg)}}
.wsh-hint{display:flex;flex-direction:column;align-items:center;gap:10px;font-size:13px;color:var(--dsw-alias-label-tertiary,#888)}
.wsh-error{max-width:520px;font-size:13px;line-height:1.6;color:var(--dsw-alias-state-error-primary,#e5484d);text-align:center;word-break:break-word}

/* ── 元素删除编辑模式 ── */
/* 编辑中：选项条整体减淡并禁止交互（改了选项会脱离编辑，需要先退出重渲染）。 */
.wsh-panel[data-editing] .wsh-bar{opacity:.55;pointer-events:none}
/* 编辑工具条：吸附在预览台顶部，滑入动画（减少动态偏好时直接显示）。 */
.wsh-edit-bar{position:sticky;top:-18px;z-index:5;flex:none;box-sizing:border-box;width:100%;display:flex;align-items:center;gap:10px;margin:-18px 0 14px;padding:9px 14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));animation:wsh-editbar-in 180ms ease}
@keyframes wsh-editbar-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.wsh-edit-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#bbb);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wsh-edit-count{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}
.wsh-edit-count[data-n]{color:var(--dsw-alias-state-error-primary,#e5484d)}
.wsh-edit-spacer{flex:1}
/* 编辑画布：iframe 内是真实宽度的页面，容器负责横纵滚动。 */
.wsh-editor{flex:none;box-sizing:border-box;width:100%;overflow:auto;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.02));scrollbar-width:thin}
.wsh-editor::-webkit-scrollbar{width:8px;height:8px}
.wsh-editor::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,#333);border-radius:4px}
.wsh-frame{display:block;box-sizing:border-box;width:100%;height:1600px;border:none;background:#fff}
.wsh-frame:focus{outline:none}

/* ── 底栏 ── */
.wsh-foot{flex:none;display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.wsh-meta{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wsh-actions{flex:none;display:flex;align-items:center;gap:8px}
.wsh-action{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:14px;cursor:pointer;transition:border-color .12s,color .12s,opacity .12s;text-decoration:none}
.wsh-action:hover{border-color:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-state-business-primary,#4176e6)}
.wsh-primary{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 18px;border:1px solid transparent;border-radius:18px;background:var(--dsw-alias-button-primary-fill,#111);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:14px;font-weight:600;cursor:pointer;transition:opacity .12s}
.wsh-primary:hover{opacity:.86}
.wsh-action:disabled,.wsh-primary:disabled{opacity:.45;cursor:default;pointer-events:none}
/* 保存/复制结果提示（底栏左侧原地替换 meta 文案，避免额外浮层） */
.wsh-toast{color:var(--dsw-alias-state-success-primary,#3fb950)}
@media (prefers-reduced-motion:reduce){
  .wsh-panel{animation:none!important}
  .wsh-spinner{animation:none}
  .wsh-edit-bar{animation:none}
}
`

/** 注入面板样式（幂等）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
