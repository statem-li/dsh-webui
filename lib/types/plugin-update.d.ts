/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
/** settings 命名空间与 API 前缀。 */
export declare const PLUGIN_UPDATE_NAMESPACE = "webui-plugin-update";
export declare const PLUGIN_UPDATE_API = "/api/webui-plugin-update";
/**
 * 归一化依赖 spec：pnpm 有时把 git spec 里的分支 fragment 落成解析后的提交
 * sha（`github:owner/repo#a117b74…`），照原样重装等于「装回同一个旧提交」。
 * 纯 hex fragment 一律剥掉，让 git spec 重新解析默认分支的最新提交；
 * `#semver:` / `#branch-name` 这类有意义的 fragment 原样保留。
 */
export declare function normalizeSpec(spec: string): string;
/** 语义化版本比较：a 比 b 新返回 1，旧返回 -1，相同返回 0（预发布后缀忽略）。 */
export declare function compareVersions(a: string, b: string): number;
/**
 * 从 git 智能 HTTP 的 ref 广告里取某分支的 sha。响应是 pkt-line 流，每行
 * 前 4 字节是十六进制长度，行内容形如 `<sha> refs/heads/main`。
 */
export declare function parseRefSha(advertisement: string, branch: string): string | null;
/**
 * 从 profile 的 pnpm-lock.yaml 里取本包已安装的提交 sha。
 *
 * 为什么需要：git 形态安装的版本号来自仓库 package.json，作者不一定每次提交
 * 都 bump version——只比版本号会漏掉「同版本号但有新提交」的更新。pnpm 把
 * 解析结果记进锁文件，两种写法都可能出现：
 *   version: https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>
 *   version: git+https://github.com/<owner>/<repo>.git#<sha>
 * 逐行扫描（不引 YAML 解析器），命中包名后取随后几行里第一个 40 位 sha。
 */
export declare function parseLockCommit(lock: string, packageName: string): string | null;
/** 增量更新的产出：要落盘的文件与要删除的文件（先全算完再统一落盘）。 */
interface PatchPlan {
    writes: Array<{
        path: string;
        content: Buffer;
    }>;
    deletes: string[];
    /** 补丁涉及但不在安装内容里的路径数（src/ 等，正常跳过）。 */
    skipped: number;
}
/**
 * 按 unified diff 算出增量更新计划，并用目标提交的 blob sha 逐文件校验。
 *
 * 任何一个文件对不上（二进制补丁、上下文漂移、本地被手改过）都直接抛错，
 * 由调用方回退整包重装——绝不把半成品写进安装目录。
 *
 * @param pkgDir - 已安装的包目录。
 * @param diff - 两个提交之间的 unified diff。
 * @param targetTree - 目标提交的「路径 → blob sha」表。
 * @param files - package.json 的 files 声明（判定哪些路径真的被安装）。
 */
export declare function planIncremental(pkgDir: string, diff: string, targetTree: Map<string, string>, files: readonly string[]): PatchPlan;
/**
 * 装配插件自更新：settings 持久化 + 状态/检查/更新三个 HTTP 端点。
 * @param ctx - host 上下文。
 */
export declare function applyPluginUpdate(ctx: PluginContext): void;
export {};
