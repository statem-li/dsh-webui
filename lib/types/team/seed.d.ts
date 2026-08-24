/**
 * team — 出厂默认团队播种数据（docs/TEAM-ORCHESTRA.md §8）。
 *
 * 角色 model 一律为 null（继承团队默认模型），label 保留参考图上的模型短名作为提示；
 * 用户只需在面板设一次「团队默认模型」即可跑通，之后再按需逐角色覆盖。
 */
import { type Team } from './types.js';
/** 默认团队 id / 名称。 */
export declare const DEFAULT_TEAM_ID = "t-liang-all";
export declare const DEFAULT_TEAM_NAME = "\u5C0F\u51C9\u5168\u80FD\u56E2";
/** 构造出厂默认团队（深拷贝，避免调用方改到常量）。 */
export declare function buildDefaultTeam(id?: string, name?: string): Team;
/** 构造一个空白团队（只含主脑 + 一条空链）。 */
export declare function buildEmptyTeam(id: string, name: string): Team;
