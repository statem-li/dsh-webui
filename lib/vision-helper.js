/**
 * @dsh-external/dsh-vision-helper — 辅助视觉模型插件
 *
 * 给纯文本主模型当「眼睛」：把图片（文件路径 / data URL / base64）交给
 * 已配置的视觉模型（默认 sensenova/sensenova-6.8-flash-lite），返回文本描述。
 *
 * 用途：
 * - 浏览器插件截图兜底：AI 截完图拿不到视觉时，调 vision_describe 看页面
 * - 任何「图片 → 文本」的辅助理解需求
 *
 * 模型解析顺序：Config.visionModels > 工作区 .dsh/model-router.json 的
 * visionActive/vision[] > 内置默认 sensenova/sensenova-6.8-flash-lite。
 * 失败自动降级到列表里下一个可用模型。
 *
 * 传输：请求体在 TS 侧拼好（含 base64 图片）写入临时 JSON 文件，
 * PowerShell 只读文件字节并 POST {baseURL}/chat/completions
 * （openai-completions 兼容），完全避开命令行长度上限（~32K 字符），
 * 沿用 dsh-image-gen 已验证的通道。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
export const Config = z.object({
    modelRouterPath: z.string().default(''),
    visionModels: z.array(z.string()).default([]),
    timeoutMs: z.number().default(150000),
    maxTokens: z.number().default(2048),
    defaultPrompt: z.string().default('用简洁的中文描述这张图片的关键内容：画面主体、布局结构、可见文字、界面元素。不要编造细节，看不清就直说。'),
    textModelImageFallback: z.boolean().default(true),
    fallbackDescribePrompt: z.string().default('用简洁的中文描述这张图片的关键内容：画面主体、布局结构、可见文字、界面元素。不要编造细节，看不清就直说。'),
    fallbackCacheSize: z.number().default(256),
});
const DEFAULT_VISION = 'sensenova/sensenova-6.8-flash-lite';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB 输入上限，防呆
// ── 工具函数 ────────────────────────────────────────────
function splitKey(key) {
    if (typeof key !== 'string')
        return null;
    const idx = key.indexOf('/');
    if (idx <= 0 || idx === key.length - 1)
        return null;
    return { provider: key.slice(0, idx), model: key.slice(idx + 1) };
}
function psEscape(value) {
    return String(value).replace(/'/g, "''");
}
function isBase64Like(value) {
    return /^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 100;
}
/**
 * 把 image 参数归一成 { dataUrlPrefix, base64 }。
 * 支持：本地文件路径（相对工作区或绝对）、file://、data URL、裸 base64。
 */
async function resolveImageData(ctx, image) {
    const raw = String(image || '').trim();
    if (!raw)
        throw new Error('image 参数为空：需要图片文件路径、data URL 或 base64');
    if (raw.startsWith('data:')) {
        const comma = raw.indexOf(',');
        if (comma <= 0)
            throw new Error('data URL 格式无效');
        const prefix = raw.slice(0, comma + 1);
        const base64 = raw.slice(comma + 1);
        if (!base64)
            throw new Error('data URL 内容为空');
        return { prefix, base64, ref: 'data-url' };
    }
    if (raw.startsWith('file://')) {
        const filePath = raw.slice('file://'.length);
        return readImageFile(ctx, filePath);
    }
    // 绝对路径直接检查（ctx.fs.resolve 只按工作区根解析相对路径）
    if (path.isAbsolute(raw) && fs.existsSync(raw) && fs.statSync(raw).isFile()) {
        return readImageFile(ctx, raw);
    }
    // 尝试按相对路径解析（相对工作区根）
    try {
        const resolved = String(await ctx.fs.resolve(raw));
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            return readImageFile(ctx, resolved);
        }
    }
    catch {
        /* 不是文件路径，继续 */
    }
    if (isBase64Like(raw)) {
        return { prefix: 'data:image/png;base64,', base64: raw.replace(/\s+/g, ''), ref: 'base64' };
    }
    throw new Error(`无法识别 image 参数：既不是存在的文件（${raw.slice(0, 80)}…），也不是 data URL / base64`);
}
async function readImageFile(ctx, filePath) {
    const resolved = String(path.isAbsolute(filePath) ? filePath : await ctx.fs.resolve(filePath));
    if (!fs.existsSync(resolved))
        throw new Error(`图片文件不存在：${resolved}`);
    const stat = fs.statSync(resolved);
    if (!stat.isFile())
        throw new Error(`不是文件：${resolved}`);
    if (stat.size > MAX_IMAGE_BYTES)
        throw new Error(`图片过大（${stat.size} 字节，上限 ${MAX_IMAGE_BYTES}）`);
    const buf = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const base64 = buf.toString('base64');
    return { prefix: `data:image/${mime};base64,`, base64, ref: resolved };
}
/** 解析 provider 配置（baseURL / apiKeyEnv），沿用 dsh-image-gen 的读取路径 */
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
        const pathKeys = Array.isArray(entry.settingsPath) ? entry.settingsPath : [];
        for (const key of pathKeys) {
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
    const credentials = ctx.get('credentials');
    if (!credentials)
        return null;
    try {
        const resolved = await credentials.resolve(profile.apiKeyEnv);
        return resolved ? String(resolved.value) : null;
    }
    catch {
        return null;
    }
}
/** 模型列表：Config.visionModels > model-router.json > 默认 */
async function resolveVisionModels(ctx, config) {
    if (config.visionModels.length > 0)
        return [...config.visionModels];
    try {
        const routerPath = config.modelRouterPath || '.dsh/model-router.json';
        const target = await ctx.fs.resolve(routerPath);
        const text = await ctx.fs.readText(target);
        const parsed = JSON.parse(text);
        const list = [];
        const active = typeof parsed.visionActive === 'string' ? parsed.visionActive : '';
        if (active && splitKey(active))
            list.push(active);
        if (Array.isArray(parsed.vision)) {
            for (const item of parsed.vision) {
                if (item && typeof item.provider === 'string' && typeof item.model === 'string') {
                    const key = `${item.provider}/${item.model}`;
                    if (!list.includes(key))
                        list.push(key);
                }
            }
        }
        if (list.length > 0)
            return list;
    }
    catch {
        /* 无路由文件，用默认 */
    }
    return [DEFAULT_VISION];
}
/** 网关是否以「content 数组不被接受」为由拒绝（OpenAI 多模态数组格式不适配）。 */
function isContentFormatRejection(res) {
    const text = `${res.error || ''} ${res.detail || ''}`;
    return /unexpected item type|invalid content/i.test(text);
}
/** 该模型在 provider 配置里声明的 reasoningEfforts.off 线值（如 sensenova → "none"）；未声明返回 null。 */
function reasoningOffWire(profile, model) {
    const models = Array.isArray(profile?.models) ? profile.models : [];
    const entry = models.find((m) => m && typeof m === 'object' && m.id === model);
    const efforts = entry && typeof entry.reasoningEfforts === 'object' ? entry.reasoningEfforts : null;
    if (efforts && 'off' in efforts && typeof efforts.off === 'string' && efforts.off)
        return efforts.off;
    return null;
}
/**
 * 调 chat/completions（PowerShell Invoke-RestMethod，danger-full-access 沙箱）。
 * 请求体在 TS 侧拼好写入临时 JSON 文件，PS 只读文件字节并 POST，
 * 避开命令行长度上限（~32K 字符）与引号转义问题。
 *
 * 图片格式：OpenAI 标准网关接受 content 数组
 * [{type:'text'},{type:'image_url',image_url:{url}}]；部分网关（如
 * sensenova token 网关）不接受数组、只认 message 级平铺字段，此时用
 * flatImage=true 发送 { role:'user', content: 提示词, image_url: dataURL }。
 * reasoningOff 传入网关线值（sensenova 为 "none"）可关掉默认推理链，
 * 避免 finish=length 且正文为空的「推理吃满配额」。
 */
