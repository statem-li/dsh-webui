/**
 * webui — 无官方类型的 markdown-it 插件声明（host 端）。
 */
declare module 'markdown-it-emoji' {
  import type MarkdownIt from 'markdown-it'
  interface EmojiOptions {
    defs?: Record<string, string>
    shortcuts?: Record<string, string | string[]>
    enabled?: string[]
  }
  export function bare(md: MarkdownIt, options?: EmojiOptions): void
  export function light(md: MarkdownIt, options?: EmojiOptions): void
  export function full(md: MarkdownIt, options?: EmojiOptions): void
}

declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'
  interface TaskListOptions {
    enabled?: boolean
    label?: boolean
    labelAfter?: boolean
  }
  const plugin: (md: MarkdownIt, options?: TaskListOptions) => void
  export default plugin
}
