/**
 * dsh-memory 文件存储层：entries.json / state.json / changes/<date>.jsonl /
 * 各层 md 产物。所有写入走「tmp + rename」原子写，防止半写损坏。
 * 数据根：${DSH_HOME:-~/.dsh}/memories/dsh-memory/（与 memory-evolve 遗留数据同根目录、不同前缀，互不读写）。
 */
import type { ChangeRecord, MemoryConfig, MemoryEntry, MemoryKind, ProjectMeta, RevisionMeta, StoreState } from '../types.js';
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
    /** 回刷 debounce（毫秒）：合并短窗口内的多次写。 */
    private static readonly FLUSH_DEBOUNCE_MS;
    /** 内存态条目（权威副本；磁盘 entries.json 是它的节流回刷镜像）。 */
    private entries;
    /** 内存态是否落后于磁盘（有待回刷）。 */
    private dirty;
    /** 节流回刷计时器。 */
    private flushTimer;
    constructor(root?: string);
    entriesFile(): string;
    stateFile(): string;
    configFile(): string;
    /** 读运行时配置覆盖（config.json；缺失返回空）。 */
    readConfigSync(): Partial<MemoryConfig>;
    /** 写运行时配置覆盖（面板设置持久化）。 */
    writeConfig(config: Partial<MemoryConfig>): Promise<void>;
    changesFile(date: string): string;
    globalDir(): string;
    projectDir(hash: string): string;
    dailyFile(date: string): string;
    /** 全量条目索引（内存快照的浅拷贝，避免外部误改内存态）。 */
    readEntries(): Promise<MemoryEntry[]>;
    /** 节流回刷：标记 dirty 并在 debounce 后落盘（合并写放大）。 */
    private scheduleFlush;
    /** 立即落盘（幂等；dispose / 退出前调用）。 */
    flush(): Promise<void>;
    private flushNow;
    /**
     * 修改内存态条目（fn 原地修改传入数组或返回替换数组），随后节流回刷。
     * 单线程下内存数组的同步操作天然原子，无需额外写串行队列。
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
        kind?: MemoryKind;
        confidence?: number;
        provenance?: {
            sessionId?: string;
            turn?: number;
            snippet?: string;
        };
    }): Promise<{
        created: boolean;
        entry: MemoryEntry;
    }>;
    /**
     * 替换单条（用于裁决操作：改内容/标签/移项目/置顶/启用）。返回新条目；不存在返回 undefined。
     *
     * id 是 content+scope+projectHash 的稳定派生值，所以内容或归属变化时必须重算 id，
     * 否则 id 与内容脱钩：后续 upsertEntry（提取/手动添加）算出的新 id 找不到本条，
     * 会把同一条记忆再插一遍（面板出现重复条目）。若新 id 已存在（改成了与另一条
     * 完全相同的内容），把两条合并为一条，保留较高的 importance 与并集标签。
     */
    patchEntry(id: string, patch: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry | undefined>;
    /** 删除条目。返回是否删除成功。 */
    removeEntry(id: string): Promise<boolean>;
    /**
     * 软废弃一条记忆（retire，无后继）：数据保留但默认不再检索/注入/编译。
     * 已废弃条目重复 retire 是幂等 no-op。
     */
    retireEntry(id: string, reason?: string): Promise<MemoryEntry | undefined>;
    /**
     * 修订一条记忆（revise，软废弃 + 后继）：把旧内容软废弃，写入新内容作为后继。
     * 参考 opencontext 的 oc_memory_revise 语义：{ deprecatedId, newId }。
     *
     * 后继条目复用 upsertEntry 的稳定 id 派生：新内容与库中已有条目撞 id 时
     * 直接复用（不重复插入）；旧条目标记 supersededBy 指向后继。
     * 内容未变化时视为 no-op（不产生废弃条目）。
     */
    reviseEntry(input: {
        id: string;
        content: string;
        reason?: string;
        tags?: string[];
        importance?: number;
        kind?: MemoryKind;
    }): Promise<{
        deprecatedId: string;
        newId: string;
        entry: MemoryEntry;
    } | undefined>;
    /** 复活一条已废弃的记忆（undo retire / undo revise 的后继侧）。 */
    restoreEntry(id: string): Promise<MemoryEntry | undefined>;
    /** 注入命中刷新（原子）：给命中的条目加分并刷新 lastHitAt，返回刷新条数。 */
    applyHits(hitIds: Set<string>, bonus: number): Promise<number>;
    /** 原子替换全部条目（ticker 每日编译等批量场景；fn 返回新数组）。 */
    replaceEntries(fn: (entries: MemoryEntry[]) => Promise<MemoryEntry[]> | MemoryEntry[]): Promise<MemoryEntry[]>;
    appendChange(change: Omit<ChangeRecord, 'id' | 'at'>): Promise<ChangeRecord>;
    readChanges(date?: string): Promise<ChangeRecord[]>;
    /**
     * 追加一行日志（按分类落独立文件 + 大小轮转，防无界增长）。
     * kind: extract=提取诊断 / api=API 请求（默认关闭）/ error=插件错误。
     * 轮转：当前文件 ≥ 10MB 时改名成带时间戳归档，只保留最近 5 个归档。
     */
    private appendLog;
    /** 插件错误日志（本插件 async 任务失败；DSH 控制台日志不落盘）。 */
    appendErrorLog(stage: string, message: string): Promise<void>;
    /** 提取诊断日志（turn= 开始/结束/耗时/候选数，排查提取卡死）。 */
    appendExtractLog(message: string): Promise<void>;
    /** API 请求诊断日志（默认关闭；仅 config.logApiRequests 开启时由 api.ts 调用）。 */
    appendApiLog(message: string): Promise<void>;
    readState(): Promise<StoreState>;
    writeState(state: StoreState): Promise<void>;
    /** 注入被关闭的会话 id（内存缓存；null = 未加载）。 */
    private injectDisabledCache;
    private ensureInjectCache;
    /** 该会话是否启用记忆注入（默认开启）。 */
    isInjectEnabled(sessionId: string): Promise<boolean>;
    /** 设置该会话的记忆注入开关（持久化到 state.json；调用频率极低，直接写）。 */
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
