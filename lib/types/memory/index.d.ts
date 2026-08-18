/**
 * dsh-memory 插件入口（host half）：本地文件记忆引擎。
 * 挂载：
 * - session/event → turn/end 捕获 → LLM 提取候选 → 直接入库 + changes 变更流
 * - ticker → 每 N 轮增量编译 / 会话结束 final 编译 / 每日编译（衰减+折叠+滚出+daily）
 * - agent/pre-step → 记忆注入（带来源 user message，绝不写 system prompt）
 * - tools → memory_search / memory_remember / memory_pin / memory_tag / memory_forget
 * - webServer → /api/dsh-memory/*（面板数据 + 裁决操作）
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from './types.js';
/** Stable Cordis plugin name。 */
export declare const name = "dsh-memory";
/** 硬依赖服务。 */
export declare const inject: string[];
/** 应用入口。 */
export declare function applyMemory(ctx: Context, input: Partial<MemoryConfig> | undefined): void;