async function callVisionChat(ctx, baseURL, apiKey, model, dataUrl, prompt, timeoutMs, signal, opts) {
    const userMessage = { role: 'user' };
    if (opts.flatImage) {
        userMessage.content = prompt;
        userMessage.image_url = dataUrl;
    }
    else {
        userMessage.content = [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
        ];
    }
    const body = {
        model,
        messages: [userMessage],
        max_tokens: opts.maxTokens,
    };
    if (opts.reasoningOff)
        body.reasoning_effort = opts.reasoningOff;
    const bodyFile = path.join(os.tmpdir(), `dsh-vision-body-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`);
    fs.writeFileSync(bodyFile, JSON.stringify(body), 'utf8');
    const base = String(baseURL).replace(/[\\/]+$/, '');
    const escaped = {
        key: psEscape(apiKey),
        file: psEscape(bodyFile),
        url: psEscape(`${base}/chat/completions`),
    };
    const command = [
        "$ErrorActionPreference = 'Stop'",
        "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
        'try {',
        `  $r = Invoke-RestMethod -UseBasicParsing -Uri '${escaped.url}' -Method Post -Headers @{ Authorization = 'Bearer ${escaped.key}'; 'Content-Type' = 'application/json' } -Body ([IO.File]::ReadAllBytes('${escaped.file}')) -TimeoutSec ${Math.floor(timeoutMs / 1000)}`,
        '  $m = $r.choices[0].message',
        "  @{ ok = $true; content = $m.content; finish = $r.choices[0].finish_reason; model = $r.model } | ConvertTo-Json -Depth 4 -Compress",
        '} catch {',
        "  $detail = ''",
        "  if ($_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }",
        "  @{ ok = $false; error = $_.Exception.Message; detail = $detail } | ConvertTo-Json -Depth 4 -Compress",
        '}',
    ].join('; ');
    try {
        const policy = ctx.sandboxPolicy.resolve({ mode: 'danger-full-access' });
        const spec = ctx.shell.resolve({ command, timeoutMs, signal, sandboxPolicy: policy });
        const result = await ctx.shell.run(spec);
        const stdout = result.stdout && result.stdout.text ? result.stdout.text : '';
        const stderr = result.stderr && result.stderr.text ? result.stderr.text : '';
        if (result.exitCode !== 0) {
            return { ok: false, error: `shell 退出码 ${result.exitCode}`, detail: (stderr || stdout || '').slice(0, 500) };
        }
        let parsed = null;
        try {
            parsed = JSON.parse(stdout);
        }
        catch {
            return { ok: false, error: '响应解析失败', detail: stdout.slice(0, 400) };
        }
        return parsed || { ok: false, error: '空响应' };
    }
    catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
    }
    finally {
        try {
            fs.rmSync(bodyFile, { force: true });
        }
        catch { /* 清理失败忽略 */ }
    }
}
/** 测试专用短超时（ms）：能力测试/推理探测如果 API 不可达，15s 内返回错误，避免前端永远「检测中」。 */
const TEST_TIMEOUT_MS = 15000;
/**
 * 探测单个 reasoning_effort 档位：发一个极简 chat 请求（max_tokens=8），
 * 带 reasoning_effort 参数。返回 ok=true 表示该档位被网关接受；400/422
 * 等参数错误会被 PowerShell catch，返回 ok=false + detail。
 */
async function probeReasoningEffort(ctx, baseURL, apiKey, model, level, timeoutMs, signal) {
    const body = {
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
        reasoning_effort: level,
    };
    const bodyFile = path.join(os.tmpdir(), `dsh-reason-probe-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`);
    fs.writeFileSync(bodyFile, JSON.stringify(body), 'utf8');
    const base = String(baseURL).replace(/[\\/]+$/, '');
    const escaped = {
        key: psEscape(apiKey),
        file: psEscape(bodyFile),
        url: psEscape(`${base}/chat/completions`),
    };
    const command = [
        "$ErrorActionPreference = 'Stop'",
        "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
        'try {',
        `  Invoke-RestMethod -UseBasicParsing -Uri '${escaped.url}' -Method Post -Headers @{ Authorization = 'Bearer ${escaped.key}'; 'Content-Type' = 'application/json' } -Body ([IO.File]::ReadAllBytes('${escaped.file}')) -TimeoutSec ${Math.floor(timeoutMs / 1000)} | Out-Null`,
        '  @{ ok = $true } | ConvertTo-Json -Compress',
        '} catch {',
        "  $detail = ''",
        "  if ($_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }",
        "  @{ ok = $false; error = $_.Exception.Message; detail = $detail } | ConvertTo-Json -Depth 4 -Compress",
        '}',
    ].join('; ');
    try {
        const policy = ctx.sandboxPolicy.resolve({ mode: 'danger-full-access' });
        const spec = ctx.shell.resolve({ command, timeoutMs, signal, sandboxPolicy: policy });
        const result = await ctx.shell.run(spec);
        const stdout = result.stdout && result.stdout.text ? result.stdout.text : '';
        const stderr = result.stderr && result.stderr.text ? result.stderr.text : '';
        if (result.exitCode !== 0) {
            return { ok: false, error: `shell 退出码 ${result.exitCode}`, detail: (stderr || stdout || '').slice(0, 400) };
        }
        try {
            const parsed = JSON.parse(stdout);
            return parsed || { ok: false, error: '空响应' };
        }
        catch {
            return { ok: false, error: '响应解析失败', detail: stdout.slice(0, 300) };
        }
    }
    catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
    }
    finally {
        try {
            fs.rmSync(bodyFile, { force: true });
        }
        catch { /* 清理失败忽略 */ }
    }
}
/**
 * 探测一个模型支持的 reasoning_effort 档位集合（off 恒支持、不发参数，故不探测）。
 * 逐个用档位名作为 reasoning_effort 线值发请求，返回 accepted / rejected。
 * 定义在 applyVisionHelper 内部（依赖 providerConfig/resolveApiKey/config 闭包）。
 */
