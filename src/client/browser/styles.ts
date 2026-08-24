/**
 * dsh-browser — client 侧样式注入（活动条 + 右侧滑出抽屉 + 侧边栏标识）。
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
/* 禁止态：AI 浏览器被用户禁用（图标转警示红，一眼可辨） */
.dsh-browser-seat--denied,
.dsh-browser-seat--denied:hover{color:var(--dsw-alias-state-danger-primary,#f56c6c)}

/* ── 「禁止 AI 使用浏览器」悬停卡片（按钮上方滑出）──────────────────
   常驻 DOM + visibility 过渡：hidden 时不参与命中，鼠标划过其区域无误触；
   展开后按钮↔卡片间移动不丢 hover（卡片是容器的 DOM 后代）。 */
.dsh-browser-seat-wrap{position:relative;display:inline-flex}
.dsh-browser-gate{
  position:absolute;left:-4px;bottom:calc(100% + 10px);z-index:60;
  width:276px;box-sizing:border-box;padding:12px 14px;border-radius:12px;
  /* 材质对齐官方下拉浮层（Menu 原语/ModelSelect 菜单）：specific-menu 面 +
     inverted 边框；fallback 才退回旧的 overlay 底色。 */
  border:1px solid var(--dsw-alias-border-inverted,rgba(255,255,255,.06));
  background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay,#1c1f26));
  box-shadow:var(--dsw-shadow-lv3,0 16px 44px rgba(0,0,0,.35));
  color:var(--dsw-alias-label-primary,#eee);
  text-align:left;
  opacity:0;visibility:hidden;transform:translateY(6px);pointer-events:none;
  transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s;
}
.dsh-browser-gate--on{
  opacity:1;visibility:visible;transform:translateY(0);pointer-events:auto;
  transition:opacity .16s ease,transform .16s ease,visibility 0s;
}
.dsh-browser-gate__head{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
}
.dsh-browser-gate__title{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600}
.dsh-browser-gate__state{font-size:11px;color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-browser-gate__state--deny{color:var(--dsw-alias-state-danger-primary,#f56c6c)}
.dsh-browser-gate__row{
  display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  margin-top:10px;padding-top:10px;
  border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));
}
.dsh-browser-gate__copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsh-browser-gate__label{font-size:13px;color:var(--dsw-alias-label-primary,#eee)}
.dsh-browser-gate__desc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#999)}
.dsh-browser-gate__switch{
  position:relative;flex:none;width:40px;height:22px;border-radius:11px;border:none;
  cursor:pointer;padding:0;background:var(--dsw-alias-border-l2,#555);
  transition:background .15s;box-sizing:border-box;
}
.dsh-browser-gate__switch[aria-checked='true']{background:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-browser-gate__switch:disabled{cursor:default;opacity:.6}
.dsh-browser-gate__knob{
  position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
  background:var(--dsw-alias-label-tertiary,#888);
  transition:left .15s,background .15s;box-shadow:0 1px 2px rgba(0,0,0,.2);
}
.dsh-browser-gate__switch[aria-checked='true'] .dsh-browser-gate__knob{left:20px;background:#fff}

/* ── 右侧滑出抽屉（portal 到 body）────────────────────────────────
   打开：从右往左滑入；关闭：从左往右滑出。
   抽屉不全宽——左侧留 44px 空隙，点击空隙（hitzone）收回。 */
.dsh-browser-drawer__hitzone{
  position:fixed;inset:0;z-index:8800;background:transparent;
  cursor:pointer;opacity:0;pointer-events:none;
  transition:background .2s ease,opacity .3s ease;
}
.dsh-browser-drawer__hitzone--on{opacity:1;pointer-events:auto}
.dsh-browser-drawer__hitzone--on:hover{background:rgba(0,0,0,.16)}
.dsh-browser-drawer{
  position:fixed;z-index:8801;top:0;right:0;bottom:0;
  width:calc(100vw - 44px);
  display:flex;flex-direction:column;overflow:hidden;
  border-radius:14px 0 0 14px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));border-right:none;
  background:var(--dsw-alias-bg-overlay,#1c1f26);
  box-shadow:-24px 0 64px rgba(0,0,0,.45);
  color:var(--dsw-alias-label-primary,#eee);
  transform:translateX(calc(100% + 32px));
  transition:transform .3s cubic-bezier(.32,.72,.34,1);
  will-change:transform;
}
.dsh-browser-drawer--open{transform:translateX(0)}
.dsh-browser-drawer__head{
  display:flex;align-items:center;gap:10px;padding:12px 16px;flex:none;
  /* 右侧预留壳子「最小化/最大化/关闭」三按钮区域（138px + 边距），
     抽屉关闭按钮与它们落在同一行、互不遮挡；移动端无壳子按钮，恢复默认。 */
  padding-right:150px;
  border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));
}
.dsh-browser-drawer__title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;flex:none}
.dsh-browser-drawer__url{font-size:12px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}

/* ── 标签页栏（「AI 浏览器」标题右侧，可切换/关闭/新建）── */
.dsh-browser-tabs{
  flex:1;min-width:0;display:flex;align-items:center;gap:4px;
  overflow-x:auto;scrollbar-width:none;padding:0 2px;
}
.dsh-browser-tabs::-webkit-scrollbar{display:none}
.dsh-browser-tab{
  flex:none;display:inline-flex;align-items:center;gap:6px;
  max-width:150px;height:26px;padding:0 6px 0 10px;border-radius:8px;
  border:1px solid transparent;color:var(--dsw-alias-label-secondary,#bbb);
  font-size:12px;cursor:pointer;user-select:none;
  transition:background .15s,color .15s,border-color .15s;
}
.dsh-browser-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.dsh-browser-tab--active{
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));
  border-color:var(--dsw-alias-state-business-primary,#4a9eff);
  color:var(--dsw-alias-label-primary,#eee);
}
.dsh-browser-tab__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsh-browser-tab__close{
  flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);
  font-size:10px;line-height:1;cursor:pointer;padding:2px;border-radius:4px;
  opacity:0;transition:opacity .12s,background .12s,color .12s;
}
.dsh-browser-tab:hover .dsh-browser-tab__close,.dsh-browser-tab--active .dsh-browser-tab__close{opacity:1}
.dsh-browser-tab__close:hover{background:rgba(255,255,255,.14);color:var(--dsw-alias-label-primary,#eee)}
.dsh-browser-tabs__new{
  flex:none;width:22px;height:22px;border-radius:6px;border:none;
  background:transparent;color:var(--dsw-alias-label-tertiary,#888);
  font-size:13px;cursor:pointer;
}
.dsh-browser-tabs__new:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#eee)}

/* ── 网址行：快捷站点 chips（左）+ 当前网址可复制（右）── */
.dsh-browser-drawer__urlrow{
  flex:none;display:flex;align-items:center;gap:10px;
  padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));
}
.dsh-browser-drawer__urlrow .dsh-browser-sites{flex:1;min-width:0;border-bottom:none}
.dsh-browser-urlbar{flex:none;display:flex;align-items:center;gap:6px;max-width:46%}
.dsh-browser-urlbar__url{
  font-size:11px;color:var(--dsw-alias-label-tertiary,#888);
  max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-browser-urlbar__copy{
  flex:none;height:22px;padding:0 8px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:transparent;color:var(--dsw-alias-label-secondary,#bbb);
  font-size:11px;cursor:pointer;white-space:nowrap;
  transition:color .15s,border-color .15s;
}
.dsh-browser-urlbar__copy:hover{color:var(--dsw-alias-label-primary,#eee);border-color:var(--dsw-alias-label-tertiary,#888)}
.dsh-browser-urlbar__copy--done{
  color:var(--dsw-alias-state-business-primary,#4a9eff);
  border-color:var(--dsw-alias-state-business-primary,#4a9eff);
}
.dsh-browser-drawer__close{border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);font-size:16px;cursor:pointer;padding:4px 8px;border-radius:8px;flex:none}
.dsh-browser-drawer__close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}

/* ── 元素选取：头部开关按钮 + 画面十字准星 + 顶部提示条 ── */
.dsh-browser-drawer__pick{
  flex:none;height:26px;padding:0 10px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:transparent;color:var(--dsw-alias-label-secondary,#bbb);
  font-size:12px;cursor:pointer;white-space:nowrap;
  transition:color .15s,border-color .15s,background .15s;
}
.dsh-browser-drawer__pick:hover{color:var(--dsw-alias-label-primary,#eee);border-color:var(--dsw-alias-label-tertiary,#888)}
.dsh-browser-drawer__pick--on{
  color:var(--dsw-alias-state-business-primary,#4a9eff);
  border-color:var(--dsw-alias-state-business-primary,#4a9eff);
  background:rgba(74,158,255,.12);
}
.dsh-browser-drawer__frame--picking{cursor:crosshair}
.dsh-browser-drawer__frame--picking img{cursor:crosshair}
.dsh-browser-drawer__pickhint{
  position:absolute;top:12px;left:50%;transform:translateX(-50%);
  padding:6px 14px;border-radius:999px;
  background:rgba(20,22,28,.85);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  border:1px solid var(--dsw-alias-state-business-primary,#4a9eff);
  color:var(--dsw-alias-label-primary,#eee);font-size:12px;
  pointer-events:none;white-space:nowrap;z-index:5;
}

/* hover 范围提示框：像 DevTools 一样的半透明高亮 + 左上角 tag 标签 */
.dsh-browser-drawer__pickbox{
  position:absolute;z-index:4;pointer-events:none;
  border:1px solid var(--dsw-alias-state-business-primary,#4a9eff);
  background:rgba(74,158,255,.14);
  box-shadow:0 0 0 1px rgba(0,0,0,.35);
}
.dsh-browser-drawer__pickbox-tag{
  position:absolute;left:-1px;top:-1px;
  background:var(--dsw-alias-state-business-primary,#4a9eff);
  color:#fff;font-size:11px;line-height:18px;padding:0 6px;
  border-radius:0 0 6px 0;white-space:nowrap;max-width:220px;
  overflow:hidden;text-overflow:ellipsis;pointer-events:none;
}

/* ── 快捷标签网站栏（chips + 管理面板，对齐官方控件规格）── */
.dsh-browser-sites{flex:none;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))}
.dsh-browser-sites__row{
  display:flex;align-items:center;gap:6px;padding:7px 12px;
  overflow-x:auto;scrollbar-width:thin;
}
.dsh-browser-site{
  flex:none;height:26px;padding:0 12px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));
  background:transparent;color:var(--dsw-alias-label-secondary,#bbb);
  font-size:12px;line-height:24px;cursor:pointer;white-space:nowrap;
  transition:color .15s,border-color .15s,background .15s;
}
.dsh-browser-site:hover{
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  color:var(--dsw-alias-label-primary,#eee);
}
.dsh-browser-site--active{
  border-color:var(--dsw-alias-state-business-primary,#4a9eff);
  color:var(--dsw-alias-state-business-primary,#4a9eff);
}
.dsh-browser-sites__add{
  flex:none;height:26px;min-width:26px;padding:0 8px;border-radius:999px;
  border:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.18));
  background:transparent;color:var(--dsw-alias-label-tertiary,#888);
  font-size:13px;cursor:pointer;transition:color .15s,border-color .15s;
}
.dsh-browser-sites__add:hover,.dsh-browser-sites__add--on{
  color:var(--dsw-alias-state-business-primary,#4a9eff);
  border-color:var(--dsw-alias-state-business-primary,#4a9eff);
}
.dsh-browser-sites__panel{
  margin:0 12px 10px;padding:12px;border-radius:12px;
  background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04));
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));
}
.dsh-browser-sites__form{display:flex;align-items:center;gap:8px}
.dsh-browser-sites__input{
  height:32px;padding:0 10px;font-size:14px;line-height:22px;
  border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-1,transparent);
  color:var(--dsw-alias-label-primary,#eee);outline:none;min-width:0;
}
.dsh-browser-sites__input:focus{border-color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-browser-sites__input--title{flex:none;width:140px}
.dsh-browser-sites__input--url{flex:1}
.dsh-browser-sites__save{
  flex:none;height:32px;padding:0 16px;border-radius:8px;border:none;
  background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4176e6));
  color:var(--dsw-alias-label-primary-foreground,#fff);
  font-size:13px;cursor:pointer;
}
.dsh-browser-sites__save:hover{opacity:.9}
.dsh-browser-sites__list{margin-top:8px;display:flex;flex-direction:column}
.dsh-browser-sites__item{display:flex;align-items:center;gap:10px;padding:5px 2px}
.dsh-browser-sites__item-title{
  flex:none;width:110px;font-size:13px;color:var(--dsw-alias-label-primary,#eee);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;
}
.dsh-browser-sites__item-url{
  flex:1;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary,#888);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-browser-sites__del{
  flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#888);
  font-size:12px;cursor:pointer;padding:2px 6px;border-radius:6px;
}
.dsh-browser-sites__del:hover{
  color:var(--dsw-alias-state-danger-primary,#f56c6c);
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
}
.dsh-browser-drawer__body{position:relative;display:flex;flex:1;min-height:0}
.dsh-browser-drawer__frame{
  flex:1;min-width:0;position:relative;background:#000;
  display:flex;align-items:center;justify-content:center;overflow:hidden;
}
.dsh-browser-drawer__frame img{max-width:100%;max-height:100%;object-fit:contain;display:block;cursor:default;outline:none;user-select:none;-webkit-user-drag:none}
.dsh-browser-drawer__empty{
  color:var(--dsw-alias-label-tertiary,#888);font-size:13px;
}

/* 画面加载中：星环滚动 + 正在加载 */
.dsh-browser-loading{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:14px;pointer-events:none;
}
.dsh-browser-loading__orbit{flex:none}
.dsh-browser-loading__ring{
  transform-box:fill-box;transform-origin:center;
  animation:dsh-orbit-roll 2.4s linear infinite;
}
@keyframes dsh-orbit-roll{to{transform:rotate(360deg)}}
.dsh-browser-loading__sat{filter:drop-shadow(0 0 3px rgba(124,184,255,.9))}
.dsh-browser-loading__text{
  color:var(--dsw-alias-label-secondary,#bbb);font-size:12px;letter-spacing:.5px;
}
.dsh-browser-drawer__timeline{
  /* 底部悬浮条：不占画面布局（原生视图高度让位 32px/展开 45%）。
     半透明深色 + 毛玻璃，贴住抽屉底边。 */
  position:absolute;left:0;right:0;bottom:0;z-index:6;
  display:flex;flex-direction:column;
  background:rgba(20,22,28,.72);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.10));
}
.dsh-browser-drawer__tl-bar{
  display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;
  border:none;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);
  font-size:12px;cursor:pointer;text-align:left;width:100%;
}
.dsh-browser-drawer__tl-bar:hover{color:var(--dsw-alias-label-primary,#eee)}
.dsh-browser-drawer__tl-latest{
  flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-primary,#eee);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;
}
.dsh-browser-drawer__tl-toggle{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}
.dsh-browser-drawer__tl-list{
  max-height:min(300px,42vh);overflow-y:auto;padding:4px 12px 10px;
  display:flex;flex-direction:column;gap:6px;scrollbar-width:thin;
}
.dsh-browser-step{
  display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:8px;
  background:rgba(255,255,255,.05);
  border:1px solid transparent;
}
.dsh-browser-step--running{border-color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-browser-step--error{border-color:var(--dsw-alias-state-danger-primary,#f56c6c)}
.dsh-browser-step__row{display:flex;align-items:center;gap:7px}
.dsh-browser-step__dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#888)}
.dsh-browser-step__dot--run{background:var(--dsw-alias-state-business-primary,#4a9eff);animation:dsh-browser-pulse 1.4s ease-in-out infinite}
.dsh-browser-step--running .dsh-browser-step__dot{background:var(--dsw-alias-state-business-primary,#4a9eff);animation:dsh-browser-pulse 1.4s ease-in-out infinite}
.dsh-browser-step--error .dsh-browser-step__dot{background:var(--dsw-alias-state-danger-primary,#f56c6c)}
.dsh-browser-step__label{font-size:12px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-browser-step__status{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary,#888);flex:none}
.dsh-browser-step--running .dsh-browser-step__status{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.dsh-browser-step--error .dsh-browser-step__status{color:var(--dsw-alias-state-danger-primary,#f56c6c)}
.dsh-browser-step__result{font-size:11px;color:var(--dsw-alias-state-danger-primary,#f56c6c);word-break:break-all}

/* ── 侧边栏会话列表标识 ───────────────────────────────────────── */
.dsh-browser-sidebar-badge{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:14px;height:14px;margin-right:4px;
  color:var(--dsw-alias-state-business-primary,#4a9eff);
}
.dsh-browser-sidebar-badge svg{animation:dsh-browser-pulse 1.4s ease-in-out infinite}

/* ── 移动端：抽屉全宽（不留左侧空隙），时间线全宽，头部取消壳子按钮让位 ── */
@media (max-width: 767.98px) {
  .dsh-browser-drawer{width:100vw;border-radius:0}
  .dsh-browser-drawer__head{padding-right:16px}
  .dsh-browser-drawer__timeline{width:100%;max-width:100%}
}
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
