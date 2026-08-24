/**
 * dsh-browser — client 侧样式（活动条 + 右侧滑出抽屉 + 侧边栏标识）。
 *
 * 布局（2026-10 重做）：抽屉内是一套真正的浏览器 chrome，自上而下三条：
 *   ① tabstrip  标签页栏独占一行（旧版标签与标题/按钮在同一行互相挤压）
 *   ② toolbar   后退 / 前进 / 刷新 · 地址栏（可编辑，含安全标识）· 收藏 · 选取 · 更多
 *   ③ bookmarks 书签栏（可折叠；chips + 管理面板）
 * 主体是画面区，底部悬浮操作时间线（收起为细轨，展开为列表）。
 * 左缘 4px 拖拽把手可调抽屉宽度（localStorage 持久化）。
 *
 * 规格对齐 DSH 官方 ui-primitives：
 *   32px 输入件 / 28px 密集按钮 r14 / 24px 胶囊 r12 / r8 输入 · r12 卡片
 *   / border-l2 细线 / 14-22 正文 / 12-18 caption。
 * 颜色只用 --dsw-alias-* 与 --dsw-specific-* token，跟随明暗主题。
 * 图标一律 SVG（icons.tsx），不再用全角字符（＋ ✕ ▴）——字形随系统字体漂移、
 * 垂直居中不可控。
 *
 * ⚠ 玻璃质感联动：glass.ts 的浮层总选择器按 [class*="drawer"] 子串匹配，
 *   抽屉的每个子元素（__head/__frame/__timeline/__close…）都会被套上
 *   backdrop-filter + inset 白边。本表末尾用精确类名把子元素的这两项复位，
 *   只保留抽屉本体的玻璃效果。
 */

const STYLE_ID = 'dsh-browser-styles'

