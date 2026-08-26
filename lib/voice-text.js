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
/** 单次播报文本上限（安全网：防止极端长文一次性灌给引擎；正常播报不触发）。 */
export const SPEECH_MAX_CHARS = 600;
/** 句子最短长度：短于此长度的片段并入下一句，避免「好。」这类碎念。 */
const MIN_SENTENCE_CHARS = 4;
/** 句末标点（中英文）。 */
const SENTENCE_END = /[。！？!?…]|\.\s|;|；|\n/;
/**
 * Markdown → 朗读文本。
 * @param input - 原始 Markdown（可为流式半截文本）。
 * @returns 适合朗读的纯文本（可能为空串，表示这段没有可念内容）。
 */
export function sanitizeForSpeech(input) {
    if (typeof input !== 'string' || input === '')
        return '';
    let text = input;
    // 围栏代码块（含未闭合的流式围栏）整块丢弃：念代码没有意义。
    text = text.replace(/```[\s\S]*?(?:```|$)/g, ' ');
    text = text.replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ');
    // 图片 / 链接：图片丢弃，链接只留可读文字。
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    // 行内代码：留内容去反引号（短标识符念出来仍有信息量）。
    text = text.replace(/`([^`]*)`/g, '$1');
    const lines = [];
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line === '')
            continue;
        // 表格行、分隔线、HTML 标签行：跳过。
        if (/^\|/.test(line) || /^[-=*_]{3,}$/.test(line))
            continue;
        if (/^<[^>]+>$/.test(line))
            continue;
        let body = line;
        body = body.replace(/^#{1,6}\s+/, ''); // 标题井号
        body = body.replace(/^>\s?/, ''); // 引用
        body = body.replace(/^[-*+]\s+/, ''); // 无序列表
        body = body.replace(/^\d+[.)]\s+/, ''); // 有序列表
        body = body.replace(/^\[[ x]\]\s*/i, ''); // 任务勾选
        body = body.replace(/(\*\*|__)(.*?)\1/g, '$2'); // 粗体
        body = body.replace(/(\*|_)(.*?)\1/g, '$2'); // 斜体
        body = body.replace(/~~(.*?)~~/g, '$1'); // 删除线
        body = body.replace(/https?:\/\/\S+/g, '链接'); // 裸链接
        body = body.replace(/<[^>]+>/g, ''); // 行内 HTML
        // emoji 与装饰性符号：去掉（引擎会念成奇怪的名字或直接卡顿）。
        body = body.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, ' ');
        body = body.replace(/\s{2,}/g, ' ').trim();
        if (body === '')
            continue;
        lines.push(body);
    }
    return lines.join('\n');
}
/**
 * 把文本切成完整句子；末尾未收尾的部分作为 rest 返回。
 * @param input - 已清洗（或未清洗）的文本。
 * @param options - final 为 true 时把残句也算作完整句（回合结束收尾）。
 * @returns 句子列表与残句。
 */
export function segmentSentences(input, options = {}) {
    const text = typeof input === 'string' ? input : '';
    const sentences = [];
    let buffer = '';
    let pending = '';
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        buffer += char;
        if (!SENTENCE_END.test(char))
            continue;
        // 收尾标点后可能还跟着引号/括号，一并吞掉再断句。
        while (index + 1 < text.length && /["'）」』】\)\]]/.test(text[index + 1])) {
            index += 1;
            buffer += text[index];
        }
        const candidate = (pending + buffer).trim();
        buffer = '';
        if (candidate === '') {
            pending = '';
            continue;
        }
        if (candidate.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_SENTENCE_CHARS) {
            // 太短：并入下一句，避免逐字碎念。
            pending = candidate + ' ';
            continue;
        }
        pending = '';
        sentences.push(candidate);
    }
    const rest = (pending + buffer).trim();
    if (options.final === true && rest !== '') {
        return { sentences: [...sentences, rest], rest: '' };
    }
    return { sentences, rest };
}
/** 结论/成果类线索词：命中越多越像「做完了什么 / 为什么 / 解决了什么」。 */
const OUTCOME_HINTS = [
    '已', '完成', '搞定', '修复', '解决', '修正', '改为', '改成', '新增', '删除', '替换',
    '原因', '因为', '由于', '导致', '所以', '因此', '结论', '结果', '现在',
    '失败', '报错', '无法', '不能', '缺少', '冲突', 'root cause',
];
/** 过程/铺垫类线索词：这类句子对播报没有价值，压低权重。 */
const PROCESS_HINTS = [
    '让我', '我将', '我来', '接下来', '下面', '首先', '正在', '开始', '先看', '稍等',
    '如下', '示例', '例如', '如下所示', '可以看到', '如上',
];
/** 一句话里线索词命中数。 */
function hitCount(sentence, hints) {
    const lower = sentence.toLowerCase();
    let count = 0;
    for (const hint of hints)
        if (lower.includes(hint))
            count += 1;
    return count;
}
/**
 * 从一段回复里提取「做完了什么 / 什么原因 / 解决了什么问题」的短总结。
 *
 * 播报的价值是结论，不是复述过程：按结论线索词与句子位置打分，取最多两句
 * 原序拼接；不限制字数，只受 {@link SPEECH_MAX_CHARS} 安全网约束。零 token、零延迟。
 *
 * @param text - 助手回复正文（Markdown 或已清洗文本皆可）。
 * @param limit - 字符上限（安全网，默认 {@link SPEECH_MAX_CHARS}）。
 * @returns 一句（或两句）可直接朗读的总结；无可播内容返回空串。
 */
export function outcomeSummary(text, limit = SPEECH_MAX_CHARS) {
    const body = sanitizeForSpeech(text).trim();
    if (body === '')
        return '';
    const sentences = body
        .split(/(?<=[。！？!?…])\s*|\n+/)
        .map(piece => piece.trim())
        .filter(piece => piece.replace(/[^\p{L}\p{N}]/gu, '').length >= 4);
    if (sentences.length === 0)
        return clampSpeech(body, limit);
    const scored = sentences.slice(0, 12).map((sentence, index) => ({
        index,
        sentence,
        score: hitCount(sentence, OUTCOME_HINTS) * 2
            - hitCount(sentence, PROCESS_HINTS) * 2
            // 结论通常在开头（本项目的写作规范是先给结论）或收尾。
            + (index === 0 ? 3 : index <= 2 ? 2 : 0)
            + (index === sentences.length - 1 ? 1 : 0)
            // 太长的句子念起来就是长篇，轻微降权。
            - (sentence.length > limit ? 2 : 0),
    }));
    const picked = [...scored]
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, 2)
        .sort((a, b) => a.index - b.index);
    let out = '';
    for (const item of picked) {
        if (out !== '' && out.length + item.sentence.length > limit)
            break;
        out += item.sentence;
        if (out.length >= limit)
            break;
    }
    return clampSpeech(out === '' ? (picked[0]?.sentence ?? sentences[0] ?? body) : out, limit);
}
/**
 * 截断到引擎上限（按句边界优先，避免把半句喂进去）。
 * @param text - 待播报文本。
 * @param limit - 字符上限（默认 {@link SPEECH_MAX_CHARS}）。
 * @returns 截断后的文本。
 */
export function clampSpeech(text, limit = SPEECH_MAX_CHARS) {
    const body = text.trim();
    if (body.length <= limit)
        return body;
    const head = body.slice(0, limit);
    const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('\n'));
    return cut > limit * 0.5 ? head.slice(0, cut + 1) : head;
}
//# sourceMappingURL=voice-text.js.map