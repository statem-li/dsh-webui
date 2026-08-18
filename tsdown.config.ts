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

/** 判断一个模块是否应 external（支持 `scope/*` glob 与精确名）。 */
function isExternal(id: string): boolean {
  return CLIENT_EXTERNALS.some(ext => ext.endsWith('/*') ? id.startsWith(ext.slice(0, -1)) : id === ext)
}

// CSS 内联约定：把 .css 变成「注入 <style> 标签」的 JS（与原 dsh-better-markdown 一致）。
const CSS_PREFIX = '\0webui-css:'
const CSS_SUFFIX = '.mjs'
const STREAM_MONACO_STUB = '\0webui-stream-monaco-stub'

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
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (id: string) => !isExternal(id),
  },
  plugins: [{
    name: 'webui-code-block-dependencies',
    resolveId(source) {
      if (source === 'shiki') return resolve('src/client/markdown/shiki.ts')
      if (source === 'stream-monaco') return STREAM_MONACO_STUB
      return null
    },
    load(id) {
      return id === STREAM_MONACO_STUB ? 'export {}' : null
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
  },
}

export default [hostBundle, clientBundle] satisfies UserConfig[]
