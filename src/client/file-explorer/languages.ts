/**
 * dsh-file-explorer — CodeMirror 6 language mapping: extension → LanguageSupport.
 * Static imports only (no dynamic language-data loaders), so tsdown inlines a
 * bounded, deterministic set of languages. Unmatched extensions fall back to
 * plain text (still editable).
 */

import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { sql } from '@codemirror/lang-sql'
import { rust } from '@codemirror/lang-rust'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { go } from '@codemirror/lang-go'
import { sass } from '@codemirror/lang-sass'
import { less } from '@codemirror/lang-less'
import type { Extension } from '@codemirror/state'

/** Lowercased final extension ('.ts', '.tsx', '') — splits on both separators. */
export function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

/** Resolve a CodeMirror language extension for a path, or null for plain text. */
export function languageForPath(path: string): Extension | null {
  switch (extOf(path)) {
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return javascript({ jsx: path.endsWith('.jsx') })
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return javascript({ typescript: true, jsx: path.endsWith('.tsx') })
    case '.py':
    case '.pyw':
      return python()
    case '.json':
    case '.jsonc':
      return json()
    case '.md':
    case '.markdown':
      return markdown()
    case '.html':
    case '.htm':
      return html()
    case '.css':
      return css()
    case '.scss':
      return sass({ indented: false })
    case '.sass':
      return sass({ indented: true })
    case '.less':
      return less()
    case '.xml':
    case '.svg':
      return xml()
    case '.yaml':
    case '.yml':
      return yaml()
    case '.sql':
      return sql()
    case '.rs':
      return rust()
    case '.c':
    case '.h':
    case '.cpp':
    case '.hpp':
    case '.cc':
    case '.cxx':
    case '.hxx':
      return cpp()
    case '.java':
      return java()
    case '.go':
      return go()
    default:
      return null
  }
}
