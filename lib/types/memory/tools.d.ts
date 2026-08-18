/**
 * dsh-memory 模型工具：AI 在对话中可主动调用的记忆操作。
 * memory_search / memory_remember / memory_pin / memory_tag / memory_forget。
 * 全部经 @deepseek-ai/dsh-tools 的 defineTool 注册，输出为模型可见文本。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryConfig } from './types.js';
import { type MemoryStore } from './engine/store.js';
/** 注册全部记忆工具，返回合并 disposer。 */
export declare function registerMemoryTools(ctx: Context, store: MemoryStore, _config: MemoryConfig): () => void;
