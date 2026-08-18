/**
 * 页面感知与操作：注入 JS 遍历 DOM 生成 ref 树（文本主感知），
 * 按 ref 执行真实输入（CDP Input 域）点击 / 输入 / 滚动 / 悬停 / 下拉选择。
 *
 * 相比初版的关键改进：
 * - 点击/输入走 CDP Input 域真实事件（真实坐标点击、insertText、真实按键），
 *   命中 React/Vue 受控组件、canvas、自定义控件更高；
 * - 移除操作前的全量 REASSIGN 遍历：既慢，又会在动态页面里静默重编号导致点错。
 *   改为直接 querySelector('[data-dsh-ref="N"]') 定位，页面变化时干净报错让模型重拍；
 * - describe 增加 name/id/type/value/checked/disabled/expanded/options 等判别信息，
 *   减少模型选错元素的重试；
 * - 提供 waitForSettle（MutationObserver 静默检测），操作后等 DOM 稳定再快照，
 *   避免拿到陈旧/空快照导致反复重试。
 */
import type { CdpSession } from './cdp.js'
import {
  evaluateJson,
  dispatchMouseClick,
  dispatchMouseMove,
  insertText,
  dispatchEnterKey,
} from './cdp.js'

// ── 注入 JS（字符串常量，页面上下文执行，禁止使用模板插值）──────────────

const MAX_REFS = 250

const COLLECT_JS = `(function () {
  var MAX_REFS = ${MAX_REFS};
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity || 1) > 0.05;
  }
  function str(s, n) {
    s = (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) : s;
  }
  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var parts = [tag];
    var type = el.getAttribute && el.getAttribute('type');
    if (type) parts.push('type=' + type);
    var name = el.getAttribute && el.getAttribute('name');
    if (name) parts.push('name=' + str(name, 40));
    if (el.id) parts.push('id=' + str(el.id, 40));
    if (tag === 'input' && el.value != null && el.value !== '') {
      parts.push('value=' + str(type === 'password' ? '(已填写)' : el.value, 40));
    }
    if (tag === 'textarea' && el.value) parts.push('value=' + str(el.value, 40));
    if (el.disabled) parts.push('disabled');
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) parts.push(el.checked ? 'checked' : 'unchecked');
    if (el.hasAttribute && el.hasAttribute('aria-pressed')) parts.push('aria-pressed=' + el.getAttribute('aria-pressed'));
    if (el.hasAttribute && el.hasAttribute('aria-expanded')) parts.push('aria-expanded=' + el.getAttribute('aria-expanded'));
    if (el.hasAttribute && el.hasAttribute('aria-selected')) parts.push('aria-selected=' + el.getAttribute('aria-selected'));
    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) parts.push('"' + (text.length > 60 ? text.slice(0, 60) : text) + '"');
    var ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph) parts.push('ph=' + str(ph, 40));
    var role = el.getAttribute && el.getAttribute('role');
    if (role) parts.push('role=' + role);
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) parts.push('aria=' + str(aria, 60));
    var title = el.getAttribute && el.getAttribute('title');
    if (title) parts.push('title=' + str(title, 60));
    if (tag === 'a' && el.getAttribute('href')) parts.push('href=' + str(el.getAttribute('href'), 80));
    if (tag === 'select') {
      var opts = [];
      for (var o = 0; o < el.options.length && o < 10; o++) {
        opts.push(str(el.options[o].text || el.options[o].value, 24));
      }
      if (opts.length) parts.push('options=[' + opts.join(' | ') + (el.options.length > 10 ? ' …' : '') + ']');
    }
    if (tag === 'img') {
      var alt = el.getAttribute && el.getAttribute('alt');
      if (alt) parts.push('alt=' + str(alt, 40));
    }
    return parts.join(' ');
  }
  // 清除旧标记，防止动态页面残留的 data-dsh-ref 与本次编号错位
  var stale = document.querySelectorAll('[data-dsh-ref]');
  for (var s = 0; s < stale.length; s++) stale[s].removeAttribute('data-dsh-ref');
  var refs = [];
  var els = document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],[onclick],[tabindex],summary,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],img');
  var truncated = false;
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (!isVisible(el)) continue;
    if (el.tagName === 'IMG') {
      var ialt = el.getAttribute && el.getAttribute('alt');
      if (!ialt && !el.getAttribute('title')) continue;
    }
    if (refs.length >= MAX_REFS) { truncated = true; break; }
    var ref = refs.length + 1;
    el.setAttribute('data-dsh-ref', String(ref));
    refs.push({ ref: ref, desc: describe(el) });
  }
  var bodyText = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1500);
  return { url: location.href, title: document.title, refs: refs, bodyText: bodyText, truncated: truncated };
})()`

