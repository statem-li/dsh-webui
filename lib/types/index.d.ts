/**
 * webui — 会话 Web UI 插件（host 半身）。
 *
 * 除 client bundle 发现/装配外，host 半身内置一份「供应商级推理等级模板」
 * （同一供应商的模型共享同一套 reasoningEfforts 线值映射），并注册
 * `webui_sync_reasoning` 工具：把 settings 里 `llm-pi-ai` 各供应商中缺失
 * `reasoningEfforts` 的模型按模板自动补全——参考 OpenHanako 的
 * known-models 词典做法，但只做「供应商级模板」这一最小闭环。
 */
import type { Context } from 'cordis';
export declare const name = "webui";
export declare const inject: string[];
/**
 * 注册 `webui_sync_reasoning`：扫描 llm-pi-ai 配置，为缺失 reasoningEfforts
 * 的模型补上其供应商模板；已有配置的模型与未收录模板的供应商原样保留。
 * @param ctx - host 上下文（settings / tools 服务）。
 */
export declare function apply(ctx: Context): void;
