/**
 * webui — 自动化执行引擎（host 半身）。
 *
 * 把「自动化」从纯前端模拟升级为真实执行：客户端（localStorage 里的任务步骤）
 * 通过 loopback HTTP 把步骤序列 + 模型配置发给这里，host 用 `ctx.llm` 逐步
 * 真实调用模型，按每步的失败分支（stop/skip）与重试次数（retry）推进，可选的
 * 把输出写入工作区文件，最后返回结构化结果（每步成功/失败/跳过 + 输出摘要 +
 * 文件清单），客户端据此落执行日志。
 *
 * Routes (loopback-only):
 *   POST /api/webui-automation/run      { provider, model, retry, steps[] } → 执行结果
 *   GET  /api/webui-automation/download?path=<abs>   → 下载工作区内文件
 *   POST /api/webui-automation/reveal   { path }      → 在文件管理器中打开所在文件夹
 *
 * 安全：仅接受 loopback 请求；download/reveal 的路径必须落在某个已注册工作区内。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { URL } from 'node:url';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
const ROUTE_PREFIX = '/api/webui-automation';
/** 单步模型调用超时（毫秒）：推理模型可能较慢。 */
const STEP_TIMEOUT_MS = 180_000;
/** 单步输出摘要截断长度。 */
const SUMMARY_MAX = 200;
/** 执行指令的 system 提示词。 */
const RUN_SYSTEM = 'You are an automation task runner. Complete the given task and output ONLY the final result — no preamble, no explanation, no markdown code fence around the whole answer.';
// ── HTTP plumbing ───────────────────────────────────────────────────────────
function isLoopbackAddress(address) {
    if (typeof address !== 'string')
        return false;
    const a = address.toLowerCase();
    if (a === '::1')
        return true;
    const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a;
    const octets = ipv4.split('.');
    return octets.length === 4 && octets[0] === '127'
        && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function hostNameOf(value) {
    if (typeof value !== 'string')
        return null;
    const host = value.trim().toLowerCase();
    if (host.startsWith('[')) {
        const close = host.indexOf(']');
        if (close <= 1)
            return null;
        return host.slice(1, close);
    }
    const firstColon = host.indexOf(':');
    const lastColon = host.lastIndexOf(':');
    if (firstColon !== lastColon)
        return null;
    return firstColon === -1 ? host : host.slice(0, firstColon);
}
function loopbackAllowed(req) {
    if (!isLoopbackAddress(req.socket.remoteAddress))
        return false;
    const host = hostNameOf(req.headers.host);
    if (host === null)
        return false;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function json(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
    });
    res.end(body);
}
function readBody(req) {
    return new Promise((resolvePromise, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 1024 * 1024) {
                reject(new Error('request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) {
                resolvePromise({});
                return;
            }
            try {
                resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
            catch {
                reject(new Error('invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}
// ── 工作区 containment ──────────────────────────────────────────────────────
function workspaceList(ctx) {
    const registry = ctx.get('workspaceRegistry');
    try {
        return registry?.list?.() ?? [];
    }
    catch {
        return [];
    }
}
/** 输出目录：第一个已注册工作区；无工作区回退进程 cwd。 */
function outputDir(ctx) {
    const first = workspaceList(ctx)[0];
    return first !== undefined && typeof first.path === 'string' && first.path !== ''
        ? first.path
        : process.cwd();
}
/** 判断绝对路径是否落在某个已注册工作区内。 */
function isWithinWorkspace(ctx, rawPath) {
    if (rawPath === '' || !isAbsolute(resolve(rawPath)))
        return false;
    const abs = resolve(rawPath);
    return workspaceList(ctx).some(workspace => {
        const root = resolve(workspace.path);
        const rel = relative(root, abs);
        return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    });
}
// ── 输出文件 ────────────────────────────────────────────────────────────────
/** 渲染文件名模板：{date} → yyyy-MM-dd，{time} → HHmm。 */
function renderFileName(template, now) {
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    return template.replaceAll('{date}', date).replaceAll('{time}', time);
}
/** 写输出文件（basename 防路径穿越）。 */
function writeOutputFile(outputDirectory, fileName, content) {
    const safeName = basename(fileName) || 'output.txt';
    const fullPath = join(outputDirectory, safeName);
    const existed = existsSync(fullPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
    const size = statSync(fullPath).size;
    return { name: safeName, path: fullPath, size, action: existed ? 'modified' : 'created' };
}
// ── 执行 ────────────────────────────────────────────────────────────────────
/** 单次模型调用（返回全量文本或错误）。 */
async function runOnce(llm, provider, model, prompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, STEP_TIMEOUT_MS);
    let out = '';
    try {
        const messages = [createUserMessage({
                content: [{ type: 'text', text: prompt }],
                source: { kind: 'plugin', plugin: 'dsh-webui' },
            })];
        for await (const chunk of llm.stream({
            provider,
            model,
            messages,
            system: RUN_SYSTEM,
            maxTokens: 4096,
            signal: controller.signal,
        })) {
            if (chunk.type === 'text-delta') {
                out += chunk.text ?? '';
                continue;
            }
            if (chunk.type !== 'finish')
                continue;
            const reason = chunk.reason;
            if (reason === undefined)
                continue;
            if (reason.kind === 'error' || reason.kind === 'aborted') {
                const message = reason.failure?.message
                    ?? (reason.kind === 'aborted' ? '执行超时' : '模型调用失败');
                return { ok: false, error: String(message) };
            }
            if (reason.kind !== 'stop' && reason.kind !== 'max-tokens') {
                return { ok: false, error: `模型未正常结束：${reason.kind}` };
            }
        }
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    finally {
        clearTimeout(timer);
    }
    if (out.trim() === '')
        return { ok: false, error: '模型未返回内容' };
    return { ok: true, text: out };
}
/** 带重试的单步调用：最多 retry 次自动重试。 */
async function runWithRetry(llm, provider, model, prompt, retry) {
    let lastError = '模型调用失败';
    for (let attempt = 0; attempt <= retry; attempt++) {
        const result = await runOnce(llm, provider, model, prompt);
        if (result.ok)
            return result;
        lastError = result.error;
    }
    return { ok: false, error: lastError };
}
/** 解析步骤（宽松）。 */
function parseStep(raw, index) {
    return {
        id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `step-${index}`,
        name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : `步骤 ${index + 1}`,
        prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
        onError: raw.onError === 'skip' ? 'skip' : 'stop',
        saveToFile: raw.saveToFile === true,
        fileName: typeof raw.fileName === 'string' && raw.fileName !== '' ? raw.fileName : 'output-{date}.md',
    };
}
/** 执行任务：逐步推进 + 分支 + 重试 + 文件输出。 */
async function runTask(ctx, body) {
    const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    const retryRaw = typeof body.retry === 'number' ? body.retry : Number(body.retry);
    const retry = Number.isFinite(retryRaw) ? Math.min(3, Math.max(0, Math.round(retryRaw))) : 0;
    const rawSteps = Array.isArray(body.steps) ? body.steps : [];
    if (provider === '' || model === '') {
        return { ok: true, status: 'failed', steps: [], files: [], error: '未绑定模型，请先在任务里选择模型' };
    }
    const steps = rawSteps.map((raw, index) => parseStep(raw, index))
        .filter(step => step.prompt !== '');
    if (steps.length === 0) {
        return { ok: true, status: 'failed', steps: [], files: [], error: '任务没有可执行的步骤（执行指令为空）' };
    }
    const llm = ctx.get('llm');
    if (llm === undefined) {
        return { ok: false, status: 'failed', steps: [], files: [], error: 'llm 服务不可用' };
    }
    const directory = outputDir(ctx);
    const results = [];
    const files = [];
    let context = '';
    let stopped = false;
    for (const step of steps) {
        if (stopped) {
            results.push({ stepId: step.id, name: step.name, status: 'skipped' });
            continue;
        }
        const prompt = context === '' ? step.prompt : `${step.prompt}\n\n[前面步骤的输出]\n${context}`;
        const outcome = await runWithRetry(llm, provider, model, prompt, retry);
        if (outcome.ok) {
            context = context === '' ? outcome.text : `${context}\n\n${outcome.text}`;
            let file = null;
            if (step.saveToFile) {
                try {
                    file = writeOutputFile(directory, renderFileName(step.fileName, new Date()), outcome.text);
                }
                catch (error) {
                    // 写文件失败不使步骤失败，但记录到步骤结果。
                    results.push({
                        stepId: step.id,
                        name: step.name,
                        status: 'failed',
                        error: `写文件失败：${error instanceof Error ? error.message : String(error)}`,
                    });
                    if (step.onError === 'stop')
                        stopped = true;
                    continue;
                }
            }
            results.push({
                stepId: step.id,
                name: step.name,
                status: 'success',
                summary: outcome.text.slice(0, SUMMARY_MAX),
                recordCount: outcome.text.length,
            });
            if (file !== null)
                files.push(file);
        }
        else {
            results.push({ stepId: step.id, name: step.name, status: step.onError === 'skip' ? 'skipped' : 'failed', error: outcome.error });
            if (step.onError === 'stop')
                stopped = true;
        }
    }
    const status = results.some(result => result.status === 'failed') ? 'failed' : 'success';
    return { ok: true, status, steps: results, files };
}
// ── Dispatch ────────────────────────────────────────────────────────────────
async function handle(ctx, req, res) {
    if (!loopbackAllowed(req)) {
        json(res, 403, { ok: false, error: 'loopback-only' });
        return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const rest = url.pathname.slice(ROUTE_PREFIX.length);
    const method = req.method ?? 'GET';
    try {
        if (method === 'POST' && rest === '/run') {
            const body = (await readBody(req));
            json(res, 200, await runTask(ctx, body));
            return;
        }
        if (method === 'GET' && rest === '/download') {
            const rawPath = url.searchParams.get('path') ?? '';
            if (!isWithinWorkspace(ctx, rawPath)) {
                json(res, 403, { ok: false, error: 'path is outside every workspace' });
                return;
            }
            try {
                const buf = readFileSync(rawPath);
                const name = basename(rawPath);
                res.writeHead(200, {
                    'content-type': 'application/octet-stream',
                    'content-length': buf.length,
                    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
                    'cache-control': 'no-cache',
                });
                res.end(buf);
            }
            catch {
                json(res, 404, { ok: false, error: 'file does not exist' });
            }
            return;
        }
        if (method === 'POST' && rest === '/reveal') {
            const body = await readBody(req);
            const rawPath = typeof body.path === 'string' ? body.path : '';
            if (rawPath === '' || !isWithinWorkspace(ctx, rawPath)) {
                json(res, 403, { ok: false, error: 'path is outside every workspace' });
                return;
            }
            try {
                if (process.platform === 'win32')
                    spawn('explorer.exe', [`/select,${rawPath}`]);
                else if (process.platform === 'darwin')
                    spawn('open', ['-R', rawPath]);
                else
                    spawn('xdg-open', [dirname(rawPath)]);
                json(res, 200, { ok: true });
            }
            catch (error) {
                json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
            return;
        }
        json(res, 404, { ok: false, error: `no route for ${method} ${rest}` });
    }
    catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
}
/** 挂载 /api/webui-automation 路由（webui 组合调用）。 */
export function applyAutomationHost(ctx) {
    const webServer = ctx.get('webServer');
    if (webServer === undefined)
        return;
    ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => { void handle(ctx, req, res); },
    }), 'webui: automation routes');
}
//# sourceMappingURL=automation-host.js.map