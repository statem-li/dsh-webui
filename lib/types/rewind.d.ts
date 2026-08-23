import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/** 快照目录根。 */
export declare function rewindHome(): string;
/** blob 库根。 */
export declare function blobHome(): string;
interface WebServerRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void;
}
interface WebServerService {
    register(route: WebServerRoute): () => void;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        webServer: WebServerService;
    }
    interface Events {
        'fs/write-intent'(target: unknown, actor: unknown, next: () => unknown): unknown;
        'fs/edit-intent'(target: unknown, actor: unknown, next: () => unknown): unknown;
    }
}
/**
 * 捕获阶段的单文件结果：
 *  - hash 存在 → 文本文件，内容将以 blob 形式入库（buffers 提供新读到的原文）；
 *  - flag 'large' / 'binary' → 只记录存在性（过大 / 二进制），回退与差异均跳过；
 *  - 两者皆无 → 读取失败，同样只记录存在性。
 */
export interface CapturedFile {
    size: number;
    /** 完整 sha1 hex（40 位），指向 blob 库。 */
    hash?: string;
    flag?: 'binary' | 'large';
}
export interface CaptureResult {
    files: Record<string, CapturedFile>;
    /** 本次真正读到内容的文件（hash → 原文）；缓存命中的文件不在其中。 */
    buffers: Map<string, Buffer>;
    /** 本次快照额外覆盖的工作区外目录（桌面等），随快照持久化供 diff/restore 复用。 */
    extDirs?: string[];
    /**
     * 捕获开始时刻（消息落盘的语义锚点）。快照的 createdAt 必须用这个时刻，
     * 而不是 persist 落盘时刻——否则在「回复完成后立即点退回」场景下，快照
     * createdAt 可能晚于 agent 写文件的 fs/write-intent 时刻，导致本会话刚写的
     * 文件被 writtenPathsAfter 的时间过滤排除，diff 误判「无变化」而跳过回退。
     */
    capturedAt: number;
}
/** v2 快照的单文件索引项。s=size；h=blob sha1；b=二进制；l=过大。 */
export interface SnapshotFileRef {
    s: number;
    h?: string;
    b?: true;
    l?: true;
}
/** v2 快照：纯索引，不含任何文件内容。 */
export interface RewindSnapshotV2 {
    version: 2;
    sessionId: string;
    seq: number;
    cwd: string;
    createdAt: number;
    fileCount: number;
    files: Record<string, SnapshotFileRef>;
    /** 快照额外覆盖的工作区外目录（桌面等）；条目以正斜杠绝对路径为 key。 */
    extDirs?: string[];
}
/**
 * v1 快照（遗留格式）：files 内嵌 base64 内容。仅由兼容读取路径消费，
 * 新快照一律 v2。
 */
export interface SnapshotFileV1 {
    size: number;
    content: string | null;
    hash?: string;
}
export interface RewindSnapshotV1 {
    version: 1;
    sessionId: string;
    seq: number;
    cwd: string;
    createdAt: number;
    fileCount: number;
    files: Record<string, SnapshotFileV1>;
}
/** 内存中的统一快照视图：v1/v2 解析后的公共形态。 */
export interface ViewEntry {
    size: number;
    /** v2：blob 引用（40 位 sha1）。 */
    hash: string | null;
    /** v1 遗留：base64 内容。 */
    content: string | null;
}
export interface SnapshotView {
    version: 1 | 2;
    sessionId: string;
    seq: number;
    cwd: string;
    createdAt: number;
    fileCount: number;
    entries: Record<string, ViewEntry>;
    /** 快照额外覆盖的工作区外目录（桌面等）；v1 老快照无此字段。 */
    extDirs?: string[];
}
/**
 * 快照的轻量索引（`<seq>.meta.json`）：只有每文件的存在性/大小/指纹，
 * 不含内容。文件浏览器「修改历史」用它快速扫描各时点某文件是否变化，
 * 避免逐个读入大 JSON。v1/v2 快照共用该格式（hash 取 sha1 前 12 位，
 * 仅用于相邻时点相等性比较）。老快照没有 meta 文件——历史视图跳过即可。
 */
export interface RewindSnapshotMeta {
    version: 1;
    sessionId: string;
    seq: number;
    cwd: string;
    createdAt: number;
    files: Record<string, {
        size: number;
        hash?: string;
    }>;
}
/**
 * 取某会话「本会话写过的文件」集合：内存命中直接返回；未加载过的会话先从
 * 磁盘 `.written.jsonl` 合并（服务重启后内存为空，磁盘记录让 diff/restore
 * 在中断场景下依然正确弹窗、正确回退）。返回的 Set 是活引用，后续写入会
 * 继续累积。
 *
 * `.written.jsonl` 行格式：新记录 `{"t":<毫秒>,"p":"<绝对路径>"}`（写入时刻，
 * 供 writtenPathsAfter 按快照时点过滤）；旧版纯路径行兼容解析，视为
 * 时刻 Infinity（恒参与回退，维持升级前行为）。
 */
export declare function writtenPathsFor(sessionId: string): ReadonlySet<string>;
/**
 * 取某会话「最后写入时刻晚于 afterMs」的文件路径列表（diff/restore 过滤用）。
 *
 * 语义：只有「本会话在快照时点（消息落盘时刻）之后写过」的文件才可能被退回
 * 改变——本会话在快照前最后写入、之后被其他会话/人工/后台任务改过的文件，
 * 当前状态并非本会话的修改，不应回退。旧式无时间戳记录恒视为「已写」，
 * 维持升级前的兼容行为。
 */
