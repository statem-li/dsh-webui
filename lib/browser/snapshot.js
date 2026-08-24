import { evaluateJson, dispatchMouseClick, dispatchMouseMove, insertText, dispatchEnterKey, } from './cdp.js';
// ── 注入 JS（字符串常量，页面上下文执行，禁止模板插值）──────────────
const MAX_REFS = 250;
/** 单个元素描述的字符上限（超出截断，避免长 aria/href 吃满上下文）。 */
const MAX_DESC = 150;
/** 快照文本总长上限（超出按元素行截断并提示）。 */
const MAX_SNAPSHOT_CHARS = 14000;
/** 正文摘要上限。 */
const MAX_BODY_TEXT = 900;
/** 公共注入片段：遍历文档（含 shadow DOM / 同源 iframe）并登记元素。 */
const COMMON_JS = `
var DSH_SEL = 'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],[role="combobox"],[onclick],[tabindex],summary,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],img';
function dshVisible(el) {
  if (!el || el.nodeType !== 1) return false;
  var r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  var win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  var cs = win.getComputedStyle(el);
  if (!cs) return false;
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity || 1) > 0.05;
}
function dshStr(s, n) {
  s = (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) : s;
}
function dshLabel(el) {
  var tag = el.tagName.toLowerCase();
  var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  if (text) return text;
  var aria = el.getAttribute ? (el.getAttribute('aria-label') || '') : '';
  if (aria) return aria;
  var title = el.getAttribute ? (el.getAttribute('title') || '') : '';
  if (title) return title;
  var ph = el.getAttribute ? (el.getAttribute('placeholder') || '') : '';
  if (ph) return ph;
  if (tag === 'img') return (el.getAttribute('alt') || '');
  if ((tag === 'input' || tag === 'textarea') && el.value) return String(el.value);
  return '';
}
/** 遍历一个文档树（含其 shadow root 与同源 iframe），visit(el, offX, offY)。 */
function dshWalk(root, offX, offY, visit, depth) {
  if (!root || depth > 6) return;
  var els;
  try { els = root.querySelectorAll(DSH_SEL); } catch (e) { return; }
  for (var i = 0; i < els.length; i++) visit(els[i], offX, offY);
  var all;
  try { all = root.querySelectorAll('*'); } catch (e) { all = []; }
  for (var j = 0; j < all.length; j++) {
    var node = all[j];
    if (node.shadowRoot) dshWalk(node.shadowRoot, offX, offY, visit, depth + 1);
    if (node.tagName === 'IFRAME') {
      var idoc = null;
      try { idoc = node.contentDocument; } catch (e) { idoc = null; }
      if (idoc && idoc.documentElement) {
        var fr = node.getBoundingClientRect();
        if (fr.width > 0 && fr.height > 0) {
          dshWalk(idoc, offX + fr.left, offY + fr.top, visit, depth + 1);
        }
      }
    }
  }
}
/** 元素在顶层视口的中心坐标（叠加 iframe 偏移）。 */
function dshCenter(entry) {
  var r = entry.el.getBoundingClientRect();
  return {
    x: Math.round(entry.offX + r.left + r.width / 2),
    y: Math.round(entry.offY + r.top + r.height / 2),
    w: r.width,
    h: r.height,
  };
}
`;
const COLLECT_JS = `(function () {
  var MAX_REFS = ${MAX_REFS};
  var MAX_DESC = ${MAX_DESC};
  ${COMMON_JS}
  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var parts = [tag];
    var type = el.getAttribute && el.getAttribute('type');
    if (type) parts.push('type=' + type);
    var name = el.getAttribute && el.getAttribute('name');
    if (name) parts.push('name=' + dshStr(name, 30));
    if (el.id) parts.push('id=' + dshStr(el.id, 30));
    if (tag === 'input' && el.value != null && el.value !== '') {
      parts.push('value=' + dshStr(type === 'password' ? '(已填写)' : el.value, 30));
    }
    if (tag === 'textarea' && el.value) parts.push('value=' + dshStr(el.value, 30));
    if (el.disabled) parts.push('disabled');
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) parts.push(el.checked ? 'checked' : 'unchecked');
    if (el.hasAttribute && el.hasAttribute('aria-pressed')) parts.push('pressed=' + el.getAttribute('aria-pressed'));
    if (el.hasAttribute && el.hasAttribute('aria-expanded')) parts.push('expanded=' + el.getAttribute('aria-expanded'));
    if (el.hasAttribute && el.hasAttribute('aria-selected')) parts.push('selected=' + el.getAttribute('aria-selected'));
    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) parts.push('"' + (text.length > 60 ? text.slice(0, 60) : text) + '"');
    var ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph) parts.push('ph=' + dshStr(ph, 30));
    var role = el.getAttribute && el.getAttribute('role');
    if (role) parts.push('role=' + role);
    if (!text) {
      var aria = el.getAttribute && el.getAttribute('aria-label');
      if (aria) parts.push('aria=' + dshStr(aria, 40));
      var title = el.getAttribute && el.getAttribute('title');
      if (title) parts.push('title=' + dshStr(title, 40));
    }
    if (tag === 'a' && el.getAttribute('href')) parts.push('href=' + dshStr(el.getAttribute('href'), 60));
    if (tag === 'select') {
      var opts = [];
      for (var o = 0; o < el.options.length && o < 10; o++) {
        opts.push(dshStr(el.options[o].text || el.options[o].value, 20));
      }
      if (opts.length) parts.push('options=[' + opts.join(' | ') + (el.options.length > 10 ? ' …' : '') + ']');
    }
    if (tag === 'img') {
      var alt = el.getAttribute && el.getAttribute('alt');
      if (alt) parts.push('alt=' + dshStr(alt, 30));
    }
    var out = parts.join(' ');
    return out.length > MAX_DESC ? out.slice(0, MAX_DESC) + '…' : out;
  }
  // 清除旧标记，防止动态页面残留的 data-dsh-ref 与本次编号错位
  var stale = document.querySelectorAll('[data-dsh-ref]');
  for (var s = 0; s < stale.length; s++) stale[s].removeAttribute('data-dsh-ref');
  var refs = [];
  var registry = [];
  var truncated = false;
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  dshWalk(document, 0, 0, function (el, offX, offY) {
    if (truncated || registry.length >= MAX_REFS) { truncated = true; return; }
    if (!dshVisible(el)) return;
    if (el.tagName === 'IMG') {
      var ialt = el.getAttribute && el.getAttribute('alt');
      if (!ialt && !(el.getAttribute && el.getAttribute('title'))) return;
    }
    var r = el.getBoundingClientRect();
    var cx = offX + r.left + r.width / 2;
    var cy = offY + r.top + r.height / 2;
    var offscreen = cx < 0 || cy < 0 || cx > vw || cy > vh;
    var ref = registry.length + 1;
    registry.push({ el: el, offX: offX, offY: offY });
    try { el.setAttribute('data-dsh-ref', String(ref)); } catch (e) {}
    refs.push({ ref: ref, desc: describe(el), off: offscreen ? 1 : 0 });
  }, 0);
  window.__dshRefs = registry;
  var body = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim();
  var doc = document.documentElement || { scrollHeight: 0, scrollTop: 0 };
  return {
    url: location.href,
    title: document.title,
    refs: refs,
    bodyText: body.slice(0, ${MAX_BODY_TEXT}),
    bodyLen: body.length,
    truncated: truncated,
    scrollY: Math.round(window.scrollY || doc.scrollTop || 0),
    scrollH: Math.round(doc.scrollHeight || 0),
    vh: vh
  };
})()`;
/** 定位并滚动到可视区，返回顶层视口坐标（支持 ref / selector / text）。 */
const RESOLVE_JS = `(function (locator) {
  ${COMMON_JS}
  function entryOfRef(ref) {
    var reg = window.__dshRefs;
    if (reg && reg[ref - 1] && reg[ref - 1].el && reg[ref - 1].el.isConnected) return reg[ref - 1];
    var el = document.querySelector('[data-dsh-ref="' + ref + '"]');
    if (el) return { el: el, offX: 0, offY: 0 };
    return null;
  }
  function collectAll() {
    var out = [];
    dshWalk(document, 0, 0, function (el, offX, offY) {
      if (!dshVisible(el)) return;
      out.push({ el: el, offX: offX, offY: offY });
    }, 0);
    return out;
  }
  function entryOfSelector(sel, nth) {
    var direct = null;
    try { direct = document.querySelectorAll(sel); } catch (e) { return { err: '选择器语法无效: ' + sel }; }
    var hits = [];
    for (var i = 0; i < direct.length; i++) hits.push({ el: direct[i], offX: 0, offY: 0 });
    if (hits.length === 0) {
      // 穿透 shadow DOM / 同源 iframe 再找一遍
      var all = collectAll();
      for (var j = 0; j < all.length; j++) {
        var doc = all[j].el.getRootNode ? all[j].el.getRootNode() : document;
        var m = false;
        try { m = all[j].el.matches(sel); } catch (e) { m = false; }
        if (m) hits.push(all[j]);
      }
    }
    if (hits.length === 0) return null;
    var idx = Math.max(0, (nth || 1) - 1);
    return hits[Math.min(idx, hits.length - 1)];
  }
  function entryOfText(text, nth) {
    var want = String(text).replace(/\\s+/g, ' ').trim().toLowerCase();
    if (want === '') return null;
    var all = collectAll();
    var exact = [], starts = [], includes = [];
    for (var i = 0; i < all.length; i++) {
      var label = dshLabel(all[i].el).replace(/\\s+/g, ' ').trim().toLowerCase();
      if (label === '') continue;
      if (label === want) exact.push(all[i]);
      else if (label.indexOf(want) === 0) starts.push(all[i]);
      else if (label.indexOf(want) >= 0) includes.push(all[i]);
    }
    var pool = exact.length ? exact : (starts.length ? starts : includes);
    if (pool.length === 0) return null;
    var idx = Math.max(0, (nth || 1) - 1);
    return pool[Math.min(idx, pool.length - 1)];
  }
  var entry = null;
  var how = '';
  if (locator.ref) { entry = entryOfRef(Number(locator.ref)); how = 'ref ' + locator.ref; }
  else if (locator.selector) {
    var r = entryOfSelector(String(locator.selector), locator.nth);
    if (r && r.err) return { ok: false, error: r.err };
    entry = r; how = 'selector ' + locator.selector;
  }
  else if (locator.text) { entry = entryOfText(String(locator.text), locator.nth); how = '文本「' + locator.text + '」'; }
  else return { ok: false, error: '缺少定位参数：需要 ref / selector / text 之一' };
  if (!entry || !entry.el) {
    return { ok: false, error: how + ' 未匹配到元素' + (locator.ref ? '（页面已变化，请重新 browser_snapshot，或改用 selector/text 定位）' : '（可用 browser_snapshot 查看现有元素）') };
  }
  var el = entry.el;
  try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }
  catch (e) { try { el.scrollIntoView({ block: 'center' }); } catch (e2) {} }
  var c = dshCenter(entry);
  if (c.w === 0 || c.h === 0) return { ok: false, error: how + ' 命中的元素不可见（宽高为 0）' };
  window.__dshLast = entry;
  return {
    ok: true, x: c.x, y: c.y,
    tag: el.tagName.toLowerCase(),
    text: dshStr(dshLabel(el), 40),
    editable: (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) ? 1 : 0,
    select: el.tagName === 'SELECT' ? 1 : 0,
    vw: window.innerWidth, vh: window.innerHeight
  };
})`;
/** 聚焦上一次 resolve 命中的输入控件并全选内容（供 insertText 整体替换）。 */
const FOCUS_LAST_JS = `(function () {
  var entry = window.__dshLast;
  var el = entry && entry.el;
  if (!el || !el.isConnected) return { ok: false, error: '目标元素已失效，请重新定位' };
  var tag = el.tagName;
  if (tag === 'SELECT') return { ok: true, tag: 'SELECT' };
  var editable = tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  if (!editable) return { ok: false, error: '目标不是输入控件（' + tag + '）' };
  try { el.focus(); } catch (e) {}
  try {
    if (typeof el.select === 'function') el.select();
    else if (el.isContentEditable) {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = (el.ownerDocument.defaultView || window).getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch (e) {}
  return { ok: true, tag: tag, type: el.type || '' };
})`;
/** 下拉选择（作用于上一次 resolve 命中的 select）：按 value 精确匹配，否则按可见文本。 */
const SELECT_SET_JS = `(function (value) {
  var entry = window.__dshLast;
  var el = entry && entry.el;
  if (!el || !el.isConnected) return { ok: false, error: '目标元素已失效，请重新定位' };
  if (el.tagName !== 'SELECT') return { ok: false, error: '目标不是下拉框（' + el.tagName + '）' };
  var v = String(value);
  var proto = HTMLSelectElement.prototype;
  var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  var matched = false;
  var avail = [];
  for (var i = 0; i < el.options.length; i++) {
    var opt = el.options[i];
    var label = (opt.text || opt.value || '').replace(/\\s+/g, ' ').trim();
    if (avail.length < 12) avail.push(label);
    if (opt.value === v || label === v) {
      setter.call(el, opt.value);
      matched = true;
      break;
    }
  }
  if (!matched) {
    // 二次尝试：忽略大小写/空白的包含匹配
    var want = v.replace(/\\s+/g, ' ').trim().toLowerCase();
    for (var k = 0; k < el.options.length; k++) {
      var o2 = el.options[k];
      var l2 = (o2.text || o2.value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      if (l2.indexOf(want) >= 0) { setter.call(el, o2.value); matched = true; break; }
    }
  }
  if (!matched) return { ok: false, error: '未找到匹配选项 "' + v + '"，可选项：' + avail.join(' | ') };
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, value: el.value };
})`;
const SCROLL_JS = `(function (direction, amount, selector) {
  var v = Number(amount) || 3;
  var dx = 0, dy = 0;
  if (direction === 'left' || direction === 'right') dx = v * 250 * (direction === 'left' ? -1 : 1);
  else dy = v * 400 * (direction === 'up' ? -1 : 1);
  var target = null;
  if (selector) { try { target = document.querySelector(selector); } catch (e) { target = null; } }
  if (target) {
    target.scrollBy({ top: dy, left: dx, behavior: 'instant' });
  } else {
    window.scrollBy({ top: dy, left: dx, behavior: 'instant' });
  }
  var doc = document.documentElement || {};
  return {
    ok: true,
    scrollY: Math.round(window.scrollY || doc.scrollTop || 0),
    scrollH: Math.round(doc.scrollHeight || 0),
    atBottom: (window.scrollY + window.innerHeight) >= ((doc.scrollHeight || 0) - 4)
  };
})`;
// DOM 静默检测：连续 idleMs 无 mutation 则 resolve(true)，超时 resolve(false)；
// 两种出口都 disconnect 观察器（旧版泄漏，长任务页面越跑越慢）。
const WAIT_SETTLE_JS = `(function (idleMs, timeoutMs) {
  return new Promise(function (resolve) {
    var t = null, hard = null, mo = null, done = false;
    function finish(v) {
      if (done) return;
      done = true;
      if (t) clearTimeout(t);
      if (hard) clearTimeout(hard);
      if (mo) { try { mo.disconnect(); } catch (e) {} }
      resolve(v);
    }
    function reset() { if (t) clearTimeout(t); t = setTimeout(function () { finish(true); }, idleMs); }
    try {
      mo = new MutationObserver(reset);
      mo.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch (e) { finish(true); return; }
    reset();
    hard = setTimeout(function () { finish(false); }, timeoutMs);
  });
})`;
/** 页面内轮询等待条件成立（一次 CDP 调用完成等待）。 */
const WAIT_FOR_JS = `(function (opts) {
  ${COMMON_JS}
  return new Promise(function (resolve) {
    var deadline = Date.now() + (Number(opts.timeoutMs) || 10000);
    var wantGone = opts.gone === true;
    function hit() {
      if (opts.selector) {
        var el = null;
        try { el = document.querySelector(opts.selector); } catch (e) { return { err: '选择器语法无效' }; }
        if (el && !dshVisible(el)) el = null;
        return { found: !!el, label: el ? dshStr(dshLabel(el), 60) : '' };
      }
      if (opts.text) {
        var want = String(opts.text).replace(/\\s+/g, ' ').trim().toLowerCase();
        var body = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').toLowerCase();
        return { found: body.indexOf(want) >= 0, label: '' };
      }
      return { err: '需要 selector 或 text' };
    }
    function tick() {
      var r = hit();
      if (r.err) { resolve({ ok: false, error: r.err }); return; }
      if (wantGone ? !r.found : r.found) { resolve({ ok: true, waitedMs: 0, label: r.label }); return; }
      if (Date.now() > deadline) { resolve({ ok: false, error: wantGone ? '目标在超时前仍未消失' : '目标在超时前未出现' }); return; }
      setTimeout(tick, 100);
    }
    tick();
  });
})`;
/** 提取正文/元素文本（去噪：脚本样式隐藏元素不计），供「读内容」场景省 token。 */
const EXTRACT_JS = `(function (selector, maxChars) {
  var root = document.body;
  if (selector) {
    try { root = document.querySelector(selector); } catch (e) { return { ok: false, error: '选择器语法无效' }; }
    if (!root) return { ok: false, error: '未找到元素: ' + selector };
  }
  var text = (root.innerText || root.textContent || '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
  var links = [];
  var as = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
  for (var i = 0; i < as.length && links.length < 40; i++) {
    var t = (as[i].innerText || '').replace(/\\s+/g, ' ').trim();
    if (t) links.push({ text: t.slice(0, 60), href: as[i].href.slice(0, 200) });
  }
  var cap = Number(maxChars) || 6000;
  return {
    ok: true,
    url: location.href,
    title: document.title,
    text: text.slice(0, cap),
    total: text.length,
    truncated: text.length > cap,
    links: links
  };
})`;
function locatorJson(loc) {
    return JSON.stringify({
        ref: loc.ref != null && Number.isFinite(Number(loc.ref)) ? Number(loc.ref) : undefined,
        selector: typeof loc.selector === 'string' && loc.selector !== '' ? loc.selector : undefined,
        text: typeof loc.text === 'string' && loc.text !== '' ? loc.text : undefined,
        nth: loc.nth != null && Number(loc.nth) > 0 ? Number(loc.nth) : undefined,
    });
}
/** 人类可读的定位描述（日志/活动条用）。 */
export function locatorLabel(loc) {
    if (loc.ref != null)
        return `ref=${loc.ref}`;
    if (loc.selector)
        return `selector=${loc.selector}`;
    if (loc.text)
        return `text=${loc.text}`;
    return '(空定位)';
}
export async function getSnapshot(session) {
    const data = await evaluateJson(session, COLLECT_JS);
    if (!data || !Array.isArray(data.refs))
        throw new Error('snapshot 失败：页面无有效响应');
    const lines = [];
    lines.push(`URL: ${data.url || '(空白页)'}`);
    if (data.title)
        lines.push(`标题: ${String(data.title).slice(0, 120)}`);
    const scrollH = Number(data.scrollH) || 0;
    const vh = Number(data.vh) || 0;
    if (scrollH > vh + 8) {
        const pct = Math.min(100, Math.round(((Number(data.scrollY) || 0) + vh) / scrollH * 100));
        lines.push(`滚动位置: 约 ${pct}%（页面比视口长，下方还有内容可滚动）`);
    }
    lines.push('可交互元素（[ref] 定位；标 off-screen 的需先滚动到视口）:');
    const refs = data.refs;
    if (refs.length === 0)
        lines.push('  （无可见可交互元素）');
    // 连续同描述折叠为 ref 区间：列表页/表格页省大量重复 token。
    let i = 0;
    while (i < refs.length) {
        const cur = refs[i];
        let j = i + 1;
        while (j < refs.length && refs[j].desc === cur.desc && refs[j].off === cur.off)
            j++;
        const mark = cur.off === 1 ? ' off-screen' : '';
        if (j - i >= 3) {
            lines.push(`  [${cur.ref}-${refs[j - 1].ref}]（${j - i} 个相同项）${cur.desc}${mark}`);
        }
        else {
            for (let k = i; k < j; k++)
                lines.push(`  [${refs[k].ref}] ${refs[k].desc}${mark}`);
        }
        i = j;
    }
    if (data.truncated)
        lines.push(`  （元素过多，已截断至前 ${MAX_REFS} 个；其余用 selector/text 定位或 browser_evaluate）`);
    if (data.bodyText) {
        lines.push('页面正文摘要:');
        lines.push(String(data.bodyText));
        if (Number(data.bodyLen) > Number(data.bodyText.length)) {
            lines.push(`（正文共约 ${Number(data.bodyLen)} 字，以上为开头部分；需要全文用 browser_extract）`);
        }
    }
    let text = lines.join('\n');
    if (text.length > MAX_SNAPSHOT_CHARS) {
        text = text.slice(0, MAX_SNAPSHOT_CHARS) + `\n（快照过长已截断；用 browser_extract 读正文、selector/text 定位元素）`;
    }
    return {
        text,
        url: data.url || '',
        title: data.title || '',
        refCount: refs.length,
        truncated: !!data.truncated,
    };
}
/** 等 DOM 静默。返回 settled（静默/超时）与 nav（是否发生导航）。 */
export async function waitForSettle(session, idleMs = 250, timeoutMs = 2000) {
    try {
        const settled = await evaluateJson(session, `${WAIT_SETTLE_JS}(${Number(idleMs)}, ${Number(timeoutMs)})`, true);
        return { settled: !!settled, nav: false };
    }
    catch {
        // 执行上下文销毁 → 页面发生了导航
        return { settled: false, nav: true };
    }
}
/** 定位元素并滚动到视口中央，返回顶层视口坐标与判别信息。 */
export async function resolveTarget(session, loc) {
    const res = await evaluateJson(session, `${RESOLVE_JS}(${locatorJson(loc)})`, false);
    if (!res)
        throw new Error('定位元素失败：页面无响应');
    if (res.ok === false)
        throw new Error(String(res.error || '定位失败'));
    return {
        x: Number(res.x) || 0,
        y: Number(res.y) || 0,
        tag: String(res.tag || ''),
        text: String(res.text || ''),
        vw: Number(res.vw) || 0,
        vh: Number(res.vh) || 0,
        editable: res.editable === 1,
        isSelect: res.select === 1,
    };
}
export async function clickAt(session, loc) {
    const t = await resolveTarget(session, loc);
    await dispatchMouseClick(session, t.x, t.y);
    return t;
}
export async function hoverAt(session, loc) {
    const t = await resolveTarget(session, loc);
    await dispatchMouseMove(session, t.x, t.y);
    return t;
}
export async function typeAt(session, loc, text, pressEnter) {
    const t = await resolveTarget(session, loc);
    if (t.isSelect) {
        await selectValue(session, text);
        return t;
    }
    const info = await evaluateJson(session, `${FOCUS_LAST_JS}()`, false);
    if (!info)
        throw new Error('聚焦输入元素失败');
    if (info.ok === false)
        throw new Error(String(info.error || '输入失败'));
    if (info.tag === 'SELECT') {
        await selectValue(session, text);
        return t;
    }
    await insertText(session, String(text));
    if (pressEnter)
        await dispatchEnterKey(session);
    return t;
}
/** 对上一次 resolve 命中的 select 赋值（typeAt / selectAt 内部使用）。 */
async function selectValue(session, value) {
    const result = await evaluateJson(session, `${SELECT_SET_JS}(${JSON.stringify(String(value))})`, false);
    if (!result)
        throw new Error('下拉选择失败');
    if (result.ok === false)
        throw new Error(String(result.error || '下拉选择失败'));
}
export async function selectAt(session, loc, value) {
    const t = await resolveTarget(session, loc);
    await selectValue(session, value);
    return t;
}
export async function scrollPage(session, direction, amount, selector) {
    const res = await evaluateJson(session, `${SCROLL_JS}(${JSON.stringify(direction)}, ${Number(amount) || 3}, ${JSON.stringify(selector ?? '')})`, false);
    return {
        scrollY: Number(res?.scrollY) || 0,
        scrollH: Number(res?.scrollH) || 0,
        atBottom: res?.atBottom === true,
    };
}
/** 页面内等待选择器/文本出现或消失（一次 CDP 调用，模型零额外轮次）。 */
export async function waitForCondition(session, opts) {
    const payload = JSON.stringify({
        selector: opts.selector && opts.selector !== '' ? opts.selector : undefined,
        text: opts.text && opts.text !== '' ? opts.text : undefined,
        gone: opts.gone === true,
        timeoutMs: Math.max(200, Math.min(60000, Number(opts.timeoutMs) || 10000)),
    });
    try {
        const res = await evaluateJson(session, `${WAIT_FOR_JS}(${payload})`, true);
        if (!res)
            return { ok: false, error: '等待失败：页面无响应' };
        return { ok: res.ok === true, error: res.error ? String(res.error) : undefined, label: res.label ? String(res.label) : undefined };
    }
    catch (e) {
        // 等待期间发生导航 → 上下文销毁，交由调用方按导航处理
        return { ok: false, error: `等待期间页面发生导航（${String(e?.message || e).slice(0, 80)}）` };
    }
}
/** 提取页面/元素正文与链接（读内容场景比 snapshot 省 token）。 */
export async function extractContent(session, selector, maxChars = 6000) {
    const res = await evaluateJson(session, `${EXTRACT_JS}(${JSON.stringify(selector ?? '')}, ${Math.max(200, Math.min(40000, Number(maxChars) || 6000))})`, false);
    if (!res)
        return { ok: false, error: '提取失败：页面无响应' };
    if (res.ok === false)
        return { ok: false, error: String(res.error || '提取失败') };
    return {
        ok: true,
        url: String(res.url || ''),
        title: String(res.title || ''),
        text: String(res.text || ''),
        total: Number(res.total) || 0,
        truncated: res.truncated === true,
        links: Array.isArray(res.links) ? res.links : [],
    };
}
//# sourceMappingURL=snapshot.js.map