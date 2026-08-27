/**
 * team — 团队 Agent 编排器的数据结构（host / client 共用语义，见 docs/TEAM-ORCHESTRA.md v0.3）。
 *
 * 三层实体：
 *  - Team：一个团队 = 团队默认模型 + 角色集 + 链条 + 直连（一团队一文件持久化）。
 *  - Role：团队内的角色，模型默认「继承团队」（model === null），可单独覆盖。
 *  - Run / RunStep：一次链条执行的运行时快照（落 run.json，供面板与对话流 HUD 轮询）。
 *
 * 模型解析四级优先级（resolveModel）：本次运行 > 角色覆盖 > 团队默认 > 全局默认。
 */
/** 存储契约版本：读到更高版本的团队文件时降级为只读。 */
export declare const TEAM_SCHEMA_VERSION = 1;
/** 模型绑定：provider + model id（+ 可选推理等级 / 输出预算）。 */
export interface ModelBinding {
    provider: string;
    model: string;
    reasoningEffort?: string;
    maxTokens?: number;
}
/** 模型来自哪一层（UI 徽标 + 运行快照记录）。 */
export type ModelSource = 'run' | 'role' | 'team' | 'global';
/** 解析结果：绑定值 + 来源层。 */
export interface ResolvedModel {
    binding: ModelBinding;
    source: ModelSource;
}
/** 角色分组（决定径向图配色与图上编组）。 */
export type RoleGroup = 'core' | 'judge' | 'act' | 'guard';
/** 执行通道偏好。 */
export type ExecutorPref = 'auto' | 'llm' | 'subagent';
/**
 * 角色在编制图上的位置（**world 绝对像素，可为负 —— 无限画布**）。
 * 缺省 = 前端按网格自动布局；用户拖拽后写入并持久化。
 * 旧版本（≤2026-08）此处存的是 0..1 归一化值，前端会自动折算迁移。
 */
export interface NodePos {
    x: number;
    y: number;
}
/** 工具装配模式。 */
export type ToolMode = 'inherit' | 'allow' | 'deny';
/** 技能装配模式。 */
export type SkillMode = 'inherit' | 'allow' | 'none';
/**
 * 角色能力装配（插件工具 + 技能包）。
 *
 * 生效方式按执行通道不同：
 *  - `subagent` 通道：`tools` 经 `subagents.start({ toolFilter })` 真实限制
 *    （工具从子 agent 提示词消失且拒绝执行）；技能白名单写进提示词，子 agent
 *    自行用 `skill` 工具加载。
 *  - `llm` 直跑通道：本身无工具，`tools` 仅作声明（提示词里说明可用能力）；
 *    技能则**把正文内联进 system**（按预算截断）——这是 llm 通道唯一能"装配"技能的方式。
 */
export interface RoleCapabilities {
    /** 工具装配模式：inherit=继承会话全部工具；allow=白名单；deny=黑名单。 */
    toolMode: ToolMode;
    /** 工具名列表（配合 toolMode；inherit 时忽略）。 */
    tools: string[];
    /** 技能装配模式：inherit=不额外限制；allow=只装配下列技能；none=不用技能。 */
    skillMode: SkillMode;
    /** 技能名列表（skillMode='allow' 时生效）。 */
    skills: string[];
    /** 技能包 id 列表：解析时展开为包内技能名并与 skills 合并。 */
    skillBundles: string[];
}
/** 能力装配默认值（完全继承会话，不做任何限制）。 */
export declare const DEFAULT_CAPABILITIES: RoleCapabilities;
/**
 * 备用模型链：主模型失败（且失败类型「换模型有救」，见 failure.ts shouldFallback）
 * 时按顺序尝试。最多保留 3 个，解析时会剔除当前供应商配置里不存在的项。
 */
