/**
 * webui — 插件增量更新的纯函数内核：unified diff 解析 / 应用 + git blob 校验。
 *
 * 为什么要自己应用补丁：插件的更新目标是「已安装的包目录」（pnpm 装出来的
 * node_modules 里那份），它不是 git 仓库、机器上也不一定有 git。整包重装要
 * 下 ~4.7 MB tarball，而一次发布的实际改动经 gzip 只有几百 KB——差一个数量级。
 * 于是走「下载 GitHub compare 的 unified diff → 本地逐文件打补丁 → 用 git
 * blob sha 逐文件校验」的路线，纯 JS 实现，零外部依赖、零 git 依赖。
 *
 * 正确性靠校验兜底：每个打完补丁的文件都要算 git blob sha 并与目标提交的
 * 树对照，任何一处不符（上下文漂移、二进制补丁、换行语义差异）都判为失败并
 * 交给调用方回退到「整文件下载」或「整包重装」，绝不把半成品写进安装目录。
 *
 * 本模块只做纯计算（无 IO、无网络），便于单元测试。
 */
import { createHash } from 'node:crypto'

/** 一个文件的补丁段（从 `diff --git` 起到下一个 `diff --git` 前）。 */
export interface FilePatch {
  /** 旧路径（a/ 之后）；新增文件为 null。 */
  from: string | null
  /** 新路径（b/ 之后）；删除文件为 null。 */
  to: string | null
  /** 是否二进制补丁（GIT binary patch / Binary files differ）——本模块不处理。 */
  binary: boolean
  /** 是否新增文件。 */
  added: boolean
  /** 是否删除文件。 */
  deleted: boolean
  /** 是否纯改名/改模式（无 hunk）。 */
  renamed: boolean
  /** 段内原始行（不含首行 `diff --git`）。 */
  lines: string[]
}

