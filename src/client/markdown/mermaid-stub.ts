/**
 * mermaid stub —— 图表渲染已从 webui 移除后的占位实现。
 *
 * markstream-react 将 mermaid 声明为 peerDependency，其 mermaidParser worker
 * 与 MermaidBlockNode 会静态 import 'mermaid'。若不在构建时替换，tsdown 会把
 * mermaid 全家（core + 全部 diagram 类型 + d3 家族 + dagre-d3-es +
 * vscode-languageserver-protocol，约 2MB+）内联进 client bundle，启动即占内存。
 *
 * 此 stub 由 tsdown 的 resolveId 挂钩（见 tsdown.config.ts webui-code-block-dependencies）
 * 替换 'mermaid' 裸导入：保持模块表面（initialize/parse/render），运行时优雅降级：
 *  - parse 一律失败 → markstream 判定「不可解析」，mermaid 围栏按普通代码块展示；
 *  - render 返回占位卡片，避免解构 .svg 时崩溃。
 */

interface MermaidRenderResult {
  svg: string
  bindFunctions: () => void
}

const FALLBACK_SVG = (id: string) =>
  `<div id="${id}" style="padding:12px;border:1px solid var(--dsw-alias-border, #333);`
  + `border-radius:8px;color:var(--dsw-alias-fg-2, #999);font-size:12px">`
  + `mermaid 图表渲染已从 webui 移除（显示为占位）</div>`

const stub = {
  initialize(): void {
    // 无操作：worker 顶层调用 t.initialize({...})，忽略即可
  },
  parse(): Promise<never> {
    return Promise.reject(new Error('mermaid disabled in webui'))
  },
  render(id: string): Promise<MermaidRenderResult> {
    return Promise.resolve({ svg: FALLBACK_SVG(id), bindFunctions() {} })
  },
  setConfig(): void {
    // 无操作
  },
  getConfig(): Record<string, unknown> {
    return {}
  },
  registerExternalDiagrams(): void {
    // 无操作
  },
}

export default stub
