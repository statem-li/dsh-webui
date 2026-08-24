/** 一个文件的补丁段（从 `diff --git` 起到下一个 `diff --git` 前）。 */
export interface FilePatch {
    /** 旧路径（a/ 之后）；新增文件为 null。 */
    from: string | null;
    /** 新路径（b/ 之后）；删除文件为 null。 */
    to: string | null;
    /** 是否二进制补丁（GIT binary patch / Binary files differ）——本模块不处理。 */
    binary: boolean;
    /** 是否新增文件。 */
    added: boolean;
    /** 是否删除文件。 */
    deleted: boolean;
    /** 是否纯改名/改模式（无 hunk）。 */
    renamed: boolean;
    /** 段内原始行（不含首行 `diff --git`）。 */
    lines: string[];
}
/** git blob sha：sha1("blob <len>\0" + 内容)。 */
export declare function blobSha(content: Buffer): string;
/** 从 `git ls-tree -r` 风格文本解析「路径 → blob sha」。 */
export declare function parseTreeList(text: string): Map<string, string>;
/** 从 GitHub trees API 的 JSON 解析「路径 → blob sha」（只取 blob 条目）。 */
export declare function parseTreeApi(json: unknown): Map<string, string>;
/**
 * 把 unified diff 切成每文件一段。
 *
 * 路径取自 `diff --git a/<from> b/<to>`；含空格的路径该行会有歧义，故新增/
 * 删除/改名一律优先用后续的 `--- a/x` / `+++ b/x` 行校正。
 */
export declare function splitPatches(diff: string): FilePatch[];
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
export declare function applyFilePatch(original: string | null, patch: FilePatch): string | null;
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
export declare function isInstalledPath(path: string, files: readonly string[]): boolean;
