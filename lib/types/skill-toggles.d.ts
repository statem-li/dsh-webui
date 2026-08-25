/**
 * 技能开关(skill-toggles):挂 /api/skill-toggles 路由,提供两级开关——
 *
 *  1. **全局层**:读写技能 SKILL.md 的 frontmatter 开关字段
 *     (`user-invocable: false` + `disable-model-invocation: true`),
 *     对所有 Agent 预设生效。DSH 内核 skill-filesystem 解析这两个字段,
 *     改完文件后内核 watcher 自动重扫,无需重启。
 *
 *  2. **Agent 预设层**:同一个技能可以「对 standard 开、对 code 关」。
 *     账本存 `<agentsHome>/skills/.preset-skills.json`
 *     (`{ version: 1, presets: { <presetId>: { <skillName>: false } } }`;
 *     缺省 = 继承全局层,只有显式 false 才在该预设下关闭)。
 *
 * 预设层的生效机制(零 DSH 源码改动、运行时零 I/O):
 *   `ctx.skills` 是**分层**注册表——global 层 + scope 链(preset 常驻层 →
 *   agent 层),读取时按层合并,**最近层的同名条目直接覆盖更远层**。而每个
 *   agent 自身就是它那一层的 scope key,`agent.ctx.skills.registerProvider()`
 *   正好注册进该 agent 的层(注册表按调用方 ctx 的 scope 归层)。
 *   于是本模块在 `agent/created` 时给每个 agent 装一个「闸门 provider」:
 *   它只为「该 agent 所属预设里被关掉的技能名」返回同名候选,且候选的
 *   invocation 两个开关都是 false。合并后这些名字在该 agent 眼里就是
 *   不可调用的 —— 模型目录(catalog)不列、`skill` 工具拒绝加载、
 *   `/name` 手势也不认。其它 agent / 其它预设完全不受影响。
 *
 *   闸门 provider 的 list() 只读内存里的账本(无文件 I/O),注册表本身还有
 *   按 (cwd, scope 链, revision) 的缓存,所以每回合额外开销可忽略。
 *   写账本后调用各闸门的 invalidate() 使缓存失效,下一步即生效。
 *
 * 本模块只读写技能文件与自己的账本,不动 DSH 源码;数据面与技能管理面板
 * (/api/skill-manager)同一批技能目录(managedRoot + dshRoot)。
 *
 * Routes (all under /api/skill-toggles):
 *   GET  /status                          → { skills: {name: enabled}, bundles: {id: enabled} }
 *   PUT  /skills/:name        { enabled } → 全局开/关单个技能
 *   PUT  /bundles/:id         { enabled } → 全局开/关一个技能包(内全部技能)
 *   GET  /presets                         → { presets: [...roster], overrides, skills, bundles }
 *   PUT  /presets/:preset/skills/:name    { enabled } → 该预设下开/关单个技能
 *   PUT  /presets/:preset/bundles/:id     { enabled } → 该预设下开/关一个技能包
 *   POST /presets/:preset/reset           → 清空该预设的全部覆盖(回落全局)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Stable Cordis plugin name fragment (merged into webui host apply). */
export declare const name = "skill-toggles";
/** Minimal webServer service view (same contract as skill-manager). */
declare module '@deepseek-ai/cordis' {
    interface Context {
        webServer: {
            register(route: {
                kind: 'exact' | 'prefix';
                path: string;
                handler: (req: IncomingMessage, res: ServerResponse) => void;
            }): () => void;
        };
    }
}
/** Services required before this plugin activates. */
export declare const inject: string[];
/** 运行时才存在的服务(skills / agents / agentPresets)在类型上放宽为 any。 */
type PluginContext = any;
/** ── 预设级开关账本 ───────────────────────────────────────────────────────── */
/**
 * 账本形状:`{ version: 1, presets: { <presetId>: { <skillName>: boolean } } }`。
 * 只有显式 `false` 才在该预设下关闭;`true` 或缺省都表示「继承全局层」。
 */
export interface PresetSkillsFile {
    version: 1;
    presets: Record<string, Record<string, boolean>>;
}
/** Mount the routes and install the per-agent preset masks. */
export declare function apply(ctx: PluginContext): Promise<void>;
export {};
