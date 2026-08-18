import { defineTool } from '@deepseek-ai/dsh-tools';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
export const name = 'webui';
export const inject = ['settings', 'tools'];
/** 供应商级推理等级模板：等级名 → 发送给该供应商的线值（string 或 null）。 */
const PROVIDER_REASONING_TEMPLATES = {
    // anthropic-messages：思考用 thinking 块 + effort 字符串
    sensenova: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    agnes: { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
    // openai-completions：reasoning_effort 参数；off 省略参数
    rhythm: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    bai: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    pl: { off: null, low: 'low', high: 'high', xhigh: 'max' },
};
/**
 * 注册 `webui_sync_reasoning`：扫描 llm-pi-ai 配置，为缺失 reasoningEfforts
 * 的模型补上其供应商模板；已有配置的模型与未收录模板的供应商原样保留。
 * @param ctx - host 上下文（settings / tools 服务）。
 */
export function apply(ctx) {
    ctx.tools.register(defineTool({
        name: 'webui_sync_reasoning',
        description: '为 settings 里 llm-pi-ai 各供应商中缺失 reasoningEfforts（推理等级）的模型，按内置供应商级模板自动补全，免去手工编辑 settings.yaml。已有配置或未收录供应商不受影响。',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    patched: { type: 'array', required: true, items: { type: 'string' } },
                    skipped: { type: 'array', required: true, items: { type: 'string' } },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `已补全 ${value.patched.length} 个模型的推理等级：${value.patched.join(', ') || '(无)'}。` +
                        `跳过 ${value.skipped.length} 个：${value.skipped.join(', ') || '(无)'}。`,
                }],
        },
        async execute() {
            const ns = settingsNamespace('llm-pi-ai');
            const raw = ctx.settings.get(ns);
            const providers = raw?.providers;
            const patched = [];
            const skipped = [];
            if (providers === undefined)
                return { patched, skipped };
            let changed = false;
            const nextProviders = {};
            for (const [providerId, provider] of Object.entries(providers)) {
                const template = PROVIDER_REASONING_TEMPLATES[providerId];
                const models = Array.isArray(provider?.models) ? provider.models : [];
                if (template === undefined || models.length === 0) {
                    nextProviders[providerId] = provider;
                    continue;
                }
                const nextModels = models.map((model) => {
                    const id = typeof model.id === 'string' ? model.id : '';
                    if (model.reasoningEfforts !== undefined) {
                        // 已有配置（含显式 false / 空对象），绝不覆盖。
                        return model;
                    }
                    if (id === '') {
                        skipped.push(`${providerId}/<无 id>`);
                        return model;
                    }
                    patched.push(`${providerId}/${id}`);
                    changed = true;
                    return { ...model, reasoningEfforts: { ...template } };
                });
                nextProviders[providerId] = { ...provider, models: nextModels };
            }
            if (changed) {
                await ctx.settings.update(ns, { providers: nextProviders });
            }
            return { patched, skipped };
        },
        presentCall: () => ({ card: 'generic', title: '同步模型推理等级', kind: 'other', rawInput: null }),
    }));
}
//# sourceMappingURL=index.js.map