export type FallbackModels = ModelBinding[];
/** 备用模型链最大长度。 */
export declare const MAX_FALLBACK_MODELS = 3;
/** 一个角色。 */
export interface Role {
    /** 团队内唯一 id（如 'cha'）。 */
    id: string;
    /** 中文名（如 '察'）。 */
    name: string;
    /** 英文名（如 'cha'）。 */
    en: string;
    /** 定位语（如 '深度调研·多源取证'）。 */
    tagline: string;
    group: RoleGroup;
    /** 角色系统提示词。 */
    prompt: string;
    /** null = 继承团队默认模型；对象 = 本角色覆盖。 */
    model: ModelBinding | null;
    /**
     * 本角色的备用模型链：主模型失败且属于「换模型有救」的失败类型时按序尝试。
     * 缺省 = 继承团队的 fallbackModels。
     */
    fallbackModels?: FallbackModels;
    executor: ExecutorPref;
    /** 模型短名（仅显示提示，不参与执行）。 */
    label?: string;
    tags?: string[];
    /** 编制图上的手工位置（归一化 0..1）；缺省用自动环形布局。 */
    pos?: NodePos;
    /** 头像：emoji 或短字符（缺省用 name 首字生成圆形头像）。 */
    avatar?: string;
    /** 能力装配（工具 + 技能）；缺省 = 完全继承。 */
    capabilities?: RoleCapabilities;
}
/**
 * 链步骤：执行某角色，或显式的主脑整合步。
 *
 * `parallel: true` 表示「与上一步同批并行执行」——引擎把连续的并行步归入同一个
 * 波次（wave），一个波次内的角色同时开跑，波次之间仍严格串行（后一波看得到前
 * 面所有波次的产出）。首步的 parallel 无意义（自成一波）。
 */
export type ChainStep = {
    kind: 'role';
    roleId: string;
    taskNote?: string;
    parallel?: boolean;
} | {
    kind: 'synthesize';
    roleId?: string;
};
/** 协作接力链（串行）。 */
export interface Chain {
    id: string;
    name: string;
    steps: ChainStep[];
    /** 尾部自动追加主脑整合步（steps 里已有显式 synthesize 时不重复追加）。 */
    finalSynthesize: boolean;
}
/** 按需直连（纯语义 + 图上展示，不参与执行）。 */
export interface DirectLink {
    from: string;
    to: string;
    label?: string;
    kind: 'bidirectional' | 'directed';
}
/** 全局默认与执行偏好。 */
export interface TeamGlobals {
    /** 团队未设模型时的最终兜底（空 provider/model = 回退 agent 当前默认模型）。 */
    defaultModel: ModelBinding;
    /** 面板与对话框开关当前选中的团队。 */
    activeTeamId: string;
    /** 每步超时秒数。 */
    timeoutSec: number;
    /** 每步失败重试次数。 */
    maxRetries: number;
    /** 上游上下文窗口策略。 */
    upstreamWindow: 'last' | 'all-summary';
    /** 最大并发运行数。 */
    maxConcurrentRuns: number;
    /** 单个 Run 内「同一波次」的最大并发角色数（1 = 退回全串行）。 */
    maxParallel: number;
    /** 允许主脑在运行开始时自主编排派发计划（并行分组由模型决定）。 */
    autoPlan: boolean;
    /** 步骤输出注入上游时的截断长度（字符）。 */
    outputChunkChars: number;
    /** 某步失败是否终止整链。 */
    stopOnError: boolean;
    /** 主模型失败时自动尝试备用模型链（角色 fallbackModels → 团队 fallbackModels）。 */
    autoFallback: boolean;
}
/** 团队可覆盖的执行偏好子集（不含 defaultModel / activeTeamId）。 */
export type TeamOverrides = Partial<Omit<TeamGlobals, 'defaultModel' | 'activeTeamId'>>;
/** globals 默认值。 */
export declare const DEFAULT_GLOBALS: TeamGlobals;
/** 一个团队（一文件一团队）。 */
export interface Team {
    /** 写入时的存储契约版本。 */
    schemaVersion: number;
    id: string;
    name: string;
    description?: string;
    /** 团队默认模型：本团队角色的默认模型（角色可覆盖）。 */
    model: ModelBinding;
    /** 团队级备用模型链（角色未单独配置时继承本链）。 */
    fallbackModels?: FallbackModels;
    roles: Role[];
    chains: Chain[];
    directLinks: DirectLink[];
    overrides?: TeamOverrides;
    createdAt: string;
    updatedAt: string;
}
/** 团队清单项（列表接口的轻量投影）。 */
export interface TeamSummary {
    id: string;
    name: string;
    description?: string;
    model: ModelBinding;
    roleCount: number;
    chainCount: number;
    updatedAt: string;
    /** 文件损坏 / 版本过高时为 true（只读展示）。 */
    readonly?: boolean;
    /** 只读原因。 */
    issue?: string;
}
/** Run 状态。 */
export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';
/** RunStep 状态。 */
export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';
/**
 * 失败归类（容错决策的唯一依据，判定逻辑见 failure.ts）。
 *  - rate_limit   限流 / 并发超限（退避后重试有效）
 *  - timeout      本步超时
 *  - auth         鉴权失败（key 失效/无权限）
 *  - quota        额度/余额不足
 *  - network      网络层错误（DNS/连接/TLS/代理）
 *  - server       上游 5xx / 过载 / 未正常结束
 *  - model_missing 模型或供应商不存在
 *  - content      请求被拒（内容策略、参数非法、上下文超长）
 *  - cancelled    用户取消
 *  - unknown      未归类（保守重试）
 */