// 按 ref 定位元素并滚动到可视区中央，返回其视口中心坐标（用于真实鼠标点击/悬停）
const GET_RECT_JS = `(function (ref) {
  var el = document.querySelector('[data-dsh-ref="' + ref + '"]');
  if (!el) return { ok: false, error: 'ref ' + ref + ' 不存在（页面可能已变化，请重新 snapshot）' };
  try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }
  catch (e) { try { el.scrollIntoView({ block: 'center' }); } catch (e2) {} }
  var r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { ok: false, error: 'ref ' + ref + ' 元素不可见（宽高为 0）' };
  var cx = Math.round(r.left + r.width / 2);
  var cy = Math.round(r.top + r.height / 2);
  return { ok: true, x: cx, y: cy, tag: el.tagName.toLowerCase(), text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40) };
})`

// 聚焦输入控件并选中已有内容（便于 insertText 整体替换）
const FOCUS_SELECT_JS = `(function (ref) {
  var el = document.querySelector('[data-dsh-ref="' + ref + '"]');
  if (!el) return { ok: false, error: 'ref ' + ref + ' 不存在（页面可能已变化，请重新 snapshot）' };
  var tag = el.tagName;
  if (tag === 'SELECT') return { ok: true, tag: 'SELECT' };
  var editable = tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  if (!editable) return { ok: false, error: 'ref ' + ref + ' 不是输入控件（' + tag + '）' };
  try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }
  catch (e) { try { el.scrollIntoView({ block: 'center' }); } catch (e2) {} }
  try { el.focus(); } catch (e) {}
  try {
    if (typeof el.select === 'function') el.select();
    else if (el.isContentEditable) {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch (e) {}
  return { ok: true, tag: tag, type: el.type || '' };
})`

// 下拉选择：按 value 精确匹配，否则按可见文本匹配，走原生 setter + change
const SELECT_SET_JS = `(function (ref, value) {
  var el = document.querySelector('[data-dsh-ref="' + ref + '"]');
  if (!el) return { ok: false, error: 'ref ' + ref + ' 不存在（页面可能已变化，请重新 snapshot）' };
  if (el.tagName !== 'SELECT') return { ok: false, error: 'ref ' + ref + ' 不是下拉框（' + el.tagName + '）' };
  var v = String(value);
  var proto = HTMLSelectElement.prototype;
  var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  var matched = false;
  for (var i = 0; i < el.options.length; i++) {
    var opt = el.options[i];
    var label = (opt.text || opt.value || '').replace(/\\s+/g, ' ').trim();
    if (opt.value === v || label === v) {
      setter.call(el, opt.value);
      matched = true;
      break;
    }
  }
  if (!matched) return { ok: false, error: '未找到匹配选项 "' + v + '"，可用 browser_evaluate 查看 options' };
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, value: el.value };
})`

const SCROLL_JS = `(function (direction, amount) {
  var v = Number(amount) || 3;
  var dx = 0, dy = 0;
  if (direction === 'left' || direction === 'right') dx = v * 250 * (direction === 'left' ? -1 : 1);
  else dy = v * 400 * (direction === 'up' ? -1 : 1);
  window.scrollBy({ top: dy, left: dx, behavior: 'instant' });
  return { ok: true };
})`

// DOM 静默检测：连续 idleMs 无 mutation 则 resolve(true)，超时 resolve(false)。
// 若页面发生导航（执行上下文销毁），Promise 不会 resolve，Node 侧捕获后按「导航」处理。
const WAIT_SETTLE_JS = `(function (idleMs, timeoutMs) {
  return new Promise(function (resolve) {
    var t = null;
    function settle() { resolve(true); }
    function reset() { if (t) clearTimeout(t); t = setTimeout(settle, idleMs); }
    var mo = null;
    try {
      mo = new MutationObserver(reset);
      mo.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch (e) { resolve(true); return; }
    reset();
    setTimeout(function () { resolve(false); }, timeoutMs);
  });
})`

