/**
 * team — 样式（运行时注入 <style>，类名前缀 team-）。
 *
 * 控件规格对齐 DSH 官方 ModelsSection（dsh-ui-style 技能）：
 *  - 输入框/下拉 32px 高、8px 圆角、border-l2、bg-layer-1；下拉自绘 chevron；
 *  - 行卡片 border-l2 + 12px 圆角、无底色；编辑面 bg-module-platform + 12px 圆角；
 *  - 大按钮胶囊 18px/36px、行内小按钮 14px/28px；
 *  - 开启态/选中态一律用 --dsw-alias-state-business-primary（绝不用 brand-primary）。
 *
 * 布局：团队面板是**右侧全高抽屉**（占满右边可视区，宽度自适应），内部编制页为
 * 「左画布 + 右检视栏」双列，窄屏退化为上下单列。
 * 抽屉是浮层本体；HUD 与收起胶囊已去玻璃（用户要求）：底色改用不参与 glass.ts
 * 玻璃覆盖的 static-neutral-bluish 不透明 token（否则玻璃质感开启时 alias 层的
 * specific-menu 会被整体替换成半透明值，光删 blur 挡不住透底），并显式声明
 * backdrop-filter 为 none；布局列容器不加 filter/transform。
 */

const STYLE_ID = 'dsh-webui-team-styles'

