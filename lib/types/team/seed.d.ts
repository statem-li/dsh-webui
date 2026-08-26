/**
 * team — 出厂默认团队播种数据（docs/TEAM-ORCHESTRA.md §8）。
 *
 * 角色 model 一律为 null（继承团队默认模型），executor 默认 auto；
 * 用户只需在面板设一次「团队默认模型」即可跑通，之后再按需逐角色覆盖。
 * 以下角色/链/直连均来自当前实际使用的团队预设 t-mt8v11xo「软件工程全流程团队」，
 * prompt 逐字复制自该团队文件，不得改动。
 */
import { type Team } from './types.js';
/** 默认团队 id / 名称。 */
export declare const DEFAULT_TEAM_ID = "t-mt8v11xo";
export declare const DEFAULT_TEAM_NAME = "\u8F6F\u4EF6\u5DE5\u7A0B\u5168\u6D41\u7A0B\u56E2\u961F";
/** 构造出厂默认团队（深拷贝，避免调用方改到常量）。 */
export declare function buildDefaultTeam(id?: string, name?: string): Team;
/** 构造一个空白团队（只含主脑 + 一条空链）。 */
export declare function buildEmptyTeam(id: string, name: string): Team;
