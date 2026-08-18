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
}
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
    /** 每 N 个 step 刷新一次记忆注入（会话内）。 */
    injectRefreshSteps: number;
    /** 是否启用每日编译（可关，保留轮数增量）。 */
    dailyCompileEnabled: boolean;
    /** 提取窗口最大字符数。 */
    extractMaxChars: number;
    /** 低于该 importance 的候选直接丢弃。 */
    minImportance: number;
}
/** 默认配置。 */
export declare const DEFAULT_CONFIG: MemoryConfig;
/** LLM 提取候选（extract.ts 的 LLM 输出结构）。 */
export interface ExtractCandidate {
    content: string;
    scope: 'global' | 'project';
    tags: string[];
    importance: number;
}
