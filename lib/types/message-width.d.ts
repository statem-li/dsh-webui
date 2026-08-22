/** 注入服务均为运行时动态注册，类型上放宽为 any。 */
type PluginContext = any;
export type MessageWidthUnit = 'px' | '%';
/** 默认值：525px —— 与 ui-conversation 原 `min(525px, 82%)` 的桌面端视觉上限一致。 */
export declare const MESSAGE_WIDTH_DEFAULT: {
    readonly value: 525;
    readonly unit: "px";
};
/** 注册「发送对话宽度」设置：settings 持久化 + HTTP API。 */
export declare function applyMessageWidth(ctx: PluginContext): void;
export {};
