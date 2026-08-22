/**
 * perf-bench — 供应商模型推理性能基准测试（host 半身）。
 *
 * 五项核心指标（全部基于 OpenAI 兼容 /chat/completions）：
 *  1. TTFT    首 token 延迟：请求发出 → 首个流式 chunk（含推理链）的耗时 ms
 *  2. TPS     解码吞吐：completion_tokens ÷（末 chunk − 首 chunk）tok/s
 *  3. E2E     端到端延迟：请求发出 → 最后一个 chunk 的总耗时 ms
 *  4. RPS     并发吞吐：并发 4 × 共 8 个短请求的非流式 wall-clock，req/s
 *  5. Prefill 预填充速度：prompt_tokens ÷ 长 prompt 的 TTFT tok/s
 *             （max_tokens=8，解码占比可忽略，TTFT≈纯预填充时间）
 *
 * 口径：每项多次运行，统计 avg/P50/P95/min/max；temperature=0 保证可复现；
 * 总预算 170s（<3 分钟），超时自动跳过剩余阶段（已完成的阶段照常出报告）。
 * usage 缺失的网关按 chunk 计数估算（1 chunk ≈ 1 token），报告标注「估」。
 *
 * HTTP：
 *  - POST /api/perf-bench  { provider, model } → 启动（全局单例，进行中拒绝）
 *  - GET  /api/perf-bench  → 当前状态快照（供弹窗轮询渲染）
 */
const BUDGET_MS = 170_000;
const PER_REQUEST_TIMEOUT_MS = 45_000;
/** TTFT 阶段的短输入（~15 tokens）。 */
const SHORT_PROMPT = '用一句话介绍你自己。';
/** TPS/E2E 与 TTFT 共用短输入；解码长度由 max_tokens 决定。 */
const PREFILL_UNIT = '大语言模型的推理延迟由预填充与解码两个阶段构成：预填充并行处理整段输入并构建 KV 缓存，'
    + '吞吐高但受算力上限约束；解码阶段逐 token 自回归生成，受显存带宽约束，速度近似恒定。';
/** 长输入（~1400 汉字，实际以 usage.prompt_tokens 为准）。 */
const LONG_PROMPT = PREFILL_UNIT.repeat(18);
function newStage(key, name, unit, note) {
    return { key, name, unit, status: 'pending', note, samples: [], estimated: false };
}
function summarize(samples) {
    const s = [...samples].sort((a, b) => a - b);
    const pick = (q) => s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(q * s.length))];
    const avg = s.length === 0 ? 0 : s.reduce((a, b) => a + b, 0) / s.length;
    return { avg, p50: pick(0.5), p95: pick(0.95), min: s[0] ?? 0, max: s[s.length - 1] ?? 0 };
}
/** 读取供应商配置（baseURL/apiKeyEnv），与 vision-helper 相同的路径。 */
function providerConfig(ctx, providerId) {
    try {
        const entries = ctx.llm.listConfigurableProviders();
        const entry = entries.find((e) => e.provider === providerId);
        if (!entry || !entry.settingsNs)
            return null;
        const section = ctx.settings.get(entry.settingsNs);
        if (!section || typeof section !== 'object')
            return null;
        let node = section;
        for (const key of Array.isArray(entry.settingsPath) ? entry.settingsPath : []) {
            if (node && typeof node === 'object' && key in node)
                node = node[key];
            else
                return null;
        }
        return node && typeof node === 'object' ? node : null;
    }
    catch {
        return null;
    }
}
async function resolveApiKey(ctx, profile) {
    if (!profile || typeof profile.apiKeyEnv !== 'string' || !profile.apiKeyEnv)
        return null;
    try {
        const credentials = ctx.get('credentials');
        if (!credentials)
            return null;
        const resolved = await credentials.resolve(profile.apiKeyEnv);
        return resolved ? String(resolved.value) : null;
    }
    catch {
        return null;
    }
}
/**
 * 发起一次流式 chat 请求并计时。
 * TTFT 取首个「任何增量」（含 reasoning_content——推理模型的思维链同样是解码产出）；
 * decode 时间 = 末增量 − 首增量；token 数优先取 usage，缺省按增量帧计数（估算）。
 */
