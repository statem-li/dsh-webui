import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
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
export interface SnapshotFile {
    /** 原字节长度（用于展示/校验）。 */
    size: number;
    /** base64 内容；null 表示「过大跳过内容」，仅记录存在性。 */
    content: string | null;
}
export interface RewindSnapshot {
    version: 1;
    sessionId: string;
    seq: number;
    cwd: string;
    createdAt: number;
    fileCount: number;
    files: Record<string, SnapshotFile>;
}
/**
 * 相对路径清洗：把绝对路径转为相对 cwd 的 `/` 分隔相对路径；越界（..、
 * 绝对、不在 cwd 内）返回 null。
 */
export declare function safeRelative(cwd: string, absPath: string): string | null;
/**
 * 同步递归遍历并读取文件内容。返回 null 表示放弃快照（过大）。
 * 用 node:fs 同步 API：这个函数跑在 user/message 事件回调里，必须赶在
 * agent 下一次 tool 调用修改文件之前拿到准确快照。
 */
export declare function captureSnapshotSync(cwd: string, extraPaths?: Iterable<string>): {
    files: Record<string, SnapshotFile>;
} | null;
/**
 * 把工作区恢复到快照状态：
 *   1. 先覆盖写回快照里记录的文件内容（content 非 null 的）——这是核心目标
 *      「修改的文件回退」。
 *   2. 再删除快照里不存在的当前文件（「新增的文件清理」）——次要，失败不影响
 *      主目标，且整体幂等可重试。
 */
export declare function restoreSnapshot(snapshot: RewindSnapshot, extraPaths?: Iterable<string>): Promise<{
    restored: number;
    deleted: number;
    skippedLarge: number;
}>;
/**
 * 挂载文件快照（session/event 监听）与 /api/webui-rewind 路由。
 * 注意：session/event 是 fire-and-forget feed；快照同步完成以保证锚点准确，
 * 写盘异步执行，失败只告警不阻塞 agent。
 */
export declare function applyRewind(ctx: Context): void;
export {};
