/**
 * webui — 对话输入框 Ctrl+Enter 换行。
 *
 * DSH 原生 composer 的键盘语义：Enter 发送、Shift+Enter 换行、Ctrl/Cmd+Enter
 * 为加速发送（busy 状态 steering）。本模块在捕获阶段拦截 Ctrl+Enter（不含
 * Cmd/Shift/Alt），在 composer 文本域光标处插入换行符，使 Ctrl+Enter 与
 * Shift+Enter 一样用于换行，同时不影响其它快捷键（Mac 的 Cmd+Enter 仍保留
 * 加速发送语义）。
 */

/** composer 卡片容器标记（ui-conversation 的 InputBar 渲染）。 */
const COMPOSER_CARD_SELECTOR = '[data-composer-card]'

/** 原生 value setter：绕过 React 的 value tracker 直接写 DOM 值。 */
const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

let installedHandler: ((e: KeyboardEvent) => void) | null = null

/** 目标是否为 composer 文本域且处于可编辑状态。 */
function isEditableComposerTextarea(target: EventTarget | null): target is HTMLTextAreaElement {
  if (!(target instanceof HTMLTextAreaElement)) return false
  if (target.disabled || target.readOnly) return false
  return target.closest(COMPOSER_CARD_SELECTOR) !== null
}

/** 在光标处插入一个换行符，并通过 input 事件驱动 React 受控值更新。 */
function insertNewline(el: HTMLTextAreaElement): void {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  const next = el.value.slice(0, start) + '\n' + el.value.slice(end)
  if (valueSetter !== undefined) valueSetter.call(el, next)
  else el.value = next
  const caret = start + 1
  el.setSelectionRange(caret, caret)
  // 原生 input 事件冒泡到 React 委托层，触发 composer 的 onChange → setDraft。
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function onKeyDownCapture(e: KeyboardEvent): void {
  if (e.key !== 'Enter') return
  if (!e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
  // 键盘自动重复（按住不放触发 OS key repeat）只认首次按下，否则一次按键连插多行。
  if (e.repeat) return
  if (!isEditableComposerTextarea(e.target)) return
  // IME 组合中不拦截（keyCode 229 为遗留的组合信号）。
  // oxlint-disable-next-line typescript/no-deprecated
  if (e.isComposing || e.keyCode === 229) return
  // 阻止原生/React 的发送路径（React 的 keydown 委托在冒泡阶段，捕获阶段
  // stopPropagation 使其不触发），然后自行换行。
  e.preventDefault()
  e.stopPropagation()
  insertNewline(e.target)
}

/** 注册 Ctrl+Enter 换行（幂等，进程内只注册一次）。 */
export function applyCtrlEnterNewline(): void {
  if (installedHandler !== null) return
  installedHandler = onKeyDownCapture
  document.addEventListener('keydown', installedHandler, true)
}
