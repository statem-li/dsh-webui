/**
 * webui — 提示词优化结果清洗（host / client 两端共用的纯函数）。
 *
 * 模型即便被要求「只输出提示词本身」，仍常常返回：解释性开场白、围栏代码块
 * 包裹、「**优化后的提示词**」小标题、结尾的「主要改动 / 说明」段落。旧版实现
 * 把这些原样写进输入框（还会再加 /goal 前缀），草稿直接变成一坨解释文字——
 * 这是「提示词优化不行」的根因。
 *
 * 本模块把模型输出收敛成「可直接发送的提示词正文」：
 *  1. 优先取最长的围栏代码块内容（解释文字通常在围栏之外）；
 *  2. 去掉首行的标签式小标题（「优化后的提示词：」等）；
 *  3. 去掉结尾的元信息段落（「主要改动」「说明」「注：」等）；
 *  4. 去掉整体包裹的引号 / 书名号。
 *
 * 纯函数、无副作用、不抛错：任何一步无法确定就保持原样——宁可少清理，
 * 也绝不误删用户真正需要的正文。
 */

/** 围栏代码块（三反引号或三波浪号，允许缩进与语言标注）。 */
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm

/** 单条围栏行（用于识别「只写了半个围栏」的残留）。 */
const FENCE_LINE_RE = /^[ \t]*(?:`{3,}|~{3,})[^\n]*$/

/** 首行标签式小标题（可带 markdown 强调 / 井号，后接冒号或独占一行）。 */
const LABEL_RE = /^\s*[*_#>\s]*(?:优化后的?(?:提示词|prompt)|优化结果|改写后的?(?:提示词|prompt)|以下是[^\n]{0,20}(?:提示词|prompt)[^\n]{0,10}|optimi[sz]ed\s+prompt|rewritten\s+prompt|final\s+prompt)[*_\s]*[:：]?\s*$/i

/** 结尾元信息段落的起始标记（命中即整段丢弃）。 */
const TRAILING_META_RE = /^\s*[*_#>\s]*(?:主要(?:改动|变化|补充|优化|提升)|优化说明|改动说明|变更说明|说明|补充说明|注意事项|备注|注|why|changes?|notes?)\s*[:：]/i

/** 成对包裹符号（左 → 右）。 */
const WRAP_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['\u201c', '\u201d'],
  ['\u2018', '\u2019'],
  ['\u300c', '\u300d'],
  ['\u300e', '\u300f'],
  ['\u300a', '\u300b'],
]

/**
 * 取最长围栏块内容；无围栏、或围栏只占全文很小一部分（更像示例片段而非正文）
 * 时返回 null。
 */
function longestFence(text: string): string | null {
  let best: string | null = null
  FENCE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FENCE_RE.exec(text)) !== null) {
    const body = match[2] ?? ''
    if (best === null || body.length > best.length) best = body
  }
  if (best === null) return null
  const trimmed = best.trim()
  if (trimmed === '') return null
  if (trimmed.length * 4 < text.trim().length) return null
  return trimmed
}

/** 去掉首行的标签式小标题（最多剥两层：「**优化后的提示词**」+ 空行）。 */
function stripLeadingLabel(text: string): string {
  let out = text
  for (let i = 0; i < 2; i += 1) {
    const lines = out.split('\n')
    if (lines.length < 2) break
    if (!LABEL_RE.test(lines[0] ?? '')) break
    out = lines.slice(1).join('\n').replace(/^\s*\n/, '')
  }
  return out
}

/** 去掉整体包裹的引号（仅当首尾成对、且内部没有同种右符号提前闭合）。 */
function stripWrappingQuotes(text: string): string {
  const t = text.trim()
  for (const [open, close] of WRAP_PAIRS) {
    if (!t.startsWith(open) || !t.endsWith(close)) continue
    if (t.length <= open.length + close.length) continue
    const inner = t.slice(open.length, t.length - close.length)
    if (inner.includes(close)) continue
    return inner.trim()
  }
  return t
}

/** 去掉结尾的元信息段落（至少保留一段正文）。 */
function stripTrailingMeta(text: string): string {
  const blocks = text.split(/\n\s*\n/)
  if (blocks.length < 2) return text
  let end = blocks.length
  while (end > 1 && TRAILING_META_RE.test(blocks[end - 1] ?? '')) end -= 1
  if (end === blocks.length) return text
  return blocks.slice(0, end).join('\n\n').trimEnd()
}

/**
 * 去掉「只写了半个围栏」的残留行：围栏行数为奇数且首/尾行就是围栏时剥掉它。
 * 正文里成对出现的围栏（示例代码）必须原样保留，所以只处理奇数且位于两端的情况。
 */
function stripUnbalancedFence(text: string): string {
  const lines = text.split('\n')
  const fences: number[] = []
  lines.forEach((line, index) => { if (FENCE_LINE_RE.test(line)) fences.push(index) })
  if (fences.length === 0 || fences.length % 2 === 0) return text
  if (fences[0] === 0) return lines.slice(1).join('\n').trim()
  if (fences[fences.length - 1] === lines.length - 1) return lines.slice(0, -1).join('\n').trim()
  return text
}

/**
 * 清洗模型返回的优化结果，得到可直接写回输入框的提示词正文。
 * @param raw - 模型原始输出（可能含解释文字 / 围栏 / 小标题）。
 * @returns 清洗后的正文；输入为空白时返回空串。
 */
export function cleanOptimized(raw: string): string {
  const base = typeof raw === 'string' ? raw.trim() : ''
  if (base === '') return ''
  const fenced = longestFence(base)
  let out = fenced ?? base
  out = stripLeadingLabel(out)
  // 围栏内容本身就是纯正文，元信息只可能出现在围栏之外。
  if (fenced === null) out = stripTrailingMeta(out)
  out = stripWrappingQuotes(out)
  out = stripUnbalancedFence(out)
  return out
}

/**
 * 流式过程中的预览清洗：正文可能只写到一半（围栏未闭合、结尾段落还没出现），
 * 此时 `cleanOptimized` 无从判断，会把开场白一起显示。这里按「围栏行数为奇数
 * ⇒ 最后一条围栏之后就是正在生成的正文」剥掉前面的解释文字，让预览从一开始
 * 就贴近最终结果；无围栏时退回 `cleanOptimized`。
 * @param raw - 已收到的原始增量拼接。
 */
export function previewOptimized(raw: string): string {
  const base = typeof raw === 'string' ? raw.trim() : ''
  if (base === '') return ''
  const lines = base.split('\n')
  const fences: number[] = []
  lines.forEach((line, index) => { if (FENCE_LINE_RE.test(line)) fences.push(index) })
  if (fences.length % 2 === 1) {
    const last = fences[fences.length - 1] ?? 0
    const body = lines.slice(last + 1).join('\n').trim()
    if (body !== '') return body
  }
  return cleanOptimized(base)
}

/**
 * 折叠成单行（/goal 这类单行命令参数用）：逐行去掉 markdown 列表符号后用
 * 空格拼接，避免命令参数里出现裸 - / * 噪声与换行。
 * @param text - 提示词正文。
 */
export function collapseToLine(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/^\s*(?:[-*+]|\d+[.、)])\s+/, '').trim())
    .filter(line => line !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
