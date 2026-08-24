/**
 * webui — MOOD 卡片（client 半身）。
 *
 * 模型在正式回答之前输出的 ```mood 围栏由本组件渲染：一行 MOOD 标头 + 一块
 * 左侧竖线面板，面板内按「小节名: / - 条目」分节。小节名不做白名单——host 的
 * 人设模板给的是 Vibe/Sparks/Reflections/Will，但用户把人设改成任何小节名都能
 * 正常显示。
 *
 * **默认折叠**：只显示一枚 MOOD chip（星标 + 首节摘要 + 条目数），点击展开面板。
 * 折叠态**不渲染面板 DOM**（不是 display:none）——长会话里每条回复都可能带一张
 * MOOD，真实挂载几十个面板既费内存也拖累滚动；折叠是默认态，所以默认零成本。
 * 折叠状态是每张卡的局部状态，不做持久化：卡片被滚动虚拟化重挂载后回到折叠，
 * 与「默认折叠」本就一致，省掉一份 localStorage 读写。
 *
 * 性能：纯文本解析（单次 split + 逐行判断，无正则回溯、无 DOM 测量、无副作用），
 * useMemo 按源码缓存；流式过程中也保持折叠，不产生逐 token 重排。
 */
import { memo, useCallback, useMemo, useState } from 'react'
import type { CodeBlockNode } from 'stream-markdown-parser'

/** 被识别为 MOOD 的围栏语言。 */
const MOOD_LANGS = new Set(['mood'])

/** 模块开关（webui-modules 的 mood 键）：关闭时回落成普通代码块。 */
let enabled = true

/** 设定 MOOD 卡片是否启用（由 client/index.ts 启动时设定一次）。 */
export function setMoodEnabled(value: boolean): void {
  enabled = value
}

/** 某个围栏语言是否走 MOOD 渲染。 */
export function isMoodLang(language: string | undefined): boolean {
  if (!enabled) return false
  if (language === undefined || language === '') return false
  return MOOD_LANGS.has(language.trim().toLowerCase())
}

/**
 * 一个小节：名字 + 同行余文（inline）+ 换行后的条目列表。
 * inline 与 items 分开，是为了让「Vibe: 一句话」保持一行，而
 * 「Sparks:」下面的多条保持带项目符号的列表形态。
 */
interface MoodSection {
  readonly name: string
  readonly inline: string
  readonly items: readonly string[]
}

/** 小节名最长字数（超过就当正文，避免把长句误判成小节名）。 */
const MAX_NAME_CHARS = 24

/**
 * 把围栏文本解析成小节序列。规则（逐行）：
 *  - `名字:` / `名字：`（名字 ≤24 字、不以项目符号开头）→ 开新小节，
 *    冒号后的余文作该小节的 inline 文本；
 *  - 其余非空行 → 当前小节的一个条目（行首的 `- ` / `* ` / `•` 剥掉）；
 *  - 尚未开小节时先开一个无名小节承接。
 */
function parseMood(source: string): readonly MoodSection[] {
  const sections: Array<{ name: string, inline: string, items: string[] }> = []
  let current: { name: string, inline: string, items: string[] } | undefined
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const colon = line.search(/[:：]/)
    const head = colon > 0 ? line.slice(0, colon).trim() : ''
    if (colon > 0 && head.length <= MAX_NAME_CHARS && !/^[-*•]/.test(head)) {
      current = { name: head, inline: line.slice(colon + 1).trim(), items: [] }
      sections.push(current)
      continue
    }
    if (current === undefined) {
      current = { name: '', inline: '', items: [] }
      sections.push(current)
    }
    current.items.push(line.replace(/^[-*•]\s*/, ''))
  }
  return sections
}

/** MOOD 标头的星形标记（与官方图标同一线宽语言）。 */
function MoodMark(): JSX.Element {
  return (
    <svg className="dsh-mood__mark" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M6 1v10M1.7 3.5l8.6 5M10.3 3.5l-8.6 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 展开/折叠指示的折角箭头（折叠 → 指右，展开 → 指下，用 CSS 旋转）。 */
function MoodChevron(): JSX.Element {
  return (
    <svg className="dsh-mood__chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M3.5 1.5L7 5l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** 折叠态 chip 上的一行摘要：首节的 inline 文本，退而取首节第一条。 */
function summarize(sections: readonly MoodSection[]): string {
  const first = sections[0]
  if (first === undefined) return ''
  if (first.inline !== '') return first.inline
  return first.items[0] ?? ''
}

/** 条目总数（含各节 inline），折叠态显示成「· N 条」。 */
function countItems(sections: readonly MoodSection[]): number {
  let total = 0
  for (const section of sections) {
    if (section.inline !== '') total += 1
    total += section.items.length
  }
  return total
}

/**
 * 一张 MOOD 卡片，**默认折叠**：折叠态是一枚 chip（星标 + MOOD + 首节摘要 +
 * 条目数），点击展开面板。折叠时面板整段不进 DOM。
 */
export const MoodBlock = memo(function MoodBlock({ node }: {
  readonly node: CodeBlockNode
  /** markstream 会额外透传若干 props，此处忽略。 */
  readonly [key: string]: unknown
}) {
  const source = node.code ?? node.raw ?? ''
  const streaming = node.loading === true
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => { setOpen(value => !value) }, [])

  // 折叠态只需要摘要与条目数，但两者都来自同一次解析——解析本身是纯字符串
  // 扫描，比「折叠时跳过解析」再在展开瞬间补算更平滑（避免展开有一帧空白）。
  const sections = useMemo(() => parseMood(source), [source])
  const summary = useMemo(() => summarize(sections), [sections])
  const count = useMemo(() => countItems(sections), [sections])

  const empty = sections.length === 0
  const label = streaming && empty ? 'MOOD 写入中…' : 'MOOD'

  return (
    <section className="dsh-mood" data-streaming={streaming || undefined} data-open={open || undefined}>
      <button
        type="button"
        className="dsh-mood__chip"
        aria-expanded={open}
        title={open ? '收起 MOOD' : '展开 MOOD'}
        onClick={toggle}
      >
        <MoodMark />
        <span className="dsh-mood__title">{label}</span>
        {!open && summary !== '' && <span className="dsh-mood__summary">{summary}</span>}
        {!open && count > 1 && <span className="dsh-mood__count">· {count} 条</span>}
        <MoodChevron />
      </button>
      {open && (
        <div className="dsh-mood__panel">
          {empty && (
            <p className="dsh-mood__pending">{streaming ? '…' : '（本轮没有写 MOOD）'}</p>
          )}
          {sections.map((section, index) => (
            <div className="dsh-mood__section" key={String(index) + section.name}>
              {section.name !== '' && (
                <p className="dsh-mood__name">
                  {section.name}:
                  {section.inline !== '' && <span className="dsh-mood__inline"> {section.inline}</span>}
                </p>
              )}
              {section.name === '' && section.inline !== '' && (
                <p className="dsh-mood__item">{section.inline}</p>
              )}
              {section.items.map((item, itemIndex) => (
                <p className="dsh-mood__item" key={itemIndex}>{item}</p>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
})
