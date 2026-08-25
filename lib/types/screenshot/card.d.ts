import { type ShotTheme } from './theme.js';
/** 单条待渲染消息。 */
export interface ShotMessage {
    role: 'user' | 'assistant';
    text: string;
}
/** 卡片组装参数。 */
export interface ShotCardInput {
    messages: readonly ShotMessage[];
    theme: ShotTheme;
    /** 卡片宽度（CSS px）。 */
    width: number;
    /** 卡片最小高度（CSS px），短消息保底版面。 */
    minHeight: number;
    /** 卡片大标题；一般传会话标题，留空时从首条消息正文推导。 */
    title?: string;
    /** 页头徽章文案（如「这一轮问答」），留空按消息数与角色生成。 */
    label?: string;
}
/** 从消息文本提取标题：首个有意义内容行，剥离 Markdown 标记，截断到 64 字符。 */
export declare function deriveTitle(text: string, role: 'user' | 'assistant'): string;
/**
 * mermaid 引擎文件名（renderer.ts 把解压后的引擎投放到临时页面同目录，
 * 页面用相对路径加载 —— file:// 页面无网络，必须同目录）。
 */
export declare const MERMAID_FILE = "mermaid.min.js";
/**
 * 页面里「图表是否已渲染完」的全局钩子名。renderer.ts 用它决定要不要等图，
 * 也用它判断本次渲染需不需要投放引擎文件。
 */
export declare const MERMAID_HOOK = "__shotMermaid";
/** 卡片组装结果。 */
export interface ShotCardOutput {
    /** 可直接写入临时 file:// 页面的完整 HTML。 */
    html: string;
    /** 正文含图表围栏：渲染器需要投放 mermaid 引擎并等待图画完。 */
    needsMermaid: boolean;
}
/**
 * 组装完整截图 HTML 文档。
 * @param input - 消息、主题、尺寸与文案。
 * @returns HTML 文本与「是否需要 mermaid 引擎」标记。
 */
export declare function buildCardHtml(input: ShotCardInput): Promise<ShotCardOutput>;