export type StepErrorKind = 'rate_limit' | 'timeout' | 'auth' | 'quota' | 'network' | 'server' | 'model_missing' | 'content' | 'cancelled' | 'unknown';
/** 单次尝试的执行记录（同一步的重试/降级轨迹，供详情卡展示「为什么失败、怎么救的」）。 */
export interface StepAttempt {
    /** 第几次尝试（1 起）。 */
    attempt: number;
    /** 本次尝试实际用的模型。 */
    model: ModelBinding;
    /** 是否为备用模型（主模型失败后降级）。 */
    fallback: boolean;
    status: 'done' | 'error';
    errorKind?: StepErrorKind;
    error?: string;
    startedAt: string;
    finishedAt: string;
    /** 失败后计划的退避毫秒（最后一次尝试无此字段）。 */
    backoffMs?: number;
}
/** 触发来源。 */
export type RunOrigin = 'panel' | 'chat-toggle' | 'tool';
/**
 * 步骤内的执行阶段（实时可见性的核心字段）。
 * `status=running` 时它回答「这一步现在到底在干什么」：
 *  - resolving  解析模型 / 装配能力
 *  - dispatch   已下发，等上游首个字节
 *  - thinking   正在推理（reasoning-delta 在长）
 *  - writing    正在产出正文（text-delta 在长）
 *  - tooling    子 agent 正在调用工具（phaseNote = 工具名）
 *  - retrying   本次尝试失败，退避等待中（phaseNote = 原因 + 倒计时目标）
 *  - saving     产物落盘 / 收尾
 */
