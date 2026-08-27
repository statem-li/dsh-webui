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
/** 退避基数与上限。 */
const BACKOFF_BASE_MS = 1_500;
const BACKOFF_MAX_MS = 60_000;
/** 限流单独一套更长的退避（供应商配额窗口通常按分钟计）。 */
const RATE_LIMIT_BASE_MS = 8_000;
const RATE_LIMIT_MAX_MS = 90_000;
/** 归类用的关键词表（小写匹配）。顺序即优先级。 */
const RULES = [
    {
        kind: 'cancelled',
        patterns: [/已取消/, /aborted/, /abort(ed)? ?error/, /canceled/, /cancelled/],
    },
    {
        kind: 'timeout',
        patterns: [/本步超时/, /timed? ?out/, /timeout/, /etimedout/, /deadline exceeded/, /\b504\b/, /\b408\b/],
    },
    {
        kind: 'rate_limit',
        patterns: [/rate ?limit/, /too many requests/, /\b429\b/, /请求过于频繁/, /限流/, /tpm|rpm limit/, /concurrency limit/],
    },
    {
        kind: 'quota',
        patterns: [/quota/, /insufficient/, /balance/, /余额/, /欠费/, /credit/, /billing/, /\b402\b/, /exceeded your current/],
    },
    {
        kind: 'auth',
        patterns: [/unauthorized/, /\b401\b/, /\b403\b/, /forbidden/, /invalid api ?key/, /api key/, /认证/, /鉴权/, /credential/],
    },
    {
        kind: 'model_missing',
        patterns: [
            /不在已配置的供应商/, /没有可用模型/, /model_not_found/, /model not found/, /unknown model/,
            /does not exist/, /\b404\b/, /unsupported model/, /provider .* not found/,
        ],
    },
    {
        kind: 'content',
        patterns: [
            /content ?filter/, /content policy/, /safety/, /违规/, /敏感/, /\b400\b/,
            /invalid ?request/, /invalid_parameter/, /context length/, /maximum context/, /too long/,
        ],
    },
    {
        kind: 'network',
        patterns: [
            /econnreset/, /econnrefused/, /enotfound/, /eai_again/, /socket hang up/, /network/,
            /fetch failed/, /tls/, /certificate/, /dns/, /proxy/,
        ],
    },
    {
        kind: 'server',
        patterns: [
            /\b5\d\d\b/, /internal (server )?error/, /bad gateway/, /service unavailable/,
            /overloaded/, /server ?error/, /upstream/, /temporar(y|ily)/,
            /未正常结束/, /未返回内容/, /模型调用失败/,
        ],
    },
];
/** 失败归类：只看错误文本，命中不了归 unknown。 */
export function classifyFailure(message) {
    const text = message.toLowerCase();
    if (text.trim() === '')
        return 'unknown';
    for (const rule of RULES) {
        if (rule.patterns.some(pattern => pattern.test(text)))
            return rule.kind;
    }
    return 'unknown';
}
/** 归类的中文短标签（UI 徽标 + 步骤错误前缀）。 */
export function failureLabel(kind) {
    switch (kind) {
        case 'rate_limit': return '限流';
        case 'timeout': return '超时';
        case 'auth': return '鉴权失败';
        case 'quota': return '额度不足';
        case 'network': return '网络异常';
        case 'server': return '上游错误';
        case 'model_missing': return '模型不可用';
        case 'content': return '请求被拒';
        case 'cancelled': return '已取消';
        default: return '未知错误';
    }
}
/** 用户可操作的处置建议（详情卡展示，直接告诉用户下一步做什么）。 */
export function failureAdvice(kind) {
    switch (kind) {
        case 'rate_limit': return '供应商限流：已自动退避重试；持续失败可降低并行数（maxParallel）或换备用模型后一键接续。';
        case 'timeout': return '本步超时：可提高团队设置的单步超时秒数，或把任务拆细后一键接续。';
        case 'auth': return '鉴权失败：检查该供应商的 API key 是否有效，修好后一键接续即可续跑失败步骤。';
        case 'quota': return '额度不足：充值或换一个供应商（角色/团队备用模型），再一键接续。';
        case 'network': return '网络异常：检查网络与代理设置，恢复后一键接续。';
        case 'server': return '上游服务异常：通常是临时故障，已自动退避重试；仍失败可稍后一键接续。';
        case 'model_missing': return '模型不可用：到团队设置重选模型（或为角色配置备用模型），再一键接续。';
        case 'content': return '请求被上游拒绝（内容策略/参数/上下文超长）：调整任务描述或缩小上下文预算后重跑本步。';
        case 'cancelled': return '运行被取消：可一键接续从未完成的步骤继续。';
        default: return '未归类错误：查看下方原始报错；修正后可一键接续，只重跑未完成的步骤。';
    }
}
/** 原地重试是否有意义（同一个模型再试一次）。 */
export function isRetryable(kind) {
    switch (kind) {
        case 'rate_limit':
        case 'timeout':
        case 'network':
        case 'server':
        case 'unknown':
            return true;
        default:
            return false;
    }
}
/** 换备用模型是否有意义（同一个模型/供应商已经没戏了）。 */
export function shouldFallback(kind) {
    switch (kind) {
        // 供应商侧的账号/额度/模型问题：同一个模型再试也是白试，换供应商才有机会。
        case 'auth':
        case 'quota':
        case 'model_missing':
        case 'rate_limit':
        case 'server':
        case 'timeout':
        case 'network':
        case 'unknown':
            return true;
        // 内容策略/参数错误换模型通常同样被拒，且取消无需 fallback。
        case 'content':
        case 'cancelled':
            return false;
        default:
            return true;
    }
}
/**
 * 从报错文本里抓上游给的「等多久」提示（Retry-After / try again in 12s / 后 30 秒重试）。
 * 命中返回毫秒，未命中返回 null。
 */
export function retryAfterHint(message) {
    const text = message.toLowerCase();
    const patterns = [
        { re: /retry[- ]after[":\s]+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/, unit: 1000 },
        { re: /try again in\s+(\d+(?:\.\d+)?)\s*(?:ms|milliseconds)/, unit: 1 },
        { re: /try again in\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds|秒)/, unit: 1000 },
        { re: /(\d+(?:\.\d+)?)\s*秒后(?:再)?重试/, unit: 1000 },
        { re: /wait\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds|秒)/, unit: 1000 },
    ];
    for (const { re, unit } of patterns) {
        const hit = text.match(re);
        if (hit === null)
            continue;
        const value = Number.parseFloat(hit[1]);
        if (!Number.isFinite(value) || value <= 0)
            continue;
        return Math.min(RATE_LIMIT_MAX_MS, Math.round(value * unit));
    }
    return null;
}
/**
 * 退避时长：指数 + ±25% 抖动（避免并行波次的多个步骤同时撞同一个限流窗口）。
 * `hintMs`（上游 Retry-After）优先，但仍受上限约束。
 */
export function backoffMs(kind, attempt, hintMs) {
    if (hintMs !== undefined && hintMs !== null && hintMs > 0) {
        return Math.min(RATE_LIMIT_MAX_MS, Math.max(500, hintMs));
    }
    const rate = kind === 'rate_limit' || kind === 'quota';
    const base = rate ? RATE_LIMIT_BASE_MS : BACKOFF_BASE_MS;
    const cap = rate ? RATE_LIMIT_MAX_MS : BACKOFF_MAX_MS;
    const raw = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
    const jitter = 1 + (Math.random() - 0.5) * 0.5;
    return Math.max(500, Math.round(raw * jitter));
}
//# sourceMappingURL=failure.js.map