async function streamOnce(ctx, baseURL, apiKey, model, prompt, maxTokens, withUsageOption) {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PER_REQUEST_TIMEOUT_MS);
    try {
        const body = {
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: maxTokens,
            temperature: 0,
            stream: true,
        };
        if (withUsageOption)
            body.stream_options = { include_usage: true };
        const res = await fetch(`${baseURL.replace(/[\\/]+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}${text ? ': ' + text.slice(0, 180) : ''}`);
        }
        let ttft = 0;
        let lastAt = 0;
        let frames = 0;
        let completionTokens = 0;
        let promptTokens = 0;
        let sawUsage = false;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let doneReading = false;
        while (!doneReading) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const raw of lines) {
                const line = raw.trim();
                if (!line.startsWith('data:'))
                    continue;
                const payload = line.slice(5).trim();
                if (payload === '[DONE]') {
                    doneReading = true;
                    break;
                }
                let json;
                try {
                    json = JSON.parse(payload);
                }
                catch {
                    continue;
                }
                if (json && json.usage) {
                    promptTokens = Number(json.usage.prompt_tokens ?? 0);
                    completionTokens = Number(json.usage.completion_tokens ?? 0);
                    sawUsage = true;
                }
                const delta = json?.choices?.[0]?.delta;
                const piece = typeof delta?.content === 'string' && delta.content.length > 0
                    ? delta.content
                    : typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0
                        ? delta.reasoning_content : '';
                if (piece) {
                    frames++;
                    const now = performance.now();
                    if (ttft === 0)
                        ttft = now - t0;
                    lastAt = now;
                }
            }
        }
        const e2e = performance.now() - t0;
        if (ttft === 0)
            throw new Error('响应中没有任何增量内容');
        const finalCompletion = sawUsage && completionTokens > 0 ? completionTokens : frames;
        return {
            ttftMs: ttft,
            e2eMs: e2e,
            decodeMs: Math.max(1, lastAt - ttft),
            completionTokens: finalCompletion,
            promptTokens,
            estimated: !(sawUsage && completionTokens > 0),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
/** 非流式短请求（RPS 阶段用）：成功返回 true。 */
async function nonStreamOnce(baseURL, apiKey, model) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PER_REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${baseURL.replace(/[\\/]+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 16,
                temperature: 0,
                stream: false,
            }),
            signal: ctrl.signal,
        });
        return res.ok;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(timer);
    }
}
// ── 全局单例状态 ──────────────────────────────────────────────────────────────
let bench = null;
export function benchSnapshot() {
    if (bench === null)
        return null;
    const summaries = {};
    for (const stage of bench.stages) {
        if (stage.samples.length > 0)
            summaries[stage.key] = summarize(stage.samples);
    }
    const end = bench.finishedAt ?? Date.now();
    return { ...bench, elapsedMs: end - bench.startedAt, summaries };
}
function stage(benchState, key) {
    return benchState.stages.find(s => s.key === key);
}
/** 是否还有预算进入下一阶段（留 12s 余量收尾）。 */
function budgetLeft(benchState) {
    return Date.now() - benchState.startedAt < BUDGET_MS - 12_000;
}
async function runBench(ctx, provider, model) {
    const state = bench;
    try {
        const profile = providerConfig(ctx, provider);
        if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
            throw new Error(`provider "${provider}" 未配置 baseURL`);
        }
        const apiKey = await resolveApiKey(ctx, profile);
        if (!apiKey)
            throw new Error(`未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）`);
        const baseURL = String(profile.baseURL).replace(/[\\/]+$/, '');
        // 先探测网关是否支持 stream_options.include_usage；不支持则全程降级为估算。
        let withUsage = true;
        try {
            await streamOnce(ctx, baseURL, apiKey, model, SHORT_PROMPT, 8, true);
        }
        catch (error) {
            if (/400/.test(String(error?.message ?? ''))) {
                withUsage = false;
                for (const s of state.stages)
                    s.estimated = true;
            }
            else {
                throw error;
            }
        }
        // ── 阶段 1：TTFT（短输入，5 次）──
        const ttftStage = stage(state, 'ttft');
        if (budgetLeft(state)) {
            ttftStage.status = 'running';
            try {
                for (let i = 0; i < 5 && budgetLeft(state); i++) {
                    const r = await streamOnce(ctx, baseURL, apiKey, model, SHORT_PROMPT, 48, withUsage);
                    ttftStage.samples.push(Math.round(r.ttftMs));
                }
                ttftStage.status = ttftStage.samples.length > 0 ? 'done' : 'failed';
            }
            catch (error) {
                ttftStage.status = ttftStage.samples.length > 0 ? 'done' : 'failed';
                ttftStage.note += `｜最后一次失败：${String(error?.message ?? error).slice(0, 120)}`;
            }
        }
        else
            ttftStage.status = 'skipped';
        // ── 阶段 2：TPS + E2E（短输入长输出，3 次）──
        const tpsStage = stage(state, 'tps');
        const e2eStage = stage(state, 'e2e');
        if (budgetLeft(state)) {
            tpsStage.status = 'running';
            e2eStage.status = 'running';
            try {
                for (let i = 0; i < 3 && budgetLeft(state); i++) {
                    const r = await streamOnce(ctx, baseURL, apiKey, model, SHORT_PROMPT, 256, withUsage);
                    const tps = r.completionTokens / (r.decodeMs / 1000);
                    tpsStage.samples.push(Math.round(tps * 10) / 10);
                    e2eStage.samples.push(Math.round(r.e2eMs));
                    if (r.estimated)
                        tpsStage.estimated = true;
                }
                tpsStage.status = tpsStage.samples.length > 0 ? 'done' : 'failed';
                e2eStage.status = e2eStage.samples.length > 0 ? 'done' : 'failed';
            }
            catch (error) {
                tpsStage.status = tpsStage.samples.length > 0 ? 'done' : 'failed';
                e2eStage.status = e2eStage.samples.length > 0 ? 'done' : 'failed';
                tpsStage.note += `｜最后一次失败：${String(error?.message ?? error).slice(0, 120)}`;
            }
        }
        else {
            tpsStage.status = 'skipped';
            e2eStage.status = 'skipped';
        }
        // ── 阶段 3：Prefill（长输入极短输出，3 次）──
        const prefillStage = stage(state, 'prefill');
        if (budgetLeft(state)) {
            prefillStage.status = 'running';
            try {
                let lastPromptTokens = 0;
                for (let i = 0; i < 3 && budgetLeft(state); i++) {
                    const r = await streamOnce(ctx, baseURL, apiKey, model, LONG_PROMPT, 8, withUsage);
                    lastPromptTokens = r.promptTokens;
                    if (r.ttftMs > 0 && r.promptTokens > 0) {
                        prefillStage.samples.push(Math.round(r.promptTokens / (r.ttftMs / 1000)));
                    }
                }
                if (lastPromptTokens > 0)
                    prefillStage.note += `｜实际输入 ${lastPromptTokens} tokens`;
                prefillStage.status = prefillStage.samples.length > 0 ? 'done' : 'failed';
            }
            catch (error) {
                prefillStage.status = prefillStage.samples.length > 0 ? 'done' : 'failed';
                prefillStage.note += `｜最后一次失败：${String(error?.message ?? error).slice(0, 120)}`;
            }
        }
        else
            prefillStage.status = 'skipped';
        // ── 阶段 4：RPS（并发 4 × 8 个短请求）──
        const rpsStage = stage(state, 'rps');
        if (budgetLeft(state)) {
            rpsStage.status = 'running';
            try {
                const total = 8;
                const concurrency = 4;
                let okCount = 0;
                let next = 0;
                const startedAll = Date.now();
                await Promise.all(Array.from({ length: concurrency }, async () => {
                    while (next < total) {
                        next++;
                        const ok = await nonStreamOnce(baseURL, apiKey, model);
                        if (ok)
                            okCount++;
                    }
                }));
                const wallSec = (Date.now() - startedAll) / 1000;
                rpsStage.samples.push(Math.round((okCount / Math.max(0.001, wallSec)) * 100) / 100);
                rpsStage.note += `｜${okCount}/${total} 成功 · 并发 ${concurrency}`;
                rpsStage.status = 'done';
            }
            catch (error) {
                rpsStage.status = 'failed';
                rpsStage.note += `｜失败：${String(error?.message ?? error).slice(0, 120)}`;
            }
        }
        else
            rpsStage.status = 'skipped';
        state.running = false;
        state.finishedAt = Date.now();
    }
    catch (error) {
        state.running = false;
        state.finishedAt = Date.now();
        state.error = String(error?.message ?? error).slice(0, 300);
        for (const s of state.stages) {
            if (s.status === 'pending' || s.status === 'running')
                s.status = 'skipped';
        }
    }
}
/** 启动一次基准测试（单例；已在跑则拒绝）。 */
export function startBench(ctx, provider, model) {
    if (bench !== null && bench.running) {
        return { ok: false, error: `已有测试进行中（${bench.provider}/${bench.model}），请等待完成或稍后再试` };
    }
    bench = {
        running: true,
        provider,
        model,
        startedAt: Date.now(),
        finishedAt: null,
        error: '',
        stages: [
            newStage('ttft', '首字响应 TTFT', 'ms', '请求发出 → 首个流式增量（含推理链）；短输入 ×5 次'),
            newStage('tps', '生成吞吐 TPS', 'tok/s', 'completion_tokens ÷ 解码时长；短输入 + 256 输出 ×3 次'),
            newStage('prefill', '预填充速度', 'tok/s', 'prompt_tokens ÷ 长 prompt 的 TTFT；~1400 字输入 ×3 次'),
            newStage('e2e', '端到端延迟 E2E', 'ms', '请求发出 → 最后一个 chunk；与 TPS 同批测量 ×3 次'),
            newStage('rps', '并发吞吐 RPS', 'req/s', '并发 4 × 8 个短请求的 wall-clock 吞吐'),
        ],
    };
    void runBench(ctx, provider, model);
    return { ok: true };
}
// ── 一键检测的独立探测通道(自包含,不依赖 vision-helper 内部闭包)──
/** 1×1 PNG(data URL):识图探测样本。 */
const DETECT_TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** 识图探测:chat/completions 带小图,能返回描述即支持。 */
async function probeVision(baseURL, apiKey, model) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
        const r = await fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: '这张图是什么颜色？一句话回答。' },
                            { type: 'image_url', image_url: { url: DETECT_TEST_IMAGE } },
                        ],
                    }],
                max_tokens: 32,
                temperature: 0,
                stream: false,
            }),
            signal: ctrl.signal,
        });
        const text = await r.text().catch(() => '');
        if (!r.ok)
            return { ok: false, note: `HTTP ${r.status}: ${text.slice(0, 120)}` };
        let content = '';
        try {
            content = String(JSON.parse(text)?.choices?.[0]?.message?.content ?? '');
        }
        catch { /* ignore */ }
        return content.trim().length > 0
            ? { ok: true, note: content.trim().slice(0, 60) }
            : { ok: false, note: '未返回描述' };
    }
    catch (error) {
        return { ok: false, note: String(error?.message ?? error).slice(0, 120) };
    }
    finally {
        clearTimeout(timer);
    }
}
/** 生图探测:/images/generations 生成一张小红点。 */
async function probeImage(baseURL, apiKey, model) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
        const r = await fetch(`${baseURL}/images/generations`, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model, prompt: 'a single red dot on white background', n: 1 }),
            signal: ctrl.signal,
        });
        const text = await r.text().catch(() => '');
        if (!r.ok)
            return { ok: false, note: `HTTP ${r.status}: ${text.slice(0, 120)}` };
        try {
            const j = JSON.parse(text);
            const has = Boolean(j?.data?.[0]?.url ?? j?.data?.[0]?.b64_json);
            return has ? { ok: true, note: '样例已生成' } : { ok: false, note: '响应无图片数据' };
        }
        catch {
            return { ok: false, note: '响应解析失败' };
        }
    }
    catch (error) {
        return { ok: false, note: String(error?.message ?? error).slice(0, 120) };
    }
    finally {
        clearTimeout(timer);
    }
}
/** 生视频探测:仅验证 /videos 任务能否创建(不等生成完成)。 */
async function probeVideoTask(baseURL, apiKey, model) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    try {
        const r = await fetch(`${baseURL}/videos`, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model, prompt: 'a slowly moving red dot' }),
            signal: ctrl.signal,
        });
        const text = await r.text().catch(() => '');
        if (!r.ok)
            return { ok: false, note: `HTTP ${r.status}: ${text.slice(0, 120)}` };
        let id = '';
        try {
            id = String(JSON.parse(text)?.id ?? '');
        }
        catch { /* ignore */ }
        return id !== ''
            ? { ok: true, note: `任务已创建（id: ${id.slice(0, 24)}…）` }
            : { ok: false, note: '响应无任务 id' };
    }
    catch (error) {
        return { ok: false, note: String(error?.message ?? error).slice(0, 120) };
    }
    finally {
        clearTimeout(timer);
    }
}
/** 读 model-router.json 的 capabilities。 */
async function detectLoadCaps(ctx) {
    try {
        const target = await ctx.fs.resolve('.dsh/model-router.json');
        const parsed = JSON.parse(await ctx.fs.readText(target));
        const caps = parsed && typeof parsed.capabilities === 'object' && parsed.capabilities !== null ? parsed.capabilities : {};
        const out = {};
        for (const [k, v] of Object.entries(caps)) {
            if (Array.isArray(v))
                out[k] = v.filter((x) => typeof x === 'string');
        }
        return out;
    }
    catch {
        return {};
    }
}
/** 写 model-router.json 的 capabilities(保留其余字段)。 */
async function detectPersistCaps(ctx, caps) {
    const target = await ctx.fs.resolve('.dsh/model-router.json');
    let parsed = {};
    try {
        parsed = JSON.parse(await ctx.fs.readText(target));
    }
    catch { /* 新建 */ }
    const next = { ...parsed, capabilities: caps };
    await ctx.fs.writeText(target, JSON.stringify(next, null, 2));
}
let detect = null;
const DETECT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
function detectSnapshot() {
    return detect === null ? null : { ...detect, items: detect.items.map(i => ({ ...i })) };
}
async function runDetectAsync(ctx, provider, model) {
    const st = detect;
    const itemOf = (key) => st.items.find(i => i.key === key);
    const finish = () => {
        st.running = false;
        st.finishedAt = Date.now();
        for (const it of st.items)
            if (it.status !== 'done') {
                it.status = 'done';
                if (it.ok === null && it.note === '')
                    it.note = '未检测（预算耗尽）';
            }
    };
    try {
        const profile = providerConfig(ctx, provider);
        if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
            throw new Error(`provider "${provider}" 未配置 baseURL`);
        }
        const apiKey = await resolveApiKey(ctx, profile);
        if (!apiKey)
            throw new Error(`未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）`);
        const baseURL = String(profile.baseURL).replace(/[\\/]+$/, '');
        const deadline = Date.now() + 150_000;
        // 1) 三项能力实测。
        let it = itemOf('vision');
        it.status = 'running';
        const vision = await probeVision(baseURL, apiKey, model);
        it.ok = vision.ok;
        it.note = vision.note;
        it.status = 'done';
        it = itemOf('image');
        if (Date.now() < deadline) {
            it.status = 'running';
            const image = await probeImage(baseURL, apiKey, model);
            it.ok = image.ok;
            it.note = image.note;
        }
        else {
            it.ok = false;
            it.note = '预算耗尽，已跳过';
        }
        it.status = 'done';
        it = itemOf('video');
        if (Date.now() < deadline) {
            it.status = 'running';
            const video = await probeVideoTask(baseURL, apiKey, model);
            it.ok = video.ok;
            it.note = video.note;
        }
        else {
            it.ok = false;
            it.note = '预算耗尽，已跳过';
        }
        it.status = 'done';
        // 2) 推理等级逐级探测(每完成一级立即写入状态)。
        const apiKind = String(profile.api ?? '');
        for (const level of DETECT_LEVELS) {
            const li = itemOf(`level:${level}`);
            if (/anthropic/i.test(apiKind)) {
                li.ok = null;
                li.note = 'anthropic 协议暂不支持自动探测';
                li.status = 'done';
                continue;
            }
            if (Date.now() > deadline) {
                li.ok = null;
                li.note = '预算耗尽，未探测';
                li.status = 'done';
                continue;
            }
            li.status = 'running';
            let supported = false;
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 14_000);
                const payload = {
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 16,
                    temperature: 0,
                    stream: false,
                };
                if (level !== 'off')
                    payload.reasoning_effort = level;
                try {
                    const r = await fetch(`${baseURL}/chat/completions`, {
                        method: 'POST',
                        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: ctrl.signal,
                    });
                    supported = r.ok;
                    await r.text().catch(() => '');
                }
                finally {
                    clearTimeout(timer);
                }
            }
            catch {
                supported = false;
            }
            li.ok = supported;
            li.note = supported ? '已写入推理等级' : '该档位被提供方拒绝';
            li.status = 'done';
        }
        // 3) 自动落盘:capabilities + settings(input / reasoningEfforts)。
        const visionOk = itemOf('vision').ok === true;
        const imageOk = itemOf('image').ok === true;
        const videoOk = itemOf('video').ok === true;
        const key = `${provider}/${model}`;
        const caps = await detectLoadCaps(ctx);
        const capArr = new Set(caps[key] ?? []);
        if (imageOk)
            capArr.add('image');
        else
            capArr.delete('image');
        if (videoOk)
            capArr.add('video');
        else
            capArr.delete('video');
        const nextCaps = { ...caps };
        if (capArr.size > 0)
            nextCaps[key] = [...capArr];
        else
            delete nextCaps[key];
        await detectPersistCaps(ctx, nextCaps);
        st.savedCaps = true;
        try {
            const ns = 'llm-pi-ai';
            const section = ctx.settings.get(ns);
            const provSection = section?.providers?.[provider];
            if (provSection && Array.isArray(provSection.models)) {
                const idx = provSection.models.findIndex((m) => m && m.id === model);
                if (idx >= 0) {
                    const nextModels = provSection.models.map((m, i) => i === idx ? { ...m } : m);
                    const curInput = Array.isArray(nextModels[idx].input) ? [...nextModels[idx].input] : undefined;
                    if (visionOk) {
                        nextModels[idx].input = Array.from(new Set([...(curInput ?? ['text']), 'image']));
                        st.savedInput = true;
                    }
                    else if (curInput?.includes('image')) {
                        const rest = curInput.filter((x) => x !== 'image');
                        if (rest.length === 0 || (rest.length === 1 && rest[0] === 'text'))
                            delete nextModels[idx].input;
                        else
                            nextModels[idx].input = rest;
                        st.savedInput = true;
                    }
                    const thinkers = DETECT_LEVELS.filter(l => l !== 'off' && itemOf(`level:${l}`).ok === true);
                    if (thinkers.length > 0) {
                        const efforts = { off: null };
                        for (const l of thinkers)
                            efforts[l] = l;
                        nextModels[idx].reasoningEfforts = efforts;
                        st.savedLevels = true;
                    }
                    await ctx.settings.update(ns, { providers: { [provider]: { models: nextModels } } });
                }
            }
        }
        catch (error) {
            st.saveError = String(error?.message ?? error).slice(0, 300);
        }
        finish();
    }
    catch (error) {
        st.error = String(error?.message ?? error).slice(0, 300);
        finish();
    }
}
/** 注册 HTTP 接口。 */
export function applyPerfBench(ctx) {
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/detect-capability',
            handler: async (req, res) => {
                const reply = (status, payload) => {
                    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                };
                try {
                    if (req.method === 'POST') {
                        const body = await new Promise((resolve) => {
                            let data = '';
                            req.on('data', (chunk) => { data += chunk; });
                            req.on('end', () => { try {
                                resolve(JSON.parse(data || '{}'));
                            }
                            catch {
                                resolve({});
                            } });
                            req.on('error', () => resolve({}));
                        });
                        const provider = typeof body.provider === 'string' ? body.provider : '';
                        const model = typeof body.model === 'string' ? body.model : '';
                        if (!provider || !model)
                            return reply(400, { ok: false, error: 'provider/model 不能为空' });
                        if (detect !== null && detect.running) {
                            return reply(409, { ok: false, error: `已有检测进行中（${detect.provider}/${detect.model}）` });
                        }
                        detect = {
                            running: true,
                            provider,
                            model,
                            startedAt: Date.now(),
                            finishedAt: null,
                            error: '',
                            savedCaps: false,
                            savedLevels: false,
                            savedInput: false,
                            saveError: '',
                            items: [
                                { key: 'vision', label: '识图', status: 'pending', ok: null, note: '' },
                                { key: 'image', label: '生图', status: 'pending', ok: null, note: '' },
                                { key: 'video', label: '生视频', status: 'pending', ok: null, note: '' },
                                ...DETECT_LEVELS.map(level => ({ key: `level:${level}`, label: `推理等级 · ${level}`, status: 'pending', ok: null, note: '' })),
                            ],
                        };
                        void runDetectAsync(ctx, provider, model);
                        return reply(200, { ok: true, state: detectSnapshot() });
                    }
                    return reply(200, { ok: true, state: detectSnapshot() });
                }
                catch (error) {
                    return reply(500, { ok: false, error: String(error?.message ?? error) });
                }
            },
        });
    });
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/perf-bench',
            handler: async (req, res) => {
                const reply = (status, payload) => {
                    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                };
                try {
                    if (req.method === 'POST') {
                        let body = {};
                        await new Promise((resolve) => {
                            let data = '';
                            req.on('data', (chunk) => { data += chunk; });
                            req.on('end', () => { try {
                                body = JSON.parse(data || '{}');
                            }
                            catch {
                                body = {};
                            } resolve(); });
                            req.on('error', () => resolve());
                        });
                        const provider = typeof body.provider === 'string' ? body.provider : '';
                        const model = typeof body.model === 'string' ? body.model : '';
                        if (!provider || !model)
                            return reply(400, { ok: false, error: 'provider/model 不能为空' });
                        const result = startBench(ctx, provider, model);
                        return reply(result.ok ? 200 : 409, result.ok ? { ok: true } : { ok: false, error: result.error });
                    }
                    return reply(200, { ok: true, state: benchSnapshot() });
                }
                catch (error) {
                    return reply(500, { ok: false, error: String(error?.message ?? error) });
                }
            },
        });
    });
}
//# sourceMappingURL=perf-bench.js.map