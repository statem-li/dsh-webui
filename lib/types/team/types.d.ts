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
 * 角色在编制图上的位置（归一化 0..1，相对画布宽高）。
 * 缺省 = 前端按环形自动布局；用户拖拽后写入并持久化。
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
/** 链步骤：执行某角色，或显式的主脑整合步。 */
export type ChainStep = {
    kind: 'role';
    roleId: string;
    taskNote?: string;
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
    /** 步骤输出注入上游时的截断长度（字符）。 */
    outputChunkChars: number;
    /** 某步失败是否终止整链。 */
    stopOnError: boolean;
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
/** 触发来源。 */
export type RunOrigin = 'panel' | 'chat-toggle' | 'tool';
/** 单步运行快照。 */
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
    status: StepStatus;
    /** 截断后的输入快照。 */
    inputSnapshot: string;
    /** 截断后的输出（运行中为流式增量尾部）。 */
    output: string;
    /** 完整输出文件名（steps/ 目录下）。 */
    outputFile?: string;
    modelUsed: ModelBinding;
    modelSource: ModelSource;
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
    startedAt?: string;
    finishedAt?: string;
    error?: string;
    /** 已重试次数。 */
    retries?: number;
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
    startedAt: string;
    finishedAt?: string;
    steps: RunStep[];
    error?: string;
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
    startedAt: string;
    finishedAt?: string;
    /** 完成步数 / 总步数。 */
    doneSteps: number;
    totalSteps: number;
}
/** 启动运行的入参。 */
export interface StartRunInput {
    teamId: string;
    /** 链 id；与 roles 二选一。 */
    chainId?: string;
    /** 临时点兵的角色 id 序列（chainId 缺省时使用）。 */
    roles?: string[];
    task: string;
    modelOverrides?: Record<string, ModelBinding>;
    origin?: RunOrigin;
    sessionId?: string;
    /** 临时点兵是否追加主脑整合（默认 true）。 */
    synthesize?: boolean;
}
/** 一个会话的团队模式状态。 */
export interface ChatModeState {
    enabled: boolean;
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
