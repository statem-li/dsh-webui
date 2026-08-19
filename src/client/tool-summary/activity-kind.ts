/**
 * Fine-grained activity classification for tool-call rows.
 *
 * `classifyActivity` in tool-stats.ts already buckets a call into the coarse
 * live-activity axes (`download` / `command` / `other`) used for progress UI.
 * This module answers a different question: WHAT does this call actually do?
 * It turns one call into a short labelled badge (key + text + stable color
 * key; the vector glyph lives in icons.tsx) so a shell command like
 * `git push` reads as「⬆️ 推送」instead of a generic `pwsh` row.
 *
 * Priority order (most specific signal wins):
 *   1. The shell command text (terminal card title / `command` arg) — so
 *      `git push`, `npm install`, `cargo build`… get their own badge.
 *   2. The tool name / name prefix (read, grep, browser_*, memory_*, …).
 *   3. The generic `callView.kind` (read/edit/search/fetch/…), or a diff card.
 *   4. Fallbacks: `command` for an unrecognised shell command, `other` otherwise.
 */

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

/** A badge the drawer renders beside a tool row: key + label (+ SVG glyph via icons.tsx). */
export interface ActivityKind {
  readonly key: string
  readonly label: string
}

function kind(key: string, label: string): ActivityKind {
  return { key, label }
}

/** Every badge the drawer can show. `key` doubles as the CSS `data-kind` value. */
const K = {
  gitPush: kind('git-push', '推送'),
  gitCommit: kind('git-commit', '提交'),
  gitPull: kind('git-pull', '拉取'),
  gitClone: kind('git-clone', '克隆'),
  git: kind('git', 'Git'),
  gh: kind('gh', 'GitHub'),
  install: kind('install', '安装'),
  build: kind('build', '构建'),
  test: kind('test', '测试'),
  run: kind('run', '运行'),
  read: kind('read', '读取'),
  write: kind('write', '写入'),
  edit: kind('edit', '编辑'),
  delete: kind('delete', '删除'),
  search: kind('search', '搜索'),
  fetch: kind('fetch', '抓取'),
  download: kind('download', '下载'),
  browser: kind('browser', '浏览器'),
  image: kind('image', '生图'),
  vision: kind('vision', '识图'),
  memory: kind('memory', '记忆'),
  todo: kind('todo', '待办'),
  subagent: kind('subagent', '子代理'),
  question: kind('question', '询问'),
  command: kind('command', '命令'),
  other: kind('other', '工具'),
} as const

/** Exact tool-name → badge (names with no shell command to inspect). */
const TOOL_BADGE: Readonly<Record<string, ActivityKind>> = {
  read: K.read,
  write: K.write,
  edit: K.edit,
  grep: K.search,
  glob: K.search,
  search: K.search,
  web_search: K.search,
  web_fetch: K.fetch,
  generate_image: K.image,
  vision_describe: K.vision,
  todo_write: K.todo,
  ask_user_question: K.question,
  create_goal: K.todo,
  update_goal: K.todo,
  get_goal: K.todo,
  workflow: K.subagent,
  ralph: K.subagent,
  // Shell tools: when a command string is present it wins; these are the
  // fallback for an empty command.
  bash: K.command,
  sh: K.command,
  pwsh: K.command,
  powershell: K.command,
  cmd: K.command,
  zsh: K.command,
  fish: K.command,
}

/** `callView.card === 'generic'` `kind` → badge, as a safety net for unnamed tools. */
const GENERIC_KIND_BADGE: Readonly<Record<string, ActivityKind>> = {
  read: K.read,
  edit: K.edit,
  delete: K.delete,
  move: K.edit,
  search: K.search,
  execute: K.command,
  fetch: K.fetch,
  other: K.other,
}

/** Raw args string of a running-or-settled call. */
function rawOf(block: ToolCallBlock): string {
  return 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
}

/** Tool name of a running-or-settled call. */
function nameOf(block: ToolCallBlock): string {
  return 'kind' in block ? (block.call?.name ?? '') : block.name
}

/**
 * The shell command a call represents, when there is one: the terminal card
 * title (a foreground command), else a parsed `command` argument.
 */
function commandText(block: ToolCallBlock): string {
  const view = block.callView
  if (view !== null && view.card === 'terminal') return view.title ?? ''
  const raw = rawOf(block)
  if (raw === '') return ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return ''
    const command = (parsed as Record<string, unknown>).command
    return typeof command === 'string' ? command : ''
  } catch {
    return ''
  }
}

