/**
 * shiki stub —— client 侧代码高亮已移除（性能优先）。
 *
 * 原实现引用 shiki/core + shiki/engine/javascript + 28 个 @shikijs/langs +
 * 2 个主题（codeSplitting:false 下全部内联，约 1.5MB+ 启动即解析）。
 * 现改为零依赖 stub：
 *
 *  - SHIKI_LANGUAGES 恒为空数组 → markstream 的代码块组件判定「无可用语言」，
 *    代码块走纯文本渲染（无高亮、无语言标签）；
 *  - createHighlighter 返回假高亮器 → stream-markdown 的动态 import("shiki")
 *    （被 tsdown 挂钩替换到本文件）即使被触达也只产出纯文本 token，不崩。
 *
 * host 半身（src/markdown-html.ts，node 侧）仍用真 shiki 做服务端渲染，
 * 故 package.json 的 shiki / @shikijs/langs / @shikijs/themes 依赖保留。
 */

export const SHIKI_LANGUAGES: readonly string[] = []

interface StubToken {
  content: string
  color?: string
  fontStyle?: number
}

/** 按行切成纯文本 token（每行一个无样式 token，渲染时保留原文）。 */
function plainTokens(code: string): StubToken[][] {
  return String(code ?? '')
    .split('\n')
    .map((line) => [{ content: line }])
}

export async function createHighlighter(): Promise<unknown> {
  return {
    codeToTokens(code: string) {
      return { tokens: plainTokens(code) }
    },
    codeToThemedTokens(code: string) {
      return plainTokens(code)
    },
    codeToHtml(code: string) {
      return String(code ?? '').split('\n').map((line) => `<span>${line}</span>`).join('\n')
    },
    getTheme() {
      return undefined
    },
    dispose(): void {
      // 无操作
    },
    loadLanguage(): Promise<void> {
      return Promise.resolve()
    },
    loadTheme(): Promise<void> {
      return Promise.resolve()
    },
  }
}
