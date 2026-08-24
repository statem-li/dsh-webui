/**
 * webui — 语音播报文本处理（host / client 两端共用，零依赖纯函数）。
 *
 * 播报的文本来自 Markdown 流式输出，直接念会把 ``` 围栏、表格、链接、
 * emoji 一起念出来。本模块负责两件事：
 *
 *  1. {@link sanitizeForSpeech}：Markdown → 适合朗读的纯文本
 *     （代码块/表格/图片整块丢弃，链接只留文字，标记符号剥离）。
 *  2. {@link segmentSentences}：把（可能仍在增长的）文本切成完整句子，
 *     返回「已完成的句子 + 尾部未完成残句」，供实时播报边生成边念。
 *
 * 两端共用同一份实现：client 判断该念哪一句，host 落到语音引擎前再兜底
 * 清洗一次（避免旧 client / 直接调 API 时把 Markdown 念出来）。
 */
/** 单次播报文本上限（超出截断；防止把长文一次性灌给引擎）。 */
export declare const SPEECH_MAX_CHARS = 600;
/**
 * Markdown → 朗读文本。
 * @param input - 原始 Markdown（可为流式半截文本）。
 * @returns 适合朗读的纯文本（可能为空串，表示这段没有可念内容）。
 */
export declare function sanitizeForSpeech(input: string): string;
/** 分句结果：完整句子列表 + 尾部未完成残句。 */
export interface Segmented {
    /** 已以句末标点收尾的句子（已清洗、已合并过短片段）。 */
    readonly sentences: readonly string[];
    /** 尾部还没收尾的残句（下次有新文字时继续攒）。 */
    readonly rest: string;
}
/**
 * 把文本切成完整句子；末尾未收尾的部分作为 rest 返回。
 * @param input - 已清洗（或未清洗）的文本。
 * @param options - final 为 true 时把残句也算作完整句（回合结束收尾）。
 * @returns 句子列表与残句。
 */
export declare function segmentSentences(input: string, options?: {
    final?: boolean;
}): Segmented;
/**
 * 截断到引擎上限（按句边界优先，避免把半句喂进去）。
 * @param text - 待播报文本。
 * @param limit - 字符上限（默认 {@link SPEECH_MAX_CHARS}）。
 * @returns 截断后的文本。
 */
export declare function clampSpeech(text: string, limit?: number): string;