/** Map an explicit tool name (or prefix family) to a badge. */
function classifyToolName(name: string): ActivityKind | undefined {
  if (name === '') return undefined
  const lower = name.toLowerCase()
  const exact = TOOL_BADGE[lower]
  if (exact !== undefined) return exact
  if (lower.startsWith('browser')) return K.browser
  if (lower.startsWith('memory')) return K.memory
  if (lower.startsWith('subagent')) return K.subagent
  return undefined
}

/** Classify a shell command string into a specific badge (falls back to `command`). */
function classifyCommand(text: string): ActivityKind {
  const cmd = text.trim().replace(/^[$>]\s*/, '')
  if (cmd === '') return K.command

  // ── git ──
  let m = /^git\s+(\S+)/i.exec(cmd)
  if (m !== null) {
    const sub = (m[1] ?? '').toLowerCase()
    if (sub === 'push') return K.gitPush
    if (sub === 'commit') return K.gitCommit
    if (sub === 'pull' || sub === 'fetch') return K.gitPull
    if (sub === 'clone') return K.gitClone
    return K.git
  }

  // ── GitHub CLI ──
  if (/^gh\b/i.test(cmd)) return K.gh

  // ── package managers ──
  m = /^(npm|pnpm|yarn|bun)\s+(\S+)/i.exec(cmd)
  if (m !== null) {
    const sub = (m[2] ?? '').toLowerCase()
    if (sub === 'install' || sub === 'i' || sub === 'add') return K.install
    if (sub === 'remove' || sub === 'uninstall' || sub === 'rm') return K.install
    if (sub === 'build' || sub === 'compile') return K.build
    if (sub === 'test' || sub === 't') return K.test
    if (sub === 'dev' || sub === 'start' || sub === 'serve' || sub === 'preview') return K.run
    if (sub === 'run') {
      const rest = cmd.slice((m[0] ?? '').length)
      if (/\b(build|compile|bundle)\b/i.test(rest)) return K.build
      if (/\b(test|vitest|jest|playwright|cypress|mocha)\b/i.test(rest)) return K.test
      return K.run
    }
    return K.command
  }
  if (/^npx\b/i.test(cmd)) return K.run

  // ── downloads ──
  if (/^(curl|wget)\b/i.test(cmd)) return K.download

  // ── build / test toolchains ──
  if (/^(tsc|vite|webpack|esbuild|rollup|make|cmake|cargo|go|dotnet)\b/i.test(cmd)) {
    if (/\b(build|compile|bundle)\b/i.test(cmd)) return K.build
    if (/\b(test)\b/i.test(cmd)) return K.test
    return K.run
  }
  if (/\b(build|compile|bundle|transpile)\b/i.test(cmd)) return K.build
  if (/\b(vitest|jest|pytest|mocha|playwright|cypress)\b/i.test(cmd)) return K.test
  if (/^(node|python|python3|tsx|ts-node|deno)\b/i.test(cmd)) return K.run

  return K.command
}

/** The badge a tool-call row should display. */
export function classifyKind(block: ToolCallBlock): ActivityKind {
  const command = commandText(block)
  if (command !== '') return classifyCommand(command)

  const byName = classifyToolName(nameOf(block))
  if (byName !== undefined) return byName

  const view = block.callView
  if (view !== null) {
    if (view.card === 'diff') return K.write
    if (view.card === 'generic' && view.kind !== undefined) {
      const mapped = GENERIC_KIND_BADGE[view.kind]
      if (mapped !== undefined) return mapped
    }
  }
  return K.other
}

/** Distinct badges among a list of blocks, in first-seen order. */
export function distinctKinds(blocks: readonly ToolCallBlock[]): ActivityKind[] {
  const seen = new Set<string>()
  const out: ActivityKind[] = []
  for (const block of blocks) {
    const badge = classifyKind(block)
    if (seen.has(badge.key)) continue
    seen.add(badge.key)
    out.push(badge)
  }
  return out
}

/** Map each tool NAME appearing in the list to its most common badge (for summary chips). */
export function kindByToolName(blocks: readonly ToolCallBlock[]): Map<string, ActivityKind> {
  const map = new Map<string, ActivityKind>()
  for (const block of blocks) {
    const name = nameOf(block)
    if (name === '' || map.has(name)) continue
    map.set(name, classifyKind(block))
  }
  return map
}