export type StepPhase = 'resolving' | 'dispatch' | 'thinking' | 'writing' | 'tooling' | 'retrying' | 'saving';
/** 单步运行快照。 */
/** 子 agent 任务清单的单项（todo_write 参数的最小投影）。 */
export interface TodoItemLite {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}
export interface RunStep {
    index: number;
    roleId: string;
    /** 角色展示名（快照自带，避免 UI 反查团队）。 */
    roleName: string;
    /** 角色定位语（HUD 角色卡副标题）。 */
    tagline: string;
    group: RoleGroup;
    /** 是否为主脑整合步。 */
    synthesize: boolean;
    /**
     * 波次序号（0 起）：同一 wave 的步骤并发执行，wave 之间串行。
     * 全串行计划里 wave === index。旧快照缺省时 UI 按 index 兜底。
     */
    wave?: number;
    status: StepStatus;
    /** 当前执行阶段（status=running 时有意义；见 StepPhase）。 */
    phase?: StepPhase;
    /** 阶段补充说明（工具名 / 退避原因 / 降级说明，一行短句）。 */
    phaseNote?: string;
    /** 阶段进入时间（UI 用它显示「本阶段已持续 N 秒」）。 */
    phaseSince?: string;
    /** 截断后的输入快照。 */
    inputSnapshot: string;
    /** 截断后的输出（运行中为流式增量尾部）。 */
    output: string;
    /** 累计输出字符数（流式进度指示，快照截断不影响它）。 */
    outputChars?: number;
    /** 完整输出文件名（steps/ 目录下）。 */
    outputFile?: string;
    modelUsed: ModelBinding;
    modelSource: ModelSource;
    /** 本步是否降级到了备用模型（true = modelUsed 是 fallback 链里的）。 */
    fallbackUsed?: boolean;
    /** 实际执行通道。 */
    channel?: 'llm' | 'subagent';
    /** 本步实际生效的能力装配（无装配时缺省）。 */
    capabilities?: {
        toolMode: ToolMode;
        tools: string[];
        skillMode: SkillMode;
        skills: string[];
        missingTools?: string[];
        missingSkills?: string[];
        /** 通道相关说明（如 llm 通道工具装配仅作声明）。 */
        note?: string;
    };
    /** 通道降级 / 模型继承会话等提示。 */
    warning?: string;
    /**
     * 子 agent 的任务清单快照（截获其 todo_write 工具调用，每次全量覆盖）。
     * 仅 subagent 通道且子 agent 实际使用任务清单时存在。
     */
    todos?: TodoItemLite[];
    startedAt?: string;
    finishedAt?: string;
    error?: string;
    /** 失败归类（容错决策依据 + UI 徽标）。 */
    errorKind?: StepErrorKind;
    /** 已重试次数。 */
    retries?: number;
    /** 每次尝试的轨迹（重试与模型降级过程，最多保留 8 条）。 */
    attempts?: StepAttempt[];
    /**
     * 本步是否由「一键接续」重跑产生（resume 计数，0/缺省 = 首轮运行）。
     * 接续时会保留已完成步骤的产物，只重跑 error/skipped/pending 步骤。
     */
    resumeRound?: number;
}
/** 一次运行的完整快照（run.json）。 */
export interface Run {
    schemaVersion: number;
    id: string;
    teamId: string;
    teamName: string;
    /** null = 临时点兵（roles 序列）。 */
    chainId: string | null;
    chainName: string;
    task: string;
    status: RunStatus;
    origin: RunOrigin;
    sessionId?: string;
    modelOverrides?: Record<string, ModelBinding>;
    /** 计划来源：chain=预设链；roles=临时点兵；plan=调用方显式并行计划；auto=主脑自主编排。 */
    planMode?: PlanMode;
    /** 主脑自主编排时给出的分工理由（面板/HUD 展示）。 */
    planNote?: string;
    /** 波次数（steps 里 wave 的去重计数；并行运行的 UI 分层依据）。 */
    waveCount?: number;
    startedAt: string;
    finishedAt?: string;
    steps: RunStep[];
    error?: string;
    /** run 级失败归类（取第一个失败步骤的归类，或 run 级异常的归类）。 */
    errorKind?: StepErrorKind;
    /** 已执行的「一键接续」轮数（0/缺省 = 只跑过首轮）。 */
    resumeCount?: number;
    /** 最近一次接续时间。 */
    resumedAt?: string;
    /**
     * 是否可一键接续：存在 error/skipped/pending 步骤且运行已结束。
     * 由服务端在返回快照时计算（UI 不用自己推断状态机）。
     */
    resumable?: boolean;
    /** 最终交付物文件名（final-deliverable.md）。 */
    finalFile?: string;
}
/** Run 清单项（历史列表投影）。 */
export interface RunSummary {
    id: string;
    teamId: string;
    teamName: string;
    chainName: string;
    task: string;
    status: RunStatus;
    origin: RunOrigin;
    /** 发起会话 id（面板/工具触发时写入；用于按会话隔离展示）。 */
    sessionId?: string;
    startedAt: string;
    finishedAt?: string;
    /** 完成步数 / 总步数。 */
    doneSteps: number;
    totalSteps: number;
}
/** 启动运行的入参。 */
export interface StartRunInput {
    teamId: string;
    /** 链 id；与 roles / plan 三选一。 */
    chainId?: string;
    /** 临时点兵的角色 id 序列（chainId 缺省时使用）。 */
    roles?: string[];
    /**
     * 显式并行计划：一个数组元素 = 一个波次，波次内的角色并发执行，波次之间串行。
     * 例：`[['cha','ping'],['jiang']]` = 察与评同时跑，完成后驳/匠再跑。
     * 优先级高于 chainId / roles。
     */
    plan?: PlanWave[];
    task: string;
    modelOverrides?: Record<string, ModelBinding>;
    origin?: RunOrigin;
    sessionId?: string;
    /** 临时点兵是否追加主脑整合（默认 true）。 */
    synthesize?: boolean;
    /** 主脑自主编排：运行开始时先让主脑给出派发计划（并行分组），再据此执行。 */
    autoPlan?: boolean;
}
/** 计划来源。 */
export type PlanMode = 'chain' | 'roles' | 'plan' | 'auto';
/** 一个波次的角色项（可带本步任务说明）。 */
export interface PlanWaveItem {
    roleId: string;
    taskNote?: string;
}
/** 一个波次：角色 id 数组或带说明的对象数组。 */
export type PlanWave = Array<string | PlanWaveItem>;
/**
 * 归一化并行计划：过滤非法角色、去掉空波次、限制规模。
 * 同一波次内重复角色去重（同一角色在一个波次里跑两次没有意义）。
 */
