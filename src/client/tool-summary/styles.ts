/** Injected stylesheet for the tool-group UI (Harness design tokens). */

const CSS = `
/* Collapse flow slots that render nothing (aggregated tool groups + reasoning
   groups leave empty node slots behind; the transcript column's flex gap
   would otherwise turn each into a blank strip). */
[data-chat-flow-key]:has(> [data-slot]:empty) {
  display: none;
}

/* ── 设计基线 ────────────────────────────────────────────────────────────
 * 强调色一律走 --dts-accent（= 官方品牌蓝 state-business-primary）；绝不用
 * --dsw-alias-brand-primary（浅色下是黑、深色下是白的反色 token）。
 * 表面/描边只用 design-platform.css 里真实存在的 token：bg-layer-1/2、
 * bg-module-platform、border-l2/l3、label-*、state-*。
 * 内部填充面统一经 --dts-fill / --dts-fill-strong 间接引用，玻璃质感主题
 * 只需覆盖这两个变量即可整体换成「中性半透明抬升」，不必逐条重写规则。
 * ──────────────────────────────────────────────────────────────────── */

/* ===== 对话流内的入口 chip（工具调用 / 思考 共用一套视觉语言）=========== */
.dts__entry-wrap {
  --dts-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --dts-fill: var(--dsh-flow-veil, color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent));
  /* chip 表面/描边走变量：玻璃质感只需覆盖这两个变量（见 glass.ts），
   * 不必用更高特异性的规则去压 chip 的运行态样式（实测直接覆盖
   * background-color 会连运行态的强调色底一起吃掉）。 */
  --dts-chip-surface: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.05));
  --dts-chip-border: var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  max-width: 100%;
}

.dts__entry {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  height: 28px;
  margin: 0;
  padding: 0 12px 0 5px;
  overflow: hidden;
  border: 1px solid var(--dts-chip-border);
  border-radius: 999px;
  background: var(--dts-chip-surface);
  box-shadow: 0 1px 2px rgba(15,17,21,.04);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 12px;
  line-height: 26px;
  white-space: nowrap;
  transition: border-color .18s ease, background-color .18s ease, box-shadow .18s ease, transform .18s ease;
}

.dts__entry:hover {
  border-color: color-mix(in srgb, var(--dts-accent) 34%, var(--dts-chip-border));
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  box-shadow: 0 2px 8px rgba(15,17,21,.08);
  color: var(--dsw-alias-label-primary);
  transform: translateY(-1px);
}

.dts__entry:active {
  box-shadow: 0 1px 2px rgba(15,17,21,.06);
  transform: none;
}

.dts__entry:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dts-accent) 55%, transparent);
  outline-offset: 2px;
}

/* 图标托在一枚圆形色底里，作为 chip 的视觉锚点（思考 chip 同规格）。 */
.dts__entry-icon {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dts-accent) 13%, transparent);
  color: var(--dts-accent);
  font-size: 12px;
  line-height: 1;
}

.dts__entry-text {
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__entry-sub {
  flex: none;
  border-radius: 999px;
  padding: 0 7px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
}

.dts__entry-err {
  flex: none;
  border-radius: 999px;
  padding: 0 7px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 14%, transparent);
  color: var(--dsw-alias-state-error-primary, #e5484d);
  font-size: 11px;
  line-height: 18px;
}

/* kind 迷你徽标组（chip 尾部的小圆图标） */
.dts__entry-kinds {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
}

/* 运行态：描边/文字染成强调色，底色上扫过一道极淡高光。动画只在本轮进行中
 * 存在（单元素、GPU 友好的 background-position），回合结束即消失。 */
.dts__entry[data-running="true"] {
  border-color: color-mix(in srgb, var(--dts-accent) 42%, transparent);
  background:
    linear-gradient(color-mix(in srgb, var(--dts-accent) 9%, transparent), color-mix(in srgb, var(--dts-accent) 9%, transparent)),
    var(--dts-chip-surface);
}

.dts__entry[data-running="true"] .dts__entry-text {
  color: var(--dts-accent);
}

.dts__entry[data-running="true"] .dts__entry-icon {
  background: color-mix(in srgb, var(--dts-accent) 20%, transparent);
  animation: dts-breathe 1.8s ease-in-out infinite;
}

.dts__entry[data-running="true"]::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(100deg,
    transparent 22%,
    color-mix(in srgb, var(--dts-accent) 16%, transparent) 50%,
    transparent 78%);
  background-size: 220% 100%;
  pointer-events: none;
  animation: dts-sheen 1.9s linear infinite;
}

@keyframes dts-sheen {
  from { background-position: 160% 0; }
  to { background-position: -60% 0; }
}

@keyframes dts-breathe {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--dts-accent) 32%, transparent); }
  50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--dts-accent) 0%, transparent); }
}

/* ===== 对话流内的实时卡片（下载 / 长命令）============================== */
.dts__entry-live {
  --dts-accent: var(--dsw-alias-state-business-primary, #4176e6);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--dts-accent) 32%, transparent);
  border-radius: 999px;
  background:
    linear-gradient(color-mix(in srgb, var(--dts-accent) 10%, transparent), color-mix(in srgb, var(--dts-accent) 10%, transparent)),
    var(--dts-chip-surface, transparent);
  color: var(--dts-accent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dts__download-card {
  --dts-accent: var(--dsw-alias-state-business-primary, #4176e6);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 280px;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--dts-accent) 24%, var(--dsw-alias-border-l2, rgba(127,127,127,.22)));
  border-radius: 12px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--dts-accent) 9%, transparent), transparent 64%),
    var(--dts-fill, rgba(127,127,127,.05));
  box-shadow: 0 1px 3px rgba(15,17,21,.05);
}

.dts__download-head {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--dts-accent);
  font-size: 12px;
  font-weight: 600;
}

.dts__download-head > svg {
  flex: none;
}

.dts__download-title {
  font-variant-numeric: tabular-nums;
}

.dts__download-url {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__download-dest {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__download-dest code {
  border-radius: 4px;
  padding: 0 4px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, monospace);
}

.dts__download-progress {
  margin-top: 2px;
}

.dts__download-progress .dts__progress {
  width: 100%;
}

/* 不定量进度条：淡色轨道 + 两端渐隐的强调色游标（看起来在滑动而非跳动）。 */
.dts__progress {
  position: relative;
  width: 52px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dts-accent, #4176e6) 16%, var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)));
}

.dts__progress::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 45%;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, var(--dts-accent, #4176e6), transparent);
  animation: dts-progress-slide 1.15s cubic-bezier(.4, 0, .6, 1) infinite;
}

@keyframes dts-progress-slide {
  from { left: -45%; }
  to { left: 100%; }
}

/* ===== 居中活动弹窗（思考 + 工具）====================================== */
/* 遮罩类名带 mask：玻璃质感的浮层总选择器按约定跳过遮罩，模糊在此自备
   （官方配方 bg-mask-1 + --dsw-mask-blur）。 */
.dts__modal-mask {
  position: fixed;
  inset: 0;
  z-index: 9990;
  background: var(--dsw-alias-bg-mask-1, rgba(15, 17, 21, .45));
  backdrop-filter: var(--dsw-mask-blur, blur(2px));
  -webkit-backdrop-filter: var(--dsw-mask-blur, blur(2px));
  animation: dts-fade-in .16s ease-out;
}

@keyframes dts-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.dts__modal {
  --dts-accent: var(--dsw-alias-state-business-primary, #4176e6);
  /* 内部填充面：跟随文字色的中性半透明纱（浅色=淡黑、深色=淡白）。
   * 不用 bg-layer-* 实色 token——浅色主题下三层 layer 同为纯白，卡在白
   * 面板上完全看不出层次；半透明纱还能直接叠在玻璃质感的模糊面上，
   * 不会形成「模糊之上再蒙一层厚纱」。 */
  --dts-fill: var(--dsh-flow-veil, color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent));
  --dts-fill-strong: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 9991;
  display: flex;
  flex-direction: column;
  width: min(760px, 92vw);
  max-height: min(84vh, 860px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow:
    0 1px 2px rgba(15,17,21,.06),
    0 24px 64px rgba(15,17,21,.22);
  transform: translate(-50%, -50%);
  animation: dts-modal-in .18s cubic-bezier(.2, .8, .2, 1);
}

@keyframes dts-modal-in {
  from { transform: translate(-50%, -48%) scale(.97); opacity: .4; }
  to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}

.dts__modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 13px 14px 13px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));
}

.dts__modal-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
}

.dts__modal-title svg {
  color: var(--dts-accent);
}

.dts__modal-close {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  margin: 0;
  border: 0;
  padding: 0;
  border-radius: 50%;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  transition: background-color .15s ease, color .15s ease;
}

.dts__modal-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  color: var(--dsw-alias-label-primary);
}

.dts__modal-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 22px;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, rgba(127,127,127,.4)) transparent;
}

.dts__modal-scroll::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.dts__modal-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.dts__modal-scroll::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(127,127,127,.4));
  border-radius: 2px;
}

.dts__modal-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l2, rgba(127,127,127,.6));
}

/* ---- 两个分区：思考 / 工具 ---- */
.dts__modal-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dts__modal-panel + .dts__modal-panel {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));
}

.dts__modal-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dts__modal-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dts__modal-panel-title svg {
  color: var(--dts-accent);
}

.dts__modal-panel-count {
  margin-left: auto;
  border-radius: 999px;
  padding: 0 8px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
}

.dts__modal-panel-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  border-radius: 999px;
  padding: 0 9px;
  background: color-mix(in srgb, var(--dts-accent) 12%, transparent);
  color: var(--dts-accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 19px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---- 思考条目跳转导航 ---- */
.dts__reasoning-nav {
  display: flex;
  gap: 4px;
  max-width: 100%;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: thin;
}

.dts__reasoning-nav-item {
  flex: none;
  min-width: 26px;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 1px 8px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08));
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
  text-align: center;
  transition: background-color .15s ease, color .15s ease, border-color .15s ease;
}

.dts__reasoning-nav-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16));
  color: var(--dsw-alias-label-primary);
}

.dts__reasoning-nav-item[data-active="true"] {
  border-color: color-mix(in srgb, var(--dts-accent) 45%, transparent);
  background: color-mix(in srgb, var(--dts-accent) 14%, transparent);
  color: var(--dts-accent);
  font-weight: 600;
}

/* ---- 思考正文：按类别成组，每条是独立小卡 ---- */
.dts__modal-reasoning {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dts__modal-reasoning-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dts__modal-reasoning-group-title {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));
  border-radius: 999px;
  padding: 0 10px;
  background: var(--dts-fill, rgba(127,127,127,.05));
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
  transition: background-color .15s ease, color .15s ease, border-color .15s ease;
}

.dts__modal-reasoning-group-title:hover {
  border-color: color-mix(in srgb, var(--dts-accent) 34%, transparent);
  background: color-mix(in srgb, var(--dts-accent) 10%, transparent);
  color: var(--dsw-alias-label-primary);
}

.dts__modal-reasoning-item {
  display: flex;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 8px 11px;
  background: var(--dts-fill, rgba(127,127,127,.04));
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 22px;
  scroll-margin-top: 10px;
  transition: background-color .18s ease, border-color .18s ease;
}

.dts__modal-reasoning-item[data-active="true"] {
  border-color: color-mix(in srgb, var(--dts-accent) 38%, transparent);
  background: color-mix(in srgb, var(--dts-accent) 9%, transparent);
}

.dts__modal-reasoning-item[data-running="true"] {
  color: var(--dsw-alias-label-primary);
}

.dts__modal-reasoning-item-index {
  display: inline-grid;
  place-items: center;
  flex: none;
  align-self: flex-start;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.dts__modal-reasoning-item[data-running="true"] .dts__modal-reasoning-item-index,
.dts__modal-reasoning-item[data-active="true"] .dts__modal-reasoning-item-index {
  background: color-mix(in srgb, var(--dts-accent) 18%, transparent);
  color: var(--dts-accent);
}

.dts__modal-reasoning-item-text {
  min-width: 0;
  flex: 1 1 auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- 工具总结卡（填充面，与下方调用列表区分）---- */
.dts__summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--dts-fill-strong, rgba(127,127,127,.07));
}

.dts__summary-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 600;
}

.dts__summary-title svg {
  color: var(--dts-accent);
}

.dts__summary-line {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 20px;
}

.dts__summary-line b {
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.dts__chips,
.dts__files {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.dts__chip {
  border-radius: 999px;
  padding: 0 9px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 20px;
  white-space: nowrap;
}

.dts__file {
  margin: 0;
  border: 1px solid color-mix(in srgb, var(--dts-accent) 22%, transparent);
  border-radius: 999px;
  padding: 0 9px;
  background: color-mix(in srgb, var(--dts-accent) 10%, transparent);
  color: var(--dts-accent);
  cursor: pointer;
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  line-height: 20px;
  white-space: nowrap;
  transition: background-color .15s ease, border-color .15s ease;
}

.dts__file:hover {
  border-color: color-mix(in srgb, var(--dts-accent) 45%, transparent);
  background: color-mix(in srgb, var(--dts-accent) 18%, transparent);
}

/* ---- 调用列表 ---- */
.dts__modal-tools {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dts__drawer-call,
.dts__call {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: 10px;
}

.dts__call[data-selected="true"] {
  background: color-mix(in srgb, var(--dts-accent) 8%, transparent);
}

.dts__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  border-radius: 8px;
  padding: 3px 8px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font-size: 12px;
  line-height: 22px;
  user-select: none;
  transition: background-color .15s ease;
}

.dts__row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08));
}

.dts__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-alias-label-caption, #94a3b8);
}

.dts__dot[data-state="running"] {
  background: var(--dts-accent, #4176e6);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dts-accent, #4176e6) 20%, transparent);
  animation: dts-pulse 1.1s ease-in-out infinite;
}

.dts__dot[data-state="ok"] {
  background: var(--dsw-alias-state-success-primary, #2f9e44);
}

.dts__dot[data-state="error"] {
  background: var(--dsw-alias-state-error-primary, #e5484d);
}

.dts__dot[data-state="stopped"] {
  background: var(--dsw-alias-label-caption, #94a3b8);
}

@keyframes dts-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .4; }
}

.dts__row-name {
  flex: none;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.dts__row-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__row-time {
  flex: none;
  color: var(--dsw-alias-label-caption, #94a3b8);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dts__row-time[data-running="true"] {
  color: var(--dts-accent, #4176e6);
}

/* 运行中的下载/长命令：行内进度条 + 走秒时钟，长任务不会看起来卡死。 */
.dts__row-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  color: var(--dts-accent, #4176e6);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dts__inspect {
  flex: none;
  margin: 0;
  border: 0;
  border-radius: 6px;
  padding: 0 5px;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-size: 11px;
  line-height: 20px;
  opacity: 0;
  transition: opacity .15s ease, color .15s ease, background-color .15s ease;
}

.dts__row:hover .dts__inspect,
.dts__inspect:focus-visible {
  opacity: 1;
}

.dts__inspect:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14));
  color: var(--dts-accent, #4176e6);
}

.dts__chevron {
  flex: none;
  margin-left: auto;
  color: var(--dsw-alias-label-caption, #94a3b8);
  font-size: 9px;
  transition: transform .16s ease;
}

.dts__chevron[data-open="true"] {
  transform: rotate(90deg);
}

/* 展开的参数/输出：强调色导轨 + 填充面，与调用行明显分层 */
.dts__row-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
  margin: 2px 0 8px 25px;
  border-left: 2px solid color-mix(in srgb, var(--dts-accent, #4176e6) 24%, transparent);
  border-radius: 0 8px 8px 0;
  padding: 8px 10px;
  background: var(--dts-fill, rgba(127,127,127,.04));
  scrollbar-width: thin;
}

.dts__row-args,
.dts__row-output {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.dts__row-label {
  flex: none;
  color: var(--dsw-alias-label-caption, #94a3b8);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .04em;
}

.dts__row-args code {
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  line-height: 18px;
  white-space: pre-wrap;
  word-break: break-all;
}

.dts__row-pre {
  margin: 0;
  max-height: 220px;
  overflow-y: auto;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  line-height: 18px;
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-width: thin;
}

.dts__row-empty {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-style: italic;
}

.dts__subcalls {
  display: flex;
  flex-direction: column;
  margin-left: 20px;
  border-left: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));
}

.dts__empty {
  border-radius: 12px;
  padding: 18px;
  background: var(--dts-fill, rgba(127,127,127,.04));
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  text-align: center;
}

/* ---- activity-kind 徽标（git 推送 / 安装 / 构建 / …）---- */
.dts__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  max-width: 96px;
  height: 18px;
  border-radius: 999px;
  padding: 0 7px;
  background: color-mix(in srgb, var(--dts-kind-color, #64748b) 15%, transparent);
  color: var(--dts-kind-color, #64748b);
  font-size: 10px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
}

.dts__badge-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.dts__badge-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* chip 尾部的图标专用迷你徽标 */
.dts__badge--mini {
  gap: 0;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dts-kind-color, #64748b) 17%, transparent);
  color: var(--dts-kind-color, #64748b);
  font-size: 10px;
  line-height: 18px;
}

/* 总结区的 chip 继承所属工具的 kind 配色 */
.dts__chip[data-kind] {
  background: color-mix(in srgb, var(--dts-kind-color, #64748b) 13%, transparent);
  color: var(--dts-kind-color, #64748b);
}

/* per-kind 配色（badge + chip 共用同一个 CSS 变量） */
:where(.dts__badge, .dts__chip)[data-kind="git-push"] { --dts-kind-color: #a855f7; }
:where(.dts__badge, .dts__chip)[data-kind="git-commit"] { --dts-kind-color: #22c55e; }
:where(.dts__badge, .dts__chip)[data-kind="git-pull"] { --dts-kind-color: #3b82f6; }
:where(.dts__badge, .dts__chip)[data-kind="git-clone"] { --dts-kind-color: #0ea5e9; }
:where(.dts__badge, .dts__chip)[data-kind="git"] { --dts-kind-color: #16a34a; }
:where(.dts__badge, .dts__chip)[data-kind="gh"] { --dts-kind-color: #8b5cf6; }
:where(.dts__badge, .dts__chip)[data-kind="install"] { --dts-kind-color: #f97316; }
:where(.dts__badge, .dts__chip)[data-kind="build"] { --dts-kind-color: #f59e0b; }
:where(.dts__badge, .dts__chip)[data-kind="test"] { --dts-kind-color: #06b6d4; }
:where(.dts__badge, .dts__chip)[data-kind="run"] { --dts-kind-color: #6366f1; }
:where(.dts__badge, .dts__chip)[data-kind="read"] { --dts-kind-color: #64748b; }
:where(.dts__badge, .dts__chip)[data-kind="write"] { --dts-kind-color: #10b981; }
:where(.dts__badge, .dts__chip)[data-kind="edit"] { --dts-kind-color: #14b8a6; }
:where(.dts__badge, .dts__chip)[data-kind="delete"] { --dts-kind-color: #ef4444; }
:where(.dts__badge, .dts__chip)[data-kind="search"] { --dts-kind-color: #8b5cf6; }
:where(.dts__badge, .dts__chip)[data-kind="fetch"] { --dts-kind-color: #0ea5e9; }
:where(.dts__badge, .dts__chip)[data-kind="download"] { --dts-kind-color: #0ea5e9; }
:where(.dts__badge, .dts__chip)[data-kind="browser"] { --dts-kind-color: #14b8a6; }
:where(.dts__badge, .dts__chip)[data-kind="image"] { --dts-kind-color: #ec4899; }
:where(.dts__badge, .dts__chip)[data-kind="vision"] { --dts-kind-color: #d946ef; }
:where(.dts__badge, .dts__chip)[data-kind="memory"] { --dts-kind-color: #eab308; }
:where(.dts__badge, .dts__chip)[data-kind="todo"] { --dts-kind-color: #84cc16; }
:where(.dts__badge, .dts__chip)[data-kind="subagent"] { --dts-kind-color: #0ea5e9; }
:where(.dts__badge, .dts__chip)[data-kind="question"] { --dts-kind-color: #f43f5e; }
:where(.dts__badge, .dts__chip)[data-kind="command"] { --dts-kind-color: #94a3b8; }
:where(.dts__badge, .dts__chip)[data-kind="other"] { --dts-kind-color: #94a3b8; }

/* ---- 兼容保留：非聚合路径的内联工具组（当前未挂载，配色对齐新语言）---- */
.dts__group {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, transparent);
}

.dts__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 12px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  user-select: none;
}

.dts__head:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08));
}

.dts__head-icon {
  flex: none;
  font-size: 13px;
  line-height: 1;
}

.dts__head-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__head-running {
  color: var(--dsw-alias-state-business-primary);
}

.dts__head-errors {
  flex: none;
  border-radius: 999px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 14%, transparent);
  color: var(--dsw-alias-state-error-primary, #e5484d);
  font-size: 11px;
  line-height: 18px;
}

.dts__body {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.16));
}

.dts__tool-list {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.dts__generic {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: 28px;
  padding: 3px 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

.dts__generic-name {
  flex: none;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.dts__generic-args {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__toggle {
  align-self: flex-start;
  margin: 2px 8px 8px;
  border: 0;
  border-radius: 999px;
  padding: 2px 10px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 11px;
  line-height: 20px;
}

.dts__toggle:hover {
  color: var(--dsw-alias-label-primary);
}

/* ── 移动端：活动弹窗全屏、对话流内下载卡片不设最小宽 ─────────── */
@media (max-width: 767.98px) {
  .dts__modal{width:100vw;max-width:100vw;max-height:100vh;max-height:100dvh;border-radius:0;top:0;left:0;transform:none}
  .dts__download-card{min-width:0}
}

/* ── 尊重系统「减少动态效果」：高光/呼吸/滑动动画一律停 ─────────── */
@media (prefers-reduced-motion: reduce) {
  .dts__entry[data-running="true"]::after { display: none; }
  .dts__entry,
  .dts__entry[data-running="true"] .dts__entry-icon,
  .dts__dot[data-state="running"],
  .dts__progress::after,
  .dts__modal,
  .dts__modal-mask {
    animation: none;
    transition: none;
  }
  .dts__entry:hover { transform: none; }
}
`

/** Inject the stylesheet once. */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-tool-summary-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-tool-summary-styles'
  style.textContent = CSS
  document.head.appendChild(style)
}



