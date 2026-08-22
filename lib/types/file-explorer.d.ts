/**
 * 工作区文件浏览器（自 dsh-file-explorer 合并）：挂 /api/file-explorer 路由，
 * 提供工作区文件列表/读取/写入。所有文件 IO 走 `ctx.fs`，工作区根来自
 * `ctx.workspaceRegistry`。安全：loopback-only + 工作区根 containment。
 *
 * Routes (all under /api/file-explorer):
 *   GET /workspaces           → [{ id, title, path }]
 *   GET /list?path=<dir>      → [{ name, type, size }]  (directories first)
 *   GET /read?path=<file>     → { content, version, path }
 *   GET /raw?path=<file>      → raw bytes (inline image serving / download)
 *   GET /bin?path=<file>      → { base64, size, truncated } hex-preview head
 *   PUT /write  { path, content, version? } → { version, operation }
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/** ── Minimal service contracts (kept small to avoid the dsh type dependency
 *  chain; the real services implement these shapes). ─────────────────────── */
interface FsTarget {
    targetKey: string;
    displayPath: string;
}
interface FsInfo {
    version: string;
    type: 'file' | 'directory' | 'other';
    size?: number;
}
interface FsDirEntry {
    name: string;
    type: 'file' | 'directory' | 'other';
    target: FsTarget;
    size?: number;
}
type FsWriteIntent = {
    kind: 'createIfAbsent';
} | {
    kind: 'replaceIfVersion';
    version: string;
};
interface FsWriteOutcome {
    operation: 'create' | 'update';
    version: string;
    before: string | null;
    after: string;
}
interface SandboxPolicyLike {
    mode: string;
    workspaceRoot: string;
}
interface FileSystemService {
    resolve(path: string): Promise<FsTarget>;
    processPath(target: FsTarget): string;
    stat(target: FsTarget): Promise<FsInfo | undefined>;
    listDir(target: FsTarget): Promise<FsDirEntry[]>;
    readText(target: FsTarget): Promise<string>;
    readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: unknown, sandboxPolicy?: SandboxPolicyLike): Promise<FsWriteOutcome>;
    contains(parent: FsTarget, child: FsTarget): boolean;
}
interface WorkspaceView {
    id: string;
    title: string;
    path: string;
}
interface WorkspaceRegistryService {
    list(): WorkspaceView[];
}
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
        fs: FileSystemService;
        workspaceRegistry: WorkspaceRegistryService;
        webServer: WebServerService;
    }
}
/** 挂载 /api/file-explorer 路由（webui 组合调用）。 */
export declare function applyFileExplorer(ctx: Context): void;
export {};