const SHEET = `
/* ══ 局部设计变量：行高/圆角/间距集中收口，改一处全联动 ══ */
.dsh-browser-drawer{
  --dshb-row-h:38px;          /* chrome 三条的行高 */
  --dshb-ctl-h:28px;          /* 密集按钮（官方 Button sm 规格） */
  --dshb-input-h:30px;        /* 地址栏输入件 */
  --dshb-gap:6px;
  --dshb-pad:10px;
  --dshb-radius:8px;
  --dshb-rail-h:34px;         /* 时间线收起态细轨高度 */
  --dshb-accent:var(--dsw-alias-state-business-primary,#4176e6);
  --dshb-line:var(--dsw-alias-border-l2,rgba(255,255,255,.12));
  --dshb-hairline:var(--dsw-alias-border-l1,rgba(255,255,255,.06));
  --dshb-surface-2:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04));
  --dshb-ease:cubic-bezier(.2,.8,.2,1);
  /* ↓ 三个「承载小字」的面：不用可被玻璃覆盖成半透明的 token，改用固定 rgba，
     保证 10~12px 文字的背景在任何主题/玻璃档位下都稳定（默认深色值，
     浅色由下方 body:not([data-ds-dark-theme]) 段覆盖）。 */
  --dshb-field:rgba(255,255,255,.07);
  --dshb-field-hover:rgba(255,255,255,.11);
  --dshb-chip:rgba(255,255,255,.13);
  --dshb-track:rgba(16,17,21,.93);
  --dshb-card:rgba(255,255,255,.07);
  /* 错误文字：深色底用 red-400 档（叠 card 面实测 5.8:1）。 */
  --dshb-error-text:var(--dsw-alias-state-error-secondary,#f87171);
}

/* ══ 会话内浏览器常驻按钮（conversation.input.left，对齐记忆开关）══ */
.dsh-browser-seat{
  display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;padding:6px;border:none;border-radius:14px;
  background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;
  transition:color .16s cubic-bezier(.2,.8,.2,1),background .16s cubic-bezier(.2,.8,.2,1);
}
.dsh-browser-seat:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-browser-seat--on{color:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-browser-seat--on:hover{color:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-browser-seat--on svg{animation:dsh-browser-pulse 1.4s ease-in-out infinite}
@keyframes dsh-browser-pulse{0%,100%{opacity:1}50%{opacity:.45}}
/* 禁止态：AI 浏览器被用户禁用（图标转警示红，一眼可辨） */
.dsh-browser-seat--denied,
.dsh-browser-seat--denied:hover{color:var(--dsw-alias-state-error-primary,#f56c6c)}

/* ══ 「禁止 AI 使用浏览器」悬停卡片（按钮上方滑出）══
   常驻 DOM + visibility 过渡：hidden 时不参与命中，鼠标划过其区域无误触；
   展开后按钮↔卡片间移动不丢 hover（卡片是容器的 DOM 后代）。 */
.dsh-browser-seat-wrap{position:relative;display:inline-flex}
.dsh-browser-gate{
  position:absolute;left:-4px;bottom:calc(100% + 10px);z-index:60;
  width:280px;box-sizing:border-box;padding:12px 14px;border-radius:12px;
  /* 材质对齐官方下拉浮层（Menu 原语）：specific-menu 面 + inverted 边框。 */
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
.dsh-browser-gate__head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-browser-gate__title{display:flex;align-items:center;gap:7px;font-size:13px;line-height:20px;font-weight:600}
.dsh-browser-gate__state{
  flex:none;height:20px;padding:0 8px;border-radius:10px;font-size:11px;line-height:20px;
  color:var(--dsw-alias-state-business-primary,#4176e6);
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent);
}
.dsh-browser-gate__state--deny{
  color:var(--dsw-alias-state-error-primary,#f56c6c);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f56c6c) 14%,transparent);
}
.dsh-browser-gate__row{
  display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  margin-top:10px;padding-top:10px;
  border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));
}
.dsh-browser-gate__copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsh-browser-gate__label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.dsh-browser-gate__desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
.dsh-browser-gate__switch{
  position:relative;flex:none;width:40px;height:22px;border-radius:11px;border:none;
  cursor:pointer;padding:0;background:var(--dsw-alias-border-l3,#555);
  transition:background .16s;box-sizing:border-box;
}
.dsh-browser-gate__switch[aria-checked='true']{background:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-browser-gate__switch:disabled{cursor:default;opacity:.6}
.dsh-browser-gate__knob{
  position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
  background:var(--dsw-alias-label-tertiary,#888);
  transition:left .16s cubic-bezier(.2,.8,.2,1),background .16s;box-shadow:0 1px 2px rgba(0,0,0,.2);
}
.dsh-browser-gate__switch[aria-checked='true'] .dsh-browser-gate__knob{left:20px;background:#fff}

/* ══════════════════════════════════════════════════════════════════
   右侧滑出抽屉：外壳 + 拖拽把手
   打开从右往左滑入；关闭反向。左侧留空隙（hitzone）点击收回。
   宽度由 --dshb-width 控制（组件按拖拽结果写入 inline style）。
   ══════════════════════════════════════════════════════════════════ */
.dsh-browser-scrim{
  position:fixed;inset:0;z-index:8800;background:transparent;
  cursor:pointer;opacity:0;pointer-events:none;
  transition:background .2s ease,opacity .3s ease;
}
.dsh-browser-scrim--on{opacity:1;pointer-events:auto}
.dsh-browser-scrim--on:hover{background:var(--dsw-alias-bg-mask-2,rgba(0,0,0,.12))}
.dsh-browser-drawer{
  position:fixed;z-index:8801;top:0;right:0;bottom:0;
  width:var(--dshb-width,calc(100vw - 44px));
  min-width:520px;max-width:calc(100vw - 44px);
  display:flex;flex-direction:column;overflow:hidden;
  border-radius:16px 0 0 16px;
  border:1px solid var(--dshb-line);border-right:none;
  background:var(--dsw-alias-bg-overlay,#1c1f26);
  box-shadow:-24px 0 64px rgba(0,0,0,.45);
  color:var(--dsw-alias-label-primary,#eee);
  transform:translateX(calc(100% + 32px));
  transition:transform .3s var(--dshb-ease);
  will-change:transform;
}
.dsh-browser-drawer--open{transform:translateX(0)}
/* 拖拽中禁用宽度过渡与文本选择，指针跟手不打滑 */
.dsh-browser-drawer--resizing{transition:none;user-select:none}
.dsh-browser-drawer--resizing .dsh-browser-stage{pointer-events:none}

/* 左缘拖拽把手：4px 命中区，hover 时显出一条 accent 细线 */
.dsh-browser-grip{
  position:absolute;left:0;top:0;bottom:0;width:5px;z-index:12;
  cursor:col-resize;background:transparent;border:none;padding:0;
}
.dsh-browser-grip::after{
  content:'';position:absolute;left:1px;top:0;bottom:0;width:2px;border-radius:2px;
  background:transparent;transition:background .16s var(--dshb-ease);
}
.dsh-browser-grip:hover::after,
.dsh-browser-drawer--resizing .dsh-browser-grip::after{
  background:var(--dsw-alias-state-business-primary,#4176e6);
}

/* ══ ① 标签页栏（独占一行）══
   左端是「AI 浏览器」品牌标记（图标 + 运行指示点），中段是标签，
   右端是新建 + 关闭；右侧为壳子三按钮预留 150px。 */
.dsh-browser-tabstrip{
  flex:none;display:flex;align-items:center;gap:var(--dshb-gap);
  height:var(--dshb-row-h);padding:0 var(--dshb-pad);padding-right:150px;
  border-bottom:1px solid var(--dshb-hairline);
}
.dsh-browser-brand{
  flex:none;display:inline-flex;align-items:center;gap:6px;
  height:22px;padding-right:8px;margin-right:2px;
  border-right:1px solid var(--dshb-line);
  color:var(--dsw-alias-label-secondary,#bbb);
  font-size:12px;line-height:18px;font-weight:600;white-space:nowrap;
}
.dsh-browser-brand__dot{
  flex:none;width:6px;height:6px;border-radius:50%;
  background:var(--dsw-alias-label-dimmed,#666);
  transition:background .2s ease;
}
.dsh-browser-brand__dot--run{
  background:var(--dsw-alias-state-business-primary,#4176e6);
  animation:dsh-browser-pulse 1.4s ease-in-out infinite;
}
.dsh-browser-tabs{
  flex:1;min-width:0;display:flex;align-items:center;gap:3px;
  overflow-x:auto;scrollbar-width:none;
}
.dsh-browser-tabs::-webkit-scrollbar{display:none}
/* 标签：官方 Pill 语义（r12/12-18 caption），激活态用 ghost-active 三件套
   （底色 + inset 描边 + 主色文字），不再用整圈 accent 边框（太抢眼）。 */
.dsh-browser-tab{
  flex:none;display:inline-flex;align-items:center;gap:5px;
  max-width:168px;min-width:0;height:24px;padding:0 4px 0 9px;
  border:none;border-radius:12px;background:transparent;
  /* 非激活标签同样用 secondary：tertiary 在浅色下仅 3.3:1。 */
  color:var(--dsw-alias-label-secondary,#bbb);
  font-size:12px;line-height:18px;cursor:pointer;user-select:none;
  transition:background .16s var(--dshb-ease),color .16s var(--dshb-ease),box-shadow .16s var(--dshb-ease);
}
.dsh-browser-tab:hover{
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  color:var(--dsw-alias-label-secondary,#bbb);
}
.dsh-browser-tab--active,.dsh-browser-tab--active:hover{
  background:var(--dsw-alias-button-ghost-active-fill,rgba(255,255,255,.08));
  box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border,rgba(255,255,255,.14));
  color:var(--dsw-alias-label-primary,#eee);
}
/* 站点首字母胶囊：代替 favicon（内嵌视图取不到 favicon，且不想额外请求） */
.dsh-browser-tab__mark{
  flex:none;width:15px;height:15px;border-radius:4px;
  display:inline-flex;align-items:center;justify-content:center;
  /* 首字母是 10px 极小字：底色用固定 chip 面、文字用 primary，
     实测 secondary + 半透明 layer-2 只有 2.3:1。 */
  background:var(--dshb-chip);
  color:var(--dsw-alias-label-primary,#eee);
  font-size:10px;line-height:15px;font-weight:700;text-transform:uppercase;
}
/* 激活标签的首字母保持中性：accent 文字叠 accent 20% 底实测浅色仅 2.28:1
   （10px 小字需 4.5:1）。激活状态已由标签本体的 ghost-active 底 + inset 描边
   + primary 标题充分表达，不必再给首字母上色。 */
.dsh-browser-tab--active .dsh-browser-tab__mark{
  background:var(--dshb-chip);
  color:var(--dsw-alias-label-primary,#eee);
}
.dsh-browser-tab__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsh-browser-tab__close{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:16px;height:16px;border:none;border-radius:8px;padding:0;
  background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;
  opacity:0;transition:opacity .12s,background .12s,color .12s;
}
.dsh-browser-tab:hover .dsh-browser-tab__close,
.dsh-browser-tab--active .dsh-browser-tab__close{opacity:1}
.dsh-browser-tab__close:hover{
  background:var(--dsw-alias-interactive-bg-hover-solid,rgba(255,255,255,.14));
  color:var(--dsw-alias-label-primary,#eee);
}

/* ══ 通用图标按钮（工具栏 / 标签栏共用；官方 Button sm 的 icon-only 形态）══ */
.dsh-browser-ico{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:var(--dshb-ctl-h);height:var(--dshb-ctl-h);padding:0;
  border:none;border-radius:14px;background:transparent;
  color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer;
  transition:background .16s var(--dshb-ease),color .16s var(--dshb-ease);
}
.dsh-browser-ico:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  color:var(--dsw-alias-label-primary,#eee);
}
.dsh-browser-ico:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.1))}
.dsh-browser-ico:disabled{opacity:.35;cursor:default}
.dsh-browser-ico--on{
  color:var(--dsw-alias-state-business-primary,#4176e6);
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent);
}
.dsh-browser-ico--on:hover:not(:disabled){
  color:var(--dsw-alias-state-business-primary,#4176e6);
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 20%,transparent);
}
.dsh-browser-ico--danger:hover:not(:disabled){
  color:var(--dsw-alias-state-error-primary,#f56c6c);
  background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.06));
}

/* ══ ② 工具栏：导航按钮 + 地址栏 + 右侧动作 ══ */
.dsh-browser-toolbar{
  flex:none;display:flex;align-items:center;gap:var(--dshb-gap);
  height:var(--dshb-row-h);padding:0 var(--dshb-pad);
  border-bottom:1px solid var(--dshb-hairline);
}
.dsh-browser-toolbar__nav{flex:none;display:flex;align-items:center;gap:2px}
.dsh-browser-toolbar__sep{
  flex:none;width:1px;height:18px;margin:0 2px;background:var(--dshb-line);
}

/* 地址栏：官方 Input 规格（h30 r8 border-l2 bg-layer-1，focus-within 描主色）。
   非编辑态展示「安全标识 + 域名强调 + 路径淡化」，点击进入编辑并全选。 */
.dsh-browser-omni{
  flex:1;min-width:0;display:flex;align-items:center;gap:6px;
  height:var(--dshb-input-h);padding:0 8px;box-sizing:border-box;
  border:1px solid var(--dshb-line);border-radius:var(--dshb-radius);
  /* 输入面用固定 rgba 而非 --dsw-alias-bg-layer-1：玻璃模式会把该 token 覆盖成
     半透明（alpha≈0.75），地址栏文字的实际背景就变成「壁纸渐变」，13px 路径段
     实测只有 3.45:1。这里自带 ~0.9 不透明度，两种主题下背景都稳定。 */
  background:var(--dshb-field);
  cursor:text;transition:border-color .16s var(--dshb-ease),background .16s var(--dshb-ease);
}
.dsh-browser-omni:hover{background:var(--dshb-field-hover)}
.dsh-browser-omni:focus-within{
  border-color:var(--dsw-alias-state-business-primary,#4176e6);
  background:var(--dshb-field-hover);
}
.dsh-browser-omni__lock{
  flex:none;display:inline-flex;align-items:center;
  color:var(--dsw-alias-state-success-primary,#39b54a);
}
.dsh-browser-omni__lock--insecure{color:var(--dsw-alias-state-warn-label,#d98c25)}
/* 非编辑态文本：域名用 primary，其余（协议/路径/查询）淡化为 tertiary */
.dsh-browser-omni__text{
  flex:1;min-width:0;font-size:13px;line-height:20px;
  /* 路径段用 secondary 而非 tertiary：实测 tertiary 在深色 + 玻璃半透明底上
     只有 2.4:1，低于 WCAG AA 的 4.5:1。域名段另有 primary 强调。 */
  color:var(--dsw-alias-label-secondary,#bbb);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  text-align:left;background:transparent;border:none;padding:0;cursor:text;font-family:inherit;
}
.dsh-browser-omni__host{color:var(--dsw-alias-label-primary,#eee);font-weight:500}
.dsh-browser-omni__placeholder{color:var(--dsw-alias-label-dimmed,#666)}
/* 编辑态 input：与非编辑态同字号/行高，切换时文字不跳动 */
.dsh-browser-omni__input{
  flex:1;min-width:0;border:none;outline:none;background:transparent;padding:0;
  font-size:13px;line-height:20px;font-family:inherit;
  color:var(--dsw-alias-label-primary,#eee);
}
.dsh-browser-omni__input::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
/* 加载进度条：贴地址栏底缘的 2px 主色轨（不确定进度用无限位移动画） */
.dsh-browser-omni__prog{
  position:absolute;left:0;right:0;bottom:-1px;height:2px;overflow:hidden;
  border-radius:0 0 var(--dshb-radius) var(--dshb-radius);
}
.dsh-browser-omni{position:relative}
.dsh-browser-omni__prog::after{
  content:'';position:absolute;top:0;bottom:0;width:40%;
  background:var(--dsw-alias-state-business-primary,#4176e6);
  animation:dsh-browser-indet 1.1s ease-in-out infinite;
}
@keyframes dsh-browser-indet{
  0%{left:-40%}100%{left:100%}
}
.dsh-browser-toolbar__actions{flex:none;display:flex;align-items:center;gap:2px}

/* ══ ③ 书签栏：chips + 管理面板 ══ */
.dsh-browser-sites{
  flex:none;border-bottom:1px solid var(--dshb-hairline);
}
.dsh-browser-sites__row{
  display:flex;align-items:center;gap:var(--dshb-gap);
  min-height:32px;padding:3px var(--dshb-pad);
  overflow-x:auto;scrollbar-width:none;
}
.dsh-browser-sites__row::-webkit-scrollbar{display:none}
/* 书签胶囊：官方 Pill 规格（h24 r12 12-18），带站点首字母标记 */
.dsh-browser-site{
  flex:none;display:inline-flex;align-items:center;gap:5px;
  height:24px;padding:0 10px 0 6px;border:none;border-radius:12px;
  background:transparent;color:var(--dsw-alias-label-secondary,#bbb);
  font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;
  transition:background .16s var(--dshb-ease),color .16s var(--dshb-ease),box-shadow .16s var(--dshb-ease);
}
.dsh-browser-site:hover{
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  color:var(--dsw-alias-label-primary,#eee);
}
.dsh-browser-site--active{
  background:var(--dsw-alias-button-ghost-active-fill,rgba(255,255,255,.08));
  box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border,rgba(255,255,255,.14));
  color:var(--dsw-alias-label-primary,#eee);
}
.dsh-browser-site__mark{
  flex:none;width:16px;height:16px;border-radius:5px;
  display:inline-flex;align-items:center;justify-content:center;
  background:var(--dshb-chip);
  color:var(--dsw-alias-label-primary,#eee);
  font-size:10px;line-height:16px;font-weight:700;text-transform:uppercase;
}
/* 同上：书签胶囊的激活态由 ghost-active 底 + inset 描边表达。 */
.dsh-browser-site--active .dsh-browser-site__mark{
  background:var(--dshb-chip);
  color:var(--dsw-alias-label-primary,#eee);
}
.dsh-browser-sites__empty{
  /* dimmed / tertiary 落在壁纸上分别只有 1.1 / 3.3:1；空态提示用 secondary。 */
  flex:1;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);
}
.dsh-browser-sites__manage{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;border:none;border-radius:12px;padding:0;
  background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;
  transition:background .16s var(--dshb-ease),color .16s var(--dshb-ease);
}
.dsh-browser-sites__manage:hover,.dsh-browser-sites__manage--on{
  background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));
  color:var(--dsw-alias-label-primary,#eee);
}
/* 管理面板：卡片式（r12 + module 面 + border-l2），对齐记忆面板的设置卡 */
.dsh-browser-sites__editor{
  margin:0 var(--dshb-pad) 8px;padding:10px;border-radius:12px;
  background:var(--dshb-surface-2);
  border:1px solid var(--dshb-line);
}
.dsh-browser-sites__form{display:flex;align-items:center;gap:8px}
.dsh-browser-sites__input{
  height:32px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;
  border-radius:var(--dshb-radius);border:1px solid var(--dshb-line);
  background:var(--dsw-alias-bg-layer-1,transparent);
  color:var(--dsw-alias-label-primary,#eee);outline:none;min-width:0;box-sizing:border-box;
  transition:border-color .16s var(--dshb-ease);
}
.dsh-browser-sites__input::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
.dsh-browser-sites__input:focus{border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-browser-sites__input--title{flex:none;width:132px}
.dsh-browser-sites__input--url{flex:1}
/* 主按钮：官方 Button md/primary（h36 r18）在密集行里降到 h32 r16 */
.dsh-browser-sites__save{
  flex:none;height:32px;padding:0 16px;border-radius:16px;border:none;
  background:var(--dsw-alias-button-primary-fill,#4176e6);
  color:var(--dsw-alias-label-primary-foreground,#fff);
  font-size:13px;line-height:20px;font-family:inherit;cursor:pointer;
  transition:background .16s var(--dshb-ease),opacity .16s;
}
.dsh-browser-sites__save:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#365fc0)}
.dsh-browser-sites__save:disabled{opacity:.4;cursor:not-allowed}
.dsh-browser-sites__list{margin-top:8px;display:flex;flex-direction:column;max-height:180px;overflow-y:auto;scrollbar-width:thin}
.dsh-browser-sites__item{
  display:flex;align-items:center;gap:10px;padding:5px 4px;border-radius:6px;
  transition:background .12s;
}
.dsh-browser-sites__item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.dsh-browser-sites__item-title{
  flex:none;width:110px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;
}
.dsh-browser-sites__item-url{
  /* tertiary 叠管理面板的 module 面在浅色下只有 3.3:1，用 secondary。 */
  flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.dsh-browser-sites__del{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;border:none;border-radius:12px;padding:0;
  background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;
  transition:background .12s,color .12s;
}
.dsh-browser-sites__del:hover{
  color:var(--dsw-alias-state-error-primary,#f56c6c);
  background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.06));
}

/* ══ 更多菜单（工具栏「…」下拉；材质对齐官方 Menu 原语）══ */
.dsh-browser-more{
  position:absolute;top:calc(100% + 4px);right:0;z-index:40;
  min-width:216px;box-sizing:border-box;padding:4px;
  border:1px solid var(--dsw-alias-border-inverted,rgba(255,255,255,.06));
  border-radius:12px;
  background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay,#1c1f26));
  box-shadow:var(--dsw-shadow-lv3,0 16px 44px rgba(0,0,0,.35));
}
.dsh-browser-more-wrap{position:relative;display:inline-flex}
.dsh-browser-more__item{
  display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;
  height:32px;padding:0 10px;border:none;border-radius:8px;
  background:transparent;color:var(--dsw-alias-label-primary,#eee);
  font-size:13px;line-height:20px;font-family:inherit;text-align:left;cursor:pointer;
  transition:background .12s var(--dshb-ease);
}
.dsh-browser-more__item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dsh-browser-more__item:disabled{opacity:.4;cursor:default;background:transparent}
.dsh-browser-more__hint{margin-left:auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-dimmed,#666)}
.dsh-browser-more__sep{height:1px;margin:4px 0;background:var(--dshb-line)}

/* ══ 画面区 ══ */
.dsh-browser-view{position:relative;display:flex;flex:1;min-height:0}
.dsh-browser-stage{
  flex:1;min-width:0;position:relative;overflow:hidden;
  display:flex;align-items:center;justify-content:center;
  /* 深色棋盘底：页面未铺满画面区时（窗口比页面宽）不是一片死黑，
     而是可辨的「画布外」质感，与真实浏览器的空白区一致。 */
  background:
    linear-gradient(var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24)),var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24))),
    #0b0c10;
}
.dsh-browser-stage img{
  max-width:100%;max-height:100%;object-fit:contain;display:block;
  cursor:default;outline:none;user-select:none;-webkit-user-drag:none;
}
.dsh-browser-blank{
  display:flex;flex-direction:column;align-items:center;gap:6px;
  color:var(--dsw-alias-label-tertiary,#888);font-size:13px;line-height:20px;
}
.dsh-browser-blank__hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-dimmed,#666)}

/* 画面加载中：星环滚动 + 文案 */
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
  color:var(--dsw-alias-label-secondary,#bbb);font-size:12px;line-height:18px;letter-spacing:.5px;
}

/* ══ 元素选取：准星 + 顶部提示条 + hover 范围框 ══ */
.dsh-browser-stage--picking{cursor:crosshair}
.dsh-browser-stage--picking img{cursor:crosshair}
.dsh-browser-pickhint{
  position:absolute;top:12px;left:50%;transform:translateX(-50%);
  display:inline-flex;align-items:center;gap:6px;
  height:28px;padding:0 14px;border-radius:14px;
  background:var(--dsw-specific-menu,rgba(20,22,28,.92));
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent);
  box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.35));
  color:var(--dsw-alias-label-primary,#eee);font-size:12px;line-height:18px;
  pointer-events:none;white-space:nowrap;z-index:5;
}
/* hover 范围提示框：DevTools 风格的半透明高亮 + 左上角 tag 标签 */
.dsh-browser-pickbox{
  position:absolute;z-index:4;pointer-events:none;
  border:1px solid var(--dsw-alias-state-business-primary,#4176e6);
  border-radius:2px;
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent);
  box-shadow:0 0 0 1px rgba(0,0,0,.35);
}
.dsh-browser-pickbox__tag{
  position:absolute;left:-1px;top:-1px;
  background:var(--dsw-alias-state-business-primary,#4176e6);
  color:#fff;font-size:11px;line-height:18px;padding:0 6px;
  border-radius:2px 0 6px 0;white-space:nowrap;max-width:220px;
  overflow:hidden;text-overflow:ellipsis;pointer-events:none;
}

/* ══ 底部操作时间线：收起=细轨，展开=列表 ══ */
.dsh-browser-track{
  position:absolute;left:0;right:0;bottom:0;z-index:6;
  display:flex;flex-direction:column;
  /* 固定 0.93 不透明度：时间线里全是 11~12px 小字，背景必须稳定
     （用 --dsw-alias-bg-overlay 时玻璃档位会把它拉到半透明，
      条目状态/错误文字掉到 1.6~3.8:1）。 */
  background:var(--dshb-track);
  border-top:1px solid var(--dshb-line);
}
.dsh-browser-track__bar{
  display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;
  height:var(--dshb-rail-h);padding:0 var(--dshb-pad);
  border:none;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);
  font-size:12px;line-height:18px;font-family:inherit;text-align:left;cursor:pointer;
  transition:background .12s var(--dshb-ease);
}
.dsh-browser-track__bar:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}
.dsh-browser-track__latest{
  flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#eee);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;
}
/* 步骤计数胶囊（对齐记忆面板 Tab 计数徽标） */
.dsh-browser-track__count{
  flex:none;min-width:16px;padding:0 5px;border-radius:8px;
  /* 中性徽标：accent 字叠 accent 16% 底在浅色主题实测 1.47:1，不可用。 */
  background:var(--dshb-chip);
  color:var(--dsw-alias-label-primary,#eee);
  font-size:10px;line-height:16px;font-weight:600;text-align:center;
  font-variant-numeric:tabular-nums;
}
.dsh-browser-track__toggle{
  flex:none;display:inline-flex;align-items:center;
  color:var(--dsw-alias-label-tertiary,#888);
}
.dsh-browser-track__list{
  max-height:min(300px,42vh);overflow-y:auto;padding:2px var(--dshb-pad) 10px;
  display:flex;flex-direction:column;gap:4px;scrollbar-width:thin;
}
.dsh-browser-step{
  display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:8px;
  /* 固定 card 面（叠在近实色的时间线上）：条目里的 11~12px 状态/错误文字
     需要稳定背景才能达到 4.5:1。 */
  background:var(--dshb-card);
  border:1px solid transparent;
}
.dsh-browser-step--running{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent)}
.dsh-browser-step--error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f56c6c) 55%,transparent)}
.dsh-browser-step__row{display:flex;align-items:center;gap:7px}
.dsh-browser-step__dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-dimmed,#666)}
.dsh-browser-step__dot--run,
.dsh-browser-step--running .dsh-browser-step__dot{
  background:var(--dsw-alias-state-business-primary,#4176e6);
  animation:dsh-browser-pulse 1.4s ease-in-out infinite;
}
.dsh-browser-step--error .dsh-browser-step__dot{background:var(--dsw-alias-state-error-primary,#f56c6c)}
.dsh-browser-step__label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-browser-step__status{margin-left:auto;flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-browser-step--running .dsh-browser-step__status{color:var(--dsw-alias-state-business-primary,#4176e6)}
.dsh-browser-step--error .dsh-browser-step__status{color:var(--dsw-alias-state-error-primary,#f56c6c)}
.dsh-browser-step__result{
  font-size:12px;line-height:18px;font-weight:500;word-break:break-all;
  /* 错误红需按主题分档：浅色底要更深的红（red-600 实测仅 3.8:1），
     深色底要更亮的红。用局部变量承载，浅色主题在下方段落覆盖。 */
  color:var(--dshb-error-text);
}
.dsh-browser-track__empty{
  padding:8px 4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-dimmed,#666);
}

/* ══ 侧边栏会话列表标识 ══ */
.dsh-browser-sidebar-badge{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:14px;height:14px;margin-right:4px;
  color:var(--dsw-alias-state-business-primary,#4176e6);
}
.dsh-browser-sidebar-badge svg{animation:dsh-browser-pulse 1.4s ease-in-out infinite}

/* ══ 明亮主题微调 ══
   ① 上面那批「固定不透明度的面」默认是深色值，浅色主题要整体换成白系；
   ② 抽屉阴影/画面外底色在浅色下减轻，否则右缘出现一条突兀的黑带。 */
body:not([data-ds-dark-theme]) .dsh-browser-drawer{
  --dshb-field:rgba(255,255,255,.92);
  --dshb-field-hover:#fff;
  --dshb-chip:rgba(31,35,41,.10);
  --dshb-track:rgba(255,255,255,.95);
  --dshb-card:rgba(31,35,41,.05);
  /* 浅色底：#c62828 叠 card 面实测 4.75:1（red-600 只有 3.8:1）。 */
  --dshb-error-text:#c62828;
  box-shadow:-20px 0 52px rgba(31,35,41,.16);
}
body:not([data-ds-dark-theme]) .dsh-browser-stage{
  background:
    linear-gradient(rgba(31,35,41,.06),rgba(31,35,41,.06)),
    var(--dsw-alias-bg-module-platform,#f2f4f7);
}
body:not([data-ds-dark-theme]) .dsh-browser-pickhint{
  background:var(--dsw-specific-menu,#fff);
}
/* ⚠ 这里不要再给 .dsh-browser-track 设 background：它已由 --dshb-track
   （上面按主题给值）承担。此前多写了一条 var(--dsw-alias-bg-overlay) 覆盖，
   而该 token 被玻璃覆盖层改成 alpha 0.4，把刚稳定下来的面又拉透明，
   时间线里 11~12px 文字回落到 2.0~2.6:1。 */
body:not([data-ds-dark-theme]) .dsh-browser-tab__close:hover{
  /* hover-solid 在浅色主题是浅灰实色，深色规则里的白色半透明不适用 */
  background:var(--dsw-alias-interactive-bg-hover-solid,#eef0f4);
}

/* ══ 玻璃质感联动 ══
   glass.ts 的浮层总选择器是 [class*="panel"|"modal"|"drawer"] 子串匹配，且带
   4 个 :not() 伪类——特异性 (0,6,1) 高于任何普通后代选择器，插件侧「复位」
   规则一律被它压过（实测 backdrop-filter 仍生效）。因此不靠覆盖，靠命名：
   抽屉本体保留 dsh-browser-drawer（需要玻璃），所有子元素改名为 stage /
   track / grip / scrim / pickbox 等，不含触发子串，自然不会被套上模糊与
   inset 白边。（不改 glass.ts 的公共选择器：其他插件面板依赖该子串约定。）

   剩下三处需要在玻璃模式下主动调整。 */
/* ① 抽屉本体去实色底：质感交给模糊 + 壁纸（glass.ts 已提供 backdrop-filter）。 */
html[data-dsh-glass] .dsh-browser-drawer{background-color:transparent}
/* ② 画面区保持不透明：底下是原生视图/实时帧，透出壁纸会让页面画面发灰。 */
html[data-dsh-glass] .dsh-browser-stage{
  background:
    linear-gradient(var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24)),var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24))),
    #0b0c10;
}
/* ③ 更多菜单与选取提示是抽屉内的浮层：自己补模糊（它们不再被 glass 命中）。
   ⚠ 时间线（.dsh-browser-track）不在此列：它承载 10~12px 小字，背景必须稳定
   在 --dshb-track（0.93~0.95 不透明度）。此前这里额外覆盖成
   color-mix(bg-overlay 62%) → 玻璃模式下实测 alpha 仅 0.248，条目状态/错误
   文字掉到 2.0~2.6:1（低于 AA）。 */
html[data-dsh-glass] .dsh-browser-more,
html[data-dsh-glass] .dsh-browser-pickhint{
  backdrop-filter:var(--dsh-glass-blur,saturate(160%) blur(18px));
  -webkit-backdrop-filter:var(--dsh-glass-blur,saturate(160%) blur(18px));
}

/* ══ 窄屏（<1100px）：书签栏收起、标签更窄 ══ */
@media (max-width: 1099.98px){
  .dsh-browser-tab{max-width:120px}
  .dsh-browser-sites__input--title{width:96px}
}

/* ══ 移动端：抽屉全宽、无圆角、工具条换行、时间线全宽 ══ */
@media (max-width: 767.98px){
  .dsh-browser-drawer{
    width:100vw;min-width:0;max-width:100vw;border-radius:0;border-left:none;
  }
  /* 移动端无壳子窗口按钮，收回预留区 */
  .dsh-browser-tabstrip{padding-right:var(--dshb-pad)}
  .dsh-browser-grip{display:none}
  .dsh-browser-brand{display:none}
  .dsh-browser-toolbar{flex-wrap:wrap;height:auto;padding:5px var(--dshb-pad)}
  .dsh-browser-omni{order:3;flex-basis:100%;margin-top:5px}
  .dsh-browser-track{width:100%;max-width:100%}
  .dsh-browser-sites__form{flex-wrap:wrap}
  .dsh-browser-sites__input--title{flex:1 1 100%;width:auto}
  .dsh-browser-sites__input--url{flex:1 1 100%}
  .dsh-browser-sites__save{flex:1 1 100%}
}

/* ══ 无障碍：降低动效偏好下停掉脉冲与不确定进度动画 ══ */
@media (prefers-reduced-motion: reduce){
  .dsh-browser-seat--on svg,
  .dsh-browser-brand__dot--run,
  .dsh-browser-step__dot--run,
  .dsh-browser-step--running .dsh-browser-step__dot,
  .dsh-browser-sidebar-badge svg{animation:none}
  .dsh-browser-omni__prog::after{animation:none;width:100%;opacity:.5}
  .dsh-browser-drawer{transition:none}
  .dsh-browser-loading__ring{animation:none}
}
`

let injected = false

/** 注入抽屉/活动条样式（幂等）；返回移除函数。 */
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
