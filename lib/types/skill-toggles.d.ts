/**
 * 技能开关(skill-toggles):挂 /api/skill-toggles 路由,读写技能 SKILL.md 的
 * frontmatter 开关字段,实现「每个技能禁用/开启 + 每个技能包一键开关」。
 *
 * 开关真正生效的机制:DSH 内核 skill-filesystem 解析每个技能目录 SKILL.md 的
 * frontmatter —— `user-invocable: false` 使技能对用户侧(/ 菜单、/name 手势)
 * 不可调用,`disable-model-invocation: true` 使技能对模型侧(模型目录、skill
 * 工具)不可调用。修改文件后内核 watcher 会自动重扫,无需重启。
 *
 * 本模块只读写技能文件本身,不动 DSH 源码;数据面与技能管理面板
 * (/api/skill-manager)同一批技能目录(managedRoot + dshRoot)。
 *
 * Routes (all under /api/skill-toggles):
 *   PUT  /skills/:name      { enabled } → 开/关单个技能
 *   PUT  /bundles/:id       { enabled } → 开/关一个技能包(内全部技能)
 *   GET  /status            → { skills: {name: enabled}, bundles: {id: enabled} }
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
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
/** Mount the routes. */
export declare function apply(ctx: Context): Promise<void>;
