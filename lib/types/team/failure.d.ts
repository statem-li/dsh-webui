/**
 * team — 失败归类 / 退避策略（host 半身）。
 *
 * 一次步骤失败要回答三个问题，全部集中在本文件，engine 只负责按结论行动：
 *  1. 这是什么错？        classifyFailure(message) → StepErrorKind
 *  2. 原地重试有意义吗？  isRetryable(kind)
 *  3. 换个模型有意义吗？  shouldFallback(kind)
 *  4. 等多久再试？        backoffMs(kind, attempt)（指数退避 + 抖动，限流额外拉长；
 *                         上游若在报错文本里带了 Retry-After/"try again in 12s"
 *                         则优先采纳它）
 *
 * 归类只看错误文本（provider 错误经 llm 服务后已被拍平成字符串），所以匹配规则
 * 走「关键词 + 状态码」双路，宁可归到 unknown（保守重试一次）也不误判成不可重试。
 */
import type { StepErrorKind } from './types.js';
/** 失败归类：只看错误文本，命中不了归 unknown。 */
export declare function classifyFailure(message: string): StepErrorKind;
/** 归类的中文短标签（UI 徽标 + 步骤错误前缀）。 */
export declare function failureLabel(kind: StepErrorKind): string;
/** 用户可操作的处置建议（详情卡展示，直接告诉用户下一步做什么）。 */
export declare function failureAdvice(kind: StepErrorKind): string;
/** 原地重试是否有意义（同一个模型再试一次）。 */
export declare function isRetryable(kind: StepErrorKind): boolean;
/** 换备用模型是否有意义（同一个模型/供应商已经没戏了）。 */
export declare function shouldFallback(kind: StepErrorKind): boolean;
/**
 * 从报错文本里抓上游给的「等多久」提示（Retry-After / try again in 12s / 后 30 秒重试）。
 * 命中返回毫秒，未命中返回 null。
 */
export declare function retryAfterHint(message: string): number | null;
/**
 * 退避时长：指数 + ±25% 抖动（避免并行波次的多个步骤同时撞同一个限流窗口）。
 * `hintMs`（上游 Retry-After）优先，但仍受上限约束。
 */
export declare function backoffMs(kind: StepErrorKind, attempt: number, hintMs?: number | null): number;
