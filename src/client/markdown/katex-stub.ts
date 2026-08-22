/**
 * katex stub —— 数学公式渲染已从 webui 移除后的占位实现。
 *
 * markstream-react 将 katex 声明为 peerDependency，其 katexRenderer worker
 * 会静态 import 'katex' 与 'katex/contrib/mhchem'（副作用）。webui 自身源码
 * 不引用 katex，此 stub 让公式渲染在运行时优雅失败：renderToString 抛错 →
 * worker catch → 降级显示原始 LaTeX 文本，不崩溃。
 *
 * 由 tsdown 的 resolveId 挂钩替换（见 tsdown.config.ts webui-code-block-dependencies）。
 */

class ParseError extends Error {}

const stub = {
  ParseError,
  renderToString(): string {
    throw new Error('katex disabled in webui')
  },
  render(): never {
    throw new Error('katex disabled in webui')
  },
  __parse(): never {
    throw new Error('katex disabled in webui')
  },
}

export default stub