const SHEET = `
/* ══ 全屏右侧抽屉（占满右边可视区，自适应）══ */
@keyframes team-drawer-in{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:translateX(0)}}
@keyframes team-drawer-out{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(28px)}}
/* 去玻璃版：类名含 drawer 子串会被 glass.ts 浮层总选择器命中叠 blur+内高光，
   由组件在根元素挂 data-solid 走官方豁免口排除；底色用 static 不透明 token
   （specific-menu 会经 bg-layer-3 链路被玻璃 token 层半透明化，不能再用）。 */
.team-mask{position:fixed;inset:0;z-index:960;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45))}
.team-mask[data-anim='in']{animation:dsh-modal-mask-in 240ms ease both}
.team-mask[data-anim='out']{animation:dsh-modal-mask-out 240ms ease both}
.team-drawer{position:fixed;top:0;bottom:0;right:0;z-index:961;display:flex;flex-direction:column;box-sizing:border-box;border-left:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:var(--dsw-static-neutral-bluish-00,#fff);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden}
body[data-ds-dark-theme] .team-drawer{background:var(--dsw-static-neutral-bluish-950,rgb(21,21,23))}
.team-drawer[data-anim='in']{animation:team-drawer-in 260ms cubic-bezier(.2,.8,.2,1)}
.team-drawer[data-anim='out']{animation:team-drawer-out 220ms cubic-bezier(.4,0,.2,1) both}
.team-drawer-head{flex:none;display:flex;align-items:center;gap:10px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-drawer-title{flex:none;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}

/* ══ 面板主体 ══ */
.team-panel{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}

/* 团队切换器行 */
.team-switch{flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-switch-row{display:flex;align-items:center;gap:6px;min-width:0}
.team-model-row{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-model-row>span{flex:none}

/* Tab 栏 */
.team-tabs{flex:none;display:flex;align-items:center;gap:4px;padding:8px 16px 0}
.team-tab{appearance:none;border:none;background:transparent;border-radius:8px;height:32px;padding:0 14px;font-size:13px;line-height:22px;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;font-family:inherit;transition:background .22s cubic-bezier(.2,.8,.2,1),color .22s cubic-bezier(.2,.8,.2,1)}
.team-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.team-tab[data-active='true'],.team-tab[data-active='true']:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);font-weight:600}

/* ══ 双列工作区（左画布 / 右检视栏）══ */
.team-work{flex:1;min-height:0;display:flex}
.team-work-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px}
.team-work-side{flex:none;width:360px;min-height:0;display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-side-scroll{flex:1;min-height:0;overflow-y:auto;padding:10px 14px 16px;display:flex;flex-direction:column;gap:8px}
.team-work[data-narrow='true']{flex-direction:column}
.team-work[data-narrow='true'] .team-work-side{width:auto;border-left:none;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));max-height:46%}
.team-work[data-narrow='true'] .team-work-main{min-height:280px}

/* 单列滚动区（运行/历史/设置页） */
.team-scroll{flex:1;min-height:0;overflow-y:auto;padding:10px 16px 16px;display:flex;flex-direction:column;gap:10px}
.team-scroll-narrow{max-width:760px}
.team-empty{margin:20px 4px;padding:18px 12px;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888);text-align:center;border:1px dashed var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:10px}
.team-error{margin:0;padding:8px 12px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary,#e0434b);color:var(--dsw-alias-state-error-primary,#e0434b);font-size:12px;line-height:18px;word-break:break-word}
.team-section-title{flex:none;margin:2px 2px 0;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}

/* ══ 控件（官方规格）══ */
.team-input,.team-textarea{width:100%;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.team-textarea{height:auto;min-height:76px;padding:8px 10px;resize:vertical;line-height:20px}
.team-input::placeholder,.team-textarea::placeholder{color:var(--dsw-alias-label-dimmed,#666)}
.team-select{appearance:none;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0 32px 0 10px;font-size:14px;line-height:22px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background-color:var(--dsw-alias-bg-layer-1,#1c1f26);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px;cursor:pointer;max-width:240px}
.team-select-grow{max-width:none;flex:1;min-width:0}
.team-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.team-field>span{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-inline{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
.team-inline .team-field{flex:1;min-width:130px}

.team-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;height:28px;padding:0 14px;font-size:12px;line-height:26px;font-family:inherit;color:var(--dsw-alias-label-primary,#eee);background:transparent;cursor:pointer;white-space:nowrap}
.team-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.team-btn:disabled{opacity:.45;cursor:default}
.team-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#4176e6));color:var(--dsw-alias-label-primary-foreground,#fff)}
.team-btn-primary:hover:not(:disabled){filter:brightness(1.06)}
.team-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary,#e0434b);color:var(--dsw-alias-state-error-primary,#e0434b)}
.team-btn-lg{height:36px;border-radius:18px;padding:0 18px;font-size:14px;line-height:34px}
.team-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.team-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.team-icon-btn:disabled{opacity:.45;cursor:default}
.team-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.team-chip{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;height:26px;padding:0 12px;font-size:12px;line-height:24px;font-family:inherit;color:var(--dsw-alias-label-secondary,#bbb);background:transparent;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.team-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.team-chip:disabled{opacity:.5;cursor:default}

/* 徽标 / 标签 */
.team-tag{flex:none;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);white-space:nowrap}
.team-tag[data-tone='team']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-tag[data-tone='role']{border-color:color-mix(in srgb,#3fb96b 60%,transparent);color:#3fb96b}
.team-tag[data-tone='run']{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 60%,transparent);color:var(--dsw-alias-state-warn-primary,#e8a33d)}
.team-tag[data-tone='global']{opacity:.8}

/* ══ 可交互编制图 ══ */
.team-graph-host{position:relative;flex:1;min-height:220px;min-width:0;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.02));overflow:hidden}
.team-graph{display:block;touch-action:none;user-select:none}
.team-node{cursor:grab}
.team-node[data-dragging='true']{cursor:grabbing}
.team-node[data-linking='true']{cursor:crosshair}
.team-node-circle{transition:filter .18s ease,stroke-width .18s ease}
.team-node:hover .team-node-circle{filter:brightness(1.18)}
.team-node-label{font-weight:600;fill:var(--dsw-alias-label-primary,#eee);pointer-events:none}
.team-node-sub{fill:var(--dsw-alias-label-tertiary,#999);pointer-events:none}
.team-node-handle{fill:var(--dsw-alias-bg-layer-1,#1c1f26);stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:1.4;opacity:0;cursor:crosshair;transition:opacity .15s ease}
.team-node:hover .team-node-handle{opacity:1}
.team-edge{stroke:var(--dsw-alias-border-l2,rgba(255,255,255,.16));stroke-width:1;fill:none}
.team-edge[data-chain='true']{stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:2}
.team-edge[data-direct='true']{stroke-dasharray:4 3;opacity:.75;stroke:var(--dsw-alias-label-tertiary,#888)}
.team-edge[data-direct='true'][data-selected='true']{opacity:1;stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:2}
.team-edge[data-preview='true']{stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:1.6;stroke-dasharray:5 4}
.team-edge-label{font-size:10px;fill:var(--dsw-alias-state-business-primary,#4176e6);pointer-events:none}
.team-graph-linkbar{position:absolute;left:12px;bottom:12px;display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv2,0 6px 24px rgba(0,0,0,.35));font-size:12px;color:var(--dsw-alias-label-primary,#eee)}
.team-graph-tip{position:absolute;left:50%;top:10px;transform:translateX(-50%);padding:4px 10px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 50%,transparent);font-size:11px;color:var(--dsw-alias-state-business-primary,#4176e6);pointer-events:none}
.team-graph-bar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.team-legend{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#888);padding:0 2px}
.team-legend-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}

/* ══ 角色行卡片 ══ */
.team-role-card{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:transparent}
.team-role-card[data-selected='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent)}
.team-role-row{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:11px 12px;border:none;border-radius:12px;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer}
.team-role-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.team-role-dot{flex:none;width:8px;height:8px;border-radius:50%}
.team-role-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.team-role-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.team-role-sub{display:flex;align-items:center;gap:8px;overflow:hidden;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.team-role-editor{margin:0 8px 8px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.03));border-radius:12px}
.team-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary,#888);transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.team-chevron[data-open='true']{transform:rotate(180deg)}

/* ══ 编制页 ══ */
.team-roster-bar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.team-link-tip{display:flex;align-items:center;gap:8px;align-self:flex-start;padding:5px 12px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 45%,transparent);font-size:12px;color:var(--dsw-alias-state-business-primary,#4176e6)}

/* ══ 全屏关系画布层（portal 到 body；不是画在卡片里）══
   ⚠ 底色必须用 static token：alias 层的 bg-layer-* 与 specific-menu 在玻璃质感
   开启时被 glass.ts 覆盖成 rgba(...,.75) 半透明，全屏层会把底下的会话页透上来
   （实测顶栏标题与背景文字叠在一起）。static-neutral-bluish-* 不参与玻璃覆盖。
   也不加 backdrop-filter：全屏大面积模糊有实打实的合成开销。
   ⚠⚠ 本文件是整段注入的 CSS 字符串：任何注释内部都严禁出现「星号紧跟正斜杠」
   的两字符闭合序列（包括 token 名里的 bg-xxx 星号 斜杠 yyy 这类写法），否则会
   提前闭合本注释，残骸文本会把下一条 CSS 规则拖成非法选择器整条丢弃——
   2026-08-25 实测：全屏画布层规则因此消失，画布点不开；连本警告的第一版都
   因为原样写出了该序列而复发，务必只许文字描述、不许写出这两个连续字符。 */
.team-canvas-layer{position:fixed;inset:0;z-index:1200;display:flex;background:var(--dsw-static-neutral-bluish-00,#fff);animation:dsh-modal-slide-in .2s cubic-bezier(.2,.8,.2,1)}
body[data-ds-dark-theme] .team-canvas-layer{background:var(--dsw-static-neutral-bluish-950,rgb(21,21,23))}
.team-canvas{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.team-canvas-bar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-canvas-title{flex:none;margin-right:4px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
/* 视口：网格底纹用两条 linear-gradient（零 DOM 开销，不拖累滚动）。
   每个 background tile 只画一条线，间距完全由 background-size 决定，
   TeamBoard 用 inline style 把 size/position 跟 zoom/pan 同步，
   于是网格随画布一起平移缩放（无限画布的空间参照）。 */
.team-canvas-viewport{position:relative;flex:1;min-height:0;min-width:0;overflow:hidden;touch-action:none;cursor:grab;background-color:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.02));background-image:linear-gradient(to right,var(--dsw-alias-border-l1,rgba(255,255,255,.06)) 0 1px,transparent 1px 100%),linear-gradient(to bottom,var(--dsw-alias-border-l1,rgba(255,255,255,.06)) 0 1px,transparent 1px 100%);background-size:32px 32px}
.team-canvas-viewport[data-panning='true']{cursor:grabbing}
.team-canvas-viewport[data-linking='true']{cursor:crosshair}
.team-canvas-world{position:absolute;left:0;top:0;transform-origin:0 0}
.team-canvas-svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
/* 连线本体不拦事件，命中交给同组的透明加粗 hit path */
.team-edge{fill:none;stroke:var(--dsw-alias-border-l2,rgba(255,255,255,.18));stroke-width:1.6;pointer-events:none}
.team-edge[data-kind='link']{stroke:var(--dsw-alias-label-tertiary,#888);stroke-dasharray:6 5;opacity:.85}
.team-edge[data-kind='link'][data-active='true']{stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:2.4;stroke-dasharray:none;opacity:1}
.team-edge[data-kind='chain']{stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:2.4;opacity:.9}
.team-edge[data-kind='ghost']{stroke:var(--dsw-alias-state-business-primary,#4176e6);stroke-width:2;stroke-dasharray:6 5}
.team-edge-hit{fill:none;stroke:transparent;stroke-width:16;pointer-events:stroke;cursor:pointer}
.team-edge-tools{position:absolute;z-index:40;transform:translate(-50%,-50%);display:flex;align-items:center;gap:6px;padding:5px 7px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv2,0 6px 24px rgba(0,0,0,.35))}
.team-canvas-zoom{position:absolute;right:14px;bottom:14px;z-index:50;display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv2,0 6px 24px rgba(0,0,0,.35))}
.team-canvas-zoom-val{min-width:40px;text-align:center;font-size:11px;font-family:ui-monospace,SFMono-Regular,monospace;color:var(--dsw-alias-label-secondary,#bbb)}
.team-canvas-empty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);pointer-events:none}
/* 壳子无边框窗口右上角悬浮「最小化/最大化/关闭」（约 138×28，z-index 高于页面
   全部内容）。全屏画布顶栏铺到屏幕右缘，「退出画布」会被三按钮压住——右侧
   预留 150px（与 shell-titlebar.ts / browser/styles.ts 同一常量）。 */
@media (min-width:768px){
  .team-canvas-bar{padding-right:150px}
}

/* 画布节点：固定宽高（连线锚点靠它稳定），层级由 inline z-index 管控 */
.team-board-node{position:absolute;box-sizing:border-box}
.team-board-node[data-dragging='true']{filter:drop-shadow(0 10px 26px rgba(0,0,0,.4))}
.team-board-node .team-role-card-grid{height:100%;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d))}
.team-board-node .team-grid-head{cursor:grab}
.team-board-node[data-dragging='true'] .team-grid-head{cursor:grabbing}

/* ══ 角色卡片网格 ══ */
.team-role-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:10px;align-items:stretch}

/* 角色卡片（网格与画布共用；纯展示，编辑走弹窗） */
.team-role-card-grid{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:transparent;overflow:hidden;cursor:pointer;transition:border-color .18s ease,box-shadow .18s ease}
.team-role-card-grid:hover{border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.22))}
.team-role-card-grid[data-selected='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent)}
.team-role-card-grid[data-linking='true']{border-color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 35%,transparent)}
.team-role-card-grid[data-link-mode='true']{cursor:crosshair}
.team-role-card-grid[data-link-mode='true']:not([data-linking='true']):hover{border-color:var(--dsw-alias-state-business-primary,#4176e6)}

.team-grid-head{flex:none;display:flex;align-items:center;gap:10px;padding:10px 12px}
.team-avatar{flex:none;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;font-size:16px;font-weight:600;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.35);overflow:hidden;white-space:nowrap}
.team-grid-title{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.team-grid-en{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.6;font-family:ui-monospace,SFMono-Regular,monospace}
.team-grid-step{flex:none;margin-left:6px;padding:0 5px;border-radius:8px;background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff;font-size:10px;line-height:15px;font-weight:600;vertical-align:1px}
.team-grid-actions{flex:none;display:flex;align-items:center;gap:2px;opacity:.5;transition:opacity .18s ease}
.team-role-card-grid:hover .team-grid-actions{opacity:1}
.team-grid-actions .team-icon-btn{width:24px;height:24px}
.team-icon-btn-on{border-color:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent)}

/* 定位语固定两行：保证卡片等高、画布锚点不漂 */
.team-grid-tagline{flex:none;height:32px;padding:0 12px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}

.team-grid-model{flex:none;display:flex;align-items:center;gap:6px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);min-width:0}
.team-grid-model-label{flex:none;color:var(--dsw-alias-label-secondary,#bbb)}
.team-grid-model-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,monospace;color:var(--dsw-alias-label-primary,#eee)}
.team-grid-model-channel{flex:none;margin-left:auto;padding:0 5px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:3px;font-size:10px;line-height:14px}

.team-grid-caps-plain{flex:none;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.team-grid-links{flex:none;display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-height:22px;padding:6px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));overflow:hidden}
.team-grid-links-empty{font-size:11px;line-height:16px;color:var(--dsw-alias-label-dimmed,#666)}
.team-chip-link{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:11px;font-size:11px;line-height:20px}
.team-chip-link button{border:none;background:transparent;color:inherit;cursor:pointer;font-size:13px;line-height:1;padding:0;opacity:.6}
.team-chip-link button:hover{opacity:1;color:var(--dsw-alias-state-error-primary,#e0434b)}

/* ══ 角色编辑弹窗（替代卡片内联展开）══
   ⚠ 类名刻意避开 modal / panel / drawer / dlg 子串：glass.ts 的浮层总选择器
   按子串匹配（[class*="modal"] 等）会给命中元素叠 backdrop-filter blur(18px)
   + 内高光描边，且这里的 -head/-body/-foot 子元素也会各自被命中，叠成好几层
   模糊 —— 表现就是「弹窗整张糊掉、文字发虚」。用 team-editor-* 命名规避。
   遮罩 1205 < 卡片 1210：遮罩必须在卡片之下，否则控件全被遮罩吞掉点击。 */
.team-editor-mask{position:fixed;inset:0;z-index:1205;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.5));animation:dsh-modal-mask-in 180ms ease}
.team-editor-card{position:fixed;z-index:1210;left:50%;top:50%;transform:translate(-50%,-50%);width:min(680px,94vw);max-height:88vh;display:flex;flex-direction:column;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-static-neutral-bluish-00,#fff);box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden;backdrop-filter:none;-webkit-backdrop-filter:none}
body[data-ds-dark-theme] .team-editor-card{background:var(--dsw-static-neutral-bluish-850,rgb(44,44,46))}
.team-editor-head{flex:none;display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-editor-title{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.team-editor-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-editor-sub{display:flex;align-items:center;gap:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.team-editor-body{flex:1;min-height:0;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:11px}
.team-editor-foot{flex:none;display:flex;align-items:center;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}

/* ══ 输入 / 确认弹窗（替代 window.prompt / confirm：Electron 下 prompt 会抛异常）══ */
/* ══ 输入 / 确认弹窗（替代 window.prompt / confirm：Electron 下 prompt 会抛异常）══
   类名同样避开 modal/panel/drawer/dlg 子串（见上：glass.ts 子串匹配会叠模糊）。 */
.team-ask-mask{position:fixed;inset:0;z-index:1300;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.5));animation:dsh-modal-mask-in 180ms ease}
.team-ask{position:fixed;z-index:1301;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,92vw);display:flex;flex-direction:column;gap:10px;box-sizing:border-box;padding:16px 18px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-static-neutral-bluish-00,#fff);box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));backdrop-filter:none;-webkit-backdrop-filter:none}
body[data-ds-dark-theme] .team-ask{background:var(--dsw-static-neutral-bluish-850,rgb(44,44,46))}
.team-ask-title{font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary,#eee)}
.team-ask-msg{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-ask-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:2px}
/* 危险确认：实心错误色（区别于只描边的 team-btn-danger） */
.team-btn-danger-solid{border-color:transparent;background:var(--dsw-alias-state-error-primary,#e0434b);color:#fff}
.team-btn-danger-solid:hover:not(:disabled){background:var(--dsw-alias-state-error-primary,#e0434b);filter:brightness(1.06)}


/* ══ 能力装配（工具 + 技能）══ */
.team-caps-toggle{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.team-caps{display:flex;flex-direction:column;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px}
.team-caps-block{display:flex;flex-direction:column;gap:6px}
.team-caps-block+.team-caps-block{border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));padding-top:10px}
.team-caps-head{display:flex;align-items:center;gap:8px}
.team-caps-title{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-caps-count{flex:none;font-size:11px;color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-caps-bar{display:flex;align-items:center;gap:6px}
.team-caps-sub{display:flex;flex-direction:column;gap:6px}
.team-caps-subtitle{font-size:11px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-caps-list{display:flex;flex-direction:column;gap:2px;overflow-y:auto;padding:2px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px}
.team-caps-item{display:flex;align-items:flex-start;gap:7px;padding:5px 7px;border-radius:6px;cursor:pointer;min-width:0}
.team-caps-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.05))}
.team-caps-item input{flex:none;margin-top:2px;accent-color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-caps-name{flex:none;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:var(--dsw-alias-label-primary,#eee)}
.team-caps-desc{flex:1;min-width:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-caps-chips{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.team-chip[data-on='true']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}

/* ══ 运行视图 ══ */
.team-run-form{display:flex;flex-direction:column;gap:10px;padding:0 0 4px}
.team-step-list{display:flex;flex-direction:column;gap:6px}
.team-step{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px}
.team-step[data-status='running']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent)}
.team-step[data-status='done']{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb96b) 45%,transparent)}
.team-step[data-status='error']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 55%,transparent)}
.team-step-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.team-step-head{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary,#eee)}
.team-step-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}
.team-step-out{font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap;word-break:break-word;max-height:66px;overflow:hidden}

/* ══ 并行波次（链编辑器 + HUD 分层）══
   并行步左侧一道渐变光带表示「与上一步同波」，光带缓慢流动提示同时进行；
   波次头（下一步是并行步的那一步）左侧同样点亮，让一个并行组视觉上连成一片。 */
.team-step[data-parallel='true']{position:relative;margin-left:14px;border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 32%,transparent)}
.team-step[data-parallel='true']::before,
.team-step[data-group-head='true']::before{
  content:'';position:absolute;left:-9px;top:6px;bottom:6px;width:3px;border-radius:2px;
  background:linear-gradient(180deg,
    color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent),
    var(--dsw-alias-state-business-primary,#4176e6),
    color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent));
  background-size:100% 220%;
  animation:team-par-flow 2.6s linear infinite;
}
.team-step[data-group-head='true']{position:relative;margin-left:14px}
@keyframes team-par-flow{from{background-position:0 -110%}to{background-position:0 110%}}
.team-par-badge{
  display:inline-flex;align-items:center;flex:none;height:18px;padding:0 7px;border-radius:9px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 45%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent);
  font-size:10.5px;line-height:16px;color:var(--dsw-alias-state-business-primary,#4176e6);
  animation:team-fade-in .22s ease;
}
.team-par-btn{transition:color .18s ease,border-color .18s ease,background .18s ease,transform .18s cubic-bezier(.2,.8,.2,1)}
.team-par-btn:hover{transform:translateY(-1px)}
.team-par-btn[data-on='true']{
  border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 16%,transparent);
  color:var(--dsw-alias-state-business-primary,#4176e6);
}
/* HUD 波次分隔条：一波开始时淡入并横向铺开 */
.team-wave-sep{display:flex;align-items:center;gap:8px;padding:2px 2px 0;font-size:10.5px;color:var(--dsw-alias-label-dimmed,#777);animation:team-fade-in .26s ease}
.team-wave-sep-line{flex:1;height:1px;background:linear-gradient(90deg,var(--dsw-alias-border-l2,rgba(255,255,255,.16)),transparent);transform-origin:left center;animation:team-wave-grow .42s cubic-bezier(.2,.8,.2,1)}
.team-wave-sep[data-live='true']{color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-wave-sep[data-live='true'] .team-wave-sep-line{background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent),transparent)}
.team-wave-tag{flex:none;display:inline-flex;align-items:center;gap:5px}
.team-wave-par{flex:none;padding:0 6px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 40%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}
@keyframes team-wave-grow{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}
/* 波次整组入场：轻微上浮淡入（卡片随组一起就位，营造「一波到位」的节奏） */
.team-wave{animation:team-wave-rise .34s cubic-bezier(.2,.8,.2,1)}
@keyframes team-wave-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
/* 并行进行中的角色卡：外圈脉冲光提示「这几张卡在同时跑」 */
.team-card[data-parallel='true'][data-status='running']{animation:team-par-pulse 2.2s ease-in-out infinite}
@keyframes team-par-pulse{
  0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 26%,transparent)}
  50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 10%,transparent)}
}
@media (prefers-reduced-motion:reduce){
  .team-step[data-parallel='true']::before,
  .team-step[data-group-head='true']::before,
  .team-card[data-parallel='true'][data-status='running'],
  .team-wave-sep-line{animation:none}
}

/* 状态灯 */
.team-dot{flex:none;width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-label-dimmed,#666);margin-top:4px}
.team-dot[data-status='running']{background:var(--dsw-alias-state-business-primary,#4176e6);animation:team-breathe 1.4s ease-in-out infinite}
.team-dot[data-status='done']{background:var(--dsw-alias-state-success-primary,#3fb96b)}
.team-dot[data-status='error']{background:var(--dsw-alias-state-error-primary,#e0434b)}
.team-dot[data-status='skipped']{background:var(--dsw-alias-label-tertiary,#888);opacity:.6}
@keyframes team-breathe{0%,100%{opacity:.45;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}

/* 进度条 */
.team-progress{position:relative;height:6px;border-radius:3px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.1));overflow:hidden}
.team-progress-fill{position:absolute;inset:0 auto 0 0;background:var(--dsw-alias-state-business-primary,#4176e6);border-radius:3px;transition:width .3s cubic-bezier(.2,.8,.2,1)}
.team-progress-fail{position:absolute;top:0;bottom:0;background:var(--dsw-alias-state-error-primary,#e0434b)}
.team-progress-text{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}

/* 历史行 */
.team-hist{display:flex;flex-direction:column;gap:3px;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;cursor:pointer}
.team-hist:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
.team-hist-head{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}
.team-hist-task{font-size:13px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-status-text{flex:none;font-weight:600}
.team-status-text[data-status='done']{color:var(--dsw-alias-state-success-primary,#3fb96b)}
.team-status-text[data-status='error']{color:var(--dsw-alias-state-error-primary,#e0434b)}
.team-status-text[data-status='running']{color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-status-text[data-status='cancelled'],.team-status-text[data-status='interrupted'],.team-status-text[data-status='queued']{color:var(--dsw-alias-label-tertiary,#888)}

/* 全文查看覆盖层 */
.team-viewer{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;background:var(--dsw-static-neutral-bluish-00,#fff);backdrop-filter:none;-webkit-backdrop-filter:none}
body[data-ds-dark-theme] .team-viewer{background:var(--dsw-static-neutral-bluish-950,rgb(21,21,23))}
.team-viewer-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-viewer-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-viewer-body{flex:1;min-height:0;margin:0;overflow:auto;padding:14px 16px;font-size:13px;line-height:21px;font-family:inherit;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#eee)}

/* 纯 opacity 入场动画：凡是靠 transform 定位（或会被无头环境把动画冻结在首帧）
   的浮层一律用它，绝不用带 translateY/translateX 的 dsh-modal-slide-in，
   否则动画接管期/冻结期内元素位置错误（实测冻结时恒定偏移 24px）。 */
@keyframes team-fade-in{from{opacity:0}to{opacity:1}}

/* toast */
.team-toast{position:fixed;z-index:1100;top:14px;left:0;right:0;margin-inline:auto;width:fit-content;max-width:min(480px,90vw);display:flex;align-items:center;gap:8px;padding:9px 16px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-static-neutral-bluish-00,#fff);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee);cursor:pointer;animation:team-fade-in .24s ease}
body[data-ds-dark-theme] .team-toast{background:var(--dsw-static-neutral-bluish-950,rgb(21,21,23))}

/* ══ 新手向导卡（面板顶部，可收起）══ */
.team-guide{display:flex;flex-direction:column;gap:9px;margin:10px 14px 0;padding:12px 14px;border-radius:12px}
.team-guide-head{display:flex;align-items:center;gap:8px}
.team-guide-title{flex:1;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-guide-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
@media (max-width:720px){.team-guide-steps{grid-template-columns:1fr}}
.team-guide-step{display:flex;flex-direction:column;gap:4px;padding:10px 11px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.03))}
body[data-ds-dark-theme] .team-guide-step{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04))}
.team-guide-step-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-guide-step-detail{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);word-break:break-word}
.team-guide-mini{margin:10px 14px 0;height:30px;display:flex;align-items:center;padding:0 12px;border:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.2));border-radius:8px;background:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;text-align:left}
.team-guide-mini:hover{color:var(--dsw-alias-label-primary,#eee);border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.3))}

/* ══ 角色执行详情卡（点 HUD 角色卡弹出）══
   遮罩 + 居中卡。类名 team-step-* 已加入 Panel 的 Esc / pointerdown 让行列表，
   点卡片不会误关抽屉；Esc/点遮罩关闭。 */
.team-step-mask{position:fixed;inset:0;z-index:1001;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45));animation:dsh-modal-mask-in 200ms ease}
.team-step-card{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:min(1060px,94vw);max-height:86vh;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-static-neutral-bluish-00,#fff);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden;animation:team-fade-in .2s ease;padding:14px 16px;gap:10px}
body[data-ds-dark-theme] .team-step-card{background:var(--dsw-static-neutral-bluish-950,rgb(21,21,23))}
.team-step-head{display:flex;align-items:center;gap:8px;flex:none}
.team-step-title{min-width:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-step-tagline{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}
.team-step-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:none}
.team-step-badge{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:11px;font-size:11.5px;line-height:20px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-step-badge[data-status='running']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-step-badge[data-status='done']{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb96b) 50%,transparent);color:var(--dsw-alias-state-success-primary,#3fb96b)}
.team-step-badge[data-status='error']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 55%,transparent);color:var(--dsw-alias-state-error-primary,#e0434b)}
.team-step-badge-model em{font-style:normal}
.team-step-time{margin-left:auto;font-family:ui-monospace,SFMono-Regular,monospace}
.team-step-section{flex:none;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.03))}
body[data-ds-dark-theme] .team-step-section{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04))}
.team-step-section summary{cursor:pointer;padding:7px 11px;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb);user-select:none}
.team-step-section[open] summary{border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-step-notes{display:flex;gap:10px;flex-wrap:wrap;font-size:11.5px;line-height:17px;color:var(--dsw-alias-state-warn-primary,#e8a33d)}
/* 子 agent 任务清单：勾选列表（completed=绿✓ / in_progress=蓝● / pending=空） */
.team-step-todos{flex:none;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.03))}
body[data-ds-dark-theme] .team-step-todos{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04))}
.team-step-todos-head{padding:7px 11px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#bbb);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-step-todos-list{margin:0;padding:6px 8px;list-style:none;display:flex;flex-direction:column;gap:2px}
.team-step-todos-list li{display:flex;align-items:center;gap:7px;padding:3px 3px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-step-todos-box{flex:none;display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.2));border-radius:4px;font-size:10px;line-height:1}
.team-step-todos-list li[data-status='completed']{color:var(--dsw-alias-label-tertiary,#888);text-decoration:line-through}
.team-step-todos-list li[data-status='completed'] .team-step-todos-box{background:var(--dsw-alias-state-success-primary,#3fb96b);border-color:transparent;color:#fff}
.team-step-todos-list li[data-status='in_progress'] .team-step-todos-box{border-color:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-step-todos-text{flex:1;min-width:0;word-break:break-word}
.team-step-todos-tag{flex:none;font-size:10.5px;color:var(--dsw-alias-label-dimmed,#777)}
.team-step-todos-list li[data-status='in_progress'] .team-step-todos-tag{color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-step-todos-list li[data-status='completed'] .team-step-todos-tag{color:var(--dsw-alias-state-success-primary,#3fb96b)}
.team-step-err{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e0434b);word-break:break-word}
.team-step-output-wrap{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px}
.team-step-output-label{flex:none;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#bbb)}
.team-step-pre{flex:none;margin:0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.03));font-size:12.5px;line-height:19px;font-family:inherit;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#eee);max-height:180px;overflow:auto}
body[data-ds-dark-theme] .team-step-pre{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04))}
.team-step-pre-full{flex:1;min-height:0;max-height:none;overflow:auto}
/* Markdown 渲染容器：复用 DSH 官方 markstream 管线，这里只做容器级收敛
   （滚动、内边距、字号），标题/表格/代码块样式走官方 .dsh-better-markdown 全局层 */
.team-step-md{flex:1;min-height:0;overflow:auto;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.03))}
body[data-ds-dark-theme] .team-step-md{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04))}
.team-step-md .dsh-better-markdown__markdown{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.team-step-md .dsh-better-markdown__markdown h1,.team-step-md .dsh-better-markdown__markdown h2,
.team-step-md .dsh-better-markdown__markdown h3,.team-step-md .dsh-better-markdown__markdown h4{
  font-size:14.5px;margin:12px 0 6px;line-height:21px;color:var(--dsw-alias-label-primary,#eee)}
.team-step-md .dsh-better-markdown__markdown h1:first-child,
.team-step-md .dsh-better-markdown__markdown h2:first-child,
.team-step-md .dsh-better-markdown__markdown h3:first-child{margin-top:0}
.team-step-viewtoggle{margin-left:auto;display:inline-flex;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:8px;overflow:hidden}
.team-step-viewtoggle button{border:none;background:none;font-size:11px;line-height:18px;padding:2px 10px;font-family:inherit;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer}
.team-step-viewtoggle button[data-on='true']{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-step-streaming{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-step-note{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#888)}
.team-step-empty{flex:1;display:flex;align-items:center;justify-content:center;min-height:90px;border:1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:10px;font-size:12.5px;color:var(--dsw-alias-label-tertiary,#888)}

/* ══ 一句话生成团队弹窗 ══ */
.team-gen-mask{position:fixed;inset:0;z-index:1005;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.5));animation:dsh-modal-mask-in 200ms ease}
/* 去玻璃铁律同样适用于本弹窗：specific-menu 会被玻璃 token 层半透明化，
   必须用 static 不透明底 + 显式关掉 backdrop-filter（与 team-editor-card 同款）。 */
.team-gen-card{position:fixed;z-index:1006;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);max-height:86vh;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:14px;background:var(--dsw-static-neutral-bluish-00,#fff);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));overflow:hidden}
body[data-ds-dark-theme] .team-gen-card{background:var(--dsw-static-neutral-bluish-950,rgb(21,21,23))}
.team-gen-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-gen-title{flex:1;min-width:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-gen-body{flex:1;min-height:0;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.team-gen-examples{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.team-gen-foot{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-gen-progress{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-state-business-primary,#4176e6)}

/* ══ 团队模式入场动画：从窗口中心扩散光晕 ══
   打开：光斑 + 柔光圈从窗口几何中心散开（≈1.3s 一次过场），
   微光填充同步弥漫；关闭：反向收拢回中心（0.6s）。
   纯 transform/opacity + 静态 radial 渐变/border（无滤镜插值、
   无 backdrop-filter），播完即移除，无常驻层。 */
.team-aura{position:fixed;inset:0;z-index:850;pointer-events:none;overflow:hidden}
/* 中心光斑：从中心放大散开的光晕 */
.team-aura-blob{position:absolute;left:50%;top:50%;width:340px;height:340px;margin:-170px 0 0 -170px;border-radius:50%;opacity:0;
  background:radial-gradient(circle,color-mix(in srgb,#8fb8ff 30%,transparent) 0%,color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent) 38%,transparent 68%)}
.team-aura[data-dir='in'] .team-aura-blob{animation:team-aura-blob-in 1.3s cubic-bezier(.16,1,.3,1) both}
.team-aura[data-dir='out'] .team-aura-blob{animation:team-aura-blob-out .6s cubic-bezier(.55,0,.85,.36) both}
@keyframes team-aura-blob-in{0%{opacity:0;transform:scale(.2)}30%{opacity:.95}100%{opacity:0;transform:scale(8)}}
@keyframes team-aura-blob-out{0%{opacity:.7;transform:scale(8)}100%{opacity:0;transform:scale(.2)}}
/* 柔光圈：边界清晰的一圈扩散环 */
.team-aura-ring{position:absolute;left:50%;top:50%;width:220px;height:220px;margin:-110px 0 0 -110px;border-radius:50%;opacity:0;
  border:2px solid color-mix(in srgb,#9cc8ff 70%,transparent);
  box-shadow:0 0 24px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 45%,transparent),inset 0 0 14px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 30%,transparent)}
.team-aura[data-dir='in'] .team-aura-ring{animation:team-aura-ring-in 1.3s cubic-bezier(.16,1,.3,1) .08s both}
.team-aura[data-dir='out'] .team-aura-ring{animation:team-aura-ring-out .6s cubic-bezier(.55,0,.85,.36) both}
@keyframes team-aura-ring-in{0%{opacity:0;transform:scale(.2)}24%{opacity:.9}100%{opacity:0;transform:scale(7)}}
@keyframes team-aura-ring-out{0%{opacity:.7;transform:scale(7)}100%{opacity:0;transform:scale(.2)}}
/* 微光填充：整体弥漫的淡蓝光辉（顶层装饰，覆盖全窗） */
.team-aura-wash{position:absolute;inset:0;opacity:0;
  background:radial-gradient(62% 46% at 50% 50%,color-mix(in srgb,#8fb8ff 10%,transparent) 0%,transparent 72%)}
.team-aura[data-dir='in'] .team-aura-wash{animation:team-aura-wash-in 1.3s cubic-bezier(.16,1,.3,1) both}
.team-aura[data-dir='out'] .team-aura-wash{animation:team-aura-wash-out .6s cubic-bezier(.55,0,.85,.36) both}
@keyframes team-aura-wash-in{0%{opacity:0}34%{opacity:1}100%{opacity:0}}
@keyframes team-aura-wash-out{0%{opacity:.6}100%{opacity:0}}
/* ══ 对话框团队选择器（与模型切换 ModelSeat 同款：胶囊触发 + hover 弹出菜单）══ */
.team-seat{position:relative;min-width:0}
.team-toggle-btn{display:flex;align-items:center;gap:4px;min-width:0;max-width:220px;height:28px;padding:0 4px 0 8px;border:none;border-radius:24px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary,#999);font-size:13px;line-height:20px;font-weight:500;font-family:inherit;cursor:pointer;transition:background .18s ease,color .18s ease,box-shadow .18s ease}
.team-toggle-btn:hover:not(:disabled),.team-toggle-btn[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.team-toggle-btn:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3,rgba(255,255,255,.22))}
.team-toggle-btn[data-on='true']{color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-toggle-btn[data-on='true']:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 12%,transparent)}
.team-toggle-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-toggle-chevron{flex:0 0 auto;color:var(--dsw-alias-label-caption,#9aa0a8);transition:transform 120ms ease}
.team-toggle-chevron-open{transform:rotate(180deg)}
.team-toggle-btn[data-on='true'] .team-toggle-chevron{color:var(--dsw-alias-state-business-primary,#4176e6)}

/* 菜单（与模型切换 .webui-ms-menu 同款视觉；absolute 定位在按钮上方） */
.team-pop{position:absolute;right:0;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;width:min(320px,calc(100vw - 32px));max-height:min(420px,calc(100vh - 96px));overflow:hidden;padding:4px;border:1px solid var(--dsw-alias-border-inverted,rgba(255,255,255,.18));border-radius:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#16181d));box-shadow:var(--dsw-shadow-lv3,0 8px 40px rgba(0,0,0,.5));color:var(--dsw-alias-label-primary,#eee);animation:team-pop-rise 160ms cubic-bezier(.2,.9,.25,1);transform-origin:100% 100%;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
/* 透明桥接：覆盖按钮与菜单之间的间隙，鼠标从按钮移入菜单时不中断 hover。 */
.team-pop::before{content:'';position:absolute;left:0;right:0;bottom:-8px;height:8px}
@keyframes team-pop-rise{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
.team-pop-item{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:6px 8px;border:none;border-radius:10px;outline:none;background:transparent;color:inherit;text-align:left;cursor:pointer;transition:background .15s ease}
.team-pop-item:hover:not(:disabled),.team-pop-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.team-pop-item-copy{display:flex;flex:1;flex-direction:column;min-width:0}
.team-pop-item-name{overflow:hidden;color:inherit;font-size:14px;line-height:20px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.team-pop-item-on .team-pop-item-name{color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-pop-item-sub{overflow:hidden;color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.team-pop-check{display:grid;place-items:center;flex:0 0 18px;color:var(--dsw-alias-state-business-primary,#4176e6);animation:team-check-pop 200ms cubic-bezier(.22,1.2,.36,1)}
@keyframes team-check-pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}
.team-pop-empty{padding:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.team-pop-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888)}
.team-pop-divider{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-pop-foot{flex:none;padding:7px 10px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.team-check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer}
.team-check input{accent-color:var(--dsw-alias-state-business-primary,#4176e6)}

/* ══ 对话流执行 HUD ══
   分离式布局：外层 .team-hud 只是**透明的定位/排版容器**（无边框、无底色、
   无阴影、不裁剪），真正有视觉实体的是内部两类独立卡片 —— 顶部概览条
   .team-hud-bar 与每张角色卡 .team-card。这样角色卡不再被一个大外框"包裹"，
   视觉上是一组并列的独立卡片（用户明确要求：卡片不要被主卡片套住）。 */
.team-hud{position:fixed;z-index:900;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;border:none;background:none;box-shadow:none;overflow:visible;animation:team-fade-in .24s ease}
/* 折叠态用 translateX(-50%) 做水平居中，但入场动画 dsh-modal-slide-in 也写 transform，
   动画终态会把内联的 translateX 覆盖掉（实测被解析成 translateY(24px)、居中失效）。
   折叠态改用 margin-inline:auto + inset 定位居中，并关掉该动画，彻底避开 transform 冲突。 */
.team-hud[data-collapsed='true']{animation:none;align-items:center;justify-content:flex-end}

/* 卡面通用皮肤：不透明底 + 细边 + 轻阴影（去玻璃，浅 00 白 / 深 950 近原深灰）。 */
.team-surface{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;background:var(--dsw-static-neutral-bluish-00,#fff);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:var(--dsw-shadow-lv2,0 6px 24px rgba(0,0,0,.35))}
body[data-ds-dark-theme] .team-surface{background:var(--dsw-static-neutral-bluish-950,rgb(21,21,23))}

/* 顶部概览条：独立卡片（flex:none 保证面板定高时它不被压扁） */
.team-hud-bar{flex:none;display:flex;align-items:center;gap:8px;padding:0 14px;cursor:pointer;height:44px;box-sizing:border-box;border-radius:12px;transition:border-color .2s ease}
/* 悬停反馈用 background-image 叠色，不能用 background 简写：
   team-surface 的不透明底色（特异性 0,1,0）会被 :hover 的简写（0,2,0）整体替换成
   半透明色导致悬停瞬间「卡底被擦掉、变成透明」——叠色层画在底色之上，不透光。 */
.team-hud-bar:hover{background-image:linear-gradient(var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04)),var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04)))}
/* 折叠态：靠 left/right 对撑 + margin-inline:auto 居中（不用 transform），
   顶条按内容收窄并悬浮在对话框上方 */
.team-hud[data-collapsed='true'] .team-hud-bar{max-width:100%;margin-inline:auto;overflow:hidden}
.team-hud[data-collapsed='true'] .team-hud-chain{max-width:200px}
.team-hud-bar[data-state='done']{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb96b) 50%,transparent)}
.team-hud-bar[data-state='error']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 55%,transparent)}
.team-hud-title{flex:none;display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}
.team-hud-chain{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-hud-pips{flex:none;display:flex;align-items:center;gap:4px}
.team-hud-pip{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-border-l2,rgba(255,255,255,.2))}
.team-hud-pip[data-status='done']{background:var(--dsw-alias-state-success-primary,#3fb96b)}
.team-hud-pip[data-status='running']{background:var(--dsw-alias-state-business-primary,#4176e6);animation:team-breathe 1.4s ease-in-out infinite}
.team-hud-pip[data-status='error']{background:var(--dsw-alias-state-error-primary,#e0434b)}
.team-hud-count{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);font-family:ui-monospace,SFMono-Regular,monospace}
.team-hud-time{flex:none;margin-left:auto;font-size:12px;color:var(--dsw-alias-label-tertiary,#888);font-family:ui-monospace,SFMono-Regular,monospace}

/* 展开区：透明容器，弹性占满停靠高度（面板高度由 JS 按对话区下三分之一给定），
   内部纵向滚动 —— 不再用固定 max-height，否则和停靠高度打架。 */
.team-hud-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:0 0 2px;border:none;background:none;overflow-y:auto;overflow-x:hidden}
.team-hud-seg{display:flex;flex-direction:column;gap:8px}
.team-hud-seg+.team-hud-seg{border-top:none;margin-top:2px}
.team-hud-seg-head{display:flex;align-items:center;gap:8px;padding:0 2px;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb)}

/* 任务 + 进度：独立卡片 */
.team-hud-meta{display:flex;flex-direction:column;gap:9px;padding:12px 14px;border-radius:12px}
.team-hud-task{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#bbb);word-break:break-word;display:flex;align-items:flex-start;gap:10px}
.team-hud-task-text{flex:1;min-width:0;max-height:60px;overflow:hidden}

/* 角色运行卡：包围卡片（team-surface 面板）承载整组角色，
   成员卡在内部网格排列 —— 分组容器 + 成员卡两层结构，层级清晰不散。 */
.team-cards-wrap{padding:10px;border-radius:12px}
/* 包围卡内的成员卡：浅填充底替代白底+投影，与外层白卡形成「面板→成员」层级 */
.team-cards-wrap .team-card{background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.03));box-shadow:none}
body[data-ds-dark-theme] .team-cards-wrap .team-card{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.04))}
/* auto-fit（而非 auto-fill）：波次里只有 1~2 张卡时，空轨道自动塌缩，
   卡片吃满整行 —— 不会出现「卡片缩在左边 + 右半屏空白」的稀疏排布。 */
.team-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:8px}
.team-card{display:flex;flex-direction:column;gap:6px;padding:11px 12px;box-sizing:border-box;border-radius:12px;cursor:pointer;transition:border-color .2s ease,box-shadow .2s ease,transform .12s ease}
.team-card:hover{border-color:var(--dsw-alias-border-l3,rgba(255,255,255,.22));transform:translateY(-1px)}
.team-card[data-status='running']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 22%,transparent),var(--dsw-shadow-lv2,0 6px 24px rgba(0,0,0,.35))}
.team-card[data-status='done']{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb96b) 45%,transparent)}
.team-card[data-status='error']{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e0434b) 55%,transparent)}
.team-card[data-status='skipped']{opacity:.6}
.team-card-head{display:flex;align-items:center;gap:6px}
.team-card-icon{flex:none;display:inline-flex;width:16px;justify-content:center;font-size:12px;line-height:16px}
.team-card-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary,#eee)}
.team-card-idx{flex:none;font-size:11px;color:var(--dsw-alias-label-dimmed,#777);font-family:ui-monospace,SFMono-Regular,monospace}
.team-card-tag{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-card-model{display:flex;align-items:center;gap:5px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);min-width:0}
.team-card-model-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,monospace}
.team-card-src{flex:none;padding:0 5px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-radius:4px;font-size:11px;line-height:15px}
.team-card-src[data-src='team']{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6)}
.team-card-src[data-src='role']{border-color:color-mix(in srgb,#3fb96b 55%,transparent);color:#3fb96b}
.team-card-src[data-src='run']{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#e8a33d) 55%,transparent);color:var(--dsw-alias-state-warn-primary,#e8a33d)}
.team-card-inherit{font-style:italic;opacity:.75}
/* 角色卡上的任务清单迷你进度条 */
.team-card-todos{position:relative;height:16px;border-radius:8px;background:var(--dsw-alias-border-l1,rgba(255,255,255,.1));overflow:hidden;flex:none}
.team-card-todos-fill{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb96b) 60%,transparent);border-radius:8px;transition:width .3s ease}
.team-card-todos-text{position:relative;display:flex;align-items:center;justify-content:center;height:16px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb)}
.team-card-time{font-size:11px;line-height:16px;color:var(--dsw-alias-label-dimmed,#777);font-family:ui-monospace,SFMono-Regular,monospace}
.team-card-out{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,#aaa);white-space:pre-wrap;word-break:break-word;max-height:51px;overflow:hidden;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));padding-top:6px}
.team-card-err{font-size:12px;line-height:17px;color:var(--dsw-alias-state-error-primary,#e0434b);word-break:break-word;max-height:51px;overflow:hidden}

/* 底部产物/错误区：独立卡片 */
.team-hud-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-radius:12px;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}

/* HUD 收起后的小胶囊（同样去玻璃，static 不透明底） */
/* 收起胶囊：贴对话区右上角，28px 高（行内小按钮规格）便于点击，不遮挡正文 */
.team-pill{position:fixed;z-index:900;display:inline-flex;align-items:center;gap:6px;height:28px;max-width:min(280px,42vw);padding:0 12px;border-radius:14px;font-size:12px;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer;white-space:nowrap;overflow:hidden;animation:team-fade-in .2s ease;transition:border-color .2s ease}
.team-pill:hover{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent)}
.team-pill>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}

@media (prefers-reduced-motion:reduce){
  .team-toast,.team-hud,.team-pop,.team-pill,.team-drawer,.team-mask,.team-gen-card,.team-gen-mask,
  .team-canvas-layer,.team-editor-card,.team-editor-mask,.team-ask,.team-ask-mask,.team-wave{animation:none}
  .team-dot[data-status='running'],.team-hud-pip[data-status='running']{animation:none}
  .team-toggle-btn,.team-toggle-chevron,.team-pop-item,.team-pop-check,.team-chevron,.team-progress-fill,.team-role-card-grid{transition:none!important}
  .team-pop,.team-pop-check{animation:none!important}
  /* 中心光晕过场退化为硬切换 */
  .team-aura,.team-aura-blob,.team-aura-ring,.team-aura-wash{animation:none!important}
}
`

/** 注入团队样式（幂等 + 热更新原位替换）。 */
export function ensureTeamStyles(): void {
  if (typeof document === 'undefined') return
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (tag !== null) {
    if (tag.textContent !== SHEET) tag.textContent = SHEET
    return
  }
  tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.dataset.pluginCss = 'webui/team'
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** 移除样式（插件卸载时调用）。 */
export function removeTeamStyles(): void {
  document.getElementById(STYLE_ID)?.remove()
}
