/**
 * webui — 原始 HTML 片段净化（host 截图管线与 client 消息渲染共用）。
 *
 * 策略与 markstream 的 trusted 档对齐：渲染标准标签并保留内联样式与表格布局，
 * 同时剔除结构性风险标签、剥事件属性、URL 协议白名单、消毒 style 值。
 * 纯字符串实现（无 DOM / Node 依赖），host 与 client 两个 bundle 均可内联。
 */

/** 连同内容整块剔除的标签（无交互场景下只会带来加载/注入风险）。 */
const HARDENED_PAIR_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base',
  'template', 'applet', 'frame', 'frameset', 'noscript', 'svg', 'math',
  'audio', 'video', 'source',
])

/** 只删标签保留内容的标签（表单/控件）：静态展示场景控件毫无意义。 */
const SOFT_STRIP_TAGS = new Set([
  'button', 'textarea', 'select', 'option', 'optgroup', 'fieldset', 'legend',
  'dialog', 'datalist', 'output', 'param', 'track', 'label', 'progress', 'meter',
  'canvas', 'map', 'area',
])

/** HTML void 元素（无内容、无闭合标签）。 */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

/** style 值里的危险模式（命中即整属性丢弃）。 */
const DANGEROUS_STYLE_RE = /(javascript:|vbscript:|expression\s*\(|@import|behavior\s*:|-moz-binding|url\s*\(\s*(?:javascript:|vbscript:|data:\s*text\/html))/i

/** URL 协议白名单：href 系 http/https/mailto；src 系 http/https + data:image 位图。 */
function safeUrl(value: string, context: 'href' | 'src'): string {
  const url = value.trim()
  if (url === '') return ''
  try {
    const protocol = new URL(url).protocol.toLowerCase()
    if (protocol === 'http:' || protocol === 'https:') return url
    if (protocol === 'mailto:' && context === 'href') return url
    // data:image 位图仅允许出现在 src（支持模型输出的 base64 图）。
    if (context === 'src' && /^data:image\/(?:png|gif|jpe?g|webp|avif|bmp);/i.test(url)) return url
    return ''
  } catch {
    // 锚点/相对链接由浏览器原样解析（无害），其余协议拒绝。
    if (url.startsWith('#') || url.startsWith('?') || url.startsWith('/')
      || url.startsWith('./') || url.startsWith('../')) return url
    return ''
  }
}

/** 属性值转义（双引号包裹时使用；引号本身转义，不允许属性逃逸）。 */
function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('`', '&#96;')
}

/** 单个属性消毒：返回可直接拼接的 ` name="value"` 或 null（剔除）。 */
function cleanAttr(name: string, value: string, tagName: string): string | null {
  const lower = name.toLowerCase()
  if (lower === '' || !/^[a-zA-Z_:][\w:.-]*$/.test(name)) return null
  if (/^on/i.test(lower)) return null
  if (lower === 'srcdoc' || lower === 'ping' || lower === 'innerhtml'
    || lower === 'outerhtml' || lower === 'textcontent' || lower === 'innertext') return null
  if (lower === 'style') {
    return DANGEROUS_STYLE_RE.test(value) ? null : ` style="${escapeAttr(value)}"`
  }
  if (lower === 'href' || lower === 'xlink:href') {
    const url = safeUrl(value, 'href')
    return url === '' ? null : ` ${name}="${escapeAttr(url)}"`
  }
  // 无提交语义：action/formaction/srcset 一律剔除。
  if (lower === 'action' || lower === 'formaction' || lower === 'srcset') return null
  if (lower === 'src' || lower === 'poster') {
    const url = safeUrl(value, 'src')
    return url === '' ? null : ` ${name}="${escapeAttr(url)}"`
  }
  if (lower === 'target' && tagName === 'a') return ` ${name}="_blank"`
  if (lower === 'rel' && tagName === 'a') return ` ${name}="noopener noreferrer"`
  if (lower === 'referrerpolicy' && tagName === 'img') return ` ${name}="no-referrer"`
  return ` ${name}="${escapeAttr(value)}"`
}

/**
 * 净化一段原始 HTML 片段（html_block / html_inline 内容）。
 * 标签级扫描重建：危险标签连同内容剔除（栈跟踪嵌套），普通标签逐个属性消毒。
 * 任务清单的 checkbox（markdown-it-task-lists 输出）保留，其余 input 剔除。
 */
export function sanitizeHtmlFragment(html: string): string {
  let out = ''
  let pos = 0
  const dropStack: string[] = [] // 整块剔除中的危险标签栈（栈顶即最内层）
  const softStack: string[] = [] // 软删成对标签（起止皆吞、内容保留）
  const dropping = (): boolean => dropStack.length > 0
  while (pos < html.length) {
    const lt = html.indexOf('<', pos)
    if (lt === -1) {
      if (!dropping()) out += html.slice(pos)
      break
    }
    if (lt > pos && !dropping()) out += html.slice(pos, lt)
    // 注释 / CDATA：直接跳过
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      pos = end === -1 ? html.length : end + 3
      continue
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9)
      pos = end === -1 ? html.length : end + 3
      continue
    }
    const gt = html.indexOf('>', lt + 1)
    if (gt === -1) { if (!dropping()) out += html.slice(lt); break }
    const raw = html.slice(lt + 1, gt)
    const isClosing = raw.startsWith('/')
    const nameMatch = /^\/?\s*([a-zA-Z][a-zA-Z0-9_-]*)/.exec(raw)
    pos = gt + 1
    if (nameMatch === null) {
      if (!dropping()) out += html.slice(lt, gt + 1)
      continue
    }
    const tagName = nameMatch[1].toLowerCase()
    // 危险树内：只处理闭合，栈顶匹配即出栈；其余内容全部丢弃。
    if (dropping()) {
      if (isClosing && tagName === dropStack[dropStack.length - 1]) dropStack.pop()
      else if (!isClosing && HARDENED_PAIR_TAGS.has(tagName)) dropStack.push(tagName)
      continue
    }
    // 普通树内遇到危险标签：入栈并整块丢弃。
    if (HARDENED_PAIR_TAGS.has(tagName)) { dropStack.push(tagName); continue }
    // 软删标签：单标签直接丢；成对的（textarea/select 等）起止皆吞、内容保留。
    if (SOFT_STRIP_TAGS.has(tagName)) {
      const selfClosing = raw.trimEnd().endsWith('/') || VOID_TAGS.has(tagName)
      if (isClosing) { if (softStack[softStack.length - 1] === tagName) softStack.pop(); continue }
      if (selfClosing) continue
      softStack.push(tagName)
      continue
    }
    // 成对闭合标签：原样输出（属性已在上方开标签时清洗过，闭合标签无属性）。
    if (isClosing) { out += `</${tagName}>`; continue }
    if (tagName === 'input') {
      // 仅保留任务清单的 checkbox：type=checkbox 且 disabled。
      if (!/type\s*=\s*["']?checkbox/i.test(raw) || !/disabled/i.test(raw)) continue
      out += '<input type="checkbox" disabled>'
      continue
    }
    // 一般标签：属性逐个消毒后重建（先剥掉标签名，避免把标签名当属性）。
    const attrs: string[] = []
    const attrSource = raw.replace(/^\/?\s*[a-zA-Z][a-zA-Z0-9_-]*/, '')
    const attrRe = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    let m: RegExpExecArray | null
    while ((m = attrRe.exec(attrSource)) !== null) {
      const name = m[1]
      const value = m[2] ?? m[3] ?? m[4] ?? ''
      const cleaned = cleanAttr(name, value, tagName)
      if (cleaned !== null) attrs.push(cleaned)
    }
    // a 标签联动：href 保留且 target 改写为 _blank 时补 noopener/noreferrer。
    if (tagName === 'a'
      && attrs.some(a => a.startsWith(' target="_blank"'))
      && attrs.some(a => a.startsWith(' href='))
      && !attrs.some(a => a.startsWith(' rel='))) {
      attrs.push(' rel="noopener noreferrer"')
    }
    const selfClosed = raw.trimEnd().endsWith('/') || VOID_TAGS.has(tagName)
    out += selfClosed ? `<${tagName}${attrs.join('')} />` : `<${tagName}${attrs.join('')}>`
  }
  return out
}
