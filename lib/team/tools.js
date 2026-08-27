/**
 * team — Agent 工具（host 半身）。
 *
 * 四个工具：
 *  - team_list：列出可用团队与其角色/链（模型自选合适团队与链）。
 *  - team_run ：启动一次团队接力执行；**同步等待完成**并返回最终交付物摘要
 *               （工具触发天然带 agent 上下文 → 角色可走 subagent 通道，有工具能力）。
 *  - team_resume：接续一次未完成的运行（只重跑失败/跳过/未开始的步骤，产物保留）。
 *  - team_status：查看某次/最近一次运行的状态、失败归类与可接续性。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { generateTeam } from './generate.js';
import { isResumable, runProgress } from './roster.js';
import { failureAdvice } from './failure.js';
import { normalizeBinding } from './types.js';
/** 轮询等待运行结束的间隔与上限。 */
const POLL_MS = 1000;
/** 工具内等待上限（超时后返回「仍在运行」，不杀运行）。 */
const WAIT_LIMIT_MS = 20 * 60 * 1000;
/** 团队视图（给模型看）。 */
function presentTeam(team) {
    return {
        id: team.id,
        name: team.name,
        ...(team.description !== undefined ? { description: team.description } : {}),
        defaultModel: team.model.provider !== '' ? `${team.model.provider}/${team.model.model}` : '(未设置，用全局默认)',
        roles: team.roles.map(role => ({
            id: role.id,
            name: role.name,
            tagline: role.tagline,
            group: role.group,
            model: role.model !== null ? `${role.model.provider}/${role.model.model}` : '继承团队',
            executor: role.executor,
        })),
        chains: team.chains.map(chain => ({
            id: chain.id,
            name: chain.name,
            // 并行组用 A‖B 表示：同一波次的角色会同时开跑。
            steps: describeChainSteps(chain),
            finalSynthesize: chain.finalSynthesize,
        })),
    };
}
/** 链步骤的可读路径（并行组合并成 `a‖b`）。 */
function describeChainSteps(chain) {
    const out = [];
    for (const step of chain.steps) {
        const label = step.kind === 'synthesize' ? '主脑整合' : step.roleId;
        if (step.kind === 'role' && step.parallel === true && out.length > 0) {
            out[out.length - 1] = `${out[out.length - 1]}‖${label}`;
            continue;
        }
        out.push(label);
    }
    return out;
}
/** 运行视图（给模型看）。 */
function presentRun(run) {
    const progress = runProgress(run);
    return {
        runId: run.id,
        team: run.teamName,
        chain: run.chainName,
        task: run.task,
        status: run.status,
        progress: `${progress.done}/${progress.total}`,
        ...(run.planMode !== undefined ? { planMode: run.planMode } : {}),
        ...(run.planNote !== undefined ? { planNote: run.planNote } : {}),
        ...(run.waveCount !== undefined && run.waveCount < run.steps.length
            ? { waves: `${run.waveCount} 个波次（存在并行）` }
            : {}),
        startedAt: run.startedAt,
        ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
        ...(run.error !== undefined ? { error: run.error } : {}),
        ...(run.errorKind !== undefined ? { errorKind: run.errorKind, advice: failureAdvice(run.errorKind) } : {}),
        ...(run.resumeCount !== undefined && run.resumeCount > 0 ? { resumeCount: run.resumeCount } : {}),
        // 明确告诉模型能不能接续，避免它对失败运行反复新建运行浪费额度。
        resumable: isResumable(run),
        ...(isResumable(run) ? { resumeHint: `用 team_resume（runId: ${run.id}）只重跑未完成的步骤，已完成产物保留` } : {}),
        steps: run.steps.map(step => ({
            index: step.index + 1,
            ...(step.wave !== undefined ? { wave: step.wave + 1 } : {}),
            role: step.roleName,
            status: step.status,
            ...(step.status === 'running' && step.phase !== undefined ? { phase: step.phase } : {}),
            model: step.modelUsed.provider !== '' ? `${step.modelUsed.provider}/${step.modelUsed.model}` : '',
            modelSource: step.modelSource,
            ...(step.fallbackUsed === true ? { fallbackUsed: true } : {}),
            channel: step.channel ?? '',
            ...(step.retries !== undefined && step.retries > 0 ? { retries: step.retries } : {}),
            ...(step.warning !== undefined ? { warning: step.warning } : {}),
            ...(step.error !== undefined && step.error !== '' ? { error: step.error } : {}),
            ...(step.errorKind !== undefined ? { errorKind: step.errorKind } : {}),
            ...(step.outputFile !== undefined ? { outputFile: `steps/${step.outputFile}` } : {}),
        })),
        ...(run.finalFile !== undefined ? { finalDeliverable: run.finalFile } : {}),
    };
}
/** 解析 modelOverrides 入参：支持数组形式 ["cha=provider/model"] 与对象形式。 */
function parseOverrides(input) {
    const out = {};
    if (Array.isArray(input)) {
        for (const item of input) {
            if (typeof item !== 'string')
                continue;
            const eq = item.indexOf('=');
            if (eq <= 0)
                continue;
            const roleId = item.slice(0, eq).trim();
            const binding = normalizeBinding(item.slice(eq + 1).trim());
            if (roleId !== '' && binding !== null && binding.provider !== '' && binding.model !== '') {
                out[roleId] = binding;
            }
        }
        return Object.keys(out).length > 0 ? out : undefined;
    }
    if (input === null || typeof input !== 'object')
        return undefined;
    for (const [roleId, value] of Object.entries(input)) {
        const binding = normalizeBinding(value);
        if (binding !== null && binding.provider !== '' && binding.model !== '')
            out[roleId] = binding;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
/**
 * 取调用方会话 id（工具 exec 上下文里带当前 agent，其 `id` 即 SessionId）。
 * 拿不到时返回空串。
 */
function execSessionId(exec) {
    const agent = exec?.agent;
    const id = agent?.id;
    return typeof id === 'string' ? id : '';
}
/** 注册三个团队工具；返回合并 disposer。 */
export function registerTeamTools({ ctx, store, engine }) {
    const disposers = [];
    // ── team_list ──
    disposers.push(ctx.tools.register(defineTool({
        name: 'team_list',
        description: '列出可用的多智能体团队及其角色、协作链与模型配置。在开启团队模式、或需要决定把任务交给哪个团队/哪条链之前调用。',
        parameters: {
            teamId: { type: 'string', description: '只看某个团队时传它的 id；留空列出全部。' },
        },
        async execute(args, exec) {
            const params = args;
            const teamId = typeof params.teamId === 'string' ? params.teamId.trim() : '';
            if (teamId !== '') {
                return JSON.stringify(presentTeam(store.readTeam(teamId)), null, 2);
            }
            const sessionId = execSessionId(exec);
            const teams = store.listTeamIds()
                .map(id => store.tryReadTeam(id))
                .filter((r) => 'team' in r)
                .map(r => presentTeam(r.team));
            if (teams.length === 0)
                return '尚无可用团队，请让用户在团队面板新建一个团队。';
            return JSON.stringify({ activeTeamId: store.sessionActiveTeamId(sessionId), teams }, null, 2);
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: args => ({ card: 'generic', kind: 'other', title: '查看团队编制', rawInput: args }),
    })));
    // ── team_run ──
    disposers.push(ctx.tools.register(defineTool({
        name: 'team_run',
        description: [
            '把一个任务交给多智能体团队执行：角色按波次推进——同一波次的角色**并行同时干活**，波次之间串行（后一波看得到前面全部产出），末尾由主脑整合成最终交付物。',
            '适用于需要多角色协作的任务：调研+审查、方案+落地、诊断+修复+验收、取证+成稿等。',
            '三种派发方式（优先级从高到低）：',
            '① plan：自己编排并行计划，形如 [["architect","strategist"],["coder"]] —— 架构师与策略师并行，完成后编码再上；互不依赖的工作放同一组能显著省时。',
            '② chainId：用预设协作链（链里可标注并行组）。',
            '③ roles：给一个角色 id 序列，串行接力。',
            '不确定怎么分工时传 autoPlan:true，让主脑先自己出一份并行派发计划再执行。',
            '本工具会等待运行完成并返回最终交付物摘要；产物落盘在团队运行目录，运行进度在对话流团队 HUD 与团队面板实时可见。',
            '简单问答或单步小改动不要用本工具，直接自己回答更快。',
        ].join(''),
        parameters: {
            task: { type: 'string', required: true, description: '交给团队的完整任务描述：目标、边界、验收标准。写得越具体产出越可用。' },
            teamId: { type: 'string', description: '团队 id（先用 team_list 查）。留空使用当前选中团队。' },
            plan: {
                type: 'array',
                items: { type: 'array', items: { type: 'string' } },
                description: '并行派发计划：每个元素是一个波次（同时执行的角色 id 数组），波次之间串行。例 [["architect","strategist"],["coder"]]。优先级高于 chainId/roles。',
            },
            autoPlan: { type: 'boolean', description: 'true = 让主脑先自主编排并行派发计划再执行（不需要你给 plan/chainId/roles）。' },
            chainId: { type: 'string', description: '协作链 id。留空且未给 plan/roles 时自动选用团队第一条链。' },
            roles: { type: 'array', items: { type: 'string' }, description: '临时点兵：角色 id 有序列表（串行接力；与 chainId/plan 互斥）。' },
            synthesize: { type: 'boolean', description: 'plan/roles 派发时是否追加主脑整合步（默认 true）。' },
            modelOverrides: {
                type: 'array',
                items: { type: 'string' },
                description: '本次运行的模型覆盖，每项形如 "角色id=provider/model"（如 "brain=provider/model"）。',
            },
            wait: { type: 'boolean', description: '是否等待运行完成（默认 true）。false 时立即返回 runId，之后用 team_status 查询。' },
        },
        async execute(args, exec) {
            const params = args;
            // 闸门：对话框团队开关关闭的会话，拒绝把任务转交团队执行。
            // （提示词注入已按会话过滤，这里再兜一道，避免模型凭历史上下文/记忆自行调用。）
            const sessionId = execSessionId(exec);
            if (sessionId !== '' && !store.readChatMode(sessionId).enabled) {
                throw new Error('本会话未开启团队模式（对话框的团队开关是关闭状态），不能调用 team_run。'
                    + '请自己直接完成这个任务；确需团队协作时，请用户先在对话框打开团队开关。');
            }
            const task = typeof params.task === 'string' ? params.task.trim() : '';
            if (task === '')
                throw new Error('task 不能为空');
            const teamId = typeof params.teamId === 'string' ? params.teamId.trim() : '';
            // 当前团队按会话解析：本会话选过的优先，未选过回退全局默认。
            const team = store.resolveTeamForSession(teamId !== '' ? teamId : undefined, sessionId);
            const roles = Array.isArray(params.roles)
                ? params.roles.filter((r) => typeof r === 'string' && r.trim() !== '').map(r => r.trim())
                : [];
            const autoPlan = params.autoPlan === true;
            const plan = Array.isArray(params.plan) ? params.plan : undefined;
            let chainId = typeof params.chainId === 'string' ? params.chainId.trim() : '';
            // 没给任何派发方式（且没让主脑自主编排）时，退回团队第一条链。
            if (!autoPlan && chainId === '' && roles.length === 0 && plan === undefined) {
                if (team.chains.length === 0)
                    throw new Error(`团队「${team.name}」没有协作链，请传 plan 或 roles 指定角色`);
                chainId = team.chains[0].id;
            }
            // plan / autoPlan 优先：显式并行计划下忽略链，避免两种派发语义打架。
            if (autoPlan || plan !== undefined)
                chainId = '';
            const overrides = parseOverrides(params.modelOverrides);
            const run = engine.start({
                teamId: team.id,
                ...(chainId !== '' ? { chainId } : {}),
                ...(roles.length > 0 && plan === undefined && !autoPlan ? { roles } : {}),
                ...(plan !== undefined ? { plan: plan } : {}),
                ...(autoPlan ? { autoPlan: true } : {}),
                task,
                ...(overrides !== undefined ? { modelOverrides: overrides } : {}),
                origin: 'tool',
                ...(sessionId !== '' ? { sessionId } : {}),
                synthesize: params.synthesize !== false,
            }, { exec: exec });
            if (params.wait === false) {
                return `已启动团队运行 ${run.id}（${run.teamName} · ${run.chainName}，共 ${run.steps.length} 步）。稍后用 team_status 查询进度。`;
            }
            // 等待完成（受工具 signal 影响：调用被中止则停止等待，不杀运行）。
            const deadline = Date.now() + WAIT_LIMIT_MS;
            let latest = run;
            while (Date.now() < deadline) {
                await new Promise((resolve) => { setTimeout(resolve, POLL_MS); });
                const signal = exec?.signal;
                if (signal?.aborted === true) {
                    return `等待被中止，运行 ${run.id} 仍在后台继续。用 team_status 查询。`;
                }
                const snapshot = store.readRun(run.id);
                if (snapshot === null)
                    continue;
                latest = snapshot;
                if (snapshot.status !== 'running' && snapshot.status !== 'queued')
                    break;
            }
            const progress = runProgress(latest);
            const lines = [
                `团队运行 ${latest.id} · ${latest.teamName} · ${latest.chainName} → ${latest.status}（${progress.done}/${progress.total} 步完成）`,
                '',
            ];
            if (latest.planNote !== undefined && latest.planNote !== '') {
                lines.push(`分工思路：${latest.planNote}`, '');
            }
            for (const step of latest.steps) {
                const mark = step.status === 'done' ? '✅' : step.status === 'error' ? '❌' : step.status === 'skipped' ? '⏭' : '⏳';
                const model = step.modelUsed.provider !== '' ? `${step.modelUsed.provider}/${step.modelUsed.model}` : '—';
                // 并行运行时「第 N 步」会误导，改标波次（同波次即并行同时执行）。
                const where = step.wave !== undefined ? `第 ${step.wave + 1} 波` : `第 ${step.index + 1} 步`;
                lines.push(`${mark} ${where} ${step.roleName}（${model}｜${step.channel ?? '—'}）${step.error !== undefined ? ` — ${step.error}` : ''}`);
            }
            if (latest.finalFile !== undefined) {
                try {
                    const final = store.readFinal(latest.id);
                    lines.push('', '## 最终交付物', truncate(final, 6000));
                }
                catch { /* ignore */ }
            }
            else {
                const last = [...latest.steps].reverse().find(step => step.status === 'done');
                if (last !== undefined) {
                    lines.push('', `## 最后一步产出（${last.roleName}）`, truncate(last.output, 4000));
                }
            }
            if (latest.error !== undefined)
                lines.push('', `⚠ ${latest.error}`);
            // 失败时明确指路：告诉模型用 team_resume 接续，而不是重开一次 team_run 把已完成的活重跑。
            if (isResumable(latest)) {
                lines.push('', `⤴ 本次运行可接续：调用 team_resume（runId: ${latest.id}）只重跑未完成的步骤，已完成产物保留。`, ...(latest.errorKind !== undefined ? [failureAdvice(latest.errorKind)] : []));
            }
            return lines.join('\n');
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: args => ({ card: 'generic', kind: 'other', title: '团队协作执行', rawInput: args }),
    })));
    // ── team_status ──
    disposers.push(ctx.tools.register(defineTool({
        name: 'team_status',
        description: '查看团队运行状态：指定 runId 查该次运行，留空查本会话最近一次运行。返回每步状态、实际使用的模型与来源层、产物路径。',
        parameters: {
            runId: { type: 'string', description: '运行 id；留空取本会话最近一次。' },
            full: { type: 'boolean', description: 'true 时附带最终交付物全文。' },
        },
        async execute(args, exec) {
            const params = args;
            const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
            const sessionId = execSessionId(exec);
            const run = runId !== ''
                ? store.readRun(runId)
                : (() => {
                    const ids = store.listRunIds();
                    for (const id of ids) {
                        const snapshot = store.readRun(id);
                        if (snapshot === null)
                            continue;
                        // 本会话优先；本会话没有运行时回退全局最近一次（避免新会话一片空）。
                        if (sessionId !== '' && snapshot.sessionId === sessionId)
                            return snapshot;
                        if (sessionId === '')
                            return snapshot;
                    }
                    // 全都不属于本会话时，回退全局最近一次（有会话 id 但找不到 → 全局兜底）。
                    for (const id of ids) {
                        const snapshot = store.readRun(id);
                        if (snapshot !== null)
                            return snapshot;
                    }
                    return null;
                })();
            if (run === null)
                return runId !== '' ? `找不到运行：${runId}` : '还没有任何团队运行记录。';
            const view = presentRun(run);
            if (params.full === true && run.finalFile !== undefined) {
                try {
                    return `${JSON.stringify(view, null, 2)}\n\n## 最终交付物\n${store.readFinal(run.id)}`;
                }
                catch { /* ignore */ }
            }
            return JSON.stringify(view, null, 2);
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: args => ({ card: 'generic', kind: 'other', title: '查看团队运行状态', rawInput: args }),
    })));
    // ── team_resume ──
    disposers.push(ctx.tools.register(defineTool({
        name: 'team_resume',
        description: [
            '接续一次未完成的团队运行：在**同一个运行**上只重跑失败/被跳过/未开始的步骤，已完成步骤的产物完整保留（不重复消耗额度）。',
            '适用场景：上一次 team_run 因供应商限流、鉴权失败、超时、上游 5xx、服务重启或用户取消而中断。',
            '不要为此新建一次 team_run —— 那会把已完成的工作重跑一遍。',
            '先用 team_status 查看 resumable 与 errorKind：鉴权/额度类错误请先让用户修好配置再接续，否则会立刻再失败一次。',
            '默认等待完成并返回结果摘要。',
        ].join(''),
        parameters: {
            runId: { type: 'string', description: '要接续的运行 id；留空取本会话最近一次未完成的运行。' },
            wait: { type: 'boolean', description: '是否等待完成（默认 true）。false 时立即返回，之后用 team_status 查询。' },
        },
        async execute(args, exec) {
            const params = args;
            const sessionId = execSessionId(exec);
            if (sessionId !== '' && !store.readChatMode(sessionId).enabled) {
                throw new Error('本会话未开启团队模式（对话框的团队开关是关闭状态），不能调用 team_resume。');
            }
            const explicit = typeof params.runId === 'string' ? params.runId.trim() : '';
            // 留空：取本会话最近一次「可接续」的运行（本会话没有则不跨会话乱动别人的运行）。
            const target = explicit !== ''
                ? explicit
                : (() => {
                    for (const id of store.listRunIds()) {
                        const snapshot = store.readRun(id);
                        if (snapshot === null)
                            continue;
                        if (sessionId !== '' && snapshot.sessionId !== sessionId)
                            continue;
                        if (isResumable(snapshot))
                            return snapshot.id;
                    }
                    return '';
                })();
            if (target === '')
                throw new Error('本会话没有可接续的运行（所有运行都已全部完成，或还没有运行记录）。');
            const started = engine.resume(target, { exec: exec });
            const pending = started.steps.filter(step => step.status !== 'done').length;
            if (params.wait === false) {
                return `已接续运行 ${started.id}（${started.teamName}），重跑 ${pending} 个未完成步骤。稍后用 team_status 查询。`;
            }
            const deadline = Date.now() + WAIT_LIMIT_MS;
            let latest = started;
            while (Date.now() < deadline) {
                await new Promise((resolve) => { setTimeout(resolve, POLL_MS); });
                const signal = exec?.signal;
                if (signal?.aborted === true) {
                    return `等待被中止，接续运行 ${started.id} 仍在后台继续。用 team_status 查询。`;
                }
                const snapshot = store.readRun(started.id);
                if (snapshot === null)
                    continue;
                latest = snapshot;
                if (snapshot.status !== 'running' && snapshot.status !== 'queued')
                    break;
            }
            const progress = runProgress(latest);
            const lines = [
                `接续完成：${latest.id} · ${latest.teamName} → ${latest.status}（${progress.done}/${progress.total} 步完成，本轮重跑 ${pending} 步）`,
                '',
            ];
            for (const step of latest.steps) {
                const mark = step.status === 'done' ? '✅' : step.status === 'error' ? '❌' : step.status === 'skipped' ? '⏭' : '⏳';
                const where = step.wave !== undefined ? `第 ${step.wave + 1} 波` : `第 ${step.index + 1} 步`;
                const model = step.modelUsed.provider !== '' ? `${step.modelUsed.provider}/${step.modelUsed.model}` : '—';
                const fb = step.fallbackUsed === true ? '（备用模型）' : '';
                lines.push(`${mark} ${where} ${step.roleName}（${model}${fb}）${step.error !== undefined && step.error !== '' ? ` — ${step.error}` : ''}`);
            }
            if (latest.finalFile !== undefined) {
                try {
                    lines.push('', '## 最终交付物', truncate(store.readFinal(latest.id), 6000));
                }
                catch { /* ignore */ }
            }
            if (latest.error !== undefined && latest.error !== '') {
                lines.push('', `⚠ ${latest.error}`);
                if (latest.errorKind !== undefined)
                    lines.push(failureAdvice(latest.errorKind));
            }
            return lines.join('\n');
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: args => ({ card: 'generic', kind: 'other', title: '接续团队运行', rawInput: args }),
    })));
    // ── team_create ──
    disposers.push(ctx.tools.register(defineTool({
        name: 'team_create',
        description: [
            '一句话生成一支新的多智能体团队：由模型设计角色编制（角色 + 系统提示词 + 分组）、协作链与直连关系，落盘为新团队并设为当前团队。',
            '当用户说「帮我建一个 xx 团队」「生成一支做 xx 的团队」时调用。',
            '注意：生成不决定模型绑定——所有角色默认继承团队默认模型，生成后提醒用户在团队面板选一次团队默认模型。',
        ].join(''),
        parameters: {
            brief: { type: 'string', required: true, description: '团队需求描述：做什么、需要哪些环节/能力。越具体角色划分越准。' },
            provider: { type: 'string', description: '可选：用于生成的 provider（缺省用全局默认模型）。' },
            model: { type: 'string', description: '可选：用于生成的 model id。' },
        },
        async execute(args, exec) {
            const params = args;
            const brief = typeof params.brief === 'string' ? params.brief : '';
            const provider = typeof params.provider === 'string' ? params.provider.trim() : '';
            const model = typeof params.model === 'string' ? params.model.trim() : '';
            const signal = exec?.signal;
            const team = await generateTeam(ctx, store, {
                brief,
                ...(provider !== '' ? { provider } : {}),
                ...(model !== '' ? { model } : {}),
                ...(signal !== undefined ? { signal } : {}),
            });
            // 设为「本会话」的当前团队，不污染其它会话与全局默认。
            const sessionId = execSessionId(exec);
            if (sessionId !== '')
                store.setSessionActiveTeam(sessionId, team.id);
            else
                store.patchGlobals({ activeTeamId: team.id });
            const lines = [
                `已生成团队「${team.name}」（id: ${team.id}），共 ${team.roles.length} 个角色、${team.chains.length} 条协作链，并设为当前团队。`,
                '',
                '角色：',
                ...team.roles.map(role => `- ${role.name}（${role.id}）· ${role.tagline}`),
            ];
            if (team.chains.length > 0) {
                lines.push('', '协作链：');
                for (const chain of team.chains) {
                    const path = chain.steps
                        .map(step => (step.kind === 'synthesize' ? '主脑整合' : team.roles.find(r => r.id === step.roleId)?.name ?? step.roleId))
                        .join(' → ');
                    const tail = chain.finalSynthesize && !chain.steps.some(s => s.kind === 'synthesize') ? ' → 主脑整合' : '';
                    lines.push(`- ${chain.id}：${path}${tail}`);
                }
            }
            if (team.model.provider === '') {
                lines.push('', '⚠ 该团队还没设「团队默认模型」：请在左侧「团队」面板顶部选一个模型，全体角色会继承它。');
            }
            return lines.join('\n');
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: args => ({ card: 'generic', kind: 'other', title: '一句话生成团队', rawInput: args }),
    })));
    return () => {
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch { /* ignore */ }
        }
    };
}
//# sourceMappingURL=tools.js.map