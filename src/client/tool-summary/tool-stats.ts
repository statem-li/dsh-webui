/**
 * Pure derivations for the tool-group summary card: call counting, per-tool
 * distribution, error/running tallies, and file-path extraction from args.
 */

import type { RunningToolCall, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'

/** Tools whose calls are pure reads — hidden from the list by default. */
export const READONLY_TOOLS = new Set([
  'read', 'grep', 'glob', 'web_search', 'web_fetch', 'search', 'ls', 'find', 'list',
])

/** Wire name of one running-or-settled call. */
export function callName(block: ToolCallBlock): string {
  return 'kind' in block ? (block.call?.name ?? '') : block.name
}

/** Is this call still running (no final result yet)? */
export function isRunning(block: ToolCallBlock): block is RunningToolCall {
  return !('kind' in block)
}

/** Extract a display/actionable path from tool args (read/edit/write/etc). */
export function argsPath(argsRaw: string): string | undefined {
  if (argsRaw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    for (const key of ['file_path', 'path', 'dir', 'url']) {
      const value = record[key]
      if (typeof value === 'string' && value !== '') return value
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Flatten the text of one settled result's content blocks. */
export function resultText(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  const parts: string[] = []
  for (const content of block.content) {
    const c = content as { type?: string; text?: string }
    if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text)
  }
  return parts.join('\n')
}

export interface ToolStat {
  readonly name: string
  readonly count: number
}

export interface ToolStats {
  /** Total calls in the group (roots only, subcalls not re-counted). */
  readonly total: number
  /** Calls still running. */
  readonly running: number
  /** Settled calls that failed. */
  readonly errors: number
  /** Per-tool distribution, descending by count. */
  readonly byTool: readonly ToolStat[]
  /** Distinct actionable paths (files/urls) mentioned by call args. */
  readonly files: readonly string[]
  /** Calls whose tool is in the read-only set. */
  readonly readOnly: number
}

/** Collapse one group's roots into summary statistics. */
export function computeStats(blocks: readonly ToolCallBlock[]): ToolStats {
  const counts = new Map<string, number>()
  const files = new Set<string>()
  let total = 0
  let running = 0
  let errors = 0
  let readOnly = 0
  for (const block of blocks) {
    const name = callName(block)
    total += 1
    counts.set(name, (counts.get(name) ?? 0) + 1)
    if (isRunning(block)) running += 1
    else if (block.isError) errors += 1
    if (READONLY_TOOLS.has(name)) readOnly += 1
    const path = argsPath('kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw)
    if (path !== undefined) files.add(path)
  }
  const byTool = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return { total, running, errors, byTool, files: [...files], readOnly }
}

/** Shorten a path against the session cwd (display only). */
export function shortenPath(path: string, cwd: string | undefined): string {
  if (cwd !== undefined && cwd !== '' && path.startsWith(cwd)) {
    const rest = path.slice(cwd.length).replace(/^[\\/]+/, '')
    return rest === '' ? path : rest
  }
  return path
}

/** One-line summary of a call for the generic fallback row. */
export function callSummary(block: ToolCallBlock): string {
  const name = callName(block)
  const raw = 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
  if (raw === '') return name
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return `${name} · ${raw}`
    const record = parsed as Record<string, unknown>
    for (const key of ['file_path', 'path', 'command', 'url', 'pattern']) {
      const value = record[key]
      if (typeof value === 'string' && value !== '') return value
    }
    return `${name} · ${raw.slice(0, 80)}`
  } catch {
    return `${name} · ${raw.slice(0, 80)}`
  }
}

/** Format an elapsed millisecond duration for compact display. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--'
  const seconds = ms / 1000
  if (seconds < 1) return `${Math.round(ms)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  return `${minutes}m ${rest.toString().padStart(2, '0')}s`
}

/** Elapsed duration of one tool call: live for running, settled span otherwise. */
export function callDurationMs(block: ToolCallBlock, now: number): number | undefined {
  if (isRunning(block)) return Math.max(0, now - block.time)
  if (block.callTime === null) return undefined
  return Math.max(0, block.time - block.callTime)
}

/** Long-running activity a call represents, used for live status labels. */
export type ToolActivity = 'download' | 'command' | 'other'

/** Classify one call into a coarse live-activity bucket. */
export function classifyActivity(block: ToolCallBlock): ToolActivity {
  const name = callName(block)
  const raw = 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
  // 下载：显式下载工具，或 shell 命令里在抓取文件。
  if (/download/i.test(name) || /(^|\s)(curl|wget)\b/i.test(raw)) return 'download'
  const view = block.callView
  if (view !== null && view.card === 'terminal') return 'command'
  if (view !== null && view.card === 'generic' && view.kind === 'execute') return 'command'
  if (/^(bash|sh|pwsh|powershell|cmd|zsh)$/i.test(name)) return 'command'
  return 'other'
}

/** 一个下载调用的展示信息：来源 URL + 保存路径。 */
export interface DownloadInfo {
  readonly url: string
  readonly output: string
}

/** 从 curl/wget 命令参数解析下载 URL 与保存路径（都拿不到返回 undefined）。 */
export function parseDownload(block: ToolCallBlock): DownloadInfo | undefined {
  const raw = 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
  if (raw === '') return undefined
  // 保存路径：curl -o/--output，wget -O/--output-document（支持引号包裹）。
  let output = ''
  const out = /(?:--output-document|--output|-o|-O)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(raw)
  if (out !== null) output = out[1] ?? out[2] ?? out[3] ?? ''
  // 下载地址：最后一个 http(s):// 参数。
  let url = ''
  const urls = raw.match(/https?:\/\/[^\s"']+/gi)
  if (urls !== null && urls.length > 0) url = urls[urls.length - 1] ?? ''
  if (url === '' && output === '') return undefined
  return { url, output }
}
