/**
 * dsh-memory 文件存储层：entries.json / state.json / changes/<date>.jsonl /
 * 各层 md 产物。所有写入走「tmp + rename」原子写，防止半写损坏。
 * 数据根：${DSH_HOME:-~/.dsh}/memories/dsh-memory/（与 memory-evolve 遗留数据同根目录、不同前缀，互不读写）。
 */
import type { ChangeRecord, MemoryEntry, ProjectMeta, RevisionMeta, StoreState } from '../types.js';
/** 数据根目录。 */
export declare function memoryHome(): string;
/** workspace 路径 → 项目目录 hash（sha1 前 12 位）。 */
export declare function projectHashOf(cwd: string): string;
/** 记忆条目稳定 id：mem_<sha1(content|scope|projectHash)>，同内容合并。 */
export declare function entryIdOf(content: string, scope: 'global' | 'project', projectHash: string | null): string;
/** 本地日期 YYYY-MM-DD。 */
export declare function localDate(date?: Date): string;
/** ISO 时间（本地时区偏移保留）。 */
export declare function nowIso(): string;
/** 原子写文本：tmp + rename（同一目录内）。 */
export declare function atomicWriteText(file: string, content: string): Promise<void>;
/** 原子写 JSON。 */
export declare function atomicWriteJson(file: string, value: unknown): Promise<void>;
/** 读取 JSON，缺失/损坏返回 fallback。 */
export declare function readJson<T>(file: string, fallback: T): Promise<T>;
/** 追加一行 JSONL（追加本身用 appendFile；损坏容忍，读侧幂等）。 */
export declare function appendJsonl(file: string, value: unknown): Promise<void>;
/** 读取 JSONL（容忍坏行），返回 { entries, seq }。 */
export declare function readJsonl<T>(file: string): Promise<T[]>;
/**
 * MemoryStore：所有记忆数据的读写入口。
 * 线程模型：调用方（ticker / turn/end 捕获）通过同一实例串行化写入，
 * 内部只保证单文件操作的原子性。
 */