export declare function writtenPathsAfter(sessionId: string, afterMs: number): string[];
/**
 * 相对路径清洗：把绝对路径转为相对 cwd 的 `/` 分隔相对路径；越界（..、
 * 绝对、不在 cwd 内）返回 null。
 */
export declare function safeRelative(cwd: string, absPath: string): string | null;
export declare function externalDirs(): string[];
/**
 * 同步递归遍历工作区：对每个候选文本文件读取原文并计算 SHA-1（缓存命中时
 * 免读），二进制 / 过大 / 读取失败只记录存在性。返回 null 表示放弃快照
 * （文件数超限）。用 node:fs 同步 API：这个函数跑在 user/message 事件回调里，
 * 必须赶在 agent 下一次 tool 调用修改文件之前拿到准确快照。
 */
export declare function captureSnapshotSync(cwd: string, extraPaths?: Iterable<string>): CaptureResult | null;
/** 由捕获结果构造 v2 快照（纯函数，便于测试复用）。 */
export declare function buildSnapshotV2(sessionId: string, seq: number, cwd: string, captured: CaptureResult): RewindSnapshotV2;
/**
 * 落盘一个快照：先补齐缺失 blob（原子写），再原子写索引 JSON 与 meta，
 * 随后做会话内滚动清理，并调度全局维护（预算 / 年龄 / GC）。
 */
export declare function persistSnapshot(args: {
    sessionId: string;
    seq: number;
    cwd: string;
    captured: CaptureResult;
}): Promise<void>;
/**
 * blob GC：收集所有 v2 快照索引引用的 hash，删除无引用且超过宽限期的 blob。
 * v1 遗留快照不含 blob 引用，不参与（其内容自包含）。删除后清空指纹缓存，
 * 防止缓存引用已被回收的 blob。
 */
export declare function gcBlobs(): Promise<void>;
/**
 * 全局维护（节流触发）：淘汰超龄快照 → 若总量超预算则从最老快照淘汰至低位 →
 * 发生过删除就跑一次 blob GC。
 */
export declare function runMaintenance(): Promise<void>;
declare function readSnapshot(sessionId: string, seq: number): Promise<SnapshotView | null>;
export { readSnapshot };
/**
 * 沿 session lineage 合并「本会话写过的文件」记录，再做快照时点过滤。
 *
 * fork 出的 child 会话没有自己的 `.written.jsonl`（写入记录按 sessionId 隔离），
 * 但它继承父会话的历史消息与文件状态。退回 child 里的 seed 消息时，若只查
 * child 自己的写入记录，diff/restore 会恒为空——出现「对话消失了、文件没回退、
 * 也没弹确认框」的 bug。因此要沿 lineage 把整条链（含祖先会话）的写入记录
 * 合并后再过滤。
 *
 * 合并规则：按绝对路径取整条链上「最后写入时刻」的最大值，再与快照时点比较。
 * 时刻 Infinity 的旧式无时间戳记录沿用原语义（恒参与回退）。
 */
export declare function writtenPathsAfterLineage(ctx: Context, sessionId: string, afterMs: number): string[];
/**
 * 把工作区恢复到快照状态：
 *   1. 先覆盖写回快照里记录的文件内容（可恢复的）——这是核心目标「修改的
 *      文件回退」。
 *   2. 再删除快照里不存在的当前文件（「新增的文件清理」）——次要，失败不影响
 *      主目标，且整体幂等可重试。
 * 传入 writtenPaths（本会话写过的文件）时，只恢复/删除这些文件——避免把
 * 其他会话 / 人工 / 后台任务的文件一并回退；缺省则全量恢复（兼容旧行为）。
 */
export declare function restoreSnapshot(view: SnapshotView, extraPaths?: Iterable<string>, writtenPaths?: Iterable<string>): Promise<{
    restored: number;
    deleted: number;
    skippedLarge: number;
}>;
/**
 * 计算当前工作区相对快照的差异（用于退回前的「是否修改文件」判断）：
 *   - modified：快照里记录过内容、当前内容已不同的文件（会被写回）；
 *   - deleted ：快照里记录过内容、当前已不存在的文件（会被写回）；
 *   - added   ：快照里没有、当前存在的新增文件（会被删除）。
 * 只统计 restore 真正会改变的文件：不可恢复的条目（过大/二进制/读失败，
 * restore 保留现状）不参与，避免「实际不会被回退」的文件触发无谓的确认弹窗。
 * 传入 writtenPaths（本会话写过的文件）时，只对比这些文件——避免把其他会话 /
 * 人工 / 后台任务改过的文件误判成本会话的修改；缺省则全量对比（兼容旧行为）。
 */
export declare function diffSnapshot(view: SnapshotView, extraPaths?: Iterable<string>, writtenPaths?: Iterable<string>): Promise<{
    modified: string[];
    added: string[];
    deleted: string[];
}>;
/**
 * 挂载文件快照（session/event 监听）与 /api/webui-rewind 路由。
 * 注意：session/event 是 fire-and-forget feed；快照同步完成以保证锚点准确，
 * 写盘异步执行，失败只告警不阻塞 agent。
 */
export declare function applyRewind(ctx: Context): void;
