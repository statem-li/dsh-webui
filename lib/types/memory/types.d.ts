/**
 * dsh-memory 共享类型：记忆条目、变更记录、ticker 状态与插件配置。
 * 全部为纯 JSON 可序列化结构（schema v1）。
 */
/** 记忆条目（~/.dsh/memories/dsh-memory/store/entries.json, schema v1）。 */
export interface MemoryEntry {
    /** mem_<sha1>，由 content+scope+projectHash 稳定推导（同内容合并）。 */
    id: string;
    /** 记忆内容文本。 */
    content: string;
    /** global=全局层（身份/偏好）；project=项目层（随工作区）。 */
    scope: 'global' | 'project';
    /** scope=project 时必填：workspace 路径的 sha1。 */
    projectHash: string | null;
    /** 自定义标签（灵活分类手段）。 */
    tags: string[];
    /** 置顶标记（全局与项目各自独立）。 */
    pinned: boolean;
    /** 已禁用（缺省/undefined = 启用）：条目保留在面板与检索中，但不参与会话注入与产物编译。 */
    disabled?: boolean;
    /** 创建时间 ISO。 */
    createdAt: string;
    /** 最近更新时间 ISO。 */
    updatedAt: string;
    /** 初始 10；随 hit 增加、随天衰减。 */
    importance: number;
    /** 被注入命中时刷新衰减起点。 */
    lastHitAt: string | null;
    /** 当前所在层：short=短期时间线；long=长期沉淀。 */
    layer: 'short' | 'long';
    /** extract=自动提取；manual=用户手写。 */
    source: 'extract' | 'manual';
    /** 条目级版本号（每次内容变更 +1；迁移自 v1 时补 1）。 */
    version: number;
    /** 置信度 0-1：manual=1；extract 由 LLM 输出或默认 0.6。 */
    confidence: number;
    /** 是否已被用户显式确认（手动记忆/手动编辑/裁决保留即置 true）。 */
    verified: boolean;
    /** 显式记忆类型（替代靠标签猜 identity/fact）。 */
    kind: MemoryKind;
    /** 溯源：产生该条目的会话 / 轮次 / 原始片段（截断，可缺省）。 */
    provenance?: {
        sessionId?: string;
        turn?: number;
        snippet?: string;
    };
    /** 嵌入向量（Retrieval 层缓存；未算则缺省）。 */
    embedding?: number[];
}
/** 显式记忆类型（compile 按此分组，不再靠标签硬猜）。 */
export type MemoryKind = 'identity' | 'preference' | 'fact' | 'decision' | 'gotcha' | 'session-summary';
/** 变更流记录（changes/<date>.jsonl，驱动通知与裁决）。 */
export interface ChangeRecord {
    /** 变更记录自身 id（时间戳+随机）。 */
    id: string;
    /** add=新增；update=更新；promote=升长期；delete=删除。 */
    action: 'add' | 'update' | 'promote' | 'delete';
    /** 关联记忆条目 id。 */
    entryId: string;
    scope: 'global' | 'project';
    projectHash: string | null;
    /** 摘要（截断 80 字）。 */
    summary: string;
    /** 变更前内容（update/delete 时的旧内容，供面板前后对比）。 */
    before?: string;
    /** 变更后内容（add/update 时的新内容，供面板前后对比）。 */
    after?: string;
    /** ISO 时间。 */
    at: string;
}
/** ticker 调度状态（store/state.json）。 */
export interface StoreState {
    /** 数据结构版本。 */
    schemaVersion: 1;
    /** 每个会话的轮数计数。 */
    perSession: Record<string, SessionTickerState>;
    /** 上次每日编译日期（YYYY-MM-DD）。 */
    lastDailyDate: string | null;
    /** 记忆注入被关闭的会话 id 列表（不在列表 = 注入开启）。 */
    injectDisabled?: string[];
}
/** 单个会话的 ticker 状态。 */
export interface SessionTickerState {
    /** 累计 turn 数。 */
    turnCount: number;
    /** 上次注入的 step 数。 */
    lastInjectedStep: number;
    /** 连续提取失败（0 候选/LLM 错误）次数，用于退避降频。 */
    extractFailStreak?: number;
}
/** 项目元数据（projects/<hash>/meta.json）。 */
export interface ProjectMeta {
    /** 会话创建时的 workspace 路径。 */
    path: string;
    /** 显示别名（面板可改）。 */
    alias: string | null;
    /** 用户手动改过归属则锁定（不再自动跟随工作区）。 */
    locked: boolean;
    /** 是否自动记忆（自动提取）。默认 true；false = 该工作区关闭自动提取。 */
    autoMemory?: boolean;
}
/** 插件配置（cordis.patch.yml 可覆盖）。 */
export interface MemoryConfig {
    /** 每 N 轮提取一次（turn/end 触发；1=每次）。 */
    extractEveryTurns: number;
    /** 每 N 轮增量编译 timeline。 */
    compileEveryTurns: number;
    /** 低于该 importance 的短期条目不进入注入产物。 */
    compileThreshold: number;
    /** 每天衰减系数（importance *= 1 - λ 的 λ）。 */
    decayLambda: number;
    /** 被注入命中时的加分。 */
    hitBonus: number;
    /** 注入 token 预算（按字符近似）。 */
    injectTokenBudget: number;
    /**
     * 每 N 个 step 刷新一次记忆注入（会话内）。
     * @deprecated 当前注入按设计只在会话首步进行一次（避免置顶内容多轮重复），
     * 该字段无读取方；保留仅为兼容既有 config.json，面板不再暴露。
     */
    injectRefreshSteps: number;
    /** 是否启用每日编译（可关，保留轮数增量）。 */
    dailyCompileEnabled: boolean;
    /** 提取窗口最大字符数。 */
    extractMaxChars: number;
    /** 低于该 importance 的候选直接丢弃。 */
    minImportance: number;
    /** 是否启用每日 LLM 语义整理（Memory Dream，openhanako 同款）。 */
    consolidateEnabled: boolean;
    /** 单次整理最大条目数（token 保护；超过则只取短期层 + 最近更新）。 */
    consolidateMaxEntries: number;
    /** 整理 LLM 调用超时（毫秒）。 */
    consolidateTimeoutMs: number;
    /** 是否记录 API 请求日志（默认 false；防 api.log 被面板轮询请求灌满）。 */
    logApiRequests: boolean;
    /** 注入检索 top-k（当前任务相关记忆注入条数；identity/pinned/长期常驻不占此预算）。 */
    injectTopK: number;
    /** 全局条目数上限（超限按 importance + recency 淘汰低分条目）。 */
    entryLimit: number;
}
/** 默认配置。 */
export declare const DEFAULT_CONFIG: MemoryConfig;
/** LLM 整理操作（consolidate.ts 的 LLM 输出结构）。 */
export interface ConsolidateOp {
    /** merge=合并多条为一条；rewrite=重写单条；drop=删除；promote=升长期。 */
    type: 'merge' | 'rewrite' | 'drop' | 'promote';
    /** 参与该操作的条目 id（merge/drop/promote 可多条；rewrite 单条）。 */
    ids: string[];
    /** merge/rewrite 的新内容（不含原条目中不存在的虚构信息）。 */
    content?: string;
    /** merge/rewrite 的新标签。 */
    tags?: string[];
}
/** 整理统计结果（供面板/工具返回）。 */
export interface ConsolidateResult {
    /** 本次整理的 scope：global | project:<hash> | all。 */
    scope: string;
    /** 合并条数（源条目被合并后数量减少）。 */
    merged: number;
    /** 重写条数。 */
    rewritten: number;
    /** 删除条数。 */
    dropped: number;
    /** 提升长期条数。 */
    promoted: number;
    /** 整理产生的条目变动总数（merge 按源条目数 + 1 计）。 */
    changed: number;
}
/** 修订版本元数据（revisions/<id>.json）。 */
export interface RevisionMeta {
    /** 修订 id（时间戳 + 随机）。 */
    id: string;
    /** 快照时间 ISO。 */
    at: string;
    /** 快照内条目数。 */
    entryCount: number;
    /** 触发范围（global | project:<hash> | all）。 */
    scope: string;
    /** 触发动机：daily=每日自动；manual=手动/工具触发。 */
    trigger: 'daily' | 'manual';
}
/** LLM 提取候选（extract.ts 的 LLM 输出结构）。 */
export interface ExtractCandidate {
    content: string;
    scope: 'global' | 'project';
    tags: string[];
    importance: number;
}
/** 数值字段的取值域（面板输入越界时钳制而非丢弃；integer 字段四舍五入取整）。 */
export declare const CONFIG_NUMBER_BOUNDS: {
    readonly extractEveryTurns: {
        readonly min: 1;
        readonly max: 100;
        readonly int: true;
        readonly step: 1;
    };
    readonly compileEveryTurns: {
        readonly min: 1;
        readonly max: 500;
        readonly int: true;
        readonly step: 1;
    };
    readonly compileThreshold: {
        readonly min: 0;
        readonly max: 20;
        readonly int: false;
        readonly step: 0.5;
    };
    readonly decayLambda: {
        readonly min: 0;
        readonly max: 0.5;
        readonly int: false;
        readonly step: 0.01;
    };
    readonly hitBonus: {
        readonly min: 0;
        readonly max: 10;
        readonly int: false;
        readonly step: 0.5;
    };
    readonly injectTokenBudget: {
        readonly min: 1000;
        readonly max: 60000;
        readonly int: true;
        readonly step: 500;
    };
    readonly injectRefreshSteps: {
        readonly min: 1;
        readonly max: 200;
        readonly int: true;
        readonly step: 1;
    };
    readonly extractMaxChars: {
        readonly min: 500;
        readonly max: 60000;
        readonly int: true;
        readonly step: 500;
    };
    readonly minImportance: {
        readonly min: 1;
        readonly max: 10;
        readonly int: false;
        readonly step: 0.5;
    };
    readonly consolidateMaxEntries: {
        readonly min: 10;
        readonly max: 2000;
        readonly int: true;
        readonly step: 10;
    };
    readonly consolidateTimeoutMs: {
        readonly min: 5000;
        readonly max: 600000;
        readonly int: true;
        readonly step: 5000;
    };
    readonly injectTopK: {
        readonly min: 1;
        readonly max: 50;
        readonly int: true;
        readonly step: 1;
    };
    readonly entryLimit: {
        readonly min: 50;
        readonly max: 100000;
        readonly int: true;
        readonly step: 50;
    };
};
/** 可调数值字段名。 */
export type ConfigNumberKey = keyof typeof CONFIG_NUMBER_BOUNDS;
declare const CONFIG_BOOLEAN_KEYS: readonly ["dailyCompileEnabled", "consolidateEnabled", "logApiRequests"];
/** 可调布尔字段名。 */
export type ConfigBooleanKey = (typeof CONFIG_BOOLEAN_KEYS)[number];
/**
 * 应用配置覆盖（原地更新 config；返回实际应用的字段子集，供持久化）。
 * 数值按 CONFIG_NUMBER_BOUNDS 钳制到合法域（越界钳制而非静默丢弃——
 * 旧实现要求 value > 0，导致 decayLambda=0 / compileThreshold=0 等
 * 合法的"关闭衰减/不设阈值"写不进去，面板上看似保存成功实则被丢弃）。
 */
export declare function applyConfigOverrides(config: MemoryConfig, candidate: unknown): Partial<MemoryConfig>;
/** 面板可展示的公开配置视图（只暴露可调字段）。 */
export declare function publicConfig(config: MemoryConfig): Partial<MemoryConfig>;
export {};