// ── Node 侧封装 ─────────────────────────────────────────

export interface SnapshotResult {
  /** 组装后的文本树（给 LLM 的主感知） */
  text: string
  url: string
  title: string
  refCount: number
  truncated: boolean
}

export async function getSnapshot(session: CdpSession): Promise<SnapshotResult> {
  const data = await evaluateJson(session, COLLECT_JS)
  if (!data || !Array.isArray(data.refs)) throw new Error('snapshot 失败：页面无有效响应')
  const lines: string[] = []
  lines.push(`URL: ${data.url || '(空白页)'}`)
  if (data.title) lines.push(`标题: ${String(data.title).slice(0, 120)}`)
  lines.push('可交互元素（ref 定位，页面变化后请重新 snapshot）:')
  if (data.refs.length === 0) lines.push('  （无可见可交互元素）')
  for (const r of data.refs) lines.push(`  [${r.ref}] ${r.desc}`)
  if (data.truncated) lines.push(`  （元素过多，已截断至前 ${MAX_REFS} 个，其余用 browser_evaluate 定位）`)
  if (data.bodyText) {
    lines.push('页面正文摘要:')
    lines.push(String(data.bodyText).slice(0, 1200))
  }
  return {
    text: lines.join('\n'),
    url: data.url || '',
    title: data.title || '',
    refCount: data.refs.length,
    truncated: !!data.truncated,
  }
}

/** 等 DOM 静默。返回 settled（静默/超时）与 nav（是否发生导航）。 */
export async function waitForSettle(
  session: CdpSession,
  idleMs = 250,
  timeoutMs = 2000,
): Promise<{ settled: boolean; nav: boolean }> {
  try {
    const settled = await evaluateJson(session, `${WAIT_SETTLE_JS}(${Number(idleMs)}, ${Number(timeoutMs)})`, true)
    return { settled: !!settled, nav: false }
  } catch {
    // 执行上下文销毁 → 页面发生了导航
    return { settled: false, nav: true }
  }
}

export async function clickRef(session: CdpSession, ref: number): Promise<void> {
  const rect = await evaluateJson(session, `${GET_RECT_JS}(${Number(ref)})`)
  if (!rect) throw new Error('定位元素失败')
  if (rect.ok === false) throw new Error(String(rect.error || '点击失败'))
  await dispatchMouseClick(session, rect.x, rect.y)
}

export async function hoverRef(session: CdpSession, ref: number): Promise<void> {
  const rect = await evaluateJson(session, `${GET_RECT_JS}(${Number(ref)})`)
  if (!rect) throw new Error('定位元素失败')
  if (rect.ok === false) throw new Error(String(rect.error || '悬停失败'))
  await dispatchMouseMove(session, rect.x, rect.y)
}

export async function typeRef(
  session: CdpSession,
  ref: number,
  text: string,
  pressEnter: boolean,
): Promise<void> {
  const info = await evaluateJson(session, `${FOCUS_SELECT_JS}(${Number(ref)})`)
  if (!info) throw new Error('定位输入元素失败')
  if (info.ok === false) throw new Error(String(info.error || '输入失败'))
  if (info.tag === 'SELECT') {
    await selectRef(session, ref, text)
    return
  }
  await insertText(session, String(text))
  if (pressEnter) await dispatchEnterKey(session)
}

export async function selectRef(session: CdpSession, ref: number, value: string): Promise<void> {
  const safeValue = JSON.stringify(String(value))
  const result = await evaluateJson(session, `${SELECT_SET_JS}(${Number(ref)}, ${safeValue})`)
  if (!result) throw new Error('下拉选择失败')
  if (result.ok === false) throw new Error(String(result.error || '下拉选择失败'))
}

export async function scrollPage(
  session: CdpSession,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number,
): Promise<void> {
  const safeDir = JSON.stringify(direction)
  await evaluateJson(session, `${SCROLL_JS}(${safeDir}, ${Number(amount) || 3})`)
}
