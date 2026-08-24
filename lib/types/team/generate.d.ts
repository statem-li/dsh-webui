/**
 * team — 一句话生成团队（host 半身）。
 *
 * 输入一句自然语言需求（如「做一个短视频内容团队，要能选题、写脚本、审稿」），
 * 用 ctx.llm 生成一份完整团队编制 JSON（角色 + 提示词 + 分组 + 协作链 + 直连），
 * 校验归一化后落盘为一个新团队。
 *
 * 设计要点：
 *  - **模型只产结构，不产模型绑定**：角色 model 一律 null（继承团队默认），
 *    团队默认模型由用户在面板选——避免模型编造不存在的 provider/model。
 *  - 输出用严格 JSON schema 约束 + 稳健解析（容忍 markdown 围栏与前后缀噪声）。
 *  - 生成失败/超时/解析失败一律抛可读错误，不写半成品团队。
 */
import { type Team } from './types.js';
import type { TeamStore } from './store.js';
/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any;
/** 生成入参。 */
export interface GenerateTeamInput {
    /** 一句话需求。 */
    brief: string;
    /** 可选：生成用模型（缺省用全局默认 / agent 当前默认）。 */
    provider?: string;
    model?: string;
    /** 可选：团队默认模型（生成后直接写入，省一次手动设置）。 */
    teamModel?: {
        provider: string;
        model: string;
    };
    signal?: AbortSignal;
}
/**
 * 一句话生成团队并落盘，返回新团队。
 * 生成失败不产生任何团队文件。
 */
export declare function generateTeam(ctx: AnyContext, store: TeamStore, input: GenerateTeamInput): Promise<Team>;
/** 供工具/路由复用的简介：生成模型能力说明。 */
export declare const GENERATE_HINT = "\u7528\u4E00\u53E5\u8BDD\u63CF\u8FF0\u4F60\u8981\u7684\u56E2\u961F\uFF08\u505A\u4EC0\u4E48\u3001\u9700\u8981\u54EA\u4E9B\u73AF\u8282\uFF09\uFF0C\u6A21\u578B\u4F1A\u751F\u6210\u5B8C\u6574\u89D2\u8272\u7F16\u5236\u4E0E\u534F\u4F5C\u94FE\uFF1B\u6A21\u578B\u7ED1\u5B9A\u4E0D\u7531\u751F\u6210\u51B3\u5B9A\uFF0C\u751F\u6210\u540E\u5728\u9762\u677F\u9009\u56E2\u961F\u9ED8\u8BA4\u6A21\u578B\u5373\u53EF\u3002";
export {};