// ── 插件主体 ────────────────────────────────────────────
export function applyVisionHelper(ctx, configInput) {
    // 配置契约校验：调用方（webui apply）直接透传未解析的 Partial<Config>，
    // 未显式配置的字段（visionModels / timeoutMs / maxTokens / fallbackCacheSize
    // 等）在这里补上 schemastery 默认值，避免后续 resolveVisionModels 等读到
    // undefined 而抛出 `Cannot read properties of undefined (reading 'length')`。
    // schemastery 的 schema 是函数形态：调用即解析（含默认值），非 zod 的 .parse。
    // 用 const 重新声明，保证闭包（describe / resolveVisionModels 等）中 config 的
    // 类型收窄为完整 Config（对参数重新赋值时 TS 会把闭包引用推断为联合类型）。
    const config = Config(configInput);
    // ═══ 生图能力（自 dsh-image-gen 合并；模型配置存 model-router.json 的 imageActive）═══
    let imageActive = '';
    async function loadImageConfig() {
        try {
            const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json');
            const parsed = JSON.parse(await ctx.fs.readText(target));
            if (parsed && typeof parsed.imageActive === 'string')
                imageActive = parsed.imageActive;
            if (!imageActive && Array.isArray(parsed?.image) && parsed.image.length > 0) {
                imageActive = parsed.image[0].provider + '/' + parsed.image[0].model;
            }
        }
        catch { /* 无配置 */ }
    }
    async function saveImageActive(key) {
        const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json');
        let parsed = {};
        try {
            parsed = JSON.parse(await ctx.fs.readText(target));
        }
        catch { /* 无文件则新建 */ }
        const list = Array.isArray(parsed.image) ? parsed.image : [];
        const parts = splitKey(key);
        if (parts && !list.some((item) => item.provider === parts.provider && item.model === parts.model)) {
            list.push({ provider: parts.provider, model: parts.model });
        }
        const next = { ...parsed, image: list, imageActive: key };
        await ctx.fs.writeText(target, JSON.stringify(next, null, 2));
        imageActive = key;
    }
    /**
     * 单张生成（n=1，兼容性最好：部分 provider 不接受 n>1）。
     * @param timeoutMs - 单次调用超时（ms），默认 320s；测试场景传短超时避免挂起。
     * @returns 成功返回 { ok: true, url }；失败返回 { ok: false, error }。
     */
    async function generateOne(base, apiKey, model, prompt, signal, timeoutMs = 320000) {
        const safePrompt = String(prompt).replace(/'/g, "''");
        const command = "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; try { $b = @{ model = '" + model + "'; prompt = '" + safePrompt + "'; n = 1 } | ConvertTo-Json -Compress; $r = Invoke-RestMethod -UseBasicParsing -Uri '" + base + "/images/generations' -Method Post -Headers @{ Authorization = 'Bearer " + apiKey + "'; 'Content-Type' = 'application/json' } -Body $b -TimeoutSec " + Math.max(10, Math.floor(timeoutMs / 1000)) + "; @{ ok = $true; data = @($r.data) } | ConvertTo-Json -Depth 6 -Compress } catch { $inner = ''; if ($_.Exception.InnerException) { $inner = $_.Exception.InnerException.Message }; @{ ok = $false; error = $_.Exception.Message; inner = $inner; ps = $PSVersionTable.PSVersion.ToString() } | ConvertTo-Json -Compress }";
        try {
            const policy = ctx.sandboxPolicy.resolve({ mode: 'danger-full-access' });
            const spec = ctx.shell.resolve({ command, timeoutMs, signal, sandboxPolicy: policy });
            const result = await ctx.shell.run(spec);
            const stdout = result.stdout && result.stdout.text ? result.stdout.text : '';
            const stderr = result.stderr && result.stderr.text ? result.stderr.text : '';
            if (result.exitCode !== 0) {
                return { ok: false, error: `生图 API 调用失败 (exit ${result.exitCode}): ${(stderr || stdout || '未知错误').slice(0, 500)}` };
            }
            let parsed = null;
            try {
                parsed = JSON.parse(stdout);
            }
            catch {
                return { ok: false, error: '生图 API 响应解析失败: ' + stdout.slice(0, 400) };
            }
            if (!parsed || parsed.ok !== true) {
                return { ok: false, error: '生图 API 错误: ' + JSON.stringify(parsed).slice(0, 500) };
            }
            const items = Array.isArray(parsed.data) ? parsed.data : [];
            for (const item of items) {
                if (item && typeof item === 'object') {
                    const record = item;
                    const url = typeof record.url === 'string' && record.url
                        ? record.url
                        : typeof record.b64_json === 'string' && record.b64_json
                            ? 'data:image/png;base64,' + record.b64_json
                            : null;
                    if (url !== null)
                        return { ok: true, url };
                }
            }
            return { ok: false, error: '生图 API 返回空结果' };
        }
        catch (error) {
            return { ok: false, error: '生图 API 调用异常: ' + String(error?.message ?? error) };
        }
    }
    /**
     * 一次生成 count 张（1-4）：逐张 n=1 调用后聚合，兼容不支持 n>1 的 provider。
     */
    async function generateViaHttp(active, prompt, signal, count = 1) {
        const profile = providerConfig(ctx, active.provider);
        if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
            return { ok: false, error: `provider "${active.provider}" 未配置 baseURL` };
        }
        const apiKey = await resolveApiKey(ctx, profile);
        if (!apiKey) {
            return { ok: false, error: `未找到生图 API 凭据（${profile.apiKeyEnv || '未知 env'}）：请在凭据设置中配置。` };
        }
        const base = String(profile.baseURL).replace(/[\\/]+$/, '');
        const safeCount = Math.min(Math.max(Number.isFinite(count) ? Math.floor(count) : 1, 1), 4);
        const imageUrls = [];
        const failures = [];
        for (let index = 0; index < safeCount; index++) {
            const one = await generateOne(base, apiKey, active.model, prompt, signal);
            if (one.ok) {
                if (!imageUrls.includes(one.url))
                    imageUrls.push(one.url);
            }
            else {
                failures.push(one.error);
            }
        }
        if (imageUrls.length === 0) {
            return { ok: false, error: failures[0] ?? '生图 API 返回空结果' };
        }
        return {
            ok: true,
            model: `${active.provider}/${active.model}`,
            count: imageUrls.length,
            imageUrls,
            imageUrl: imageUrls[0] ?? null,
            imageDataUrl: null,
            ...(failures.length > 0 ? { partial: `其中 ${failures.length} 张失败：${failures[0]}` } : {}),
        };
    }
    // ═══ 生视频能力（videoActive；OpenAI /videos 异步任务 + 轮询）═══
    let videoActive = '';
    async function loadVideoConfig() {
        try {
            const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json');
            const parsed = JSON.parse(await ctx.fs.readText(target));
            if (parsed && typeof parsed.videoActive === 'string')
                videoActive = parsed.videoActive;
            if (!videoActive && Array.isArray(parsed?.video) && parsed.video.length > 0) {
                videoActive = parsed.video[0].provider + '/' + parsed.video[0].model;
            }
        }
        catch { /* 无配置 */ }
    }
    async function saveVideoActive(key) {
        const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json');
        let parsed = {};
        try {
            parsed = JSON.parse(await ctx.fs.readText(target));
        }
        catch { /* 无文件则新建 */ }
        const list = Array.isArray(parsed.video) ? parsed.video : [];
        const parts = splitKey(key);
        if (parts && !list.some((item) => item.provider === parts.provider && item.model === parts.model)) {
            list.push({ provider: parts.provider, model: parts.model });
        }
        const next = { ...parsed, video: list, videoActive: key };
        await ctx.fs.writeText(target, JSON.stringify(next, null, 2));
        videoActive = key;
    }
    /**
     * 生视频：POST {base}/videos 创建异步任务 → 轮询 GET {base}/videos/{id}
     * 直到 completed/succeeded（返回 url）或 failed。遵循 OpenAI /videos 规范
     * （兼容 Sora 网关 / 商汤等 OpenAI 兼容端点）。
     */
    async function generateVideoViaHttp(active, prompt, signal) {
        const profile = providerConfig(ctx, active.provider);
        if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
            return { ok: false, error: `provider "${active.provider}" 未配置 baseURL` };
        }
        const apiKey = await resolveApiKey(ctx, profile);
        if (!apiKey) {
            return { ok: false, error: `未找到生视频 API 凭据（${profile.apiKeyEnv || '未知 env'}）：请在凭据设置中配置。` };
        }
        const base = String(profile.baseURL).replace(/[\\/]+$/, '');
        const safePrompt = String(prompt).replace(/'/g, "''");
        const command = [
            "$ErrorActionPreference = 'Stop'",
            "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
            'try {',
            `  $b = @{ model = '${psEscape(active.model)}'; prompt = '${safePrompt}' } | ConvertTo-Json -Compress`,
            `  $c = Invoke-RestMethod -UseBasicParsing -Uri '${psEscape(base)}/videos' -Method Post -Headers @{ Authorization = 'Bearer ${psEscape(apiKey)}'; 'Content-Type' = 'application/json' } -Body $b -TimeoutSec 120`,
            '  $id = $c.id',
            "  if (-not $id) { @{ ok = $false; error = '视频任务创建失败：响应无 id' } | ConvertTo-Json -Compress; exit }",
            '  for ($i = 0; $i -lt 100; $i++) {',
            '    Start-Sleep -Seconds 5',
            `    $s = Invoke-RestMethod -UseBasicParsing -Uri '${psEscape(base)}/videos/$id' -Method Get -Headers @{ Authorization = 'Bearer ${psEscape(apiKey)}' } -TimeoutSec 120`,
            '    $st = $s.status',
            "    if ($st -eq 'completed' -or $st -eq 'succeeded') {",
            '      $url = $null',
            '      if ($s.data -and $s.data[0]) { $url = $s.data[0].url }',
            '      if (-not $url -and $s.output -and $s.output[0]) { $url = $s.output[0].url }',
            "      if ($url) { @{ ok = $true; id = $id; url = $url } | ConvertTo-Json -Depth 4 -Compress; exit }",
            "      @{ ok = $false; id = $id; error = '视频已完成但响应无 url' } | ConvertTo-Json -Compress; exit",
            '    }',
            "    if ($st -eq 'failed' -or $st -eq 'error' -or $st -eq 'cancelled') {",
            "      @{ ok = $false; id = $id; error = \"视频生成失败：$st\" } | ConvertTo-Json -Compress; exit",
            '    }',
            '  }',
            "  @{ ok = $false; id = $id; error = '视频生成超时（约 500s 未完成）' } | ConvertTo-Json -Compress",
            '} catch {',
            "  $detail = ''",
            "  if ($_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }",
            "  @{ ok = $false; error = $_.Exception.Message; detail = $detail } | ConvertTo-Json -Depth 4 -Compress",
            '}',
        ].join('; ');
        try {
            const policy = ctx.sandboxPolicy.resolve({ mode: 'danger-full-access' });
            const spec = ctx.shell.resolve({ command, timeoutMs: 700000, signal, sandboxPolicy: policy });
            const result = await ctx.shell.run(spec);
            const stdout = result.stdout && result.stdout.text ? result.stdout.text : '';
            const stderr = result.stderr && result.stderr.text ? result.stderr.text : '';
            if (result.exitCode !== 0) {
                return { ok: false, error: `生视频 API 调用失败 (exit ${result.exitCode}): ${(stderr || stdout || '未知错误').slice(0, 500)}` };
            }
            let parsed = null;
            try {
                parsed = JSON.parse(stdout);
            }
            catch {
                return { ok: false, error: '生视频 API 响应解析失败: ' + stdout.slice(0, 400) };
            }
            if (!parsed || parsed.ok !== true) {
                return { ok: false, error: '生视频 API 错误: ' + JSON.stringify(parsed).slice(0, 500) };
            }
            return {
                ok: true,
                model: `${active.provider}/${active.model}`,
                taskId: parsed.id,
                videoUrl: parsed.url ?? null,
                videoUrls: parsed.url ? [parsed.url] : [],
            };
        }
        catch (error) {
            return { ok: false, error: '生视频 API 调用异常: ' + String(error?.message ?? error) };
        }
    }
    // ═══ 模型能力声明（生图/生视频；识图走模型 input 字段）═══
    // 存 model-router.json 的 capabilities：{ "provider/model": ["image", "video"] }
    async function readCapabilities() {
        try {
            const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json');
            const parsed = JSON.parse(await ctx.fs.readText(target));
            const caps = parsed && typeof parsed.capabilities === 'object' && parsed.capabilities !== null
                ? parsed.capabilities
                : {};
            const out = {};
            for (const [key, value] of Object.entries(caps)) {
                if (Array.isArray(value)) {
                    const clean = value.filter((x) => typeof x === 'string' && (x === 'image' || x === 'video' || x === 'speech'));
                    if (clean.length > 0)
                        out[key] = clean;
                }
            }
            return out;
        }
        catch {
            return {};
        }
    }
    async function saveCapabilities(caps) {
        const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json');
        let parsed = {};
        try {
            parsed = JSON.parse(await ctx.fs.readText(target));
        }
        catch { /* 无文件则新建 */ }
        const next = { ...parsed, capabilities: caps };
        await ctx.fs.writeText(target, JSON.stringify(next, null, 2));
    }
    async function describe(imageArg, promptArg, signal) {
        const { prefix, base64, ref } = await resolveImageData(ctx, imageArg);
        const prompt = String(promptArg || '').trim() || config.defaultPrompt;
        const models = await resolveVisionModels(ctx, config);
        const failures = [];
        for (const key of models) {
            const active = splitKey(key);
            if (!active)
                continue;
            const profile = providerConfig(ctx, active.provider);
            if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
                failures.push(`${key}: provider "${active.provider}" 未配置 baseURL`);
                continue;
            }
            const apiKey = await resolveApiKey(ctx, profile);
            if (!apiKey) {
                failures.push(`${key}: 未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}），请先在凭据设置中配置`);
                continue;
            }
            const dataUrl = prefix + base64;
            const reasoningOff = reasoningOffWire(profile, active.model);
            let res = await callVisionChat(ctx, profile.baseURL, apiKey, active.model, dataUrl, prompt, config.timeoutMs, signal, { flatImage: false, reasoningOff: null, maxTokens: config.maxTokens });
            let flatImage = false;
            // 网关拒绝 OpenAI content 数组（如 sensenova token 网关）→ 换 message 级 image_url 平铺格式
            if (!res.ok && isContentFormatRejection(res)) {
                flatImage = true;
                res = await callVisionChat(ctx, profile.baseURL, apiKey, active.model, dataUrl, prompt, config.timeoutMs, signal, { flatImage: true, reasoningOff, maxTokens: config.maxTokens });
            }
            // 推理链吃满配额（finish=length 且无正文）：关推理 + 加大 max_tokens 重试一次
            if (res.ok && !res.content && res.finish === 'length') {
                const bigger = Math.min(config.maxTokens * 4, 16384);
                if (bigger > config.maxTokens) {
                    res = await callVisionChat(ctx, profile.baseURL, apiKey, active.model, dataUrl, prompt, config.timeoutMs, signal, { flatImage, reasoningOff, maxTokens: bigger });
                }
            }
            if (res.ok && typeof res.content === 'string' && res.content.trim().length > 0) {
                return {
                    ok: true,
                    text: res.content.trim(),
                    model: `${active.provider}/${active.model}`,
                    image: ref.length > 120 ? `…${ref.slice(-117)}` : ref,
                };
            }
            if (res.ok && !res.content) {
                failures.push(`${key}: 模型未返回正文（finish=${res.finish || 'unknown'}，可能 max_tokens 不足）`);
            }
            else {
                failures.push(`${key}: ${res.error || '未知错误'}${res.detail ? ' — ' + String(res.detail).slice(0, 300) : ''}`);
            }
        }
        throw new Error(`所有视觉模型都失败了。尝试顺序：[${models.join(', ')}]\n` +
            failures.map((f) => `- ${f}`).join('\n'));
    }
    // 提供给其他插件复用（如 webui 的 browser_see：截图 → 视觉描述一步返回）。
    // 消费方用 ctx.get('vision-describe') 获取；未提供时为 undefined。
    ctx.provide('vision-describe', describe);
    // 工具注册（ctx.effect：fiber dispose 自动注销）
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'vision_describe',
        description: '辅助视觉：用视觉模型描述一张图片，返回文本。需要看图（页面截图、验证码、图表、图片内容）时使用，主模型无需图片能力。',
        parameters: {
            image: {
                type: 'string',
                required: true,
                description: '图片：本地文件路径（相对工作区或绝对）、data URL 或 base64',
            },
            prompt: {
                type: 'string',
                description: '可选：描述要求，缺省为通用中文描述',
            },
        },
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
            return describe(String(args.image), args.prompt, exec?.signal);
        },
    })), '@dsh-external/dsh-vision-helper: vision_describe');
    // generate_image：生图工具（自 dsh-image-gen 合并；count 支持一次生成多张）
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'generate_image',
        description: '调用已配置的生图模型生成一张或多张图片。当用户要求生成、绘制、创建图片或图像时使用本工具，提示词越详细越好；用户要求"几张/多张"时用 count 指定张数（最多 4 张），一次调用返回全部图片。若返回 ok=false，请把 error 信息转告用户（生图模型在「设置 → AI 模型」中配置）。',
        parameters: {
            prompt: {
                type: 'string',
                required: true,
                description: '详细的图片生成提示词，建议包含主体、风格、场景、构图、光线等细节。',
            },
            count: {
                type: 'number',
                description: '生成张数（1-4，默认 1）；多张会一次性返回，适合"生成几张"类需求',
            },
        },
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
            const active = splitKey(imageActive);
            if (!active) {
                return { ok: false, error: '尚未配置生图模型：请在「设置 → AI 模型」中选择生图模型。' };
            }
            return generateViaHttp(active, String(args.prompt), exec?.signal, args.count);
        },
    })), '@dsh-external/dsh-vision-helper: generate_image');
    // generate_video：生视频工具（OpenAI /videos 异步任务 + 轮询）
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'generate_video',
        description: '调用已配置的生视频模型生成一段视频。当用户要求生成、创建视频时使用本工具，提示词越详细越好（画面内容、镜头运动、时长、风格）。生视频是异步任务，本工具会等待任务完成（最长约 8 分钟）。若返回 ok=false，请把 error 信息转告用户（生视频模型在「设置 → AI 模型」中配置）。',
        parameters: {
            prompt: {
                type: 'string',
                required: true,
                description: '详细的视频生成提示词，建议包含画面主体、镜头运动、时长、风格、光线等细节。',
            },
        },
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
            const active = splitKey(videoActive);
            if (!active) {
                return { ok: false, error: '尚未配置生视频模型：请在「设置 → AI 模型」中选择生视频模型。' };
            }
            return generateVideoViaHttp(active, String(args.prompt), exec?.signal);
        },
    })), '@dsh-external/dsh-vision-helper: generate_video');
    // ═══ 非多模态主模型图片降级（纯插件，不动核心）═══
    // 原理：llm/stream 是 LlmRuntime 的 waterfall 事件，监听器可以短路——
    // 不调用 next() 而返回自己的 chunk 流（llm-replay 官方包同款机制）。
    // 这里检测「请求含图 + 当前模型未声明 image 输入」时，把图片块换成
    // 辅助视觉描述文本块，构造新请求再调 ctx.llm.stream(新请求)（递归一层，
    // 新请求无图即走正常文本链路）。会话历史与聊天界面不受影响。
    const VISION_CONVERTED = Symbol('@dsh-external/dsh-vision-helper/converted');
    function blocksHaveImage(blocks) {
        return blocks.some(block => block.type === 'image'
            || (block.type === 'tool-result' && blocksHaveImage(block.content)));
    }
    function messagesHaveImage(messages) {
        return messages.some(message => blocksHaveImage(message.content));
    }
    // 模型能力缓存（60s）：provider/model → 是否支持 image 输入；未知不缓存。
    // 注意：用 listModels（adapter 的原始 catalog 能力）判断，而不是
    // resolveModelInfo —— 下方对 resolveModelInfo 做了准入包装（见 patch
    // 说明），包装后的结果不再反映真实模态能力。
    const modalityCache = new Map();
    async function modelSupportsImage(provider, model) {
        const key = `${provider}/${model}`;
        const hit = modalityCache.get(key);
        if (hit !== undefined && Date.now() - hit.at < 60_000)
            return hit.supportsImage;
        try {
            const models = await ctx.llm.listModels(provider);
            const entry = models.find(item => item.id === model);
            const modalities = Array.isArray(entry?.inputModalities) ? entry.inputModalities : undefined;
            if (modalities === undefined)
                return undefined;
            const supports = modalities.includes('image');
            modalityCache.set(key, { at: Date.now(), supportsImage: supports });
            return supports;
        }
        catch {
            return undefined;
        }
    }
    // ═══ host 图片准入绕行 ═══
    // api-proxy 在 prompt 提交阶段用 ctx.llm.resolveModelInfo 检查当前模型
    // 是否声明 image 输入，未声明则直接拒绝（MODEL_DOES_NOT_SUPPORT_IMAGES），
    // 消息根本进不了 agent loop，llm/stream 降级因此永远轮不到。这里把
    // llm 服务的 resolveModelInfo 包装一层：对「未声明 image 输入」的模型
    // 把 inputModalities 抹成 undefined，让准入检查放行（api-proxy 对
    // undefined 一律跳过）。真正的模态判断由上面的 listModels（catalog
    // 原始能力）完成，不受本包装影响。
    // 副作用核查：模型目录接口不用 inputModalities；read_image 工具对
    // undefined 与 ['text'] 同样拒绝，行为不变；selectModel 对含图会话
    // 切换非多模态模型由拒绝变为放行（与降级语义一致）。
    if (config.textModelImageFallback) {
        const llmService = ctx.llm;
        const originalResolveModelInfo = llmService.resolveModelInfo.bind(llmService);
        llmService.resolveModelInfo = async (provider, model, signal) => {
            const info = await originalResolveModelInfo(provider, model, signal);
            if (info && Array.isArray(info.inputModalities) && !info.inputModalities.includes('image')) {
                return { ...info, inputModalities: undefined };
            }
            return info;
        };
    }
    // 图片描述缓存（按附件 id；历史图片每轮请求只描述一次）
    const descCache = new Map();
    async function describeAttachment(attachment, signal) {
        const cached = descCache.get(attachment.attachmentId);
        if (cached !== undefined)
            return cached;
        try {
            const attachments = ctx.get('attachments');
            if (!attachments || typeof attachments.readImage !== 'function') {
                throw new Error('附件服务不可用');
            }
            const stored = await attachments.readImage(attachment, signal);
            const dataUrl = `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`;
            const res = await describe(dataUrl, config.fallbackDescribePrompt, signal);
            if (!res.ok)
                throw new Error(res.error || '未知错误');
            const text = `[图片·辅助视觉描述: ${res.text}]`;
            if (descCache.size >= config.fallbackCacheSize)
                descCache.clear();
            descCache.set(attachment.attachmentId, text);
            return text;
        }
        catch (error) {
            const reason = String(error?.message ?? error).slice(0, 300);
            return `[图片（辅助视觉描述失败）: ${reason}；请在「设置 → AI 模型」中确认辅助视觉模型已配置]`;
        }
    }
    async function convertBlocks(blocks, signal) {
        return Promise.all(blocks.map(async (block) => {
            if (block.type === 'image') {
                return { type: 'text', text: await describeAttachment(block.attachment, signal) };
            }
            if (block.type === 'tool-result') {
                return { ...block, content: await convertBlocks(block.content, signal) };
            }
            return block;
        }));
    }
    /**
     * 需要降级时返回转换后的请求；否则返回 null（含：开关关、无图、模型
     * 支持 image、能力未知、转换过程异常——一律原样放行，保持原错误行为）。
     */
    async function convertRequest(options) {
        if (!config.textModelImageFallback)
            return null;
        if (!messagesHaveImage(options.messages))
            return null;
        const supports = await modelSupportsImage(options.provider, options.model);
        if (supports !== false)
            return null;
        const messages = await Promise.all(options.messages.map(async (message) => ({
            ...message,
            content: await convertBlocks(message.content, options.signal),
        })));
        return { ...options, messages };
    }
    ctx.on('llm/stream', async function* (options, next) {
        // 已转换的请求直接放行（防止递归）
        if (options?.[VISION_CONVERTED]) {
            yield* next();
            return;
        }
        let converted = null;
        try {
            converted = await convertRequest(options);
        }
        catch {
            converted = null;
        }
        if (converted === null) {
            yield* next();
            return;
        }
        ;
        converted[VISION_CONVERTED] = true;
        // 短路：不调用 next()，直接以转换后的请求重新进入 waterfall（第二层
        // 因无图且带标记而走正常文本链路）
        yield* ctx.llm.stream(converted);
    }, { global: true });
    // 模型配置快照：webServer 只读接口（供设置页 / 排查）
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/vision-helper/snapshot',
            handler: async (req, res) => {
                try {
                    const models = await resolveVisionModels(ctx, config);
                    const body = JSON.stringify({ ok: true, models, active: models[0] || null });
                    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                    res.end(body);
                }
                catch (error) {
                    res.writeHead(500, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
                }
            },
        });
    });
    // ── 配置接口：模型枚举（providers）+ 保存（config）──
    function jsonResponse(res, status, payload) {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(payload));
    }
    function readBody(req) {
        return new Promise((resolve) => {
            let data = '';
            req.on('data', (chunk) => { data += chunk; });
            req.on('end', () => {
                try {
                    resolve(JSON.parse(data || '{}'));
                }
                catch {
                    resolve(null);
                }
            });
            req.on('error', () => resolve(null));
        });
    }
    async function saveVisionActive(key) {
        const list = await readVisionList();
        const parts = splitKey(key);
        if (parts && !list.some((item) => item.provider === parts.provider && item.model === parts.model)) {
            list.push({ provider: parts.provider, model: parts.model });
        }
        await saveVisionList(list, key);
    }
    /** 读 model-router.json 的 vision 降级列表（有序）。 */
    async function readVisionList() {
        try {
            const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json');
            const parsed = JSON.parse(await ctx.fs.readText(target));
            if (Array.isArray(parsed.vision)) {
                return parsed.vision.filter((item) => item && typeof item.provider === 'string' && typeof item.model === 'string');
            }
        }
        catch { /* 无路由文件 */ }
        return [];
    }
    /** 写 model-router.json 的 vision 降级列表 + 首选（默认列表第一个）。 */
    async function saveVisionList(list, active) {
        const target = await ctx.fs.resolve(config.modelRouterPath || '.dsh/model-router.json');
        let parsed = {};
        try {
            parsed = JSON.parse(await ctx.fs.readText(target));
        }
        catch { /* 无文件则新建 */ }
        const next = { ...parsed, vision: list, visionActive: active || (list.length > 0 ? `${list[0].provider}/${list[0].model}` : '') };
        await ctx.fs.writeText(target, JSON.stringify(next, null, 2));
    }
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/vision-helper/providers',
            handler: async (_req, res) => {
                try {
                    const caps = await readCapabilities();
                    const providers = [];
                    for (const info of ctx.llm.listProviders()) {
                        let models = [];
                        try {
                            models = await ctx.llm.listModels(info.id);
                        }
                        catch { /* 无发现 */ }
                        providers.push({
                            id: info.id,
                            name: info.name,
                            models: models.map((m) => ({
                                id: m.id,
                                name: m.name || m.id,
                                input: Array.isArray(m.inputModalities)
                                    ? [...m.inputModalities]
                                    : Array.isArray(m.input) ? m.input : null,
                                outputs: caps[`${info.id}/${m.id}`] ?? [],
                            })),
                        });
                    }
                    const active = (await resolveVisionModels(ctx, config))[0] || null;
                    const visionList = await readVisionList();
                    jsonResponse(res, 200, { ok: true, providers, active, visionList });
                }
                catch (error) {
                    jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) });
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
            path: '/api/vision-helper/config',
            handler: async (req, res) => {
                try {
                    if (req.method !== 'POST')
                        return jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
                    const body = await readBody(req);
                    // 完整降级列表保存：{ vision: [{provider, model}...], visionActive?: string }
                    if (body && Array.isArray(body.vision)) {
                        const list = [];
                        for (const item of body.vision) {
                            if (item && typeof item.provider === 'string' && typeof item.model === 'string'
                                && splitKey(`${item.provider}/${item.model}`)
                                && !list.some((x) => x.provider === item.provider && x.model === item.model)) {
                                list.push({ provider: item.provider, model: item.model });
                            }
                        }
                        if (list.length === 0)
                            return jsonResponse(res, 400, { ok: false, error: 'vision 列表为空或格式无效' });
                        const active = typeof body.visionActive === 'string' && splitKey(body.visionActive) ? body.visionActive : '';
                        const resolved = active || `${list[0].provider}/${list[0].model}`;
                        await saveVisionList(list, resolved);
                        return jsonResponse(res, 200, { ok: true, active: resolved, vision: list });
                    }
                    const key = body && typeof body.visionActive === 'string' ? body.visionActive : '';
                    if (!splitKey(key))
                        return jsonResponse(res, 400, { ok: false, error: 'visionActive 须为 provider/model 格式' });
                    await saveVisionActive(key);
                    jsonResponse(res, 200, { ok: true, active: key });
                }
                catch (error) {
                    jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) });
                }
            },
        });
    });
    // ── 生图接口（兼容原 /api/image-gen/* 路径，AI 模型页生图区块依赖）──
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/image-gen/snapshot',
            handler: async (_req, res) => {
                try {
                    const caps = await readCapabilities();
                    const providers = [];
                    for (const info of ctx.llm.listProviders()) {
                        let models = [];
                        try {
                            models = await ctx.llm.listModels(info.id);
                        }
                        catch { /* 无发现 */ }
                        providers.push({
                            id: info.id,
                            name: info.name,
                            models: models.map((m) => ({
                                id: m.id,
                                name: m.name || m.id,
                                input: Array.isArray(m.inputModalities)
                                    ? [...m.inputModalities]
                                    : Array.isArray(m.input) ? m.input : null,
                                outputs: caps[`${info.id}/${m.id}`] ?? [],
                            })),
                        });
                    }
                    jsonResponse(res, 200, { ok: true, providers, imageActive });
                }
                catch (error) {
                    jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) });
                }
            },
        });
    });
    // ── 生视频接口（AI 模型页生视频区块依赖）──
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/video-gen/snapshot',
            handler: async (_req, res) => {
                try {
                    const caps = await readCapabilities();
                    const providers = [];
                    for (const info of ctx.llm.listProviders()) {
                        let models = [];
                        try {
                            models = await ctx.llm.listModels(info.id);
                        }
                        catch { /* 无发现 */ }
                        providers.push({
                            id: info.id,
                            name: info.name,
                            models: models.map((m) => ({
                                id: m.id,
                                name: m.name || m.id,
                                input: Array.isArray(m.inputModalities)
                                    ? [...m.inputModalities]
                                    : Array.isArray(m.input) ? m.input : null,
                                outputs: caps[`${info.id}/${m.id}`] ?? [],
                            })),
                        });
                    }
                    jsonResponse(res, 200, { ok: true, providers, videoActive });
                }
                catch (error) {
                    jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) });
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
            path: '/api/video-gen/config',
            handler: async (req, res) => {
                try {
                    if (req.method !== 'POST')
                        return jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
                    const body = await readBody(req);
                    const key = body && typeof body.videoActive === 'string' ? body.videoActive : '';
                    if (!splitKey(key))
                        return jsonResponse(res, 400, { ok: false, error: 'videoActive 须为 provider/model 格式' });
                    await saveVideoActive(key);
                    jsonResponse(res, 200, { ok: true, videoActive: key });
                }
                catch (error) {
                    jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) });
                }
            },
        });
    });
    // ── 模型能力声明接口（生图/生视频；ModelListEditor 三开关读写）──
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/model-capabilities',
            handler: async (req, res) => {
                try {
                    if (req.method === 'POST') {
                        const body = await readBody(req);
                        const caps = body && typeof body.capabilities === 'object' && body.capabilities !== null
                            ? body.capabilities
                            : {};
                        const clean = {};
                        for (const [key, value] of Object.entries(caps)) {
                            if (splitKey(key) && Array.isArray(value)) {
                                const mods = value.filter((x) => typeof x === 'string' && (x === 'image' || x === 'video' || x === 'speech'));
                                if (mods.length > 0)
                                    clean[key] = mods;
                            }
                        }
                        await saveCapabilities(clean);
                        return jsonResponse(res, 200, { ok: true, capabilities: clean });
                    }
                    const caps = await readCapabilities();
                    jsonResponse(res, 200, { ok: true, capabilities: caps });
                }
                catch (error) {
                    jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) });
                }
            },
        });
    });
    // ── 模型能力验证接口（「测试」按钮：实际调用一次对应能力）──
    // capability: vision(识图) / image(生图) / video(生视频)
    // vision/image 同步验证；video 只验证任务能否创建成功（不等待生成完成）。
    /** 1×1 红色像素 PNG（识图测试用，能返回描述即说明模型支持图片输入）。 */
    const TEST_IMAGE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    async function createVideoTask(provider, model, prompt, signal) {
        const profile = providerConfig(ctx, provider);
        if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
            return { ok: false, error: `provider "${provider}" 未配置 baseURL` };
        }
        const apiKey = await resolveApiKey(ctx, profile);
        if (!apiKey)
            return { ok: false, error: `未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）` };
        const base = String(profile.baseURL).replace(/[\\/]+$/, '');
        const safePrompt = String(prompt).replace(/'/g, "''");
        const command = [
            "$ErrorActionPreference = 'Stop'",
            "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
            'try {',
            `  $b = @{ model = '${psEscape(model)}'; prompt = '${safePrompt}' } | ConvertTo-Json -Compress`,
            `  $c = Invoke-RestMethod -UseBasicParsing -Uri '${psEscape(base)}/videos' -Method Post -Headers @{ Authorization = 'Bearer ${psEscape(apiKey)}'; 'Content-Type' = 'application/json' } -Body $b -TimeoutSec 15`,
            '  $id = $c.id',
            "  if ($id) { @{ ok = $true; id = $id } | ConvertTo-Json -Compress } else { @{ ok = $false; error = '响应无 id' } | ConvertTo-Json -Compress }",
            '} catch {',
            "  $detail = ''",
            "  if ($_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }",
            "  @{ ok = $false; error = $_.Exception.Message; detail = $detail } | ConvertTo-Json -Depth 4 -Compress",
            '}',
        ].join('; ');
        try {
            const policy = ctx.sandboxPolicy.resolve({ mode: 'danger-full-access' });
            const spec = ctx.shell.resolve({ command, timeoutMs: TEST_TIMEOUT_MS, signal, sandboxPolicy: policy });
            const result = await ctx.shell.run(spec);
            const stdout = result.stdout && result.stdout.text ? result.stdout.text : '';
            const stderr = result.stderr && result.stderr.text ? result.stderr.text : '';
            if (result.exitCode !== 0) {
                return { ok: false, error: `生视频 API 调用失败 (exit ${result.exitCode}): ${(stderr || stdout || '未知错误').slice(0, 400)}` };
            }
            let parsed = null;
            try {
                parsed = JSON.parse(stdout);
            }
            catch {
                return { ok: false, error: '生视频 API 响应解析失败: ' + stdout.slice(0, 300) };
            }
            if (!parsed || parsed.ok !== true) {
                return { ok: false, error: '生视频 API 错误: ' + JSON.stringify(parsed).slice(0, 400) };
            }
            return { ok: true, taskId: String(parsed.id ?? '') };
        }
        catch (error) {
            return { ok: false, error: '生视频 API 调用异常: ' + String(error?.message ?? error) };
        }
    }
    /** 探测模型支持的 reasoning_effort 档位（off 恒支持、不发参数，不探测）。 */
    async function probeReasoningEfforts(provider, model, signal) {
        const profile = providerConfig(ctx, provider);
        if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
            return { ok: false, error: `provider "${provider}" 未配置 baseURL` };
        }
        const apiKey = await resolveApiKey(ctx, profile);
        if (!apiKey)
            return { ok: false, error: `未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）` };
        const base = String(profile.baseURL).replace(/[\\/]+$/, '');
        const levels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
        const supported = [];
        const rejected = [];
        for (const level of levels) {
            const r = await probeReasoningEffort(ctx, base, apiKey, model, level, TEST_TIMEOUT_MS, signal);
            if (r.ok)
                supported.push(level);
            else
                rejected.push({ level, reason: (r.error || r.detail || '拒绝').slice(0, 200) });
        }
        return { ok: true, supported, rejected };
    }
    async function testCapability(provider, model, capability, signal) {
        if (capability === 'vision') {
            // 直接对指定 provider/model 发测试图，验证「该模型」是否支持识图，
            // 而不是复用全局视觉模型列表（那样测的是辅助视觉模型，不是被测模型）。
            const profile = providerConfig(ctx, provider);
            if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
                return { ok: false, capability, error: `provider "${provider}" 未配置 baseURL` };
            }
            const apiKey = await resolveApiKey(ctx, profile);
            if (!apiKey)
                return { ok: false, capability, error: `未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）` };
            try {
                const res = await callVisionChat(ctx, profile.baseURL, apiKey, model, TEST_IMAGE_PNG, '这张图是什么颜色？用一句话回答。', TEST_TIMEOUT_MS, signal, { flatImage: false, reasoningOff: null, maxTokens: Math.min(config.maxTokens, 64) });
                if (res.ok && typeof res.content === 'string' && res.content.trim().length > 0) {
                    return { ok: true, capability, result: res.content.trim() };
                }
                return { ok: false, capability, error: (res.error || res.detail || '未返回描述').slice(0, 400) };
            }
            catch (error) {
                return { ok: false, capability, error: String(error?.message ?? error).slice(0, 400) };
            }
        }
        if (capability === 'image') {
            const profile = providerConfig(ctx, provider);
            if (!profile || typeof profile.baseURL !== 'string' || !profile.baseURL) {
                return { ok: false, capability, error: `provider "${provider}" 未配置 baseURL` };
            }
            const apiKey = await resolveApiKey(ctx, profile);
            if (!apiKey)
                return { ok: false, capability, error: `未找到 API 凭据（${profile.apiKeyEnv || '未知 env'}）` };
            const base = String(profile.baseURL).replace(/[\\/]+$/, '');
            const one = await generateOne(base, apiKey, model, 'a single red dot on white background', signal, TEST_TIMEOUT_MS);
            if (!one.ok)
                return { ok: false, capability, error: one.error };
            return { ok: true, capability, result: one.url };
        }
        if (capability === 'video') {
            const created = await createVideoTask(provider, model, 'a slowly moving red dot', signal);
            if (!created.ok)
                return { ok: false, capability, error: created.error };
            return { ok: true, capability, result: `任务已创建（id: ${created.taskId}），生成中…` };
        }
        return { ok: false, capability, error: `未知能力：${capability}` };
    }
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/test-capability',
            handler: async (req, res) => {
                try {
                    if (req.method !== 'POST')
                        return jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
                    const body = await readBody(req);
                    const provider = body && typeof body.provider === 'string' ? body.provider : '';
                    const model = body && typeof body.model === 'string' ? body.model : '';
                    const capability = body && typeof body.capability === 'string' ? body.capability : '';
                    if (!provider || !model)
                        return jsonResponse(res, 400, { ok: false, error: 'provider/model 不能为空' });
                    if (!['vision', 'image', 'video'].includes(capability)) {
                        return jsonResponse(res, 400, { ok: false, error: 'capability 须为 vision/image/video' });
                    }
                    const result = await testCapability(provider, model, capability);
                    jsonResponse(res, 200, result);
                }
                catch (error) {
                    jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) });
                }
            },
        });
    });
    // ── 推理等级自动探测接口（「自动检测」按钮：逐档位发请求探测支持情况）──
    ctx.effect(() => {
        const webServer = ctx.webServer;
        if (!webServer)
            return () => { };
        return webServer.register({
            kind: 'exact',
            path: '/api/test-reasoning',
            handler: async (req, res) => {
                try {
                    if (req.method !== 'POST')
                        return jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
                    const body = await readBody(req);
                    const provider = body && typeof body.provider === 'string' ? body.provider : '';
                    const model = body && typeof body.model === 'string' ? body.model : '';
                    if (!provider || !model)
                        return jsonResponse(res, 400, { ok: false, error: 'provider/model 不能为空' });
                    const result = await probeReasoningEfforts(provider, model);
                    jsonResponse(res, 200, result);
                }
                catch (error) {
                    jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) });
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
            path: '/api/image-gen/config',
            handler: async (req, res) => {
                try {
                    if (req.method !== 'POST')
                        return jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
                    const body = await readBody(req);
                    const key = body && typeof body.imageActive === 'string' ? body.imageActive : '';
                    if (!splitKey(key))
                        return jsonResponse(res, 400, { ok: false, error: 'imageActive 须为 provider/model 格式' });
                    await saveImageActive(key);
                    jsonResponse(res, 200, { ok: true, imageActive: key });
                }
                catch (error) {
                    jsonResponse(res, 500, { ok: false, error: String(error?.message ?? error) });
                }
            },
        });
    });
    void loadImageConfig();
    void loadVideoConfig();
}
//# sourceMappingURL=vision-helper.js.map