export declare function normalizePlan(input: unknown, knownRoleIds: ReadonlySet<string>, limits?: {
    maxWaves?: number;
    maxPerWave?: number;
}): PlanWaveItem[][];
/** 一个会话的团队模式状态。 */
export interface ChatModeState {
    enabled: boolean;
    /** 团队模式选定的团队（面板 + 开关共用的会话级当前团队）。 */
    teamId: string;
    /** '' = 自动选择链 / 由主脑判断。 */
    chainId: string;
    /** 强制模式：注入更强措辞要求每个任务都先走 team_run。 */
    force: boolean;
    /** 最后更新时间（用于淘汰）。 */
    updatedAt: string;
}
/** chat-mode 默认值。 */
export declare const DEFAULT_CHAT_MODE: ChatModeState;
/** 带 code/status 的可识别错误（路由层转 HTTP 状态码）。 */
export declare class TeamError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(message: string, code: string, status?: number);
}
/** 归一化模型绑定；provider/model 皆空时返回 null。 */
export declare function normalizeBinding(input: unknown): ModelBinding | null;
/**
 * 归一化备用模型链：逐项过滤非法绑定、去重（provider/model 同值只留一个）、限长。
 * 空链返回 undefined（不写进文件，保持编制文件干净）。
 */
export declare function normalizeFallbackModels(input: unknown): FallbackModels | undefined;
/**
 * 归一化能力装配；完全等价于默认值时返回 undefined（不写进文件，保持编制文件干净）。
 * allow/deny 模式但名单为空视为无意义 → 回退 inherit（避免"白名单空 = 屏蔽全部工具"的坑）。
 */
export declare function normalizeCapabilities(input: unknown): RoleCapabilities | undefined;
/** 读角色的有效能力装配（缺省补默认）。 */
export declare function capabilitiesOf(role: Role): RoleCapabilities;
/** 归一化角色：补默认值、校验枚举，非法 id 抛错。 */
export declare function normalizeRole(input: unknown): Role;
/** 归一化链条。 */
export declare function normalizeChain(input: unknown): Chain;
/** 团队 id 合法性（同时用作文件名，必须严格）。 */
export declare function isValidTeamId(id: string): boolean;
/**
 * 归一化整个团队文档：补默认、去重角色/链 id、丢弃指向不存在角色的链步骤与直连。
 * 抛 TeamError 表示数据不可用（id 非法等）。
 */
export declare function normalizeTeam(input: unknown): Team;
/** 归一化 globals（缺省用 DEFAULT_GLOBALS）。 */
export declare function normalizeGlobals(input: unknown): TeamGlobals;
/** 归一化单个会话的团队模式状态。 */
export declare function normalizeChatMode(input: unknown): ChatModeState;
/** 合并团队覆盖到 globals，得到本次运行的有效执行偏好。 */
export declare function effectiveGlobals(globals: TeamGlobals, team: Team | null): TeamGlobals;
