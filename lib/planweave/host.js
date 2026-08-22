import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { PlanweaveEngine } from './engine.js';
import { executeImplementation, executeReview, executeFeedback, executeImplementationSubagent, executeReviewSubagent, executeFeedbackSubagent, defaultSubagentProvider, } from './executor.js';
const SETTINGS_NS = settingsNamespace('planweave');
const ROUTE_PREFIX = '/api/planweave';
/** settings schema（schemastery）。 */
const configSchema = z.object({
    projectName: z.string().default('default'),
    provider: z.string().default(''),
    model: z.string().default(''),
    maxSteps: z.number().step(1).min(1).max(20).default(5),
});
/** 有 subagent provider 且当前有 agent 上下文时，走完整 agent 路径，否则 llm 直跑。 */
function useSubagent(env) {
    return env.provider !== null && env.exec?.agent !== undefined;
}
async function runCoordination(engine, env, maxSteps) {
    const lines = [];
    lines.push(`执行方式：${useSubagent(env) ? `subagent(${env.provider})` : 'llm 直跑'}`);
    for (let i = 0; i < maxSteps; i += 1) {
        const claim = await engine.claim();
        if (claim.kind === 'none') {
            lines.push(`第 ${i + 1} 步：无更多可认领项（${claim.reason ?? '计划已完成或无可就绪项'}）`);
            break;
        }
        if (claim.kind === 'blocked') {
            lines.push(`阻塞：${claim.reason}${claim.ref ? `（${claim.ref}）` : ''}`);
            break;
        }
        if (claim.kind === 'batch') {
            lines.push(`并行批次：${claim.refs.join(', ')}（逐项推进）`);
            for (const ref of claim.refs) {
                await runOneRef(engine, env, ref, lines);
            }
            continue;
        }
        if (claim.kind === 'block') {
            const prompt = await engine.prompt(claim.ref);
            if (claim.blockType === 'implementation') {
                const { reportPath } = useSubagent(env)
                    ? await executeImplementationSubagent(env.ctx, env.exec, env.provider, prompt, claim.ref)
                    : await executeImplementation(env.llm, env.model, prompt, claim.ref);
                const submit = await engine.submitResult(claim.ref, reportPath);
                lines.push(`[${i + 1}] 实现 ${claim.ref} → ${submit.status}（${submit.runId}）`);
            }
            else {
                const { resultPath, outcome } = useSubagent(env)
                    ? await executeReviewSubagent(env.ctx, env.exec, env.provider, prompt, claim.ref, claim.taskId)
                    : await executeReview(env.llm, env.model, prompt, claim.ref, claim.taskId);
                const submit = await engine.submitReview(claim.ref, resultPath);
                lines.push(`[${i + 1}] 评审 ${claim.ref} → ${outcome.verdict}（${submit.reviewAttemptId}${submit.feedbackId ? '，生成反馈 ' + submit.feedbackId : ''}）`);
            }
            continue;
        }
        if (claim.kind === 'feedback') {
            const { reportPath } = useSubagent(env)
                ? await executeFeedbackSubagent(env.ctx, env.exec, env.provider, claim.content, claim.sourceReviewBlockRef)
                : await executeFeedback(env.llm, env.model, claim.content, claim.sourceReviewBlockRef);
            const submit = await engine.submitFeedback(reportPath);
            lines.push(`[${i + 1}] 反馈 ${claim.feedbackId} → ${submit.status}（${submit.submissionId}）`);
            continue;
        }
    }
    return lines.join('\n');
}
async function runOneRef(engine, env, ref, lines) {
    const claim = await engine.claimRef(ref);
    if (claim.kind !== 'block') {
        lines.push(`并行项 ${ref} 无法以 block 认领（${claim.kind}）`);
        return;
    }
    const prompt = await engine.prompt(claim.ref);
    if (claim.blockType === 'implementation') {
        const { reportPath } = useSubagent(env)
            ? await executeImplementationSubagent(env.ctx, env.exec, env.provider, prompt, claim.ref)
            : await executeImplementation(env.llm, env.model, prompt, claim.ref);
        const submit = await engine.submitResult(claim.ref, reportPath);
        lines.push(`并行实现 ${claim.ref} → ${submit.status}（${submit.runId}）`);
    }
    else {
        const { resultPath, outcome } = useSubagent(env)
            ? await executeReviewSubagent(env.ctx, env.exec, env.provider, prompt, claim.ref, claim.taskId)
            : await executeReview(env.llm, env.model, prompt, claim.ref, claim.taskId);
        const submit = await engine.submitReview(claim.ref, resultPath);
        lines.push(`并行评审 ${claim.ref} → ${outcome.verdict}`);
    }
}
// ── 工具注册 ──
function readConfig(ctx) {
    const raw = ctx.settings.get(SETTINGS_NS);
    return {
        projectName: typeof raw?.projectName === 'string' && raw.projectName !== '' ? raw.projectName : 'default',
        provider: typeof raw?.provider === 'string' ? raw.provider : '',
        model: typeof raw?.model === 'string' ? raw.model : '',
        maxSteps: typeof raw?.maxSteps === 'number' && Number.isFinite(raw.maxSteps)
            ? Math.min(20, Math.max(1, Math.round(raw.maxSteps)))
            : 5,
    };
}
function resolveLlm(ctx) {
    const llm = ctx.get('llm');
    if (llm === undefined)
        throw new Error('llm 服务不可用');
    const config = readConfig(ctx);
    if (config.provider === '' || config.model === '') {
        throw new Error('未配置 PlanWeave 执行模型：请在「设置 → PlanWeave」里填 provider 与 model');
    }
    return { llm: llm, model: { provider: config.provider, model: config.model } };
}
/** 注册全部 PlanWeave 工具，返回合并 disposer。 */
function registerTools(ctx) {
    const disposers = [];
    disposers.push(ctx.tools.register(defineTool({
        name: 'planweave_init',
        description: '初始化（或打开）一个 PlanWeave 计划项目：把它作为本地任务图来跟踪实现/评审进度。首次调用会创建一个空计划，之后可复用同名项目。',
        parameters: {
            projectName: { type: 'string', description: '项目名（用于派生稳定的项目目录；默认 default）。' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args) {
            const config = readConfig(ctx);
            const name = typeof args.projectName === 'string' && args.projectName !== '' ? args.projectName : config.projectName;
            const engine = await PlanweaveEngine.open(name);
            const paths = await engine.paths();
            return `PlanWeave 项目已就绪：projectId=${engine.projectId}，packageDir=${paths.packageDir}。可用 planweave_status 查看、planweave_run 推进。`;
        },
        presentCall: args => ({ card: 'generic', kind: 'other', title: `初始化 PlanWeave：${String(args.projectName ?? '')}`, rawInput: args }),
    })));
    disposers.push(ctx.tools.register(defineTool({
        name: 'planweave_status',
        description: '查看 PlanWeave 计划项目的执行状态：任务/块状态、当前可认领项、反馈与计数。',
        parameters: {
            projectName: { type: 'string', description: '项目名（默认取设置里的 projectName）。' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args) {
            const config = readConfig(ctx);
            const name = typeof args.projectName === 'string' && args.projectName !== '' ? args.projectName : config.projectName;
            const engine = await PlanweaveEngine.open(name);
            const status = await engine.status();
            const blocks = status.blocks.map(b => `${b.ref}:${b.status}`).join(', ');
            const next = status.nextClaimable.join(', ');
            return [
                `任务：${status.taskTotal} 个（${status.counts.tasks.implemented} 已完成）`,
                `块：${status.blockTotal} 个（${status.counts.blocks.completed} 已完成 / ${status.counts.blocks.in_progress} 进行中）`,
                `当前可认领：${next === '' ? '无' : next}`,
                blocks === '' ? '' : `块状态：${blocks}`,
            ].filter(Boolean).join('\n');
        },
        presentCall: () => ({ card: 'generic', kind: 'other', title: '查看 PlanWeave 状态', rawInput: null }),
    })));
    disposers.push(ctx.tools.register(defineTool({
        name: 'planweave_run',
        description: '推进 PlanWeave 计划：按就绪顺序认领并执行实现/评审块、处理评审反馈，最多循环若干步。执行用设置里配置的模型。',
        parameters: {
            projectName: { type: 'string', description: '项目名（默认取设置里的 projectName）。' },
            steps: { type: 'integer', description: '本次最多推进的步数（默认取设置里的 maxSteps）。' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args, exec) {
            const config = readConfig(ctx);
            const name = typeof args.projectName === 'string' && args.projectName !== '' ? args.projectName : config.projectName;
            const stepsRaw = typeof args.steps === 'number' ? args.steps : Number(args.steps);
            const maxSteps = Number.isFinite(stepsRaw) && stepsRaw > 0
                ? Math.min(20, Math.max(1, Math.round(stepsRaw)))
                : config.maxSteps;
            const { llm, model } = resolveLlm(ctx);
            const engine = await PlanweaveEngine.open(name);
            const env = {
                ctx,
                exec: exec,
                llm,
                model,
                provider: defaultSubagentProvider(ctx),
            };
            const summary = await runCoordination(engine, env, maxSteps);
            const status = await engine.status();
            return summary + `\n\n当前状态：${status.counts.tasks.implemented}/${status.taskTotal} 任务完成，${status.counts.blocks.completed}/${status.blockTotal} 块完成。`;
        },
        presentCall: () => ({ card: 'generic', kind: 'other', title: '推进 PlanWeave 计划', rawInput: null }),
    })));
    return () => { for (const dispose of disposers)
        dispose(); };
}
// ── HTTP API（loopback，供 client 半身） ──
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
function loopbackAllowed(req) {
    if (!isLoopbackAddress(req.socket.remoteAddress))
        return false;
    const host = (req.headers.host ?? '').trim().toLowerCase();
    return host === 'localhost' || host.startsWith('localhost:') || host === '127.0.0.1' || host.startsWith('127.0.0.1:') || host === '::1';
}
function json(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(JSON.stringify(value));
}
async function handleStatus(ctx, req, res) {
    if (!loopbackAllowed(req)) {
        json(res, 403, { ok: false, error: 'loopback-only' });
        return;
    }
    try {
        const config = readConfig(ctx);
        const url = new URL(req.url ?? '/', 'http://localhost');
        const name = url.searchParams.get('projectName') ?? config.projectName;
        const engine = await PlanweaveEngine.open(name);
        const status = await engine.status();
        json(res, 200, { ok: true, projectId: engine.projectId, status });
    }
    catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
}
// ── 插件体 ──
export function applyPlanweaveHost(ctx) {
    // 1) settings 命名空间（重复加载时读取现有值，不覆盖）。
    try {
        ctx.settings.register(SETTINGS_NS, configSchema);
    }
    catch {
        // 已注册（插件被加载两次）——忽略。
    }
    // 2) 模型工具。
    const toolsDispose = registerTools(ctx);
    ctx.effect(() => toolsDispose, 'webui: planweave tools');
    // 3) HTTP API（loopback）。
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            if (req.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/status`) {
                void handleStatus(ctx, req, res);
                return;
            }
            json(res, 404, { ok: false, error: `no route for ${req.method} ${url.pathname}` });
        },
    }), 'webui: planweave routes');
}
//# sourceMappingURL=host.js.map