/** Injected stylesheet for the tool-group UI (Harness design tokens). */

const CSS = `
/* Collapse flow slots that render nothing (aggregated tool groups + reasoning
   groups leave empty node slots behind; the transcript column's flex gap
   would otherwise turn each into a blank strip). */
[data-chat-flow-key]:has(> [data-slot]:empty) {
  display: none;
}

.dts__group {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dsw-alias-border-base, rgba(127,127,127,.25));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  overflow: hidden;
}

.dts__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 10px;
  cursor: pointer;
  user-select: none;
  color: var(--dsw-alias-label-primary);
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
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  line-height: 24px;
}

.dts__head-running {
  color: var(--dsw-alias-state-business-primary);
}

.dts__head-errors {
  flex: none;
  border-radius: 10px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-danger-primary, #e5484d) 14%, transparent);
  color: var(--dsw-alias-state-danger-primary, #e5484d);
  font-size: 11px;
  line-height: 18px;
}

.dts__chevron {
  flex: none;
  margin-left: auto;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  transition: transform .15s ease;
}

.dts__chevron[data-open="true"] {
  transform: rotate(90deg);
}

.dts__body {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--dsw-alias-border-base, rgba(127,127,127,.18));
}

.dts__summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.05));
}

.dts__summary-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dts__summary-line {
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}

.dts__summary-line b {
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dts__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dts__chip {
  border-radius: 10px;
  padding: 1px 8px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
}

.dts__files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dts__file {
  margin: 0;
  border: 0;
  padding: 1px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3182ce) 12%, transparent);
  color: var(--dsw-alias-state-business-primary, #3182ce);
  cursor: pointer;
  font-size: 11px;
  line-height: 18px;
  font-family: var(--ds-font-family-code, monospace);
  white-space: nowrap;
}

.dts__file:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.dts__tool-list {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.dts__call {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dts__call[data-selected="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08));
}

.dts__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 3px 8px;
  cursor: pointer;
  user-select: none;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 22px;
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
  background: var(--dsw-alias-state-business-primary, #3182ce);
  animation: dts-pulse 1s ease-in-out infinite;
}

.dts__dot[data-state="ok"] {
  background: var(--dsw-alias-state-success-primary, #2f9e44);
}

.dts__dot[data-state="error"] {
  background: var(--dsw-alias-state-danger-primary, #e5484d);
}

.dts__dot[data-state="stopped"] {
  background: var(--dsw-alias-label-caption, #94a3b8);
}

@keyframes dts-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .35; }
}

.dts__row-name {
  flex: none;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dts__row-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
}

.dts__row-time {
  flex: none;
  color: var(--dsw-alias-label-caption, #94a3b8);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dts__row-time[data-running="true"] {
  color: var(--dsw-alias-state-business-primary, #3182ce);
}

/* live download / long-command status: an indeterminate progress bar plus a
   running clock, so a long download or command never looks frozen. */
.dts__row-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  color: var(--dsw-alias-state-business-primary, #3182ce);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dts__progress {
  position: relative;
  width: 48px;
  height: 3px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.15));
  overflow: hidden;
}

.dts__progress::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary, #3182ce);
  animation: dts-progress-slide 1.2s ease-in-out infinite;
}

@keyframes dts-progress-slide {
  0% { left: -40%; }
  100% { left: 100%; }
}

.dts__inspect {
  flex: none;
  margin: 0;
  border: 0;
  padding: 0 4px;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-size: 11px;
  line-height: 20px;
  opacity: 0;
}

.dts__row:hover .dts__inspect,
.dts__inspect:focus-visible {
  opacity: 1;
}

.dts__inspect:hover {
  color: var(--dsw-alias-state-business-primary, #3182ce);
}

.dts__row-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
  margin: 0 8px 6px 24px;
  padding: 6px 8px;
  border-left: 2px solid var(--dsw-alias-border-base, rgba(127,127,127,.25));
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.04));
  border-radius: 0 6px 6px 0;
}

.dts__row-args,
.dts__row-output {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
  word-break: break-all;
  white-space: pre-wrap;
}

.dts__row-pre {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  line-height: 18px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
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
  border-left: 1px solid var(--dsw-alias-border-base, rgba(127,127,127,.18));
}

/* ---- one-line entry chips (replaces the inline groups) ---- */
.dts__entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin: 0;
  border: 1px solid var(--dsw-alias-border-base, rgba(127,127,127,.25));
  border-radius: 999px;
  padding: 2px 12px;
  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06));
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 12px;
  line-height: 22px;
  white-space: nowrap;
}

.dts__entry:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  color: var(--dsw-alias-label-primary);
}

.dts__entry[data-running="true"] .dts__entry-text {
  color: var(--dsw-alias-state-business-primary, #3182ce);
}

.dts__entry-icon {
  font-size: 12px;
}

.dts__entry-text {
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dts__entry-sub {
  opacity: .7;
}

.dts__entry-err {
  border-radius: 999px;
  padding: 0 6px;
  background: color-mix(in srgb, var(--dsw-alias-state-danger-primary, #e5484d) 14%, transparent);
  color: var(--dsw-alias-state-danger-primary, #e5484d);
  font-size: 11px;
}

/* 对话流外面的下载/执行进度条：紧贴工具 chip 下方，无需点开抽屉。 */
.dts__entry-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  max-width: 100%;
}

.dts__entry-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #3182ce) 45%, transparent);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06));
  color: var(--dsw-alias-state-business-primary, #3182ce);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 对话流外面的下载卡片：标题 + URL + 保存路径 + 进度条 + 时长。 */
.dts__download-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 100%;
  min-width: 260px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-base, rgba(127,127,127,.22));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.04));
}

.dts__download-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-state-business-primary, #3182ce);
  font-size: 12px;
  font-weight: 600;
}

.dts__download-title {
  font-variant-numeric: tabular-nums;
}

.dts__download-url {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
}

.dts__download-dest {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.dts__download-dest code {
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ds-font-family-code, monospace);
}

.dts__download-progress {
  margin-top: 2px;
}

.dts__download-progress .dts__progress {
  width: 100%;
}

/* ---- centered activity modal (like the image lightbox) ---- */
.dts__modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9990;
  background: rgba(0, 0, 0, .45);
}

.dts__modal {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 9991;
  display: flex;
  flex-direction: column;
  width: min(760px, 92vw);
  max-height: min(84vh, 860px);
  border: 1px solid var(--dsw-alias-border-base, rgba(127,127,127,.25));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 18px 60px rgba(0, 0, 0, .3);
  transform: translate(-50%, -50%);
  animation: dts-modal-in .16s ease-out;
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
  padding: 12px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-base, rgba(127,127,127,.18));
}

.dts__modal-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dts__modal-close {
  margin: 0;
  border: 0;
  padding: 2px 10px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 14px;
  line-height: 22px;
  border-radius: 6px;
}

.dts__modal-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  color: var(--dsw-alias-label-primary);
}

.dts__modal-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 24px;
}

/* ---- separate panels: thinking vs tools ---- */
.dts__modal-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--dsw-alias-border-base, rgba(127,127,127,.22));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.04));
  padding: 12px 12px 14px;
}

.dts__modal-panel + .dts__modal-panel {
  margin-top: 18px;
}

.dts__modal-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
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
  color: var(--dsw-alias-state-business-primary, #3182ce);
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---- reasoning item jump navigation ---- */
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
  margin: 0;
  border: 1px solid var(--dsw-alias-border-base, rgba(127,127,127,.25));
  border-radius: 8px;
  padding: 1px 9px;
  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06));
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 11px;
  line-height: 20px;
  min-width: 24px;
}

.dts__reasoning-nav-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14));
  color: var(--dsw-alias-label-primary);
}

.dts__reasoning-nav-item[data-active="true"] {
  border-color: var(--dsw-alias-state-business-primary, #3182ce);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3182ce) 16%, transparent);
  color: var(--dsw-alias-state-business-primary, #3182ce);
  font-weight: 600;
}

.dts__modal-reasoning {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dts__modal-reasoning-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dts__modal-reasoning-group-title {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 2px 12px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12));
  border: 1px solid var(--dsw-alias-border-base, rgba(127,127,127,.25));
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
}

.dts__modal-reasoning-item {
  display: flex;
  gap: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 22px;
  border-radius: 6px;
  scroll-margin-top: 8px;
}

.dts__modal-reasoning-item[data-active="true"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #3182ce) 8%, transparent);
  outline: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #3182ce) 35%, transparent);
}

.dts__modal-reasoning-item[data-running="true"] {
  color: var(--dsw-alias-label-primary);
}

.dts__modal-reasoning-item-index {
  flex: none;
  align-self: flex-start;
  min-width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1));
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  font-weight: 600;
  line-height: 20px;
  margin-top: 2px;
}

.dts__modal-reasoning-item-text {
  min-width: 0;
  flex: 1 1 auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.dts__modal-tools {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* call-tree wrapper inside the modal (see ToolCallTreeList) */
.dts__drawer-call {
  display: flex;
  flex-direction: column;
  min-width: 0;
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
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dts__generic-args {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
}

.dts__toggle {
  align-self: flex-start;
  margin: 2px 8px 8px;
  border: 0;
  border-radius: 10px;
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

.dts__empty {
  padding: 8px 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
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