export declare class MemoryStore {
    readonly root: string;
    constructor(root?: string);
    entriesFile(): string;
    stateFile(): string;
    changesFile(date: string): string;
    globalDir(): string;
    projectDir(hash: string): string;
    dailyFile(date: string): string;
    /** 全量条目索引（缺失/损坏从空开始）。 */
    readEntries(): Promise<MemoryEntry[]>;
    writeEntries(entries: MemoryEntry[]): Promise<void>;
    /**
     * entries.json 写串行队列：所有「读-改-写」操作必须经此队列执行，
     * 消除提取/注入命中刷新/API 裁决/每日编译之间的并发覆盖（read-modify-write 竞争）。
     */
    private writeQueue;
    private enqueueWrite;
    /**
     * 原子化「读 entries → 修改 → 写回」。fn 原地修改传入数组（或返回替换数组）。
     * @param fn - 接收当前 entries 快照，修改或返回新数组；返回值透传。
     */
    mutateEntries<T>(fn: (entries: MemoryEntry[]) => Promise<T> | T): Promise<T>;
    getEntry(id: string): Promise<MemoryEntry | undefined>;
    /**
     * 新增或更新（同 id 合并）。返回 { created, entry }。
     * 同时按去重逻辑：新增时若同内容（同 scope+projectHash）已存在则合并为 update。
     */
    upsertEntry(next: {
        content: string;
        scope: 'global' | 'project';
        projectHash: string | null;
        tags?: string[];
        pinned?: boolean;
        importance?: number;
        lastHitAt?: string | null;
        layer?: 'short' | 'long';
        source?: 'extract' | 'manual';
    }): Promise<{
        created: boolean;
        entry: MemoryEntry;
    }>;
    /** 替换单条（用于裁决操作：改标签/移项目/置顶）。返回新条目；不存在返回 undefined。 */
    patchEntry(id: string, patch: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry | undefined>;
    /** 删除条目。返回是否删除成功。 */
    removeEntry(id: string): Promise<boolean>;
    /** 注入命中刷新（原子）：给命中的条目加分并刷新 lastHitAt，返回刷新条数。 */
    applyHits(hitIds: Set<string>, bonus: number): Promise<number>;
    /** 原子替换全部条目（ticker 每日编译等批量场景；fn 返回新数组）。 */
    replaceEntries(fn: (entries: MemoryEntry[]) => Promise<MemoryEntry[]> | MemoryEntry[]): Promise<MemoryEntry[]>;
    appendChange(change: Omit<ChangeRecord, 'id' | 'at'>): Promise<ChangeRecord>;
    readChanges(date?: string): Promise<ChangeRecord[]>;
    /** 插件错误日志（追加模式，供崩溃排查；DSH 控制台日志不落盘）。 */
    appendErrorLog(stage: string, message: string): Promise<void>;
    /** 提取诊断日志（追加模式：开始/结束/耗时/候选数，排查提取卡死）。 */
    appendExtractLog(message: string): Promise<void>;
    readState(): Promise<StoreState>;
    writeState(state: StoreState): Promise<void>;
    /** 注入被关闭的会话 id（内存缓存；null = 未加载）。 */
    private injectDisabledCache;
    private ensureInjectCache;
    /** 该会话是否启用记忆注入（默认开启）。 */
    isInjectEnabled(sessionId: string): Promise<boolean>;
    /** 设置该会话的记忆注入开关（持久化到 state.json，走写串行队列）。 */
    setInjectEnabled(sessionId: string, enabled: boolean): Promise<void>;
    readProjectMeta(hash: string): Promise<ProjectMeta | undefined>;
    writeProjectMeta(hash: string, meta: ProjectMeta): Promise<void>;
    /** 该工作区是否开启自动记忆（默认 true；meta 缺失或字段未写视为开启）。 */
    isAutoMemoryEnabled(hash: string): Promise<boolean>;
    /** 列出全部项目（含 meta 与统计）。 */
    listProjects(entries: MemoryEntry[]): Promise<Array<ProjectMeta & {
        hash: string;
        entryCount: number;
        pinnedCount: number;
        autoMemory: boolean;
    }>>;
    /**
     * 读取 DSH 工作区注册表（${DSH_HOME}/storages/workspace.json），容错返回空。
     * 用于让「尚无记忆的新工作区」也出现在面板项目列表（entryCount 0）。
     */
    listDshWorkspaces(): Promise<Array<{
        path: string;
        title: string;
    }>>;
    revisionsDir(): string;
    /**
     * 写入一个修订快照（整理前调用），返回修订 id。
     * 保存 meta + 全量 entries，回滚时直接整体恢复。
     */
    writeRevision(input: {
        entries: MemoryEntry[];
        scope: string;
        trigger: 'daily' | 'manual';
    }): Promise<string>;
    /** 列出修订版本（新 → 旧）。 */
    listRevisions(): Promise<RevisionMeta[]>;
    /** 读修订快照的全部条目；不存在返回 null。 */
    readRevisionEntries(id: string): Promise<MemoryEntry[] | null>;
    /** 回滚到某修订（整体恢复 entries，走写串行队列）。返回是否成功。 */
    restoreRevision(id: string): Promise<boolean>;
    /** 滚动清理：只保留最近 keep 个修订。 */
    pruneRevisions(keep: number): Promise<void>;
    /** 写任意 md 产物（原子）。 */
    writeArtifact(path: string, content: string): Promise<void>;
    /** 写项目层产物。 */
    writeProjectArtifacts(hash: string, artifacts: {
        memory?: string;
        facts?: string;
        pinned?: string;
    }): Promise<void>;
    /** 写全局层产物。 */
    writeGlobalArtifacts(artifacts: {
        identity?: string;
        facts?: string;
        pinned?: string;
    }): Promise<void>;
}
/** 合并标签（保留旧标签 + 新标签，去重，上限 8）。 */
export declare function mergeTags(existing: string[], next: string[] | undefined, max?: number): string[];
/** 摘要（截断 80 字）。 */
export declare function summarize(content: string, max?: number): string;
