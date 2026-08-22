/**
 * automation — 样式（运行时注入 <style>，类名前缀 auto-）。
 *
 * 视觉令牌全部走 DSH 主题变量（--dsw-alias-* / --dsw-specific-*），深浅色自适应。
 * 动画时长统一 240ms（需求 200–300ms 区间），开/关互为反向：
 *  - 一级卡片（TAB 式）：从菜单右侧滑出 / 底部 sheet 回退；宽度高度随 TAB
 *    平滑过渡（transition width/height 240ms）；
 *  - 二级抽屉：右侧滑入滑出；
 *  - 卡片内部内容：错落式渐显（auto-rise-in + nth-child 延迟），关闭时随容器一同渐隐。
 */

/** 动画时长（ms）：CSS 与 JS 关闭状态机共用同一值。 */
export const AUTO_ANIM_MS = 240

const STYLE_ID = 'dsh-webui-automation-styles'

const SHEET = `
/* ── 侧边栏菜单项：与原生会话/工作区行同款菜单行（透明底 + hover 高亮）── */
.auto-nav{display:flex;align-items:center;gap:8px;width:calc(100% - 4px);height:34px;padding:0 10px;margin:0 2px 4px;box-sizing:border-box;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:14px;line-height:20px;font-family:inherit;cursor:pointer;text-align:left;user-select:none;overflow:hidden}
.auto-nav:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.auto-nav>svg{flex:none;color:var(--dsw-alias-label-secondary,#bbb)}
.auto-nav .auto-nav-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 折叠 rail 态：只留图标（与原生 rail 图标钮同款几何） */
.auto-nav[data-rail='true']{width:36px;height:36px;padding:0;margin:0 0 8px;justify-content:center;border-radius:8px}
.auto-nav[data-rail='true']:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}

/* ── 遮罩：淡入淡出 ── */
.auto-mask{position:fixed;inset:0;z-index:1500;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45))}
.auto-mask[data-anim='in']{animation:auto-fade-in ${AUTO_ANIM_MS}ms ease both}
.auto-mask[data-anim='out']{animation:auto-fade-out ${AUTO_ANIM_MS}ms ease both}

/* ── 一级卡片（TAB 式）：从「自动化」菜单右侧滑出；宽高随 TAB 平滑过渡 ── */
.auto-card{position:fixed;z-index:1501;display:flex;flex-direction:column;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden;transition:width ${AUTO_ANIM_MS}ms cubic-bezier(.2,.8,.2,1),height ${AUTO_ANIM_MS}ms cubic-bezier(.2,.8,.2,1)}
.auto-card[data-mode='popover'][data-anim='in']{animation:auto-pop-in ${AUTO_ANIM_MS}ms cubic-bezier(.2,.8,.2,1) both}
.auto-card[data-mode='popover'][data-anim='out']{animation:auto-pop-out ${AUTO_ANIM_MS}ms cubic-bezier(.4,0,.2,1) both}
.auto-card[data-mode='sheet']{left:12px !important;right:12px;bottom:12px;top:auto !important}
.auto-card[data-mode='sheet'][data-anim='in']{animation:auto-sheet-in ${AUTO_ANIM_MS}ms cubic-bezier(.2,.8,.2,1) both}
.auto-card[data-mode='sheet'][data-anim='out']{animation:auto-sheet-out ${AUTO_ANIM_MS}ms cubic-bezier(.4,0,.2,1) both}

/* 卡片头部：标题 + 关闭 */
.auto-card-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 0}
.auto-card-title{flex:1;min-width:0;display:inline-flex;align-items:center;gap:8px;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary,#eee)}
.auto-card-title svg{color:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.auto-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}

/* TAB 栏：下划线式，选中项走品牌色 */
.auto-tabs{flex:none;display:flex;gap:2px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.auto-tab{position:relative;display:inline-flex;align-items:center;height:32px;padding:0 12px;border:none;border-radius:8px 8px 0 0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb);font-size:13px;font-weight:500;font-family:inherit;transition:color 120ms ease,background 120ms ease}
.auto-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.auto-tab[aria-selected='true']{color:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-tab[aria-selected='true']::after{content:'';position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary,#4176e6)}

/* 卡片主体：面板切换淡入 + 内容错落渐显（关闭时整体随卡片渐隐） */
.auto-card-body{flex:1;min-height:0;overflow-y:auto;padding:4px 16px 16px}
.auto-panel{display:flex;flex-direction:column;gap:2px}
.auto-card[data-anim='in'] .auto-panel{animation:auto-fade-in ${AUTO_ANIM_MS}ms ease both}
.auto-panel>.auto-stagger-item{animation:auto-rise-in ${AUTO_ANIM_MS}ms cubic-bezier(.2,.8,.2,1) both}
.auto-panel>.auto-stagger-item:nth-child(2){animation-delay:30ms}
.auto-panel>.auto-stagger-item:nth-child(3){animation-delay:60ms}
.auto-panel>.auto-stagger-item:nth-child(n+4){animation-delay:90ms}

/* 设置行通用布局 */
.auto-row{padding:12px 0}
.auto-row+.auto-row{border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.auto-row-label{font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.auto-row-hint{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}

/* 执行日期设定行 */
.auto-date-line{margin-top:8px;display:flex;align-items:center;gap:8px}
.auto-date-input{flex:1;min-width:0;height:34px;box-sizing:border-box;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));border-radius:8px;background:var(--dsw-alias-bg-base,#0e1116);color:var(--dsw-alias-label-primary,#eee);font-size:13px;font-family:inherit;color-scheme:dark light}
.auto-date-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-date-clear{flex:none;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb);font-size:12px;font-family:inherit}
.auto-date-clear:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}

/* 每日定时开关 */
.auto-switch-line{margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.auto-switch-text{min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#bbb)}
.auto-switch{position:relative;flex:none;width:40px;height:22px;border:none;border-radius:11px;padding:0;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.14));cursor:pointer;transition:background ${AUTO_ANIM_MS}ms ease}
.auto-switch::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transition:transform ${AUTO_ANIM_MS}ms cubic-bezier(.2,.8,.2,1)}
.auto-switch[aria-checked='true']{background:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-switch[aria-checked='true']::after{transform:translateX(18px)}

/* 执行任务页：分类分组 + 任务行 */
.auto-tasks-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0 6px}
.auto-task-cat{padding:10px 0 2px}
.auto-task-cat-name{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary,#888)}
.auto-cat-add{display:inline-flex;align-items:center;gap:3px;margin-left:8px;height:22px;padding:0 7px;border:none;border-radius:6px;background:transparent;cursor:pointer;color:var(--dsw-alias-state-business-primary,#4176e6);font-size:12px;font-family:inherit;vertical-align:middle}
.auto-cat-add:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.auto-task-row{display:flex;align-items:center;gap:8px;min-height:38px;padding:4px 8px;border-radius:8px;cursor:pointer}
.auto-task-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.auto-task-row[data-disabled='true'] .auto-task-name{color:var(--dsw-alias-label-tertiary,#888)}
/* 任务行内的小号启用开关 */
.auto-switch-sm{width:32px;height:18px;border-radius:9px}
.auto-switch-sm::after{width:12px;height:12px;top:3px;left:3px}
.auto-switch-sm[aria-checked='true']::after{transform:translateX(14px)}
/* 任务名 + 执行计划预览（两行） */
.auto-task-name{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;overflow:hidden;font-size:13px;color:var(--dsw-alias-label-primary,#eee)}
.auto-task-name>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.auto-task-sched{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-task-badge{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-secondary,#bbb);font-size:11px;line-height:20px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.auto-task-del{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:6px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888);opacity:0;transition:opacity 120ms ease,color 120ms ease}
.auto-task-row:hover .auto-task-del,.auto-task-del:focus-visible{opacity:1}
.auto-task-del:hover{color:var(--dsw-alias-state-error-primary,#e0434b);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.auto-empty{padding:24px 8px;text-align:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-empty-hint{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);opacity:.75}

/* 执行计划编辑器（任务抽屉内）：模式 + 动态字段 + 预览 */
.auto-sched{display:flex;flex-direction:column;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.auto-sched .auto-field{margin-top:0}
.auto-sched-row{display:flex;gap:8px}
.auto-sched-grow{flex:1;min-width:0}
.auto-sched-preview{font-size:12px;line-height:18px;color:var(--dsw-alias-state-business-primary,#4176e6)}

/* 二级抽屉（新建/编辑任务表单）：屏幕右侧滑入滑出 */
.auto-drawer-mask{position:fixed;inset:0;z-index:1600;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45))}
.auto-drawer-mask[data-anim='in']{animation:auto-fade-in ${AUTO_ANIM_MS}ms ease both}
.auto-drawer-mask[data-anim='out']{animation:auto-fade-out ${AUTO_ANIM_MS}ms ease both}
.auto-drawer{position:fixed;top:0;right:0;bottom:0;z-index:1601;width:min(380px,100vw);display:flex;flex-direction:column;box-sizing:border-box;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));border-left:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5))}
.auto-drawer[data-anim='in']{animation:auto-drawer-in ${AUTO_ANIM_MS}ms cubic-bezier(.2,.8,.2,1) both}
.auto-drawer[data-anim='out']{animation:auto-drawer-out ${AUTO_ANIM_MS}ms cubic-bezier(.4,0,.2,1) both}
.auto-drawer-inner{display:flex;flex-direction:column;min-height:0;flex:1}
.auto-drawer-head{flex:none;display:flex;align-items:center;gap:8px;padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.auto-drawer-title{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.auto-drawer-body{flex:1;min-height:0;overflow-y:auto;padding:6px 16px}
.auto-field{margin-top:14px}
.auto-field-label{display:block;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);margin-bottom:6px}
.auto-input,.auto-select{width:100%;height:34px;box-sizing:border-box;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));border-radius:8px;background:var(--dsw-alias-bg-base,#0e1116);color:var(--dsw-alias-label-primary,#eee);font-size:13px;font-family:inherit;color-scheme:dark light}
.auto-select:disabled{opacity:.55;cursor:not-allowed}
.auto-input:focus-visible,.auto-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.auto-drawer-foot{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.auto-btn{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 16px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:13px;font-family:inherit;cursor:pointer}
.auto-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.auto-btn-primary{border-color:transparent;background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff}
.auto-btn-primary:hover{filter:brightness(1.08);background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff}

/* 执行日志页 */
.auto-logs-toolbar{display:flex;align-items:center;gap:8px;padding:10px 0 8px}
.auto-log-filter{flex:1;max-width:220px;height:30px;box-sizing:border-box;padding:0 8px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));border-radius:8px;background:var(--dsw-alias-bg-base,#0e1116);color:var(--dsw-alias-label-primary,#eee);font-size:12px;font-family:inherit;color-scheme:dark light}
.auto-log-clear{flex:none;display:inline-flex;align-items:center;height:26px;padding:0 9px;border:none;border-radius:7px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888);font-size:12px;font-family:inherit}
.auto-log-clear:hover{color:var(--dsw-alias-state-error-primary,#e0434b);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.auto-log-day{padding:10px 0 4px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#888)}
.auto-log-row{display:flex;align-items:center;gap:10px;min-height:34px;padding:4px 8px;border-radius:8px}
.auto-log-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}
.auto-log-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#3fb96b)}
.auto-log-dot[data-status='failed']{background:var(--dsw-alias-state-error-primary,#e0434b)}
.auto-log-task{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--dsw-alias-label-primary,#eee)}
.auto-log-detail{flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}
.auto-log-time{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}

/* ── 动画 keyframes ── */
@keyframes auto-fade-in{from{opacity:0}to{opacity:1}}
@keyframes auto-fade-out{from{opacity:1}to{opacity:0}}
@keyframes auto-pop-in{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
@keyframes auto-pop-out{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(-8px)}}
@keyframes auto-drawer-in{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes auto-drawer-out{from{transform:translateX(0)}to{transform:translateX(100%)}}
@keyframes auto-rise-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes auto-sheet-in{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
@keyframes auto-sheet-out{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(24px)}}

/* 小屏响应式：二级抽屉全宽 */
@media (max-width:639.98px){
  .auto-drawer{width:100vw;border-left:none}
}

@media (prefers-reduced-motion:reduce){
  .auto-mask,.auto-card,.auto-drawer,.auto-drawer-mask,
  .auto-card[data-anim='in'] .auto-panel,
  .auto-panel>.auto-stagger-item{animation:none!important}
  .auto-card,.auto-switch,.auto-switch::after{transition:none!important}
}
`

/** 注入样式表（幂等；插件卸载时由 loader 移除 style 标签）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.plugin = '@dsh-external/dsh-webui'
  tag.dataset.pluginCss = 'webui/automation'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}
