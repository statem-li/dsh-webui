/**
 * team — 角色能力装配解析（host 半身）。
 *
 * 两类能力：
 *  1. **插件工具**：来源 = `ctx.tools.schemas()`（当前进程注册的全部工具，含各插件贡献的）。
 *     角色可选 inherit / allow（白名单）/ deny（黑名单）。
 *  2. **技能与技能包**：来源 = `ctx.skills.list()`（DSH 技能注册表）+ 技能包账本
 *     `${DSH_AGENTS_HOME}/skills/.bundles.json`（与 skill-toggles / 技能管理面板同一份）。
 *     角色可选 inherit / allow（只装配所选技能与包）/ none（不用技能）。
 *
 * 生效路径（按执行通道分流，见 engine.ts）：
 *  - `subagent` 通道：tools 解析成 `ToolRestriction` 交给 `subagents.start({ toolFilter })`
 *    —— 真实限制（工具从子 agent 提示词消失且拒绝执行）；技能白名单以提示词形式下发，
 *    子 agent 用 `skill` 工具自行加载。
 *  - `llm` 直跑通道：本无工具，tools 只作提示声明；技能则**把正文内联进 system**
 *    （按预算截断）——llm 通道唯一能真正"装配"技能的方式。
 */
import { type Role, type RoleCapabilities } from './types.js';
/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any;
/** 一个可装配的工具。 */
export interface ToolOption {
    name: string;
    description: string;
}
/** 一个可装配的技能。 */
export interface SkillOption {
    name: string;
    description: string;
    /** 是否对模型可调用（禁用的技能仍列出但标注）。 */
    modelInvocable: boolean;
}
/** 一个技能包。 */
export interface BundleOption {
    id: string;
    name: string;
    skills: string[];
}
/** 能力目录（工具 + 技能 + 技能包）。 */
export interface CapabilityCatalog {
    tools: ToolOption[];
    skills: SkillOption[];
    bundles: BundleOption[];
}
/** 读取当前进程注册的全部工具（名称 + 描述首句）。 */
export declare function listTools(ctx: AnyContext): ToolOption[];
/** 读取技能注册表（失败返回空数组，不抛）。 */
export declare function listSkills(ctx: AnyContext): Promise<SkillOption[]>;
/** 读技能包账本（与 skill-toggles 同一份文件）。 */
export declare function listBundles(): Promise<BundleOption[]>;
/** 组装完整能力目录（供 UI 的 /capabilities 接口）。 */
export declare function capabilityCatalog(ctx: AnyContext): Promise<CapabilityCatalog>;
/** DSH 的 ToolRestriction 形状（subagents.start 的 toolFilter）。 */
export interface ToolRestrictionLike {
    allow?: readonly string[];
    deny?: readonly string[];
}
/** 一个角色解析后的能力。 */
export interface ResolvedCapabilities {
    /** subagent 通道用的工具过滤器；inherit 时为 null（不限制）。 */
    toolFilter: ToolRestrictionLike | null;
    /** 提示词里声明的工具名单（allow 模式=可用清单，deny 模式=禁用清单）。 */
    toolNames: string[];
    toolMode: RoleCapabilities['toolMode'];
    /** 展开后的技能名（skills + 包内技能，去重）。 */
    skillNames: string[];
    skillMode: RoleCapabilities['skillMode'];
    /** 名单里在当前环境找不到的项（UI/运行记录里提示，不阻断执行）。 */
    missingTools: string[];
    missingSkills: string[];
}
/**
 * 解析角色能力：展开技能包、剔除当前环境不存在的名字（记入 missing*），
 * 生成 subagent 通道可用的 toolFilter。
 */
export declare function resolveCapabilities(ctx: AnyContext, role: Role, catalog?: CapabilityCatalog): Promise<ResolvedCapabilities>;
/**
 * 生成能力声明片段（两个通道都用）：说明本角色可用/禁用的工具与允许使用的技能。
 * 无任何装配时返回空串。
 */
export declare function renderCapabilityNotice(resolved: ResolvedCapabilities, channel: 'llm' | 'subagent'): string;
/**
 * llm 直跑通道的技能内联：把所选技能的正文按预算拼进 system。
 * 这是 llm 通道唯一能"装配"技能的方式（该通道无 `skill` 工具）。
 * 读取失败的技能静默跳过。
 */
export declare function renderInlineSkills(ctx: AnyContext, resolved: ResolvedCapabilities): Promise<string>;
/** 技能目录自检：两个技能根是否存在（供诊断用）。 */
export declare function skillRootsStatus(): Promise<Array<{
    root: string;
    count: number;
}>>;
export {};
