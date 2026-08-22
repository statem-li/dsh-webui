import { existsSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = '@dsh-external/dsh-webui'

/**
 * 平台模块（loader 模块表可应答）：react 全家桶 + 全部 @deepseek-ai/* 平台包。
 * 其余依赖（markstream-react / shiki / mermaid / katex 等）全部内联进 bundle。
 */
const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/*',
  '@terrastruct/d2',
  '@antv/infographic',
]

/**
 * @deepseek-ai/dsh-client-schema-form 特例：DSH 宿主的 client 模块表
 * （seed word / boot graph / package factory）当前不含该包——宿主升级后 seed 漂移，
 * 运行时 require 会抛 "missed the module table"。其 lib 是自包含 ESM（零外部依赖），
 * 故直接内联进 client bundle，不再向宿主请求该模块。
 */
const SCHEMA_FORM = '@deepseek-ai/dsh-client-schema-form'

/** 判断一个模块是否应 external（支持 `scope/*` glob 与精确名）。 */
function isExternal(id: string): boolean {
  if (id === SCHEMA_FORM) return false
  return CLIENT_EXTERNALS.some(ext => ext.endsWith('/*') ? id.startsWith(ext.slice(0, -1)) : id === ext)
}

/**
 * 定位 schema-form 的 ESM 入口（只读引用 DSH checkout，绝不修改）。
 * 1) 优先 build.sh 已 link 的 node_modules junction，realpath 还原 checkout 真实路径；
 * 2) 回退 DSH_CHECKOUT 环境变量。
 */
function resolveSchemaFormEntry(): string {
  const linked = resolve('node_modules', ...SCHEMA_FORM.split('/'), 'lib', 'index.js')
  try { return realpathSync(linked) } catch { /* junction 未建或已断 */ }
  const checkout = process.env.DSH_CHECKOUT
  if (checkout) {
    const direct = resolve(checkout, 'packages/client/schema-form/lib/index.js')
    if (existsSync(direct)) return direct
  }
  throw new Error(`[webui] cannot locate ${SCHEMA_FORM} entry (run scripts/build.sh to link, or set DSH_CHECKOUT)`)
}

const SCHEMA_FORM_ENTRY = resolveSchemaFormEntry()

// CSS 内联约定：把 .css 变成「注入 <style> 标签」的 JS（与原 dsh-better-markdown 一致）。
const CSS_PREFIX = '\0webui-css:'
const CSS_SUFFIX = '.mjs'
const STREAM_MONACO_STUB = '\0webui-stream-monaco-stub'
const KATEX_MHCHEM_STUB = '\0webui-katex-mhchem-stub'
const SHIKI_STREAM_STUB = '\0webui-shiki-stream-stub'
const RAW_PREFIX = '\0webui-raw:'

const clientBundle: UserConfig = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  deps: {
    neverBundle: [
      'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
      // 所有 @deepseek-ai/* 平台包保持 external，唯独排除 schema-form（内联）
      /^@deepseek-ai\/(?!dsh-client-schema-form$)/,
      '@terrastruct/d2',
      '@antv/infographic',
    ],
    alwaysBundle: (id: string) => !isExternal(id),
  },
  plugins: [{
    name: 'webui-schema-form-inline',
    resolveId(source) {
      if (source === SCHEMA_FORM) return SCHEMA_FORM_ENTRY
      return null
    },
  }, {
    name: 'webui-code-block-dependencies',
    resolveId(source) {
      if (source === 'shiki') return resolve('src/client/markdown/shiki.ts')
      // markstream-react 把 mermaid 当 peerDependency 静态 import；图表渲染已移除，
      // 用 stub 替换，避免 mermaid 全家（d3/dagre/vscode-lsp 等 ~2MB）内联进 bundle。
      if (source === 'mermaid') return resolve('src/client/markdown/mermaid-stub.ts')
      // katex 同理：webui 自身不引用，公式渲染走 stub 优雅降级（含 mhchem 副作用导入）。
      if (source === 'katex') return resolve('src/client/markdown/katex-stub.ts')
      if (source === 'katex/contrib/mhchem') return KATEX_MHCHEM_STUB
      // stream-markdown 动态 import("shiki-stream") 做流式高亮；高亮已移除，空 stub。
      if (source === 'shiki-stream') return SHIKI_STREAM_STUB
      if (source === 'stream-monaco') return STREAM_MONACO_STUB
      return null
    },
    load(id) {
      if (id === STREAM_MONACO_STUB || id === KATEX_MHCHEM_STUB || id === SHIKI_STREAM_STUB) return 'export {}'
      return null
    },
  }, {
    name: 'webui-css',
    async resolveId(source, importer) {
      if (!source.endsWith('.css')) return null
      if (source.startsWith('.')) {
        if (importer === undefined) return null
        return CSS_PREFIX + resolve(dirname(importer), source) + CSS_SUFFIX
      }
      return CSS_PREFIX + fileURLToPath(import.meta.resolve(source)) + CSS_SUFFIX
    },
    async load(id) {
      if (!id.startsWith(CSS_PREFIX)) return null
      const path = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      const css = await readFile(path, 'utf8')
      const tagId = `${PLUGIN_ID}/${basename(path)}`
      return [
        `const tagId = ${JSON.stringify(tagId)};`,
        'if (document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {',
        '  const tag = document.createElement("style");',
        `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        `  tag.textContent = ${JSON.stringify(css)};`,
        '  document.head.appendChild(tag);',
        '}',
      ].join('\n')
    },
  }, {
    name: 'webui-raw',
    async resolveId(source, importer) {
      if (!source.endsWith('?raw')) return null
      const clean = source.slice(0, -'?raw'.length)
      if (clean.startsWith('.')) {
        if (importer === undefined) return null
        return RAW_PREFIX + resolve(dirname(importer), clean)
      }
      return RAW_PREFIX + fileURLToPath(import.meta.resolve(clean))
    },
    async load(id) {
      if (!id.startsWith(RAW_PREFIX)) return null
      const path = id.slice(RAW_PREFIX.length)
      const text = await readFile(path, 'utf8')
      return `export default ${JSON.stringify(text)}`
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PLUGIN_ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}

/** 宿主自包含打包：host 半身零外部依赖（node: 内置模块保持 external）。 */
const hostBundle: UserConfig = {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    alwaysBundle: (id: string) => !id.startsWith('node:'),
  },
  outputOptions: {
    entryFileNames: 'index.js',
    // 禁用分包：index.ts 里的动态 import（如 dsh-usage-skill）若分 chunk，
    // 会产生 lib-*.mjs 额外产物；GitHub 源若漏提交这些 chunk，动态 import 会 404。
    // 内联成单个自包含 index.js，避免「源码装完缺运行时 chunk」的崩溃。
    codeSplitting: false,
  },
}

export default [hostBundle, clientBundle] satisfies UserConfig[]