/** git blob sha：sha1("blob <len>\0" + 内容)。 */
export function blobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\u0000`, 'utf8')
  return createHash('sha1').update(Buffer.concat([header, content])).digest('hex')
}

/** 从 `git ls-tree -r` 风格文本解析「路径 → blob sha」。 */
export function parseTreeList(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line)
    if (m) out.set(m[2], m[1])
  }
  return out
}

/** 从 GitHub trees API 的 JSON 解析「路径 → blob sha」（只取 blob 条目）。 */
export function parseTreeApi(json: unknown): Map<string, string> {
  const out = new Map<string, string>()
  const tree = (json as { tree?: unknown }).tree
  if (!Array.isArray(tree)) return out
  for (const entry of tree) {
    const e = entry as { type?: unknown; path?: unknown; sha?: unknown }
    if (e.type === 'blob' && typeof e.path === 'string' && typeof e.sha === 'string') out.set(e.path, e.sha)
  }
  return out
}

/**
 * 把 unified diff 切成每文件一段。
 *
 * 路径取自 `diff --git a/<from> b/<to>`；含空格的路径该行会有歧义，故新增/
 * 删除/改名一律优先用后续的 `--- a/x` / `+++ b/x` 行校正。
 */
export function splitPatches(diff: string): FilePatch[] {
  const out: FilePatch[] = []
  let cur: FilePatch | null = null
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith('diff --git ')) {
      if (cur !== null) out.push(cur)
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw)
      cur = {
        from: m === null ? null : m[1],
        to: m === null ? null : m[2],
        binary: false,
        added: false,
        deleted: false,
        renamed: false,
        lines: [],
      }
      continue
    }
    if (cur === null) continue
    if (raw.startsWith('GIT binary patch') || raw.startsWith('Binary files ')) cur.binary = true
    else if (raw.startsWith('new file mode')) cur.added = true
    else if (raw.startsWith('deleted file mode')) cur.deleted = true
    else if (raw.startsWith('rename from ') || raw.startsWith('rename to ')) cur.renamed = true
    else if (raw.startsWith('--- ')) {
      const path = raw.slice(4)
      if (path === '/dev/null') cur.added = true
      else if (path.startsWith('a/')) cur.from = path.slice(2)
    } else if (raw.startsWith('+++ ')) {
      const path = raw.slice(4)
      if (path === '/dev/null') cur.deleted = true
      else if (path.startsWith('b/')) cur.to = path.slice(2)
    }
    cur.lines.push(raw)
  }
  if (cur !== null) out.push(cur)
  return out
}

/** 把内容切成行 + 「是否以换行结尾」标记（无换行结尾是 diff 的特例语义）。 */
function toLines(content: string): { lines: string[]; eol: boolean } {
  if (content === '') return { lines: [], eol: false }
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') {
    lines.pop()
    return { lines, eol: true }
  }
  return { lines, eol: false }
}

/**
 * 对单个文件应用全部 hunk。
 *
 * 严格匹配：每个上下文行与 `-` 行都必须与原文逐字符一致，任何漂移立即返回
 * null（宁可回退整文件下载，也不写出可疑内容）。行号只用来定位，不做模糊
 * 搜索——补丁与基线来自同一对提交，本该精确对齐。
 *
 * 换行语义：`\ No newline at end of file` 标记归属于紧邻的上一行——跟在
 * `+`/` ` 后表示**新文件**结尾无换行，跟在 `-` 后表示**旧文件**结尾无换行。
 *
 * @param original - 原文；新增文件传 null。
 * @param patch - 该文件的补丁段。
 * @returns 打完补丁的内容；上下文不匹配时返回 null。
 */
export function applyFilePatch(original: string | null, patch: FilePatch): string | null {
  const source = toLines(original ?? '')
  const src = source.lines
  const out: string[] = []
  let cursor = 0
  /** 新文件是否以换行结尾：默认沿用旧文件；命中 EOF 的 hunk 会改写它。 */
  let newEol = original === null ? true : source.eol
  let sawHunk = false

  let i = 0
  while (i < patch.lines.length) {
    const head = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(patch.lines[i])
    if (head === null) { i += 1; continue }
    sawHunk = true
    const oldStart = Number(head[1])
    const oldCount = head[2] === undefined ? 1 : Number(head[2])
    i += 1

    // 收集 hunk 体（到下一个 @@ 或段尾）
    const body: string[] = []
    while (i < patch.lines.length && !patch.lines[i].startsWith('@@')) {
      body.push(patch.lines[i])
      i += 1
    }
    // diff 文本以换行结尾时，按行切分会在**最后一个**文件段尾多出一个空串。
    // git 给空的上下文行也会写前缀空格（" "），所以行尾的纯空串一定是这个
    // 切分残渣，不剥掉会被当成"要匹配空行的上下文"而误判整个补丁失败。
    while (body.length > 0 && body[body.length - 1] === '') body.pop()

    // oldCount === 0 表示纯插入：oldStart 是插入点之前的行号
    const target = oldCount === 0 ? oldStart : oldStart - 1
    if (target < cursor || target > src.length) return null
    out.push(...src.slice(cursor, target))
    cursor = target

    let lastTag: string | null = null
    for (const raw of body) {
      if (raw.startsWith('\\')) {
        // 无换行标记：归属上一行
        if (lastTag === '+' || lastTag === ' ') newEol = false
        continue
      }
      const tag = raw === '' ? ' ' : raw[0]
      const text = raw === '' ? '' : raw.slice(1)
      if (tag === ' ') {
        if (src[cursor] !== text) return null
        out.push(src[cursor])
        cursor += 1
      } else if (tag === '-') {
        if (src[cursor] !== text) return null
        cursor += 1
      } else if (tag === '+') {
        out.push(text)
      } else {
        return null // 未知前缀，判失败
      }
      lastTag = tag
    }
    // 该 hunk 吃到了旧文件末尾：若结尾是新增/上下文行且没有无换行标记，
    // 新文件即以换行结尾（覆盖沿用来的旧值）。
    if (cursor >= src.length && (lastTag === '+' || lastTag === ' ')) {
      const tail = body[body.length - 1] ?? ''
      if (!tail.startsWith('\\')) newEol = true
    }
  }

  if (!sawHunk) return null
  out.push(...src.slice(cursor))
  return out.join('\n') + (newEol ? '\n' : '')
}

/**
 * 判断补丁涉及的路径是否属于「已安装内容」。
 *
 * 包目录里只有 package.json `files` 声明的那些路径（lib/、assets/ 等），
 * src/、docs/、测试脚本等不会被安装——它们的补丁必须跳过，否则会在安装目录
 * 里凭空造出源码树。
 *
 * @param path - 仓库内路径（正斜杠）。
 * @param files - package.json 的 `files` 数组。
 */
export function isInstalledPath(path: string, files: readonly string[]): boolean {
  if (path === 'package.json' || path === 'README.md' || path === 'LICENSE') return true
  return files.some((entry) => {
    const clean = entry.replace(/^\.\//, '').replace(/\/$/, '')
    return path === clean || path.startsWith(clean + '/')
  })
}
